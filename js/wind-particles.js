/*
 * 本地地球 Local Earth — P2 高性能风场粒子
 * ---------------------------------------------------------------------------
 * 在 P0 Wind3D 箭头（js/windninja.js）之上叠加 CPU 粒子动画：
 *   - 数据源：LEWindninja.getExportData().points（当前场景全网格采样点，
 *     speed / bearing / row / col / lon / lat），双线性插值速度与风向；
 *   - 绘制：Cesium.PointPrimitiveCollection（粒子，固定屏幕像素大小）
 *           + Cesium.PolylineCollection（尾迹，3–5 段，按风速分级着色）；
 *   - 驱动：viewer.scene.preRender + 固定 25fps（40ms）步长，与渲染帧率解耦；
 *   - 越界/寿命到重播种；start / stop / setDensity / getStats；
 *   - 与箭头切换：粒子 / 箭头 / 两者；URL ?windmode=particles|arrows|both、
 *     ?particles=600|1200|2200（也接受任意 100–5000 的数字）。
 *
 * 对外 API：window.LEWindParticles
 *   init(le)
 *   start(opts)          opts: {density: 'low'|'medium'|'high'|number, mode, dt, trailSegments}
 *   stop()
 *   setDensity(n)        数字或 'low'|'medium'|'high'
 *   isRunning()
 *   getStats()
 *   setMode('particles'|'arrows'|'both') / getMode()
 *   getFieldInfo()       当前风场栅格信息（调试/自动化）
 *
 * 兼容性：不修改 js/windninja.js，仅在运行时包装 showScene/clear 挂钩，
 * 场景切换后自动重建粒子场并恢复箭头/粒子可见性。
 * 完全离线：不引入任何第三方库。
 */
(function () {
  'use strict';

  const C = window.Cesium;

  const DENSITY = { low: 600, medium: 1200, high: 2200 };
  const DENSITY_LABEL = { low: '低', medium: '中', high: '高' };
  const DEFAULT_TRAIL = { low: 3, medium: 4, high: 4 }; // 尾迹段数（3–6）
  const TICK_MS = 50; // 全量更新 20fps（20–30fps 目标区间）
  const SIM_DT = 15; // 每个步长的“模拟秒数”（视觉加速，约 300× 实时风）
  const TRAIL_ALPHA = 0.9;
  const POINT_PIXEL = 3.0;
  const D2R = Math.PI / 180;
  const WGS84_A = 6378137.0;
  const WGS84_E2 = 6.69437999014e-3;

  /** 内联 WGS84 经纬度 → 笛卡尔（等价 Cartesian3.fromDegrees，减少函数/临时对象开销）。 */
  function cartesianFromDeg(lon, lat, h, result) {
    const lonR = lon * D2R;
    const latR = lat * D2R;
    const cosLat = Math.cos(latR);
    const sinLat = Math.sin(latR);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    const xy = n + h;
    result.x = xy * cosLat * Math.cos(lonR);
    result.y = xy * cosLat * Math.sin(lonR);
    result.z = (n * (1 - WGS84_E2) + h) * sinLat;
    return result;
  }

  function copyCartesian(src, dst) {
    dst.x = src.x;
    dst.y = src.y;
    dst.z = src.z;
    return dst;
  }

  const state = {
    le: null,
    ready: false,
    field: null,
    fieldKey: '',
    mode: 'arrows',
    running: false,
    densityName: 'medium',
    requested: 0,
    count: 0,
    trailSegments: 4,
    trailCustom: false,
    dt: SIM_DT,
    points: null,
    trails: null,
    particles: [],
    materials: [],
    pointColors: [],
    bins: [],
    preRender: null,
    lastTick: 0,
    cursor: 0,
    sliceIndex: 0,
    updates: 0,
    tickCount: 0,
    respawns: 0,
    updateMsAvg: 0,
    fps: 0,
    updateFps: 0,
    updatesAtWindow: 0,
    frames: 0,
    fpsStart: 0,
    postRender: null,
    autoStart: false,
    pendingSync: 0,
    hooksInstalled: false,
    bound: false,
    hiddenArrows: false,
    windKey: '',
    noteTimer: 0,
    windWatchTimer: 0,
  };

  const byId = (id) => document.getElementById(id);

  /* ------------------------------ 工具 ------------------------------ */

  function fmt(v, digits) {
    if (!isFinite(v)) return '--';
    return Number(v).toFixed(digits == null ? 1 : digits);
  }

  function defaultDensityName() {
    const eff = window.LEPerf && typeof window.LEPerf.getEffective === 'function'
      ? window.LEPerf.getEffective()
      : 'medium';
    return DENSITY[eff] ? eff : 'medium';
  }

  function densityCount() {
    if (state.requested > 0) return state.requested;
    return DENSITY[state.densityName] || DENSITY.medium;
  }

  function legendBins() {
    try {
      const W = window.LEWindninja;
      if (W && typeof W.getLegend === 'function') {
        const bins = W.getLegend();
        if (Array.isArray(bins) && bins.length) return bins;
      }
    } catch (err) {
      /* ignore */
    }
    return [
      { label: '0.00 – 2.14', color: '#3a63ff', name: 'blue' },
      { label: '2.15 – 4.30', color: '#29c65a', name: 'green' },
      { label: '4.31 – 6.45', color: '#ffdb39', name: 'yellow' },
      { label: '6.46 – 8.60', color: '#ff8c1a', name: 'orange' },
      { label: '8.61 – 10.76', color: '#ff3a3a', name: 'red' },
      { label: '> 10.76', color: '#ae1414', name: 'darkred' },
    ];
  }

  function binIndexFor(bins, speed) {
    const edges = [2.14, 4.3, 6.45, 8.6, 10.76];
    for (let i = 0; i < edges.length; i++) {
      if (speed <= edges[i]) return Math.min(i, bins.length - 1);
    }
    return bins.length - 1;
  }

  function makeColors() {
    state.bins = legendBins();
    state.pointColors = state.bins.map((b) =>
      C.Color.fromCssColorString(b.color).withAlpha(0.95)
    );
    state.materials = state.bins.map((b) =>
      C.Material.fromType('Color', {
        color: C.Color.fromCssColorString(b.color).withAlpha(TRAIL_ALPHA),
      })
    );
  }

  /* --------------------------- 风场栅格构建 --------------------------- */

  function buildField() {
    const W = window.LEWindninja;
    if (!W || typeof W.getExportData !== 'function') return null;
    let data = null;
    try {
      data = W.getExportData();
    } catch (err) {
      return null;
    }
    if (!data || !Array.isArray(data.points) || data.points.length < 9) return null;
    const points = data.points;

    const rowSeen = new Set();
    const colSeen = new Set();
    for (let i = 0; i < points.length; i++) {
      rowSeen.add(points[i].row);
      colSeen.add(points[i].col);
    }
    const rows = Array.from(rowSeen).sort((a, b) => a - b);
    const cols = Array.from(colSeen).sort((a, b) => a - b);
    const nR = rows.length;
    const nC = cols.length;
    if (nR < 2 || nC < 2) return null;
    const rIndex = new Map();
    rows.forEach((r, i) => rIndex.set(r, i));
    const cIndex = new Map();
    cols.forEach((c, i) => cIndex.set(c, i));

    const size = nR * nC;
    const speed = new Float32Array(size).fill(-1);
    const sinB = new Float32Array(size);
    const cosB = new Float32Array(size);
    const lonN = new Float64Array(size);
    const latN = new Float64Array(size);
    const hN = new Float64Array(size);

    const le = state.le;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    let minS = Infinity;
    let maxS = -Infinity;

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const ri = rIndex.get(p.row);
      const ci = cIndex.get(p.col);
      if (ri == null || ci == null) continue;
      const at = ri * nC + ci;
      const sp = Number(p.speed);
      if (isFinite(sp)) {
        speed[at] = sp;
        if (sp < minS) minS = sp;
        if (sp > maxS) maxS = sp;
      }
      const bearing = isFinite(p.bearing)
        ? Number(p.bearing)
        : (Number(p.angle) + 180) % 360;
      const rad = (bearing * Math.PI) / 180;
      sinB[at] = Math.sin(rad);
      cosB[at] = Math.cos(rad);
      const lon = Number(p.lon);
      const lat = Number(p.lat);
      lonN[at] = lon;
      latN[at] = lat;
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      let h = 0;
      try {
        if (le && typeof le.heightAt === 'function') h = le.heightAt(lon, lat) || 0;
      } catch (err) {
        h = 0;
      }
      hN[at] = h;
    }

    const step = Number(data.step) > 0 ? Number(data.step) : 1;
    const cell = data.stats && data.stats.grid && isFinite(data.stats.grid.cellsize)
      ? Number(data.stats.grid.cellsize)
      : 200;
    const stats = data.stats || null;
    return {
      points,
      rows,
      cols,
      nR,
      nC,
      speed,
      sinB,
      cosB,
      lonN,
      latN,
      hN,
      metersPerCell: Math.max(1, cell * step),
      cell,
      step,
      west,
      south,
      east,
      north,
      minSpeed: isFinite(minS) ? minS : 0,
      maxSpeed: isFinite(maxS) ? maxS : 0,
      label: data.label || '',
      index: stats && stats.index != null ? stats.index : -1,
      grid: stats && stats.grid ? stats.grid : null,
    };
  }

  function fieldKeyOf(field) {
    if (!field) return '';
    return [
      field.label,
      field.index,
      field.nR,
      field.nC,
      field.step,
      fmt(field.west, 4),
      fmt(field.south, 4),
      fmt(field.maxSpeed, 2),
    ].join('|');
  }

  function sampleField(field, rf, cf, out) {
    if (!field) return null;
    const nR = field.nR;
    const nC = field.nC;
    if (!(rf >= 0 && cf >= 0 && rf <= nR - 1 && cf <= nC - 1)) return null;
    let r0 = Math.floor(rf);
    let c0 = Math.floor(cf);
    if (r0 > nR - 2) r0 = nR - 2;
    if (c0 > nC - 2) c0 = nC - 2;
    if (r0 < 0) r0 = 0;
    if (c0 < 0) c0 = 0;
    const fr = rf - r0;
    const fc = cf - c0;
    const i00 = r0 * nC + c0;
    const i10 = i00 + nC;
    const i01 = i00 + 1;
    const i11 = i10 + 1;
    const w00 = (1 - fr) * (1 - fc);
    const w10 = fr * (1 - fc);
    const w01 = (1 - fr) * fc;
    const w11 = fr * fc;
    const s =
      field.speed[i00] * w00 + field.speed[i10] * w10 + field.speed[i01] * w01 + field.speed[i11] * w11;
    const o = out || {};
    o.speed = s;
    o.sin = field.sinB[i00] * w00 + field.sinB[i10] * w10 + field.sinB[i01] * w01 + field.sinB[i11] * w11;
    o.cos = field.cosB[i00] * w00 + field.cosB[i10] * w10 + field.cosB[i01] * w01 + field.cosB[i11] * w11;
    o.lon = field.lonN[i00] * w00 + field.lonN[i10] * w10 + field.lonN[i01] * w01 + field.lonN[i11] * w11;
    o.lat = field.latN[i00] * w00 + field.latN[i10] * w10 + field.latN[i01] * w01 + field.latN[i11] * w11;
    o.height = field.hN[i00] * w00 + field.hN[i10] * w10 + field.hN[i01] * w01 + field.hN[i11] * w11;
    return o;
  }

  /* ------------------------------ 粒子 ------------------------------ */

  function setParticlePosition(p, sample, updateTrail) {
    p.lon = sample.lon;
    p.lat = sample.lat;
    p.height = sample.height + 8;
    cartesianFromDeg(p.lon, p.lat, p.height, p.cart);
    if (p.point) {
      p.point.position = p.cart;
      const bin = binIndexFor(state.bins, sample.speed);
      if (bin !== p.bin) {
        p.bin = bin;
        p.point.color = state.pointColors[bin];
        if (p.line) p.line.material = state.materials[bin];
      }
    }
    if (!updateTrail) return;
    const trail = p.trail;
    const n = trail.length;
    for (let k = n - 1; k > 0; k--) {
      copyCartesian(trail[k - 1], trail[k]);
    }
    copyCartesian(p.cart, trail[0]);
    if (p.line) p.line.positions = trail;
  }

  function resetTrail(p) {
    const trail = p.trail;
    for (let k = 0; k < trail.length; k++) copyCartesian(p.cart, trail[k]);
    if (p.line) p.line.positions = trail;
  }

  function seedParticle(p, initial) {
    const field = state.field;
    if (!field) return false;
    for (let t = 0; t < 12; t++) {
      const rf = Math.random() * (field.nR - 1);
      const cf = Math.random() * (field.nC - 1);
      const s = sampleField(field, rf, cf, p.sample);
      if (!s || !isFinite(s.speed) || s.speed < 0.35) continue;
      p.rf = rf;
      p.cf = cf;
      p.age = initial ? Math.floor(Math.random() * 50) : 0;
      p.life = 55 + Math.floor(Math.random() * 70);
      p.bin = -1;
      setParticlePosition(p, s, false);
      // 重置尾迹为同一点，避免重播种时出现长直线
      resetTrail(p);
      return true;
    }
    // 兜底：放在栅格中心（风速可能为 0，但至少不会跑到 (0,0)）
    p.rf = (field.nR - 1) / 2;
    p.cf = (field.nC - 1) / 2;
    const mid = {
      lon: (field.west + field.east) / 2,
      lat: (field.south + field.north) / 2,
      height: 0,
      speed: 0,
    };
    p.age = 0;
    p.life = 60;
    p.bin = -1;
    setParticlePosition(p, mid, false);
    resetTrail(p);
    return false;
  }

  function createParticle(index) {
    const field = state.field;
    const p = {
      index,
      rf: 0,
      cf: 0,
      lon: 0,
      lat: 0,
      height: 0,
      age: 0,
      life: 60,
      bin: -1,
      cart: new C.Cartesian3(),
      trail: [],
      sample: {},
      point: null,
      line: null,
    };
    const n = state.trailSegments + 1;
    for (let k = 0; k < n; k++) p.trail.push(new C.Cartesian3());
    p.point = state.points.add({
      position: p.cart,
      pixelSize: POINT_PIXEL,
      color: state.pointColors[0],
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    p.line = state.trails.add({
      positions: p.trail,
      width: 1.2,
      material: state.materials[0],
    });
    seedParticle(p, true);
    return p;
  }

  function destroyCollections() {
    const le = state.le;
    if (!le || !le.viewer) return;
    const scene = le.viewer.scene;
    if (state.trails) {
      try {
        scene.primitives.remove(state.trails);
      } catch (err) {
        /* ignore */
      }
      state.trails = null;
    }
    if (state.points) {
      try {
        scene.primitives.remove(state.points);
      } catch (err) {
        /* ignore */
      }
      state.points = null;
    }
    state.particles = [];
    state.count = 0;
  }

  function createCollections(count) {
    const le = state.le;
    if (!le || !le.viewer) return false;
    destroyCollections();
    if (!state.field) return false;
    makeColors();
    try {
      state.points = new C.PointPrimitiveCollection();
      le.viewer.scene.primitives.add(state.points);
      state.trails = new C.PolylineCollection();
      le.viewer.scene.primitives.add(state.trails);
    } catch (err) {
      console.error('[LEWindParticles] 创建 primitive 失败', err);
      destroyCollections();
      return false;
    }
    for (let i = 0; i < count; i++) {
      state.particles.push(createParticle(i));
    }
    state.count = state.particles.length;
    state.respawns = 0;
    return state.count > 0;
  }

  /* ------------------------------ 主循环 ------------------------------ */

  /** 每个 tick 全量更新所有粒子；尾迹在高密度时隔一个 tick 更新一次（约 10fps），
   *  降低 PolylineCollection 的整表重建次数。 */
  function step() {
    const field = state.field;
    if (!field || !state.running) return;
    const t0 = performance.now();
    const parts = state.particles;
    const dt = state.dt;
    const mpc = field.metersPerCell;
    const updateTrail = state.count > 1600 ? (state.tickCount & 1) === 0 : true;
    let respawned = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const s = sampleField(field, p.rf, p.cf, p.sample);
      if (!s || !isFinite(s.speed) || s.speed < 0.25) {
        if (seedParticle(p, false)) respawned += 1;
        continue;
      }
      // 注意：rf 是“行”索引（向南增大），cf 是“列”索引（向东增大）。
      // 风去向 bearing：0=北、90=东 → 东西分量 sin(bearing) 加到列，南北分量 cos(bearing) 取负加到行。
      p.cf += (s.speed * s.sin * dt) / mpc;
      p.rf += -(s.speed * s.cos * dt) / mpc;
      p.age += 1;
      if (
        p.age > p.life ||
        p.rf < 0 ||
        p.cf < 0 ||
        p.rf > field.nR - 1 ||
        p.cf > field.nC - 1
      ) {
        if (seedParticle(p, false)) respawned += 1;
        continue;
      }
      setParticlePosition(p, s, updateTrail);
    }
    state.respawns += respawned;
    state.updates += 1;
    state.tickCount += 1;
    const ms = performance.now() - t0;
    state.updateMsAvg = state.updateMsAvg ? state.updateMsAvg * 0.9 + ms * 0.1 : ms;
  }

  function onPreRender() {
    if (!state.running) return;
    const now = performance.now();
    if (!state.lastTick) {
      state.lastTick = now;
      return;
    }
    if (now - state.lastTick < TICK_MS) return;
    state.lastTick = now;
    step();
  }

  function onPostRender() {
    if (!state.fpsStart) {
      state.fpsStart = performance.now();
      state.updatesAtWindow = state.updates;
    }
    state.frames += 1;
    const elapsed = performance.now() - state.fpsStart;
    if (elapsed >= 1000) {
      state.fps = (state.frames * 1000) / elapsed;
      state.updateFps = ((state.updates - state.updatesAtWindow) * 1000) / elapsed;
      state.frames = 0;
      state.updatesAtWindow = state.updates;
      state.fpsStart = performance.now();
    }
  }

  function attachLoop() {
    const le = state.le;
    if (!le || !le.viewer) return;
    if (!state.preRender) {
      state.preRender = le.viewer.scene.preRender.addEventListener(onPreRender);
    }
    if (!state.postRender) {
      state.postRender = le.viewer.scene.postRender.addEventListener(onPostRender);
    }
  }

  function detachLoop() {
    if (state.preRender) {
      try {
        state.preRender();
      } catch (err) {
        /* ignore */
      }
      state.preRender = null;
    }
    if (state.postRender) {
      try {
        state.postRender();
      } catch (err) {
        /* ignore */
      }
      state.postRender = null;
    }
    state.lastTick = 0;
    state.fps = 0;
    state.frames = 0;
    state.fpsStart = 0;
  }

  /* --------------------------- 箭头可见性 / 场景同步 --------------------------- */

  function findArrowLayer() {
    const le = state.le;
    if (!le || typeof le.listLayers !== 'function') return null;
    const layers = le.listLayers();
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (!l) continue;
      if (l.id === 'windninja-layer' || l.type === 'wind3d') return l;
    }
    return null;
  }

  function applyArrowVisibility() {
    const show = state.mode !== 'particles';
    const layer = findArrowLayer();
    state.hiddenArrows = !show;
    if (!layer) return show;
    try {
      if (typeof layer.setVisible === 'function' && !!layer.visible !== show) {
        layer.setVisible(show);
      }
    } catch (err) {
      console.warn('[LEWindParticles] 箭头显隐切换失败', err);
    }
    return show;
  }

  function syncField(opts) {
    state.pendingSync = 0;
    if (!state.le) return false;
    const field = buildField();
    if (!field) {
      state.field = null;
      state.fieldKey = '';
      if (state.running) stopInternal(false);
      updateNote('无风场数据');
      return false;
    }
    state.field = field;
    state.fieldKey = fieldKeyOf(field);
    applyArrowVisibility();
    if (state.running) {
      // 场景切换：按新栅格重建粒子，保持运行状态
      recreateKeepingLoop(state.count || densityCount());
    }
    updateNote();
    if (!state.running && (state.autoStart || (opts && opts.start))) {
      state.autoStart = false;
      start();
    }
    return true;
  }

  function scheduleSync(opts) {
    if (state.pendingSync) clearTimeout(state.pendingSync);
    state.pendingSync = setTimeout(() => {
      try {
        syncField(opts);
      } catch (err) {
        console.warn('[LEWindParticles] 风场同步失败', err);
      }
    }, 80);
  }

  function recreateKeepingLoop(count) {
    const wasRunning = state.running;
    destroyCollections();
    if (!wasRunning) return;
    createCollections(count);
    state.lastTick = 0;
    state.tickCount = 0;
    state.cursor = 0;
    state.sliceIndex = 0;
    state.running = state.count > 0;
    updateUI();
  }

  function installHooks() {
    const W = window.LEWindninja;
    if (!W || state.hooksInstalled) return;
    state.hooksInstalled = true;
    const origShow = W.showScene;
    if (typeof origShow === 'function') {
      W.showScene = function () {
        const args = arguments;
        const result = origShow.apply(W, args);
        if (result && typeof result.then === 'function') {
          return result.then(
            (value) => {
              scheduleSync();
              return value;
            },
            (err) => {
              throw err;
            }
          );
        }
        scheduleSync();
        return result;
      };
    }
    const origClear = W.clear;
    if (typeof origClear === 'function') {
      W.clear = function () {
        const result = origClear.apply(W, arguments);
        try {
          state.field = null;
          state.fieldKey = '';
          stopInternal(false);
          updateNote('风场已清除');
        } catch (err) {
          /* ignore */
        }
        return result;
      };
    }
  }

  /* ------------------------------ 启动/停止 ------------------------------ */

  function start(opts) {
    const o = opts || {};
    if (!state.le) return false;
    if (o.mode && ['particles', 'arrows', 'both'].indexOf(o.mode) >= 0) {
      state.mode = o.mode;
    }
    if (o.dt && isFinite(o.dt)) state.dt = Math.max(1, Math.min(120, Number(o.dt)));
    if (o.trailSegments != null) {
      const seg = Math.round(Number(o.trailSegments));
      if (isFinite(seg)) {
        state.trailSegments = Math.max(3, Math.min(6, seg));
        state.trailCustom = true;
      }
    }
    if (o.density != null) applyDensity(o.density);
    if (!state.field) {
      if (!syncField()) {
        if (state.le.toast) {
          state.le.toast('请先加载 Wind3D 风场（?windninja=… 或“Wind3D 目录”）', 'error', 4200);
        }
        return false;
      }
    }
    if (state.running) {
      if (state.mode === 'particles') applyArrowVisibility();
      updateUI();
      return true;
    }
    const count = densityCount();
    if (!createCollections(count)) return false;
    state.running = true;
    state.lastTick = 0;
    state.tickCount = 0;
    state.cursor = 0;
    state.sliceIndex = 0;
    state.updates = 0;
    state.updateFps = 0;
    state.respawns = 0;
    attachLoop();
    applyArrowVisibility();
    updateUI();
    if (typeof state.le.status === 'function') {
      state.le.status(
        '风场粒子：' +
          (state.mode === 'particles' ? '粒子' : state.mode === 'both' ? '粒子+箭头' : '粒子') +
          ' · ' + state.count + ' 个 · 尾迹 ' + state.trailSegments + ' 段'
      );
    }
    return true;
  }

  function stopInternal(update) {
    detachLoop();
    destroyCollections();
    state.running = false;
    state.updates = 0;
    state.updateFps = 0;
    state.updateMsAvg = 0;
    state.cursor = 0;
    state.sliceIndex = 0;
    if (update !== false) {
      updateUI();
      if (state.le && typeof state.le.status === 'function') state.le.status('风场粒子已停止');
    }
  }

  function stop() {
    if (!state.running && !state.points) {
      updateUI();
      return false;
    }
    stopInternal(true);
    if (state.mode === 'particles') {
      // 停止粒子后恢复箭头，避免视图中什么都不剩
      state.mode = 'arrows';
      applyArrowVisibility();
      updateUI();
    }
    return true;
  }

  /* ------------------------------ 密度/模式 ------------------------------ */

  function applyDensity(value) {
    if (typeof value === 'string') {
      const key = value.toLowerCase();
      if (DENSITY[key]) {
        state.densityName = key;
        state.requested = 0;
        if (!state.trailCustom) state.trailSegments = DEFAULT_TRAIL[key] || state.trailSegments;
      } else {
        const n = parseInt(value, 10);
        if (isFinite(n)) state.requested = clampCount(n);
      }
    } else {
      const n = Math.round(Number(value));
      if (isFinite(n)) state.requested = clampCount(n);
    }
    if (state.running) {
      recreateKeepingLoop(densityCount());
    }
    updateUI();
    return densityCount();
  }

  function clampCount(n) {
    return Math.max(100, Math.min(5000, n));
  }

  function setDensity(n) {
    return applyDensity(n);
  }

  function setMode(mode) {
    if (['particles', 'arrows', 'both'].indexOf(mode) < 0) return state.mode;
    state.mode = mode;
    if (mode === 'arrows') {
      if (state.running) stopInternal(false);
      applyArrowVisibility();
      updateUI();
      return state.mode;
    }
    applyArrowVisibility();
    if (!state.running) {
      syncField({ start: true });
    } else {
      updateUI();
    }
    return state.mode;
  }

  /* ------------------------------ UI ------------------------------ */

  function modeLabel() {
    return state.mode === 'particles' ? '粒子' : state.mode === 'both' ? '两者' : '箭头';
  }

  function updateNote(forceText) {
    const note = byId('particle-note');
    if (!note) return;
    if (forceText != null) {
      note.textContent = forceText;
      return;
    }
    if (!state.field) {
      note.textContent = '粒子：等待 Wind3D 风场数据…';
      return;
    }
    const f = state.field;
    let text =
      '粒子 · ' + state.count + ' 个 · 尾迹 ' + state.trailSegments + ' 段 · 风速 ' +
      fmt(f.minSpeed, 1) + '–' + fmt(f.maxSpeed, 1) + ' m/s';
    if (state.running) {
      text += ' · ' + (state.fps > 0 ? fmt(state.fps, 1) : '--') + ' fps';
      if (state.updateMsAvg) text += ' · 更新 ' + fmt(state.updateMsAvg, 2) + ' ms';
    } else {
      text += ' · 已停止';
    }
    note.textContent = text;
  }

  function updateUI() {
    const play = byId('btn-particle-play');
    if (play) {
      play.textContent = state.running ? '停止粒子' : '播放粒子';
      play.classList.toggle('tool-active', state.running);
    }
    const density = byId('particle-density');
    if (density) {
      density.value = state.requested ? 'custom' : state.densityName;
      let custom = density.querySelector('option[value="custom"]');
      if (state.requested) {
        if (!custom) {
          custom = document.createElement('option');
          custom.value = 'custom';
          density.appendChild(custom);
        }
        custom.textContent = '自定义 ' + state.requested;
      } else if (custom) {
        custom.parentNode.removeChild(custom);
      }
    }
    const buttons = document.querySelectorAll('[data-windmode]');
    Array.prototype.forEach.call(buttons, (btn) => {
      btn.classList.toggle('tool-active', btn.getAttribute('data-windmode') === state.mode);
    });
    updateNote();
    updateNote();
  }

  function updateStatsLoop() {
    if (!state.le || state.noteTimer) return;
    state.noteTimer = setInterval(() => {
      if (state.running) updateNote();
    }, 1000);
  }

  /** 轮询 WindNinja 当前场景：覆盖 ?windninja / 目录选择 / 场景切换等所有加载路径
   *  （windninja.js 内部直接调用闭包 showScene，公开 API 包装无法全部覆盖）。 */
  function startWindWatch() {
    if (state.windWatchTimer) return;
    const poll = () => {
      const W = window.LEWindninja;
      if (!W || typeof W.getStats !== 'function') return;
      let stats = null;
      try {
        stats = W.getStats();
      } catch (err) {
        return;
      }
      if (!stats) return;
      const key = [
        stats.label,
        stats.index,
        stats.grid ? stats.grid.ncols + 'x' + stats.grid.nrows : '',
        stats.step,
        stats.arrowCount,
        stats.source,
      ].join('|');
      if (key !== state.windKey) {
        state.windKey = key;
        scheduleSync();
      }
    };
    poll();
    state.windWatchTimer = setInterval(poll, 600);
  }

  function bindUI() {
    if (state.bound) return;
    state.bound = true;
    const buttons = document.querySelectorAll('[data-windmode]');
    Array.prototype.forEach.call(buttons, (btn) => {
      btn.addEventListener('click', () => {
        setMode(btn.getAttribute('data-windmode'));
      });
    });
    const play = byId('btn-particle-play');
    if (play) {
      play.addEventListener('click', () => {
        if (state.running) {
          stop();
        } else {
          // 在仅箭头模式下点击“播放粒子”时切换为“两者”，避免箭头被误隐藏
          if (state.mode === 'arrows') state.mode = 'both';
          start();
        }
      });
    }
    const density = byId('particle-density');
    if (density) {
      density.addEventListener('change', () => {
        applyDensity(density.value);
        if (!state.running && state.field) {
          if (state.mode === 'arrows') state.mode = 'both';
          start();
        }
      });
    }
  }

  /* ------------------------------ URL 参数 ------------------------------ */

  function applyUrlParams() {
    const params = new URLSearchParams(location.search);
    const mode = (params.get('windmode') || '').toLowerCase();
    if (['particles', 'arrows', 'both'].indexOf(mode) >= 0) state.mode = mode;
    const countRaw = params.get('particles');
    if (countRaw != null && countRaw !== '') {
      const n = parseInt(countRaw, 10);
      if (isFinite(n)) state.requested = clampCount(n);
      if (state.mode !== 'both') state.mode = 'particles';
      state.autoStart = true;
    }
    if (state.mode === 'particles' || state.mode === 'both') state.autoStart = true;
  }

  /* ------------------------------ 初始化/API ------------------------------ */

  function init(le) {
    if (state.ready) return true;
    state.le = le || window.LE;
    if (!state.le || !state.le.viewer) return false;
    state.ready = true;
    state.densityName = defaultDensityName();
    state.trailSegments = DEFAULT_TRAIL[state.densityName] || 4;
    installHooks();
    bindUI();
    makeColors();
    applyUrlParams();
    updateUI();
    scheduleSync();
    startWindWatch();
    updateStatsLoop();
    return true;
  }

  function getStats() {
    const f = state.field;
    return {
      supported: true,
      running: state.running,
      mode: state.mode,
      modeLabel: modeLabel(),
      density: state.requested ? state.requested : state.densityName,
      densityName: state.densityName,
      count: state.count,
      requested: densityCount(),
      trailSegments: state.trailSegments,
      dt: state.dt,
      tickMs: TICK_MS,
      fps: state.fps,
      updateFps: state.updateFps,
      updateMs: state.updateMsAvg,
      updates: state.updates,
      respawns: state.respawns,
      hiddenArrows: state.hiddenArrows,
      field: f
        ? {
            label: f.label,
            index: f.index,
            rows: f.nR,
            cols: f.nC,
            step: f.step,
            cell: f.cell,
            minSpeed: f.minSpeed,
            maxSpeed: f.maxSpeed,
            bounds: { west: f.west, south: f.south, east: f.east, north: f.north },
          }
        : null,
    };
  }

  function getFieldInfo() {
    const f = state.field;
    if (!f) return null;
    return {
      label: f.label,
      index: f.index,
      rows: f.nR,
      cols: f.nC,
      step: f.step,
      cell: f.cell,
      metersPerCell: f.metersPerCell,
      points: f.points.length,
      minSpeed: f.minSpeed,
      maxSpeed: f.maxSpeed,
    };
  }

  window.LEWindParticles = {
    init,
    start,
    stop,
    setDensity,
    isRunning: () => state.running,
    getStats,
    setMode,
    getMode: () => state.mode,
    getFieldInfo,
    // 调试辅助
    _state: state,
  };

  document.addEventListener(
    'local-earth-ready',
    () => {
      try {
        init(window.LE);
      } catch (err) {
        console.error('[LEWindParticles] 初始化失败', err);
      }
    },
    { once: true }
  );
})();

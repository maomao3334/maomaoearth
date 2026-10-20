/*
 * 本地地球 Local Earth — P2 垂直风廓线 + 3D 高度切片
 * ---------------------------------------------------------------------------
 * 当 Wind3D 目录包含多个高度场景（…/h050m/…、…/h100m/…、…/h200m/…）时：
 *   - 面板打开后单击地图选点：对每个场景在该点做双线性插值，得到
 *     “高度 (m) — 风速 (m/s)” 曲线（canvas）与各层数值；
 *   - 「3D 高度切片」：把每个高度场景的箭头抬升到 地形高度 + 该层高度 叠加显示，
 *     从而在三维视图中看到不同高度的风场切片；
 *   - 仅在面板打开时启用 LEFT_CLICK 拾取，绘制/测量激活时自动让路，
 *     不与 LEDraw / LETools 冲突。
 *
 * 对外 API：window.LEWindProfile
 *   init(le)
 *   open() / close()
 *   setPoint(lon, lat)
 *   getData()
 *   setSlices(on)
 *   clear()
 *   getScenes() / isOpen() / isSlicesOn()
 *
 * 数据获取：只使用 LEWindninja 公开 API（listScenes / showScene / getExportData），
 * 不修改 js/windninja.js。完全离线。
 */
(function () {
  'use strict';

  const C = window.Cesium;

  const state = {
    le: null,
    ready: false,
    open: false,
    scenes: [],
    sceneKey: '',
    point: null,
    data: null,
    slicesOn: false,
    slicePrimitive: null,
    sliceCount: 0,
    marker: null,
    handler: null,
    collecting: false,
    collectedAt: 0,
  };

  const byId = (id) => document.getElementById(id);

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function fmt(v, digits) {
    if (v == null || !isFinite(v)) return '--';
    return Number(v).toFixed(digits == null ? 1 : digits);
  }

  function toDeg(rad) {
    return (rad * 180) / Math.PI;
  }

  function bins() {
    try {
      const W = window.LEWindninja;
      if (W && typeof W.getLegend === 'function') {
        const b = W.getLegend();
        if (b && b.length) return b;
      }
    } catch (err) {
      /* ignore */
    }
    return [
      { color: '#3a63ff' }, { color: '#29c65a' }, { color: '#ffdb39' },
      { color: '#ff8c1a' }, { color: '#ff3a3a' }, { color: '#ae1414' },
    ];
  }

  function binIndex(speed) {
    const edges = [2.14, 4.3, 6.45, 8.6, 10.76];
    for (let i = 0; i < edges.length; i++) if (speed <= edges[i]) return i;
    return edges.length;
  }

  function heightMetersOf(scene) {
    const text = [scene.height, scene.label, scene.group].filter(Boolean).join(' ');
    const m = /h\s*0*(\d+)\s*m/i.exec(text);
    if (m) return Number(m[1]);
    return null;
  }

  /* --------------------------- 单场景栅格与采样 --------------------------- */

  function buildSamples(scene, data) {
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
    const speed = new Float32Array(size).fill(NaN);
    const sinB = new Float32Array(size).fill(NaN);
    const cosB = new Float32Array(size).fill(NaN);
    const lonN = new Float64Array(size);
    const latN = new Float64Array(size);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const ri = rIndex.get(p.row);
      const ci = cIndex.get(p.col);
      if (ri == null || ci == null) continue;
      const at = ri * nC + ci;
      speed[at] = Number(p.speed);
      const bearing = isFinite(p.bearing) ? Number(p.bearing) : (Number(p.angle) + 180) % 360;
      const rad = (bearing * Math.PI) / 180;
      sinB[at] = Math.sin(rad);
      cosB[at] = Math.cos(rad);
      lonN[at] = Number(p.lon);
      latN[at] = Number(p.lat);
    }
    const heightM = heightMetersOf(scene);
    return {
      index: scene.index,
      label: scene.label || '场景 ' + (scene.index + 1),
      heightText: scene.height || (heightM != null ? 'h' + heightM + 'm' : ''),
      heightM,
      rows,
      cols,
      nR,
      nC,
      speed,
      sinB,
      cosB,
      lonN,
      latN,
      cell: data.stats && data.stats.grid ? Number(data.stats.grid.cellsize) : 200,
      step: Number(data.step) || 1,
      minSpeed: data.stats && data.stats.speed ? data.stats.speed.min : null,
      maxSpeed: data.stats && data.stats.speed ? data.stats.speed.max : null,
      points,
      bins: data.bins || bins(),
    };
  }

  function nodeLon(S, r, c) {
    return S.lonN[r * S.nC + c];
  }

  function nodeLat(S, r, c) {
    return S.latN[r * S.nC + c];
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function bilinear(arr, S, rf, cf) {
    const r0 = clamp(Math.floor(rf), 0, S.nR - 2);
    const c0 = clamp(Math.floor(cf), 0, S.nC - 2);
    const fr = rf - r0;
    const fc = cf - c0;
    const i00 = r0 * S.nC + c0;
    const i10 = i00 + S.nC;
    return (
      arr[i00] * (1 - fr) * (1 - fc) +
      arr[i10] * fr * (1 - fc) +
      arr[i00 + 1] * (1 - fr) * fc +
      arr[i10 + 1] * fr * fc
    );
  }

  function interpolateLonLat(S, rf, cf) {
    return { lon: bilinear(S.lonN, S, rf, cf), lat: bilinear(S.latN, S, rf, cf) };
  }

  function jacobianAt(S, r, cf) {
    const r0 = clamp(Math.round(r), 1, S.nR - 2);
    const c0 = clamp(Math.round(cf), 1, S.nC - 2);
    const dlondc = (nodeLon(S, r0, c0 + 1) - nodeLon(S, r0, c0 - 1)) / 2;
    const dlondr = (nodeLon(S, r0 + 1, c0) - nodeLon(S, r0 - 1, c0)) / 2;
    const dlatdc = (nodeLat(S, r0, c0 + 1) - nodeLat(S, r0, c0 - 1)) / 2;
    const dlatdr = (nodeLat(S, r0 + 1, c0) - nodeLat(S, r0 - 1, c0)) / 2;
    return { dlondc, dlondr, dlatdc, dlatdr };
  }

  /** 经纬度 → 粗栅格分数坐标（局部雅可比迭代，UTM 网格在 20km 内近似仿射）。 */
  function locate(S, lon, lat) {
    let r = (S.nR - 1) / 2;
    let c = (S.nC - 1) / 2;
    for (let iter = 0; iter < 4; iter++) {
      const ll = interpolateLonLat(S, r, c);
      const j = jacobianAt(S, r, c);
      const det = j.dlondc * j.dlatdr - j.dlondr * j.dlatdc;
      if (!isFinite(det) || Math.abs(det) < 1e-18) break;
      const dlon = lon - ll.lon;
      const dlat = lat - ll.lat;
      const dc = (j.dlatdr * dlon - j.dlondr * dlat) / det;
      const dr = (-j.dlatdc * dlon + j.dlondc * dlat) / det;
      c += dc;
      r += dr;
      if (Math.abs(dc) < 1e-4 && Math.abs(dr) < 1e-4) break;
    }
    return { r, c };
  }

  /** 对单场景在 (lon,lat) 处双线性插值 speed / 风向。 */
  function sampleScene(S, lon, lat) {
    const rc = locate(S, lon, lat);
    if (!isFinite(rc.r) || !isFinite(rc.c)) return null;
    if (rc.r < 0 || rc.c < 0 || rc.r > S.nR - 1 || rc.c > S.nC - 1) {
      return { inside: false, speed: null, bearing: null, r: rc.r, c: rc.c };
    }
    const speed = bilinear(S.speed, S, rc.r, rc.c);
    const sin = bilinear(S.sinB, S, rc.r, rc.c);
    const cos = bilinear(S.cosB, S, rc.r, rc.c);
    const bearing = (Math.atan2(sin, cos) * 180) / Math.PI;
    return {
      inside: true,
      speed: isFinite(speed) ? speed : null,
      bearing: ((bearing % 360) + 360) % 360,
      r: rc.r,
      c: rc.c,
    };
  }

  /* --------------------------- 多场景收集 --------------------------- */

  function sceneSignature(list) {
    return list
      .map((s) => [s.index, s.label, s.height, s.timestamp, s.source].join(':'))
      .join('|');
  }

  async function collectScenes(force) {
    const W = window.LEWindninja;
    if (!W || typeof W.listScenes !== 'function') throw new Error('Wind3D 模块未加载');
    const list = W.listScenes();
    if (!list.length) {
      state.scenes = [];
      state.sceneKey = '';
      return [];
    }
    const sig = sceneSignature(list);
    if (!force && state.scenes.length && sig === state.sceneKey) return state.scenes;
    if (state.collecting) return state.scenes;
    state.collecting = true;
    // 暂停粒子，避免多场景切换时反复重建；结束后恢复
    const wp = window.LEWindParticles;
    const wasRunning = !!(wp && typeof wp.isRunning === 'function' && wp.isRunning());
    const savedMode = wp && typeof wp.getMode === 'function' ? wp.getMode() : null;
    if (wasRunning) {
      try {
        wp.stop();
      } catch (err) {
        /* ignore */
      }
    }
    const current = W.getStats() ? W.getStats().index : 0;
    const scenes = [];
    try {
      for (const sc of list) {
        await W.showScene(sc.index, { fly: false });
        const data = W.getExportData();
        if (!data || !Array.isArray(data.points) || data.points.length < 9) continue;
        const S = buildSamples(sc, data);
        if (S) scenes.push(S);
      }
      if (list.length > 1) {
        await W.showScene(clamp(current, 0, list.length - 1), { fly: false });
      }
    } finally {
      state.collecting = false;
      if (wasRunning && wp) {
        try {
          wp.start({ mode: savedMode || undefined });
        } catch (err) {
          /* ignore */
        }
      }
    }
    state.scenes = scenes;
    state.sceneKey = sig;
    state.collectedAt = Date.now();
    return scenes;
  }

  /* --------------------------- 选点与数据 --------------------------- */

  function removeMarker() {
    const le = state.le;
    if (state.marker && le && le.viewer) {
      try {
        le.viewer.entities.remove(state.marker);
      } catch (err) {
        /* ignore */
      }
    }
    state.marker = null;
  }

  function addMarker(lon, lat) {
    const le = state.le;
    if (!le || !le.viewer) return;
    removeMarker();
    try {
      state.marker = le.viewer.entities.add({
        id: 'le-wind-profile-point',
        position: C.Cartesian3.fromDegrees(lon, lat, le.heightAt(lon, lat) + 20),
        point: {
          pixelSize: 10,
          color: C.Color.fromCssColorString('#7ee0c0'),
          outlineColor: C.Color.fromCssColorString('#0b1118'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: '风廓线点',
          font: '12px "Microsoft YaHei", sans-serif',
          fillColor: C.Color.fromCssColorString('#e8eef6'),
          showBackground: true,
          backgroundColor: C.Color.fromCssColorString('#0b1118').withAlpha(0.72),
          pixelOffset: new C.Cartesian2(0, -22),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    } catch (err) {
      console.warn('[LEWindProfile] 标记点创建失败', err);
    }
  }

  function setPoint(lon, lat) {
    if (!isFinite(lon) || !isFinite(lat)) return null;
    state.point = { lon: Number(lon), lat: Number(lat) };
    addMarker(state.point.lon, state.point.lat);
    const data = computeData();
    state.data = data;
    renderPanel(data);
    return data;
  }

  function computeData() {
    const p = state.point;
    if (!p) return null;
    let terrain = 0;
    try {
      if (state.le && typeof state.le.heightAt === 'function') {
        terrain = state.le.heightAt(p.lon, p.lat) || 0;
      }
    } catch (err) {
      terrain = 0;
    }
    const layers = state.scenes.map((S) => {
      const s = sampleScene(S, p.lon, p.lat);
      return {
        index: S.index,
        label: S.label,
        heightText: S.heightText,
        heightM: S.heightM,
        inside: !!(s && s.inside),
        speed: s && s.speed != null ? Number(s.speed) : null,
        bearing: s && s.bearing != null ? Number(s.bearing) : null,
      };
    });
    return {
      point: { lon: p.lon, lat: p.lat, terrain },
      scenes: layers,
      single: layers.length <= 1,
      time: new Date().toISOString(),
    };
  }

  function getData() {
    return state.data ? JSON.parse(JSON.stringify(state.data)) : null;
  }

  /* --------------------------- 3D 高度切片 --------------------------- */

  function destination(lon, lat, bearingDeg, distM) {
    const R = 6378137;
    const br = (bearingDeg * Math.PI) / 180;
    const lat1 = (lat * Math.PI) / 180;
    const lon1 = (lon * Math.PI) / 180;
    const d = distM / R;
    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinD = Math.sin(d);
    const cosD = Math.cos(d);
    const lat2 = Math.asin(sinLat1 * cosD + cosLat1 * sinD * Math.cos(br));
    const lon2 = lon1 + Math.atan2(Math.sin(br) * sinD * cosLat1, cosD - sinLat1 * Math.sin(lat2));
    return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
  }

  function clearSlices() {
    const scene = state.le && state.le.viewer ? state.le.viewer.scene : null;
    if (state.slicePrimitive && scene) {
      try {
        scene.primitives.remove(state.slicePrimitive);
      } catch (err) {
        /* ignore */
      }
    }
    state.slicePrimitive = null;
    state.sliceCount = 0;
  }

  function buildSlices() {
    const le = state.le;
    if (!le || !state.scenes.length) return 0;
    clearSlices();
    const colors = bins().map((b) => C.Color.fromCssColorString(b.color).withAlpha(0.92));
    const materials = colors.map((c) => C.Material.fromType('Color', { color: c }));
    const collection = new C.PolylineCollection();
    let count = 0;
    const perSceneTarget = Math.max(60, Math.floor(900 / state.scenes.length));
    for (let si = 0; si < state.scenes.length; si++) {
      const S = state.scenes[si];
      const stride = Math.max(1, Math.ceil(S.points.length / perSceneTarget));
      const offset = Math.floor(S.step / 2) || 0;
      const length = Math.max(120, (S.cell || 200) * 1.6);
      for (let i = 0; i < S.points.length; i += stride) {
        const p = S.points[i];
        if (!p || !isFinite(p.speed) || p.speed <= 0.1) continue;
        const bearing = isFinite(p.bearing) ? p.bearing : (p.angle + 180) % 360;
        const tail = destination(p.lon, p.lat, (bearing + 180) % 360, length / 2);
        const head = destination(p.lon, p.lat, bearing, length / 2);
        let h = 0;
        try {
          h = le.heightAt(p.lon, p.lat) || 0;
        } catch (err) {
          h = 0;
        }
        const height = h + (S.heightM != null ? S.heightM : offset);
        collection.add({
          positions: [
            C.Cartesian3.fromDegrees(tail[0], tail[1], height + 3),
            C.Cartesian3.fromDegrees(head[0], head[1], height + 3),
          ],
          width: 1.8,
          material: materials[binIndex(p.speed)] || materials[0],
        });
        count += 1;
      }
    }
    le.viewer.scene.primitives.add(collection);
    state.slicePrimitive = collection;
    state.sliceCount = count;
    return count;
  }

  function setSlices(on) {
    state.slicesOn = !!on;
    const checkbox = byId('wp-slices');
    if (checkbox && checkbox.checked !== state.slicesOn) checkbox.checked = state.slicesOn;
    if (!state.slicesOn) {
      clearSlices();
      updateNote();
      return false;
    }
    if (state.scenes.length <= 1) {
      state.slicesOn = false;
      if (checkbox) checkbox.checked = false;
      if (state.le && state.le.toast) {
        state.le.toast('3D 高度切片需要多个高度场景（h050m/h100m/h200m）', 'error', 4200);
      }
      updateNote();
      return false;
    }
    const count = buildSlices();
    updateNote();
    if (state.le && state.le.status) {
      state.le.status('3D 高度切片：' + state.scenes.length + ' 层 · ' + count + ' 个抬升箭头');
    }
    return true;
  }

  /* --------------------------- 面板渲染 --------------------------- */

  function layerColor(index) {
    const palette = ['#7ee0c0', '#3ea6ff', '#ffd93b', '#ff8c1a', '#ff6b6b', '#b48cff'];
    return palette[index % palette.length];
  }

  function drawChart(data) {
    const canvas = byId('wp-canvas');
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(360, canvas.clientWidth || 720);
    const height = Math.max(200, canvas.clientHeight || 260);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0b1118';
    ctx.fillRect(0, 0, width, height);

    const pad = { left: 46, right: 16, top: 18, bottom: 34 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const layers = (data && data.scenes) || [];
    const valid = layers.filter((l) => l.speed != null && isFinite(l.speed));
    if (!valid.length) {
      ctx.fillStyle = '#93a4b8';
      ctx.font = '12.5px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('在地图上单击选择风廓线点…', width / 2, height / 2);
      return;
    }

    let xMin = Infinity;
    let xMax = -Infinity;
    layers.forEach((l) => {
      const x = l.heightM != null ? l.heightM : l.index;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
    });
    if (!(xMax > xMin)) {
      xMin -= 25;
      xMax += 25;
    }
    let yMax = Math.max.apply(null, valid.map((l) => l.speed));
    yMax = Math.max(2, Math.ceil(yMax * 1.18 * 2) / 2);

    const xOf = (l) => {
      const x = l.heightM != null ? l.heightM : l.index;
      return pad.left + ((x - xMin) / (xMax - xMin || 1)) * plotW;
    };
    const yOf = (v) => pad.top + plotH - (v / yMax) * plotH;

    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillStyle = '#93a4b8';
    ctx.textAlign = 'right';
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const v = (yMax * i) / yTicks;
      const y = yOf(v);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillText(v.toFixed(1), pad.left - 8, y + 4);
    }
    ctx.textAlign = 'center';
    layers.forEach((l, i) => {
      const x = xOf(l);
      ctx.fillStyle = '#93a4b8';
      const label = l.heightM != null ? l.heightM + ' m' : l.heightText || '第 ' + (i + 1) + ' 层';
      ctx.fillText(label, x, height - 14);
    });

    // 轴线
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.lineTo(width - pad.right, pad.top + plotH);
    ctx.stroke();

    // 折线
    const pts = layers
      .filter((l) => l.speed != null && isFinite(l.speed))
      .sort((a, b) => (a.heightM != null ? a.heightM : a.index) - (b.heightM != null ? b.heightM : b.index));
    ctx.strokeStyle = '#7ee0c0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((l, i) => {
      const x = xOf(l);
      const y = yOf(l.speed);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 数据点 + 数值
    pts.forEach((l, i) => {
      const x = xOf(l);
      const y = yOf(l.speed);
      ctx.fillStyle = layerColor(i);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8eef6';
      ctx.font = '11.5px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(l.speed.toFixed(2) + ' m/s', x, y - 9);
    });

    // 标题
    ctx.fillStyle = '#93a4b8';
    ctx.font = '11.5px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('风速 (m/s)', 8, 14);
    ctx.textAlign = 'right';
    ctx.fillText('高度 (m)', width - 8, height - 2);
  }

  function renderStats(data) {
    const el = byId('wp-stats');
    if (!el) return;
    if (!data || !data.scenes || !data.scenes.length) {
      el.innerHTML = '<div class="profile-empty">暂无风廓线数据</div>';
      return;
    }
    const rows = data.scenes
      .slice()
      .sort((a, b) => (a.heightM != null ? a.heightM : a.index) - (b.heightM != null ? b.heightM : b.index))
      .map((l) => {
        const name = l.heightM != null ? l.heightM + ' m' : l.heightText || '层 ' + (l.index + 1);
        const speed = l.speed == null ? '--' : fmt(l.speed, 2) + ' m/s';
        const dir = l.bearing == null ? '--' : fmt(l.bearing, 0) + '°';
        return (
          '<div class="profile-stat">' +
          '<span class="profile-stat-label">' + escapeHtml(name) + '</span>' +
          '<span class="profile-stat-value">' + speed + ' · ' + dir + '</span>' +
          '</div>'
        );
      })
      .join('');
    el.innerHTML = rows;
  }

  function updateNote() {
    const note = byId('wp-note');
    if (!note) return;
    const n = state.scenes.length;
    let text = '';
    if (!n) {
      text = '尚未读取到 Wind3D 场景。请先加载风场（?windninja=… 或“Wind3D 目录”，多高度目录含 h050m/h100m/h200m）。';
    } else if (n <= 1) {
      text = '当前只有 1 个高度场景：可查看单点风速，但风廓线与 3D 高度切片需要多高度数据。';
      if (state.point) text += ' 已选点：' + fmt(state.point.lat, 4) + ', ' + fmt(state.point.lon, 4) + '。';
    } else {
      const heights = state.scenes
        .map((s) => (s.heightM != null ? s.heightM + 'm' : s.heightText || '?'))
        .join(' / ');
      text = '已读取 ' + n + ' 个高度场景（' + heights + '）。' +
        (state.point
          ? '已选点：' + fmt(state.point.lat, 4) + ', ' + fmt(state.point.lon, 4) + '。'
          : '打开面板后单击地图选点。');
      if (state.slicesOn) text += ' 3D 高度切片：' + state.sliceCount + ' 个抬升箭头。';
    }
    note.textContent = text;
  }

  function updateBadge(data) {
    const badge = byId('wp-badge');
    if (!badge) return;
    if (!state.scenes.length) {
      badge.textContent = '无场景';
    } else if (data && data.scenes && data.scenes.length) {
      badge.textContent = data.scenes.length + ' 层';
    } else {
      badge.textContent = state.scenes.length + ' 层';
    }
  }

  function renderPanel(data) {
    drawChart(data);
    renderStats(data);
    updateBadge(data);
    updateNote();
  }

  /* --------------------------- 拾取 --------------------------- */

  function enablePick() {
    const le = state.le;
    if (!le || state.handler) return;
    try {
      const handler = new C.ScreenSpaceEventHandler(le.viewer.scene.canvas);
      handler.setInputAction((movement) => {
        if (!state.open) return;
        // 绘制 / 测量优先，不做风廓线拾取
        if (le.state && (le.state.measureActive || le.state.drawActive)) return;
        if (window.LEDraw && typeof window.LEDraw.isActive === 'function' && window.LEDraw.isActive()) return;
        const ray = le.viewer.camera.getPickRay(movement.position);
        const pos = ray ? le.viewer.scene.globe.pick(ray, le.viewer.scene) : null;
        if (!pos) return;
        const carto = C.Cartographic.fromCartesian(pos);
        if (!carto) return;
        setPoint(toDeg(carto.longitude), toDeg(carto.latitude));
      }, C.ScreenSpaceEventType.LEFT_CLICK);
      state.handler = handler;
    } catch (err) {
      console.warn('[LEWindProfile] 拾取监听创建失败', err);
    }
  }

  function disablePick() {
    if (state.handler) {
      try {
        state.handler.destroy();
      } catch (err) {
        /* ignore */
      }
      state.handler = null;
    }
  }

  /* --------------------------- 面板开关 --------------------------- */

  async function open() {
    const panel = byId('wind-profile-panel');
    if (!panel) return false;
    state.open = true;
    panel.classList.remove('hidden');
    enablePick();
    let scenes = state.scenes;
    try {
      scenes = await collectScenes(false);
    } catch (err) {
      console.warn('[LEWindProfile] 读取多高度场景失败', err);
      scenes = [];
    }
    if (!scenes.length) {
      state.data = null;
      drawChart(null);
      renderStats(null);
      updateBadge(null);
      updateNote();
      return false;
    }
    if (state.point) {
      state.data = computeData();
    }
    renderPanel(state.data);
    return true;
  }

  function close() {
    const panel = byId('wind-profile-panel');
    if (panel) panel.classList.add('hidden');
    state.open = false;
    state.handler && disablePick();
    return true;
  }

  function clear() {
    state.point = null;
    state.data = null;
    removeMarker();
    renderPanel(null);
    if (state.le && state.le.status) state.le.status('已清除风廓线选点');
    return true;
  }

  function refresh() {
    return open();
  }

  /* --------------------------- UI 绑定 --------------------------- */

  function bindUI() {
    const openBtn = byId('btn-wind-profile');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        const panel = byId('wind-profile-panel');
        if (panel && !panel.classList.contains('hidden')) close();
        else open();
      });
    }
    const closeBtn = byId('wp-close');
    if (closeBtn) closeBtn.addEventListener('click', close);
    const refreshBtn = byId('wp-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        collectScenes(true)
          .then(() => {
            if (state.point) state.data = computeData();
            renderPanel(state.data);
            if (state.slicesOn) setSlices(true);
          })
          .catch((err) => {
            console.warn('[LEWindProfile] 刷新失败', err);
            if (state.le && state.le.toast) state.le.toast('刷新失败：' + err.message, 'error', 4000);
          });
      });
    }
    const clearBtn = byId('wp-clear');
    if (clearBtn) clearBtn.addEventListener('click', clear);
    const slices = byId('wp-slices');
    if (slices) {
      slices.addEventListener('change', () => {
        if (slices.checked && !state.open) {
          // 允许从面板外打开切片：先确保场景数据
          collectScenes(false)
            .then(() => setSlices(true))
            .catch(() => setSlices(false));
        } else {
          setSlices(slices.checked);
        }
      });
    }
  }

  /* --------------------------- 初始化 / API --------------------------- */

  function init(le) {
    if (state.ready) return true;
    state.le = le || window.LE;
    if (!state.le || !state.le.viewer) return false;
    state.ready = true;
    bindUI();
    updateNote();
    const slices = byId('wp-slices');
    if (slices) slices.checked = false;
    return true;
  }

  window.LEWindProfile = {
    init,
    open,
    close,
    setPoint(lon, lat) {
      if (!state.scenes.length) {
        // 面板尚未打开时也允许：后台读取场景
        collectScenes(false)
          .then(() => setPoint(lon, lat))
          .catch((err) => console.warn('[LEWindProfile] 场景读取失败', err));
        return null;
      }
      return setPoint(lon, lat);
    },
    getData,
    setSlices,
    clear,
    refresh,
    isOpen: () => state.open,
    isSlicesOn: () => state.slicesOn,
    getScenes: () =>
      state.scenes.map((s) => ({
        index: s.index,
        label: s.label,
        heightM: s.heightM,
        heightText: s.heightText,
        rows: s.nR,
        cols: s.nC,
        points: s.points.length,
      })),
    getSliceCount: () => state.sliceCount,
  };

  document.addEventListener(
    'local-earth-ready',
    () => {
      try {
        init(window.LE);
      } catch (err) {
        console.error('[LEWindProfile] 初始化失败', err);
      }
    },
    { once: true }
  );
})();

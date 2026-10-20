/*
 * 高程剖面（P1）
 * - 选择一条已绘制线（LEDraw）或最近的测量线（viewer.entities 里的非绘制 polyline）
 * - 沿测地线按 100–300 个采样点用 LE.heightAt(lon,lat) 取高程（未开地形时为 0）
 * - canvas 画剖面：x = 距离 km，y = 海拔 m；显示起点/终点/最低/最高/累计爬升；可导出 PNG
 *
 * 对外 API：window.LEProfile
 *   init(le) / open() / openForLine(points, name?) / close() / getLast()
 *   refresh() / getCandidates() / exportPNG({download}) / getCanvasDataURL()
 */
(function () {
  'use strict';

  const C = window.Cesium;
  const SAMPLE_MIN = 100;
  const SAMPLE_MAX = 300;

  const state = {
    le: null,
    bound: false,
    open: false,
    candidates: [],
    last: null,
    drawing: false,
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function getLE() {
    return state.le || window.LE;
  }

  function viewerOf() {
    const le = getLE();
    return le && le.viewer ? le.viewer : null;
  }

  function heightAt(lon, lat) {
    const le = getLE();
    try {
      if (le && typeof le.heightAt === 'function') return Number(le.heightAt(lon, lat)) || 0;
    } catch (err) {
      return 0;
    }
    return 0;
  }

  /* ---------------------------- 候选线收集 ---------------------------- */

  function normalizePoints(points) {
    const out = [];
    for (const p of points || []) {
      if (Array.isArray(p)) {
        const lon = Number(p[0]);
        const lat = Number(p[1]);
        if (isFinite(lon) && isFinite(lat)) out.push({ lon: lon, lat: lat });
      } else if (p && typeof p === 'object') {
        const lon = Number(p.lon != null ? p.lon : p.longitude);
        const lat = Number(p.lat != null ? p.lat : p.latitude);
        if (isFinite(lon) && isFinite(lat)) out.push({ lon: lon, lat: lat });
      }
    }
    return out;
  }

  function measurementLines() {
    const viewer = viewerOf();
    const out = [];
    if (!viewer) return out;
    try {
      const values = viewer.entities.values;
      for (const entity of values) {
        if (!entity || entity.__leDraw) continue;
        if (!entity.polyline) continue;
        let positions = null;
        const prop = entity.polyline.positions;
        try {
          positions = prop && typeof prop.getValue === 'function' ? prop.getValue(C.JulianDate.now()) : prop;
        } catch (err) {
          positions = null;
        }
        if (!Array.isArray(positions) || positions.length < 2) continue;
        const points = [];
        for (const pos of positions) {
          try {
            const carto = C.Cartographic.fromCartesian(pos);
            if (!carto) continue;
            points.push({
              lon: C.Math.toDegrees(carto.longitude),
              lat: C.Math.toDegrees(carto.latitude),
            });
          } catch (err) {
            /* ignore */
          }
        }
        if (points.length >= 2) {
          out.push({ id: 'measure:' + out.length, name: '测量线 ' + (out.length + 1), points: points, source: 'measure' });
        }
      }
    } catch (err) {
      console.warn('[LEProfile] 读取测量线失败', err);
    }
    return out;
  }

  function getCandidates() {
    const out = [];
    try {
      if (window.LEDraw && typeof window.LEDraw.getFeatures === 'function') {
        for (const feature of window.LEDraw.getFeatures()) {
          if (feature.type !== 'line') continue;
          out.push({
            id: 'draw:' + feature.id,
            name: feature.name + '（绘制线）',
            points: normalizePoints(feature.points),
            source: 'draw',
          });
        }
      }
    } catch (err) {
      console.warn('[LEProfile] 读取绘制线失败', err);
    }
    out.push.apply(out, measurementLines());
    state.candidates = out;
    return out;
  }

  /* ------------------------------ 采样计算 ------------------------------ */

  function buildProfile(points, name, sampleCount) {
    const pts = normalizePoints(points);
    if (pts.length < 2) throw new Error('剖面至少需要 2 个点');
    const cartos = pts.map((p) => C.Cartographic.fromDegrees(p.lon, p.lat));
    const segs = [];
    let total = 0;
    for (let i = 1; i < cartos.length; i++) {
      let d = 0;
      try {
        const geo = new C.EllipsoidGeodesic(cartos[i - 1], cartos[i]);
        d = geo.surfaceDistance;
        segs.push({ geo: geo, start: total, d: d, a: cartos[i - 1], b: cartos[i] });
      } catch (err) {
        segs.push({ geo: null, start: total, d: 0, a: cartos[i - 1], b: cartos[i] });
      }
      total += d;
    }
    const totalKm = total / 1000;
    let n = sampleCount;
    if (!n) {
      n = Math.round(total / 25) + 100;
      n = Math.max(SAMPLE_MIN, Math.min(SAMPLE_MAX, n));
    }
    n = Math.max(2, Math.min(SAMPLE_MAX, Math.round(n)));

    const samples = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      const target = t * total;
      let lon = pts[0].lon;
      let lat = pts[0].lat;
      if (segs.length) {
        let seg = segs[segs.length - 1];
        for (let s = 0; s < segs.length; s++) {
          if (target <= segs[s].start + segs[s].d || s === segs.length - 1) {
            seg = segs[s];
            break;
          }
        }
        if (seg && seg.geo && seg.d > 0) {
          const localT = Math.max(0, Math.min(1, (target - seg.start) / seg.d));
          try {
            const carto = seg.geo.interpolateUsingFraction(localT);
            lon = C.Math.toDegrees(carto.longitude);
            lat = C.Math.toDegrees(carto.latitude);
          } catch (err) {
            /* 保持上一个插值 */
          }
        }
      }
      samples.push({
        distanceM: target,
        lon: lon,
        lat: lat,
        height: heightAt(lon, lat),
      });
    }

    let min = Infinity;
    let max = -Infinity;
    let minIndex = 0;
    let maxIndex = 0;
    let climb = 0;
    let descent = 0;
    for (let i = 0; i < samples.length; i++) {
      const h = samples[i].height;
      if (h < min) {
        min = h;
        minIndex = i;
      }
      if (h > max) {
        max = h;
        maxIndex = i;
      }
      if (i > 0) {
        const dh = h - samples[i - 1].height;
        if (dh > 0) climb += dh;
        else descent -= dh;
      }
    }
    const flat = Math.max(...samples.map((s) => Math.abs(s.height))) < 1e-6;
    const profile = {
      name: name || '剖面线',
      sampleCount: samples.length,
      totalMeters: total,
      totalKm: totalKm,
      minHeight: min,
      maxHeight: max,
      minIndex: minIndex,
      maxIndex: maxIndex,
      startHeight: samples[0].height,
      endHeight: samples[samples.length - 1].height,
      climbMeters: climb,
      descentMeters: descent,
      reliefMeters: max - min,
      flat: flat,
      terrainEnabled: !!(window.LETerrain && window.LETerrain.isEnabled && window.LETerrain.isEnabled()),
      samples: samples,
      generatedAt: new Date().toISOString(),
    };
    return profile;
  }

  /* ------------------------------ 画图 ------------------------------ */

  function cssSize(canvas) {
    return {
      width: Math.max(360, canvas.clientWidth || 720),
      height: Math.max(200, canvas.clientHeight || 260),
    };
  }

  function drawChart(canvas, profile) {
    if (!canvas) return null;
    const dpr = window.devicePixelRatio || 1;
    const size = cssSize(canvas);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = size.width;
    const H = size.height;
    const pad = { left: 58, right: 18, top: 34, bottom: 36 };
    const plotW = Math.max(10, W - pad.left - pad.right);
    const plotH = Math.max(10, H - pad.top - pad.bottom);

    ctx.fillStyle = '#0b1118';
    ctx.fillRect(0, 0, W, H);

    const samples = profile.samples;
    let minY = profile.minHeight;
    let maxY = profile.maxHeight;
    if (!isFinite(minY) || !isFinite(maxY)) {
      minY = 0;
      maxY = 1;
    }
    if (true) {
      const span = maxY - minY;
      const padY = span > 0 ? span * 0.12 : 10;
      minY -= padY;
      maxY += padY;
    }
    const totalKm = Math.max(profile.totalKm, 0.001);

    const xOf = (km) => pad.left + (km / totalKm) * plotW;
    const yOf = (h) => pad.top + (1 - (h - minY) / (maxY - minY || 1)) * plotH;

    // 网格
    ctx.strokeStyle = 'rgba(147,164,184,0.18)';
    ctx.fillStyle = '#93a4b8';
    ctx.lineWidth = 1;
    ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const h = minY + ((maxY - minY) * i) / yTicks;
      const y = yOf(h);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillText(Math.round(h) + ' m', pad.left - 8, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xTicks = 5;
    for (let i = 0; i <= xTicks; i++) {
      const km = (totalKm * i) / xTicks;
      const x = xOf(km);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + plotH);
      ctx.stroke();
      ctx.fillText(km.toFixed(km >= 10 ? 1 : 2) + ' km', x, pad.top + plotH + 8);
    }

    // 面积 + 折线
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
    gradient.addColorStop(0, 'rgba(126,224,192,0.42)');
    gradient.addColorStop(1, 'rgba(62,166,255,0.05)');
    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const x = xOf(s.distanceM / 1000);
      const y = yOf(s.height);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(xOf(profile.totalKm), pad.top + plotH);
    ctx.lineTo(xOf(0), pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const x = xOf(s.distanceM / 1000);
      const y = yOf(s.height);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#7ee0c0';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 最低/最高标记
    const mark = (s, color, label) => {
      if (!s) return;
      const x = xOf(s.distanceM / 1000);
      const y = yOf(s.height);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = color;
      ctx.textAlign = x > pad.left + plotW * 0.75 ? 'right' : 'left';
      ctx.textBaseline = 'bottom';
      const dx = x > pad.left + plotW * 0.75 ? -8 : 8;
      ctx.fillText(label + ' ' + Math.round(s.height) + ' m', x + dx, y - 5);
    };
    mark(samples[profile.minIndex], '#3ea6ff', '最低');
    mark(samples[profile.maxIndex], '#ffd93b', '最高');

    // 标题 / 说明
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8eef6';
    ctx.font = '600 13px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText('高程剖面 · ' + profile.name, pad.left, 16);
    ctx.fillStyle = '#93a4b8';
    ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
    const info =
      '长度 ' + profile.totalKm.toFixed(2) + ' km · 最低 ' + Math.round(profile.minHeight) +
      ' m · 最高 ' + Math.round(profile.maxHeight) + ' m · 累计爬升 ' + Math.round(profile.climbMeters) +
      ' m · 采样 ' + profile.sampleCount;
    ctx.textAlign = 'right';
    ctx.fillText(info, pad.left + plotW, 16);
    if (profile.flat) {
      ctx.fillStyle = '#ffb454';
      ctx.textAlign = 'left';
      ctx.fillText('未开启 3D 地形（LE.heightAt 返回 0），开启地形后重试可见真实起伏', pad.left, pad.top - 12);
    }
    return { width: W, height: H };
  }

  function updateStats(profile) {
    const el = byId('profile-stats');
    if (!el) return;
    const rows = [
      ['起点', Math.round(profile.startHeight) + ' m'],
      ['终点', Math.round(profile.endHeight) + ' m'],
      ['最低', Math.round(profile.minHeight) + ' m'],
      ['最高', Math.round(profile.maxHeight) + ' m'],
      ['累计爬升', Math.round(profile.climbMeters) + ' m'],
      ['累计下降', Math.round(profile.descentMeters) + ' m'],
      ['长度', profile.totalKm.toFixed(2) + ' km'],
      ['采样点', String(profile.sampleCount)],
    ];
    el.innerHTML = '';
    for (const row of rows) {
      const item = document.createElement('div');
      item.className = 'profile-stat';
      const label = document.createElement('span');
      label.className = 'profile-stat-label';
      label.textContent = row[0];
      const value = document.createElement('span');
      value.className = 'profile-stat-value';
      value.textContent = row[1];
      item.appendChild(label);
      item.appendChild(value);
      el.appendChild(item);
    }
    const note = byId('profile-note');
    if (note) {
      note.textContent = profile.terrainEnabled
        ? '高程来自本地 3D 地形（含「地形夸张」系数）；采样点为测地线等距插值。'
        : '未开启 3D 地形：LE.heightAt 返回 0，图为平面；可在侧栏开启「3D 地形」后点「刷新」。';
    }
  }

  /* ------------------------------ 面板控制 ------------------------------ */

  function populateSelect(selectedId) {
    const select = byId('profile-line-select');
    if (!select) return;
    select.innerHTML = '';
    for (const candidate of state.candidates) {
      const option = document.createElement('option');
      option.value = candidate.id;
      option.textContent = candidate.name + ' · ' + candidate.points.length + ' 点';
      select.appendChild(option);
    }
    if (selectedId) select.value = selectedId;
    if (!state.candidates.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '暂无可剖面的线（先绘制一条线）';
      select.appendChild(option);
    }
  }

  function render(profile) {
    const canvas = byId('profile-canvas');
    let size = null;
    if (profile && canvas) {
      size = drawChart(canvas, profile);
      updateStats(profile);
    }
    return size;
  }

  function openForLine(points, name) {
    const panel = byId('profile-panel');
    if (!panel) return null;
    const pts = normalizePoints(points);
    if (pts.length < 2) {
      const le = getLE();
      if (le && le.toast) le.toast('剖面需要至少 2 个点的线（先绘制一条线或做一次测距）', 'error', 4000);
      return null;
    }
    panel.classList.remove('hidden');
    state.open = true;
    getCandidates();
    let matched = null;
    // 如果传入的是候选线，自动选中
    for (const candidate of state.candidates) {
      if (candidate.points.length === pts.length) {
        let same = true;
        for (let i = 0; i < pts.length; i++) {
          if (Math.abs(candidate.points[i].lon - pts[i].lon) > 1e-9 || Math.abs(candidate.points[i].lat - pts[i].lat) > 1e-9) {
            same = false;
            break;
          }
        }
        if (same) {
          matched = candidate.id;
          break;
        }
      }
    }
    populateSelect(matched);
    let profile = null;
    try {
      profile = buildProfile(pts, name);
    } catch (err) {
      const le = getLE();
      if (le && le.toast) le.toast('剖面计算失败：' + (err && err.message ? err.message : err), 'error', 4200);
      return null;
    }
    state.last = profile;
    requestAnimationFrame(() => {
      render(profile);
    });
    return profile;
  }

  function open() {
    const panel = byId('profile-panel');
    if (!panel) return null;
    const candidates = getCandidates();
    if (!candidates.length) {
      panel.classList.remove('hidden');
      state.open = true;
      populateSelect(null);
      const el = byId('profile-stats');
      if (el) el.innerHTML = '<div class="profile-empty">暂无可剖面的线：先用「绘制」画一条线，或做一次「测距」。</div>';
      const canvas = byId('profile-canvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const size = cssSize(canvas);
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(size.width * dpr);
        canvas.height = Math.round(size.height * dpr);
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = '#0b1118';
          ctx.fillRect(0, 0, size.width, size.height);
          ctx.fillStyle = '#93a4b8';
          ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
          ctx.fillText('暂无可剖面的线', size.width / 2 - 50, size.height / 2);
        }
      }
      return null;
    }
    const last = candidates[candidates.length - 1];
    return openForLine(last.points, last.name);
  }

  function close() {
    const panel = byId('profile-panel');
    if (panel) panel.classList.add('hidden');
    state.open = false;
    return true;
  }

  function refresh() {
    const select = byId('profile-line-select');
    const id = select ? select.value : null;
    const candidates = getCandidates();
    populateSelect(id);
    let candidate = null;
    for (const c of candidates) {
      if (c.id === id) {
        candidate = c;
        break;
      }
    }
    if (!candidate) candidate = candidates[candidates.length - 1];
    if (!candidate) return null;
    return openForLine(candidate.points, candidate.name);
  }

  function getLast() {
    const last = state.last;
    if (!last) return null;
    return {
      name: last.name,
      sampleCount: last.sampleCount,
      totalKm: last.totalKm,
      totalMeters: last.totalMeters,
      minHeight: last.minHeight,
      maxHeight: last.maxHeight,
      startHeight: last.startHeight,
      endHeight: last.endHeight,
      climbMeters: last.climbMeters,
      descentMeters: last.descentMeters,
      reliefMeters: last.reliefMeters,
      flat: last.flat,
      terrainEnabled: last.terrainEnabled,
      generatedAt: last.generatedAt,
      samples: last.samples,
    };
  }

  function getCanvasDataURL() {
    const canvas = byId('profile-canvas');
    if (!canvas) return null;
    try {
      return canvas.toDataURL('image/png');
    } catch (err) {
      return null;
    }
  }

  function exportPNG(opts) {
    const options = opts || {};
    const canvas = byId('profile-canvas');
    if (!canvas || !state.last) return null;
    // 确保按当前尺寸重绘，导出内容与面板一致
    render(state.last);
    let dataURL = null;
    try {
      dataURL = canvas.toDataURL('image/png');
    } catch (err) {
      console.warn('[LEProfile] 导出 PNG 失败', err);
      return null;
    }
    const bytes = Math.round((dataURL.length - dataURL.indexOf(',') - 1) * 0.75);
    if (options.download !== false) {
      try {
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = 'local-earth-profile-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 1000);
        const le = getLE();
        if (le && le.toast) le.toast('剖面 PNG 已导出（' + canvas.width + '×' + canvas.height + '）', 'ok', 3000);
      } catch (err) {
        console.warn('[LEProfile] 触发下载失败', err);
      }
    }
    return {
      dataURL: dataURL,
      bytes: bytes,
      width: canvas.width,
      height: canvas.height,
      name: state.last.name,
      sampleCount: state.last.sampleCount,
    };
  }

  /* ------------------------------ 绑定/初始化 ------------------------------ */

  function bindUI() {
    if (state.bound) return;
    state.bound = true;
    const openBtn = byId('btn-profile');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        const last = window.LEDraw && window.LEDraw.list ? window.LEDraw.list() : [];
        const lines = last.filter((f) => f.type === 'line');
        if (state.open) {
          refresh();
        } else if (lines.length || (window.LEDraw && window.LEDraw.getFeatures)) {
          open();
        } else {
          open();
        }
      });
    }
    const closeBtn = byId('profile-close');
    if (closeBtn) closeBtn.addEventListener('click', () => close());
    const refreshBtn = byId('profile-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => refresh());
    const exportBtn = byId('profile-export-png');
    if (exportBtn) exportBtn.addEventListener('click', () => exportPNG({ download: true }));
    const select = byId('profile-line-select');
    if (select) {
      select.addEventListener('change', () => {
        const id = select.value;
        const candidate = state.candidates.find((c) => c.id === id);
        if (candidate) openForLine(candidate.points, candidate.name);
      });
    }
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && state.open) close();
    });
  }

  function init(le) {
    state.le = le || window.LE;
    bindUI();
    return getCandidates();
  }

  window.LEProfile = {
    init,
    open,
    openForLine,
    close,
    refresh,
    getLast,
    getCandidates,
    exportPNG,
    getCanvasDataURL,
    sampleCountRange: [SAMPLE_MIN, SAMPLE_MAX],
    buildProfile: (points, name) => buildProfile(points, name),
  };

  // 模块自行初始化
  if (window.LE && window.LE.viewer) {
    init(window.LE);
  } else {
    document.addEventListener('local-earth-ready', (ev) => init((ev && ev.detail) || window.LE), { once: true });
  }
})();

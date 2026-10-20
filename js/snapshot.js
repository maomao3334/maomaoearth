/*
 * 本地地球 Local Earth — P2 HTML 快照与分享链接
 * ---------------------------------------------------------------------------
 *  - 导出单文件 HTML 快照：内嵌当前视图截图（PNG dataURL，复用 LEExport.png）、
 *    标题、时间、相机坐标、地形/影像/图层列表、数据来源与版权、Wind3D 统计、
 *    粒子统计；不引用任何外部资源，可在任意浏览器离线打开。
 *  - 复制分享链接：包含 cam / exag / terrain / imagery / windninja / perf /
 *    windmode / particles / lighting 等参数；同时把 ?terrain、?imagery 应用到当前会话，
 *    使分享链接能恢复地形/影像开关。
 *
 * 对外 API：window.LESnapshot
 *   init(le)
 *   html(opts)            -> Promise<string>           完整单文件 HTML
 *   downloadHtml(opts)    -> Promise<{filename,bytes,html}>
 *   shareLink()           -> string
 *   copyShare()           -> Promise<string|null>
 *   getLast()             -> 最近一次快照/分享记录
 *   capture(opts)         -> Promise<{dataUrl,width,height,bytes}>
 *
 * opts: {title, download?, includeLayers?, includeWind?}
 * 完全离线：不访问网络、不引用 CDN/字体/脚本。
 */
(function () {
  'use strict';

  const C = window.Cesium;
  const state = { le: null, ready: false, bound: false, last: null, busy: false };

  const byId = (id) => document.getElementById(id);

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function fmt(v, digits) {
    if (v == null || !isFinite(v)) return '--';
    return Number(v).toFixed(digits == null ? 2 : digits);
  }

  function nowStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function nowText() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '年' + p(d.getMonth() + 1) + '月' + p(d.getDate()) + '日 ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 2000);
  }

  /* ------------------------------ 截图 ------------------------------ */

  /** 复用 js/exporter.js 的 LEExport.png({download:false})；失败时用 postRender 直接读回。 */
  async function capture(opts) {
    const o = opts || {};
    const le = state.le;
    if (!le || !le.viewer) throw new Error('应用尚未就绪');
    const E = window.LEExport;
    if (E && typeof E.png === 'function') {
      const shot = await E.png({ download: false, title: o.title || undefined });
      if (shot && shot.dataUrl && shot.dataUrl.indexOf('data:image/png') === 0) {
        return {
          dataUrl: shot.dataUrl,
          width: shot.width,
          height: shot.height,
          bytes: shot.bytes,
          via: 'LEExport.png',
        };
      }
    }
    // 兜底：在 postRender 内直接读回 WebGL 画布
    return new Promise((resolve, reject) => {
      const scene = le.viewer.scene;
      let settled = false;
      const handler = () => {
        if (settled) return;
        settled = true;
        try {
          scene.postRender.removeEventListener(handler);
        } catch (err) {
          /* ignore */
        }
        try {
          const src = scene.canvas;
          const out = document.createElement('canvas');
          out.width = src.width;
          out.height = src.height;
          out.getContext('2d').drawImage(src, 0, 0);
          const dataUrl = out.toDataURL('image/png');
          if (!dataUrl || dataUrl.length < 2000) throw new Error('截图 dataURL 为空');
          resolve({
            dataUrl,
            width: out.width,
            height: out.height,
            bytes: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75),
            via: 'postRender-fallback',
          });
        } catch (err) {
          reject(err);
        }
      };
      scene.postRender.addEventListener(handler);
      setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            scene.postRender.removeEventListener(handler);
          } catch (err) {
            /* ignore */
          }
          reject(new Error('截图超时'));
        }
      }, 4000);
    });
  }

  /* ------------------------------ 元数据 ------------------------------ */

  function cameraMeta() {
    const le = state.le;
    if (!le || !le.viewer) return null;
    const cam = le.viewer.camera;
    const carto = cam.positionCartographic;
    if (!carto) return null;
    return {
      lon: C.Math.toDegrees(carto.longitude),
      lat: C.Math.toDegrees(carto.latitude),
      height: carto.height,
      heading: C.Math.toDegrees(cam.heading),
      pitch: C.Math.toDegrees(cam.pitch),
    };
  }

  function terrainMeta() {
    const T = window.LETerrain;
    return {
      enabled: !!(T && typeof T.isEnabled === 'function' && T.isEnabled()),
      exaggeration: T && typeof T.getExaggeration === 'function'
        ? Number(T.getExaggeration())
        : 1,
      imagery: !!(T && typeof T.isImageryEnabled === 'function' && T.isImageryEnabled()),
    };
  }

  function lightingMeta() {
    const L = window.LELighting;
    if (!L || typeof L.getState !== 'function') return null;
    try {
      const s = L.getState();
      if (!s || !s.enabled) return null;
      return {
        enabled: true,
        utc: s.utc,
        local: s.local,
        sunAzimuth: s.sun ? s.sun.azimuthDeg : null,
        sunAltitude: s.sun ? s.sun.altitudeDeg : null,
        shadowEnhance: !!s.shadowEnhance,
      };
    } catch (err) {
      return null;
    }
  }

  function layersMeta() {
    const le = state.le;
    if (!le || typeof le.listLayers !== 'function') return [];
    return le.listLayers().map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      visible: l.visible !== false,
    }));
  }

  function windMeta() {
    const W = window.LEWindninja;
    if (!W) return null;
    let stats = null;
    let project = null;
    try {
      stats = typeof W.getStats === 'function' ? W.getStats() : null;
    } catch (err) {
      stats = null;
    }
    try {
      project = typeof W.getProjectState === 'function' ? W.getProjectState() : null;
    } catch (err) {
      project = null;
    }
    if (!stats) return null;
    return {
      label: stats.label,
      file: stats.file,
      source: stats.source,
      sourceUrl: project && project.source === 'url' ? project.velUrl : null,
      grid: stats.grid,
      speed: stats.speed,
      step: stats.step,
      arrowCount: stats.arrowCount,
      scenes: stats.scenes,
      index: stats.index,
      warnings: (stats.warnings || []).slice(0, 5),
    };
  }

  function particlesMeta() {
    const P = window.LEWindParticles;
    if (!P || typeof P.getStats !== 'function') return null;
    try {
      return P.getStats();
    } catch (err) {
      return null;
    }
  }

  function collectMeta(opts) {
    const o = opts || {};
    return {
      title: o.title || '本地地球 · 三维风场快照',
      time: nowText(),
      iso: new Date().toISOString(),
      camera: cameraMeta(),
      terrain: terrainMeta(),
      lighting: lightingMeta(),
      layers: o.includeLayers === false ? [] : layersMeta(),
      wind: o.includeWind === false ? null : windMeta(),
      particles: o.includeWind === false ? null : particlesMeta(),
      version: window.MaoMaoEarth ? window.MaoMaoEarth.version : '0.2.0',
      cesium: C && C.VERSION ? C.VERSION : '1.146',
      userAgent: navigator.userAgent,
    };
  }

  /* ------------------------------ HTML 生成 ------------------------------ */

  function windRows(wind) {
    if (!wind) return '<tr><td>Wind3D</td><td>未加载风场</td></tr>';
    const speed = wind.speed
      ? fmt(wind.speed.min, 2) + ' – ' + fmt(wind.speed.max, 2) + ' m/s（均值 ' + fmt(wind.speed.mean, 2) + '）'
      : '--';
    const grid = wind.grid
      ? wind.grid.ncols + ' × ' + wind.grid.nrows + ' 格 / ' + fmt(wind.grid.cellsize, 0) + ' m'
      : '--';
    return (
      '<tr><td>Wind3D 场景</td><td>' + esc(wind.label || '--') + '</td></tr>' +
      '<tr><td>风场网格</td><td>' + esc(grid) + '</td></tr>' +
      '<tr><td>风速范围</td><td>' + esc(speed) + '</td></tr>' +
      '<tr><td>箭头数量</td><td>' + esc(String(wind.arrowCount == null ? '--' : wind.arrowCount)) +
      '（抽稀步长 ' + esc(String(wind.step == null ? '--' : wind.step)) + ' 格）</td></tr>' +
      '<tr><td>场景数</td><td>' + esc(String(wind.scenes == null ? '--' : wind.scenes)) + '</td></tr>' +
      (wind.sourceUrl ? '<tr><td>数据来源</td><td class="mono">' + esc(wind.sourceUrl) + '</td></tr>' : '')
    );
  }

  function particleRows(p) {
    if (!p || !p.running) return '<tr><td>风场粒子</td><td>未运行</td></tr>';
    return (
      '<tr><td>风场粒子</td><td>' + esc(String(p.count)) + ' 个 · 尾迹 ' +
      esc(String(p.trailSegments)) + ' 段 · ' + esc(fmt(p.fps, 1)) + ' fps · 更新 ' +
      esc(fmt(p.updateMs, 2)) + ' ms</td></tr>'
    );
  }

  function layerRows(layers) {
    if (!layers || !layers.length) return '<tr><td>图层</td><td>暂无</td></tr>';
    return layers
      .map(
        (l) =>
          '<tr><td>' + esc(l.name || l.id) + '</td><td>' +
          esc(l.type || '--') + ' · ' + (l.visible ? '显示' : '隐藏') + '</td></tr>'
      )
      .join('');
  }

  function buildHtml(shot, meta) {
    const cam = meta.camera;
    const t = meta.terrain;
    const camText = cam
      ? '经度 ' + fmt(cam.lon, 6) + '　纬度 ' + fmt(cam.lat, 6) + '　高度 ' +
        fmt(cam.height, 0) + ' m　方位 ' + fmt(cam.heading, 1) + '°　俯仰 ' + fmt(cam.pitch, 1) + '°'
      : '--';
    const lightText = meta.lighting
      ? '开（' + esc(meta.lighting.utc || '--') + '，太阳方位 ' +
        fmt(meta.lighting.sunAzimuth, 1) + '°/高度 ' + fmt(meta.lighting.sunAltitude, 1) + '°）'
      : '关';
    const wind = meta.wind;
    const html = [
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head>',
      '<meta charset="utf-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      '<title>' + esc(meta.title) + '</title>',
      '<style>',
      ':root{--bg:#0b1118;--panel:#121b26;--line:#243244;--text:#e8eef6;--muted:#93a4b8;--accent:#3ea6ff;--accent2:#7ee0c0}',
      '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;font-size:14px}',
      '.wrap{max-width:1180px;margin:0 auto;padding:18px 18px 34px}',
      '.head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;margin-bottom:12px}',
      '.head h1{margin:0;font-size:21px;letter-spacing:.5px}',
      '.head .badge{font-size:11px;color:#06251c;background:var(--accent2);border-radius:999px;padding:2px 8px;font-weight:700}',
      '.head .time{margin-left:auto;color:var(--muted);font-size:12.5px}',
      '.shot{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#05090d;box-shadow:0 14px 40px rgba(0,0,0,.45)}',
      '.shot img{display:block;width:100%;height:auto}',
      '.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px;margin-top:16px}',
      '.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}',
      '.card h2{margin:0 0 8px;font-size:13px;color:var(--accent);letter-spacing:.6px;font-weight:600}',
      'table{width:100%;border-collapse:collapse;font-size:12.5px}',
      'td{padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top}',
      'td:first-child{color:var(--muted);width:120px;white-space:nowrap}',
      '.mono{font-family:Consolas,"Courier New",monospace;word-break:break-all}',
      '.foot{margin-top:16px;color:var(--muted);font-size:11.5px;line-height:1.7;border-top:1px solid var(--line);padding-top:10px}',
      '.foot b{color:var(--text);font-weight:600}',
      '@media print{body{background:#fff;color:#111}.card,.shot{box-shadow:none}.head .badge{display:none}}',
      '</style>',
      '</head>',
      '<body>',
      '<div class="wrap">',
      '<div class="head"><h1>' + esc(meta.title) + '</h1><span class="badge">完全离线</span>',
      '<span class="time">' + esc(meta.time) + '</span></div>',
      '<div class="shot"><img alt="本地地球视图截图" src="' + shot.dataUrl + '" /></div>',
      '<div class="meta">',
      '<div class="card"><h2>视角 / 场景</h2><table>',
      '<tr><td>相机</td><td>' + esc(camText) + '</td></tr>',
      '<tr><td>3D 地形</td><td>' + (t.enabled ? '开（夸张 ' + fmt(t.exaggeration, 1) + '×）' : '关') + '</td></tr>',
      '<tr><td>卫星影像</td><td>' + (t.imagery ? '开' : '关') + '</td></tr>',
      '<tr><td>实时光照</td><td>' + lightText + '</td></tr>',
      '</table></div>',
      '<div class="card"><h2>Wind3D 风场</h2><table>' + windRows(wind) + particleRows(meta.particles) + '</table></div>',
      '<div class="card"><h2>图层（' + meta.layers.length + '）</h2><table>' + layerRows(meta.layers) + '</table></div>',
      '</div>',
      '<div class="foot">',
      '<b>数据来源与版权：</b>底图 NASA Blue Marble（公有领域）；国界/城市 Natural Earth（公有领域）；' +
      '卫星影像 Sentinel-2 cloudless by EOX IT Services GmbH（CC BY 4.0，仅本地缓存）；' +
      '三维引擎 CesiumJS（Apache-2.0）。风场数据由 WindNinja / Wind3D 结果离线读取，版权归数据提供方。',
      '<br />本快照为单文件 HTML，截图与全部信息内嵌，打开时不会发起任何网络请求。' +
      '生成版本 ' + esc(meta.version) + ' · CesiumJS ' + esc(meta.cesium) + ' · ' + esc(meta.iso) + '</div>',
      '</div>',
      '</body>',
      '</html>',
    ].join('\n');
    return html;
  }

  /* ------------------------------ 对外方法 ------------------------------ */

  async function html(opts) {
    const o = opts || {};
    if (state.busy) throw new Error('快照生成中，请稍候');
    state.busy = true;
    try {
      const shot = await capture(o);
      const meta = collectMeta(o);
      const text = buildHtml(shot, meta);
      state.last = {
        kind: 'html',
        time: new Date().toISOString(),
        bytes: new Blob([text]).size,
        shot: { width: shot.width, height: shot.height, bytes: shot.bytes, via: shot.via },
        meta: {
          title: meta.title,
          camera: meta.camera,
          layers: meta.layers.length,
          wind: meta.wind ? meta.wind.label : null,
        },
      };
      return text;
    } finally {
      state.busy = false;
    }
  }

  async function downloadHtml(opts) {
    const o = opts || {};
    const text = await html(o);
    const filename = o.filename || 'maomaoearth-snapshot-' + nowStamp() + '.html';
    const blob = new Blob([text], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, filename);
    const result = { filename, bytes: blob.size, chars: text.length, html: text.length };
    state.last = Object.assign({}, state.last, { kind: 'download', filename, bytes: blob.size });
    if (state.le && state.le.status) state.le.status('HTML 快照已导出：' + filename + '（' + Math.round(blob.size / 1024) + ' KB）');
    if (state.le && state.le.toast) state.le.toast('HTML 快照已导出（' + Math.round(blob.size / 1024) + ' KB）', 'ok', 3600);
    return result;
  }

  function shareLink() {
    const le = state.le;
    if (!le || !le.viewer) return '';
    const cam = cameraMeta();
    const params = new URLSearchParams();
    if (cam) {
      params.set(
        'cam',
        [cam.lon, cam.lat, cam.height, cam.pitch]
          .map((v) => (isFinite(v) ? Number(v.toFixed(6)) : 0))
          .join(',')
      );
    }
    const T = window.LETerrain;
    if (T) {
      if (typeof T.getExaggeration === 'function') {
        params.set('exag', Number(T.getExaggeration()).toFixed(1));
      }
      if (typeof T.isEnabled === 'function') params.set('terrain', T.isEnabled() ? '1' : '0');
      if (typeof T.isImageryEnabled === 'function') {
        params.set('imagery', T.isImageryEnabled() ? '1' : '0');
      }
    }
    const W = window.LEWindninja;
    if (W && typeof W.getProjectState === 'function') {
      try {
        const p = W.getProjectState();
        if (p && p.source === 'url' && p.velUrl) params.set('windninja', p.velUrl);
      } catch (err) {
        /* ignore */
      }
    }
    if (window.LEPerf && typeof window.LEPerf.getMode === 'function') {
      params.set('perf', window.LEPerf.getMode());
    }
    const P = window.LEWindParticles;
    if (P && typeof P.getStats === 'function') {
      try {
        const p = P.getStats();
        params.set('windmode', p.mode || 'arrows');
        if (p.running || p.mode === 'particles' || p.mode === 'both') {
          params.set('particles', String(p.requested || p.count || ''));
        }
      } catch (err) {
        /* ignore */
      }
    }
    const L = window.LELighting;
    if (L && typeof L.getState === 'function') {
      try {
        const s = L.getState();
        if (s && s.enabled) {
          params.set('lighting', '1');
          if (isFinite(s.hours)) params.set('sun', String(s.hours));
        }
      } catch (err) {
        /* ignore */
      }
    }
    const base = location.href.split('#')[0].split('?')[0];
    const link = base + '?' + params.toString();
    state.last = Object.assign({}, state.last, { kind: 'share', link, time: new Date().toISOString() });
    return link;
  }

  async function copyShare() {
    const link = shareLink();
    if (!link) return null;
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
        ok = true;
      }
    } catch (err) {
      ok = false;
    }
    if (!ok) {
      // 离线/权限受限环境回退：隐藏 textarea + execCommand
      try {
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (err) {
        ok = false;
      }
    }
    const le = state.le;
    const msg = ok ? '分享链接已复制到剪贴板' : '分享链接已生成（复制受浏览器限制，请从控制台/状态栏获取）';
    if (le && le.status) le.status('分享链接：' + link, 'ok');
    if (le && le.toast) le.toast(msg, ok ? 'ok' : 'error', 4200);
    if (!ok) console.info('[LESnapshot] 分享链接：' + link);
    return link;
  }

  /* ------------------------------ 初始化 ------------------------------ */

  function applyUrlParams() {
    const params = new URLSearchParams(location.search);
    if (!params.has('terrain') && !params.has('imagery')) return;
    const le = state.le;
    const T = window.LETerrain;
    if (!le || !T) return;
    if (params.has('terrain')) {
      const want = params.get('terrain') !== '0';
      try {
        if (typeof T.isEnabled === 'function' && T.isEnabled() !== want) {
          Promise.resolve(T.toggle(le)).catch(() => {});
        }
      } catch (err) {
        /* ignore */
      }
    }
    if (params.has('imagery')) {
      const want = params.get('imagery') !== '0';
      try {
        if (typeof T.isImageryEnabled === 'function' && T.isImageryEnabled() !== want &&
            typeof T.toggleImagery === 'function') {
          Promise.resolve(T.toggleImagery(le)).catch(() => {});
        }
      } catch (err) {
        /* ignore */
      }
    }
  }

  function bindUI() {
    if (state.bound) return;
    state.bound = true;
    const htmlBtn = byId('btn-snapshot-html');
    if (htmlBtn) {
      htmlBtn.addEventListener('click', () => {
        downloadHtml().catch((err) => {
          console.error('[LESnapshot] 导出失败', err);
          if (state.le && state.le.toast) state.le.toast('HTML 快照导出失败：' + err.message, 'error', 5000);
        });
      });
    }
    const shareBtn = byId('btn-share-link');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        copyShare().catch((err) => {
          console.error('[LESnapshot] 分享失败', err);
          if (state.le && state.le.toast) state.le.toast('分享链接生成失败：' + err.message, 'error', 5000);
        });
      });
    }
    const previewBtn = byId('btn-snapshot-preview');
    if (previewBtn) {
      previewBtn.addEventListener('click', () => {
        html()
          .then((text) => {
            const blob = new Blob([text], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 30000);
          })
          .catch((err) => {
            console.error(err);
            if (state.le && state.le.toast) state.le.toast('预览失败：' + err.message, 'error', 5000);
          });
      });
    }
  }

  function init(le) {
    if (state.ready) return true;
    state.le = le || window.LE;
    if (!state.le || !state.le.viewer) return false;
    state.ready = true;
    bindUI();
    applyUrlParams();
    return true;
  }

  window.LESnapshot = {
    init,
    html,
    downloadHtml,
    shareLink,
    copyShare,
    capture,
    getLast: () => (state.last ? Object.assign({}, state.last) : null),
    isBusy: () => state.busy,
  };

  document.addEventListener(
    'local-earth-ready',
    () => {
      try {
        init(window.LE);
      } catch (err) {
        console.error('[LESnapshot] 初始化失败', err);
      }
    },
    { once: true }
  );
})();

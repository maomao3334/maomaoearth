/*
 * MBTiles 直读（本地瓦片服务）
 * - 由 MaoMaoEarth.exe mbtiles <file> 启动 C# 瓦片服务（127.0.0.1 + token）
 * - 应用通过 ?mbtiles=<base>&mbtoken=<token> 或界面输入地址加载
 * - 使用 Cesium.UrlTemplateImageryProvider，支持 png/jpg/webp 栅格瓦片
 */
(function () {
  'use strict';

  const C = window.Cesium;
  const state = {
    le: null,
    ready: false,
    layer: null,
    provider: null,
    meta: null,
    base: '',
    token: '',
    entry: null,
  };

  function params() {
    return new URLSearchParams(location.search);
  }

  function normalizeExt(format) {
    const f = String(format || 'png').toLowerCase();
    if (f === 'jpeg') return 'jpg';
    if (f === 'jpg' || f === 'png' || f === 'webp') return f;
    return 'png';
  }

  function parseBounds(bounds) {
    const arr = String(bounds || '').split(',').map(Number);
    if (arr.length !== 4 || arr.some((n) => !isFinite(n))) return null;
    return C.Rectangle.fromDegrees(arr[0], arr[1], arr[2], arr[3]);
  }

  function metaUrl(base, token) {
    const b = String(base).replace(/\/+$/, '');
    return b + '/meta.json?token=' + encodeURIComponent(token || '');
  }

  function tileUrl(base, token, ext) {
    const b = String(base).replace(/\/+$/, '');
    return b + '/tiles/{z}/{x}/{y}.' + ext + '?token=' + encodeURIComponent(token || '');
  }


  function isVectorFormat(fmt) {
    return /^(pbf|mvt)$/i.test(String(fmt || ''));
  }

  function blankCanvas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }

  function styleForLayer(name) {
    const n = String(name || '').toLowerCase();
    if (/(water|ocean|sea|lake|river|canal|reservoir)/.test(n)) {
      return { fill: 'rgba(55,125,175,0.88)', stroke: 'rgba(110,185,230,0.9)', width: 1.0, point: '#66c2ff', order: 1 };
    }
    if (/(landuse|landcover|forest|wood|grass|park|vegetation|farm|meadow)/.test(n)) {
      return { fill: 'rgba(75,130,75,0.45)', stroke: 'rgba(90,150,90,0.55)', width: 0.8, point: '#7bd07b', order: 2 };
    }
    if (/(building|house)/.test(n)) {
      return { fill: 'rgba(150,150,150,0.55)', stroke: 'rgba(190,190,190,0.55)', width: 0.6, point: '#cccccc', order: 3 };
    }
    if (/(road|street|highway|transport|rail|bridge|tunnel)/.test(n)) {
      return { fill: null, stroke: 'rgba(225,170,80,0.95)', width: 1.8, point: '#ffcc66', order: 4 };
    }
    if (/(boundary|admin|border)/.test(n)) {
      return { fill: null, stroke: 'rgba(200,110,210,0.95)', width: 1.2, point: '#e08be8', order: 5 };
    }
    if (/(place|poi|label|city|town|village)/.test(n)) {
      return { fill: null, stroke: null, width: 0, point: '#ffffff', order: 6 };
    }
    const palette = ['rgba(110,160,200,0.5)', 'rgba(140,180,120,0.5)', 'rgba(190,160,110,0.5)', 'rgba(160,130,190,0.5)'];
    let h = 0;
    for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 997;
    return { fill: palette[h % palette.length], stroke: 'rgba(220,230,240,0.5)', width: 0.8, point: '#dddddd', order: 3 };
  }

  function renderMvtTile(buffer, size) {
    const canvas = blankCanvas(size);
    let tile;
    try { tile = window.MVT.parse(buffer); } catch (e) { return canvas; }
    const ctx = canvas.getContext('2d');
    const layers = (tile.layers || []).slice().sort((a, b) => styleForLayer(a.name).order - styleForLayer(b.name).order);
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const style = styleForLayer(layer.name);
      const extent = layer.extent || 4096;
      const scale = size / extent;
      for (let fi = 0; fi < layer.features.length; fi++) {
        const f = layer.features[fi];
        if (f.type === 'polygon') {
          ctx.beginPath();
          for (let p = 0; p < f.geometry.length; p++) {
            const ring = f.geometry[p];
            if (!ring.length) continue;
            ctx.moveTo(ring[0][0] * scale, ring[0][1] * scale);
            for (let q = 1; q < ring.length; q++) ctx.lineTo(ring[q][0] * scale, ring[q][1] * scale);
            ctx.closePath();
          }
          if (style.fill) {
            ctx.globalAlpha = 1;
            ctx.fillStyle = style.fill;
            try { ctx.fill('evenodd'); } catch (e) { ctx.fill(); }
          }
          if (style.stroke) {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = style.stroke;
            ctx.lineWidth = Math.max(0.5, style.width * (size / 256));
            ctx.stroke();
          }
        } else if (f.type === 'line') {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = style.stroke || 'rgba(230,230,230,0.8)';
          ctx.lineWidth = Math.max(0.6, style.width * (size / 256));
          ctx.beginPath();
          for (let p = 0; p < f.geometry.length; p++) {
            const line = f.geometry[p];
            if (!line.length) continue;
            ctx.moveTo(line[0][0] * scale, line[0][1] * scale);
            for (let q = 1; q < line.length; q++) ctx.lineTo(line[q][0] * scale, line[q][1] * scale);
          }
          ctx.stroke();
        } else if (f.type === 'point') {
          ctx.globalAlpha = 1;
          ctx.fillStyle = style.point || '#ffffff';
          for (let p = 0; p < f.geometry.length; p++) {
            const pt = f.geometry[p][0];
            if (!pt) continue;
            ctx.beginPath();
            ctx.arc(pt[0] * scale, pt[1] * scale, Math.max(1.2, 2.2 * (size / 256)), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    return canvas;
  }

  function createVectorProvider(base, token, meta, tilingScheme, rectangle, minLevel, maxLevel) {
    const urlBase = String(base).replace(/\/+$/, '');
    return {
      ready: true,
      readyPromise: Promise.resolve(true),
      tilingScheme: tilingScheme,
      rectangle: rectangle || undefined,
      tileWidth: 256,
      tileHeight: 256,
      minimumLevel: minLevel,
      maximumLevel: maxLevel,
      hasAlphaChannel: true,
      credit: new C.Credit(meta.attribution || 'MBTiles'),
      getTileCredits: function () { return []; },
      requestImage: function (x, y, level) {
        const url = urlBase + '/tiles/' + level + '/' + x + '/' + y + '.pbf?token=' + encodeURIComponent(token || '');
        return fetch(url, { cache: 'no-store' }).then(function (res) {
          if (res.status === 204 || res.status === 404) return blankCanvas(256);
          if (!res.ok) throw new Error('MBTiles tile HTTP ' + res.status);
          return res.arrayBuffer().then(function (buf) { return renderMvtTile(buf, 256); });
        }).catch(function () { return blankCanvas(256); });
      },
    };
  }

  async function loadFromUrl(base, token, opts) {
    opts = opts || {};
    if (!base) throw new Error('缺少 MBTiles 服务地址');
    if (!window.LE || !window.LE.viewer) throw new Error('应用尚未就绪');
    const resp = await fetch(metaUrl(base, token), { cache: 'no-store' });
    if (!resp.ok) throw new Error('读取 MBTiles metadata 失败（HTTP ' + resp.status + '）');
    const meta = await resp.json();
    const ext = normalizeExt(meta.format);
    const rectangle = parseBounds(meta.bounds);
    const minLevel = parseInt(meta.minzoom, 10);
    const maxLevel = parseInt(meta.maxzoom, 10);
    const minZ = isFinite(minLevel) ? minLevel : 0;
    const maxZ = isFinite(maxLevel) ? maxLevel : 22;
    const crs = String(meta.crs || 'EPSG:3857');
    const geographic = /4326|geographic/i.test(crs);
    const tilingScheme = geographic ? new C.GeographicTilingScheme() : new C.WebMercatorTilingScheme();
    let provider;
    if (isVectorFormat(meta.format)) {
      if (window.LEMvt && typeof window.LEMvt.createImageryProvider === 'function') {
        provider = window.LEMvt.createImageryProvider({ base: base, token: token, meta: meta });
      } else {
        provider = createVectorProvider(base, token, meta, tilingScheme, rectangle, minZ, maxZ);
      }
    } else {
      provider = new C.UrlTemplateImageryProvider({
        url: tileUrl(base, token, ext),
        tilingScheme: tilingScheme,
        minimumLevel: minZ,
        maximumLevel: maxZ,
        rectangle: rectangle || undefined,
        credit: meta.attribution || 'MBTiles',
      });
    }
    clear();
    const viewer = window.LE.viewer;
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    try { viewer.imageryLayers.raiseToTop(layer); } catch (e) { /* ignore */ }
    layer.alpha = 1.0;
    state.layer = layer;
    state.provider = provider;
    state.meta = meta;
    state.base = base;
    state.token = token || '';
    const name = meta.name ? 'MBTiles · ' + meta.name : 'MBTiles';
    state.entry = window.LE.registerLayer({
      id: 'mbtiles-' + Date.now().toString(36),
      name: name,
      type: 'imagery',
      imageryLayer: layer,
      remove: function () { removeLayer(); },
      zoomTo: function () {
        if (rectangle) viewer.camera.flyTo({ destination: rectangle, duration: 1.2 });
      },
    });
    if (opts.fit !== false && rectangle) {
      viewer.camera.flyTo({ destination: rectangle, duration: 1.2 });
    }
    if (window.LE.status) {
      window.LE.status('MBTiles：' + (meta.name || '') + ' · ' + (meta.format || '') +
        ' · z' + meta.minzoom + '–' + meta.maxzoom + ' · ' + (meta.bounds || ''));
    }
    if (window.LE.toast) window.LE.toast('已加载 MBTiles：' + (meta.name || ''), 'ok', 3600);
    return { meta: meta, rectangle: rectangle, provider: provider, layer: layer };
  }

  function removeLayer() {
    if (state.layer && window.LE && window.LE.viewer) {
      try { window.LE.viewer.imageryLayers.remove(state.layer, true); } catch (e) { /* ignore */ }
    }
    state.layer = null;
    state.provider = null;
    state.meta = null;
    state.entry = null;
  }

  function clear() {
    removeLayer();
    state.base = '';
    state.token = '';
  }

  function getState() {
    return {
      loaded: !!state.layer,
      base: state.base,
      name: state.meta ? state.meta.name : null,
      format: state.meta ? state.meta.format : null,
      bounds: state.meta ? state.meta.bounds : null,
      crs: state.meta ? state.meta.crs : null,
      minzoom: state.meta ? state.meta.minzoom : null,
      maxzoom: state.meta ? state.meta.maxzoom : null,
      attribution: state.meta ? state.meta.attribution : null,
      token: state.token || '',
    };
  }

  function ensureDialog() {
    let dlg = document.getElementById('mbtiles-dialog');
    if (dlg) return dlg;
    dlg = document.createElement('div');
    dlg.id = 'mbtiles-dialog';
    dlg.className = 'modal-backdrop hidden';
    dlg.innerHTML =
      '<div class="modal-panel" role="dialog" aria-modal="true" aria-label="加载 MBTiles">' +
      '<h3>加载 MBTiles</h3>' +
      '<p class="hint">先运行：<code>MaoMaoEarth.exe mbtiles 路径\\文件.mbtiles</code><br>' +
      '会把本地瓦片服务地址复制到浏览器（自动加载）。也可手动填写服务地址：</p>' +
      '<label class="field">服务地址 <input id="mbtiles-base" type="text" placeholder="http://127.0.0.1:8140"></label>' +
      '<label class="field">Token <input id="mbtiles-token" type="text" placeholder="（可选）"></label>' +
      '<div class="modal-actions"><button id="mbtiles-load" class="primary">加载</button>' +
      '<button id="mbtiles-close" class="subtle">关闭</button></div>' +
      '<p id="mbtiles-msg" class="hint"></p></div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#mbtiles-close').addEventListener('click', function () { dlg.classList.add('hidden'); });
    dlg.querySelector('#mbtiles-load').addEventListener('click', async function () {
      const base = dlg.querySelector('#mbtiles-base').value.trim();
      const token = dlg.querySelector('#mbtiles-token').value.trim();
      const msg = dlg.querySelector('#mbtiles-msg');
      msg.textContent = '加载中…';
      try {
        await loadFromUrl(base, token);
        msg.textContent = '已加载';
        setTimeout(function () { dlg.classList.add('hidden'); }, 400);
      } catch (e) {
        msg.textContent = '失败：' + (e && e.message ? e.message : e);
      }
    });
    return dlg;
  }

  function openDialog() {
    const dlg = ensureDialog();
    dlg.classList.remove('hidden');
    const p = params();
    if (p.get('mbtiles')) dlg.querySelector('#mbtiles-base').value = p.get('mbtiles');
    if (p.get('mbtoken')) dlg.querySelector('#mbtiles-token').value = p.get('mbtoken');
  }

  function init(le) {
    if (state.ready) return;
    state.le = le || window.LE;
    if (!state.le || !state.le.viewer) return;
    state.ready = true;
    const btn = document.getElementById('btn-mbtiles');
    if (btn) btn.addEventListener('click', openDialog);
    const p = params();
    const base = p.get('mbtiles');
    if (base) {
      loadFromUrl(base, p.get('mbtoken') || '').catch(function (e) {
        console.warn('[LEMBTiles] 自动加载失败', e);
        if (window.LE && window.LE.toast) window.LE.toast('MBTiles 加载失败：' + (e.message || e), 'error', 5000);
      });
    }
  }

  window.LEMBTiles = {
    init: init,
    load: loadFromUrl,
    openDialog: openDialog,
    clear: clear,
    getState: getState,
    remove: removeLayer,
  };

  if (window.LE && window.LE.viewer) init(window.LE);
  else document.addEventListener('local-earth-ready', function () { init(window.LE); }, { once: true });
})();

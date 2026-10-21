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
    const provider = new C.UrlTemplateImageryProvider({
      url: tileUrl(base, token, ext),
      tilingScheme: new C.WebMercatorTilingScheme(),
      minimumLevel: isFinite(minLevel) ? minLevel : 0,
      maximumLevel: isFinite(maxLevel) ? maxLevel : 22,
      rectangle: rectangle || undefined,
      credit: meta.attribution || 'MBTiles',
    });
    clear();
    const viewer = window.LE.viewer;
    const layer = viewer.imageryLayers.addImageryProvider(provider);
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
      minzoom: state.meta ? state.meta.minzoom : null,
      maxzoom: state.meta ? state.meta.maxzoom : null,
      attribution: state.meta ? state.meta.attribution : null,
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

/*
 * 本地影像（仅本机）
 * - 读取 data/local/imagery.json；该目录被 .gitignore 排除，不会进入 Git / 发布包
 * - 当前支持本地 XYZ 瓦片目录（WebMercator / Geographic），JPEG 完整瓦片 + PNG 透明边界
 * - 自动加载清单里 autoLoad 的数据集；侧栏「本地影像」可手动加载/定位/移除
 */
(function () {
  'use strict';

  const C = window.Cesium;
  const MANIFEST_URL = 'data/local/imagery.json';
  const state = {
    le: null,
    ready: false,
    datasets: [],
    loaded: new Map(), // id -> { ds, entry, layer, provider }
    section: null,
    listNode: null,
    countNode: null,
    noteNode: null,
    manifestOk: false,
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function toast(msg, kind, ms) {
    if (state.le && state.le.toast) state.le.toast(msg, kind || 'ok', ms || 3200);
  }

  function status(msg) {
    if (state.le && state.le.status) state.le.status(msg);
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function transparentCanvas() {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return c;
  }

  let blank = null;
  function blankTile() {
    if (!blank) blank = transparentCanvas();
    return blank;
  }

  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('瓦片图片解码失败'));
      };
      img.src = url;
    });
  }

  function tileUrls(ds, level, x, y) {
    const tpl = String(ds.url || '');
    const hasExt = /\{ext\}/.test(tpl);
    const exts = hasExt ? ['jpg', 'png'] : [''];
    return exts.map(function (ext) {
      let u = tpl
        .replace(/\{z\}/g, String(level))
        .replace(/\{x\}/g, String(x))
        .replace(/\{y\}/g, String(y))
        .replace(/\{-y\}/g, String(y));
      if (hasExt) u = u.replace(/\{ext\}/g, ext);
      return u;
    });
  }

  async function fetchFirstImage(urls) {
    for (let i = 0; i < urls.length; i++) {
      try {
        const res = await fetch(urls[i], { cache: 'default' });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blob || !blob.size) continue;
        return await loadImage(blob);
      } catch (err) {
        /* 尝试下一个扩展名 */
      }
    }
    return null;
  }

  function createProvider(ds) {
    const geographic = /geographic|4326/i.test(String(ds.scheme || ''));
    const tilingScheme = geographic ? new C.GeographicTilingScheme() : new C.WebMercatorTilingScheme();
    let rectangle;
    if (Array.isArray(ds.bounds) && ds.bounds.length === 4) {
      const b = ds.bounds.map(Number);
      if (b.every(function (n) { return isFinite(n); })) {
        rectangle = C.Rectangle.fromDegrees(b[0], b[1], b[2], b[3]);
      }
    }
    const minLevel = isFinite(Number(ds.minzoom)) ? Number(ds.minzoom) : 0;
    const maxLevel = isFinite(Number(ds.maxzoom)) ? Number(ds.maxzoom) : 22;
    const tpl = String(ds.url || '');
    const seedUrl = tpl.replace(/\{ext\}/g, 'jpg');
    // 用 Cesium 自带 UrlTemplateImageryProvider 负责层级选择/几何误差/瓦片坐标，
    // 仅替换 requestImage 以支持 .jpg / .png 混合瓦片（PNG 用于 no-data 边界）。
    const provider = new C.UrlTemplateImageryProvider({
      url: seedUrl,
      tilingScheme: tilingScheme,
      rectangle: rectangle,
      minimumLevel: minLevel,
      maximumLevel: maxLevel,
      credit: ds.attribution || '本地影像（仅本机）',
    });
    try {
      Object.defineProperty(provider, 'hasAlphaChannel', { value: true, configurable: true });
    } catch (err) { /* ignore */ }
    provider.requestImage = function (x, y, level) {
      if (tpl.indexOf('{z}') < 0) return Promise.resolve(blankTile());
      return fetchFirstImage(tileUrls(ds, level, x, y))
        .then(function (img) { return img || blankTile(); })
        .catch(function () { return blankTile(); });
    };
    return provider;
  }

  function dsById(id) {
    for (let i = 0; i < state.datasets.length; i++) {
      if (state.datasets[i].id === id) return state.datasets[i];
    }
    return null;
  }

  async function load(id, opts) {
    opts = opts || {};
    const ds = dsById(id);
    if (!ds) throw new Error('未知的本地影像：' + id);
    if (!state.le || !state.le.viewer) throw new Error('应用尚未就绪');
    if (state.loaded.has(id)) {
      const rec = state.loaded.get(id);
      if (rec.layer) rec.layer.show = true;
      return rec;
    }
    const provider = createProvider(ds);
    const viewer = state.le.viewer;
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = ds.opacity != null ? clamp(Number(ds.opacity), 0, 1) : 1;
    layer.show = true;
    try {
      viewer.imageryLayers.raiseToTop(layer);
    } catch (err) { /* ignore */ }
    const entry = state.le.registerLayer({
      id: 'local-imagery-' + (ds.id || 'dataset'),
      name: '本地影像 · ' + (ds.name || ds.id || '未命名'),
      type: 'imagery',
      localImagery: true,
      imageryLayer: layer,
      remove: function () {
        try {
          viewer.imageryLayers.remove(layer, true);
        } catch (err) { /* ignore */ }
        state.loaded.delete(id);
        refreshCard(id);
        refreshCount();
      },
      zoomTo: function () {
        if (provider.rectangle) state.le.flyTo({ rectangle: provider.rectangle });
      },
    });
    state.loaded.set(id, { ds: ds, entry: entry, layer: layer, provider: provider });
    refreshCard(id);
    refreshCount();
    if (opts.fit !== false && provider.rectangle) {
      state.le.flyTo({ rectangle: provider.rectangle });
    }
    if (opts.silent !== true) {
      toast('已加载本地影像：' + (ds.name || ds.id), 'ok', 3000);
    }
    status(
      '本地影像：' +
        (ds.name || ds.id) +
        ' · z' + provider.minimumLevel + '–' + provider.maximumLevel +
        (provider.rectangle ? ' · ' + (ds.bounds || []).join(', ') : '')
    );
    return state.loaded.get(id);
  }

  function unload(id, opts) {
    const rec = state.loaded.get(id);
    if (!rec) return false;
    if (rec.entry && state.le && typeof state.le.removeLayer === 'function') {
      state.le.removeLayer(rec.entry.id);
    } else if (rec.layer && state.le && state.le.viewer) {
      state.le.viewer.imageryLayers.remove(rec.layer, true);
      state.loaded.delete(id);
    }
    refreshCard(id);
    refreshCount();
    if (!opts || opts.silent !== true) toast('已移除本地影像：' + (rec.ds.name || id), 'ok', 2400);
    return true;
  }

  function toggle(id) {
    if (state.loaded.has(id)) return unload(id);
    return load(id, { fit: false }).catch(function (err) {
      console.error('[LELocalImagery] 加载失败', err);
      toast('本地影像加载失败：' + (err && err.message ? err.message : err), 'error', 5000);
    });
  }

  function raiseAll() {
    if (!state.le || !state.le.viewer) return;
    for (const rec of state.loaded.values()) {
      if (rec.layer) {
        try {
          state.le.viewer.imageryLayers.raiseToTop(rec.layer);
        } catch (err) { /* ignore */ }
      }
    }
  }

  function refreshCount() {
    if (!state.countNode) return;
    const total = state.datasets.length;
    const on = state.loaded.size;
    state.countNode.textContent = total ? (on ? on + '/' + total : String(total)) : '0';
  }

  function cardFor(id) {
    if (!state.listNode) return null;
    return state.listNode.querySelector('[data-local-imagery="' + id + '"]');
  }

  function refreshCard(id) {
    const card = cardFor(id);
    if (!card) return;
    const rec = state.loaded.get(id);
    card.classList.toggle('loaded', !!rec);
    const statusNode = card.querySelector('.local-imagery-status');
    if (statusNode) statusNode.textContent = rec ? '已加载' : '未加载';
    const btn = card.querySelector('.local-imagery-toggle');
    if (btn) btn.textContent = rec ? '移除' : '加载';
    const zoom = card.querySelector('.local-imagery-zoom');
    if (zoom) zoom.disabled = !rec;
  }

  function renderDataset(ds) {
    const card = document.createElement('div');
    card.className = 'local-imagery-card';
    card.setAttribute('data-local-imagery', ds.id || '');

    const head = document.createElement('div');
    head.className = 'local-imagery-head';
    const title = document.createElement('span');
    title.className = 'local-imagery-title';
    title.textContent = ds.name || ds.id || '本地影像';
    const statusNode = document.createElement('span');
    statusNode.className = 'local-imagery-status';
    statusNode.textContent = '未加载';
    head.appendChild(title);
    head.appendChild(statusNode);

    const meta = document.createElement('div');
    meta.className = 'local-imagery-meta';
    const parts = [];
    if (ds.minzoom != null && ds.maxzoom != null) parts.push('z' + ds.minzoom + '–' + ds.maxzoom);
    if (ds.note) parts.push(String(ds.note));
    meta.textContent = parts.join(' · ');

    const actions = document.createElement('div');
    actions.className = 'local-imagery-actions';
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'local-imagery-toggle';
    toggleBtn.textContent = '加载';
    toggleBtn.addEventListener('click', function () { toggle(ds.id); });
    const zoomBtn = document.createElement('button');
    zoomBtn.type = 'button';
    zoomBtn.className = 'local-imagery-zoom subtle';
    zoomBtn.textContent = '定位';
    zoomBtn.disabled = true;
    zoomBtn.addEventListener('click', function () {
      const rec = state.loaded.get(ds.id);
      if (rec && rec.provider.rectangle) state.le.flyTo({ rectangle: rec.provider.rectangle });
    });
    actions.appendChild(toggleBtn);
    actions.appendChild(zoomBtn);

    card.appendChild(head);
    card.appendChild(meta);
    card.appendChild(actions);
    return card;
  }

  function render() {
    if (!state.section) return;
    const has = state.datasets.length > 0;
    state.section.hidden = !has;
    if (!has) {
      refreshCount();
      return;
    }
    if (state.listNode) {
      state.listNode.innerHTML = '';
      state.datasets.forEach(function (ds) {
        if (!ds || !ds.id) return;
        state.listNode.appendChild(renderDataset(ds));
      });
    }
    state.datasets.forEach(function (ds) {
      if (ds && ds.id) refreshCard(ds.id);
    });
    refreshCount();
  }

  async function loadManifest() {
    let manifest = null;
    try {
      const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (res.ok) {
        manifest = await res.json();
      }
    } catch (err) {
      console.info('[LELocalImagery] 未发现本地影像清单（可选）', err && err.message);
    }
    if (!manifest || !Array.isArray(manifest.datasets)) {
      state.datasets = [];
      state.manifestOk = false;
      render();
      return;
    }
    state.manifestOk = true;
    state.datasets = manifest.datasets.filter(function (ds) {
      return ds && ds.id && ds.url;
    });
    render();
    const auto = manifest.autoLoad !== false;
    if (!auto) return;
    for (const ds of state.datasets) {
      if (ds.autoLoad === false) continue;
      try {
        await load(ds.id, { fit: false, silent: true });
      } catch (err) {
        console.warn('[LELocalImagery] 自动加载失败：' + ds.id, err);
      }
    }
    if (state.loaded.size) {
      status('本地影像已自动加载：' + state.loaded.size + ' 个数据集（data/local/）');
    }
  }

  function init(le) {
    if (state.ready) return;
    state.le = le || window.LE;
    if (!state.le || !state.le.viewer) return;
    state.ready = true;
    state.section = byId('local-imagery-section');
    state.listNode = byId('local-imagery-list');
    state.countNode = byId('local-imagery-count');
    state.noteNode = byId('local-imagery-note');
    loadManifest();
  }

  window.LELocalImagery = {
    init: init,
    load: load,
    unload: unload,
    toggle: toggle,
    raiseAll: raiseAll,
    getState: function () {
      return {
        manifest: state.manifestOk,
        datasets: state.datasets.map(function (ds) {
          return { id: ds.id, name: ds.name, loaded: state.loaded.has(ds.id), bounds: ds.bounds || null };
        }),
      };
    },
    list: function () { return this.getState().datasets; },
  };

  if (window.LE && window.LE.viewer) init(window.LE);
  else document.addEventListener('local-earth-ready', function (ev) { init((ev && ev.detail) || window.LE); }, { once: true });
})();

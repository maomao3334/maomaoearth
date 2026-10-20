/*
 * 图层管理器 + 数据状态面板（P1）
 * - 搜索、按类型分组（矢量 / 影像 / 地形阴影 / 风场 / 其他）
 * - 每层：可见开关、定位、删除；imagery 额外支持透明度滑杆与上移/下移
 * - 随 LE.listLayers() 动态刷新（js/ui.js 的 refreshLayers 会委托到本模块）
 * - 数据状态：地形 / 影像 / 矢量状态与「一键加载」；本地 XYZ 瓦片目录（webkitdirectory）
 *
 * 对外 API：window.LELayerPanel
 *   init(le) / refresh(layers?) / setQuery(q) / getGroups() / refreshDataStatus()
 *
 * 说明：影像层透明度只对 type==='imagery' 的图层生效（datasource 图层没有 alpha 概念）；
 *       上移/下移调用 viewer.imageryLayers.raise/lower，只影响影像层顺序。
 */
(function () {
  'use strict';

  const C = window.Cesium;

  const GROUP_ORDER = ['vector', 'imagery', 'shadow', 'wind', 'other'];
  const GROUP_LABEL = {
    vector: '矢量',
    imagery: '影像',
    shadow: '地形阴影',
    wind: '风场',
    other: '其他',
  };
  const TYPE_LABEL = {
    vector: '矢量',
    imagery: '影像',
    wind3d: '风场',
    overlay: '叠加',
  };

  const state = {
    le: null,
    query: '',
    latest: [],
    bound: false,
    searchBound: false,
    dataBound: false,
    rendering: false,
    pending: false,
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

  function isShadowLayer(entry) {
    return /阴影|hillshade|shade/i.test(String(entry && entry.name ? entry.name : ''));
  }

  function groupOf(entry) {
    if (!entry) return 'other';
    if (entry.type === 'imagery') return isShadowLayer(entry) ? 'shadow' : 'imagery';
    if (entry.type === 'vector') return 'vector';
    if (entry.type === 'wind3d') return 'wind';
    return 'other';
  }

  function layerList() {
    const le = getLE();
    if (!le || typeof le.listLayers !== 'function') return [];
    return le.listLayers().filter((l) => l && !l.system);
  }

  function matches(entry) {
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    return String(entry.name || '').toLowerCase().indexOf(q) !== -1;
  }

  /* ------------------------------ 行为 ------------------------------ */

  function locate(entry) {
    const le = getLE();
    const viewer = viewerOf();
    if (!le || !viewer) return false;
    try {
      if (typeof entry.zoomTo === 'function') {
        entry.zoomTo();
        if (le.status) le.status('已定位到图层：' + entry.name);
        return true;
      }
      if (entry.datasource) {
        viewer.flyTo(entry.datasource, { duration: 1.4 }).catch(() => {});
        if (le.status) le.status('已定位到图层：' + entry.name);
        return true;
      }
      if (entry.imageryLayer) {
        const provider = entry.imageryLayer.imageryProvider;
        const rect = provider && provider.rectangle;
        if (rect) {
          viewer.camera.flyTo({ destination: rect, duration: 1.4 });
          if (le.status) le.status('已定位到影像范围：' + entry.name);
          return true;
        }
      }
      if (le.toast) le.toast('该图层没有可定位的范围：' + entry.name, 'error', 3200);
    } catch (err) {
      console.warn('[LELayerPanel] 定位失败', err);
      if (le.toast) le.toast('定位失败：' + (err && err.message ? err.message : err), 'error', 3600);
    }
    return false;
  }

  function toggleVisible(entry) {
    const next = !entry.visible;
    if (typeof entry.setVisible === 'function') entry.setVisible(next);
    else if (entry.datasource) entry.datasource.show = next;
    else if (entry.imageryLayer) entry.imageryLayer.show = next;
    entry.visible = next;
    const le = getLE();
    if (le && le.refreshLayers) le.refreshLayers();
  }

  function remove(entry) {
    const le = getLE();
    if (!le) return;
    le.removeLayer(entry.id);
  }

  function imageryIndex(entry) {
    const viewer = viewerOf();
    if (!viewer || !entry.imageryLayer) return -1;
    try {
      return viewer.imageryLayers.indexOf(entry.imageryLayer);
    } catch (err) {
      return -1;
    }
  }

  function raise(entry) {
    const viewer = viewerOf();
    if (!viewer || !entry.imageryLayer) return;
    try {
      viewer.imageryLayers.raise(entry.imageryLayer);
      const le = getLE();
      if (le && le.refreshLayers) le.refreshLayers();
    } catch (err) {
      console.warn('[LELayerPanel] 上移失败', err);
    }
  }

  function lower(entry) {
    const viewer = viewerOf();
    if (!viewer || !entry.imageryLayer) return;
    try {
      viewer.imageryLayers.lower(entry.imageryLayer);
      const le = getLE();
      if (le && le.refreshLayers) le.refreshLayers();
    } catch (err) {
      console.warn('[LELayerPanel] 下移失败', err);
    }
  }

  function setOpacity(entry, alpha) {
    const a = Math.max(0, Math.min(1, Number(alpha)));
    if (typeof entry.setOpacity === 'function') entry.setOpacity(a);
    else if (entry.imageryLayer) entry.imageryLayer.alpha = a;
    return a;
  }

  /* ------------------------------ 渲染 ------------------------------ */

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderRow(entry) {
    const li = el('li', 'layer-item');
    li.dataset.id = entry.id;
    li.dataset.type = entry.type || '';

    const row = el('div', 'layer-row');
    const eye = el('button', 'eye' + (entry.visible ? ' on' : ''), entry.visible ? '●' : '○');
    eye.title = entry.visible ? '隐藏图层' : '显示图层';
    eye.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleVisible(entry);
    });
    row.appendChild(eye);

    const name = el('span', 'layer-name', entry.name || '未命名图层');
    name.title = (entry.name || '') + '（点击定位）';
    name.addEventListener('click', () => locate(entry));
    row.appendChild(name);

    const type = el('span', 'layer-type', TYPE_LABEL[entry.type] || entry.type || '图层');
    row.appendChild(type);

    const zoom = el('button', 'layer-btn zoom', '⌖');
    zoom.title = '定位到图层';
    zoom.addEventListener('click', (ev) => {
      ev.stopPropagation();
      locate(entry);
    });
    row.appendChild(zoom);

    const del = el('button', 'layer-btn remove', '✕');
    del.title = '删除图层';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      remove(entry);
    });
    row.appendChild(del);

    li.appendChild(row);

    if (entry.type === 'imagery' && entry.imageryLayer) {
      const controls = el('div', 'layer-controls');
      const label = el('span', 'layer-alpha-label', '透明度');
      controls.appendChild(label);
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = '1';
      range.step = '0.05';
      const alpha = typeof entry.imageryLayer.alpha === 'number' ? entry.imageryLayer.alpha : 1;
      range.value = String(alpha);
      range.title = '影像层透明度（0–1）';
      const value = el('span', 'layer-alpha-value', Math.round(alpha * 100) + '%');
      range.addEventListener('input', () => {
        const a = setOpacity(entry, range.value);
        value.textContent = Math.round(a * 100) + '%';
      });
      controls.appendChild(range);
      controls.appendChild(value);
      const up = el('button', 'layer-btn', '↑');
      up.title = '上移一层（imageryLayers.raise）';
      up.addEventListener('click', () => raise(entry));
      controls.appendChild(up);
      const down = el('button', 'layer-btn', '↓');
      down.title = '下移一层（imageryLayers.lower）';
      down.addEventListener('click', () => lower(entry));
      controls.appendChild(down);
      const idx = imageryIndex(entry);
      up.disabled = idx >= 0 && idx >= viewerOf().imageryLayers.length - 1;
      down.disabled = idx <= 0;
      li.appendChild(controls);
    }
    return li;
  }

  function render() {
    const list = byId('layer-list');
    if (!list) return;
    if (state.rendering) {
      state.pending = true;
      return;
    }
    state.rendering = true;
    const layers = state.latest && state.latest.length ? state.latest : layerList();
    state.latest = layers;

    const visible = layers.filter((l) => l.visible !== false).length;
    const countEl = byId('layer-count');
    if (countEl) countEl.textContent = String(layers.length);
    const summary = byId('layer-summary');
    if (summary) summary.textContent = '共 ' + layers.length + ' 层 · 可见 ' + visible + ' 层';

    const groups = {};
    for (const layer of layers) {
      const g = groupOf(layer);
      (groups[g] = groups[g] || []).push(layer);
    }
    list.innerHTML = '';
    let rendered = 0;
    for (const key of GROUP_ORDER) {
      const entries = (groups[key] || []).filter(matches);
      if (!entries.length) continue;
      const head = el('li', 'layer-group-head');
      head.dataset.group = key;
      head.textContent = GROUP_LABEL[key] + ' (' + entries.length + ')';
      list.appendChild(head);
      for (const entry of entries) {
        list.appendChild(renderRow(entry));
        rendered += 1;
      }
    }
    if (!layers.length) {
      list.innerHTML = '<li class="layer-empty">暂无图层，拖放文件或点击“打开数据”</li>';
    } else if (!rendered) {
      list.innerHTML = '<li class="layer-empty">没有匹配“' + escapeHtml(state.query) + '”的图层</li>';
    }
    state.rendering = false;
    if (state.pending) {
      state.pending = false;
      render();
    }
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function refresh(layers) {
    if (Array.isArray(layers)) state.latest = layers.filter((l) => l && !l.system);
    else state.latest = layerList();
    render();
    return state.latest;
  }

  function setQuery(q) {
    state.query = String(q == null ? '' : q);
    const input = byId('layer-search');
    if (input && input.value !== state.query) input.value = state.query;
    render();
  }

  function getGroups() {
    const out = {};
    for (const key of GROUP_ORDER) out[key] = [];
    for (const layer of state.latest) out[groupOf(layer)].push(layer.name);
    return { groups: out, total: state.latest.length };
  }

  /* ---------------------- 数据状态面板（轻量） ---------------------- */

  const VECTOR_SPECS = [
    { key: 'admin0', label: '详细国界', url: 'data/public/vectors/ne_10m_admin_0_countries.geojson', match: /admin_0|国界/ },
    { key: 'rivers', label: '河流', url: 'data/public/vectors/ne_10m_rivers_lake_centerlines.geojson', match: /rivers|河流/ },
    { key: 'lakes', label: '湖泊', url: 'data/public/vectors/ne_10m_lakes.geojson', match: /lakes|湖泊/ },
    { key: 'places', label: '城市', url: 'data/public/vectors/ne_10m_populated_places_simple.geojson', match: /populated_places|城市/ },
  ];

  function hasLayerMatching(re) {
    const le = getLE();
    const layers = le && le.listLayers ? le.listLayers() : [];
    return layers.some((l) => re.test(String(l.name || '')));
  }

  function dataRows() {
    const rows = [];
    const stats = window.LETerrain && window.LETerrain.stats ? window.LETerrain.stats() : null;
    if (stats) {
      const sources = [];
      const loading = stats.loading || {};
      // 注意：stats.high 是 sourceStats（无 ready 字段），示例区是否就绪看 stats.ready + stats.high
      const highReady = !!(stats.ready && stats.high);
      const ea = stats.eastasia || {};
      const wd = stats.world || {};
      sources.push('示例区 ' + (highReady ? '就绪' : loading.high ? '加载中' : '未加载'));
      sources.push('东亚 ' + (ea.ready ? '就绪' : ea.loading ? '加载中' : '未加载'));
      sources.push('全球 ' + (wd.ready ? '就绪' : wd.loading ? '加载中' : '未加载'));
      rows.push({
        key: 'terrain',
        label: '3D 地形',
        ok: !!stats.ready,
        text:
          (stats.enabled ? '已开启' : stats.ready ? '就绪（未开启）' : '未就绪') +
          ' · 网格 ' + stats.grid + '² · 夸张 ' + Number(stats.exaggeration).toFixed(1) + '×',
        detail: sources.join(' / '),
      });
      const img = stats.imagery || {};
      const present = (img.layers || []).filter((x) => x.present).length;
      rows.push({
        key: 'imagery',
        label: '卫星影像',
        ok: !!img.enabled && present > 0,
        text:
          (img.enabled ? '已开启' : '已关闭') +
          ' · 档位 ' + (img.quality || '--') +
          ' · 已挂载 ' + present + '/' + (img.layers || []).length + ' 层',
        detail: (img.layers || [])
          .filter((x) => x.present)
          .map((x) => (x.visible ? '●' : '○') + x.name)
          .join('　') || '主/宽域/超清三级影像（EOX Sentinel-2 cloudless，CC BY 4.0）',
      });
    } else {
      rows.push({ key: 'terrain', label: '3D 地形', ok: false, text: 'LETerrain 不可用' });
    }

    const loaded = VECTOR_SPECS.filter((spec) => hasLayerMatching(spec.match));
    rows.push({
      key: 'vector',
      label: '矢量',
      ok: loaded.length > 0,
      text: '已加载 ' + loaded.length + '/' + VECTOR_SPECS.length + ' 类',
      detail: VECTOR_SPECS.map((spec) => (hasLayerMatching(spec.match) ? '● ' : '○ ') + spec.label).join('　'),
    });

    const viewer = viewerOf();
    let imageryCount = 0;
    let dataSources = 0;
    if (viewer) {
      try {
        imageryCount = viewer.imageryLayers.length;
        dataSources = viewer.dataSources.length;
      } catch (err) {
        /* ignore */
      }
    }
    rows.push({
      key: 'counts',
      label: '场景',
      ok: true,
      text: '影像层 ' + imageryCount + ' · 数据源 ' + dataSources,
      detail: '图层 ' + layerList().length + ' 个（含地形阴影/风场）',
    });
    return rows;
  }

  function refreshDataStatus() {
    const box = byId('data-status');
    if (!box) return null;
    const rows = dataRows();
    box.innerHTML = '';
    for (const row of rows) {
      const li = el('li', 'data-row');
      li.dataset.key = row.key;
      li.dataset.ok = row.ok ? '1' : '0';
      const head = el('div', 'data-head');
      head.appendChild(el('span', 'data-dot ' + (row.ok ? 'on' : 'off'), row.ok ? '●' : '○'));
      head.appendChild(el('span', 'data-label', row.label));
      head.appendChild(el('span', 'data-text', row.text));
      li.appendChild(head);
      if (row.detail) li.appendChild(el('div', 'data-detail', row.detail));
      box.appendChild(li);
    }
    const badge = byId('data-state');
    if (badge) {
      const okCount = rows.filter((r) => r.ok).length;
      badge.textContent = okCount + '/' + rows.length;
      badge.classList.toggle('on', okCount === rows.length);
    }
    return rows;
  }

  async function loadMissingVectors() {
    const le = getLE();
    if (!le || !window.LEImports || typeof window.LEImports.importUrl !== 'function') return [];
    const missing = VECTOR_SPECS.filter((spec) => !hasLayerMatching(spec.match));
    if (!missing.length) {
      if (le.toast) le.toast('矢量数据已全部加载', 'ok', 2600);
      refreshDataStatus();
      return [];
    }
    const loaded = [];
    if (le.setLoading) le.setLoading(true, '正在加载本地矢量…');
    try {
      for (const spec of missing) {
        try {
          await window.LEImports.importUrl(spec.url);
          loaded.push(spec.label);
        } catch (err) {
          console.warn('[LELayerPanel] 矢量加载失败', spec.url, err);
          if (le.toast) le.toast(spec.label + ' 加载失败：' + (err && err.message ? err.message : err), 'error', 4200);
        }
      }
    } finally {
      if (le.setLoading) le.setLoading(false);
    }
    refreshDataStatus();
    if (loaded.length && le.toast) le.toast('已加载矢量：' + loaded.join('、'), 'ok', 3200);
    return loaded;
  }

  async function ensureTerrain() {
    const le = getLE();
    if (!window.LETerrain) return false;
    if (window.LETerrain.isEnabled()) {
      if (le && le.toast) le.toast('3D 地形已开启', 'ok', 2200);
      refreshDataStatus();
      return true;
    }
    try {
      await window.LETerrain.toggle(le);
    } catch (err) {
      console.warn('[LELayerPanel] 地形开启失败', err);
    }
    refreshDataStatus();
    return !!(window.LETerrain && window.LETerrain.isEnabled());
  }

  function ensureImagery() {
    const le = getLE();
    if (!window.LETerrain) return false;
    const enabled = window.LETerrain.isImageryEnabled ? window.LETerrain.isImageryEnabled() : false;
    if (!enabled) window.LETerrain.toggleImagery(le);
    else if (le && le.toast) le.toast('卫星影像已开启', 'ok', 2200);
    refreshDataStatus();
    return !!window.LETerrain.isImageryEnabled();
  }

  /* --------------------- 本地 XYZ 瓦片目录（File 对象） --------------------- */

  function parseXyzFiles(fileList) {
    const map = new Map();
    let root = '';
    let maxLevel = 0;
    let minLevel = Infinity;
    for (const file of fileList) {
      const rel = file.webkitRelativePath || file.name;
      const m = rel.match(/(?:^|\/)(\d+)\/(\d+)\/(\d+)\.(png|jpe?g|webp)$/i);
      if (!m) continue;
      const z = parseInt(m[1], 10);
      const x = parseInt(m[2], 10);
      const y = parseInt(m[3], 10);
      if (!isFinite(z) || !isFinite(x) || !isFinite(y)) continue;
      map.set(z + '/' + x + '/' + y, file);
      if (z > maxLevel) maxLevel = z;
      if (z < minLevel) minLevel = z;
      if (!root) {
        const idx = rel.indexOf('/');
        root = idx > 0 ? rel.slice(0, idx) : '';
        // 目录名可能恰好是纯数字（如直接选了 "5" 目录），此时用通用名称而不是层级号
        if (/^\d+$/.test(root)) root = '';
      }
    }
    return { map, minLevel: isFinite(minLevel) ? minLevel : 0, maxLevel, root };
  }

  let transparentTile = null;
  function transparentImage() {
    if (transparentTile) return Promise.resolve(transparentTile);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        transparentTile = img;
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    });
  }

  function createFileXyzLayer(files) {
    const le = getLE();
    const viewer = viewerOf();
    if (!le || !viewer || !C) return null;
    const parsed = parseXyzFiles(files);
    if (!parsed.map.size) throw new Error('目录中没有找到 z/x/y.png|jpg 结构的 XYZ 瓦片');
    const tilingScheme = new C.WebMercatorTilingScheme();
    // 由已发现的瓦片推导大致范围（取最大层级的四角 union）
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const key of parsed.map.keys()) {
      const parts = key.split('/');
      const z = parseInt(parts[0], 10);
      if (z !== parsed.maxLevel) continue;
      const rect = tilingScheme.tileXYToRectangle(parseInt(parts[1], 10), parseInt(parts[2], 10), z);
      if (rect.west < west) west = rect.west;
      if (rect.south < south) south = rect.south;
      if (rect.east > east) east = rect.east;
      if (rect.north > north) north = rect.north;
    }
    const rectangle =
      isFinite(west) && isFinite(south) && isFinite(east) && isFinite(north)
        ? new C.Rectangle(west, south, east, north)
        : tilingScheme.rectangle;
    const errorEvent = new C.Event();
    errorEvent.addEventListener((err) => {
      console.debug('[LELayerPanel] 本地 XYZ 瓦片不可用：' + (err && err.message ? err.message : err));
    });
    const provider = {
      tileWidth: 256,
      tileHeight: 256,
      minimumLevel: parsed.minLevel,
      maximumLevel: parsed.maxLevel,
      tilingScheme,
      rectangle,
      errorEvent,
      // Cesium 的 CreditDisplay 会调用 credit.isIon()，必须是 Cesium.Credit 实例而不是字符串
      credit: new C.Credit('本地 XYZ 目录：' + (parsed.root || 'tiles')),
      hasAlphaChannel: true,
      proxy: undefined,
      tileDiscardPolicy: undefined,
      getTileCredits() {
        return undefined;
      },
      pickFeatures() {
        return undefined;
      },
      requestImage(x, y, level) {
        const file = parsed.map.get(level + '/' + x + '/' + y);
        if (!file) return transparentImage();
        return new Promise((resolve, reject) => {
          const url = URL.createObjectURL(file);
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('本地瓦片解码失败：' + file.name));
          };
          img.src = url;
        });
      },
    };
    const imageryLayer = viewer.imageryLayers.addImageryProvider(provider);
    imageryLayer.alpha = 1;
    try {
      viewer.imageryLayers.raiseToTop(imageryLayer);
    } catch (err) {
      /* ignore */
    }
    const entry = le.registerLayer({
      name: '本地 XYZ 目录：' + (parsed.root || 'tiles') + '（z' + parsed.minLevel + '–' + parsed.maxLevel + '）',
      type: 'imagery',
      imageryLayer,
      remove: () => viewer.imageryLayers.remove(imageryLayer, true),
      zoomTo: () => viewer.camera.flyTo({ destination: rectangle, duration: 1.4 }),
    });
    refreshDataStatus();
    return { entry, tiles: parsed.map.size, minLevel: parsed.minLevel, maxLevel: parsed.maxLevel };
  }

  function bindDataPanel() {
    if (state.dataBound) return;
    state.dataBound = true;
    const on = (id, fn) => {
      const node = byId(id);
      if (node) node.addEventListener('click', fn);
    };
    on('btn-data-refresh', () => {
      refreshDataStatus();
      const le = getLE();
      if (le && le.toast) le.toast('数据状态已刷新', 'ok', 2000);
    });
    on('btn-data-terrain', () => ensureTerrain());
    on('btn-data-imagery', () => ensureImagery());
    on('btn-data-vectors', () => loadMissingVectors());
    on('btn-xyz-dir', () => {
      const input = byId('xyz-dir-input');
      if (input) input.click();
    });
    const fileInput = byId('xyz-dir-input');
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files || []);
        fileInput.value = '';
        if (!files.length) return;
        const le = getLE();
        try {
          const result = createFileXyzLayer(files);
          if (le && le.toast) {
            le.toast('已加载本地 XYZ 目录：' + result.tiles + ' 张瓦片（z' + result.minLevel + '–' + result.maxLevel + '）', 'ok', 3800);
          }
        } catch (err) {
          console.error('[LELayerPanel] 本地 XYZ 目录加载失败', err);
          if (le && le.toast) le.toast('XYZ 目录加载失败：' + (err && err.message ? err.message : err), 'error', 4600);
        }
      });
    }
    refreshDataStatus();
    // 地形大源/影像按需加载完成后状态会变化：低频刷新数据面板（只读 stats，开销很小）
    setInterval(() => {
      if (!document.hidden) refreshDataStatus();
    }, 5000);
  }

  /* ------------------------------ 初始化 ------------------------------ */

  function bindSearch() {
    if (state.searchBound) return;
    state.searchBound = true;
    const input = byId('layer-search');
    if (!input) return;
    input.addEventListener('input', () => setQuery(input.value));
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        input.value = '';
        setQuery('');
        input.blur();
      }
    });
  }

  function init(le) {
    state.le = le || window.LE;
    bindSearch();
    bindDataPanel();
    refresh(state.le && state.le.listLayers ? state.le.listLayers() : []);
    return getGroups();
  }

  window.LELayerPanel = {
    init,
    refresh,
    setQuery,
    getGroups,
    refreshDataStatus,
    loadMissingVectors,
    ensureTerrain,
    ensureImagery,
    createFileXyzLayer,
    // 测试辅助：读取当前数据状态行
    getDataRows: () => dataRows(),
  };

  // 模块自行初始化：main.js 启动完成后派发 local-earth-ready
  if (window.LE && window.LE.viewer) {
    init(window.LE);
  } else {
    document.addEventListener('local-earth-ready', (ev) => init((ev && ev.detail) || window.LE), { once: true });
  }
})();

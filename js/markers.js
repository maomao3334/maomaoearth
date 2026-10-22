/**
 * 坐标标点（v0.6.0）
 * 支持十进制度/度分秒输入、单行粘贴、地图选点、名称/备注/颜色、列表管理、拖拽、
 * CSV/GeoJSON/KML 导出与 CSV/GeoJSON 导入、工程保存/恢复。
 * 仅 WGS84 经纬度；完全离线。
 */
(function () {
  'use strict';

  const C = window.Cesium;
  const STORE_FORMAT = 'localEarth.markerFormat';
  const COLOR_DEFAULT = '#ffd166';
  const state = {
    le: null,
    dataSource: null,
    layer: null,
    markers: new Map(),
    seq: 0,
    editingId: null,
    activeTab: 'dec',
    displayFormat: 'dec',
    drag: null,
    pickHandler: null,
    dragHandler: null,
    dblHandler: null,
    savedDblClick: null,
    dialog: null,
    listDialog: null,
    batchDialog: null,
  };

  /* ------------------------------ 基础工具 ------------------------------ */

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function formatDecimal(value, digits) {
    const n = Number(value);
    if (!isFinite(n)) return '';
    return n.toFixed(digits == null ? 6 : digits);
  }

  function decimalToDms(value, isLat) {
    const n = Number(value);
    if (!isFinite(n)) return '';
    const hemi = isLat ? (n < 0 ? 'S' : 'N') : (n < 0 ? 'W' : 'E');
    let abs = Math.abs(n);
    let d = Math.floor(abs);
    let m = Math.floor((abs - d) * 60);
    let s = ((abs - d) * 60 - m) * 60;
    if (s >= 59.9995) {
      s = 0;
      m += 1;
      if (m >= 60) {
        m = 0;
        d += 1;
      }
    }
    return d + '°' + pad2(m) + '′' + s.toFixed(1) + '″' + hemi;
  }

  function parseDms(text, axis) {
    let s = String(text == null ? '' : text).trim();
    if (!s) return NaN;
    s = s.replace(/[º˚]/g, '°').replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
    let hemi = '';
    const pre = /^([NSEW])\s*/i.exec(s);
    if (pre) {
      hemi = pre[1].toUpperCase();
      s = s.slice(pre[0].length);
    }
    const post = /\s*([NSEW])\s*$/i.exec(s);
    if (!hemi && post) {
      hemi = post[1].toUpperCase();
      s = s.slice(0, post.index);
    }
    const nums = s.match(/-?\d+(?:\.\d+)?/g);
    if (!nums || !nums.length) return NaN;
    const deg = Math.abs(Number(nums[0]));
    const min = nums.length > 1 ? Number(nums[1]) : 0;
    const sec = nums.length > 2 ? Number(nums[2]) : 0;
    if (![deg, min, sec].every(isFinite)) return NaN;
    if (min < 0 || min >= 60 || sec < 0 || sec >= 60) return NaN;
    let sign = Number(nums[0]) < 0 ? -1 : 1;
    if (hemi === 'S' || hemi === 'W') sign = -1;
    if (hemi === 'N' || hemi === 'E') sign = 1;
    const val = sign * (deg + min / 60 + sec / 3600);
    if (axis === 'lat' && Math.abs(val) > 90) return NaN;
    if (axis === 'lon' && Math.abs(val) > 180) return NaN;
    return val;
  }

  function parseAny(text, axis) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return NaN;
    if (/[NSEW]/i.test(s) || /[°'"′″]/.test(s)) return parseDms(s, axis);
    const n = Number(s);
    if (!isFinite(n)) return NaN;
    if (axis === 'lat' && Math.abs(n) > 90) return NaN;
    if (axis === 'lon' && Math.abs(n) > 180) return NaN;
    return n;
  }

  function parsePair(text) {
    const s = String(text || '').trim();
    if (!s) throw new Error('请输入坐标');
    const parts = s.split(/[,，;；]/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (parts.length >= 2) {
      return { lat: parseAny(parts[0], 'lat'), lon: parseAny(parts[1], 'lon') };
    }
    const nums = s.match(/-?\d+(?:\.\d+)?/g);
    if (nums && nums.length >= 2 && !/[NSEW]/i.test(s)) {
      return { lat: parseAny(nums[0], 'lat'), lon: parseAny(nums[1], 'lon') };
    }
    // 无逗号的度分秒：按 N/S 与 E/W 分组
    const tokens = s.match(/[NSEW]?\s*\d+(?:\.\d+)?(?:\s*[°º][^NSEW\d]*\d+(?:\.\d+)?(?:\s*['′][^NSEW\d]*\d+(?:\.\d+)?)?)?\s*[NSEW]?/gi);
    if (tokens && tokens.length >= 2) {
      return { lat: parseAny(tokens[0], 'lat'), lon: parseAny(tokens[1], 'lon') };
    }
    throw new Error('无法识别坐标，请用逗号分隔纬度、经度');
  }

  function validPoint(lat, lon) {
    return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }

  function colorOf(value) {
    try {
      return C.Color.fromCssColorString(value || COLOR_DEFAULT) || C.Color.fromCssColorString(COLOR_DEFAULT);
    } catch (err) {
      return C.Color.fromCssColorString(COLOR_DEFAULT);
    }
  }

  function markerDescription(record) {
    return '<div><b>' + esc(record.name) + '</b></div>' +
      '<div>十进制度：' + formatDecimal(record.lat, 6) + ', ' + formatDecimal(record.lon, 6) + '</div>' +
      '<div>度分秒：' + decimalToDms(record.lat, true) + ', ' + decimalToDms(record.lon, false) + '</div>' +
      (record.heightMode === 'absolute' ? '<div>高度：' + record.height + ' m</div>' : '<div>高度：贴地</div>') +
      (record.note ? '<div>备注：' + esc(record.note) + '</div>' : '');
  }

  /* ------------------------------ 图层 / 实体 ------------------------------ */

  function viewerOf() {
    return state.le && state.le.viewer ? state.le.viewer : null;
  }

  async function ensureLayer(le) {
    if (le) state.le = le;
    const viewer = viewerOf();
    if (!viewer) throw new Error('应用尚未就绪');
    if (state.dataSource && viewer.dataSources.contains && viewer.dataSources.contains(state.dataSource)) return state.dataSource;
    state.dataSource = new C.CustomDataSource('标记点');
    await viewer.dataSources.add(state.dataSource);
    state.layer = state.le.registerLayer({
      id: 'markers',
      name: '标记点',
      type: 'vector',
      datasource: state.dataSource,
      meta: { markers: true },
      remove: function () {
        try { viewer.dataSources.remove(state.dataSource, true); } catch (err) { /* ignore */ }
        state.dataSource = null;
        state.layer = null;
        state.markers.clear();
        updateCount();
      },
    });
    return state.dataSource;
  }

  function makeEntity(record) {
    const viewer = viewerOf();
    const color = colorOf(record.color);
    const heightReference = record.heightMode === 'absolute' ? C.HeightReference.NONE : C.HeightReference.CLAMP_TO_GROUND;
    const height = record.heightMode === 'absolute' ? Number(record.height) || 0 : 0;
    const entity = state.dataSource.entities.add({
      id: 'marker-' + record.id,
      name: record.name,
      description: markerDescription(record),
      position: C.Cartesian3.fromDegrees(record.lon, record.lat, height),
      point: {
        pixelSize: 11,
        color: color,
        outlineColor: C.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: heightReference,
      },
      label: {
        text: record.name,
        font: '14px "Microsoft YaHei", sans-serif',
        fillColor: C.Color.WHITE,
        outlineColor: C.Color.BLACK,
        outlineWidth: 3,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new C.Cartesian2(0, -26),
        verticalOrigin: C.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: C.Color.fromCssColorString('rgba(0,0,0,0.55)'),
        heightReference: heightReference,
      },
    });
    entity.__leMarkerId = record.id;
    record.entity = entity;
    return entity;
  }

  function refreshEntity(record) {
    if (!record.entity) return makeEntity(record);
    record.entity.name = record.name;
    record.entity.description = markerDescription(record);
    record.entity.position = C.Cartesian3.fromDegrees(record.lon, record.lat, record.heightMode === 'absolute' ? Number(record.height) || 0 : 0);
    const color = colorOf(record.color);
    if (record.entity.point) record.entity.point.color = color;
    if (record.entity.point) record.entity.point.heightReference = record.heightMode === 'absolute' ? C.HeightReference.NONE : C.HeightReference.CLAMP_TO_GROUND;
    if (record.entity.label) {
      record.entity.label.text = record.name;
      record.entity.label.heightReference = record.heightMode === 'absolute' ? C.HeightReference.NONE : C.HeightReference.CLAMP_TO_GROUND;
    }
    return record.entity;
  }

  function updateCount() {
    const el = document.getElementById('marker-count');
    if (el) el.textContent = String(state.markers.size);
    const listCount = document.getElementById('marker-list-count');
    if (listCount) listCount.textContent = String(state.markers.size);
  }

  function listRecords() {
    return Array.from(state.markers.values()).slice().sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name), 'zh-CN');
    });
  }

  /* ------------------------------ 增删改 ------------------------------ */

  async function add(record, opts) {
    const o = opts || {};
    await ensureLayer(state.le);
    const lat = Number(record.lat);
    const lon = Number(record.lon);
    if (!validPoint(lat, lon)) throw new Error('经纬度超出范围');
    const id = record.id || ('m-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7));
    const rec = {
      id: id,
      name: String(record.name || ('标记点 ' + (state.markers.size + 1))).trim() || ('标记点 ' + (state.markers.size + 1)),
      note: String(record.note || ''),
      lat: lat,
      lon: lon,
      height: Number(record.height) || 0,
      heightMode: record.heightMode === 'absolute' ? 'absolute' : 'clamp',
      color: record.color || COLOR_DEFAULT,
      labelVisible: record.labelVisible !== false,
    };
    if (state.markers.has(id)) {
      const old = state.markers.get(id);
      Object.assign(old, rec);
      refreshEntity(old);
    } else {
      state.markers.set(id, rec);
      makeEntity(rec);
    }
    updateCount();
    if (o.fly && state.le && state.le.flyTo) {
      state.le.flyTo({ longitude: lon, latitude: lat, height: Math.max(5000, rec.height || 0) });
    }
    if (!o.silent && state.le && state.le.toast) state.le.toast('已标记：' + rec.name, 'ok', 2200);
    return rec;
  }

  async function addMany(records, opts) {
    let count = 0;
    for (const rec of records || []) {
      try {
        await add(rec, { silent: true, fly: false });
        count++;
      } catch (err) { /* skip invalid row */ }
    }
    updateCount();
    if (state.le && state.le.toast) state.le.toast('已添加 ' + count + ' 个标记点', 'ok', 2600);
    return count;
  }

  function remove(id) {
    const rec = state.markers.get(id);
    if (!rec) return false;
    if (rec.entity && state.dataSource) {
      try { state.dataSource.entities.remove(rec.entity); } catch (err) { /* ignore */ }
    }
    state.markers.delete(id);
    updateCount();
    renderList();
    return true;
  }

  function clear() {
    for (const rec of Array.from(state.markers.values())) {
      if (rec.entity && state.dataSource) {
        try { state.dataSource.entities.remove(rec.entity); } catch (err) { /* ignore */ }
      }
    }
    state.markers.clear();
    updateCount();
    renderList();
  }

  function getProjectState() {
    return listRecords().map(function (r) {
      return {
        id: r.id,
        name: r.name,
        note: r.note,
        lat: r.lat,
        lon: r.lon,
        height: r.height,
        heightMode: r.heightMode,
        color: r.color,
        labelVisible: r.labelVisible,
      };
    });
  }

  async function restoreProjectState(records) {
    clear();
    await addMany(records || [], { silent: true });
    return listRecords();
  }

  /* ------------------------------ 对话框 ------------------------------ */

  function ensureDialog() {
    if (state.dialog) return state.dialog;
    const dlg = document.createElement('div');
    dlg.id = 'marker-dialog';
    dlg.className = 'modal hidden';
    dlg.innerHTML =
      '<div class="modal-card marker-card">' +
      '<h2 id="marker-title">坐标标点</h2>' +
      '<div class="marker-tabs">' +
      '<button type="button" class="marker-tab active" data-marker-tab="dec">十进制度</button>' +
      '<button type="button" class="marker-tab" data-marker-tab="dms">度分秒</button>' +
      '</div>' +
      '<div data-marker-panel="dec">' +
      '<div class="field"><label>纬度（-90 ~ 90）</label><input id="marker-lat" type="text" placeholder="25.123456" /></div>' +
      '<div class="field"><label>经度（-180 ~ 180）</label><input id="marker-lon" type="text" placeholder="102.567890" /></div>' +
      '</div>' +
      '<div data-marker-panel="dms" class="hidden">' +
      '<div class="field"><label>纬度（度分秒）</label><input id="marker-lat-dms" type="text" placeholder="25°07′24.5″N" /></div>' +
      '<div class="field"><label>经度（度分秒）</label><input id="marker-lon-dms" type="text" placeholder="102°34′02.1″E" /></div>' +
      '</div>' +
      '<div class="field marker-paste"><label>快速粘贴（纬度,经度）</label><div class="marker-inline"><input id="marker-paste" type="text" placeholder="25.123456, 102.567890 或 25°07′24.5″N, 102°34′02.1″E" /><button type="button" id="marker-parse" class="btn subtle">解析</button></div></div>' +
      '<div class="field"><label>名称</label><input id="marker-name" type="text" placeholder="例如：观测点 A" /></div>' +
      '<div class="field"><label>备注（可选）</label><input id="marker-note" type="text" placeholder="备注信息" /></div>' +
      '<div class="marker-row">' +
      '<div class="field"><label>颜色</label><input id="marker-color" type="color" value="' + COLOR_DEFAULT + '" /></div>' +
      '<div class="field"><label>高度</label><select id="marker-height-mode"><option value="clamp">贴地</option><option value="absolute">自定义高度</option></select></div>' +
      '<div class="field"><label>高度（米）</label><input id="marker-height" type="number" value="0" min="0" step="1" disabled /></div>' +
      '</div>' +
      '<label class="marker-check"><input id="marker-label-visible" type="checkbox" checked /> 显示名称标签</label>' +
      '<div class="marker-preview" id="marker-preview">十进制度：--<br>度分秒：--</div>' +
      '<div class="error" id="marker-error"></div>' +
      '<div class="actions marker-actions">' +
      '<button type="button" class="btn subtle" id="marker-pick">地图选点</button>' +
      '<button type="button" class="btn subtle" id="marker-center">取视图中心</button>' +
      '<button type="button" class="btn" id="marker-cancel">取消</button>' +
      '<button type="button" class="btn primary" id="marker-save">标记</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(dlg);
    state.dialog = dlg;

    dlg.querySelectorAll('[data-marker-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-marker-tab')); });
    });
    dlg.querySelector('#marker-parse').addEventListener('click', function () {
      try {
        const pair = parsePair(dlg.querySelector('#marker-paste').value);
        setCoordinates(pair.lat, pair.lon);
        setError('');
      } catch (err) {
        setError(err.message);
      }
    });
    dlg.querySelector('#marker-height-mode').addEventListener('change', function () {
      dlg.querySelector('#marker-height').disabled = this.value !== 'absolute';
    });
    ['#marker-lat', '#marker-lon', '#marker-lat-dms', '#marker-lon-dms'].forEach(function (sel) {
      const el = dlg.querySelector(sel);
      if (el) el.addEventListener('input', syncPreview);
    });
    dlg.querySelector('#marker-pick').addEventListener('click', pickOnMap);
    dlg.querySelector('#marker-center').addEventListener('click', useViewCenter);
    dlg.querySelector('#marker-cancel').addEventListener('click', function () { dlg.classList.add('hidden'); });
    dlg.querySelector('#marker-save').addEventListener('click', saveDialog);
    dlg.addEventListener('click', function (ev) {
      if (ev.target === dlg) dlg.classList.add('hidden');
    });
    return dlg;
  }

  function setError(message) {
    const el = state.dialog && state.dialog.querySelector('#marker-error');
    if (el) el.textContent = message || '';
  }

  function setCoordinates(lat, lon) {
    const dlg = state.dialog;
    if (!dlg) return;
    dlg.querySelector('#marker-lat').value = formatDecimal(lat, 6);
    dlg.querySelector('#marker-lon').value = formatDecimal(lon, 6);
    dlg.querySelector('#marker-lat-dms').value = decimalToDms(lat, true);
    dlg.querySelector('#marker-lon-dms').value = decimalToDms(lon, false);
    syncPreview();
  }

  function switchTab(tab) {
    state.activeTab = tab === 'dms' ? 'dms' : 'dec';
    const dlg = state.dialog;
    if (!dlg) return;
    dlg.querySelectorAll('[data-marker-tab]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-marker-tab') === state.activeTab);
    });
    dlg.querySelectorAll('[data-marker-panel]').forEach(function (p) {
      p.classList.toggle('hidden', p.getAttribute('data-marker-panel') !== state.activeTab);
    });
    // 切换时把当前值换算到另一模式
    try {
      const pair = currentPair(false);
      if (validPoint(pair.lat, pair.lon)) {
        if (state.activeTab === 'dms') {
          dlg.querySelector('#marker-lat-dms').value = decimalToDms(pair.lat, true);
          dlg.querySelector('#marker-lon-dms').value = decimalToDms(pair.lon, false);
        } else {
          dlg.querySelector('#marker-lat').value = formatDecimal(pair.lat, 6);
          dlg.querySelector('#marker-lon').value = formatDecimal(pair.lon, 6);
        }
      }
    } catch (err) { /* ignore */ }
    syncPreview();
  }

  function currentPair(throwOnError) {
    const dlg = state.dialog;
    if (!dlg) throw new Error('对话框未初始化');
    let lat;
    let lon;
    if (state.activeTab === 'dms') {
      lat = parseAny(dlg.querySelector('#marker-lat-dms').value, 'lat');
      lon = parseAny(dlg.querySelector('#marker-lon-dms').value, 'lon');
    } else {
      lat = parseAny(dlg.querySelector('#marker-lat').value, 'lat');
      lon = parseAny(dlg.querySelector('#marker-lon').value, 'lon');
    }
    if (!validPoint(lat, lon)) {
      if (throwOnError) throw new Error('请输入有效纬度（-90~90）和经度（-180~180）');
      return { lat: NaN, lon: NaN };
    }
    return { lat: lat, lon: lon };
  }

  function syncPreview() {
    if (!state.dialog) return;
    try {
      const pair = currentPair(false);
      const el = state.dialog.querySelector('#marker-preview');
      if (!el) return;
      if (!validPoint(pair.lat, pair.lon)) {
        el.innerHTML = '十进制度：--<br>度分秒：--';
        return;
      }
      el.innerHTML = '十进制度：' + formatDecimal(pair.lat, 6) + ', ' + formatDecimal(pair.lon, 6) +
        '<br>度分秒：' + decimalToDms(pair.lat, true) + ', ' + decimalToDms(pair.lon, false);
    } catch (err) { /* ignore */ }
  }

  function openDialog(record) {
    const dlg = ensureDialog();
    state.editingId = record && record.id ? record.id : null;
    const rec = record || {};
    dlg.querySelector('#marker-title').textContent = state.editingId ? '编辑标记点' : '坐标标点';
    dlg.querySelector('#marker-name').value = rec.name || ('标记点 ' + (state.markers.size + 1));
    dlg.querySelector('#marker-note').value = rec.note || '';
    dlg.querySelector('#marker-color').value = rec.color || COLOR_DEFAULT;
    dlg.querySelector('#marker-height-mode').value = rec.heightMode || 'clamp';
    dlg.querySelector('#marker-height').value = rec.height || 0;
    dlg.querySelector('#marker-height').disabled = (rec.heightMode || 'clamp') !== 'absolute';
    dlg.querySelector('#marker-label-visible').checked = rec.labelVisible !== false;
    dlg.querySelector('#marker-paste').value = '';
    setError('');
    switchTab('dec');
    if (isFinite(rec.lat) && isFinite(rec.lon)) setCoordinates(rec.lat, rec.lon);
    else {
      dlg.querySelector('#marker-lat').value = '';
      dlg.querySelector('#marker-lon').value = '';
      dlg.querySelector('#marker-lat-dms').value = '';
      dlg.querySelector('#marker-lon-dms').value = '';
      syncPreview();
    }
    dlg.classList.remove('hidden');
    const name = dlg.querySelector('#marker-name');
    if (name) { name.focus(); name.select(); }
  }

  async function saveDialog() {
    try {
      const pair = currentPair(true);
      const dlg = state.dialog;
      const rec = {
        id: state.editingId || undefined,
        name: dlg.querySelector('#marker-name').value.trim(),
        note: dlg.querySelector('#marker-note').value.trim(),
        lat: pair.lat,
        lon: pair.lon,
        color: dlg.querySelector('#marker-color').value || COLOR_DEFAULT,
        heightMode: dlg.querySelector('#marker-height-mode').value,
        height: Number(dlg.querySelector('#marker-height').value) || 0,
        labelVisible: dlg.querySelector('#marker-label-visible').checked,
      };
      await add(rec, { fly: !state.editingId, silent: false });
      dlg.classList.add('hidden');
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  function useViewCenter() {
    const viewer = viewerOf();
    if (!viewer) return;
    const carto = viewer.camera.positionCartographic;
    setCoordinates(C.Math.toDegrees(carto.latitude), C.Math.toDegrees(carto.longitude));
  }

  function pickOnMap() {
    const viewer = viewerOf();
    if (!viewer) return;
    const dlg = state.dialog;
    if (!dlg) return;
    dlg.classList.add('hidden');
    if (state.pickHandler) {
      try { state.pickHandler.destroy(); } catch (err) { /* ignore */ }
    }
    const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    state.pickHandler = handler;
    if (state.le && state.le.status) state.le.status('请在地图上单击选择标记点位置');
    handler.setInputAction(function (movement) {
      try {
        let cartesian = null;
        const ray = viewer.camera.getPickRay(movement.position);
        if (ray) cartesian = viewer.scene.globe.pick(ray, viewer.scene);
        if (!cartesian) cartesian = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
        if (!cartesian) return;
        const carto = C.Cartographic.fromCartesian(cartesian);
        const lat = C.Math.toDegrees(carto.latitude);
        const lon = C.Math.toDegrees(carto.longitude);
        setCoordinates(lat, lon);
        dlg.classList.remove('hidden');
        if (state.le && state.le.status) state.le.status('已选择：' + formatDecimal(lat, 6) + ', ' + formatDecimal(lon, 6));
      } finally {
        try { handler.destroy(); } catch (err) { /* ignore */ }
        state.pickHandler = null;
      }
    }, C.ScreenSpaceEventType.LEFT_CLICK);
  }

  /* ------------------------------ 列表 / 导入导出 ------------------------------ */

  function ensureListDialog() {
    if (state.listDialog) return state.listDialog;
    const dlg = document.createElement('div');
    dlg.id = 'marker-list-dialog';
    dlg.className = 'modal hidden';
    dlg.innerHTML =
      '<div class="modal-card marker-list-card">' +
      '<h2>标记点 <span id="marker-list-count" class="count">0</span></h2>' +
      '<div class="marker-list-toolbar">' +
      '<input id="marker-search" type="text" placeholder="搜索名称/坐标" />' +
      '<select id="marker-display-format"><option value="dec">十进制度</option><option value="dms">度分秒</option></select>' +
      '</div>' +
      '<div class="marker-list-actions">' +
      '<button type="button" class="btn subtle" id="marker-batch-open">批量粘贴</button>' +
      '<button type="button" class="btn subtle" id="marker-import">导入 CSV/GeoJSON</button>' +
      '<button type="button" class="btn subtle" id="marker-export-csv">导出 CSV</button>' +
      '<button type="button" class="btn subtle" id="marker-export-geojson">导出 GeoJSON</button>' +
      '<button type="button" class="btn subtle" id="marker-export-kml">导出 KML</button>' +
      '</div>' +
      '<div class="marker-table-wrap"><table class="marker-table"><thead><tr><th>名称</th><th>坐标</th><th>操作</th></tr></thead><tbody id="marker-tbody"></tbody></table></div>' +
      '<div class="actions"><button type="button" class="btn" id="marker-list-close">关闭</button><button type="button" class="btn primary" id="marker-list-add">新增标记</button></div>' +
      '<input id="marker-file-input" type="file" accept=".csv,.geojson,.json" class="hidden-input" />' +
      '</div>';
    document.body.appendChild(dlg);
    state.listDialog = dlg;

    dlg.querySelector('#marker-list-close').addEventListener('click', function () { dlg.classList.add('hidden'); });
    dlg.querySelector('#marker-list-add').addEventListener('click', function () { dlg.classList.add('hidden'); openDialog(); });
    dlg.querySelector('#marker-search').addEventListener('input', renderList);
    dlg.querySelector('#marker-display-format').addEventListener('change', function () {
      state.displayFormat = this.value === 'dms' ? 'dms' : 'dec';
      try { localStorage.setItem(STORE_FORMAT, state.displayFormat); } catch (err) { /* ignore */ }
      renderList();
    });
    dlg.querySelector('#marker-batch-open').addEventListener('click', openBatchDialog);
    dlg.querySelector('#marker-import').addEventListener('click', function () { dlg.querySelector('#marker-file-input').click(); });
    dlg.querySelector('#marker-file-input').addEventListener('change', function () {
      const file = this.files && this.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          if (/\.(geojson|json)$/i.test(file.name)) importGeoJsonText(String(reader.result || ''));
          else importCsvText(String(reader.result || ''));
        } catch (err) {
          if (state.le && state.le.toast) state.le.toast('导入失败：' + (err.message || err), 'error', 5000);
        }
      };
      reader.readAsText(file, 'utf-8');
      this.value = '';
    });
    dlg.querySelector('#marker-export-csv').addEventListener('click', exportCsv);
    dlg.querySelector('#marker-export-geojson').addEventListener('click', exportGeoJSON);
    dlg.querySelector('#marker-export-kml').addEventListener('click', exportKml);
    dlg.querySelector('#marker-tbody').addEventListener('click', function (ev) {
      const btn = ev.target.closest('button[data-marker-action]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-marker-action');
      const rec = state.markers.get(id);
      if (!rec) return;
      if (action === 'fly') {
        if (state.le && state.le.flyTo) state.le.flyTo({ longitude: rec.lon, latitude: rec.lat, height: Math.max(5000, rec.height || 0) });
      } else if (action === 'edit') {
        dlg.classList.add('hidden');
        openDialog(rec);
      } else if (action === 'delete') {
        remove(id);
        if (state.le && state.le.toast) state.le.toast('已删除：' + rec.name, 'ok', 2000);
      }
    });
    try {
      const saved = localStorage.getItem(STORE_FORMAT);
      if (saved === 'dms' || saved === 'dec') {
        state.displayFormat = saved;
        dlg.querySelector('#marker-display-format').value = saved;
      }
    } catch (err) { /* ignore */ }
    return dlg;
  }

  function openList() {
    const dlg = ensureListDialog();
    dlg.classList.remove('hidden');
    updateCount();
    renderList();
  }

  function renderList() {
    const dlg = state.listDialog;
    if (!dlg) return;
    updateCount();
    const q = String(dlg.querySelector('#marker-search').value || '').trim().toLowerCase();
    const tbody = dlg.querySelector('#marker-tbody');
    if (!tbody) return;
    const rows = listRecords().filter(function (r) {
      if (!q) return true;
      return (r.name + ' ' + r.note + ' ' + formatDecimal(r.lat, 6) + ' ' + formatDecimal(r.lon, 6)).toLowerCase().indexOf(q) >= 0;
    });
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="marker-empty">暂无标记点</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (r) {
      const coord = state.displayFormat === 'dms'
        ? decimalToDms(r.lat, true) + ', ' + decimalToDms(r.lon, false)
        : formatDecimal(r.lat, 6) + ', ' + formatDecimal(r.lon, 6);
      return '<tr>' +
        '<td><span class="marker-dot" style="background:' + esc(r.color) + '"></span>' + esc(r.name) + (r.note ? '<div class="marker-note">' + esc(r.note) + '</div>' : '') + '</td>' +
        '<td class="marker-coord">' + esc(coord) + '</td>' +
        '<td class="marker-row-actions">' +
        '<button type="button" class="btn subtle" data-marker-action="fly" data-id="' + esc(r.id) + '">定位</button>' +
        '<button type="button" class="btn subtle" data-marker-action="edit" data-id="' + esc(r.id) + '">编辑</button>' +
        '<button type="button" class="btn subtle danger" data-marker-action="delete" data-id="' + esc(r.id) + '">删除</button>' +
        '</td></tr>';
    }).join('');
  }

  function ensureBatchDialog() {
    if (state.batchDialog) return state.batchDialog;
    const dlg = document.createElement('div');
    dlg.id = 'marker-batch-dialog';
    dlg.className = 'modal hidden';
    dlg.innerHTML =
      '<div class="modal-card marker-batch-card">' +
      '<h2>批量添加标记点</h2>' +
      '<p class="hint">每行一个：名称,纬度,经度[,高度]；也支持度分秒，例如：观测点A,25°07′24.5″N,102°34′02.1″E</p>' +
      '<textarea id="marker-batch-text" rows="8" placeholder="观测点A,25.123456,102.567890&#10;观测点B,25°07′24.5″N,102°34′02.1″E"></textarea>' +
      '<div class="error" id="marker-batch-error"></div>' +
      '<div class="actions"><button type="button" class="btn" id="marker-batch-cancel">取消</button><button type="button" class="btn primary" id="marker-batch-ok">添加</button></div>' +
      '</div>';
    document.body.appendChild(dlg);
    state.batchDialog = dlg;
    dlg.querySelector('#marker-batch-cancel').addEventListener('click', function () { dlg.classList.add('hidden'); });
    dlg.querySelector('#marker-batch-ok').addEventListener('click', async function () {
      try {
        const text = dlg.querySelector('#marker-batch-text').value;
        const records = parseBatchText(text);
        if (!records.length) throw new Error('没有识别到有效行');
        await addMany(records);
        dlg.classList.add('hidden');
        renderList();
      } catch (err) {
        dlg.querySelector('#marker-batch-error').textContent = err.message || String(err);
      }
    });
    return dlg;
  }

  function openBatchDialog() {
    const dlg = ensureBatchDialog();
    dlg.classList.remove('hidden');
    dlg.querySelector('#marker-batch-error').textContent = '';
    dlg.querySelector('#marker-batch-text').focus();
  }

  function parseBatchText(text) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach(function (line, index) {
      const s = line.trim();
      if (!s) return;
      const parts = splitCsvLine(s);
      if (parts.length < 3) return;
      try {
        out.push({
          name: parts[0].trim() || ('标记点 ' + (index + 1)),
          lat: parseAny(parts[1], 'lat'),
          lon: parseAny(parts[2], 'lon'),
          height: parts[3] ? Number(parts[3]) || 0 : 0,
          heightMode: parts[3] ? 'absolute' : 'clamp',
          color: COLOR_DEFAULT,
        });
      } catch (err) { /* skip */ }
    });
    return out.filter(function (r) { return validPoint(r.lat, r.lon); });
  }

  function splitCsvLine(line) {
    const out = [];
    let cur = '';
    let quote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quote && line[i + 1] === '"') { cur += '"'; i++; }
        else quote = !quote;
      } else if (ch === ',' && !quote) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function importCsvText(text) {
    const lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) return 0;
    let header = splitCsvLine(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
    let start = 1;
    const hasHeader = header.some(function (h) { return /^(name|名称|lat|latitude|纬度|lon|lng|longitude|经度)$/.test(h); });
    if (!hasHeader) {
      header = ['name', 'lat', 'lon', 'height', 'note', 'color'];
      start = 0;
    }
    function idx(names) {
      for (const n of names) {
        const i = header.indexOf(n);
        if (i >= 0) return i;
      }
      return -1;
    }
    const iName = idx(['name', '名称']);
    const iLat = idx(['lat', 'latitude', '纬度']);
    const iLon = idx(['lon', 'lng', 'longitude', '经度']);
    const iHeight = idx(['height', 'alt', '高度']);
    const iNote = idx(['note', '备注']);
    const iColor = idx(['color', '颜色']);
    const records = [];
    for (let i = start; i < lines.length; i++) {
      const p = splitCsvLine(lines[i]);
      if (p.length < 2) continue;
      const lat = parseAny(p[iLat >= 0 ? iLat : 1], 'lat');
      const lon = parseAny(p[iLon >= 0 ? iLon : 2], 'lon');
      if (!validPoint(lat, lon)) continue;
      records.push({
        name: (iName >= 0 ? p[iName] : p[0]) || ('标记点 ' + (records.length + 1)),
        lat: lat,
        lon: lon,
        height: iHeight >= 0 ? Number(p[iHeight]) || 0 : 0,
        heightMode: iHeight >= 0 ? 'absolute' : 'clamp',
        note: iNote >= 0 ? p[iNote] : '',
        color: iColor >= 0 ? p[iColor] : COLOR_DEFAULT,
      });
    }
    addMany(records);
    renderList();
    return records.length;
  }

  function importGeoJsonText(text) {
    const obj = JSON.parse(text);
    const features = obj && obj.type === 'FeatureCollection' ? obj.features : (obj && obj.type === 'Feature' ? [obj] : []);
    const records = [];
    for (const f of features || []) {
      if (!f || !f.geometry || f.geometry.type !== 'Point') continue;
      const c = f.geometry.coordinates || [];
      if (c.length < 2) continue;
      const p = f.properties || {};
      records.push({
        name: p.name || p.名称 || ('标记点 ' + (records.length + 1)),
        lat: Number(c[1]),
        lon: Number(c[0]),
        height: c.length > 2 ? Number(c[2]) || 0 : 0,
        heightMode: c.length > 2 ? 'absolute' : 'clamp',
        note: p.note || p.description || '',
        color: p.color || COLOR_DEFAULT,
      });
    }
    addMany(records);
    renderList();
    return records.length;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 500);
  }

  function exportCsv() {
    const rows = [['name', 'latitude', 'longitude', 'dms_latitude', 'dms_longitude', 'height', 'height_mode', 'color', 'note']];
    listRecords().forEach(function (r) {
      rows.push([r.name, formatDecimal(r.lat, 8), formatDecimal(r.lon, 8), decimalToDms(r.lat, true), decimalToDms(r.lon, false), r.height, r.heightMode, r.color, r.note]);
    });
    const text = rows.map(function (row) {
      return row.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    downloadBlob(new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }), 'markers-' + Date.now() + '.csv');
  }

  function exportGeoJSON() {
    const features = listRecords().map(function (r) {
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lon, r.lat, r.height] },
        properties: { name: r.name, note: r.note, color: r.color, heightMode: r.heightMode },
      };
    });
    downloadBlob(new Blob([JSON.stringify({ type: 'FeatureCollection', features: features }, null, 2)], { type: 'application/geo+json;charset=utf-8' }), 'markers-' + Date.now() + '.geojson');
  }

  function exportKml() {
    const placemarks = listRecords().map(function (r) {
      return '<Placemark><name>' + esc(r.name) + '</name><description>' + esc(r.note || '') + '</description>' +
        '<Point><coordinates>' + formatDecimal(r.lon, 8) + ',' + formatDecimal(r.lat, 8) + ',' + (r.height || 0) + '</coordinates></Point></Placemark>';
    }).join('');
    const kml = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>MaomaoEarth 标记点</name>' + placemarks + '</Document></kml>';
    downloadBlob(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' }), 'markers-' + Date.now() + '.kml');
  }

  /* ------------------------------ 拖拽 ------------------------------ */


  function pickCartographicAt(viewer, screenPos) {
    try {
      const scene = viewer.scene;
      const ray = viewer.camera.getPickRay(screenPos);
      let cartesian = ray ? scene.globe.pick(ray, scene) : null;
      if (!cartesian) cartesian = viewer.camera.pickEllipsoid(screenPos, scene.globe.ellipsoid);
      if (!cartesian) return null;
      const carto = C.Cartographic.fromCartesian(cartesian);
      if (!carto) return null;
      return { lat: C.Math.toDegrees(carto.latitude), lon: C.Math.toDegrees(carto.longitude) };
    } catch (err) {
      return null;
    }
  }

  function bindDoubleClick(le) {
    const viewer = viewerOf();
    if (!viewer || state.dblHandler) return;
    // 移除 Cesium 默认双击缩放，空闲双击用于快速标点
    try {
      const widget = viewer.cesiumWidget;
      const handler = widget && widget.screenSpaceEventHandler;
      if (handler) {
        state.savedDblClick = handler.getInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK) || null;
        if (state.savedDblClick) handler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      }
    } catch (err) { /* ignore */ }
    const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    state.dblHandler = handler;
    handler.setInputAction(function (movement) {
      if (window.LEDraw && typeof LEDraw.isActive === 'function' && LEDraw.isActive()) return;
      try {
        const picked = viewer.scene.pick(movement.position);
        if (picked && picked.id && picked.id.__leMarkerId) {
          const rec = state.markers.get(picked.id.__leMarkerId);
          if (rec) { openDialog(rec); return; }
        }
        const hit = pickCartographicAt(viewer, movement.position);
        if (!hit) return;
        add({
          name: '标记点 ' + (state.markers.size + 1),
          lat: hit.lat,
          lon: hit.lon,
          color: COLOR_DEFAULT,
          heightMode: 'clamp',
        }, { silent: true, fly: false }).then(function (rec) {
          openDialog(rec);
        });
      } catch (err) {
        console.warn('[LEMarkers] 双击标点失败', err);
      }
    }, C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  }

  function bindDrag(le) {
    const viewer = viewerOf();
    if (!viewer || state.dragHandler) return;
    const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    state.dragHandler = handler;
    handler.setInputAction(function (movement) {
      try {
        if (window.LEDraw && typeof LEDraw.getState === 'function' && LEDraw.getState().mode) return;
      } catch (err) { /* ignore */ }
      const picked = viewer.scene.pick(movement.position);
      const id = picked && picked.id && picked.id.__leMarkerId;
      if (!id) return;
      const rec = state.markers.get(id);
      if (!rec) return;
      state.drag = { id: id, controller: viewer.scene.screenSpaceCameraController };
      state.drag.controller.enableInputs = false;
      if (le && le.status) le.status('拖动标记点：' + rec.name);
    }, C.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(function (movement) {
      if (!state.drag) return;
      const rec = state.markers.get(state.drag.id);
      if (!rec) return;
      let cartesian = null;
      const ray = viewer.camera.getPickRay(movement.endPosition);
      if (ray) cartesian = viewer.scene.globe.pick(ray, viewer.scene);
      if (!cartesian) cartesian = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid);
      if (!cartesian) return;
      const carto = C.Cartographic.fromCartesian(cartesian);
      rec.lat = C.Math.toDegrees(carto.latitude);
      rec.lon = C.Math.toDegrees(carto.longitude);
      if (rec.entity) rec.entity.position = C.Cartesian3.fromDegrees(rec.lon, rec.lat, rec.heightMode === 'absolute' ? rec.height : 0);
    }, C.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction(function () {
      if (!state.drag) return;
      try { state.drag.controller.enableInputs = true; } catch (err) { /* ignore */ }
      const rec = state.markers.get(state.drag.id);
      state.drag = null;
      if (rec && le && le.status) le.status('已移动：' + rec.name + '（' + formatDecimal(rec.lat, 6) + ', ' + formatDecimal(rec.lon, 6) + '）');
      renderList();
    }, C.ScreenSpaceEventType.LEFT_UP);
  }

  /* ------------------------------ 初始化 ------------------------------ */

  function init(le) {
    if (state.le && state.dataSource) return;
    state.le = le || window.LE;
    if (!state.le || !state.le.viewer) return;
    ensureLayer(state.le).then(function () {
      bindDrag(state.le);
      bindDoubleClick(state.le);
      updateCount();
    }).catch(function (err) {
      console.warn('[LEMarkers] 初始化失败', err);
    });
    const addBtn = document.getElementById('btn-marker-add');
    if (addBtn) addBtn.addEventListener('click', function () { openDialog(); });
    const listBtn = document.getElementById('btn-marker-list');
    if (listBtn) listBtn.addEventListener('click', openList);
  }

  window.LEMarkers = {
    init: init,
    add: add,
    addMany: addMany,
    remove: remove,
    clear: clear,
    list: getProjectState,
    openDialog: openDialog,
    openList: openList,
    getProjectState: getProjectState,
    restoreProjectState: restoreProjectState,
    importCsvText: importCsvText,
    importGeoJsonText: importGeoJsonText,
    exportCsv: exportCsv,
    exportGeoJSON: exportGeoJSON,
    exportKml: exportKml,
    parsePair: parsePair,
    parseDms: parseDms,
    formatDms: decimalToDms,
    formatDecimal: formatDecimal,
  };

  if (window.LE && window.LE.viewer) init(window.LE);
  else document.addEventListener('local-earth-ready', function () { init(window.LE); }, { once: true });
})();

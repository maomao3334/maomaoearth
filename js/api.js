/*
 * MaomaoEarth 公共 API（二次开发入口）
 * - 浏览器内：window.MaoMaoEarth
 * - 所有方法都做了存在性保护；模块缺失时抛出明确错误
 * - 事件：'ready'（应用就绪）、'layer-added' / 'layer-removed'
 */
(function () {
  'use strict';

  var listeners = {};
  function emit(name, detail) {
    var list = listeners[name] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](detail); } catch (err) { console.error('[MaoMaoEarth] listener error', err); }
    }
  }
  function on(name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
    return function () {
      var list = listeners[name] || [];
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }
  function requireLE() {
    if (!window.LE) throw new Error('MaoMaoEarth 尚未就绪（window.LE 不存在）');
    return window.LE;
  }
  function requireModule(name, method) {
    var m = window[name];
    if (!m) throw new Error('模块 ' + name + ' 未加载');
    if (method && typeof m[method] !== 'function') throw new Error('模块 ' + name + ' 缺少方法 ' + method);
    return m;
  }
  function ready() {
    if (window.LE && window.LE.state && window.LE.state.ready) return Promise.resolve(window.MaoMaoEarth);
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (done) return; done = true; resolve(window.MaoMaoEarth); }
      document.addEventListener('local-earth-ready', finish, { once: true });
      var start = Date.now();
      var timer = setInterval(function () {
        if (window.LE && window.LE.state && window.LE.state.ready) { clearInterval(timer); finish(); }
        else if (Date.now() - start > 30000) { clearInterval(timer); finish(); }
      }, 200);
    });
  }

  var api = {
    version: '0.6.0',
    on: on,
    ready: ready,
    whenReady: function (cb) { return ready().then(cb); },

    get viewer() { return requireLE().viewer; },
    get scene() { return requireLE().scene; },
    get LE() { return requireLE(); },

    /** 加载本地相对 URL（KML/KMZ/GeoJSON） */
    load: function (url) {
      return requireModule('LEImports', 'importUrl').importUrl(url).then(function (ds) { emit('layer-added', ds); return ds; });
    },
    /** 加载浏览器 File / FileList（KML/KMZ/GeoJSON/GeoTIFF） */
    openFiles: function (files) {
      return requireModule('LEImports', 'importFiles').importFiles(files).then(function (r) { emit('layer-added', r); return r; });
    },

    /** 相机：lon,lat,height[,heading,pitch]（度/米） */
    flyTo: function (lon, lat, height, headingDeg, pitchDeg) {
      var C = requireLE().Cesium;
      var v = requireLE().viewer;
      var h = (height == null) ? 20000 : height;
      v.camera.flyTo({
        destination: C.Cartesian3.fromDegrees(lon, lat, h),
        orientation: {
          heading: C.Math.toRadians(headingDeg || 0),
          pitch: C.Math.toRadians(pitchDeg == null ? -45 : pitchDeg),
          roll: 0,
        },
        duration: 1.2,
      });
      return api.getCamera();
    },
    getCamera: function () {
      var LE = requireLE();
      var c = LE.viewer.camera;
      var pos = c.positionCartographic;
      return {
        lon: LE.Cesium.Math.toDegrees(pos.longitude),
        lat: LE.Cesium.Math.toDegrees(pos.latitude),
        height: pos.height,
        heading: LE.Cesium.Math.toDegrees(c.heading),
        pitch: LE.Cesium.Math.toDegrees(c.pitch),
        roll: LE.Cesium.Math.toDegrees(c.roll),
      };
    },

    /** 图层 */
    listLayers: function () { return requireLE().listLayers(); },
    setLayerVisible: function (id, visible) {
      var layers = requireLE().listLayers();
      for (var i = 0; i < layers.length; i++) {
        if (layers[i].id === id || layers[i].name === id) {
          if (typeof layers[i].setVisible === 'function') layers[i].setVisible(!!visible);
          else if (layers[i].datasource) layers[i].datasource.show = !!visible;
          else if (layers[i].imageryLayer) layers[i].imageryLayer.show = !!visible;
          return layers[i];
        }
      }
      throw new Error('找不到图层：' + id);
    },
    removeLayer: function (id) { requireLE().removeLayer(id); emit('layer-removed', id); },

    /** 地形 */
    terrain: {
      isEnabled: function () { return !!(window.LETerrain && window.LETerrain.isEnabled()); },
      setEnabled: function (on) {
        var T = requireModule('LETerrain', 'toggle');
        var LE = requireLE();
        if (window.LETerrain.isEnabled() === !!on) return Promise.resolve(window.LETerrain.isEnabled());
        return Promise.resolve(T.toggle(LE)).then(function () { return window.LETerrain.isEnabled(); });
      },
      setExaggeration: function (v) { return requireModule('LETerrain', 'setExaggeration').setExaggeration(v); },
      getExaggeration: function () { return requireModule('LETerrain', 'getExaggeration').getExaggeration(); },
      setQuality: function (q) { return requireModule('LETerrain', 'setQuality').setQuality(q || {}); },
      getQuality: function () { return requireModule('LETerrain', 'getQuality').getQuality(); },
    },

    /** 卫星影像 */
    imagery: {
      isEnabled: function () { return !!(window.LETerrain && window.LETerrain.isImageryEnabled && window.LETerrain.isImageryEnabled()); },
      toggle: function () { return requireModule('LETerrain', 'toggleImagery').toggleImagery(); },
    },

    /** Wind3D / WindNinja 直读（由 js/windninja.js 提供） */
    windninja: {
      loadUrl: function (velUrl) { return requireModule('LEWindninja', 'loadUrl').loadUrl(velUrl); },
      loadFiles: function (files) { return requireModule('LEWindninja', 'loadFiles').loadFiles(files); },
      listScenes: function () { return requireModule('LEWindninja', 'listScenes').listScenes(); },
      showScene: function (i) { return requireModule('LEWindninja', 'showScene').showScene(i); },
      clear: function () { return requireModule('LEWindninja', 'clear').clear(); },
      getStats: function () { return requireModule('LEWindninja', 'getStats').getStats(); },
    },

    /** 工程（.leproj） */
    project: {
      capture: function () { return requireModule('LEProject', 'capture').capture(); },
      save: function () { return requireModule('LEProject', 'save').save(); },
      loadText: function (text) { return requireModule('LEProject', 'loadText').loadText(text); },
      loadFile: function (file) { return requireModule('LEProject', 'load').load(file); },
    },

    /** 导出 */
    export: {
      png: function (opts) { return requireModule('LEExport', 'png').png(opts); },
      pdf: function (opts) { return requireModule('LEExport', 'pdf').pdf(opts); },
      geojson: function () { return requireModule('LEExport', 'geojson').geojson(); },
      kml: function () { return requireModule('LEExport', 'kml').kml(); },
      kmz: function () { return requireModule('LEExport', 'kmz').kmz(); },
    },

    /** P1：实时光照 */
    lighting: {
      setEnabled: function (on) { return requireModule('LELighting', 'setEnabled').setEnabled(!!on); },
      setTime: function (hours) { return requireModule('LELighting', 'setTime').setTime(hours); },
      toggle: function () { return requireModule('LELighting', 'toggle').toggle(); },
      getState: function () { return requireModule('LELighting', 'getState').getState(); },
      setShadowEnhance: function (on) { return requireModule('LELighting', 'setShadowEnhance').setShadowEnhance(!!on); },
    },

    /** P1：图层管理器 */
    layersPanel: {
      refresh: function () { return requireModule('LELayerPanel', 'refresh').refresh(); },
      setQuery: function (q) { return requireModule('LELayerPanel', 'setQuery').setQuery(q); },
      getGroups: function () { return requireModule('LELayerPanel', 'getGroups').getGroups(); },
    },

    /** P1：诊断 */
    diagnostics: {
      open: function () { return requireModule('LEDiagnostics', 'open').open(); },
      getReport: function () { return requireModule('LEDiagnostics', 'getReport').getReport(); },
      copyReport: function () { return requireModule('LEDiagnostics', 'copyReport').copyReport(); },
      downloadReport: function () { return requireModule('LEDiagnostics', 'downloadReport').downloadReport(); },
    },

    /** P1：绘制与剖面 */
    draw: {
      start: function (mode) { return requireModule('LEDraw', 'start').start(mode); },
      stop: function () { return requireModule('LEDraw', 'stop').stop(); },
      clear: function () { return requireModule('LEDraw', 'clear').clear(); },
      undo: function () { return requireModule('LEDraw', 'undo').undo(); },
      getGeoJSON: function () { return requireModule('LEDraw', 'getGeoJSON').getGeoJSON(); },
      loadGeoJSON: function (gj) { return requireModule('LEDraw', 'loadGeoJSON').loadGeoJSON(gj); },
      list: function () { return requireModule('LEDraw', 'list').list(); },
    },
    profile: {
      openForLine: function (points, name) { return requireModule('LEProfile', 'openForLine').openForLine(points, name); },
      open: function () { return requireModule('LEProfile', 'open').open(); },
      getLast: function () { return requireModule('LEProfile', 'getLast').getLast(); },
      exportPNG: function (opts) { return requireModule('LEProfile', 'exportPNG').exportPNG(opts || {}); },
    },

    /** P2：风场粒子 */
    particles: {
      start: function (opts) { return requireModule('LEWindParticles', 'start').start(opts || {}); },
      stop: function () { return requireModule('LEWindParticles', 'stop').stop(); },
      setDensity: function (n) { return requireModule('LEWindParticles', 'setDensity').setDensity(n); },
      setMode: function (m) { return requireModule('LEWindParticles', 'setMode').setMode(m); },
      isRunning: function () { return requireModule('LEWindParticles', 'isRunning').isRunning(); },
      getStats: function () { return requireModule('LEWindParticles', 'getStats').getStats(); },
    },

    /** P2：垂直风廓线 / 3D 高度切片 */
    windProfile: {
      open: function () { return requireModule('LEWindProfile', 'open').open(); },
      close: function () { return requireModule('LEWindProfile', 'close').close(); },
      setPoint: function (lon, lat) { return requireModule('LEWindProfile', 'setPoint').setPoint(lon, lat); },
      getData: function () { return requireModule('LEWindProfile', 'getData').getData(); },
      setSlices: function (on) { return requireModule('LEWindProfile', 'setSlices').setSlices(!!on); },
      clear: function () { return requireModule('LEWindProfile', 'clear').clear(); },
    },

    /** P2：离线地名/坐标搜索 */
    places: {
      search: function (q) { return requireModule('LEPlaces', 'search').search(q); },
      flyTo: function (item) { return requireModule('LEPlaces', 'flyTo').flyTo(item); },
      getRecent: function () { return requireModule('LEPlaces', 'getRecent').getRecent(); },
      clearRecent: function () { return requireModule('LEPlaces', 'clearRecent').clearRecent(); },
    },

    /** P2：HTML 快照 / 分享链接 */
    snapshot: {
      html: function (opts) { return requireModule('LESnapshot', 'html').html(opts || {}); },
      downloadHtml: function (opts) { return requireModule('LESnapshot', 'downloadHtml').downloadHtml(opts || {}); },
      shareLink: function () { return requireModule('LESnapshot', 'shareLink').shareLink(); },
      copyShare: function () { return requireModule('LESnapshot', 'copyShare').copyShare(); },
    },

    /** MBTiles（本地瓦片服务） */
    mbtiles: {
      load: function (base, token) { return requireModule('LEMBTiles', 'load').load(base, token); },
      openDialog: function () { return requireModule('LEMBTiles', 'openDialog').openDialog(); },
      clear: function () { return requireModule('LEMBTiles', 'clear').clear(); },
      getState: function () { return requireModule('LEMBTiles', 'getState').getState(); },
    },

    /** 坐标标点 */
    markers: {
      add: function (record, opts) { return requireModule('LEMarkers', 'add').add(record, opts); },
      addMany: function (records, opts) { return requireModule('LEMarkers', 'addMany').addMany(records, opts); },
      remove: function (id) { return requireModule('LEMarkers', 'remove').remove(id); },
      clear: function () { return requireModule('LEMarkers', 'clear').clear(); },
      list: function () { return requireModule('LEMarkers', 'list').list(); },
      openDialog: function (record) { return requireModule('LEMarkers', 'openDialog').openDialog(record); },
      openList: function () { return requireModule('LEMarkers', 'openList').openList(); },
      getProjectState: function () { return requireModule('LEMarkers', 'getProjectState').getProjectState(); },
      restoreProjectState: function (records) { return requireModule('LEMarkers', 'restoreProjectState').restoreProjectState(records); },
      exportCsv: function () { return requireModule('LEMarkers', 'exportCsv').exportCsv(); },
      exportGeoJSON: function () { return requireModule('LEMarkers', 'exportGeoJSON').exportGeoJSON(); },
      exportKml: function () { return requireModule('LEMarkers', 'exportKml').exportKml(); },
    },

    /** 性能 */
    perf: {
      getMode: function () { return window.LEPerf ? window.LEPerf.getMode() : null; },
      setMode: function (m) { return window.LEPerf ? window.LEPerf.setMode(m, 'api') : null; },
      getEffective: function () { return window.LEPerf ? window.LEPerf.getEffective() : null; },
    },
  };

  window.MaoMaoEarth = api;
  var started = false;
  function announce() { if (started) return; started = true; emit('ready', api); }
  if (window.LE && window.LE.state && window.LE.state.ready) announce();
  else document.addEventListener('local-earth-ready', announce, { once: true });
})();

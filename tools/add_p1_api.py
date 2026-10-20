p=r'G:\sh\local-earth\js\api.js'
c=open(p,encoding='utf-8').read()
anchor="""    /** 性能 */
    perf: {"""
add="""    /** P1：实时光照 */
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

    /** 性能 */
    perf: {"""
if anchor in c:
    c=c.replace(anchor,add,1); open(p,'w',encoding='utf-8',newline='').write(c); print('P1 API wrappers added')
else:
    print('anchor missing')

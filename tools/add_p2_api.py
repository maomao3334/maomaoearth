p=r'G:\sh\local-earth\js\api.js'
c=open(p,encoding='utf-8').read()
anchor="""    /** 性能 */
    perf: {"""
add="""    /** P2：风场粒子 */
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

    /** 性能 */
    perf: {"""
if anchor in c:
    c=c.replace(anchor,add,1); open(p,'w',encoding='utf-8',newline='').write(c); print('P2 API wrappers added')
else:
    print('anchor missing')

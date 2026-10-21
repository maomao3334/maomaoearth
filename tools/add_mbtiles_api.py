p=r'G:\sh\local-earth\js\api.js'
c=open(p,encoding='utf-8').read()
anchor="""    /** 性能 */
    perf: {"""
add="""    /** MBTiles（本地瓦片服务） */
    mbtiles: {
      load: function (base, token) { return requireModule('LEMBTiles', 'load').load(base, token); },
      openDialog: function () { return requireModule('LEMBTiles', 'openDialog').openDialog(); },
      clear: function () { return requireModule('LEMBTiles', 'clear').clear(); },
      getState: function () { return requireModule('LEMBTiles', 'getState').getState(); },
    },

    /** 性能 */
    perf: {"""
if anchor in c:
    c=c.replace(anchor,add,1); open(p,'w',encoding='utf-8',newline='').write(c); print('mbtiles API added')
else: print('anchor missing')

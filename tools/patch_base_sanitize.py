import io
p=r'G:\sh\local-earth\js\importers.js'
c=open(p,encoding='utf-8').read()
old="""    fitDataSource,
    dataSourceBounds,
    fileKind,"""
new="""    fitDataSource,
    dataSourceBounds,
    fileKind,
    // 供 main.js 等外部加载的 GeoJSON/KML 数据源做 RHUMB→GEODESIC 修复，避免渲染崩溃
    sanitizeDataSource(dataSource) {
      sanitizePolylineDataSource(dataSource);
    },"""
if old in c:
    c=c.replace(old,new,1); open(p,'w',encoding='utf-8',newline='').write(c); print('importers patched')
else:
    print('importers pattern missing')
p2=r'G:\sh\local-earth\js\main.js'
m=open(p2,encoding='utf-8').read()
old1="""      fill: false,
      clampToGround: false,
    }
    );
    countries.name = '国界（Natural Earth）';"""
new1="""      fill: false,
      clampToGround: false,
    }
    );
    if (window.LEImports && typeof LEImports.sanitizeDataSource === 'function') {
      LEImports.sanitizeDataSource(countries);
    }
    countries.name = '国界（Natural Earth）';"""
old2="""    { markerSize: 0, clampToGround: false }
    );
    places.show = false;"""
new2="""    { markerSize: 0, clampToGround: false }
    );
    if (window.LEImports && typeof LEImports.sanitizeDataSource === 'function') {
      LEImports.sanitizeDataSource(places);
    }
    places.show = false;"""
if old1 in m:
    m=m.replace(old1,new1,1)
else:
    print('main countries pattern missing')
if old2 in m:
    m=m.replace(old2,new2,1)
else:
    print('main places pattern missing')
open(p2,'w',encoding='utf-8',newline='').write(m); print('main patched')

p=r'G:\sh\local-earth\js\importers.js'
c=open(p,encoding='utf-8').read()
helper="""
  /** 公共矢量后处理：国界只留描边、湖泊淡蓝填充（GeoJsonDataSource 的 fill 选项不一定生效）。 */
  function stylePublicVectorDataSource(dataSource, lower) {
    if (!dataSource || !dataSource.entities) return;
    const now = C.JulianDate.now();
    const ents = dataSource.entities.values;
    const isAdmin = /admin_0/.test(lower);
    const isLakes = /lakes/.test(lower);
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.polygon) {
        try {
          if (isAdmin) {
            e.polygon.material = C.Color.TRANSPARENT;
            e.polygon.outline = true;
            e.polygon.outlineColor = C.Color.fromCssColorString('#86b7e8').withAlpha(0.9);
            e.polygon.outlineWidth = 1.2;
          } else if (isLakes) {
            e.polygon.material = C.Color.fromCssColorString('#2f6f9f').withAlpha(0.35);
            e.polygon.outline = true;
            e.polygon.outlineColor = C.Color.fromCssColorString('#5fa8d8').withAlpha(0.9);
            e.polygon.outlineWidth = 1.0;
          }
        } catch (err) {
          /* ignore */
        }
      }
    }
  }

"""
anchor="  function dataSourceOptions(le) {"
if helper.strip() not in c:
    c=c.replace(anchor, helper+anchor,1)
# call after sanitize for URL branch
old="""        dataSource = await C.GeoJsonDataSource.load(url, geoOptions);
        sanitizePolylineDataSource(dataSource);"""
new="""        dataSource = await C.GeoJsonDataSource.load(url, geoOptions);
        sanitizePolylineDataSource(dataSource);
        if (isPublicVector) stylePublicVectorDataSource(dataSource, lower);"""
if old in c:
    c=c.replace(old,new,1)
else:
    print('call pattern missing')
open(p,'w',encoding='utf-8',newline='').write(c)
print('styled helper added')

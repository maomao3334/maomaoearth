p=r'G:\sh\local-earth\docs\API.md'
c=open(p,encoding='utf-8').read()
add="""

## P1：光照 / 图层管理器 / 诊断 / 绘制 / 剖面

```js
// 实时光照（时间 0–24h）
MaoMaoEarth.lighting.setEnabled(true);
MaoMaoEarth.lighting.setTime(9.5);
MaoMaoEarth.lighting.toggle();
MaoMaoEarth.lighting.getState();          // {enabled,hours,clock,...}
MaoMaoEarth.lighting.setShadowEnhance(true);

// 图层管理器
MaoMaoEarth.layersPanel.refresh();
MaoMaoEarth.layersPanel.setQuery('wind');
MaoMaoEarth.layersPanel.getGroups();      // 按类型分组

// 诊断
MaoMaoEarth.diagnostics.open();
const report = MaoMaoEarth.diagnostics.getReport(); // GPU/FPS/内存/图层/地形/错误
MaoMaoEarth.diagnostics.copyReport();
MaoMaoEarth.diagnostics.downloadReport();

// 绘制与标注
MaoMaoEarth.draw.start('point' | 'line' | 'polygon');
MaoMaoEarth.draw.stop();
MaoMaoEarth.draw.undo();
MaoMaoEarth.draw.clear();
MaoMaoEarth.draw.getGeoJSON();
MaoMaoEarth.draw.loadGeoJSON(geojson);
MaoMaoEarth.draw.list();

// 高程剖面
MaoMaoEarth.profile.openForLine(points, '名称');
MaoMaoEarth.profile.open();               // 选择已绘制线
MaoMaoEarth.profile.getLast();            // {distanceKm,min,max,gain,...}
MaoMaoEarth.profile.exportPNG({download:true});
```
"""
if '## P1：光照' not in c:
    c += add
open(p,'w',encoding='utf-8',newline='').write(c)
print('API doc updated')

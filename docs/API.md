# MaomaoEarth JS API（二次开发）

浏览器全局对象：`window.MaoMaoEarth`（脚本 `js/api.js`，在应用模块后加载）。
所有方法都有明确的缺失模块错误；`await MaoMaoEarth.ready()` 可等待应用就绪。

## 基础

```js
await MaoMaoEarth.ready();
MaoMaoEarth.version;        // 版本
MaoMaoEarth.viewer;         // Cesium.Viewer
MaoMaoEarth.scene;          // Cesium.Scene
MaoMaoEarth.LE;             // 应用核心对象（底层 API）
MaoMaoEarth.on('ready', fn);
MaoMaoEarth.on('layer-added', fn);
```

## 数据加载

```js
await MaoMaoEarth.load('data/samples/wind/wind3d_test.kmz');
await MaoMaoEarth.openFiles(fileList);       // 浏览器 FileList
await MaoMaoEarth.load('data/public/vectors/ne_10m_admin_0_countries.geojson');
```

## 相机

```js
MaoMaoEarth.flyTo(lon, lat, height, headingDeg, pitchDeg);
const cam = MaoMaoEarth.getCamera(); // {lon,lat,height,heading,pitch,roll}
```

## 图层

```js
const layers = MaoMaoEarth.listLayers();
MaoMaoEarth.setLayerVisible(layers[0].id, false);
MaoMaoEarth.removeLayer(layers[0].id);
```

## 地形 / 影像

```js
MaoMaoEarth.terrain.setEnabled(true);
MaoMaoEarth.terrain.setExaggeration(1.8);
MaoMaoEarth.terrain.setQuality({ grid: 33, detailHillshade: true, imageryDetail: 'medium', deferHeavy: true });
MaoMaoEarth.terrain.getQuality();
MaoMaoEarth.imagery.toggle();
```

## Wind3D / WindNinja 直读

```js
await MaoMaoEarth.windninja.loadUrl('data/samples/windninja/terrain_point_10-13-2026_1810_200m_vel.asc');
const stats = MaoMaoEarth.windninja.getStats(); // {arrows, speedMin, speedMax, grid, bounds,...}
MaoMaoEarth.windninja.listScenes();
MaoMaoEarth.windninja.showScene(0);
MaoMaoEarth.windninja.clear();
```

## 工程（.leproj）

```js
const state = MaoMaoEarth.project.capture();
MaoMaoEarth.project.save();                 // 触发下载 .leproj
await MaoMaoEarth.project.loadFile(file);   // 选择文件恢复
await MaoMaoEarth.project.loadText(json);   // 直接恢复 JSON
```

## 导出

```js
MaoMaoEarth.export.png({ scale: 2 });
MaoMaoEarth.export.pdf();
MaoMaoEarth.export.geojson();
MaoMaoEarth.export.kmz();
```

## 性能

```js
MaoMaoEarth.perf.getMode();       // auto|low|medium|high
MaoMaoEarth.perf.setMode('low');
MaoMaoEarth.perf.getEffective();  // 当前实际档位
```

## URL 参数（无需写代码）

| 参数 | 说明 |
|---|---|
| `?terrain=0` | 关闭 3D 地形 |
| `?exag=1.8` | 地形夸张 |
| `?imagery=0` | 关闭卫星影像 |
| `?perf=auto\|low\|medium\|high` | 性能档 |
| `?cam=lon,lat,height,pitch` | 启动视角 |
| `?demo=<相对路径>` | 启动加载 KML/KMZ |
| `?windninja=<vel.asc 相对路径>` | 直读 WindNinja 结果 |
| `?drape=0` | 公共矢量不贴地 |
| `?fit=1` | 打开数据后自动定位 |

## 事件

- `ready`：应用就绪（也对应 DOM 事件 `local-earth-ready`）
- `layer-added` / `layer-removed`


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


## P2：粒子 / 风廓线 / 地名增强 / HTML 快照

```js
// 风场粒子
MaoMaoEarth.particles.start({density: 1200});
MaoMaoEarth.particles.setDensity(2200);
MaoMaoEarth.particles.setMode('particles' | 'arrows' | 'both');
MaoMaoEarth.particles.getStats();
MaoMaoEarth.particles.stop();

// 垂直风廓线 / 3D 高度切片
MaoMaoEarth.windProfile.open();
MaoMaoEarth.windProfile.setPoint(102.4, 25.05);
MaoMaoEarth.windProfile.getData();
MaoMaoEarth.windProfile.setSlices(true);

// 地名/坐标搜索
MaoMaoEarth.places.search('昆明');
MaoMaoEarth.places.search('102.4,25.05');
MaoMaoEarth.places.flyTo(item);
MaoMaoEarth.places.getRecent();

// HTML 快照 / 分享
MaoMaoEarth.snapshot.html({title: '我的风场'});
MaoMaoEarth.snapshot.downloadHtml();
MaoMaoEarth.snapshot.shareLink();
MaoMaoEarth.snapshot.copyShare();
```


## MBTiles（v0.5.0）

```js
// 先运行 MaoMaoEarth.exe mbtiles <file>，从终端复制服务地址与 token
const info = await MaoMaoEarth.mbtiles.load('http://127.0.0.1:8140', 'TOKEN');
MaoMaoEarth.mbtiles.getState();
MaoMaoEarth.mbtiles.clear();
```

底层对象：`LEMBTiles`（`load/clear/getState/openDialog`）；矢量 pbf 走 `LEMvt.createImageryProvider`。
支持 png/jpg/webp 栅格、pbf/MVT 矢量、EPSG:3857/4326；详见 [MBTILES.md](MBTILES.md)、[MVT.md](MVT.md)。

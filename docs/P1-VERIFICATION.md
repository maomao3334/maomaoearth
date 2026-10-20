# P1 验收记录（2026-10-21）

## 范围

- 实时光照（昼夜/时间滑杆/阴影增强）
- 图层管理器（搜索/分组/显隐/定位/删除/影像透明度与排序）
- 应用诊断面板
- 绘制与标注（点/线/面、撤销/清空、GeoJSON）
- 高程剖面
- 数据状态面板 + 本地 XYZ 瓦片目录（可选）

## 交付物

- `js/lighting.js`、`js/layers-panel.js`、`js/diagnostics.js`、`js/draw.js`、`js/profile.js`
- `docs/LIGHTING.md`、`docs/LAYERS.md`、`docs/DIAGNOSTICS.md`、`docs/DRAW.md`
- `docs/testdata/p1-*.png`（12 张）
- `js/api.js` 增加 `MaoMaoEarth.lighting / layersPanel / diagnostics / draw / profile`

## 自动化测试（p1-dev，headless Edge + CDP :9341）

| 组 | 结果 |
|---|---|
| 功能自测 a–e + P0 回归 | **77/77 通过** |
| 光照 | 白天/夜晚画面平均差 46.4/255，变化像素 69%；关闭恢复；阴影增强 3 层 alpha 精确恢复 |
| 图层 | 分组/搜索/显隐/透明度 0.92→0.45/上移下移/定位/增删图层均生效 |
| 诊断 | GPU/WebGL2/FPS≈60/堆 190MB/图层/地形显示；人为 console.error 被记录；复制 JSON 5441 B |
| 绘制 | 点/线/面、双击结束、Esc、撤销/清空、GeoJSON 往返 3 要素，与测量/相机不冲突 |
| 剖面 | 6.91 km / 300 采样 / 最低 2155 m / 最高 2717 m / 累计爬升 636 m；PNG 898×260 |
| P0 回归 | Wind3D 1428 箭头 / 102×57 / 4.2–11.18 m/s；project/geojson/perf 正常 |
| 动画 KMZ 回归 | 135252 placemark / 13 帧，时间轴/导出正常 |
| 本地 XYZ 目录 | 4 张瓦片注册为 imagery 层，空目录明确报错 |

## Lead 复核（CDP）

- P1 模块全部加载：`LELighting/LELayerPanel/LEDiagnostics/LEDraw/LEProfile` = true；
- `MaoMaoEarth` API 版本 0.2.0，P1 命名空间存在；
- `lighting` 状态：enabled=true、hours=9.5、UTC 09:30、`globe.enableLighting=true`；setTime(15) → 15:00；
- 无未捕获 page-error；P0 Wind3D 场景与 P1 共存。

截图：`p1-lighting-off/day/night/shadow-enhance.png`、`p1-layers.png`、`p1-data-panel.png`、`p1-draw-hud.png`、`p1-draw.png`、`p1-profile.png`、`p1-diagnostics.png`、`p1-diagnostics-errors.png`、`p1-regression.png`、`p1-acceptance.png`。

## 已知限制（不阻塞 P1）

- 光照：CustomHeightmapTerrainProvider `hasVertexNormals=false`，Cesium 仅昼夜明暗，无地形起伏自阴影；用「阴影增强」突出预烘焙 hillshade。Cesium `lightingFadeDistance` 默认会让近景淡出，P1 已调整。
- 图层：透明度/上下移仅影像层；Blue Marble 启动底图未注册。
- 诊断：Cesium 1.146 无公开 `showRenderLoopErrors`，保留内置错误面板；真实 renderError 会停渲染循环。
- 绘制/剖面：单几何、无洞/顶点编辑；地形夸张变化后线面不自动重新贴地。
- MBTiles 未实现；COG/GeoTIFF 走现有单幅贴图导入；XYZ 目录要求 z/x/y 且 Web 墨卡托。
- 备注：偶发 SRTM 地形阴影图层重复（terrain.js 挂载竞态），非 P1 引入，记录待修。

## 结论

**P1 通过**，进入 P2。

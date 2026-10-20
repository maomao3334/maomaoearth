# 原生 KML/KMZ 渲染器（js/kml-native.js）

## 为什么需要它

Cesium 自带的 `KmlDataSource` 能"加载"用户的 Wind3D KMZ（1479 个 Placemark、图例 BMP ScreenOverlay），
但画面上**看不到风场线段和图例**，只有纯色地面。合成 KML（长折线）却能正常显示。

根因（由 kml-dev 定位并修复）：

1. 原生渲染器最初把 `clampToGround`/`relativeToGround` 折线交给 Cesium 的"贴地折线"路径（`GroundPolylinePrimitive`）。
2. 本应用使用**椭球地形**（无本地地形数据），该路径在某些情况下会触发 Cesium 内部异常
   （`surfaceDistance` 未定义），导致**整个渲染循环停止**——所以第一帧之后什么都画不出来，
   看起来就像"文件打不开"。
3. 修复：贴地折线改用**抬升的 3D 折线**近似渲染（`clampToGroundAsHeight: true`），
   `relativeToGround` 的高度抬到 `max(z, 60) + 6` 米；同时给线宽一个 2px 下限，保证在数据范围视角可见。

## 实现要点

- 文件：`js/kml-native.js`（约 54 KB），暴露 `window.LEKml.load(input, le)`。
- `input` 支持 `File` / `Blob` / `ArrayBuffer` / 本地 URL 字符串；不联网。
- KMZ：自行解析 ZIP（`DecompressionStream('deflate-raw')`，兼容 stored），优先 `doc.kml`，否则第一个 `.kml`。
- KML：DOMParser 解析（忽略命名空间差异），建立 Style/StyleMap 表：
  - `LineStyle`：KML 颜色 `aabbggrr` → `Cesium.Color.fromBytes(r,g,b,a)`，宽度下限 2px；
  - `PolyStyle`、`IconStyle`、`ExtendedData`、`description`；
  - `LineString` / `Polygon` / `Point` / `MultiGeometry`，`altitudeMode`（absolute / relativeToGround / clampToGround）。
- 渲染：`Cesium.CustomDataSource` + `Entity`；点击要素可看到 Speed/Angle 等 ExtendedData。
- ScreenOverlay：ZIP 内 BMP/PNG → Blob URL → `#viewer` 上的 HTML `<img>`（`#kml-overlays`），
  按 overlayXY/screenXY 的 fraction 定位与 size；图层移除时一并清理。
- 加载后：注册图层（可显示/隐藏/移除）、自动飞到数据范围、刷新搜索索引。
- 集成：`js/importers.js` 对 `.kml/.kmz` 优先走原生渲染；失败自动回退 `Cesium.KmlDataSource`，
  并在 toast 中提示"已切换兼容模式"。

## 验证

测试文件：`data/samples/wind/wind3d_test.kmz`（用户 Wind3D 文件副本，107,468 B，
sha256 `6545573d09454cec…`），1479 个风场箭头 + 速度图例 + 时间。

| 项目 | 结果 |
|---|---|
| 加载 | 状态栏：`已加载 wind3d_test.kmz · 1479 个地物 · 范围 102.349,25.018 → 102.451,25.071 · 原生 KML 渲染` |
| 风场线 | **通过**：红/橙/黄箭头铺满区域（截图 `docs/testdata/kml-native-final-wind3d.png`） |
| 图例/时间叠加 | **通过**：左上速度图例、顶部时间（BMP 截图均显示） |
| 相机定位 | **通过**：自动飞到 25.04N / 102.40E 附近，高度约 10–12 km |
| 错误 | 0 console/page-error（Playwright 捕获） |
| 隐藏/移除 | 通过（`kml-native-wind3d-hidden.png` 为隐藏状态截图） |
| 普通 KML 回归 | `?demo=docs/testdata/sample.kml` 仍正常，无 page-error（`kml-native-sample.png`） |

REA 证据：`ev_1106d3e1a629758462cf80c8814621ca3fa3ed42fa31c671b31e480254814cb7`（最终 wind3d 截图）、
`ev_a8fccd1c666623e4b8e05fab65ef5a05e033d837be619b4260d022045477dba3`（sample.kml 回归）。

## 已知限制

- `clampToGround` 是"抬升近似"，不是真正贴地；接入真实地形（heightmap/quantized-mesh）后应改回贴地路径。
- 只支持常见 KML 子集：不处理 `NetworkLink`（不联网）、`gx:Tour`、时间动画、`Region` LOD 可见性、
  `Model`/`GroundOverlay`/`PhotoOverlay`；StyleMap 支持有限。
- ScreenOverlay 只支持 fraction 定位；BMP 依赖浏览器解码（Chromium 可显示，部分环境可能不支持）。
- 超大 KML/KMZ 有上限（`maxEntities=50000`、`maxZipEntries=4096`、解压 128 MB），解析在主线程，超大文件会卡顿。
- Zip 解压依赖 `DecompressionStream('deflate-raw')`（Chromium 105+ / Firefox 113+ 支持）。

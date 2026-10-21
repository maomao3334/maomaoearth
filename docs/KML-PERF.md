# 超大 KML/KMZ 性能优化（v0.5.1）

目标：10 万级 Placemark 的风场动画 KML/KMZ（如 `wind_animation.kml` 109 MB、`wind_animation_timeline.kmz` 56 MB doc.kml）打开和拖动不再卡死。

## 结果（headless Edge 155 + Cesium 1.146，Windows，1400×900）

| 指标 | 优化前 | 优化后 |
|---|---|---|
| `wind_animation.kml`（109 MB，13.5 万 LineString） | 加载 **12.4 s** | **4.1 s** |
| 拖动/静止 FPS | **2.4 FPS** | **60 FPS** |
| 主线程长任务 | 206 个，最长 4.6 s | 3 个，最长 0.7 s |
| 数据源 Entity 数 | 21,339（窗口 3 帧） | **0**（静态 Primitive 线） |
| JS 堆 | 1.14 GB | **380 MB** |
| 切帧 | 不可用/极慢 | **31–53 ms/帧** |
| `wind_animation_timeline.kmz`（doc.kml 56 MB，13.5 万 Point） | 加载 9.2 s | **5.8 s** |
| KMZ FPS / 堆 | 60 FPS / 246 MB | 59 FPS / 246 MB |

> FPS 为 headless 软件渲染环境；真实 GPU 通常更好。优化主要解决“打开卡 / 拖动卡 / 内存爆”的结构性问题。

## 根因

1. **整份 109 MB KML 一次 DOMParser**：DOM 4.6 s、堆 1.1 GB；虽然有 Folder 分片，但文件没有 Folder、且含 `<Style>`，原逻辑直接回退整份解析。
2. **动画按“窗口 3 帧 × 1 万 LineString”建 Entity**：约 2.1 万 Polyline Entity，Cesium 每帧更新/绘制开销巨大，FPS 2–5。
3. **线几何位置偶发 undefined**：地形高度/坐标异常导致 `Polyline` 构造抛错，回退 Cesium KmlDataSource，进一步放大到 13.5 万 Entity。
4. 点动画（KMZ）已有 `PointPrimitiveCollection`，但解析仍整份 DOM，首开 9 s。

## 实现

### 1. 扁平大 KML 分片解析

`planLargeKmlSplit` 新增 **无 Folder 的扁平 KML** 分支：

- 扫描顶层 `<Placemark>` 序列，按约 **4 MB** 连续切块；
- 每块都带上 Document 头部（`<Style>/<StyleMap>`），避免跨片样式失效；
- 每块 `DOMParser` 最大阻塞从 4.6 s 降到 **~0.2–0.3 s**；UI 可交互，进度条更新。

### 2. 简单扁平 KML 快速解析（fast path）

对满足以下条件的文件，跳过 DOM 和逐节点 walk，直接按 Placemark 块解析：

- 扁平（无 Folder）、无 Polygon/MultiGeometry/Model/GroundOverlay/NetworkLink/ScreenOverlay；
- Style 在 Document 头部，Placemark 只用 `LineString`/`Point` + `TimeSpan` + `styleUrl`；
- Placemark 内无内联 `<Style>`。

快速路径只解析渲染必需字段（name/TimeSpan/styleUrl/coordinates/altitudeMode/visibility），跳过 ExtendedData/description；任何不满足条件的结构都返回 `null`，自动回退完整 DOM 分片解析。

### 3. 线动画改为静态 Primitive 帧播放器

`createLineFrameAnimation`：

- 每帧把 10,404 条 LineString 合并为 **一个 `Cesium.Primitive`**（`PolylineGeometry` + `PolylineColorAppearance`）；
- 每帧一个 Primitive，按需构建并缓存 4 帧；切帧只切换 `primitive.show`；
- 相比 2 万+ Entity，绘制调用和每帧更新大幅减少；
- 图例/时间轴/显隐/图层删除仍可用。

点动画（KMZ）继续使用 `PointPrimitiveCollection`（单集合原地改 position / 切帧）。

### 4. 坐标/地形高度健壮性

`positionsFor` 过滤无效/NaN 高度，`groundHeightAt` 对地形未就绪返回 0；避免 `Polyline` 构造因 undefined 失败，避免回退 Cesium KmlDataSource。

## 使用

无需额外操作：打开 `.kml/.kmz` 即自动选择路径。时间轴播放/逐帧切换照旧。

可选性能模式：

- 应用「性能」按钮切到低/中质量，会降低点云降采样（`pointSubsample` 1/2/4），线动画仍保持静态 Primitive。
- 超大文件首开仍会显示进度；如文件包含复杂 Polygon/样式，自动回退完整解析，不会牺牲正确性。

## 限制

- 快速路径只覆盖“扁平、简单、Style 在头部”的 KML；复杂 KML 走 DOM 分片，可能仍较慢（但不再整份 DOM）。
- 快速路径不读取 ExtendedData/description，点选弹窗信息会少（渲染/时间轴不受影响）。
- 线动画按帧缓存 4 帧；13 帧文件切帧时按需构建（~30–60 ms/帧）。
- 线和点仍按 KML 原始密度绘制；未做线抽稀/聚合。
- 测试为 headless 软件渲染，实际 FPS 取决于 GPU/驱动。

## 验证记录

- `docs/testdata/kml-fps-fast.log`：KML 加载 4.1 s、60.2 FPS、Entity 0、堆 399 MB。
- `docs/testdata/kml-fps-color.log`：PolylineColor 版本 4.1 s、60.1 FPS、切帧 52 ms。
- `docs/testdata/kml-frame3.png`：播放到第 7/13 帧，箭头正常。
- `docs/testdata/kmz-fps-final.log`：KMZ 5.8 s、59.3 FPS、PointPrimitive 10,404。
- 截图：`docs/screenshots/10-kml-perf.png`。

## 相关

- [MBTiles](MBTILES.md)
- [MVT](MVT.md)

# 导出（PNG / PDF / GeoJSON / KMZ，P0）

`js/exporter.js` 提供四种完全离线的导出能力，不引入第三方库、不联网：
PNG 截图（含标题/图例/元数据）、打印窗口另存 PDF、Wind3D 采样点 GeoJSON、
手写 ZIP(store) 打包的 KMZ。

## 1. 入口

| 入口 | 说明 |
|---|---|
| 侧栏「导出 PNG」 | 当前视图 + 标题/时间/相机/风速图例 → `maomaoearth-<时间>.png` |
| 侧栏「导出 PDF」 | 打开新窗口 HTML（内嵌 PNG），自动 `window.print()`，可"另存为 PDF" |
| 侧栏「GeoJSON」 | 当前 Wind3D 采样点（每点含风速/风向/经纬度） |
| 侧栏「KMZ」 | 当前风场箭头 + 图例 PNG + 相机 Placemark，打包为 `.kmz` |
| API | `LEExport.png()/pdf()/geojson()/kmz()` |

## 2. PNG

- **读回方式**：Cesium 的 WebGL 画布默认 `preserveDrawingBuffer=false`，帧结束即清空。
  导出器在 `scene.postRender` 回调内（同一渲染任务）把 `scene.canvas` `drawImage` 到
  2D canvas，再叠加文字/图例；对偶发全白帧会自动重试（最多 6 次）。
- **叠加内容**：
  - 左上：标题（默认「本地地球 Local Earth」）+ 场景摘要（Wind3D 网格/分辨率/风速范围）；
  - 右上：6 级风速图例（有 Wind3D 数据时）；
  - 左下：导出时间、相机经纬度/高度、数据来源（Blue Marble / Natural Earth / CesiumJS）。
  字号/边距按 `canvas.width / clientWidth` 自动缩放，2× 导出同样清晰。
- **2× 分辨率**：临时把 `viewer.resolutionScale` 乘 2，等待两帧后读回，随后恢复原值。
- 文件通过 Blob + `<a download>` 下载，返回 `dataUrl` 供自动化断言。
- 返回：

```js
{
  filename, dataUrl, width, height, bytes,
  blank,        // 读回是否全透明
  whiteRatio,   // 缩略图纯白像素占比（质量诊断）
  attempts,     // 读回重试次数
  scale         // 1 | 2
}
```

## 3. PDF（打印窗口）

- 构造完整 HTML：A4 横向、标题、导出时间、相机信息、内嵌 PNG、
  数据范围（网格/分辨率/风速/箭头数）、图层数、数据来源、风速图例、页脚。
- 新窗口 `document.write` 后自动 `window.print()`；用户在打印对话框选择
  **"另存为 PDF"** 即可，完全离线、不依赖 PDF 库。
- `{print:false}` 会省略自动打印脚本（便于自动化/测试）。
- 返回 `{ window, html, filename, png }`。
- 若浏览器拦截弹窗会抛错：`浏览器阻止了打印窗口，请允许本站弹出窗口`。

## 4. GeoJSON

- 当前 Wind3D **采样点**（与渲染抽稀步长一致，保证视图与数据一致）：
  `FeatureCollection`，每个 `Point` 的 `properties`：

  ```json
  {
    "speed_mps": 7.88,
    "direction_deg": 273,        // 风来向（气象角度）
    "flow_deg": 93,              // 风去向 = (direction_deg + 180) % 360
    "lon": 102.3005754,
    "lat": 25.0963971,
    "row": 1, "col": 1,
    "scene": "terrain_point_10-13-2026_1810_200m"
  }
  ```

- 集合级附加字段：`generator`、`generated_at`、`scene`、`grid`、`speed_range_mps`。
- 无 Wind3D 数据时退化为当前相机位置点（`kind: "camera"`），不报错。
- 返回 `{ filename, text, json, count }`。

## 5. KMZ（手写 ZIP store）

为避免引入 JSZip，KMZ 用 **ZIP store（不压缩）** 手写打包：

| 成员 | 内容 |
|---|---|
| `doc.kml` | 文档名/描述、6 个按风速着色的 `LineStyle`、`ScreenOverlay`(legend.png)、相机 `Placemark`、`Wind Speed` Folder（每个采样箭头一个 `LineString`，5 个坐标点） |
| `legend.png` | 由 Canvas 现场绘制的 210px 风速图例（6 级颜色 + m/s） |

- KML 颜色为 `aabbggrr`，由分级颜色 `#rrggbb` 转换；箭头使用
  `<tessellate>1</tessellate>` + `<altitudeMode>clampToGround</altitudeMode>`，
  在 Google Earth / Cesium 中贴地显示。
- 每个箭头 Placemark 的 `ExtendedData` 含 `Speed`、`Angle`、`FlowDirection`。
- ZIP 结构：本地文件头 + 数据 + 中央目录 + EOCD，UTF-8 文件名标志，store 方法（method=0），
  含 CRC32 校验。
- 文件约 0.76 MB（1428 支箭头，样例网格）。
- 返回 `{ filename, bytes: Uint8Array, kml, blob, size }`。

## 6. API：`window.LEExport`

```js
LEExport.init(le)                       // 通常由 'local-earth-ready' 自动调用
LEExport.png(opts?)   -> Promise<PNG结果>
LEExport.pdf(opts?)   -> Promise<{ window, html, filename, png }>
LEExport.geojson(opts?) -> { filename, text, json, count }
LEExport.kmz(opts?)   -> Promise<{ filename, bytes, kml, blob, size }>
LEExport.buildPdfHtml(dataUrl, meta?) -> string
LEExport.getLast()    -> { png?, pdf?, geojson?, kmz? }
```

`opts`（通用）：

| 参数 | 默认 | 说明 |
|---|---|---|
| `download` | `true` | `false` 时只返回数据不触发下载（自动化/测试） |
| `name` | 自动 | 自定义文件名 |
| `title` | 「本地地球 · 三维地图导出」/「本地地球 Local Earth」 | 标题文字 |
| `scale` | `1` | PNG 支持 `2`（2× 分辨率渲染） |
| `print` | `true` | PDF 是否自动调用 `window.print()` |

## 7. 验证

自测脚本（headless Edge）对导出做了以下断言（详见 task-11 结果）：

- PNG：`dataUrl` 以 `data:image/png;base64,` 开头、`bytes > 30000`、非空白（纯白占比 < 0.5）、
  真实下载文件 PNG 签名/尺寸与返回值一致。
- 2×：输出尺寸 ≥ 1× 的 1.8 倍。
- GeoJSON：`FeatureCollection`、要素数 = 箭头数、每点含 `speed_mps/direction_deg`。
- KMZ：ZIP 可解析、`doc.kml` + `legend.png` 两个成员、method=0、CRC32 全部正确、
  KML 含 `<Placemark>`/`Speed`/`legend.png`。
- PDF：打印窗口 DOM 含 1 张 dataURL 截图（已 complete、naturalWidth>0）、
  标题/相机/数据来源/风速图例文本齐全、含 `window.print` 脚本；截图见 `docs/testdata/p0-pdf.png`。

## 8. 限制

- PNG 只截取 Cesium 画布，不包含侧栏/顶栏等 DOM；标题/图例是单独绘制的，
  与页面 DOM 图例样式相近但不完全一致。
- PDF 依赖浏览器打印对话框（不生成 PDF 二进制）；无头浏览器需 `print:false`。
- GeoJSON/KMZ 导出的是**当前采样抽稀后**的点/箭头（如 high=每 2 格 1428 点），
  不是原始 5814 个格点；如需全分辨率可先切到 high 档或直接读 ASC。
- KMZ 采用 store 不压缩，文件比压缩版大；不含时间动画/时间跨度。
- 导出与当前性能档/地形夸张相关（箭头高度/密度），不包含测量几何或图层面板状态。
- 极少数 WebGL 驱动在 `postRender` 读回仍可能返回白帧；导出器会重试并返回
  `whiteRatio` 供诊断，必要时重复点击导出即可。

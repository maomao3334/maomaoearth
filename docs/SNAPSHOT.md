# P2 · HTML 快照与分享链接（js/snapshot.js）

- **HTML 快照**：把当前三维视图导出为单文件 HTML：内嵌 PNG 截图、标题、时间、
  相机坐标、地形/影像/光照状态、图层列表、Wind3D 统计、粒子统计、数据来源与版权。
- **分享链接**：生成包含 `cam / exag / terrain / imagery / windninja / perf / windmode /
  particles / lighting / sun` 的 URL；复制到剪贴板并在状态栏/Toast 提示。
- 截图复用 P0 的 `LEExport.png({download:false})`，不重复实现读回逻辑。

## 1. 对外 API

```js
window.LESnapshot = {
  init(le),
  html(opts),           // Promise<string> 完整单文件 HTML
  downloadHtml(opts),   // Promise<{filename,bytes,chars,html}>
  shareLink(),          // string
  copyShare(),          // Promise<string|null>，带剪贴板回退
  capture(opts),        // Promise<{dataUrl,width,height,bytes,via}>
  getLast(),            // 最近一次快照/分享记录
  isBusy()
};
```

`opts`：`{title, includeLayers, includeWind, filename}`。
默认标题「本地地球 · 三维风场快照」。

## 2. HTML 快照内容

- 单文件、无脚本、无外部资源：
  - 截图：`LEExport.png({download:false})` 返回的 PNG dataURL，直接写入 `<img src>`；
  - 元数据表：视角/场景（经纬度、高度、朝向、俯仰）、3D 地形与夸张倍数、卫星影像、
    实时光照（UTC 时间/太阳方位高度）、Wind3D（场景、网格、风速范围、箭头数、抽稀步长、
    场景数、数据 URL/文件）、风场粒子（数量/尾迹段数/FPS/更新耗时）、图层列表（名称/类型/显隐）；
  - 页脚：数据来源与版权（NASA Blue Marble 公有领域；Natural Earth 公有领域；
    Sentinel-2 cloudless / EOX CC BY 4.0；CesiumJS Apache-2.0；WindNinja/Wind3D 数据版权归提供方），
    以及生成版本、CesiumJS 版本、ISO 时间。
- 内联深色样式，打印时自动切换浅色；`<script>` 数量 0，外链（`src/href` http）数量 0。
- 生成 1.8 MB 左右的 HTML（其中内嵌截图约 1.3 MB，取决于窗口大小）。

## 3. 分享链接

`shareLink()` 读取当前状态拼装参数：

| 参数 | 来源 |
| --- | --- |
| `cam` | 相机经纬度/高度/俯仰（度、米） |
| `exag` | `LETerrain.getExaggeration()` |
| `terrain` / `imagery` | 地形、卫星影像开关（1/0） |
| `windninja` | 当前 Wind3D 源为本地 URL 时写入该 URL（本地文件/工程数据不写入） |
| `perf` | `LEPerf.getMode()`（auto/low/medium/high） |
| `windmode` / `particles` | 粒子模式与数量（粒子运行时） |
| `lighting` / `sun` | 实时光照开启时写入 |

打开分享链接时，已有参数由 `window.LE`/`LEPerf`/`LEWindninja`/`LEWindParticles` 处理；
`terrain` 与 `imagery` 由 `snapshot.init()` 在应用就绪后应用（与当前状态不同才切换），
因此分享链接能恢复地形/影像开关。

`copyShare()` 优先 `navigator.clipboard.writeText`，离线/权限受限时回退到隐藏 textarea +
`document.execCommand('copy')`；无论复制是否成功，链接都会写到状态栏，并在控制台输出。

## 4. 自测结果（headless Edge + CDP）

- `downloadHtml()` 返回 `{filename:'maomaoearth-snapshot-*.html', bytes:1803985, chars:1803364}`，非空；
  CDP `Browser.downloadWillBegin` 记录到建议文件名与 `totalBytes=1803985`（下载已开始）。
  注意：本机 headless Edge 对 blob 下载统一返回 `state:'canceled'`（用最小 blob/数据 URI
  也复现，属浏览器/环境限制，不是应用错误）；GUI 浏览器可正常保存。为验证内容，
  测试把 `html()` 的返回写入文件后继续校验。
- 生成内容检查：`data:image/png;base64` 存在（内嵌 PNG 1,349,005 字节，PNG 签名 `89504e47…`），
  包含「相机」「图层（8）」「数据来源与版权」「Wind3D」「风场粒子」，`<script>` 0 个、
  外部 `src/href` 0 个、全文 `http(s)://` 0 个。
- 离线打开（`file:///…/p2-snapshot.html`）：页面标题正确，内嵌图片 `complete=true,
  naturalWidth=1110, naturalHeight=719`；仅产生 1 个 `file:` + 1 个 `data:` 资源，
  **没有 http 请求**；正文含相机（经度 102.4、纬度 25.05、高度 9000 m、方位 360°、俯仰 −50°）、
  图层、风场统计和版权信息。
- 分享链接示例（实测）：

  ```
  http://127.0.0.1:8123/?cam=102.4%2C25.05%2C9000%2C-50&exag=1.3&terrain=1&imagery=1
  &windninja=data%2Fsamples%2Fwindninja%2Fterrain_point_10-13-2026_1810_200m_vel.asc
  &perf=auto&windmode=particles&particles=600
  ```

  含 cam/exag/terrain/imagery/windninja/perf/windmode/particles。
- 分享链接恢复：把 `terrain=0&imagery=0` 加进链接后打开，应用就绪后
  `LETerrain.isEnabled()=false`、`isImageryEnabled()=false`，同时 `windninja` 自动加载
  1428 个箭头、`windmode=particles&particles=600` 自动启动 600 粒子，无 page-error。
- 截图：`docs/testdata/p2-snapshot.png`（离线打开的快照 HTML 页面）。

## 5. 限制

- 截图来自当前 WebGL 画布（`LEExport.png` 合成标题/图例），与导出 PNG 一致；
  若用 2D/哥伦布视图，画面仍可快照，但相机字段语义按 Cesium 当前相机读取。
- 分享链接中的 `windninja` 仅对「URL 加载」的风场有效；通过「Wind3D 目录」加载的本地文件
  不会写入链接（避免把几十 MB 文本放进 URL），恢复时需重新选择目录。
- `terrain`/`imagery` 只在应用就绪后异步应用；地形加载需要额外时间，链接打开后可能先看到
  无地形画面再切换。
- 剪贴板依赖浏览器权限；无权限时回退 `execCommand`，再失败则仅显示/控制台输出链接。
- 单文件 HTML 体积随窗口尺寸增大（截图为窗口像素尺寸的 PNG dataURL）。
- 快照不包含 KML/GeoJSON 的原始数据，仅包含当前视图和图层元信息。

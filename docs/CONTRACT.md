# 模块契约（Lead ⇄ 开发队友）

本文件是 `js/*` 的接口约定。**先读本文件，再读 `js/main.js` 的实际实现**。所有改动必须保持离线约束（无外部 URL/CDN/在线瓦片）。

## 1. 运行与验证

```powershell
# 启动（后台或单独窗口；-NoBrowser 不自动开浏览器）
powershell -NoProfile -ExecutionPolicy Bypass -File G:\sh\local-earth\serve.ps1 -Port 8123 -NoBrowser
```
- 地址：`http://127.0.0.1:8123/`（端口被占会自动+1）。
- 浏览器：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`（已装）。
- 可用 REA 浏览器工具验证（离屏/真实执行）：
  `mcp__rea__capture_browser_scenario`，参数示例：
  `{ browser: {mode:'launch', executable_path:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless:true}, start_url:{url:'http://127.0.0.1:8123/'}, actions:[{step_id:'wait',action:'wait_for_timeout',duration_ms:4000}], capture:{at_end:['screenshot','page-errors','console']} }`
  （若工具参数名不同，按其 schema 调整。）
- 也可用 Node 做语法检查：`node --check js/xxx.js`（DSH 内置 node：`C:\Users\A\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`）。
- 验收时必须确认：**无外部网络请求**（CSP 已限制，控制台无 net::ERR、无在线瓦片/字体请求）、地球可见、导入/搜索/测量可用。

## 2. 全局对象

`window.LE`（main.js 创建，模块只读使用）：

| 成员 | 说明 |
|---|---|
| `LE.viewer` / `LE.scene` | Cesium Viewer / Scene |
| `LE.Cesium` | Cesium 命名空间 |
| `LE.status(text, kind?)` | 底部状态栏文字；`kind==='error'` 变红 |
| `LE.toast(text, kind?, ms?)` | 浮层提示，kind: `null|'ok'|'error'` |
| `LE.setLoading(show, text?)` | 全屏加载遮罩 |
| `LE.setCoords(lon, lat, height)` | 状态栏坐标（一般不用手调） |
| `LE.flyTo({longitude,latitude,height} | {rectangle} | Cesium.Entity | {datasource})` | 飞行 |
| `LE.flyHome()` / `LE.toggle2D()` | 全球视角 / 2D-3D |
| `LE.registerLayer(desc)` | 注册图层，返回 entry（见下） |
| `LE.removeLayer(id)` / `LE.listLayers()` / `LE.refreshLayers()` | 图层管理 |
| `LE.openFileDialog()` | 触发隐藏文件选择框（main 已绑定 change → `LEImports.importFiles`） |
| `LE.state.samples.{countries,places}` | 内置 Natural Earth 数据源（places 为搜索索引，默认隐藏） |
| `LE.state.measureActive` | 测量进行中标志（main 的左键选择会跳过） |
| `LE.hasGeoTiff()` | geotiff.js 是否就绪 |

`LE.registerLayer(desc)` 的 desc 字段：
```js
{
  id?, name, type: 'vector'|'imagery'|'overlay', system?: false,
  datasource?: Cesium.DataSource,       // 矢量：显示/隐藏/移除自动处理
  imageryLayer?: Cesium.ImageryLayer,   // 影像：显示/隐藏/透明/移除
  zoomTo?: () => void,                  // 侧栏 ⌖ 调用
  flyTo?: () => void,
  remove?: () => void                   // 默认按 datasource/imageryLayer 移除
}
```
返回 entry 含 `setVisible(bool)`、`setOpacity(0..1)`（影像）。

## 3. 模块 API 与文件归属

### `js/layers.js` — 归属：layers-dev
`window.LELayers`
- `init(le)`
- `addXyzTemplate(le, {name, template, minimumLevel?, maximumLevel?, credit?})` — 本地 `{z}/{x}/{y}` 影像，返回 layer entry；模板非法要抛清晰错误。
- `addGeoTiff(le, {file?, url?, name})` — 用 `window.GeoTIFF` 解析并作为 `SingleTileImageryProvider` 叠加；判断 bbox/波段；失败抛错（中文）。
- 可选 `addTerrainFolder(le, {name, url})` — `CesiumTerrainProvider` 本地目录（无数据则不要注册）。

### `js/importers.js` — 归属：layers-dev
`window.LEImports`
- `init(le)`（安装拖放）
- `importFiles(files, le?)` — 支持 `.kml/.kmz/.geojson/.json`（`KmlDataSource`/`GeoJsonDataSource`）与 `.tif/.tiff`（转 `LELayers.addGeoTiff`）；逐个文件容错、汇总 toast/status；加载完 `flyTo` 数据源。
- 约束：不联网；KMZ 的 KMZ 依赖（网络链接）不应自动请求（Cesium 默认会请求 network link，需在数据源加载时禁用或提示）。

### `js/tools.js` — 归属：tools-dev
`window.LETools`
- `init(le)` — 建搜索索引、绑定搜索框（`#search-input`/`#search-results`）。
- `startMeasure('distance'|'area')` — 点击地球加点，双击/“完成”结束，Esc 取消；结果面板 `#measure-panel`。
- `clearMeasure()` — 清实体/面板/Esc/按钮高亮。
- `search(query) -> item[]`、`gotoItem(item)`。
- 测量与主选择的冲突用 `LE.state.measureActive` 规避（main 已处理）。

### `js/ui.js` — 归属：tools-dev
`window.LEUI`
- `init(le)` — 绑定快捷键（Ctrl+F 搜索、Esc 关闭、`?` 帮助）、渲染图层列表。
- `refreshLayers(layers)` — 渲染 `#layer-list`：眼睛（显示/隐藏）、⌖（缩放）、✕（移除）。
- `toggleHelp(show?)`、`promptGoto()`（`#goto-dialog`）、`showInfo(entity)`（选中反馈）。

## 4. DOM 契约（不要在模块里改 id）

`#search-input` `#search-results` `#btn-open` `#btn-home` `#btn-2d` `#btn-help`
`#btn-goto` `#btn-measure-distance` `#btn-measure-area` `#btn-clear-measure`
`#layer-list` `#layer-count` `#status-text` `#coords-text` `#toast` `#loading` `#loading-text`
`#drop-overlay` `#help-dialog` `#help-close` `#help-version` `#file-input` `#viewer`
（`#measure-panel`、`#goto-dialog` 由模块动态创建。）

## 5. 数据与离线约束

- 底图 `data/samples/world.topo.bathy.200412.3x5400x2700.jpg`（NASA Blue Marble，公有领域）。
- `data/samples/ne_110m_admin_0_countries.geojson`、`ne_110m_populated_places_simple.geojson`（Natural Earth，公有领域）。
- 禁止：CDN、在线瓦片（如 Google/OSM/天地图）、在线字体、ion token、遥测。
- 用户数据只通过本地文件（File/Blob）或 `data/` 相对路径读取。

## 6. 验收清单（提交前自测）

1. `node --check js/<你改的文件>.js` 通过。
2. `http://127.0.0.1:8123/` 打开：地球+国界可见，无控制台报错/无外部请求。
3. 导入 `docs/testdata/*.kml`（如需可自建）→ 图层出现并可缩放/隐藏/移除。
4. 搜索“北京”能出结果并飞过去。
5. 测距（两点/多点）与测面积（≥3 点）结果合理；清除正常。
6. 你自己的新增功能在断网下仍可用（CSP 不报错）。

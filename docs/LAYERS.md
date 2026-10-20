# 图层管理器与数据状态面板（P1）

> 代码：`js/layers-panel.js`　｜　API：`window.LELayerPanel`　｜　截图：`docs/testdata/p1-layers.png`、`docs/testdata/p1-data-panel.png`
> 与 `js/ui.js` 的 `LEUI.refreshLayers` 对接：P1 后由本模块接管 `#layer-list` 渲染，异常时自动回退旧列表。

## 图层管理器

### 功能

| 功能 | 说明 |
|---|---|
| 搜索 | `#layer-search`，按图层名实时过滤；Esc 清空 |
| 分组 | `矢量`（type=vector）/ `影像`（type=imagery）/ `地形阴影`（imagery 且名称含“阴影/hillshade”）/ `风场`（type=wind3d）/ `其他` |
| 数量 | `#layer-count` 显示总数；`#layer-summary` 显示「共 N 层 · 可见 M 层」 |
| 显隐 | 每行 `●/○` 调用 `entry.setVisible()`（datasource/imager ylayer 均生效），并同步刷新 |
| 定位 | `⌖`：优先 `entry.zoomTo()`，其次 `viewer.flyTo(datasource)`，最后按 imagery provider 的 `rectangle` 飞行 |
| 删除 | `✕`：调用 `LE.removeLayer(id)`，经过 `unregister`/`remove()` 并刷新 |
| 透明度 | **仅 imagery 层**：滑杆 0–1（step 0.05）→ `entry.setOpacity()` → `imageryLayer.alpha`；行内显示百分比 |
| 上移/下移 | **仅 imagery 层**：`viewer.imageryLayers.raise/lower(imageryLayer)`；到达顶/底时按钮禁用 |
| 动态刷新 | 任何 `LE.registerLayer/removeLayer/setVisible` 都会经 main.js → `LEUI.refreshLayers` → 本模块重绘（见 ui.js 的委托） |

### 分组细节

- `地形阴影` 组目前来自 `terrain.js` 自动挂载的本地 hillshade（名称含“阴影”），因此仍保留透明度/上下移
  （它们本质是 `SingleTileImageryProvider` 影像层）。
- Wind3D 风场图层 type 为 `wind3d`，只提供显隐/定位/删除（不是 imagery，无 alpha/上下移）。
- `system` 图层不显示（与旧版行为一致）。
- 列表行顺序按 `LE.listLayers()` 顺序；上移/下移改变的是 `viewer.imageryLayers` 内部的叠放顺序，
  重绘后仍按注册顺序展示（影像层彼此叠放关系已变化）。

### API

```js
window.LELayerPanel = {
  init(le),                 // local-earth-ready 自动调用
  refresh(layers?),         // 可传入 LE.listLayers() 结果；不传则自行读取
  setQuery(q),              // 设置搜索词并重绘
  getGroups(),              // { groups: {vector:[], imagery:[], shadow:[], wind:[], other:[]}, total }
  refreshDataStatus(),      // 重算数据状态面板
  loadMissingVectors(),     // 一键加载缺失的本地矢量（返回已加载标签数组）
  ensureTerrain(),          // 开启/确认 3D 地形
  ensureImagery(),          // 开启/确认卫星影像
  createFileXyzLayer(files),// 用 webkitdirectory 的 File 数组创建本地 XYZ 图层
  getDataRows(),            // 数据状态行（供调试/自动化）
};
```

## 数据状态面板（轻量）

侧栏「数据状态」显示四行，`4/4` 徽标表示就绪项数：

| 行 | 内容 |
|---|---|
| 3D 地形 | 开关/就绪、网格（`stats.grid²`）、夸张倍数、示例区/东亚/全球三源的就绪/加载中状态 |
| 卫星影像 | 影像开关、性能档位（low/medium/high）、已挂载层数（主/宽域/超清）与逐层可见性 |
| 矢量 | 已加载类别 `x/4`，明细：详细国界 / 河流 / 湖泊 / 城市（按图层名匹配公共数据文件名） |
| 场景 | `viewer.imageryLayers.length`、`viewer.dataSources.length`、`LE.listLayers().length` |

按钮：

- **3D 地形**：`LETerrain.toggle()`（已开则提示）；会刷新面板。
- **卫星影像**：`LETerrain.toggleImagery()`（已开则提示）。
- **加载矢量**：依次 `LEImports.importUrl()` 加载缺少的本地矢量
  （`data/public/vectors/ne_10m_admin_0_countries.geojson`、`..._rivers_lake_centerlines.geojson`、
  `..._lakes.geojson`、`..._populated_places_simple.geojson`）。
- **刷新状态**：立即重算（另有 5 s 低频只读刷新，跟踪地形大源异步加载完成）。
- **本地 XYZ 瓦片目录**：见下。

数据面板只读取 `LETerrain.stats()` 与 `LE.listLayers()`，不改变地形/影像状态。

## 本地 XYZ 瓦片目录（webkitdirectory）

实现方式（无第三方库）：

1. `#xyz-dir-input`（`type=file webkitdirectory multiple`）选择目录，读取 `file.webkitRelativePath`；
2. 正则 `/(?:^|\/)(\d+)\/(\d+)\/(\d+)\.(png|jpe?g|webp)$/i` 解析 `z/x/y` 并建立 `Map<'z/x/y', File>`；
3. 以 `WebMercatorTilingScheme` 构造自定义 `ImageryProvider`（普通对象）：
   `tileWidth/Height=256`、`minimumLevel/maximumLevel` 取文件中的 z 范围、
   `requestImage(x,y,level)` 用 `URL.createObjectURL(file)` 解码为 `<img>`，缺失瓦片返回 1×1 透明 PNG；
4. 用最大层级的瓦片范围推导 `rectangle`（`tilingScheme.tileXYToRectangle` 的并集），
   `viewer.imageryLayers.addImageryProvider(provider)` 后注册为 type=imagery 图层
   （因此自动获得透明度/上下移），并 `raiseToTop`。

约定与限制：

- 目录结构必须是 **XYZ（`…/z/x/y.ext`，y 不翻转）**、Web 墨卡托（EPSG:3857）；不支持 TMS、`{z}/{x}/{y}` 模板、MBTiles。
- 自定义 provider 的 `credit` 必须用 `new Cesium.Credit(...)`（Cesium 的 CreditDisplay 会调用 `credit.isIon()`；
  传字符串会在渲染时抛 `e.isIon is not a function` 并中断渲染循环——自测中发现并已修正）。
- 只接受 png/jpg/jpeg/webp；缺失瓦片透明；不做重投影/纠偏。
- 瓦片以 `File` 引用保存在内存 Map 中，不复制内容；超大目录仅受浏览器 File API 限制。
- 目录加载结果与普通 imagery 图层一样会出现在图层面板中。

## MBTiles / COG 现状（如实说明）

- **COG / GeoTIFF**：走现有「打开数据」导入，`LELayers.addGeoTiff()` 用 `geotiff.js` 解码后以
  `SingleTileImageryProvider` 单幅贴图叠加（按影像自身经纬度 bbox，不重投影，不做金字塔按需读取）。
  对大范围 COG 或投影坐标数据仅是“可用但不理想”。
- **MBTiles**：**暂未实现**（需要 SQLite 解析或额外 worker，留待后续）；本次未加任何伪支持。

## 已知限制

- 透明度/上下移仅对 `type==='imagery'` 的图层可用；矢量（datasource）、风场只支持显隐/定位/删除。
- 启动时直接加入 `viewer.imageryLayers` 的 Blue Marble 底图没有经过 `LE.registerLayer`，
  因此**不出现在图层面板中**（也无法在面板里删除/调透明度）；这是 main.js 的既有结构，P1 未改动。
- 「地形阴影」分组依赖图层名关键字；重命名自定义图层若含“阴影”也会被归入该组。
- 定位影像图层时使用 provider 的 `rectangle`，宽域/全球影像会飞得很远；无 rectangle 的 provider 仅提示。
- 一键加载矢量是 4 个较大的本地 GeoJSON（合计约 30 MB），需要数秒；加载期间有 loading 遮罩。
- 数据面板的“已加载”判定基于图层名关键字，若用户手动改名会误判。

## 自测结果（headless Edge 155 + CDP）

场景：`?cam=102.4,25.05,9000,-50&exag=1.3&perf=high&windninja=…/terrain_point_10-13-2026_1810_200m_vel.asc`

| 检查 | 结果 |
|---|---|
| 分组 | 7 层：矢量 1 / 影像 3 / 地形阴影 3 / 风场 1（另一次页面含 8 层） |
| 搜索 `Wind` | 仅剩 `Wind3D · …` 1 行 |
| 显隐（国界） | `visible=false` + `datasource.show=false`；再点恢复 true |
| 透明度 | 主影像 alpha 0.92 → **0.45**，标签 `45%`；恢复 0.92 |
| 上移/下移 | imageryLayers 索引 **4 → 5 → 4**（总 6/7 层） |
| 定位 | 相机高度 17.8 km → 34.9 km（按超清/主影像 rectangle 飞行） |
| 删除 | 新增测试图层后 8→9 层，点 ✕ 后回到 8 层 |
| 数据面板 | 4/4 就绪；地形「网格 49² · 夸张 1.3×」，影像「high · 3/3 层」，矢量「1/4 类」 |
| 本地 XYZ 目录 | 用本地 blue-marble 瓦片构造 4 个 File（`5/24/13.jpg` 等）：解析 4 张、z5–5、注册为 imagery 图层（可删除），空目录返回明确错误，`console.error` 0 条 |
| 页面错误 | 无 |

截图：`p1-layers.png`（搜索/分组/透明度/上下移/定位/删除按钮）、`p1-data-panel.png`（地形/影像/矢量状态与一键加载）。

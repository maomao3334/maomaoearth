# MVT 矢量瓦片（v0.5.0）

`js/mvt.js`：**纯 JS、无第三方依赖、完全离线**的 Mapbox Vector Tile（MVT / pbf）解码 + Canvas 栅格化 + Cesium `ImageryProvider`，用于让 MBTiles 前端直接加载 `format=pbf` 的矢量瓦片。

- 兼容 Cesium **1.146**，同时提供 `window.LEMvt` 与向后兼容的 `window.MVT.parse`。
- 不解析 style.json / 表达式 / 过滤器 / 标签，只按图层名做稳定配色（见「样式」）。
- 编码格式：MVT spec 2.x（protobuf varint / zigzag delta / MoveTo·LineTo·ClosePath）。

## 文件与加载顺序

`index.html` 中的顺序（保持即可）：

```html
<script src="js/mvt.js"></script>
<script src="js/mbtiles.js"></script>
```

`js/mvt.js` 只依赖浏览器全局 `Cesium`（仅 `createImageryProvider` 需要）；解码 / Canvas 渲染不依赖 Cesium。

## API

### `LEMvt.decodeTile(arrayBuffer) -> { layers, featureCount, layerCount }`

同步解码一块**未压缩**的 MVT/pbf 瓦片。

```js
const tile = LEMvt.decodeTile(await res.arrayBuffer());
// tile.layerCount === 1, tile.featureCount === 3
// tile.layers[0] = { name, extent, version, features: [...], featureCount }
```

图层结构：

| 字段 | 说明 |
| --- | --- |
| `name` | 图层名（string） |
| `extent` | 瓦片坐标范围，缺省/非法时回退 4096 |
| `version` | MVT 图层版本（缺省 2） |
| `features` | 要素数组 |
| `featureCount` | 该图层要素数 |

要素结构：

| 字段 | 说明 |
| --- | --- |
| `id` | uint64（无则 0） |
| `type` | `'point'` / `'line'` / `'polygon'` |
| `typeId` | MVT 原始类型（1/2/3） |
| `geometry` | 见下 |
| `properties` | 已按 `keys`/`values` 展开的普通对象 |

几何表示（坐标是瓦片局部坐标，y 向下，与 canvas 一致，不做投影）：

- **point**：`[[[x,y]], ...]`；每个 part 一个点，MultiPoint 有多个 part。
- **line**：`[[[x,y],[x,y],...], ...]`；MultiLineString 多 part。
- **polygon**：`[ring, ring, ...]`；同一个要素的所有环按编码顺序排列，外环在前、洞（内环）在后；环的闭合由渲染时 `closePath()` 完成（ClosePath 命令不会重复写入首点）。

`properties` 值类型支持：`string`、`float`（float32）、`double`、`int`/`uint`/`sint`、`bool`，均转为 JS 值。

错误行为：数据截断 / 越界 / 未知 protobuf wire type 会抛出带 `MVT：…` 前缀的 `Error`，便于定位坏瓦片；**gzip 输入会抛明确错误**提示改用异步接口。

### `LEMvt.decodeTileAsync(arrayBuffer) -> Promise<decoded>`

自动识别 gzip（字节头 `1f 8b`）并用 `DecompressionStream('gzip')` 解压后解码。适合本地瓦片服务未自动解压的场景。

### `LEMvt.decompressTile(arrayBuffer) -> Promise<ArrayBuffer>`

只做 gzip 解压；非 gzip 输入原样返回（复制为独立 ArrayBuffer）。

### `LEMvt.renderTileToCanvas(arrayBuffer, size = 256, opts?) -> HTMLCanvasElement`

同步解码 + 栅格化成 canvas（**gzip 输入请先 `decompressTile`**，否则 `decodeTile` 会报错）。

```js
const canvas = LEMvt.renderTileToCanvas(buf, 256, {
  background: '#18202a',     // 可选：先铺底色（默认透明）
  pixelRatio: 1,             // 可选：高分屏 2（canvas 物理像素 = size * pixelRatio）
  style: {                   // 可选：按图层名覆盖样式（对象或函数）
    sample: { fill: 'rgba(80,140,220,0.45)', stroke: '#9cc9ff', lineWidth: 1.6, pointRadius: 3 }
  }
});
```

### `LEMvt.renderTileToCanvasLayer(arrayBuffer, layerName, size = 256, opts?) -> canvas`

只渲染指定图层；图层不存在（先精确匹配，再忽略大小写匹配）时返回**透明空白** canvas。

### `LEMvt.createImageryProvider({ base, token, meta, ... }) -> Cesium ImageryProvider`

把 pbf 瓦片服务包装成 Cesium 影像图层（在 `imageryLayers.addImageryProvider` 中使用）。

```js
const provider = LEMvt.createImageryProvider({
  base: 'http://127.0.0.1:8140',
  token: TOKEN,
  meta: await (await fetch(metaUrl)).json()
});
const layer = viewer.imageryLayers.addImageryProvider(provider);
```

`base` 是启动器 `MaoMaoEarth.exe mbtiles` 输出的 `MBTILES_SERVER`；`meta` 是 `/meta.json` 的 JSON。

返回对象满足 Cesium ImageryProvider 形状：

| 属性/方法 | 行为 |
| --- | --- |
| `ready` / `readyPromise` | `true` / `Promise.resolve(true)` |
| `tilingScheme` | `meta.crs` 含 `4326` / `geographic` / `wgs84` → `Cesium.GeographicTilingScheme`，否则 `Cesium.WebMercatorTilingScheme` |
| `rectangle` | 解析 `meta.bounds`（minLon,minLat,maxLon,maxLat，度）；非法/缺失时回退 `tilingScheme.rectangle` |
| `minimumLevel` / `maximumLevel` | `meta.minzoom` / `meta.maxzoom`，缺省 0 / 22，clamp 到 `[0,30]` |
| `tileWidth` / `tileHeight` | 256（可用 `tileSize` 覆盖） |
| `hasAlphaChannel` | `true` |
| `credit` / `getTileCredits()` | `meta.attribution`（缺省 `meta.name` / `MBTiles (MVT)`，HTML 已转义） |
| `requestImage(x, y, level)` | 返回 `Promise<HTMLCanvasElement>`；URL 为 `${base}/tiles/${level}/${x}/${y}.pbf?token=…` |

`requestImage` 行为：

- HTTP **204 / 404** → 返回透明空白 256 canvas（不抛异常，也不阻塞 Cesium）。
- 其它非 2xx、网络错误、解码失败 → 同样返回透明空白 canvas，并调用 `options.onError`（缺省 `console.warn`），**Promise 不会 reject**。
- 响应为 gzip（`1f 8b` 字节头，或浏览器未自动解压）→ 自动 `DecompressionStream('gzip')` 解压后解码；带 `Content-Encoding: gzip` 时浏览器已解压的场景也能正常处理。
- `fetch` 使用 `cache: 'no-store'`，避免 token 变化时命中旧缓存；支持 Cesium 的请求取消（`request.cancelFunction` → `AbortController`）。

可选参数：`minimumLevel`/`maximumLevel`（覆盖 meta）、`tileSize`、`tileUrlTemplate`（自定义 URL 模板，支持 `{z}/{x}/{y}/{token}`）、`style`（同上）、`pixelRatio`、`cache`、`onError`、`Cesium`（显式传入 Cesium 命名空间）。

> CORS：应用（`http://127.0.0.1:8123`）跨端口请求瓦片服务（`8140`），启动器 C# 服务已返回 `Access-Control-Allow-Origin: *`，无需额外配置。

### `LEMvt.styleForLayer(name) -> { fill, stroke, point, lineWidth, pointRadius, hue }`

返回按图层名稳定生成的调色板（FNV-1a → HSL）。同名恒定、与加载顺序无关；可被 `opts.style` 覆盖。样式缓存于模块内。

### 兼容 `window.MVT`

`window.MVT.parse` 指向 `LEMvt.decodeTile`，供旧版 `js/mbtiles.js` 继续工作。新代码请使用 `window.LEMvt`。

## 样式规则

按图层名分配稳定色相（饱和度/亮度由哈希轻微变化），三个绘制 pass：

1. `polygon`：半透明填充 + 同色描边；环用 **evenodd** 填充，因此内环（洞）自动镂空，不依赖 ring winding。
2. `line`：同色描边，`lineJoin/lineCap = round`。
3. `point`：同色圆点（半径随尺寸缩放）。

同一 canvas 内先画所有图层的 polygon，再画 line，最后 point，保证线/点不被面遮挡；图层内部保持瓦片编码顺序。

`opts.style` 覆盖示例：

```js
LEMvt.renderTileToCanvas(buf, 256, {
  style: (name) => name === 'water'
    ? { fill: 'rgba(40,110,180,0.6)', stroke: 'rgba(120,200,255,0.9)' }
    : undefined
});
```

## 支持范围

- MVT：`Tile.layers`，`Layer{name,features,keys,values,extent,version}`，`Feature{id,tags,type,geometry}`，`Value` 全部 7 种类型。
- 几何命令：`MoveTo(1)` / `LineTo(2)` / `ClosePath(7)`，zigzag delta 解码；`Multi*` 以多 part 表示（不做 splice/合并）。
- 任意 `extent`（非 4096 也可）；多边形按要素内全部环处理。
- WebMercator / 经纬度（EPSG:4326）两套 Cesium tiling scheme；`meta.bounds` 自动解析。
- gzip：仅 `gzip`（RFC1952）。zlib（`deflate`）与 raw deflate、brotli 不支持。

## 不支持 / 限制

- **不解析样式表**：不读取 Mapbox style.json / `vector_layers`，不做 data-driven styling、表达式、zoom 函数。
- **不做属性过滤**：所有要素都会绘制；不按 `class`/`rank` 等属性筛选。
- **不绘标签**：无文字/图标/碰撞检测（point 只画圆点）。
- **不处理 winding**：洞靠 evenodd 镂空；若数据本身环方向异常也能正确显示洞，但重叠环的语义可能与规范实现略有差异。
- **不做投影/裁剪**：坐标是瓦片局部坐标，直接缩放到 canvas；瓦片外的几何由 canvas 边界裁剪。宽线在瓦片边缘可能被切掉半个线宽（相邻瓦片拼接处会有 1px 级缝隙）。
- **同步接口不接受 gzip**：`decodeTile` / `renderTileToCanvas*` 是同步 API；gzip 用 `decodeTileAsync` / `decompressTile` 或 `createImageryProvider`（内部自动处理）。
- **无瓦片缓存**：每块瓦片在 `requestImage` 时解码并绘制；Cesium 影像层会缓存 canvas，但快速缩放/重复加载会重复 fetch + 解码。
- **无要素简化**：不对几何做抽稀/合并；超大瓦片（数万要素）会明显变慢。
- **依赖 `DecompressionStream`**：gzip 解压需要较新的 Chromium/Edge（本应用目标环境满足）；不支持时 gzip 瓦片会走 `onError` 并显示空白。
- **调色板可能撞色**：按名称哈希取色，图层很多时可能接近；用 `opts.style` 固定关键图层颜色。

## 性能

本机 headless Edge + Cesium 1.146 实测（样例瓦片 266 B / 3 要素）：

- `decodeTile` + `renderTileToCanvas(256)` 平均 **约 0.4 ms/瓦片**（30 次循环）。
- 真实复杂瓦片（数千要素）预计几毫秒到十几毫秒量级；建议 `pixelRatio` 保持 1（默认），不要给 provider 传 2。
- 解码/绘制都在主线程同步执行；`requestImage` 的 fetch/解压是异步的。

## 样例数据

`data/samples/mbtiles/vector-sample.mbtiles`（16 KB，由 `tools/make_mvt_fixture.py` 生成）：

| 项 | 值 |
| --- | --- |
| `format` / `scheme` / `crs` | `pbf` / `tms` / `EPSG:3857` |
| `bounds` | `-180,-85.05112877980659,180,85.05112877980659` |
| `minzoom` / `maxzoom` | `0` / `0` |
| 瓦片 | z0 单块（`tiles` 表 `tile_row=0`，TMS） |
| 图层 | `sample`，`extent=4096`，`version=2` |
| 要素 | polygon（带洞，string/int/bool/double tags）+ line（5 点）+ point |

重新生成：

```bat
python tools\make_mvt_fixture.py
```

用法：

```bat
MaoMaoEarth.exe mbtiles "G:\sh\local-earth\data\samples\mbtiles\vector-sample.mbtiles"
:: 或自动化（不弹浏览器）
MaoMaoEarth.exe mbtiles "...\vector-sample.mbtiles" --no-browser
```

启动后浏览器自动带 `?mbtiles=http://127.0.0.1:8140&mbtoken=...` 打开，矢量瓦片按普通影像图层加载（可显隐/透明度/排序/删除/缩放定位）。

> 说明：z0 单瓦片覆盖全球，便于任意视角立即看到效果；样例有意保持极简（266 B pbf），只用于功能验证，不追求真实制图效果。

## 自测记录

### Node（解码，无 DOM）

用 `data/samples/mbtiles/vector-sample.mbtiles` 里的 `tile_data` 与 gzip 版本验证：

- `layerCount=1, featureCount=3`，`sample/extent=4096/version=2`。
- polygon 2 环（外环 4 点 + 洞 4 点），line 1 part/5 点，point `(2048,3584)`。
- tags 正确：`name`、`rank`、`visible`、`area_km2`、`class`。
- gzip：同步接口抛明确错误；`decompressTile` 字节与明文一致；`decodeTileAsync` 计数一致。
- 截断输入抛 `MVT：layer 长度越界`；空输入返回 0 layer/0 feature。
- 同名调色板稳定、不同名不同色。

### 浏览器（headless Edge + CDP，Cesium 1.146）

13 项全部通过：

- Cesium/LEMvt/`window.MVT.parse` 均可用；`decodeTile` 计数/几何/属性正确。
- 256 渲染：洞中心 alpha=0（evenodd 生效），带背景时完全不透明；128/512 缩放正常。
- `renderTileToCanvasLayer` 命中/未命中（未命中返回透明空白）。
- gzip：`decodeTile` 拒绝、异步解压后与明文逐像素一致（hash 相同）。
- `createImageryProvider`：WebMercator 字段/URL/rectangle/levels 正确，`requestImage(0,0,0)` 与 `renderTileToCanvas` 像素一致。
- 204 / 404 → 透明空白 256 canvas，不抛异常。
- gzip（含/不含 `Content-Encoding`）provider 输出与明文一致。
- `EPSG:4326` → `GeographicTilingScheme`，min/max zoom 正确。
- 缺省 meta / 空 bounds 回退不崩溃；性能约 0.4 ms/瓦片。

截图：

- `testdata/mvt-render-sheet.png` — 整块 / gzip / 透明底 / 空白 / 128 / 512 / provider 汇总。
- `testdata/mvt-render-256.png` — 单块 256×256 渲染。
- `testdata/mvt-provider-sheet.png` — ImageryProvider 输出（明文 / gzip / 204·404 空白 / 参考）。
- `testdata/mvt-browser.png` — 浏览器自测页面整页截图（含 13 项 PASS 列表）。
- `testdata/mvt-launcher-e2e.png` — 真实 `MaoMaoEarth.exe mbtiles` C# 服务 + Cesium 的取图验证。

### 真实链路（C# 瓦片服务）

`MaoMaoEarth.exe mbtiles data\samples\mbtiles\vector-sample.mbtiles --no-browser` 启动后：

- `/meta.json` 返回 `format=pbf, crs=EPSG:3857, minzoom=0, maxzoom=0, bounds=…`；
- `LEMvt.createImageryProvider({base, token, meta})` 的 `tilingScheme` 为 `WebMercatorTilingScheme`；
- `requestImage(0,0,0)` 取到真实瓦片并渲染出 16586 个非透明像素；
- `requestImage(1,1,0)`（C# 返回 204）得到透明空白 canvas。

## 与 `js/mbtiles.js` 集成（Lead 参考）

`js/mbtiles.js` 中把矢量分支替换为：

```js
if (isVectorFormat(meta.format)) {
  provider = window.LEMvt.createImageryProvider({ base: base, token: token, meta: meta });
}
```

旧的 `renderMvtTile` / `styleForLayer` 可以删除；若保留，`window.MVT.parse` 仍可用（兼容别名）。`js/mvt.js` 需保持先于 `js/mbtiles.js` 加载。

## 版本

- `LEMvt.version = '1.0.0'`，随 Local Earth v0.5.0 提供。
- 无第三方库、无网络请求（仅访问显式传入的本地瓦片服务地址）；不执行 `eval`，不修改全局样式。

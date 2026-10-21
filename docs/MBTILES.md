# MBTiles 直读（v0.5.0）

## 原理

MBTiles 是 SQLite 数据库（`metadata` + `tiles`）。浏览器不能直接读 SQLite，所以由启动器内置一个**只监听 127.0.0.1 的瓦片服务**：

```
MaoMaoEarth.exe mbtiles <file.mbtiles>
  ├─ 静态应用服务（127.0.0.1:8123 或自动端口）
  └─ MBTiles 瓦片服务（后台进程，127.0.0.1:8140 起自动端口，随机 token）
        GET /meta.json?token=...
        GET /tiles/{z}/{x}/{y}.{png|jpg|webp|pbf}?token=...
             ↓
        winsqlite3.dll（Windows 10/11 自带 SQLite）
        SELECT tile_data FROM tiles
        WHERE zoom_level=? AND tile_column=? AND tile_row=?
```

前端 `js/mbtiles.js` 读取 `metadata` 后加载：

- 栅格（png/jpg/webp）：`Cesium.UrlTemplateImageryProvider`；
- 矢量（pbf/mvt）：`js/mvt.js` 的 `LEMvt.createImageryProvider`，纯 JS 解码 MVT 并 Canvas 栅格化；
- `metadata.crs` 含 `4326/geographic/wgs84` → `Cesium.GeographicTilingScheme`，否则 `Cesium.WebMercatorTilingScheme`；
- 注册为普通 imagery 图层，支持显隐/透明度/排序/删除。

## 使用（v0.5.0 已后台化）

```bat
:: 启动后台瓦片服务并打开应用；命令会立即返回，不需要保持窗口
MaoMaoEarth.exe mbtiles "D:\data\china.mbtiles"

:: 不自动打开浏览器（自动化/脚本）
MaoMaoEarth.exe mbtiles "D:\data\china.mbtiles" --no-browser

:: 停止后台 MBTiles 服务（同时停止静态服务）
MaoMaoEarth.exe stop
```

启动器输出示例：

```
MBTiles 已在后台挂载：D:\data\china.mbtiles
MBTILES_SERVER=http://127.0.0.1:8140
MBTILES_TOKEN=...
MBTILES_APP=http://127.0.0.1:8123/?mbtiles=...&mbtoken=...
MBTILES_PID=1234
```

后台状态保存在项目根目录 `.maomaoearth-mbtiles.state`（`pid/port/token/file`）。
再次执行 `mbtiles` 会先停止旧的 MBTiles 服务再启动新的。

应用内也可用侧栏「数据状态 → 加载 MBTiles…」手动填服务地址 + Token。

## 关于“保持启动器运行 / 工程重新打开”

v0.5.0 起 **不需要保持命令行窗口**：

| 场景 | 用户操作 |
|---|---|
| 第一次使用 | 运行一次 `MaoMaoEarth.exe mbtiles "文件.mbtiles"`，应用自动打开 |
| 关闭应用后再次打开 | 后台服务仍在，直接打开应用即可（或点「加载 MBTiles...」填地址/Token） |
| 电脑重启 / 手动 `stop` 后 | 重新运行同一条 `mbtiles` 命令即可 |
| 打开旧 `.leproj` | 工程会恢复相机/地形/其他图层；**MBTiles 图层暂不写入工程**（token 每次启动变化），重新运行 `mbtiles` 命令即可恢复 MBTiles |
| 停止服务 | `MaoMaoEarth.exe stop`（同时停静态服务） |

> `.leproj` 不保存 MBTiles 的原因是：服务 token 每次启动随机，保存后下次也连不上；文件路径可以保存，但启动本地服务必须由用户进程执行，浏览器无法自动拉起 EXE。

## 支持范围

- 栅格：**PNG / JPEG / WebP**（按 `metadata.format` 与文件头判断）。
- 矢量：**pbf / MVT**（Mapbox Vector Tile 2.x）→ 纯 JS 解码 + Canvas 栅格化，支持 polygon/line/point，按图层名稳定配色。
- 坐标系：**EPSG:3857**、**EPSG:4326**（`metadata.crs` 或 `projection`；缺省 3857）。
- TMS 行号自动翻转；`metadata.scheme=xyz` 时按 XYZ。
- `metadata`：`name/format/crs/bounds/minzoom/maxzoom/attribution/scheme/description`。
- 大文件按 tile 查询，不整库载入内存。
- gzip 压缩的 pbf 由 `LEMvt` 用 `DecompressionStream('gzip')` 解压（C# 服务原样返回）。

## 不支持 / 限制

- **MVT 不做完整制图渲染**：不解析 style.json/表达式/过滤器/标签/图标/碰撞；按图层名调色板绘制；洞用 evenodd。
- 非 WebMercator/EPSG:4326 的其它投影未适配。
- MBTiles 服务只监听 `127.0.0.1`，**仅本机可用**，不提供公网/局域网分享。
- 工程 `.leproj` 暂不保存 MBTiles 图层（见上表操作）。
- 后台服务在用户会话中运行；注销/重启后需重新启动。

## 测试记录（2026-10-21，v0.5.0）

| 用例 | 结果 |
|---|---|
| 后台启动 `mbtiles` | 父进程立即退出，子进程 PID 写入 state；静态/瓦片服务 200 |
| `stop` | 同时停止后台 MBTiles 与静态服务 |
| 栅格 EPSG:3857（wind-area，27 瓦片 z10–12） | meta/tile 200；缺失 204；错误 token 403；CORS 正常 |
| 栅格 EPSG:4326（raster-4326，z0 2 瓦片） | `LEMBTiles` loaded；provider 为 `GeographicTilingScheme`；requestImage 0/1 均 256×256，蓝色像素 61730/65536 |
| 矢量 EPSG:3857（vector-3857，pbf z0） | format=pbf；`LEMvt` 1.0.0；canvas 非透明 11750 px；无 page-error |
| 矢量 EPSG:4326（vector-4326，pbf z0 2 瓦片） | provider Geographic；两瓦片 canvas 各 11750 非透明；无 page-error |
| 真实启动器链路 | `MaoMaoEarth.exe mbtiles ...` 后台服务 + 应用 URL 自动加载；`stop` 后 8140 关闭 |

截图：

- `docs/screenshots/08-mbtiles.png`（栅格 MBTiles）
- `docs/screenshots/09-mvt.png`（MVT 矢量渲染）
- `docs/testdata/mbtiles-raster-4326.png`、`mbtiles-vector-3857.png`、`mbtiles-vector-4326.png`

## 相关文档

- [MVT 解码/栅格化](MVT.md)
- [CLI](CLI.md)
- [API](API.md)

# MBTiles 直读（v0.4.0）

## 思路

MBTiles 是 SQLite 数据库（`metadata` + `tiles` 两张表）。浏览器不能直接读 SQLite，所以由 **本地启动器内置一个小型瓦片服务**：

```
MaoMaoEarth.exe mbtiles <file.mbtiles>
  ├─ 静态服务（127.0.0.1:8123 或自动端口）
  └─ MBTiles 瓦片服务（C# HttpListener，127.0.0.1:8140 起自动端口）
        GET /meta.json?token=...
        GET /tiles/{z}/{x}/{y}.{png|jpg|webp}?token=...
             ↓
        winsqlite3.dll（Windows 10/11 自带 SQLite）
        SELECT tile_data FROM tiles
        WHERE zoom_level=? AND tile_column=? AND tile_row=?
```

前端 `js/mbtiles.js` 读取 `metadata` 后用 `Cesium.UrlTemplateImageryProvider` 加载，注册为普通 imagery 图层，因此支持图层管理器里的显隐/透明度/排序/删除。

## 使用

```bat
:: 启动瓦片服务并自动打开应用（会保留命令行窗口，Ctrl+C 停止）
MaoMaoEarth.exe mbtiles "D:\data\china.mbtiles"

:: 不自动开浏览器（自动化/脚本）
MaoMaoEarth.exe mbtiles "D:\data\china.mbtiles" --no-browser
```

启动后终端会输出：

```
MBTILES_SERVER=http://127.0.0.1:8140
MBTILES_TOKEN=...
MBTILES_META=http://127.0.0.1:8140/meta.json?token=...
MBTILES_APP=http://127.0.0.1:8123/?mbtiles=...&mbtoken=...
```

应用也可以用 URL 参数加载：

```
http://127.0.0.1:8123/?mbtiles=http%3A%2F%2F127.0.0.1%3A8140&mbtoken=TOKEN
```

或侧栏「数据状态 → 加载 MBTiles…」手动填服务地址 + Token。

## API

```js
await MaoMaoEarth.mbtiles.load('http://127.0.0.1:8140', 'TOKEN');
MaoMaoEarth.mbtiles.getState();
MaoMaoEarth.mbtiles.clear();
```

底层：`window.LEMBTiles`。

## 支持范围

- 栅格瓦片：**PNG / JPEG / WebP**（按 `metadata.format` 与文件头判断 Content-Type）。
- 坐标系：**WebMercator（EPSG:3857）**，TMS 行号自动翻转；`metadata.scheme=xyz` 时按 XYZ。
- `metadata`：读取 `name/format/bounds/minzoom/maxzoom/attribution/scheme/description`；缺失的 `minzoom/maxzoom` 会从 `tiles` 表统计，缺失 `bounds` 用全球范围。
- 大文件：按 tile 查询，不整库载入内存；数据库只读打开。

## 不支持 / 限制

- **矢量 MBTiles（pbf/MVT）**：Cesium ImageryProvider 不能直接渲染，需单独的矢量瓦片渲染器；当前明确不支持。
- **非 WebMercator**（如 EPSG:4326 瓦片）未适配；目前按 WebMercator 请求。
- 关闭启动器窗口/停止命令后瓦片服务停止；工程 `.leproj` 暂不保存 MBTiles 图层（因为 token 每次启动变化），需要重新运行 `mbtiles` 命令。
- 服务只监听 `127.0.0.1`，每次启动生成随机 token；CSP 已允许 `http://127.0.0.1:*` 的图片/连接。

## 测试记录（2026-10-21）

样例：`data/samples/mbtiles/wind-area.mbtiles`（483,328 B，27 个瓦片，z10–12，jpg，TMS）。

| 项 | 结果 |
|---|---|
| `GET /meta.json?token=` | 200，name/format/bounds/minzoom/maxzoom/attribution 正确 |
| `GET /tiles/10/803/438.jpg` | 200，18,640 B，`image/jpeg`，TMS 翻转正确 |
| 缺失瓦片 | 204 |
| 错误 token | 403 |
| CORS | `Access-Control-Allow-Origin: *` |
| 应用自动加载 | `LEMBTiles.getState().loaded=true`；imagery 层 8；图层名 `MBTiles · Wind Area MBTiles Sample`；无 page-error |
| 截图 | `docs/screenshots/08-mbtiles.png` |

验证命令：

```powershell
MaoMaoEarth.exe mbtiles data\samples\mbtiles\wind-area.mbtiles --no-browser --port 8127
curl "http://127.0.0.1:8140/meta.json?token=..." 
```

## 后续可选增强

- 工程保存 MBTiles 文件路径 + 启动参数（下次提示重新启动瓦片服务）；
- `metadata` 的 `crs`/`bounds` 支持 4326，增加 `GeographicTilingScheme`；
- 矢量 MBTiles（pbf）单独做 MVT 渲染层；
- 支持 `.mbtiles` 拖入应用（需要本地启动器弹出文件对话框并把路径交给瓦片服务）。

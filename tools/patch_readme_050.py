p=r'G:\sh\local-earth\README.md'
c=open(p,encoding='utf-8').read()
reps=[
('> **v0.4.0**','> **v0.5.0**'),
('- **MBTiles 直读**：`MaoMaoEarth.exe mbtiles 文件.mbtiles` 启动本地瓦片服务，按 z/x/y 查 SQLite（winsqlite3，不整库载入），支持 png/jpg/webp、TMS/XYZ、图层透明度/排序。',
 '- **MBTiles 直读**：`MaoMaoEarth.exe mbtiles 文件.mbtiles` 后台启动本地瓦片服务（无命令行窗口），按 z/x/y 查 SQLite（winsqlite3，不整库载入）；支持 png/jpg/webp 栅格、**pbf/MVT 矢量瓦片**、**EPSG:3857 / EPSG:4326**、TMS/XYZ、图层透明度/排序。'),
('| MBTiles 直读 | |\n|---|---|\n| ![MBTiles](docs/screenshots/08-mbtiles.png) | 本地 SQLite 瓦片服务 + ImageryProvider |',
 '| MBTiles 直读 | MVT 矢量瓦片 |\n|---|---|\n| ![MBTiles](docs/screenshots/08-mbtiles.png) | ![MVT](docs/screenshots/09-mvt.png) |\n| 本地 SQLite 瓦片服务 + ImageryProvider | 纯 JS MVT 解码 + Canvas 栅格化 |'),
('- `maomaoearth-v0.4.0.zip`（代码/程序，含 `MaoMaoEarth.exe`）','- `maomaoearth-v0.5.0.zip`（代码/程序，含 `MaoMaoEarth.exe`）'),
('> MBTiles 使用：`MaoMaoEarth.exe mbtiles "D:\\data\\china.mbtiles"`，详见 [docs/MBTILES.md](docs/MBTILES.md)。',
 '> MBTiles 使用：`MaoMaoEarth.exe mbtiles "D:\\data\\china.mbtiles"`（后台服务，无窗口；`MaoMaoEarth.exe stop` 停止），详见 [docs/MBTILES.md](docs/MBTILES.md)。'),
('| MBTiles | 本地 SQLite 瓦片直读（png/jpg/webp，TMS/XYZ） |','| MBTiles | 本地 SQLite 瓦片直读（png/jpg/webp/pbf，3857/4326，TMS/XYZ） |'),
('mbtiles.js               # MBTiles 本地瓦片服务客户端（v0.4.0）','mbtiles.js               # MBTiles 本地瓦片服务客户端（v0.5.0）'),
('- [MBTiles 说明与验证](docs/MBTILES.md)：本地 SQLite 瓦片服务、TMS、测试记录','- [MBTiles 说明与验证](docs/MBTILES.md)：本地 SQLite 瓦片服务、TMS、4326、MVT 测试记录\n- [MVT 解码/栅格化](docs/MVT.md)：pbf 瓦片支持范围与限制'),
('- **MBTiles**：支持 WebMercator 栅格 png/jpg/webp；pbf 矢量瓦片与 EPSG:4326 瓦片未支持；需通过 `MaoMaoEarth.exe mbtiles` 启动瓦片服务，工程暂不保存。',
 '- **MBTiles**：栅格 png/jpg/webp 与 pbf/MVT 均已支持（MVT 为按瓦片 Canvas 栅格化，非 style.json 渲染）；EPSG:4326 支持。服务需通过 `MaoMaoEarth.exe mbtiles` 启动（后台），工程暂不保存 MBTiles 图层。\n- **仅本机可用**：MBTiles/地图服务只监听 `127.0.0.1`，分享链接只在本机有效，不提供公网访问。'),
('  js/\n    mbtiles.js','  js/\n    mvt.js                   # MVT 解码 + Canvas 栅格化（v0.5.0）\n    mbtiles.js'),
]
for a,b in reps:
    if a==b: continue
    if a in c: c=c.replace(a,b,1)
    else: print('MISS',a[:50])
open(p,'w',encoding='utf-8',newline='').write(c)
print('README updated')

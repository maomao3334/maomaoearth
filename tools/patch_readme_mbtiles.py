p=r'G:\sh\local-earth\README.md'
c=open(p,encoding='utf-8').read()
reps=[
('> **v0.3.0**','> **v0.4.0**'),
('**v0.3.0**','**v0.4.0**'),
('- **离线影像**：NASA Blue Marble 全球底图；Sentinel-2 cloudless 东亚 z5–z8、宽域 z9–z12、风场区 z13–z14；支持本地 XYZ 目录与 GeoTIFF。',
 '- **离线影像**：NASA Blue Marble 全球底图；Sentinel-2 cloudless 东亚 z5–z8、宽域 z9–z12、风场区 z13–z14；支持本地 XYZ 目录与 GeoTIFF。\n- **MBTiles 直读**：`MaoMaoEarth.exe mbtiles 文件.mbtiles` 启动本地瓦片服务，按 z/x/y 查 SQLite（winsqlite3，不整库载入），支持 png/jpg/webp、TMS/XYZ、图层透明度/排序。'),
('| 实时光照 | 离线地名/坐标搜索 |\n|---|---|\n| ![光照](docs/screenshots/07-lighting.png) | ![搜索](docs/screenshots/06-search.png) |',
 '| 实时光照 | 离线地名/坐标搜索 |\n|---|---|\n| ![光照](docs/screenshots/07-lighting.png) | ![搜索](docs/screenshots/06-search.png) |\n\n| MBTiles 直读 | |\n|---|---|\n| ![MBTiles](docs/screenshots/08-mbtiles.png) | 本地 SQLite 瓦片服务 + ImageryProvider |'),
('maomaoearth.cmd windninja "D:\\Wind3D\\results\\case\\windninja\\20240403T080600Z\\h050m\\r0200m"',
 'maomaoearth.cmd windninja "D:\\Wind3D\\results\\case\\windninja\\20240403T080600Z\\h050m\\r0200m"\nmaomaoearth.cmd mbtiles "D:\\data\\china.mbtiles"'),
('   - `maomaoearth-v0.3.0.zip`（代码/程序，含 `MaoMaoEarth.exe`）','   - `maomaoearth-v0.4.0.zip`（代码/程序，含 `MaoMaoEarth.exe`）'),
('**安装**：解压程序包到任意目录，再把数据包解压到同一目录（合并 `data/`），双击 `MaoMaoEarth.exe`。',
 '**安装**：解压程序包到任意目录，再把数据包解压到同一目录（合并 `data/`），双击 `MaoMaoEarth.exe`。\n\n> MBTiles 使用：`MaoMaoEarth.exe mbtiles "D:\\data\\china.mbtiles"`（详见 [docs/MBTILES.md](docs/MBTILES.md)）。'),
('| 导出 | PNG、PDF、GeoJSON、KMZ |','| 导出 | PNG、PDF、GeoJSON、KMZ |\n| MBTiles | 本地 SQLite 瓦片直读（png/jpg/webp，TMS/XYZ） |'),
('    mbtiles.js                  # MBTiles（v0.4.0）','    mbtiles.js                  # MBTiles（v0.4.0）'),
('- **MBTiles 未支持**：COG/GeoTIFF 可直接导入；XYZ 目录需 `z/x/y` 且 Web 墨卡托。',
 '- **MBTiles**：支持 WebMercator 栅格 png/jpg/webp；pbf 矢量瓦片与 EPSG:4326 瓦片未支持；需通过 `MaoMaoEarth.exe mbtiles` 启动瓦片服务，工程暂不保存。'),
('  js/\n    main.js','  js/\n    mbtiles.js               # MBTiles 本地瓦片服务客户端（v0.4.0）\n    main.js'),
('## 已知限制','## 已知限制'),
]
for a,b in reps:
    if a!=b:
        if a in c: c=c.replace(a,b,1)
        else: print('MISS:',a[:60])
open(p,'w',encoding='utf-8',newline='').write(c)
print('README patched')

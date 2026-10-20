# 内置数据与来源（全部离线）

所有数据随应用目录分发，运行时不联网。完整文件清单与 SHA-256 见 [data-manifest.json](data-manifest.json)。

## 影像

| 数据 | 文件 | 大小 | 来源/许可 |
|---|---|---|---|
| NASA Blue Marble（2004-12，地形+海深） | `data/public/imagery/blue-marble-21600.jpg` | 28.5 MB | NASA Visible Earth；公有领域 |
| 高清底图瓦片 z0–z5（1365 张，256px JPEG） | `data/public/tiles/blue-marble/{z}/{x}/{y}.jpg` | 13.1 MB | 由上一行切分（Web Mercator）；公有领域 |
| 示例单幅底图（低清回退） | `data/samples/world.topo.bathy.200412.3x5400x2700.jpg` | 2.4 MB | 同上 |
| 本地 XYZ 示例瓦片 z0–z3 | `data/samples/tiles/{z}/{x}/{y}.png` | 6.7 MB | 由示例单幅切分；公有领域 |

## 矢量

| 数据 | 文件 | 大小 | 来源/许可 |
|---|---|---|---|
| Natural Earth 10m 国界 | `data/public/vectors/ne_10m_admin_0_countries.geojson` | 12.7 MB | Natural Earth；公有领域 |
| Natural Earth 10m 河流 | `data/public/vectors/ne_10m_rivers_lake_centerlines.geojson` | 7.0 MB | Natural Earth；公有领域 |
| Natural Earth 10m 湖泊 | `data/public/vectors/ne_10m_lakes.geojson` | 4.8 MB | Natural Earth；公有领域 |
| Natural Earth 10m 城市 | `data/public/vectors/ne_10m_populated_places_simple.geojson` | 4.7 MB | Natural Earth；公有领域 |
| Natural Earth 110m 国界/城市（示例） | `data/samples/ne_110m_*.geojson` | ~1 MB | Natural Earth；公有领域 |

说明：Natural Earth 1:10m 的州/省界与海岸线文件本次下载失败（源站/网络原因），未包含；需要时可另行下载放入同一目录。

## 地形（SRTM）

| 数据 | 文件 | 大小 | 来源/许可 |
|---|---|---|---|
| SRTM 1″ DEM（N25E102，25–26N / 102–103E） | `data/public/dem/N25E102.hgt.gz` | 14.8 MB | NASA/USGS SRTM；经 AWS Terrain Tiles 分发；公有领域 |
| 示例区 1″ 全分辨率地形高度栅格 | `data/public/dem/N25E102-terrain.bin`（+ `.json`） | 25.9 MB | SRTM 全分辨率（3601×3601 int16，≈30 m） |
| 示例区高精度地形阴影 | `data/public/dem/N25E102-hillshade.png` | 25.0 MB | 由 1″ DEM 生成（4096×4096 不透明） |
| 中国 0.02° 地形高度栅格 | `data/public/dem/china-terrain.bin`（+ `.json`） | 12.2 MB | AWS Terrain Tiles（Terrarium z8，SRTM/ETOPO 组合，开放数据）|
| 中国地形阴影图 | `data/public/dem/china-hillshade.png` | 2.8 MB | 由上一行生成（2048×1216 不透明）|
| 全球 0.1° 地形高度栅格 | `data/public/dem/world-terrain.bin`（+ `.json`） | 12.2 MB | AWS Terrarium z4（SRTM/ETOPO，开放数据）|
| 全球地形阴影图 | `data/public/dem/world-hillshade.png` | 0.8 MB | 由上一行生成（2048×967 不透明）|
| 东亚 0.02° 地形高度栅格 | `data/public/dem/eastasia-terrain.bin`（+ `.json`） | 28.5 MB | AWS Terrarium z7（SRTM/ETOPO，开放数据）|
| 东亚地形阴影图 | `data/public/dem/eastasia-hillshade.png` | 1.5 MB | 由上一行生成（2048×1293 不透明）|
| Sentinel-2 cloudless 卫星影像瓦片（z5–z8，东亚/中国） | `data/public/imagery/s2cloudless/{z}/{x}/{y}.jpg`（2986 张） | 29.2 MB | Sentinel-2 cloudless by EOX IT Services GmbH，**CC BY 4.0**（仅本地缓存）|
| 风场周边宽域高清影像（z9–z12） | 同目录（2151 张） | 32.8 MB | 100–105E/23–27N，约 10–300 m/px（同上授权）|
| 示例区超清卫星影像（z13–z14，风场区域） | `data/public/imagery/s2cloudless/{z}/{x}/{y}.jpg`（269 张） | 2.6 MB | 102.2–102.6E/24.95–25.15N，约 10 m 原生分辨率 |
| 元数据 | `data/public/dem/N25E102.json` | 321 B | 本机生成 |

用途：`?dem=data/public/dem/N25E102-hillshade.png` 或侧栏“SRTM 地形阴影（示例区）”。
该区域与用户 Wind3D KMZ 的范围（102.35–102.45E，25.02–25.07N）重叠，可作为风场底图。

## 生成脚本

- `tools/make_tiles_hires.py`：由 21600×10800 Blue Marble 生成 z0–z5 瓦片。
- `tools/make_dem_hillshade.py` / `make_dem_hillshade2.py`：解析 SRTM `.hgt.gz`，计算坡度阴影/高程着色并输出 PNG（后者为不透明 2048²）。
- `tools/make_terrain_bin.py`：把 SRTM 降采样为 1025×1025 int16 地形高度栅格，供 3D 地形使用。
- `tools/make_china_terrain.py`：下载 AWS Terrarium z8 瓦片（1656 张）→ 生成中国 0.02° 高度栅格与全国阴影图（可离线重跑）。
- `tools/make_world_terrain.py`：下载 AWS Terrarium z4 全球瓦片（256 张）→ 生成全球 0.1° 高度栅格与阴影图。
- `tools/make_eastasia_terrain.py`：下载 AWS Terrarium z7 东亚瓦片（980 张）→ 生成东亚 0.02° 高度栅格与阴影图。
- `tools/download_s2_tiles.py`：下载 EOX Sentinel-2 cloudless 瓦片（z5–z8，东亚/中国）供卫星影像叠加。
- `tools/data_manifest.py`：生成 `docs/data-manifest.json`（大小 + SHA-256）。
- `tools/make_tiles.py`：由示例单幅生成 z0–z3 示例瓦片。

## 许可与合规

- NASA Blue Marble、Natural Earth、SRTM 均为公有领域/开放数据；可随应用分发。
- 不要用本应用批量下载或再分发 Google 影像/地图数据。
- 用户自有数据由用户自行确认许可；本应用只在本地读取，不上传、不联网。

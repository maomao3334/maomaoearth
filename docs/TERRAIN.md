# 3D 地形与箭头贴地（LETerrain）

> 2026-10-19 更新：地形已扩展为**全中国**（72–136E / 17–55N，0.02° 兜底 + 示例区 1″ 高精度），
> 多源实现、加载策略与全国验证见 [TERRAIN-CHINA.md](TERRAIN-CHINA.md)。本文保留示例区高精度数据与早期实现细节。

## 数据与来源

| 文件 | 内容 | 大小 |
|---|---|---|
| `data/public/dem/N25E102-terrain.json` | 地形元数据：范围 102–103E / 25–26N，1025×1025，int16 小端，行序北→南，米 | 556 B |
| `data/public/dem/N25E102-terrain.bin` | 高度栅格（由 SRTM 1″ 降采样） | 2.1 MB |
| `data/public/dem/N25E102-hillshade.png` | 由同一 DEM 生成的坡向阴影+高程着色（2048×2048，不透明） | 7.3 MB |
| `data/public/dem/N25E102.hgt.gz` | 原始 SRTM 1″ 瓦片（保留） | 14.8 MB |

来源：NASA/USGS SRTM（公有领域），经 AWS Terrain Tiles 分发；完全离线。

## 实现（`js/terrain.js`）

- **解析**：`fetch` 读取 `.bin` + `.json`，构建 `Float32Array` 高度数组（约 1M 点）。
- **采样**：`LETerrain.heightAt(lon, lat)` 双线性插值；区域外返回 0；边缘 0.005° 内做平滑淡出，避免 1° 边界断崖。
- **地形 Provider**：`Cesium.CustomHeightmapTerrainProvider`，每块地形瓦片 65×65 高度（`GeographicTilingScheme`），回调按瓦片范围采样 DEM；无数据区域返回 0（平地）。
- **渲染**：开启时设置 `viewer.terrainProvider`、`scene.globe.depthTestAgainstTerrain = true`，并自动叠加 SRTM 阴影图（否则纯几何看不出起伏）；关闭时恢复 `EllipsoidTerrainProvider`。
- **箭头贴地**：`js/kml-native.js` 在渲染 KML 时调用 `LE.heightAt()`：
  - `relativeToGround`：`地形高度 + max(数据高度, 0) + 2 m`；
  - `clampToGround`：`地形高度 + 2 m`；
  - 地形开/关切换时调用 `LEKml.redrape()` 重新计算已加载折线/面/点的高度，无需重新导入。
- **交互**：
  - 侧栏「3D 地形（开/关）」按钮；
  - URL：`?terrain=1`（默认）或 `?terrain=0` 关闭；
  - `?hillshade=0` 可关闭自动阴影图（只保留三维几何）；
  - `?cam=lon,lat,height,pitch` 可定位相机，例如
    `http://127.0.0.1:8123/?demo=data%2Fsamples%2Fwind%2Fwind3d_test.kmz&cam=102.3997,25.02,6000,-45`

## 验证（本机、Playwright + 内部探针）

| 项目 | 结果 |
|---|---|
| 地形数据加载 | 通过：ready=true，范围 102–103E / 25–26N，高度 906–3245 m |
| 高度采样 | 通过：中心 (102.4, 25.045) = 2132 m；边缘淡出≈5 m；区域外=0 |
| 地形 Provider | 通过：`CustomHeightmapTerrainProvider`；`depthTestAgainstTerrain=true` |
| 箭头贴地 | 通过：风场第一个顶点 `height=1406.007 m`，地面 `1379.007 m`，**高于地面 27 m**（数据 25 m + 2 m） |
| 渲染可见性 | 通过：红/橙/黄箭头铺满区域并被地形遮挡/抬升（像素统计彩色 25k+） |
| 阴影图 | 通过：地形起伏可见（`terrain-wind3d-opaque.png`） |
| 关闭地形 | 通过：恢复椭球、去除阴影层、`redrape` 回退 |

截图：`docs/testdata/terrain-wind3d-opaque.png`（局部近景，箭头随地形）、`terrain-10km.png`（高空视角）、`terrain-wind3d-final.png` 等。

## 已知限制

1. **覆盖范围**：只有 SRTM 瓦片 `N25E102`（102–103E，25–26N，约 111×111 km）；区域外是平地。要覆盖更大范围需下载更多 SRTM 瓦片并重复生成（`tools/make_terrain_bin.py` / `tools/make_dem_hillshade2.py`）。
2. **低角度/边缘**：在非常斜的视角或数据边界附近，可能出现少量黑色缝隙/过渡带（瓦片边缘/裁剪所致）；抬高相机或关闭 3D 地形可规避。
3. 地形网格为 65×65/瓦片，属视觉平滑而非测量级；不用于高程量测。
4. 只做了颜色阴影（烘焙 hillshade），未启用 Cesium 实时光照/法线。
5. 高度按椭球高（EGM96 差异未校正，米级到十米级误差）。

## 下一步可做

- 批量下载更多 SRTM 瓦片（或全国/全球数据）生成统一 heightmap；
- 用 `CustomHeightmapTerrainProvider.requestVertexNormals` + 实时光照增强立体感；
- 把箭头改为贴地 `GroundPolylinePrimitive`（在有真实地形后可行）以减少逐点采样；
- 增加“地形夸张”滑杆（同时缩放 `heightAt`，避免箭头与地面错位）。

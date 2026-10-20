# 全国 3D 地形（LETerrain 多源 heightmap）

把 3D 地形从「仅 102–103E / 25–26N 示例区」扩展为**全中国范围（72–136E / 17–55N）**，同时保持 KML 箭头贴地。
实现文件：`js/terrain.js`（公开 API 保持不变：`init / ensureLoaded / apply / disable / toggle / heightAt / isEnabled / isReady / stats`）。

## 数据源（全部离线）

| 源 | 元数据 / 数据 | 范围 | 规格 | 用途 |
|---|---|---|---|---|
| 示例区高分辨率 | `data/public/dem/N25E102-terrain.json` + `.bin` | 102–103E / 25–26N | 1025×1025，int16 LE，0.0009766°（≈1″），scale=1，offset=0 | **优先**：范围内双线性采样；KML 箭头贴地 |
| 全中国 | `data/public/dem/china-terrain.json` + `.bin` | 72–136E / 17–55N | 3200×1900，6,080,000 点，int16 LE，0.02°（≈2.2 km），rowOrder=north-to-south，min 0 / max 8165 m | 示例区外兜底；**懒加载**（约 12.16 MB） |
| 全国阴影 | `data/public/dem/china-hillshade.png` | 同一 bbox | 2048×1216，不透明，坡向阴影+高程着色 | 开启 3D 地形时自动叠加（opacity 1.0） |
| 旧阴影（保留，默认不用） | `data/public/dem/N25E102-hillshade.png` | 102–103E / 25–26N | 2048×2048 | 仅当全国地形/阴影不可用时回退 |

来源：NASA/USGS SRTM、AWS Terrain Tiles（公有领域/开放数据），经 Lead 离线生成；页面不访问任何外部资源。

## 实现要点

### 1. 多源组合 `heightAt(lon, lat)`

```
1) 在示例区 bbox 内      → 高分辨率双线性（中国源就绪时不做内部淡出，保持原精度）
2) 示例区外、距边界 < 0.02°  → 高分辨率边缘延拓值 ↔ 中国网格 平滑混合（smoothstep），消除 1° 边界断崖
3) 在中国 bbox 内         → 中国 0.02° 网格双线性，bbox 边缘 0.05°（≈5.5 km）淡出到 0
4) 其它区域              → 0（海洋/境外平地）
```

- 原始数据以 `Int16Array` 常驻（不复制 608 万点 `Float32Array`），双线性采样时就地乘 `scale` 加 `offset`，内存约 14.3 MB（12.16 + 2.1 MB）。
- `heightAt` 被地形瓦片回调和 `LE.heightAt`（KML 贴地）共用，二者高度基准一致。

### 2. 懒加载与回退

- 启动时只加载示例区（≈2.1 MB）。
- 首次开启 3D 地形（默认 `?terrain=1`，或点击侧栏「3D 地形（开/关）」）时 `fetch` 全国数据；加载期间 `le.setLoading(true, '正在加载全国地形数据…')` 并更新状态栏；完成后关闭 loading。
- 失败（404/网络错误/尺寸不符）时：`china.failed=true`，保留示例区地形继续工作，`le.toast()` 提示「全国地形数据加载失败，已回退为示例区地形」，状态栏转红。不会反复请求。
- `?terrain=0` 不触发全国数据加载（已用 `stats().china.ready=false` 验证）。
- 若外部直接调用 `apply()`（未先 `ensureLoaded/toggle`），会在后台补加载全国数据，就绪后重新赋值 `terrainProvider` 触发瓦片刷新。

### 3. 地形 Provider（重要修正）

- 仍用 `Cesium.CustomHeightmapTerrainProvider`，`GeographicTilingScheme`，每瓦片 65×65 高度；无数据瓦片直接返回全 0。
- **行序修正**：Cesium `HeightmapTerrainData` 约定 buffer 第一行是瓦片**最北行**（`HeightmapTessellator` 里用 `north - row * delta`）；旧实现（复制并沿用）是「南→北」写数组，导致网格南北翻转。本次改为北→南，并用 `scene.globe.getHeight()` 与 `heightAt()` 对照验证（见下文）。这个修正对全国网格的起伏位置正确性很关键。

### 4. 阴影层

- 开启地形：按名称（`中国地形阴影（3D 地形配套）`）去重后叠加 `china-hillshade.png`，矩形 [72,17,136,55]，opacity 1.0。
- 不再自动叠加旧 1° `N25E102-hillshade.png`；仅当全国地形数据加载失败/全国阴影缺失时回退到旧 1° 阴影（避免「平地 + 全国阴影」的错觉）。
- `?hillshade=0` 关闭阴影层（地形仍开启）。
- 关闭地形：移除阴影层，恢复 `EllipsoidTerrainProvider` 与 `depthTestAgainstTerrain=false`，并 `LEKml.redrape()` 让箭头回落到椭球。
- 阴影添加是异步的（先 `HEAD` 探测文件），并在地形已关闭时放弃添加，避免「关了又出现阴影层」。

### 5. 兼容性

- `stats()` 保留旧字段 `meta`（示例区），新增：
  - `loading.{high,china}`、`high`（bbox/尺寸/分辨率/高程范围）、
  - `china.{ready,failed,loading,source:{bbox,width,height,resolutionDeg,minHeight,maxHeight,rowOrder,file,hillshade}}`。
- 激活方式不变：`?terrain=0/1`、`?hillshade=0`、侧栏按钮（`ui.js` 调用 `LETerrain.toggle`）。

## 自测（2026-10-19，headless Edge + CDP 本地探针）

环境：应用 `http://127.0.0.1:8123/`；Edge headless（1000×700），每页等待 20–22 s 后读取 `LETerrain.stats()`、`heightAt`、`globe.getHeight`、图层列表、控制台/页面错误，并截图。全程无 page-error / 未捕获异常。

### a) 全国视角

任务单指定 URL：

`http://127.0.0.1:8123/?cam=105,35,3000000,-35` → `docs/testdata/terrain-china-national.png`

- 地形 Provider 已切换、`depthTestAgainstTerrain=true`、`china.ready=true`、`errors=[]`。
- 说明：3000 km 高度处地平线下沉约 47°，而该 URL 的 pitch=-35° 在水平线以上，因此画面绝大部分是太空、只有下方一条地球边缘/阴影带；这是该相机参数本身的几何结果，不是地形失败。为直接展示全国起伏，另附：
  - `?cam=105,35,3000000,-90`（正俯视全国）→ `docs/testdata/terrain-china-national-nadir.png`：整个中国可见，青藏高原/塔里木/四川盆地/东部平原/海岸线与台湾清晰。
  - `?cam=105,35,1200000,-70` → `docs/testdata/terrain-china-national-3d.png`：全国范围阴影起伏可见。
  - `?cam=105,38,1500000,-60` → `docs/testdata/terrain-china-national-tilt.png`：斜视 3D 地形（可见地球曲率与地形起伏；55°N 以北为数据边界）。
- 高度采样（中国网格）：80,35→4938.43 m；105,35→1904.51 m；100,30→4832.04 m；116,40→371.27 m；90,50→1929.18 m；73,18 / 136,55（bbox 边缘淡出）→0；bbox 外 60,35 / 150,35 / 105,5 / 70,55 →0。
- `globe.getHeight()`（当前 LOD 网格）与 `heightAt()` 对照：105,35→1917.5 vs 1904.5；100,30→4637.7 vs 4832.0；90,45→1018.5 vs 1018.5；80,35→4585.1 vs 4938.4；87,30→4433.4 vs 5289.6（低 LOD 粗化，符合预期）。修正行序前同一测试出现负高程（网格翻转），修正后一致。

### b) 示例区仍高分辨率、箭头仍贴地

`http://127.0.0.1:8123/?demo=data%2Fsamples%2Fwind%2Fwind3d_test.kmz&cam=102.3997,25.0,6000,-45` → `docs/testdata/terrain-china-wind3d.png`

- 高分辨率源采样与改动前一致：102.5,25.5→1669 m；102.4,25.045→2132.09 m；102.9,25.9→2192.36 m（旧 `TERRAIN.md` 记录中心 ≈2132 m）。
- 风场共 2010 个实体；抽查前 6 条箭头：箭头顶点高度 − 地面 `heightAt` 均 = **27.00 m**（数据高度 25 m + 2 m 防闪烁），例如 (102.3513, 25.01838)：entityHeight 2097.86 / ground 2070.86。
- 近景 9 km 高度网格对照（`?cam=102.4,25.05,9000,-50`，`docs/testdata/terrain-china-meshcheck.png`）：102.4,25.05 网格 2092.7 vs heightAt 2092.2；102.3513,25.0184 网格 2069.9 vs 2070.9（示例区网格仍按高分辨率数据采样）。

### c) 侧栏「3D 地形（开/关）」切换

同一相机下点击 `#btn-terrain`：→ `docs/testdata/terrain-china-toggle-off.png`，再点一次 → `docs/testdata/terrain-china-toggle-on.png`

| 状态 | enabled | depthTestAgainstTerrain | 图层 |
|---|---|---|---|
| 初始（开） | true | true | 国界、中国地形阴影 |
| 点击后（关） | **false** | **false** | 仅国界（阴影层被移除） |
| 再点击（开） | true | true | 国界、中国地形阴影（重新叠加） |

三次读取均 `errors=[]`，关闭后恢复椭球地形，`LEKml.redrape` 回退。

### 附加验证

| 场景 | URL / 做法 | 结果 | 截图 |
|---|---|---|---|
| 关闭阴影 | `?hillshade=0&cam=105,35,3000000,-90` | 地形开启、`depthTest=true`、图层仅国界、全国高程可采样 | `terrain-china-nohillshade.png` |
| 关闭地形 | `?terrain=0&cam=105,35,3000000,-90` | `enabled=false`、恢复椭球、**不加载全国数据**（china.ready=false） | `terrain-china-terrainoff.png` |
| 加载中 UI | 限速 1.2 MB/s 打开页面，轮询状态 | 捕捉到 `chinaLoading=true`、loading 浮层可见、文案「正在加载全国地形数据（0.02°，约 12 MB）…」；随后加载完成 `china.ready=true`、`errors=[]` | `terrain-china-loading.png` |
| 全国数据失败回退 | CDP 屏蔽 `*china-terrain.bin*` | `china.failed=true`，地形仍开启、示例区采样不变（2132.09），阴影回退为旧 1° 图层并 toast；无 page-error（仅预期的 console.error） | `terrain-china-fallback.png` |

## 截图清单（`docs/testdata/`）

| 文件 | 内容 |
|---|---|
| `terrain-china-national.png` | 任务单指定相机（-35° 俯角，画面下方为地球边缘） |
| `terrain-china-national-nadir.png` | 3000 km 正俯视全国（中国全境） |
| `terrain-china-national-3d.png` | 1200 km / -70° 全国 3D 视角 |
| `terrain-china-national-tilt.png` | 1500 km / -60° 斜视，可见地形起伏与数据边界 |
| `terrain-china-wind3d.png` | 示例区风场箭头贴地 |
| `terrain-china-toggle-off.png` / `-on.png` | 侧栏开关关闭/开启 |
| `terrain-china-nohillshade.png` | `?hillshade=0` |
| `terrain-china-terrainoff.png` | `?terrain=0` |
| `terrain-china-loading.png` | 全国数据加载中 |
| `terrain-china-fallback.png` | 全国数据加载失败回退示例区 |
| `terrain-china-meshcheck.png` | 近景网格/heightAt 对照（可看到近景阴影图较粗） |

## 已知限制

1. **精度**：全国网格 0.02°（约 2.2 km）双线性平滑，属视觉地形，不用于高程量测；峰值被低估（数据 max 8165 m，珠峰实际 8848 m，z8 采样）。示例区仍为 ≈1″ 高分辨率。
2. **内存**：全国 Int16 约 12.16 MB + 示例区 2.1 MB 常驻（不额外复制 Float32 大数组）；首次开启需下载/解析约 12 MB。
3. **边界**：全国 bbox 外为 0（椭球平地），bbox 边缘 0.05° 淡出，仍会看到数据边界（如 55°N 以北）；示例区与全国网格在 1° 边界用 0.02° 过渡带混合，避免断崖。
4. **近景阴影偏粗**：全国阴影图 2048×1216 覆盖 64°×38°，约 0.031°/px（≈3.4 km/px）；旧 1° 阴影 2048²（≈54 m/px）按任务要求不再自动叠加，因此示例区近景的纹理观感比改前更平滑（几何/高程仍用高分辨率源；见 `terrain-china-meshcheck.png`、`terrain-china-toggle-on.png`）。
5. **无实时光照**：立体感主要来自烘焙阴影图；低 LOD 或掠射角下仍可能有少量平滑/接缝。
6. **相机参数提示**：3000 km 高度 + pitch −35° 会看向地平线以上（下沉角约 47°），如需看全国起伏请用俯角 −70°～−90°。
7. 旧 `N25E102-hillshade.png` 与 `N25E102.hgt.gz` 保留未删除；旧阴影仅作为全国数据失败时的回退。
8. 地形夸张、实时光照/法线、更高分辨率全国数据可作为后续改进。

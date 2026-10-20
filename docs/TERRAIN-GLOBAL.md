# 东亚/全球 3D 地形 + 卫星影像 + 地形夸张（LETerrain）

在 3D 地形基础上：**东亚 0.02° 地形加密**、**Sentinel-2 cloudless 卫星影像/植被层**、**地形夸张滑杆增强（重置/快捷键/localStorage 记忆）**。箭头贴地仍通过同一条 `heightAt` 采样，保证地形网格与 KML 贴地一致。
实现文件：`js/terrain.js`、`index.html`、`js/ui.js`、`css/app.css`。完全离线。

## 1. 数据源（全部离线，已就绪）

| 源 | 文件 | 范围 | 规格 | 用途 |
|---|---|---|---|---|
| 示例区高分辨率 | `N25E102-terrain.json/.bin` | 102–103E / 25–26N | 1025²，int16 LE，≈1″（0.0009766°） | 最高优先级；箭头贴地最精确 |
| 东亚 | `eastasia-terrain.json/.bin` | 55–150E / 0–60N | 4750×3000，0.02°（≈2.2 km），int16 LE，rowOrder=north-to-south，min 0 / max 8225 m，28,500,000 B | 东亚范围兜底（取代原中国 0.02° 源） |
| 全球 | `world-terrain.json/.bin` | -180–180E / -85–85N | 3600×1700，0.1°（≈11 km），min 0 / max 11500 m，12,240,000 B | 全球底图 |
| 全球阴影 | `world-hillshade.png` | 同全球 bbox | 2048×967，不透明（海洋蓝） | 阴影层 1 |
| 东亚阴影 | `eastasia-hillshade.png` | 同东亚 bbox | 2048×1293，不透明，1,477,665 B | 阴影层 2 |
| 示例区细节阴影 | `N25E102-hillshade.png` | 102–103E / 25–26N | 2048²，≈54 m/px | 阴影层 3（最高） |
| 卫星影像 | `data/public/imagery/s2cloudless/{z}/{x}/{y}.jpg` | 三层：主影像 z5–z8、宽域高清 z9–z12（100–105E/23–27N）、超清 z13–z14（102.2–102.6E/24.95–25.15N） | EPSG:3857 Web Mercator，256×256 JPEG，5406 张 / 64.6 MB（z9=56、z10=195、z11=780、z12=1120、z13=60、z14=209 + 原 z5–z8=2986） | 植被/地表真实色彩，叠在阴影层之上 |

> 旧的 `china-terrain.json/.bin`、`china-hillshade.png` 文件保留但**不再加载**（东亚源已完全覆盖中国范围）。
> 卫星影像授权：**Sentinel-2 cloudless by EOX IT Services GmbH, CC BY 4.0**（仅本地缓存，运行时不访问原站，也不再分发原站）。

## 2. 多源高度优先级与边界平滑（`heightAt`）

```
N25 1″（102–103E/25–26N）
  → 东亚 0.02°（55–150E/0–60N）
    → 全球 0.1°（-180–180E/-85–85N）
      → 0（|lat| > 85 等）
```

- 示例区外 0.02° 过渡带：高分辨率边缘延拓值 ↔ 东亚 smoothstep 混合（消除 1° 断崖）。
- 东亚 bbox 边缘 0.05°：东亚 0.02° 与全球 0.1° smoothstep 混合（西/北边缘实测连续，见验证；南边缘 0°N 在苏门答腊海岸，0.1° 全球数据本身变化较大）。
- 全球 bbox 纬度 ±85° 边缘 0.1° 淡出到 0；经度方向覆盖 -180–180。
- 数据常驻 `Int16Array`（不复制浮点大数组），双线性采样时就地乘 `scale` 加 `offset`：东亚 28.5 MB + 全球 12.24 MB + 示例区 2.10 MB ≈ **42.8 MB**。

## 3. 懒加载与回退

- 启动只加载示例区（≈2.1 MB）。
- 首次开启 3D 地形（默认 `?terrain=1` 或侧栏按钮）时依次懒加载：东亚（≈28.5 MB）→ 全球（≈12 MB），加载中 `le.setLoading` + 状态栏文案（「正在加载东亚地形数据（0.02°，约 28.5 MB）…」→「正在加载全球地形数据…」）。
- 失败回退：东亚失败 → 继续加载/使用全球 + 示例区并 toast；全球失败 → 继续用东亚 + 示例区并 toast。`?terrain=0` 不加载东亚/全球数据。
- 外部直接调用 `apply()` 时也会后台补加载缺失的源，就绪后重建 Provider 刷地形。
- `stats()` 提供 `eastasia{ready,failed,loading,source{bbox,width,height,resolutionDeg,minHeight,maxHeight,rowOrder,file,hillshade}}`；保留兼容字段 `china`（内容为东亚源，已废弃）。

## 4. 阴影层顺序

地形开启时按以下顺序叠加（均为 `opacity: 1.0`，按名称去重，自底向上）：

1. `全球地形阴影（3D 地形配套）` — world-hillshade
2. `东亚地形阴影（3D 地形配套）` — eastasia-hillshade
3. `SRTM 地形阴影（示例区高精度）` — N25-hillshade（≈54 m/px 近景细节）

- 只有对应地形源已就绪时才添加该层；`?hillshade=0` 全部移除/不添加；关闭 3D 地形时全部移除。
- 旧版自动阴影名（`中国地形阴影（3D 地形配套）`、`SRTM 地形阴影（3D 地形配套）`）保留在清理名单中，避免残留。

## 5. 卫星影像层（Sentinel-2 cloudless）

- **三层** `Cesium.UrlTemplateImageryProvider`（同一 URL 模板，`WebMercatorTilingScheme`，256×256，EPSG:3857）：
  1. 主影像 `卫星影像（Sentinel-2 cloudless）`：rect 55–150E/0–60N，z5–8，alpha 0.92；
  2. 宽域高清 `卫星影像·宽域高清（z9–12）`：rect 100–105E/23–27N，z9–12，alpha 1.0；
  3. 超清 `卫星影像·超清（z13–14）`：rect 102.2–102.6E/24.95–25.15N，z13–14，alpha 1.0。
- 用 `imageryLayers.raiseToTop` 按 主影像 → 宽域 → 超清 的顺序保证叠加在**所有地形阴影层之上**；缺失瓦片透明回退下层（provider.errorEvent 监听忽略，避免 Cesium 控制台刷错）。
- 低层级/范围外无瓦片时该层透明，由 Blue Marble/下级影像显示，不会出现黑块（全球视角实测无黑块）。
- 侧栏「公开数据」区按钮 `#btn-imagery`（默认开启，文案「卫星影像（开/关）」）；点击同时显示/隐藏/移除三层影像；URL `?imagery=0` 关闭、默认开启；三层均以图层名注册到图层列表，可按名称去重/单独显隐。
- `?terrain=0` 时影像层仍可独立显示（叠在椭球/底图上），不依赖 3D 地形。

## 6. 地形夸张（1.0–3.0×）与增强

### 核心实现

- `state.exaggeration`（默认 1.0）+ 公开 API：
  - `LETerrain.setExaggeration(v)`：clamp 到 [1,3]、按 0.1 取整；写入 localStorage；松手后 **250 ms** 节流触发重建，重建本身再延后到 `requestAnimationFrame + setTimeout(0)`；同值不重建；记录耗时到 `console.debug('[LETerrain] rebuild ms=…')` 与 `stats().perf`；返回生效值。
  - `LETerrain.getExaggeration()`、`LETerrain.rebuildProvider()`：重建 `CustomHeightmapTerrainProvider` 并赋给 `viewer.terrainProvider`（Cesium 仅在 provider 实例变化时重新请求瓦片），再重新贴地。
- **只在 `heightAt` 出口乘**：`heightAt = rawHeightAt * exaggeration`。地形 Provider 的 33×33 采样与 KML 贴地（`LE.heightAt`）都走这个函数，因此网格与箭头永远一致。
- 地形关闭时滑杆仍可拖动：只保存值（不重建），重新开启后生效。

### 增强（本任务新增）

- **重置按钮**：滑杆右侧「重置」，点击回到 1.0× 并持久化。
- **快捷键**（输入框/搜索框/可编辑元素聚焦时不触发；Ctrl/Meta/Alt 组合不触发）：
  - `1` → 重置 1.0×；`[` → −0.1；`]` → +0.1（clamp 1–3）。
- **localStorage**：键 `localEarth.terrainExaggeration`。初始化优先级：URL `?exag=` > localStorage > 1.0；滑杆/快捷键/重置都会写入。
- UI 帮助对话框补充说明：夸张滑杆、快捷键、自动记忆与影像授权。

## 7. UI/文件

| 文件 | 变更 |
|---|---|
| `js/terrain.js` | 东亚源替换中国源、影像层管理（`toggleImagery/isImageryEnabled/syncImagery`）、`syncTerrainLayers`（阴影→影像置顶）、夸张持久化/快捷键所需 API、stats 扩展 |
| `index.html` | 滑杆行加「重置」按钮；新增 `#btn-imagery`；帮助对话框补快捷键说明与 EOX 授权 |
| `js/ui.js` | 滑杆/重置按钮绑定、`1`/`[`/`]` 快捷键、影像按钮与文案、初始化同步 URL/localStorage 生效值 |
| `css/app.css` | `.exag-reset` 按钮与 `.terrain-exag` 布局 |

## 8. 验证（2026-10-19，headless Edge + CDP，1000×700，每页等待约 40 s）

除「故意屏蔽东亚数据」场景的一条预期 `console.error` 外，**无 page-error / 未捕获异常**。

### a) 东亚/中国 + 卫星影像

`?cam=120,30,2500000,-60`（默认开启影像）→ `docs/testdata/terrain-imagery-eastasia.png`

- `eastasia.ready=true`（[55,0,150,60]，4750×3000，0.02°，min 0 / max 8225），影像层在阴影层之上（imageryLayer 索引 4/4，alpha 0.92），图层列表 5 项。
- 采样：120,30=36.66 m、100,30=4803.50 m、80,35=4950.04 m；130,40/145,10/110,20 为海面=0。
- 画面可见真实植被/地表颜色（绿色森林、黄褐高原、蓝色海洋）。
- `?imagery=0` → `docs/testdata/terrain-imagery-no-imagery.png`：图层 4 项、按钮「卫星影像（关）」、`stats.imagery.enabled=false`，回到阴影/底图。

### b) 全球视角

`?cam=105,35,9000000,-89` → `docs/testdata/terrain-imagery-global.png`

- 全球 + 东亚 + 示例区三层地形与阴影正常；影像 z5 覆盖东亚，低层级/范围外透明显示底图，无黑块、无 404。
- 采样：86.9,27.9=5046.81 m、105,35=1953.29 m、0,20=421.16 m、-70,-30=4301.73 m、0,0=0、-30,80=1567.84 m。
- 东亚 bbox 边缘过渡：西边界 54.9→1709.89、55.0→1750.46、55.4→1839.99（连续）；北边界 59.9→349.79、60.1→354.74；东边界 150（太平洋）=0。

### c) 示例区风场（夸张 + 影像同时生效）

`?demo=…wind3d_test.kmz&cam=102.3997,25.0,6000,-45&exag=2` → `docs/testdata/terrain-imagery-wind3d-exag2.png`

- 2010 个实体；箭头顶点 4168.73 m、`heightAt` 地面 4141.73 m（=2070.86×2），差 **27.00 m**（数据高度 25 m + 2 m 防闪烁；被放大的是地形高度，箭头自身偏移不随夸张缩放）。
- 影像层与三层阴影同时存在（图层 6 项）；无报错。

### d) 夸大滑杆增强

- 快捷键（真实 CDP 按键）：`]`×2 → 1.2×、`[` → 1.1×、`1` → 1.0×，滑杆与数值同步；输入框聚焦时按 `]` 不生效（保持 1.0×）；localStorage 依次为 1.2/1.1/1。
- 拖动滑杆到 2.0× → 数值「2.0×」、localStorage=2；点击「重置」→ 1.0×、localStorage=1。
- 刷新页面：设为 2.4× 后 reload，自动恢复 2.4×（滑杆/数值/localStorage 一致）。
- URL 优先：localStorage=2.4 时打开 `?exag=1.8` → 生效 1.8×（滑杆 1.8×），localStorage 不被覆盖。
- 截图：`docs/testdata/terrain-imagery-exag-slider.png`。

### e) 开关与组合

| 场景 | 结果 | 截图 |
|---|---|---|
| 侧栏 3D 地形 关 | `enabled=false`、三层阴影移除；影像层保留（独立图层） | `terrain-imagery-toggle-off.png` |
| 3D 地形 再开 | 阴影层恢复且影像仍在最上层（imageryLayers 顺序：底图 → 全球 → 东亚 → N25 → 影像） | `terrain-imagery-toggle-on.png` |
| 侧栏 影像 关/开 | 图层 5→4→5、按钮文案「关/开」、无报错 | 同上 |
| `?terrain=0` | 不加载东亚/全球；只剩「国界 + 卫星影像」（影像可独立显示） | `terrain-imagery-terrainoff.png` |
| `?hillshade=0` | 地形开启、三层阴影都不加，只剩「国界 + 卫星影像」 | `terrain-imagery-nohillshade.png` |
| `?terrain=0&imagery=0` | 只剩「国界」 | `terrain-imagery-alloff.png` |
| 屏蔽 `eastasia-terrain.bin` | `eastasia.failed=true`，回退全球 + 示例区（图层：国界+全球阴影+示例区高精度+影像），采样正常；仅一条预期 console.error | `terrain-imagery-eastasia-fallback.png` |

## 9. 截图清单（`docs/testdata/`）

| 文件 | 内容 |
|---|---|
| `terrain-imagery-eastasia.png` | 任务 a：2500 km / -60° 东亚，卫星影像 + 3D 地形 |
| `terrain-imagery-no-imagery.png` | `?imagery=0` 对比（阴影/底图） |
| `terrain-imagery-global.png` | 任务 b：9000 km 全球视角 |
| `terrain-imagery-wind3d-exag2.png` | 任务 c：风场箭头贴地 + 影像 + 2× 夸张 |
| `terrain-imagery-exag-slider.png` | 任务 d：滑杆 2.0×、重置按钮、快捷键后的界面 |
| `terrain-imagery-toggle-off.png` / `-on.png` | 任务 e：3D 地形开关 |
| `terrain-imagery-terrainoff.png` / `terrain-imagery-nohillshade.png` / `terrain-imagery-alloff.png` | 任务 e：`?terrain=0` / `?hillshade=0` / 两者 |
| `terrain-imagery-eastasia-fallback.png` | 东亚数据加载失败回退 |

（`terrain-global-*.png` 为上一轮全球地形+夸张证据，仍保留。）

## 10. 已知限制

1. **精度**：东亚 0.02°（≈2.2 km）双线性平滑，视觉地形、不用于量测；全球 0.1°（≈11 km）；示例区 ≈1″。东亚数据 max 8225 m（平滑后珠峰被低估）。
2. **内存/加载**：高度数据常驻约 42.8 MB；首次开启需加载约 40 MB 地形 + 约 9 MB 阴影 PNG（N25 细节阴影已由 4096² 降到 2048²，7.5 MB）；卫星影像 5406 张 / 64.6 MB 按需从本地读取（不一次性驻留）。
3. **影像覆盖**：主影像 z5–z8 限定东亚 bbox；宽域高清 z9–z12 仅 100–105E/23–27N；超清 z13–z14 仅 102.2–102.6E/24.95–25.15N。范围外/更高缩放会回退到较低层级影像或阴影/底图，层边缘可见矩形接缝；`?terrain=0` 时影像仍显示在椭球上（无地形立体感）。
4. **夸张**：只放大高度采样值，烘焙阴影纹理不变（高空视觉变化较微妙，低空/斜视明显）；夸张后地形不适于量测、坡度/距离估算；箭头自身 25 m+2 m 偏移不随夸张缩放（受 `kml-native.js` 写作用域限制）。
5. **无实时光照**，立体感来自烘焙阴影；地形网格为 33×33/瓦片（task-8 起，见 §11），为视觉平滑而非量测级。
6. **授权**：卫星影像 Sentinel-2 cloudless by EOX IT Services GmbH（CC BY 4.0），页面帮助与本文档已注明，本地缓存不分发原站。README 的数据来源不在本任务写作用域内，需由 Lead 同步补充。
7. `?imagery=0` 只影响影像层；`?hillshade=0` 只影响阴影层；两者与 `?terrain=0` 可任意组合（见验证表）。

## 11. task-8 更新：性能/卡死修复 + 扩大高清影像覆盖

### 11.1 改动（`js/terrain.js`）

1. **地形网格 65² → 33²**：每瓦片 heightAt 采样从 4225 降到 1089（−74%），降低瓦片生成/夸张重建的主线程峰值。A/B 截图（`grid65-*` vs `grid33-*`）视觉差异很小。
2. **`tileHeights` 快速路径**：① 与已加载数据无交集 → 全 0；② 瓦片只覆盖全球源 → 直接单源采样（跳过完整优先级链）；③ 瓦片不覆盖示例区 → 东亚/全球二分，避免每点走 N25 过渡带判断。
3. **瓦片回调异步化**：每个瓦片的高度采样放进独立 `setTimeout(0)` 宏任务（Cesium 支持 Promise），避免一帧内同步计算大量瓦片造成的长任务。
4. **夸张重建延后/合并/计时**：同值不重建；`requestAnimationFrame + setTimeout(0)` 延后执行；重建耗时写 `console.debug('[LETerrain] rebuild ms=… grid=… exag=…')` 和 `stats().perf {lastRebuildMs,rebuildCount,grid,tileSamples,providerExag}`。
5. **相机离地安全抬升**：夸张后近景地面可能高于相机（例如 6 km 高度、地面 2 km×3× ≈ 5.6 km），会导致相机“埋进山体”、瓦片风暴/卡顿。重建后及相机变化（300 ms 节流）时检查，`相机高度 < 地面 + 400 m` 则保持姿态抬高到地面 +400 m（`console.debug` 记录，如 `6000m -> 6010m (ground 5610m)`）。
6. **N25 细节阴影按相机高度挂载**：`相机高度 ≤ 700 km` 才挂载 `SRTM 地形阴影（示例区高精度）`，远景减少一张 2048² 不透明纹理/绘制调用；相机变化节流检查。
7. **三级高清影像**：主影像（z5–8）→ 宽域高清（z9–12，100–105E/23–27N，opacity 1.0）→ 超清（z13–14，102.2–102.6E/24.95–25.15N，opacity 1.0）；随 `#btn-imagery` / `?imagery=0` 同时开关/移除；缺失瓦片透明回退（provider.errorEvent 忽略，避免 Cesium 刷错）。

### 11.2 性能实测（headless Edge + CDP，1000×700，SwiftShader 软件渲染，指标偏保守）

同代码 A/B（仅 TERRAIN_GRID 不同），近景 `?cam=102.40,25.00,6000,-45`，滑杆拖到 3.0 松手：

| 指标 | 65² | 33²（采用） |
|---|---|---|
| 每瓦片采样点 | 4225 | 1089（−74%） |
| 重建触发（松手→provider 切换） | ~333 ms | ~325–380 ms |
| provider 赋值耗时（`stats.perf.lastRebuildMs`） | 0.2 ms | 0.2–0.8 ms |
| 重建后最长单次主线程阻塞（rAF gap） | 1424 ms | 1070 ms |
| 重建期间点击「清除测量」响应 | — | **155 ms** |
| 侧栏按钮点击响应（回到全球/打开数据/2D/飞坐标/测距/清除） | — | 19–965 ms（全部 < 3 s） |
| 远景空闲帧间隔（软件渲染） | ~250 ms | ~225 ms |

- 结论：相机埋入山体的问题被抬升修复，重建期间点击 **155 ms** 可响应、单次最长阻塞 **1.07 s < 3 s**，满足“松手后 <3s 可交互、点击无 >3s 无响应”；无 page-error。软件渲染下恢复满帧仍需数秒（SwiftShader 渲染/瓦片上传慢），真实 GPU 环境会明显更好。
- `?cam=102.40,25.00,6000,-45&exag=3` 直接打开：相机自动抬升 6000→6010 m（地面 5610 m），加载期间无卡死、`errors=0`（`terrain-perf-exag3-initial.png`）。
- 影像层开销：6 km 近景下关闭三层影像后软件渲染帧间隔由 ~223 ms 降至 ~157 ms（约 −30%），说明全屏影像 overdraw 是近景主要开销之一；保留 HD 影像是需求，故未自动隐藏（如后续需要可做“高层级覆盖时隐藏低层级”优化）。

### 11.3 高清影像验证

`?cam=102.40,25.00,6000,-45`：三层影像均存在、图层列表 7 项，影像位于地形阴影之上；近景可见 Sentinel-2 真实植被/纹理（`terrain-perf-hd-imagery.png`）；`?cam=102.40,25.00,2500,-50` 超清层生效（`terrain-perf-hd-close.png`，z13–14 上限约 10 m/px，更低高度仍会放大变糊）。
`#btn-imagery` 点击：7→4 图层（三层影像整体移除），再点恢复 7 层；`?imagery=0`：无任何影像层。均无报错。

### 11.4 回归

- 全球 `?cam=105,35,9000000,-89`（detail 阴影不挂载，6 图层）与东亚 `?cam=120,30,2500000,-60` 正常，无 page-error（截图 `terrain-perf-global.png`、`terrain-perf-eastasia.png`，因测试 profile 的 localStorage，页面夸张为 3.0×，同时验证了记忆生效）。
- 风场 `?demo=…wind3d_test.kmz&cam=102.3997,25.0,6000,-45&exag=2`：2010 实体，箭头顶点−地面 = 26 m（= 数据高度 24 m + 2 m；地形高度按 2× 缩放），三层影像 + 阴影 + 细节阴影正常（`terrain-perf-wind3d.png`）。

### 11.5 截图

| 文件 | 内容 |
|---|---|
| `terrain-perf-grid65-sample.png` / `grid65-exag3.png` | 改造前 65² 近景/夸张 3×（A/B 基线） |
| `terrain-perf-grid33-sample.png` / `grid33-exag3.png` | 采用 33² 后同相机对比 |
| `terrain-perf-hd-imagery.png` | 6 km 近景：主影像+宽域高清+超清三层生效 |
| `terrain-perf-imagery-off.png` | 影像开关关闭（只剩阴影） |
| `terrain-perf-hd-close.png` | 2.5 km 超清层近景 |
| `terrain-perf-exag3-initial.png` | `?exag=3` 直接打开（自动离地抬升） |
| `terrain-perf-global.png` / `eastasia.png` / `wind3d.png` | 全球/东亚/风场回归 |

### 11.6 task-8 限制

1. 以上性能数字来自 headless SwiftShader 软件渲染，真实 GPU 上帧率与重建恢复更快；但 3× 夸张 + 近景 + 三层影像仍属重负载场景。
2. 33² 网格几何更粗（视觉对比差异小，但极端斜视/近景可能比 65² 略糊）。
3. 自动离地抬升会在“夸张后相机低于地面+400 m”时改变相机高度（保持朝向），极端夸张/贴地视角下相机会被抬高；这是为了避免埋入山体卡死。
4. 宽域高清仅 100–105E/23–27N（z9–12），超清仅 102.2–102.6E/24.95–25.15N（z13–14）；范围外回退下一层/阴影，边缘有矩形接缝；缺失瓦片透明回退，但浏览器网络面板仍可能看到 404（Cesium 错误已忽略）。
5. `stats().perf.lastRebuildMs` 仅统计 provider 重建/赋值本身（0.2–0.8 ms），瓦片重新生成是 Cesium 异步进行的（用 rAF gap/点击响应度量）。

## 12. task-9 更新：性能档位 API（grid / 阴影 / 影像 / 懒加载大源）

为 `js/perf.js`（性能调度器）提供地形侧降载能力；已接入 `LEPerf.preboot()`（`LETerrain.init` 之前）与 `LEPerf.init()` 后的档位切换、空闲 `loadHeavySources()`。

### 12.1 API（`window.LETerrain`）

```js
LETerrain.setQuality({ grid, detailHillshade, imageryDetail, deferHeavy }) -> boolean
// grid: 17|33|49（也接受 9..65 内任意值，按最近档位吸附；默认 33）
// detailHillshade: boolean（低档 false 时不挂 N25 高精度阴影，仍受相机 ≤700km 规则）
// imageryDetail: 'low' | 'medium' | 'high'（低=只主影像 z5–8；中=主+宽域 z9–12；高=三层全开）
// deferHeavy: boolean（true 时 init/apply 不加载东亚/全球，等 loadHeavySources()）
// init 之前调用也安全：只记录配置，不建 Provider、不加载数据。

LETerrain.getQuality() -> { grid, detailHillshade, imageryDetail, deferHeavy }
LETerrain.loadHeavySources(le?) -> Promise<{ eastasia: boolean, world: boolean }>
// 显式加载东亚+全球（约 40MB），成功后强制刷新 provider（reason=heavy-sources）与阴影/影像层；失败静默回退。
```

- grid 变化通过 `rebuildProvider('quality-grid')` 在 `rAF + setTimeout(0)` 中异步重建（同值不重建、多次切换合并），不阻塞首屏/点击。
- `imageryDetail` 只控制“哪些高清影像层存在”，仍整体受 `#btn-imagery` 总开关与 `?imagery=0` 约束；切换档位会移除该档位不需要的影像层（按名称去重）。
- `deferHeavy=true` 时 `maybeRequestEastAsia/World` 被抑制，`heightAt` 在 N25 范围外返回 0（大范围地形暂缺），直到 `loadHeavySources()` 完成。
- `stats()` 新增：`quality`、`grid`、`heavyLoaded`、`heavyLoading`、`providerGrid`；`perf` 新增 `lastReason`。原有指标保留。

### 12.2 实测（headless Edge + CDP，1000×700，SwiftShader 软件渲染）

**启动（`?perf=low&cam=102.40,25.00,6000,-45`，perf.preboot 设 grid17/low/deferHeavy）**

- 启动到 loading 关闭 **4.7 s**；`heavyLoaded=false`、东亚/全球未加载，图层层数 2（国界 + 主影像 z5–8）、`grid=17`、detail 阴影未挂载。
- 随后调用 `loadHeavySources()`：**190–218 ms**（本地已缓存 40MB）→ `eastasia/world ready=true`、`heavyLoaded=true`、强制 provider 刷新 `rebuild ms=0.4ms reason=heavy-sources`、补齐全球/东亚阴影（层数 4）。
- 对比：非 defer 时 init 需等待 40MB 解密/解码，首屏明显更慢；defer 后首屏只加载 N25（≈2.1MB）。

**档位切换（已加载大源，近景 6 km）**

| 档位 | grid | 每瓦片采样 | provider 切换 | 最长 rAF 阻塞 | 瓦片稳定(SwiftShader) | lastRebuildMs | 图层数 |
|---|---|---|---|---|---|---|---|
| medium | 33 | 1089 | 695 ms | 729 ms | 6.7 s | 0.2 ms | 6 |
| low | 17 | 289 | 540 ms | 366 ms | 6.2 s | 0.3 ms | 4 |
| high | 49 | 2401 | 161 ms（热） | 915 ms | 8.3 s | 0.1 ms | 7 |
| high→low→high 全流程 | — | — | — | — | — | — | 4↔7 |

- 档位越低：每瓦片采样更少（289 vs 2401）、重建后阻塞更小、需要上传/绘制的影像与细节阴影层更少；高画质在软件渲染下自然更慢（真实 GPU 差距会缩小）。
- 低档下点击「卫星影像」：4→3 图层（只移除主影像），再点恢复 4 层，总开关仍有效。
- 影像/阴影顺序已验证：`base → world → eastasia → N25(细节) → main → wide → ultra`（低档：base→world→eastasia→main；远景不挂 N25 细节）。
- 全球视角 `?perf=high&cam=105,35,9000000,-89`：grid49、6 图层（远景不挂细节）、影像三层在最上层；默认近景 `?cam=102.40,25.00,6000,-45`：7 图层正常；均无 page-error。

### 12.3 截图（`docs/testdata/`）

| 文件 | 内容 |
|---|---|
| `terrain-perf-quality-low-startup.png` | `?perf=low` 启动后（仅 N25；2 图层；影像 z5–8 模糊、无全球/东亚阴影） |
| `terrain-perf-quality-low-heavyloaded.png` | 同页 `loadHeavySources()` 后（补齐全球/东亚阴影） |
| `terrain-perf-quality-low.png` | 高画质页切到低档（grid17、无细节阴影、仅主影像；图层 4） |
| `terrain-perf-quality-medium.png` | 中档（grid33、主+宽域影像；图层 6） |
| `terrain-perf-quality-high.png` | 高画质（grid49、三层影像+细节阴影；图层 7，最清晰） |
| `terrain-perf-quality-global.png` | 全球视角（grid49，远景无细节阴影，6 图层） |
| `terrain-perf-quality-default.png` | 默认启动近景（perf 自动档=高画质；7 图层） |

### 12.4 task-9 限制

1. `deferHeavy=true` 且未调用 `loadHeavySources()` 时，N25 范围外（含全球其余地区）地形高度为 0，视觉平坦；这是“先快后补”的取舍。`loadHeavySources` 的耗时取决于磁盘缓存（本地实测 190–218ms，冷启动/慢盘会更久）。
2. 档位切换的瓦片重建是异步的；软件渲染下瓦片稳定 6–8s，真实 GPU 更快；切换期间可能出现短暂低分辨率/弹跳。
3. `grid=49` 高画质在近景/夸张时仍较重；`grid=17` 低档地形轮廓明显更粗（截图对比）。
4. `deferHeavy` 在已加载大源后设回 true 不会卸载已加载数据（仅阻止后续自动加载）；要真正卸载需刷新页面。
5. `detailHillshade=false` 时即使相机很低也不挂 N25 细节阴影；相机 >700km 时无论档位都不挂。
6. 性能数字来自 SwiftShader 软件渲染，真实 GPU 更流畅；档位联动还需 `js/perf.js` 的设备探测/自动降级策略共同决定最终体验。

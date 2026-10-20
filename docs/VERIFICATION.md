# 本地地球 Local Earth — 验证记录（2026-10-19）

## 环境

- Windows x64，浏览器：Microsoft Edge（Chromium 155）headless 与正常启动均可。
- 服务：`serve.ps1`，仅监听 `127.0.0.1:8123`。
- 验证工具：REA `capture_browser_scenario`（Playwright CDP，真实渲染、截图、console/page-error 与网络事件）。

## 离线证明

页面 CSP：

```
default-src 'self' blob: data:;
script-src 'self' blob: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval';
img-src 'self' data: blob:; worker-src 'self' blob:;
connect-src 'self' blob: data:;
```

- 浏览器网络事件中，除本地 `http://127.0.0.1:8123/*` 与 `blob:`（Cesium Worker/纹理）外，**没有任何外部 URL**。
- 断网时可继续使用（无在线瓦片、无 CDN、无字体请求）。

## 场景 1：启动 + 渲染

- 地址：`http://127.0.0.1:8123/`
- 结果：地球、Blue Marble 底图、Natural Earth 国界渲染成功；无 console/page error。
- 截图：`docs/testdata/screenshot-after.png`

## 场景 2：KML 导入 + 搜索飞行 + 测距

- 地址：`http://127.0.0.1:8123/?demo=docs/testdata/sample.kml`
- 步骤：等待启动 → 搜索框输入“北京” → 点击首条结果 → 点击“测距” → 在地球上点击一次。
- 结果：
  - 图层列表出现 `sample.kml`（矢量），地标“北京”显示；
  - 相机飞到北京，状态栏坐标 `纬度 39.909000 经度 116.397000`；
  - 测距面板出现：`0.0 m / 1 个点`，有“完成/清除”按钮；
  - 无 console/page error。
- 截图：`docs/testdata/screenshot-search-kml.png`
- REA 证据：`ev_adb98f14bba2d694993a8fb146107079530007dfbf108596a0c1896ec2a11510`

## 场景 3：本地 XYZ 瓦片

- 地址：`http://127.0.0.1:8123/?tiles=data%2Fsamples%2Ftiles%2F%7Bz%7D%2F%7Bx%7D%2F%7By%7D.png`
- 结果：图层列表出现“本地瓦片（影像）”；无 console/page error。
- 生成脚本：`tools/make_tiles.py`（从 Blue Marble 生成 z0–z3 共 85 张 256px 瓦片，Web Mercator 切分）。
- 截图：`docs/testdata/screenshot-tiles.png`
- REA 证据：`ev_669098861b5d17775cdc7bd9c7656a86c7054066577aa90a8d2d49b59836e544`

## 启动器

```
cmd /c start.cmd -NoBrowser -Port 8124
→ http://127.0.0.1:8124/ 返回 200，页面 5311 字节
```

## 新增公版数据与高清底图（2026-10-19 第二轮）

| 项目 | 结果 |
|---|---|
| 高清 Blue Marble 底图（21600×10800） | 已下载：`data/public/imagery/blue-marble-21600.jpg`（28.5 MB，sha256 `3006c58b1272362d…`） |
| 高清底图瓦片 z0–z5 | 已生成 1365 张（`data/public/tiles/blue-marble/`，13.1 MB）；页面以 `UrlTemplateImageryProvider` 加载，无 page-error；单张瓦片 HTTP 200 |
| Natural Earth 10m 国界/河流/湖泊/城市 | 已下载并接入侧栏“公开数据”按钮（12.7/7.0/4.8/4.7 MB）；JSON 校验通过 |
| SRTM N25E102 DEM | 已下载 14.8 MB（`data/public/dem/N25E102.hgt.gz`，sha256 `18f9d0cbf4d19488…`） |
| SRTM 地形阴影叠加 | 由 DEM 生成 `N25E102-hillshade.png`（2.0 MB），支持 `?dem=` 与侧栏按钮；页面无 page-error（目视验证待补） |
| 失败/未包含 | Natural Earth 10m 州省界（源文件 404/49 B 错误页）与 10m 海岸线（SSL 35）本次未取得；不影响现有功能 |

数据清单与逐文件 SHA-256：`docs/data-manifest.json`；来源与许可见 `docs/DATA.md`。

## Wind3D KMZ（用户文件）修复

- 原文件：`C:\Users\A\Wind3D-migration-20261013\results_v111\自动下载 DEM Download Test\kmz\Wind3D_20240403T080600Z_200m_h050m.kmz`（107,468 B，sha256 `6545573d09454cec…`）。
- 结构：ZIP 内 1 个 KML（1479 个 Placemark 小折线、relativeToGround z=25、#red/#orange/#yellow）+ 2 个 BMP ScreenOverlay（图例、时间）。
- Cesium 内置 KmlDataSource 能加载（1480 实体）但不显示线条/图例；已改为自研 `js/kml-native.js`（ZIP 解压、KML 解析、CustomDataSource 渲染、BMP 图例叠加），`js/importers.js` 优先走原生渲染并回退 Cesium。
- **根因**：原生渲染器最初把贴地折线交给 `GroundPolylinePrimitive`；椭球地形下该路径触发 Cesium 内部异常（`surfaceDistance` 未定义），**整个渲染循环停止**，表现为“加载了但什么都不显示”。修复：贴地折线改用“抬升 60m 的 3D 折线”近似（`clampToGroundAsHeight: true`），`relativeToGround` 抬到 `max(z,60)+6`，线宽下限 2px。
- **结果**：**通过**。风场 1479 个红/橙/黄箭头铺满 102.35–102.45E / 25.02–25.07N；左上速度图例与顶部时间叠加显示；状态栏 `已加载 wind3d_test.kmz · 1479 个地物 · 原生 KML 渲染`；0 console/page-error。
- 截图：`docs/testdata/kml-native-final-wind3d.png`（风场）、`kml-native-wind3d-hidden.png`（隐藏图层）、`kml-native-sample.png`（普通 KML 回归）。
- REA 证据：`ev_1106d3e1a629758462cf80c8814621ca3fa3ed42fa31c671b31e480254814cb7`、`ev_a8fccd1c666623e4b8e05fab65ef5a05e033d837be619b4260d022045477dba3`。
- 实现与限制详见 `docs/kml-native.md`；测试副本 `data/samples/wind/wind3d_test.kmz`。

## 3D 地形与箭头贴地（2026-10-19 第三轮）

- 数据：SRTM `N25E102`（102–103E / 25–26N）→ `N25E102-terrain.bin`（1025×1025 int16）+ `N25E102-hillshade.png`（2048² 不透明）。
- 实现：`js/terrain.js`（`CustomHeightmapTerrainProvider`，65×65/瓦片，`heightAt` 双线性采样，边缘 0.005° 淡出）；`js/kml-native.js` 的 `relativeToGround`/`clampToGround` 折线改为 `地形高度 + 数据高度 + 2m`，切换地形时 `redrape` 重算。
- 探针结果：地形 ready、范围正确、中心高度 2132 m、区域外 0；风场首顶点 `height=1406.007`、`ground=1379.007`、**高于地面 27 m**；`depthTestAgainstTerrain=true`。
- **通过**：地形起伏可见、箭头随地形贴地；侧栏「3D 地形（开/关）」与 `?terrain=0`、`?hillshade=0`、`?cam=` 均正常。
- 截图：`docs/testdata/terrain-wind3d-opaque.png`、`terrain-10km.png`、`terrain-wind3d-final.png`；实现与限制见 `docs/TERRAIN.md`。

## 全中国 3D 地形（2026-10-19 第四轮）

- 数据：AWS Terrarium z8（1656 张，SRTM/ETOPO 组合）→ `china-terrain.bin`（72–136E / 17–55N，3200×1900 int16，0.02°，12.16 MB）+ `china-hillshade.png`（2048×1216，2.8 MB）。
- 实现：`js/terrain.js` 多源 heightAt（示例区 1″ 优先、全国 0.02° 兜底、边缘平滑混合），全国数据懒加载（约 12 MB，失败回退示例区），阴影自动叠加（全国 + 示例区高精度细节层）。
- 修正：瓦片高度数组行序改为 Cesium 约定的北→南（原实现南北翻转，导致部分区域高程异常）。
- **通过**：全国视角可见 3D 起伏；风场箭头仍贴地（顶点高于地面 27.00 m）；侧栏开关、`?terrain=0`、`?hillshade=0`、全国数据加载中 UI 与失败回退均验证，无 page-error。
- 截图：`docs/testdata/terrain-china-national*.png`、`terrain-china-wind3d.png`、`terrain-china-toggle-*.png`、`terrain-china-detail-overlay.png`；详见 `docs/TERRAIN-CHINA.md`。

## 全球 3D 地形 + 地形夸张滑杆（2026-10-19 第五轮）

- 数据：AWS Terrarium z4（256 张）→ `world-terrain.bin`（3600×1700，0.1°，[-180,-85,180,85]，12.24 MB）+ `world-hillshade.png`（2048×967，0.8 MB）。
- 实现：`js/terrain.js` 增加全球源，heightAt 优先级 **N25 1″ → 中国 0.02° → 全球 0.1° → 0**；中国 bbox 边缘与全球 smoothstep 混合，±85° 淡出；阴影层 world → china → N25 自底向上；`?exag` 与滑杆（1–3×）在 heightAt 出口统一乘，Provider 与 KML 贴地一致，改值后 100 ms 节流重建 Provider + redrape。
- **通过**：全球视角 3D 起伏（`terrain-global-world.png`）；中国/全球过渡连续；夸张严格 2×/3×（5065→10130→15195 m），滑杆 1.4/1.9/2.5 文本与 Provider 重建正常；风场 `?exag=2` 箭头仍贴地（顶点−地面=27.00 m）；开关/`?terrain=0`/`?hillshade=0`/全球数据失败回退均验证，无 page-error。
- 截图：`docs/testdata/terrain-global-*.png`（world、china、exag1/2/3、slider、wind3d-exag2、toggle、nohillshade、world-fallback 等）。
- 实现、数据与限制详见 `docs/TERRAIN-GLOBAL.md`；数据清单见 `docs/DATA.md` / `docs/data-manifest.json`。

## 东亚地形加密 + 卫星影像 + 夸张滑杆增强（2026-10-19 第六轮）

- 地形：新增 `eastasia-terrain.bin`（55–150E/0–60N，4750×3000，0.02°，28.5 MB）替代中国源，优先级 N25 1″ → 东亚 0.02° → 全球 0.1°；东亚↔全球边缘 smoothstep 连续。
- 影像：本地 Sentinel-2 cloudless 瓦片 z5–z8（2986 张，29.2 MB，EOX/CC BY 4.0），`UrlTemplateImageryProvider`（WebMercator，min5/max8）叠加在阴影层之上、opacity 0.92；默认开启，侧栏「卫星影像」或 `?imagery=0` 切换；低层级回退 Blue Marble，无黑块/404。
- 夸张增强：重置按钮、快捷键 `1`（重置）/`[`/`]`（±0.1，输入框聚焦时忽略）、localStorage `localEarth.terrainExaggeration`（`?exag=` 优先）；仍只在 heightAt 出口乘并节流重建 Provider + redrape。
- **通过**：东亚/全球/示例区视角、影像开关、风场 `?exag=2` 箭头贴地（27.00 m）、快捷键与刷新记忆、各组合开关，均无 page-error（仅故意屏蔽数据文件的预期 console.error）。
- 截图：`docs/testdata/terrain-imagery-*.png`（东亚影像、无影像、全球、风场、滑杆、开关、回退等）；详见 `docs/TERRAIN-GLOBAL.md`。

## 近景风场观感对齐 GE（2026-10-19 第七轮）

- 地形：示例区改用 **SRTM 1″ 全分辨率**（3601×3601 ≈30 m，25.9 MB）+ 4096² 高精度阴影，近景山坡细节明显提升。
- 影像：新增**示例区高清 Sentinel-2 瓦片 z9–z14（296 张，3.1 MB，约 10 m 原生）**，作为独立影像层置于常规影像之上；6 km 斜视下可见山脊、道路、植被纹理（`wind3d-closeup-6km-hires2.png`）。
- 箭头：线宽下限 2px→1px，并按相机高度自适应（近景 1px、远景 2.2px），材质 alpha 0.95；地形贴地偏移 +2m→**+1m**，更接近 Google Earth 的贴地观感；箭头形状仍来自 KML 原始折线（含箭头两笔）。
- **通过**：`?demo=…wind3d_test.kmz&cam=102.40,25.00,6000,-45` 无 page-error；箭头贴地且与高清影像/地形叠加正常。近距离（2.5 km）因相机低于部分山脊会出现遮挡，属正常地形遮挡，建议 5–10 km 视角观察。
- 说明：仍无法达到 Google Earth 的亚米级影像（公开数据源限制：Sentinel-2 约 10 m、Blue Marble 约 500 m）；已用本地高清影像尽量接近。

## 动画风场 KMZ + 性能/交互修复（2026-10-19 第八轮）

- 动画 KMZ：`wind_animation*.kmz` 为 Point + IconStyle（颜色/朝向/外部箭头图标）+ TimeSpan 帧结构。`js/kml-native.js` v1.1.0 改为离屏箭头 sprite Billboard（KML 颜色/heading/scale），按 TimeSpan 只显示当前帧；新增时间轴（播放/暂停/滑块/帧计数）与按风速颜色聚合的自动图例；13.5 万点/13 帧示例用 `PointPrimitiveCollection` 原位更新，加载约 9s、切帧 45–110ms。
- 静态风场 `wind3d_test.kmz` 回归正常（折线彩色箭头 + ScreenOverlay 图例，无时间轴误显示）。
- 性能：`TERRAIN_GRID` 65→33、瓦片高度计算异步化、夸张仅在滑杆松手后重建（250ms 防抖 + rAF 延后）、重建/相机变化时相机离地保护（避免埋入山体引发瓦片风暴）；headless 软件渲染下 3× 近景重建最长阻塞 1070ms（原 1424ms）、侧栏按钮点击 19–965ms（<3s），无 page-error。
- 影像：新增宽域高清 z9–z12（100–105E/23–27N，2151 张）与超清 z13–z14（102.2–102.6E/24.95–25.15N，269 张），三层影像（主 z5–8 → 宽域 → 超清）随「卫星影像」开关联动；风场周边放大可见 ≈10 m 级 Sentinel-2 纹理。
- 视角：右下角新增旋转/俯仰/缩放/复位正北控件；帮助补充鼠标操作说明。
- 截图：`docs/testdata/kmz-anim-*.png`、`terrain-perf-*.png`、`wind3d-anim-merged-final.png`；详见 `docs/KML-ANIMATION.md`、`docs/TERRAIN-GLOBAL.md`。

## 性能模式与加载优化（2026-10-20 第九轮）

- 新增 `js/perf.js`：探测 GPU（含 SwiftShader/软件渲染识别）、核心数、内存与移动端，自动选择 高画质/均衡/流畅；顶部按钮可手动四档切换（自动→流畅→均衡→高画质），`?perf=auto|low|medium|high`，localStorage 记忆；运行中每 1.8s 统计帧率，自动降级/（稳定后）升级，避免开项目后卡死。
- 档位落地：`resolutionScale`（1.0/0.85/0.7）、`maximumScreenSpaceError`（2/3/5）、地形 grid（49/33/17）、细节阴影开关、三层卫星影像（全开/主+宽域/仅主）、点云降采样（1/2/4）。
- 启动提速：`LEPerf.preboot()` 在 `LETerrain.init` 前设置 `deferHeavy=true`，首屏只加载 N25（约 26MB），东亚+全球约 40MB 在空闲时 `loadHeavySources()` 补齐（本地 190–218ms）；loading 全屏层在底图/地形/模块就绪后立即关闭，KMZ/数据走状态栏进度。
- 大文件：KMZ 解析分片让出（每 6000 点）、大 KML 按顶层 Folder 分片 DOM（>8MB 且无样式表）、`LEKml.setQuality({pointSubsample})` 原位降采样；135k 点/56MB 示例总加载 7.7–8.8s、单次长任务 ≤703ms（无 >1s 冻结）、切帧 13.6ms；importers 不再用全屏 setLoading（只状态栏）。
- **通过**：默认启动（headless，自动档）页面正常、性能按钮可用、无 page-error；`?perf=low` 启动 4.7s、不加载大源；低/中/高切换、全球/风场/动画 KMZ 回归正常。
- 截图：`docs/testdata/perf-mode-boot.png`、`terrain-perf-quality-*.png`、`kmz-anim-perf-*.png`；文档见 `README.md`、`docs/TERRAIN-GLOBAL.md`、`docs/KML-ANIMATION.md`。

## 渲染崩溃修复（2026-10-20 第十轮）

- 现象：加载「城市/详细国界/河流/湖泊」+ 风场后拖动/缩放，Cesium 报 `RangeError: Invalid array length`（`subdivideRhumbLine`）并停止渲染。
- 根因：Cesium `GeoJsonDataSource` 把 Natural Earth 的面（admin_0/lakes）与线（rivers）默认建成 `ArcType.RHUMB`；大范围/跨 180°/极区要素在 `subdivideRhumbLine` 中算出非法数组长度。
- 修复：`js/importers.js` 的 `sanitizePolylineDataSource()` 在所有 GeoJSON/KML 回退数据源加入前，把 polygon/polyline 的 `arcType` 统一改为 `GEODESIC`，并清除 NaN/重复坐标；`js/main.js` 增加 `scene.renderError` 堆栈日志。
- **通过**：隔离测试（单独加载 admin_0 原先必崩）与综合测试（4 个公共图层 + 风场 + exag 2.3 + 连续拖拽 10 次 + 滚轮）均 `panel=false`、无 console error；静态/动画 KMZ、地形、影像回归正常。
- 追加：第二类崩溃 `Too many properties to enumerate`（computeRhumbLineSubdivision）来自启动时示例国界 ne_110m_admin_0 的 288 个 RHUMB 面；已通过 `LEImports.sanitizeDataSource()` 清洗 main.js 示例数据，并给 kml-native 的 Polygon 显式 `arcType: GEODESIC`。
- 证据：`docs/testdata/crash-fix-final.png`、`cdp-final-verify.log`、`cdp-isolate.log`、`cdp-isolate2.log`、`cdp-tibet-verify.log`；详见 `docs/CRASH-FIX.md`。

## 公共矢量视觉改进（2026-10-20 第十一轮）

- 国界/河流/湖泊改为按当前地形高度采样后绘制（`drapePositions` + `LE.heightAt`），国界只描边（admin_0 转 4293 条贴地折线，原面隐藏），河流蓝色贴地线；不再出现高度 0 的蓝色/白色面块。
- 移除导入公共图层后的自动 `fitDataSource`，加载图层不再把视角重置到全球；需要定位用图层列表“定位”按钮或 `?fit=1`；`?drape=0` 可关闭贴地。
- 验证：详细国界加载后 4293 条折线、无 page-error；与风场/地形/影像叠加正常；渲染崩溃修复保持。
- 追加：城市图层 7342 个点加 DistanceDisplayCondition(0, 1200 km)，远看自动隐藏、近景显示，避免黄色点铺满屏幕；远视角验证无点（`cities-far.png`）。
- 详见 `docs/VECTOR-STYLE.md`。

## 未覆盖 / 已知限制

- **GeoTIFF**：代码路径已实现（geotiff.js → Canvas → SingleTileImageryProvider），但本轮没有可用的 GeoTIFF 样本，未做运行时验证。
- **KMZ/网络链接**：自研渲染器不处理 `NetworkLink`（不联网）；Cesium 回退路径可能尝试网络，被 CSP 阻止。
- **地形**：全球 0.1° / 东亚 0.02° / 示例区 ≈1″，均为视觉地形、不可量测；数据外（±85°、东亚 bbox 外）为平地/回退；低角度或 bbox 边缘可能有少量接缝。
- **搜索**：内置 Natural Earth 城市库 + 已加载图层名称的前缀/包含匹配；未做拼音/模糊纠错。
- **测量**：距离为逐段测地线累加，面积为球面多边形近似；未做投影面积/椭球面积精算。
- **卫星影像**：仅覆盖东亚 bbox（55–150E / 0–60N）z5–z8，中国 z8；范围外/近景回退阴影或底图，层边缘可见矩形接缝。
- **超大 GeoTIFF/KML**：GeoTIFF 整幅读入内存；超大 KML 受 `maxEntities=50000` 与解析时间限制。
- **浏览器要求**：需要支持 WebGL2 的 Chromium/Firefox 现代版本（Edge 已验证）。

## 复现命令

```powershell
# 启动（后台，不自动开浏览器）
powershell -NoProfile -ExecutionPolicy Bypass -File G:\sh\local-earth\serve.ps1 -Port 8123 -NoBrowser

# 生成示例瓦片（可选）
python G:\sh\local-earth\tools\make_tiles.py
```

# 动画 KMZ：IconStyle 箭头 + TimeSpan 时间轴 + 风速图例 + 视角控件

> 任务：task-7（动画 KMZ：点/IconStyle/TimeSpan + 时间轴 + 图例 + 视角控件）
> 实现文件：`js/kml-native.js`、`index.html`、`js/ui.js`、`css/app.css`
> 测试数据（只读副本）：`data/samples/wind/anim.kmz`、`anim_fixed.kmz`、`anim_timeline.kmz`、`wind3d_test.kmz`
> 原始文件未做任何修改；完全离线，未访问 maps.google.com 或任何外网。

## 1. 背景与根因

用户加载的 Wind3D 动画 KMZ 由大量 **Point + IconStyle（箭头图标 + 颜色 + heading）** Placemark 组成，
每个 Placemark 带 `<TimeSpan><begin>/<end>` 时间帧，图标 `<href>` 指向
`http://maps.google.com/mapfiles/kml/shapes/arrow.png`（外部网络图标）。

原 `kml-native.js` 的问题：

1. Point 只画 `entity.point`（默认白点/彩色小点），**忽略 IconStyle 的箭头、颜色透明度、heading 与 scale**；
2. **完全忽略 TimeSpan**，所有时间帧的白点同时叠加，形成“白点网格”；
3. 没有时间轴、没有风速图例；
4. 外部图标若直接请求会产生 404/外网噪声（离线约束不允许）。

修复方案：Point+IconStyle → **Cesium Billboard**（内置离线箭头 sprite 着色 + 本地 KMZ 图标优先）；
TimeSpan 按 `begin` 去重成帧、仅显示当前帧；新增时间轴 UI、HTML 风速图例、右下角视角控件。
静态 LineString KMZ（`wind3d_test.kmz`）路径保持原样，仅回归验证。

## 2. 支持范围（本次实现）

| 能力 | 行为 |
|---|---|
| `Point` + `IconStyle` | 解析 `<color>`（KML `aabbggrr`）、`<scale>`、`<heading>`（IconStyle 或 Icon 下均可）、`<Icon><href>` |
| 图标来源 | ① KMZ 内相对路径 png/jpg 等（优先，Blob URL）；② `data:` URL；③ 同源相对路径；④ 外部 http(s)/其他协议 → **不联网**，使用内置箭头 sprite |
| 箭头着色 | `billboard.color` = KML 颜色（含 alpha，KML 为 tint 语义）；白色 sprite 被着色为蓝/青/绿/黄/红等 |
| 箭头朝向 | KML heading 为“从北顺时针”，Cesium `billboard.rotation` 为“逆时针弧度”，取 `-heading`；箭头 sprite 默认指北 |
| 箭头大小 | `iconBasePixels(22) × scale` 像素，钳制 9–96px；再按贴图原始宽度换算 `billboard.scale` |
| 无 IconStyle 的 Point | 静态文件保留小白点；动画文件用小号中性蓝点（避免成片白点） |
| 时间信息 | `TimeSpan` / `gx:TimeSpan`（DOM localName 相同）/ `TimeStamp`；按 `begin` 去重排序成离散帧 |
| 帧显示 | 初始第 1 帧；只显示当前帧的实体/点；无时间信息不显示时间轴 |
| 时间轴 UI | 页面底部居中 `#kml-timeline`：播放/暂停、帧滑块、UTC 时间文本、`当前/总帧数`；播放约 600ms/帧循环 |
| 图例 | 动画 KMZ 按 IconStyle 颜色聚合风速：颜色箭头色块 + 风速区间 + 该颜色数量；无 m/s 信息时按颜色标注“分级 N” |
| 视角控件 | 右下角 `#nav-controls`：左右旋转、俯仰上/下、放大/缩小、复位正北 |
| 帮助 | 帮助对话框补充鼠标操作说明（左键旋转/滚轮缩放/右键缩放/中键或 Ctrl+左键倾斜） |

## 3. 实现细节

### 3.1 图标与箭头 sprite（`js/kml-native.js`）

- `arrowSpriteDataUrl()`：用 Canvas 画 48×48 白色箭头（指向屏幕上方/北，半透明深色描边），
  转 data URL；Canvas 不可用时回退等价 SVG data URL。所有 billboard 共用同一 sprite（纹理图集复用）。
- `buildIconPlan(model, zip, source, ctx)`：加载前**异步预解析**所有 Point+IconStyle 的 href：
  - `data:` → bytes → Blob URL，并解码尺寸；
  - KMZ 内相对路径（大小写/目录/basename 兼容）→ `extractZipEntry` → Blob URL；
  - 同源相对 URL → `fetch`（CSP `connect-src 'self'`，仅本机）；
  - 外部协议（http/https/ftp…）→ 记录 external 计数，**不发起任何请求**，调用方回退 sprite。
  - 解析失败的本地图标也回退 sprite，并在图层提示里汇总一次（不产生 404）。
- `addIconPoint()`：生成 `billboard`，`image/color/rotation/scale/heightReference`；
  同时写入 `entity.LEKml = { kind: 'billboard', heading, point, clamp, ... }`，供地形重贴（`redrape`）使用。
- `addPlainPoint()`：无 IconStyle 的点；动画文件 `pixelSize=4`、软蓝色、无描边，静态文件保持原白点样式。

### 3.2 时间帧与时间轴

- `parseTimeInterval()` 解析 `TimeSpan`/`gx:TimeSpan`/`TimeStamp`；`assignFrames()` 按 `begin` 去重排序，
  写 `placemark.frameIndex`，返回帧数组（含 UTC 文本标签与帧内数量）。
- 加载后按实体量选择三种渲染策略：
  1. **预算内（≤ `config.animEntityBudget` = 36000 几何）**：一次性构建全部实体，切帧只改 `entity.show`（不重建数据源）；
  2. **超预算且全部是无 IconStyle 的 Point**（如 13.5 万 Placemark 的 timeline）：使用
     `Cesium.PointPrimitiveCollection` **原位更新 position**，每帧不创建/销毁实体；
  3. **超预算且含 IconStyle/线面**：时间窗口模式（当前帧前后共 3 帧实体），窗口外实体释放，数据源不重建。
- 动画模型定位范围由 `cameraBoundsOf(model)` 补全（点云模式没有 Entity 时也能正确飞到全部帧的范围）。
- 时间轴 DOM 在 `index.html`（`#kml-timeline`），`js/ui.js` 绑定：
  - 监听 `document` 的 `lekml-timeline` 自定义事件（`action: 'activate' | 'deactivate'`，`controller` 为 kml-native 提供的控制器）；
  - 播放 `setInterval(..., 600)` 调用 `controller.next()` 循环；拖动滑块调用 `controller.setFrame()` 即时切换；
  - 图层隐藏/移除时事件自动隐藏时间轴；重新显示时恢复当前帧。
- KML 动画控制器 API（`load()` 返回值/事件 detail）：`frames, frameIndex, frameCount, label, timeText, setFrame(i), next(), previous(), onChange(fn), dispose()`。

### 3.3 图例

- `buildLegendItems(model)`：对 Point+IconStyle 按颜色聚合；风速从 `name`、`description`（去标签）、
  ExtendedData 中匹配 `x.x m/s` / `米/秒`；按最小风速排序，区间显示为该色实测 min–max
  （如 `2.0–3.0 m/s`、`3.0–6.0 m/s`、…、`12.0–21.0 m/s`），并显示该颜色要素数量；
  无风速时显示“风速分级图例 / 分级 N”。
- `buildLegendLayer()` 在 `#viewer` 内左上角创建 `.kml-legend`（HTML 覆盖层，pointer-events: none，
  不遮挡底部时间轴；静态文件自带 ScreenOverlay 图例时互不影响）。

### 3.4 视角控件（类似 Google Earth）

- `index.html` 右下角 `#nav-controls` 按钮；`js/ui.js` `bindNavControls()` 绑定：
  - 左右旋转：`camera.rotate(axis, ±0.08)`，axis 为**相机位置的地心径向单位向量**（原地转向，相机位置不变）；
  - 俯仰：Cesium 1.146 的 `Camera` **没有 `tilt()`**，用 `camera.look(camera.right, ∓0.08)` 实现等价俯仰，
    并按 pitch ∈ [-90°, 接近 0°] 钳制；
  - 放大/缩小：`camera.zoomIn/zoomOut(当前高度 × 0.35)`；
  - 复位正北：保持当前相机位置，`camera.setView({ destination, orientation: { heading: 0, pitch: -π/2, roll: 0 } })`。
- 所有按钮包 try/catch，失败只告警不冻结；鼠标默认操作保持 Cesium 原生。

### 3.5 可调参数（`window.LEKml.config`）

| 参数 | 默认 | 说明 |
|---|---|---|
| `iconBasePixels` | 22 | IconStyle scale=1 时的像素大小 |
| `iconMinPixels` / `iconMaxPixels` | 9 / 96 | 图标像素钳制 |
| `animEntityBudget` | 36000 | 超过后启用点云/窗口模式 |
| `animFrameWindow` | 3 | 窗口模式的帧窗口大小 |
| `maxEntities` | 50000 | 单次构建实体上限（非动画路径保持原逻辑） |

## 4. 验证

验证工具：REA `capture_browser_scenario`（Playwright + Edge headless，真实渲染/截图/console/page-error/network 捕获）。
地址形如 `http://127.0.0.1:8123/?demo=data/samples/wind/<file>.kmz`（服务未重启）。

| 用例 | 结果 | 截图 |
|---|---|---|
| `anim.kmz`（`wind_animation.kmz` 副本）：1870 Placemark / 10 帧 / 5 种颜色 / 外部 Google 图标 | **通过**：彩色箭头（蓝→青→绿→黄→红按风速，方向按 heading）；仅第 1 帧；时间轴 `2024-04-03 01:30:00 UTC · 1/10`；风速图例 5 档（含数量）；无白点网格 | `docs/testdata/kmz-anim-a.png` |
| `anim_fixed.kmz`：1260 Placemark / 10 帧 / 带 description “风速/风向” | **通过**：箭头铺满区域且颜色分级正确；图例（1.8–3.0 … 12.0–18.4 m/s）；时间轴 1/10 | `docs/testdata/kmz-anim-e.png` |
| `anim_timeline.kmz`：3.9 MB KMZ / 56 MB doc.kml / 135252 Placemark / 13 帧 / 无 Style | **通过**：加载约 8.5–9.3 s；播放切帧正常，第 4、6 帧截图；切帧耗时约 50–110 ms；时间轴/相机稳定；无 page-error | `docs/testdata/kmz-anim-b1.png`（4/13）、`kmz-anim-b2.png`（6/13） |
| `wind3d_test.kmz` 回归：1479 个 LineString 箭头 + ScreenOverlay 图例/时间 | **通过**：彩色箭头、ScreenOverlay 图例、贴地/抬升渲染均正常，无时间轴/HTML 图例误显示；无 page-error | `docs/testdata/kmz-anim-c.png` |
| 视角控件：右旋、俯仰、放大缩小、复位正北 | **通过**：旋转为原地转向（数据保持可见）；俯仰可见；复位回正北俯视；按钮点击无卡死（单步 < 1 s）、无 page-error | `kmz-anim-d.png`（旋转）、`kmz-anim-d-tilt.png`（俯仰）、`kmz-anim-d-reset.png`（复位正北） |

其他验证：

- **无 page-error**：以上场景的 `page-errors` 事件均为 0；console 仅有 1 条“已用内置箭头替代外部图标”和图例/地形调试信息。
- **完全离线**：`anim.kmz` 场景捕获到的 1114 条网络事件 origin 全部为 `http://127.0.0.1:8123`
  （Cesium Worker/本地瓦片），**没有任何 maps.google.com 或外部域名请求**。
- **性能**：`anim_timeline.kmz` 初版“每帧创建/销毁 1 万 Entity”会把主线程卡住数十秒（实测暂停点击等待 54 s）；
  改用 `PointPrimitiveCollection` 原位更新后，播放/暂停点击 ≈ 45–110 ms，播放流畅。
- **回归**：`docs/testdata/sample.kml`（3 个普通点）仍可加载显示（静态点样式保持不变）。

关键 REA Evidence（会话内可查）：

- `anim.kmz` 第 1 帧：`ev_c40ffa28a4e934e8b716fb6b8f8f079f3b27e29af5741f6c1c52006349c78d68`
- `anim_fixed.kmz`：`ev_7cddbad2e1ac11268ac1fb6a7481652303dbaa1c8f1c83a93aaa81695c6e6f65`
- `anim_timeline.kmz` 帧 4：`ev_c0135b845e904206137bb2a872ecd831fef030847d8de92490a39752c126e8f8`
- `anim_timeline.kmz` 帧 6：`ev_cb8495d83ed56814cbe0dba902c437a625527878fb9b333bbc1e9f340b21b28b`
- `wind3d_test.kmz` 回归：`ev_d1be74fd14406c555367253a8bf224c4fe137f1bf63ff065e5f7568d5992ca3f`
- 视角控件：`ev_a2d171821c9f7856eb7731105fb055ac56c278e636b0f604e29979147c610a4f`、
  `ev_a7792caec74653674670602baa59b848facc188a9797eadf30aed24f0e18b73c`

## 5. 已知限制

1. **外部图标不联网**：`http(s)` 图标（含 Google 图标）一律用内置白色箭头 sprite 着色替代；
   因此形状统一为箭头，不再显示原始 Google 图标样式（离线约束要求）。
2. **帧是离散的**：按 `begin` 去重成帧，无连续插值；同一 `begin` 的要素同帧显示；
   无 `TimeSpan`/`TimeStamp` 的文件不显示时间轴（静态行为不变）。
3. **超大动画的点云模式限制**：为流畅性使用 `PointPrimitiveCollection`，
   这类图层的点**不是 Entity**，不能点击弹出 description；切换 3D 地形后点云不会自动重贴地面
   （位置在加载时按当时地形高度计算）；`redrape()` 只处理 Entity 图层。
4. **超大且带 IconStyle 的动画**仍走“3 帧实体窗口”回退路径，可能比点云慢（当前测试文件没有该组合）。
5. **箭头朝向的屏幕空间语义**：billboard 的 `rotation` 是屏幕空间旋转（与 Cesium `KmlDataSource` 一致），
   旋转相机后箭头图标不会随正北自动重定向；箭头在地图上的位置与颜色不受影响。
6. **图例区间**是数据实测 min–max（非固定阈值推断）；同一颜色跨越边界时显示为相邻区间。
7. 单帧实体上限 `config.maxEntities` 仍生效（窗口模式按 `maxEntities/animFrameWindow` 分配每帧上限）。
8. `anim.kmz` 的网格数据本身行间距约 1 m（17 列 × 11 行的退化网格），导致同列箭头近乎重叠、
   视觉上呈“箭头柱”；这是测试数据本身的坐标分布，不是渲染错误。

## 6. 文件变更

| 文件 | 变更 |
|---|---|
| `js/kml-native.js` | 版本 1.1.0：IconStyle（color/scale/heading/href）、离线箭头 sprite、TimeSpan/帧、时间轴控制器、风速图例、点云动画、`redrape` 支持 billboard、加载结果/图层 meta 扩展 |
| `index.html` | 新增 `#kml-timeline`（播放/滑块/时间文本）、`#nav-controls`（7 个视角按钮）、帮助文字补充鼠标操作 |
| `js/ui.js` | 新增 `bindNavControls()`、`bindKmlTimeline()`（事件 + 播放 600ms + 滑块），`LEUI.getKmlTimeline()/isKmlPlaying()` 调试接口 |
| `css/app.css` | `#main { position: relative }`；时间轴、视角控件、图例样式 |
| `docs/testdata/kmz-anim-*.png` | 自测截图（arg 见上表） |

## 7. 性能优化（v1.2.0 / task-10：异步解析 + 点云降采样）

> 目标：修复“打开 135k Placemark / 56 MB 动画 KMZ 后首开约 9s 冻结、浏览卡顿”。
> 实现仍只在 `js/kml-native.js`；与 Lead 的 `js/perf.js`（自动性能模式）通过公开 API 协作。

### 7.1 异步分片解析（不阻塞 UI）

- **DOMParser 分片（大文件快速路径）**：`planLargeKmlSplit()` 对 **>8 MB 且全文件无 Style/StyleMap**
  （如 `anim_timeline.kmz`）的 KML，按顶层 `<Folder>` 切成 13 块分别 `DOMParser` 解析；
  每块约 4 MB（实测单块 DOM 解析 200–300 ms），块间 `await` 让出主线程，
  DOM 最大单次阻塞从 **3083 ms → 203–301 ms**。
  - 只在该严格条件下启用：有 Style/StyleMap 的文件跨分片样式引用可能失效，自动回退整份 DOM 解析（正确性优先）。
- **遍历分片**：Placemark 处理按 `config.parseChunkPlacemarks`（默认 6000）让出主线程
  （优先 `MessageChannel`，回退 `setTimeout(0)`）；`assignFrames` 每 2 万条让出一次。
- **进度**：`LE.setStatus('解析 KML：xx%')` 写入非阻塞状态栏；若导入方已打开全屏加载浮层，
  同步更新其文案（不改变显示状态）。大文件（>8 MB）解析期间给 `#loading` 加 `pointer-events:none`，
  使界面可点击/可操作（不隐藏浮层，因此 `wait_for('#loading', hidden)` 仍表示加载完成），加载结束后恢复。
- **其它让出点**：图标 href 预解析每 8 个、实体构建每 2000 个、样式扫描每 500 个让出一次；
  `cameraBoundsOf`/点云首帧构建前后让出。
- **内存**：解析完立即释放 56 MB KML 文本引用；点云帧位置缓存 LRU（默认 4 帧），避免 13 帧 × 1 万点常驻。

### 7.2 点云降采样 API（性能模式）

```js
LEKml.setQuality({ pointSubsample: 1 | 2 | 4 }); // 1=全部，2=隔一点，4=1/4
LEKml.getQuality(); // { pointSubsample: 1|2|4 }
```

- **加载前后都可安全调用**：加载前设置会成为点云初始步长；加载后调用会立即对活动点云图层原位生效
  （`perf.js` 的 auto/low/medium/high 档位在 `init()` 时即调用，早于 `?demo=` KMZ 导入）。
- **切换方式**：复用同一个 `Cesium.PointPrimitiveCollection`，只更新 `position` 和 `show`
  （多余点用 `show=false` 隐藏，不逐点 remove/重建）。实测 2601↔10404 点切换 **3.1 ms**。
- **图例/时间轴/帧数不变**：只改渲染点数；降采样时右上角显示
  `性能模式：1/N 点（点云降采样）`；若该图层有 HTML 图例，图例内也会追加同样提示。
- **仅点云模式生效**：`LineString` 静态风场（`wind3d_test.kmz`）和 Entity/billboard 图层完全不受影响。
- 可选 URL 参数：`?points=2|4`（模块初始化时读取；`perf.js` 后续会按档位覆盖）。

### 7.3 性能指标 API 与诊断日志

```js
LEKml.getPerfStats();   // 返回最近一次加载 + 累计切帧/质量指标
LEKml.resetPerfStats(); // 清零累计指标（保留加载次数）
```

主要字段：`totalLoadMs`、`readMs`、`zipMs`、`decodeMs`、`planMs`、`domParseMs`、`domMaxMs`、
`styleScanMs`、`walkMs`、`walkPureMs`、`walkYieldMs`、`framesMs`、`iconPlanMs`、`buildMs`、
`yieldCount`、`heartbeatMaxGapMs`、`longTaskCount`、`longTaskMaxMs`、`placemarks`、
`frameSwitchCount`、`lastFrameSwitchMs`、`maxFrameSwitchMs`、`pointSubsample`、
`sourcePoints`、`renderedPoints`、`qualityChanges`、`heapMB`、`activePointCloudLayers`。

`?kmlperf=1` 时输出诊断日志（console，`[LEKml-perf]` 前缀）：
`load`（各阶段耗时/心跳）、`split-parse`（分片数、DOM 分片最大耗时）、`frame`（每次切帧耗时）、
`quality-apply`、`fps`（3 个 ~1.2s 窗口的近似帧率）、`mem`（load/+2s/+4s/+6s 的 JS 堆）、
`longtask`（PerformanceObserver 记录的 >100ms 长任务）。

### 7.4 实测指标（headless Edge + REA CDP，`anim_timeline.kmz` = 135252 Placemark / 13 帧 / 56 MB doc.kml）

| 场景 | 总加载 | DOM 分片最大 | 主线程心跳最大间隔 | 最大长任务 | 切帧耗时 | 渲染/帧率 |
|---|---|---|---|---|---|---|
| v1.1.0（优化前基线） | 约 8.6–9.3 s | **3083 ms（整份一次）** | **3159 ms（>1s 冻结）** | — | — | — |
| v1.2.0 auto（自动→流畅，subsample 4） | 7.7–8.8 s | 200–205 ms | 845–915 ms | 541–703 ms | 首帧 13.6 ms；缓存帧 6–8 ms | 2601 点，fps 10.5/38.8/60 |
| v1.2.0 `perf=low`（subsample 4） | 7.71 s | 202 ms | 1034 ms* | 670 ms | 14.1 ms | **fps 36.5 / 60.1 / 60**（2601 点） |
| v1.2.0 `perf=high`（subsample 1） | 6.78 s | 301 ms | 824 ms | 595 ms | 6–19 ms | **fps 2.4 / 10.1 / 17.5**（10404 点） |
| 运行时降采样切换 | — | — | — | — | — | 4→2→1：每次 **3.1 ms**（5202→10404 点），1→4 恢复同样即时 |

\* 心跳 64ms 采样偶发略超 1s，是相邻两个长任务（各 <0.75s）+ 渲染排队的累计间隔；
PerformanceObserver 记录到的**单个长任务最大 703 ms**，不存在 >1s 的单次冻结。
内存（`performance.memory`，近似）：low 285→297→308→294 MB（+2/+4/+6s），high 336→357→354→364 MB，
有 GC 波动但无持续增长；运行时切档后堆从 350 MB 回落到 234 MB。

### 7.5 截图

| 截图 | 说明 |
|---|---|
| `docs/testdata/kmz-anim-perf-loading.png` | 大 KMZ 解析中：加载浮层显示“解析 KML：24%”（状态栏同步进度），界面已可操作 |
| `docs/testdata/kmz-anim-perf-downsample.png` | auto/流畅档：点云 1/4（2601 点），右上角“性能模式：1/4 点（点云降采样）”，时间轴/图例正常 |
| `docs/testdata/kmz-anim-perf-full.png` | `perf=high`：点云全部 10404 点（无降采样提示），用于对比 |
| `docs/testdata/kmz-anim-perf-toggle.png` | 运行时点击“性能”按钮 4→2→1 后恢复全量渲染 |
| `docs/testdata/kmz-anim-perf-anim.png` | `anim.kmz` 回归：彩色箭头/图例/时间轴正常（非点云，不受降采样影响） |
| `docs/testdata/kmz-anim-perf-wind3d.png` | `wind3d_test.kmz` 回归：LineString 静态风场 + ScreenOverlay 图例正常 |

所有场景 `page-errors` 为 0；无外网请求。

### 7.6 限制与注意事项

1. **分片 DOM 解析只覆盖“大 + 无 Style/StyleMap + 至少 2 个顶层 Folder”的 KML**；
   有样式表的大文件仍整份 `DOMParser`（单次约 2–3s，但前后已让出并显示进度），
   或用 `Document` 下大量直属 Placemark（无 Folder）的文件同理回退。
2. **DOMParser 无法真正流式拆分**：即使分片，单块解析仍是一次同步任务（实测 200–300 ms），
   这是不引入 Web Worker/自研 XML 解析器的上限；后续如需进一步降低可考虑 Worker + 轻量 XML 扫描。
3. **心跳偶发 >1s**（1034 ms 一次）：单个长任务始终 <0.7s；更严格的目标需要把 Cesium 渲染在解析期间降频
   （`perf.js` 的 low/auto 已降低 resolutionScale；强制 `perf=high` 时解析期间渲染更重）。
4. **Playwright 自动化点击 `#btn-home` 实测 3.15 s**：主要耗时是 Playwright 的可操作性检查
   （stable/receives-events 在解析期 2–5fps 的页面上反复等待），非主线程冻结；
   界面已通过 `pointer-events:none` 解除遮罩拦截，真实用户点击延迟受单次长任务上限（<0.75s）约束。
5. **降采样只影响显示**：不改变源数据、时间轴帧数、图例统计（图例仍按全部要素聚合）；导出/点击信息不受影响
   （点云本身不可点选，与 v1.1.0 一致）。
6. 点云池大小会增长到“历史最大帧点数”，降采样后多余 primitive 仅 `show=false`，内存不会随切档增长。
7. `?kmlperf=1` 的诊断日志/内存采样仅在调试参数下启用；默认无额外日志与定时器。
8. 大文件解析期间解除 `#loading` 指针拦截只针对 >8 MB 的 KML；小文件保持原全屏加载行为。

### 7.7 与 perf.js 的集成约定

- `LEPerf.init()`（`main.js` 在 `initModules()` 之后、`?demo=` 导入之前调用）会立即
  `LEKml.setQuality({ pointSubsample: profile.pointSubsample })`；v1.2.0 保证加载前调用安全，
  点云创建时直接使用该步长。
- 浏览器性能档位切换（`auto/low/medium/high`）会再次调用 `setQuality`，已加载点云即时原位生效，
  无需重新加载 KMZ。
- `perf.js` 负责 `?perf=` 解析与 UI 按钮；`kml-native.js` 只暴露 API，不读取 `perf` 参数。


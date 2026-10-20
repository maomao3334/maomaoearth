# 绘制标注与高程剖面（P1）

> 代码：`js/draw.js`（`window.LEDraw`）、`js/profile.js`（`window.LEProfile`）
> 截图：`docs/testdata/p1-draw-hud.png`、`docs/testdata/p1-draw.png`、`docs/testdata/p1-profile.png`
> 完全离线；地图交互基于 Cesium `ScreenSpaceEventHandler` + `viewer.entities`，无第三方库。

## 绘制与标注

### 交互

| 操作 | 行为 |
|---|---|
| 点 | 单击地图立即添加一个点（点模式） |
| 线 | 单击逐点添加；移动鼠标显示橡皮筋预览；**双击结束**；至少 2 个顶点 |
| 面 | 单击逐点添加（实时半透明预览）；**双击结束**；至少 3 个顶点，自动闭合 |
| Esc | 取消当前绘制（丢弃未完成顶点并退出模式）；输入框聚焦时不触发 |
| 撤销 | 绘制中：删除最后一个顶点；空闲时：删除最后一个要素 |
| 清空 | 删除全部绘制要素并退出绘制 |
| 结束绘制 | 等同双击结束当前绘制 |
| 颜色/线宽 | 侧栏下拉：颜色（黄/蓝/青/红/白）、线宽 1/2/3/4/6；只影响之后创建的要素 |
| 名称 | 自动编号：`点 1`、`线 1`、`面 1`…（同一会话内按类型递增） |

### 贴地与坐标

- 点：`LE.heightAt(lon, lat) + 2 m`（`heightAt` 已含地形夸张；地形关闭时为 `0 + 2 m`）。
- 线/面顶点：同样按 `LE.heightAt` 抬高 2 m，`clampToGround=false`（用显式高度，便于剖面复用同一高程）。
- 面：`PolygonGraphics(perPositionHeight=true)` + 单独 `PolylineGraphics` 外轮廓（Cesium 1.146 的 polygon outline
  在地形/带高度情况下不可靠，故用折线补轮廓）。
- 坐标统一用 WGS84 经纬度；GeoJSON 坐标输出 `[lon, lat, height]`。

### 与测量/相机共存

- 绘制使用**独立** `ScreenSpaceEventHandler`；绘制期间：
  - 记录并临时移除 `viewer.cesiumWidget.screenSpaceEventHandler` 的 `LEFT_DOUBLE_CLICK` 默认动作（双击跟踪），
    结束绘制时恢复；
  - 临时置 `LE.state.measureActive = true`，让 main.js 的左键实体选择器让路，避免每次加点都弹出“已选择”提示；
    结束绘制时恢复进入前的值（通常是 false）。
- 点击「测距/测面积」时自动结束当前绘制（包装 `LETools.startMeasure`），不会出现两套点击处理同时加点。
- 绘制只用单击/双击，不改变相机；测试中相机高度/经纬度在绘制前后保持一致。

### GeoJSON 导入/导出

导出（`getGeoJSON()` / 侧栏「导出 GeoJSON」）：

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "线 1", "type": "line" },
      "geometry": { "type": "LineString", "coordinates": [[102.49, 25.49, 2210], [102.51, 25.5, 2244]] }
    }
  ]
}
```

- `properties.name`：自动名称；`properties.type`：`point` / `line` / `polygon`。
- 点 → `Point`；线 → `LineString`；面 → `Polygon`（首尾闭合）。
- 导出文件命名 `local-earth-draw-<时间戳>.geojson`。

导入（`loadGeoJSON(geojson)` / 侧栏「导入 GeoJSON」，文件选择 `.geojson/.json`）：

- 支持 `FeatureCollection` / 单个 `Feature` / 裸 geometry；
- 支持 `Point`、`LineString`、`Polygon`（外环）；`Multi*` 等其它类型跳过并在 toast 中提示数量；
- 坐标第三维存在则使用，否则按 `LE.heightAt + 2 m`；
- `properties.name` 存在则沿用，否则自动编号。

### API

```js
window.LEDraw = {
  init(le),                 // local-earth-ready 自动调用
  start(mode),              // 'point' | 'line' | 'polygon' => mode
  stop(),                   // 结束当前绘制（有顶点则按规则提交）=> boolean
  clear(),                  // 清空全部
  undo(),                   // => {kind:'vertex'|'feature'|'none', name?, remaining}
  getGeoJSON(),             // => FeatureCollection
  loadGeoJSON(geojson),     // => {added, skipped[]}
  list(),                   // => [{id,name,type,pointCount,pending}]
  getFeatures(),            // => [{id,name,type,points:[{lon,lat,height}]}]
  downloadGeoJSON(),        // => {bytes,count}
  isActive(), getMode(), getPending(), getStyle(),
};
```

### 已知限制

- 每条要素是单一几何（点/线/面），不支持多几何、洞（内环）、高度编辑、顶点拖拽编辑。
- 线/面用显式高度贴地：之后切换地形夸张或开关 3D 地形时**不会自动重新贴合**（GeoJSON/剖面按当前地形重新计算除外）。
- 面轮廓用叠加折线实现；面本身没有 `outline`，视觉上轮廓线宽/颜色与线一致。
- 绘制顶点保存在内存；刷新页面、执行诊断面板“重载”都会丢失（除非先导出 GeoJSON）。
- 导入时经纬度按 WGS84 直接使用；不做投影转换（UTM 等需先自行转换）。
- 双击结束依赖 Cesium 的双击检测（约 500 ms 内同位置两次点击）；若系统双击速度设置极慢可能无法结束，可用「结束绘制」按钮。
- 与 main.js 的实体选择通过 `LE.state.measureActive` 协调，属于既有权宜手段；若后续 main.js 改动选择逻辑需要同步调整。

## 高程剖面

### 使用

1. 先画一条线（或做一次「测距」，测量线的 polyline 会被自动识别为候选）；
2. 点侧栏「高程剖面」→ 面板列出候选线（`线名 · N 点`），默认选最后一条；
3. 面板显示 canvas 剖面图 + 统计；可「刷新」重新采样或「导出 PNG」。

### 采样算法

- 候选点列表 → WGS84 `Cartographic`；
- 逐段用 `Cesium.EllipsoidGeodesic` 计算测地线距离，得到累计长度；
- 采样点数 `n = clamp(round(totalMeters / 25) + 100, 100, 300)`（**100–300 点**）；
- 每个采样点按“累计距离/总长”定位所在段，用 `EllipsoidGeodesic.interpolateUsingFraction()` 求经纬度，
  再调用 `LE.heightAt(lon, lat)` 取高程（含地形夸张；无地形时返回 0）；
- 统计：起点/终点/最低/最高/起伏（max-min）/累计爬升（正高差之和）/累计下降/长度 km/采样点数；
- `flat=true`（全部高度≈0）时图上提示“未开启 3D 地形”，面板下方也给出说明。

### 图表与导出

- Canvas 自适应宽度（CSS 100%，默认 260 px 高，按 DPR 放大）；
- 背景网格、x 轴 km、y 轴 m、面积渐变填充、折线、最低点（蓝）/最高点（黄）标注，
  标题与统计摘要直接绘制进图（导出 PNG 自带信息）；
- 「导出 PNG」用 `canvas.toDataURL('image/png')` + `a[download]`，导出 `local-earth-profile-<时间戳>.png`；
  导出前会按当前尺寸重绘，返回 `{dataURL, bytes, width, height}`。

### API

```js
window.LEProfile = {
  init(le),                       // local-earth-ready 自动调用
  open(),                         // 打开面板，自动选最后一条候选线 => profile | null
  openForLine(points, name?),     // points: [{lon,lat}] 或 [[lon,lat],...] => profile | null
  close(),
  refresh(),                      // 重新收集候选线并按当前选择重算
  getLast(),                      // => {name,sampleCount,totalKm,minHeight,maxHeight,startHeight,
                                  //     endHeight,climbMeters,descentMeters,reliefMeters,flat,
                                  //     terrainEnabled,generatedAt,samples:[{distanceM,lon,lat,height}]}
  getCandidates(),                // => [{id,name,points,source:'draw'|'measure'}]
  exportPNG({download?}),         // => {dataURL,bytes,width,height,name,sampleCount} | null
  getCanvasDataURL(),
  sampleCountRange,               // [100, 300]
  buildProfile(points, name?),    // 纯计算（不打开面板）
};
```

### 已知限制

- 只有一条线生成一条剖面；不支持多段/多线合并、距离区间裁剪、坡度/视线分析。
- 「最近测量线」的识别方式：`viewer.entities` 中**未被 `LEDraw` 标记**的最后一个 polyline
  （绘制实体带内部标记 `__leDraw`）。若其它模块也往 `viewer.entities` 加 polyline，可能被误当成测量线。
- 采样点仅取 `LE.heightAt`（本地 DEM，含夸张），不是 Cesium 当前渲染网格的精确插值；与真实地形网格可能有差异。
- 剖面不缓存：地形开关/夸张变化后需要点“刷新”才会更新。
- 剖面面板基于 canvas 绘制，不提供交互缩放/十字光标。

## 自测结果（headless Edge 155 + CDP，`?perf=high`，相机 102.5,25.5,20000 俯视）

| 检查 | 结果 |
|---|---|
| 点/线/面 | 线 4 顶点、面 4 顶点（双击结束）、点 1 个，`LEDraw.list()` 3 条 |
| GeoJSON 导出 | FeatureCollection，LineString 4 坐标，`properties.name='线 1'` |
| 撤销/清空 | 撤销后 2 条；清空后 0 条 |
| Esc 取消 | 模式 null、pending 0、无新要素 |
| 双击默认动作 | 绘制中移除、结束后恢复（`getInputAction` 校验） |
| 与测量共存 | 绘制期间 `measureActive=true`，结束后恢复 false；随后可再次开始测量 |
| GeoJSON 往返 | 清空后 `loadGeoJSON(导出内容)` → `added=3`，3 条要素恢复 |
| 剖面线 | 长度 **6.91 km**、**300** 采样点、最低 **2155 m**、最高 **2717 m**、起伏 **562 m**、累计爬升 **636 m** |
| 剖面 PNG | 898×260，**41445 字节**（dataURL 55282 字符），统计 DOM 正常 |
| 页面错误 | 无（除诊断自测故意触发的 1 条 console.error） |

截图：

| 文件 | 内容 |
|---|---|
| `p1-draw-hud.png` | 绘制线进行中：顶部 HUD 提示、2 个顶点、橡皮筋预览 |
| `p1-draw.png` | 线 + 面 + 点三类标注、绘制面板按钮/颜色/线宽 |
| `p1-profile.png` | 剖面面板：canvas 曲线、最低/最高标注、起点/终点/累计爬升等统计 |

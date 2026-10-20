# Wind3D / WindNinja 结果直读（P0）

`js/windninja.js` 在完全离线的前提下读取 **WindNinja / Wind3D** 的 ESRI ASCII Grid 结果
（`*_vel.asc` 风速、`*_ang.asc` 风向、`*.prj` 投影），在 JS 内完成 **UTM → WGS84 反算**，
把风场渲染成贴地的彩色 3D 箭头并显示风速图例。

## 1. 入口

| 入口 | 用法 |
|---|---|
| URL 参数（测试/CLI/自动化） | `http://127.0.0.1:8123/?windninja=data/samples/windninja/terrain_point_10-13-2026_1810_200m_vel.asc` |
| 侧栏「Wind3D 目录」 | 选择 WindNinja 输出目录（`windninja/<timestamp>/h050m/r0200m/`），自动解析全部 `*_vel.asc` |
| 侧栏场景行 | `◀` / 下拉框 / `▶` 播放 / `▶|` 切换多个时间/高度场景 |
| 侧栏「清除风场」 | 移除箭头、图例与图层 |

- 目录选择使用 `<input type="file" webkitdirectory>`，支持真实用户目录结构；
  场景按目录路径排序，标签形如 `20240403T080600Z / h050m / r0200m`。
- URL 模式会自动找同名文件：`..._vel.asc` → `..._ang.asc` 与 `..._vel.prj`。
- 当前选中场景会在图层列表中显示为 `Wind3D · <场景名>`（type = `wind3d`），
  可显示/隐藏/定位/移除。

## 2. ASC / PRJ / UTM 解析

### ESRI ASCII Grid（`parseAsciiGrid`）
- 头部键：`ncols`、`nrows`、`xllcorner`/`xllcenter`、`yllcorner`/`yllcenter`、`cellsize`、
  `NODATA_value`（缺省 `-32768`）；大小写不敏感，值可为整数/小数/科学计数法。
- 数据按行优先读入 `Float32Array(ncols*nrows)`，行 0 是 **最北** 一行。
- 缺列/数据不足会抛出明确错误；`NODATA`（含 `-9999`）在统计/渲染时跳过。
- 单元格中心坐标：
  `x = xll + (col + 0.5) * cellsize`，`y = yll + (nrows - row - 0.5) * cellsize`。

### PRJ（`parsePrj`）
- `PROJECTION["Transverse_Mercator"]` → UTM；解析
  `central_meridian`、`latitude_of_origin`、`scale_factor`、`false_easting`、`false_northing`。
- 从 `WGS_1984_UTM_Zone_48N` 形式的名称解析 zone 与半球（缺省北半球）。
- 无 zone 时由 `central_meridian` 反推 `zone = round((cm+183)/6)`。
- 没有 `PROJECTION` 段（`GEOGCS`）→ 视为经纬度网格，不做投影换算。
- 无 `.prj` 时兜底：若 `xll/yll` 在经纬度范围且 `cellsize<10` 按经纬度处理，
  否则按样例默认 **UTM 48N（中央经线 105°）** 处理并在图例/提示中给出警告。

### UTM → WGS84 反算（Snyder 标准公式）
`a=6378137`，`f=1/298.257223563`，`e²=f(2-f)`，`ep²=e²/(1-e²)`，
`k0=0.9996`，`FE=500000`，`FN` 北半球 0 / 南半球 10000000。
依次计算 `M → mu → fp → C1/T1/N1/R1/D`，得到纬度与经度差，
最后经度 `= zone*6 - 183 + Δλ`。仅依赖 `Math`，与 Cesium 的 `TransverseMercator` 无关。

### 风向语义
`_ang.asc` 是气象风向（风**来向**，0=北、90=东，0/360 环绕）。
箭头按风的**去向**绘制：`bearing = (angle + 180) % 360`（罗盘角，顺时针）。

## 3. 渲染与性能

- 使用 **`Cesium.PolylineCollection`**（单 primitive 批量绘制）：
  每个箭头是 5 个点的折线（尾 → 头 → 倒钩 → 头 → 倒钩），屏幕宽度 1.6 px。
- 颜色分级（与内置 Wind3D KML 图例一致，单位 m/s）：

  | 风速 | 颜色 |
  |---|---|
  | 0.00 – 2.14 | 蓝 `#3a63ff` |
  | 2.15 – 4.30 | 绿 `#29c65a` |
  | 4.31 – 6.45 | 黄 `#ffdb39` |
  | 6.46 – 8.60 | 橙 `#ff8c1a` |
  | 8.61 – 10.76 | 红 `#ff3a3a` |
  | > 10.76 | 深红 `#ae1414` |

- 贴地：箭头首尾两端调用 `LE.heightAt(lon,lat)`（地形开启时为地形高度，含夸张），
  再 `+3 m` 抬升避免 z-fighting；地形关闭时高度为 0。
- 抽稀：按 `LEPerf.getEffective()` 选择步长，且总箭头数上限 **3000**：
  - 高画质：每 2 格（样例 102×57 → **1428** 支，`?perf=high`）
  - 均衡：每 3 格
  - 流畅：每 4 格（样例 → **350** 支，`?perf=low`）
  - 网格更大时自动增大步长直到 ≤3000。
- 图例：`#viewer` 内右上角 HTML 覆盖层 `.wn-legend`，含 6 级颜色、网格尺寸、
  场景标签、风速范围与箭头数/抽稀步长。
- 状态栏：`Wind3D 已加载 · <场景> · 网格 102×57 · 分辨率 200 m · 风速 4.2–11.2 m/s · 箭头 1428`。
- 自动定位：加载/切换场景后 `LE.flyTo({rectangle: bbox})`。

## 4. API：`window.LEWindninja`

```js
// 加载
LEWindninja.load({ vel, ang, prj, label? })   // Promise<stats>
//   vel/ang/prj 可为：ASC/PRJ 文本、File/Blob、本地相对 URL、{text|file|blob|url}
LEWindninja.loadUrl(velUrl)                    // Promise<stats>，自动找 _ang.asc/.prj
LEWindninja.loadFiles(files)                   // Promise<scene[]>，FileList（webkitdirectory）
LEWindninja.showScene(index)                   // Promise<boolean>
LEWindninja.next() / prev()                    // Promise<boolean>
LEWindninja.play(on?)                          // boolean，1.4s/场景循环
LEWindninja.isPlaying()                        // boolean
LEWindninja.clear()                            // 清除渲染/图层/图例

// 查询
LEWindninja.listScenes()  // [{index,label,group,timestamp,height,resolution,active,source}]
LEWindninja.getStats()    // 见下；无场景时 null
LEWindninja.getBounds()   // {west,south,east,north} | null
LEWindninja.getLegend()   // [{label,color,name}]
LEWindninja.getExportData()   // {label, stats, step, points[], arrows[], bins[]}（供导出）
LEWindninja.getProjectState() // 工程保存用（URL 或 ASC 原文）
LEWindninja.restoreProjectState(wind) // 工程恢复用
LEWindninja.init(le)      // 通常由 'local-earth-ready' 自动调用
```

`getStats()` 返回：

```js
{
  label, source: 'url'|'file', file,
  grid: { ncols, nrows, cellsize },
  utm: { zone, hemisphere, centralMeridian, geographic },
  speed: { min, max, mean, count },
  angle: { min, max, count },
  bounds: { west, south, east, north },
  step, arrowCount, scenes, index, warnings: string[]
}
```

`getExportData()`：

```js
{
  label, stats, step,
  points: [{ lon, lat, speed, angle, bearing, row, col }],
  arrows: [{ lon, lat, speed, angle, bearing, color, positions: [[lon,lat], ...5] }],
  bins: [{ label, color, name }]
}
```

## 5. 数据结构与场景描述

```js
scene = {
  label, name, group, timestamp, height, resolution,
  velSource, angSource, prjSource,   // File 或 URL
  velText, angText, prjText,         // 懒读取后的原始文本（用于工程内嵌）
  grid: {ncols,nrows,cellsize,xll,yll,nodata,data:Float32Array},
  angGrid, utm, stats, bounds, step, arrowCount,
  warnings: []
}
```

## 6. 限制

- 仅支持 **ESRI ASCII Grid + WGS84/UTM**；不支持 GeoTIFF/NetCDF、非 WGS84 基准面、
  非 Transverse Mercator 投影（会按 UTM 猜测并在 warnings 提示）。
- 无 `.prj` 时依赖经纬度/UTM 48N 启发式，跨区数据需用户确认。
- `_cld.asc`（云量/遮蔽）未参与渲染。
- 抽稀步长在加载时根据当前性能档确定；之后切换性能档不会重建箭头（重新加载场景即可）。
- 箭头为 3D 折线，未使用 billboard sprite；极端远景下 1.6px 宽度可能偏细。
- 只渲染风场，不生成等值面/热力图；风向缺失时按 0°（北）绘制并在 warnings 提示。
- 每次 `loadFiles` 以所选文件为准替换场景列表；工程文件只保存当前场景（详见 PROJECT.md）。

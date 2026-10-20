# P2 · 垂直风廓线与 3D 高度切片（js/wind-profile.js）

当 Wind3D 数据目录包含多个高度场景（例如 `…/h050m/`、`…/h100m/`、`…/h200m/`）时，
面板「风廓线」支持在地图上单击选点，对每个高度场景做双线性插值，绘制
「高度 (m) — 风速 (m/s)」曲线；并可打开「3D 高度切片」，把各高度场景的箭头
抬升到 `地形高度 + 该层高度` 叠加显示。

## 1. 对外 API

```js
window.LEWindProfile = {
  init(le),
  open(),                    // 打开面板并读取多高度场景
  close(),
  setPoint(lon, lat),        // 设置选点（返回 getData() 结构；面板未打开时后台读取场景）
  getData(),                 // {point:{lon,lat,terrain}, scenes:[{heightM,heightText,speed,bearing,inside}], single, time}
  setSlices(on),             // 3D 高度切片开关；单高度场景返回 false 并提示
  clear(),                   // 清除选点/曲线（不关闭面板）
  refresh(),
  isOpen(), isSlicesOn(), getScenes(), getSliceCount()
};
```

对应 UI：WIND3D 区「风廓线」按钮；面板内「3D 高度切片」复选框、「刷新」「清除」「×」。

## 2. 多高度场景的获取

WindNinja 目录加载（`LEWindninja.loadFiles`）会按 `h\d+m` 目录名生成多个场景，
`listScenes()` 的 `height` 字段即高度（如 `h050m`）。面板打开时：

1. 依次调用 `LEWindninja.showScene(i, {fly:false})`（公开 API，不移动相机）；
2. 每个场景调用 `getExportData()` 取全网格采样点，建立与高度对应的粗栅格；
3. 读取完成后切回原场景，保持用户视角不变；
4. 若粒子正在运行，先暂停，读取完成后按原模式恢复，避免切换场景导致反复重建粒子。

没有修改 `js/windninja.js`；高度从场景目录名解析（`/h\s*0*(\d+)\s*m/i`），
解析不到时显示场景标签，3D 切片抬升为 0（仅按地形）。

## 3. 采样算法

- 每个场景构建 `rows × cols` 粗栅格：`speed`、`sin(bearing)`、`cos(bearing)`、每个节点的
  经纬度。
- 经纬度 → 栅格分数坐标：UTM 网格在约 20 km 范围内接近仿射，用中心点差分得到 2×2 雅可比矩阵，
  迭代 4 次收敛；之后按分数坐标双线性插值 `speed` 与 `sin/cos`，`atan2` 还原风向。
- `getData()` 输出每个场景：高度、插值风速、风向、是否落在栅格内。
- 曲线图（canvas）：x 轴为高度（m），y 轴为风速（m/s），折线 + 数据点 + 数值标签；
  面板下方同时列出每层数值与风向。

## 4. 3D 高度切片

- 对每个高度场景的采样点按步长抽稀（总箭头约 900 个，3 层样例实测 858 个），
  用 `PolylineCollection` 画短箭头：`高度 = LE.heightAt(lon,lat) + 该层高度 + 3 m`，
  长度约为网格分辨率的 1.6 倍，按风速分级着色，箭头方向使用 `bearing`。
- 单高度场景时开关会被拒绝并 toast 提示；关闭开关会移除 primitive（场景 primitive 数回到原值）。
- 与粒子模式相互独立；打开切片不会改变当前 Wind3D 场景与播放状态。

## 5. 与既有交互的冲突处理

- 只在面板打开时创建 `ScreenSpaceEventHandler`（LEFT_CLICK），关闭即销毁。
- 单击拾取前检查 `LE.state.measureActive`、`LE.state.drawActive` 以及 `LEDraw.isActive()`；
  绘制/测量进行中不更新风廓线点，两套点击处理可共存。
- 实测：绘制线模式下单击地图，`LEDraw.getPending()` 增加，风廓线选点保持不变；
  结束后 `drawActive=false`、绘制要素清空。

## 6. 自测结果

测试用多高度数据：把样例 `terrain_point_10-13-2026_1810_200m_*` 复制到内存中的
`p2test/h050m|h100m|h200m/` 目录，并对风速网格分别乘以 0.72 / 1.00 / 1.32
（仅用于演示曲线；真实多高度数据由 WindNinja 结果目录提供）。

- `loadFiles` 后 `listScenes()` = 3 个场景（h050m / h100m / h200m）。
- `open()` 读取 3 层，`getScenes()` 高度 50/100/200 m，每层 1428 采样点。
- 在 102.42°E, 25.06°N 选点：插值风速 5.7745 / 8.0218 / 10.5877 m/s，风向 91.6°，
  曲线单调上升，符合构造数据。
- 3D 切片：`setSlices(true)` → `getSliceCount()=858`，primitive 数 +1；关闭后恢复。
- 地图单击（非面板区域）能更新选点；绘制模式下不更新。
- 粒子运行中打开/关闭面板后，粒子自动恢复运行（600 个、模式 particles）。
- 截图：`docs/testdata/p2-wind-profile.png`（3 层曲线 + 面板）、
  `docs/testdata/p2-wind-slices.png`（3D 高度切片 + 面板曲线）。
- 无 page-error。

## 7. 限制

- 单点风廓线：一次只有一个经纬度，不能直接生成平面/体积切片；需要移动鼠标重新选点。
- 只插值风速大小与水平风向，不读取垂直速度（WindNinja 结果通常也不含 w 分量）。
- 高度来自目录名（h050m → 50 m）；非标准命名时无法自动识别，会退化到 0 抬升。
- 多高度场景按相同采样网格假设做经纬度 → 栅格定位；如果各层栅格范围差异很大，
  会用该层自己的节点经纬度做局部仿射近似，边缘略有误差。
- 3D 切片箭头复用抽稀采样点，显示密度低于原始箭头；当前场景箭头仍会显示，
  可配合图层面板隐藏以获得更纯粹的切片视图。
- 读取多场景需要逐个 `showScene`，高度层数多时会短暂重建箭头（约 0.1–0.5 s/层）。

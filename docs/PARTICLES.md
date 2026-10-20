# P2 · 高性能风场粒子（js/wind-particles.js）

在 P0 的 Wind3D 箭头之上叠加 CPU 粒子动画：粒子沿风场双线性插值得到的风向移动，
尾部拖动 3–4 段尾迹，按风速分级着色；可在「粒子 / 箭头 / 两者」之间切换，
并支持 URL 参数与性能统计。实现不引入任何第三方库、不修改 `js/windninja.js`。

## 1. 对外 API

```js
window.LEWindParticles = {
  init(le),                         // 通常由 local-earth-ready 自动调用
  start(opts),                      // opts: {density, mode, dt, trailSegments}
  stop(),
  setDensity(n),                    // 'low' | 'medium' | 'high' | 100–5000
  isRunning(),
  getStats(),
  setMode('particles' | 'arrows' | 'both'),
  getMode(),
  getFieldInfo(),                   // 当前风场栅格信息（调试）
  // 调试：_state
};
```

- `start({density:'low'})` → 600 个粒子；`'medium'` → 1200；`'high'` → 2200。
- `start({mode:'particles'})` 会隐藏 Wind3D 箭头；`'both'` 同时显示；`'arrows'` 停止粒子。
- `stop()` 移除 `PointPrimitiveCollection` / `PolylineCollection`，恢复箭头可见，不残留 primitive。
- `getStats()` 返回：`running / mode / density / count / trailSegments / tickMs / fps /
  updateFps / updateMs / updates / respawns / hiddenArrows / field{label,rows,cols,step,cell,
  minSpeed,maxSpeed,bounds}`。

URL 参数：

| 参数 | 取值 | 说明 |
| --- | --- | --- |
| `windmode` | `particles` / `arrows` / `both` | 显示模式；`particles`/`both` 自动启动 |
| `particles` | 数字（100–5000） | 指定粒子数；存在时自动切到粒子模式并启动 |

示例：

```
?windninja=data/samples/windninja/terrain_point_10-13-2026_1810_200m_vel.asc
&cam=102.4,25.05,9000,-50&exag=1.3&windmode=particles&particles=1200
```

## 2. 数据来源与插值

- 数据源只使用 LEWindninja 的公开接口 `getExportData()`：当前场景全网格采样点
  `points[{row,col,lon,lat,speed,angle,bearing}]`，以及 `step`、`stats.grid.cellsize`。
- 把抽稀采样点还原成规则粗栅格（rows × cols），对以下量做双线性插值：
  - `speed`；
  - 风向用 `sin(bearing)` / `cos(bearing)` 分别插值后再求 `atan2`，避免 0°/360° 跳变；
  - 每个粗格点的经纬度与地形高度（`LE.heightAt`）在构建时预计算，粒子更新时直接插值，
    不再逐帧调用地理/地形 API。
- 坐标轴约定（易错点）：
  - `bearing` 是**风的去向**（0=北、90=东），由 WindNinja 的来向 `angle+180°` 得到；
  - 粗栅格 `row` 索引**向南增大**、`col` 索引**向东增大**；
  - 所以每一步：

    ```
    dCol = speed * sin(bearing) * dt / metersPerCell   // 东西分量 → 列
    dRow = speed * cos(bearing) * dt / metersPerCell   // 南北分量 → 行（取负）
    ```

  - 早期实现曾把 `dCol` 加到 `row` 上，导致粒子整体逆时针偏转 90°（向东的风显示为向南），
    已修正；修正后样例风场实测：箭头平均方向 90.0°，粒子平均位移方向 86.9°（逐点误差 <6°）。
- 越界（离开栅格）或寿命到期（55–125 步）时按随机位置重播种；重播种时把整条尾迹重置到同一点，
  避免出现跨屏长直线。

## 3. 渲染与性能

- 粒子：`Cesium.PointPrimitiveCollection`，每点 `pixelSize = 3`，屏幕像素大小固定；
  `disableDepthTestDistance = Infinity`，避免被夸张地形遮挡。
- 尾迹：`Cesium.PolylineCollection`，每粒子一条折线，段数按档位 3–4 段
  （low 3、medium 4、high 4），宽度 1.2 px，材质按风速分级颜色（与箭头共用 6 级色带）。
- 高度：地形高度 + 8 m，随地形起伏（构建风场时一次性采样）。
- 更新节奏：`scene.preRender` 驱动，**每 50 ms 全量更新一次**（约 20 fps，符合 20–30 fps 目标）；
  每个步长的“模拟时间”为 15 s（约 300× 实时风速的视觉加速）。
  曾尝试把一次更新切成 3 个渲染帧（时间分片），但会让 Cesium 的
  `PointPrimitiveCollection` / `PolylineCollection` 每帧都置脏并整体重建，反而更慢，已回退。
- 箭头切换：通过 `LE.listLayers()` 找到 `windninja-layer` 并 `setVisible`；
  包装 `LEWindninja.showScene` 并在 600 ms 轮询 `getStats()`，保证 URL 自动加载、目录加载、
  场景切换后粒子场与箭头显隐同步。

### 实测（headless Edge 155，ANGLE/NVIDIA RTX 2080 Ti，画布 1110×719，样例风场 102×57）

| 场景 | 粒子数 | 帧率 | 相对仅箭头基线 (60.3 fps) | 单步更新 |
| --- | --- | --- | --- | --- |
| 仅箭头（1428 箭头） | 0 | 60.3 fps | — | — |
| low | 600 | 60.3 fps | ≈ 0% | ~2.5 ms |
| medium | 1200 | 60.0 fps | ≈ 0% | ~4.3 ms |
| high | 2200 | 52.0 / 52.7 / 52.3 fps（3 个 3 s 窗口） | 下降 12.6–13.8% | ~5.6–6.0 ms |
| both（箭头+粒子） | 1200 | ~49 fps | 下降 ~19% | ~5.4 ms |

结论：high 档 2200 粒子帧率下降约 **13%**，满足 ≤15–20% 的目标；
`both` 模式同时绘制箭头与粒子，帧率略低，属预期。低端设备可把 `LEPerf` 调到 `low`
（默认 600 粒子）或使用 `?particles=600`。

## 4. 自测结果（headless Edge + CDP，无 page-error）

- `start({density:'low'|'medium'|'high'})` → 粒子数 600 / 1200 / 2200，`updates` 持续增长，
  `updateFps ≈ 17–20`；尾迹段数 3/4/4。
- `stop()` → `running=false, count=0`，`scene.primitives.length` 从 4 回到 2（仅环境原有 primitive），
  箭头层恢复可见。
- 模式切换：`particles` 隐藏箭头、`arrows` 停止粒子、`both` 同时显示；UI 三个按钮与
  「播放粒子/停止粒子」联动正常。
- URL：`?windmode=particles&particles=800` 自动启动 800 粒子并隐藏箭头；
  `?windmode=arrows` 仅箭头且不启动粒子。
- 方向回归：同一风场下逐点比较「粒子平均位移方向」与 `getExportData().arrows[].bearing`，
  平均值 86.9° vs 90.0°（详细见 `docs/PARTICLES.md` 第 2 节）。
- 截图：`docs/testdata/p2-particles.png`（高密度粒子 + 侧栏控件）、
  `docs/testdata/p2-particles-arrows.png`（两者模式，粒子与箭头同向）。

## 5. 限制

- CPU 逐粒子插值/更新：2200 粒子时约 20 fps 逻辑更新、每帧约 5–6 ms CPU 开销；
  持续开启粒子会占用一个核心的一部分算力，低端设备建议用 low 档。
- 只对**当前 Wind3D 场景**生成粒子；粒子不随场景自动播放而重建（切换场景会重建当前场）。
- 垂直速度忽略，只在水平面内按 `bearing` 推进；不做高度方向的粒子抬升。
- 风场栅格来自抽稀采样点（step 2/3/4），双线性插值只保证与抽稀网格一致，不是原始 102×57 全分辨率。
- 时间步长按真实帧时间驱动；页面被后台节流时粒子会变慢，但不跳变。

# 渲染崩溃修复：`RangeError: Invalid array length`

## 现象

加载「城市 / 详细国界 / 河流 / 湖泊」+ 风场 KMZ，拖动/缩放相机后 Cesium 弹出：

```
An error occurred while rendering. Rendering has stopped.
RangeError: Failed to set the 'length' property on 'Array': Invalid array length
    at subdivideRhumbLine (Cesium.js)
    at PolylineGeometry.createGeometry / PolygonGeometry
```

整个渲染循环停止，只剩左上图例/时间，地图黑屏。

## 根因

Cesium 的 `GeoJsonDataSource` 把 Natural Earth 的**面（国界 admin_0、湖泊）**与**线（河流）**默认建成 **`ArcType.RHUMB`（=2）**。
Cesium 在 `subdivideRhumbLine` 中按恒定方位角细分大范围要素；Natural Earth 10m 数据里存在跨 180° 经线、极区、超长边等退化情况，细分点数被算成非法值（负数/超限），抛出 `RangeError`。由于发生在 Cesium 几何创建的 `Promise.all` 中，整个 `Scene.render` 被中断并停止渲染。

隔离验证（docs/testdata/cdp-isolate.log）：
- 单独加载 河流/湖泊/城市 → 正常
- 单独加载 **详细国界 admin_0** → 崩溃
- 给面/线统一改 `ArcType.GEODESIC` 后，同样操作不再崩溃

## 修复

`js/importers.js` 新增 `sanitizePolylineDataSource(dataSource)`，在所有 GeoJSON / KML 回退数据源加载后、加入 viewer 之前执行：

1. `entity.polygon.arcType = Cesium.ArcType.GEODESIC`（面，避免 RHUMB 细分）
2. `entity.polyline.arcType = Cesium.ArcType.GEODESIC`（线）
3. 清理折线坐标：剔除 NaN/Infinity、连续重复点，保证至少 2 个点
4. KML 原生渲染的折线本来就是 `ArcType.NONE`，不受影响

另外 `js/main.js` 增加 `scene.renderError` 监听，把完整堆栈打到 console，便于后续定位。

## 验证

- 隔离测试：4 个公共图层依次加载，`admin0` 不再触发错误面板（`cdp-isolate2.log`）。
- 综合测试：风场 KMZ + 地形夸张 2.3 + 河流/湖泊/城市/详细国界 + 连续鼠标拖拽 10 次 + 滚轮缩放：
  - `panel=false`、console error 为空（`cdp-final-verify.log`）
  - 截图 `crash-fix-final.png`（渲染持续，无黑屏/错误面板）
- 静态风场、动画 KMZ、地形、影像均回归正常。

## 限制 / 说明

- 详细国界的面在 3D 地形下仍按高度 0 绘制（可能被地形遮挡或浮在海上），这是原 GeoJSON 数据的高度语义，与本次崩溃修复无关；后续可加"贴地/抬升"选项。
- 若手动加载其它来源的 GeoJSON 且用原生 Cesium 路径，也会自动走同样的 `GEODESIC` 清洗。

## 追加：第二类崩溃（Too many properties to enumerate）

用户“全开”后再次崩溃，堆栈为：

```
RangeError: Too many properties to enumerate
  at computeRhumbLineSubdivision
  at PolygonGeometry.createGeometry
```

同样是 RHUMB 细分，但来源不同：**main.js 启动时加载的示例国界（ne_110m_admin_0_countries）** 没有经过清洗，其 288 个面仍是 `ArcType.RHUMB`；缩放到西藏/俄罗斯等大面时，`computeRhumbLineSubdivision` 生成的点数超出数组上限。

修复：
- `js/importers.js` 导出 `LEImports.sanitizeDataSource()`
- `js/main.js` 在加载示例国界/地名后立即调用清洗
- `js/kml-native.js` 的 Polygon 显式设置 `arcType: GEODESIC`（拖入含大面的 KML 也不会再触发）
- 所有 GeoJSON / KML 回退数据源的 polygon/polyline 均统一为 GEODESIC

验证：`?cam=91,31,12000,-55&exag=2.3` + 风场 + 河流/湖泊/城市/详细国界 + 连续拖拽/缩放，`panel=false`、console error 为空（`docs/testdata/cdp-tibet-verify.log`）。

## 关于“浏览器性能上限”

不是浏览器性能限制，而是 Cesium 处理 RHUMB 大面几何时的数值溢出（会直接中断渲染，而不是变慢）。修复后不会再因数据量/缩放触发该异常；若未来仍出现渲染异常，console 会打印 `[Cesium renderError]` 完整堆栈。

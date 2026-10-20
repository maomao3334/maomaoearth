# 实时光照（P1）

> 代码：`js/lighting.js`　｜　API：`window.LELighting`　｜　截图：`docs/testdata/p1-lighting-*.png`
> 完全离线，不引入第三方库；光照由 Cesium 1.146 内置 Sun 与 Globe 光照计算提供。

## 功能

| 项 | 说明 |
|---|---|
| 开关 | 侧栏「实时光照 · 开启光照/关闭光照」；关闭时恢复 `globe.enableLighting=false` 与进入前的 clock |
| 时间滑杆 | 0–24 h（步长 0.25 h = 15 分钟），固定日期 **2024-04-03（UTC）**，显示 UTC 与本地时间 |
| 方位/高度 | 按相机所在经纬度用 NOAA 简化公式近似计算太阳方位角/高度角（仅用于面板显示） |
| 重置 | 关闭光照、时间恢复 12:00 UTC、关闭「阴影增强」 |
| 阴影增强 | 需要 3D 地形；临时降低已注册影像层 alpha（×0.35，最低 0.12），让地形配套的本地 hillshade 更明显；关闭后逐个恢复原 alpha |
| URL 参数 | `?lighting=1&sun=9.5`（`lighting=1/true/on` 启用；`sun` 为 UTC 小时，可省略） |

侧栏实时显示 `UTC hh:mm · 本地 hh:mm · 方位 xx° · 高度 xx°`，状态栏也会提示「实时光照已开启：UTC …（2024-04-03）」。

## 实现要点

1. 启用：`viewer.scene.globe.enableLighting = true`，同时设置
   `globe.dynamicAtmosphereLighting = true`、`globe.dynamicAtmosphereLightingFromSun = true`（1.146 均支持）。
2. 时间：`viewer.clock.currentTime = Cesium.JulianDate.fromDate(Date.UTC(2024,3,3) + hours*3600s)`。
   Cesium 每帧用 `frameState.time` 计算太阳方向（`Simon1994PlanetaryPositions` → `sunDirectionEC`），
   `scene.light` 为默认方向光时直接采用太阳方向，因此改 clock 即改光照方向。
3. **近距离可见性修正（重要）**：Cesium 默认
   `globe.lightingFadeOutDistance = π/2·R ≈ 10013 km`、`lightingFadeInDistance = π·R ≈ 20026 km`，
   相机离地表只有几公里时着色器里 `fade = smoothstep(out, in, cameraDist) = 0`，
   昼夜明暗会被完全淡出——表现为“打开光照没有效果”。
   本模块在开启时把 `lightingFadeOutDistance=0`、`lightingFadeInDistance=1000`、
   `nightFadeOutDistance=0`、`nightFadeInDistance=5e6`，关闭时恢复原值。
   因此在本地几十公里的视距下也能看到晨昏线/夜间变暗。
4. 关闭：恢复 `enableLighting`、`dynamicAtmosphereLighting*`、四个 fade 距离以及进入前的 `clock.currentTime`。

## 已知限制（实测记录，不伪装成功）

- **地形没有起伏光照/地形自阴影**：项目地形用 `Cesium.CustomHeightmapTerrainProvider`，
  Cesium 1.146 中其 `hasVertexNormals === false`。Globe 片元着色器因此走
  `ENABLE_DAYNIGHT_SHADING`（用椭球面法线做昼夜明暗）而不是 `ENABLE_VERTEX_LIGHTING`
  （逐顶点法线光照）。实际可见的是**整体昼夜明暗/晨昏线变化**，看不到山体起伏产生的阴影。
  面板与诊断 JSON 均显示 `hasVertexNormals:false`。
- 想看到地形“阴影”只能开「阴影增强」叠加已内置的本地 hillshade（`data/public/dem/*-hillshade.png`），
  它不是 Cesium 光照，而是预烘焙坡向阴影。
- 「阴影增强」只降低**已注册到图层面板**的影像层（主/宽域/超清/本地 GeoTIFF/XYZ 等）；
  程序启动时直接加到 `viewer.imageryLayers` 的 Blue Marble 底图未注册，不在降低列表内。
  面板提示里会给出实际影响层数。
- 太阳方位/高度为近似算式（误差通常 < 0.5°），仅用于 UI 显示；Cesium 内部使用精确星历。
- 2D / Columbus 视图下 Globe 光照无 3D 意义，时间仍会写入 clock。

## API

```js
window.LELighting = {
  init(le),                    // 模块在 local-earth-ready 时自动调用；可手动再调
  setEnabled(on),              // => boolean，实际启用状态
  setTime(hours),              // 0–24（UTC 小时） => clamped hours
  getState(),                  // 见下
  toggle(),                    // => boolean
  reset(),                     // 关闭 + 12:00 UTC
  setShadowEnhance(on),        // => boolean（需 3D 地形，否则 false + toast）
  isEnabled(),                 // => boolean
  getSunPosition(),            // { azimuthDeg, altitudeDeg }（按当前相机位置/时间）
  hasVertexNormals(),          // => false（CustomHeightmap）
};
```

`getState()` 返回：

```js
{
  enabled, hours, date: '2024-04-03', utc: '05:30', local: '13:30',
  sun: { azimuthDeg, altitudeDeg, note },
  shadowEnhance, shadowEnhancedLayers,
  globe: {
    enableLighting, dynamicAtmosphereLighting, dynamicAtmosphereLightingFromSun,
    lightingFadeOutDistance, lightingFadeInDistance, nightFadeOutDistance, nightFadeInDistance,
    terrainProvider: 'CustomHeightmapTerrainProvider', hasVertexNormals: false
  },
  terrainEnabled, clock: '2024-04-03T05:30:00Z', limitation
}
```

## 自测结果（headless Edge 155 + CDP，服务 127.0.0.1:8123）

场景：`?cam=102.4,25.05,9000,-45&exag=1.3&hillshade=1`，3D 地形开启（N25 + 东亚 + 全球源）。

| 检查 | 结果 |
|---|---|
| `?lighting=1&sun=5.5` 启动 | `enabled=true`、`globe.enableLighting=true`、`clock=2024-04-03T05:30:00Z` |
| 太阳高度 | 05:30 UTC ≈ **70.1°**；12:00 UTC ≈ **-8.1°** |
| 滑杆 `setTime(12)` | clock → `2024-04-03T12:00:00Z`，画面明显变暗 |
| 画面差异（Pillow 实测） | 白天 vs 夜间：平均绝对差 **46.4/255**，变化像素 **69.0%**；平均亮度 72.1 → 25.9 |
| 关闭/开启 | 关闭后 `enableLighting=false` 且 clock 恢复进入前值；再次开启正常 |
| 阴影增强 | 3 个影像层 alpha 0.92/1.0/1.0 → 0.322/0.35/0.35，关闭后精确恢复 |
| 页面错误 | 无 `page-error`，`console.error` 0 条 |

截图：

| 文件 | 内容 |
|---|---|
| `docs/testdata/p1-lighting-off.png` | 光照关闭（对照） |
| `docs/testdata/p1-lighting-day.png` | 开启光照、05:30 UTC（13:30 本地），白天 |
| `docs/testdata/p1-lighting-night.png` | 12:00 UTC（20:00 本地），夜间明显变暗 |
| `docs/testdata/p1-lighting-shadow-enhance.png` | 白天 + 阴影增强，影像变淡、hillshade 突出 |

> 说明：白天截图整体比关闭时更亮，是 `ENABLE_DAYNIGHT_SHADING` 的 `lambert*5+0.3` 与
> `scene.light.intensity` 叠加的结果；这属于 Cesium 的昼夜着色行为，不是曝光设置。

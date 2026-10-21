# 底图白块 / 白色地球修复（v0.5.2）

## 现象

打开软件（尤其性能档位「流畅」/低画质、或关闭 3D 地形）后：

- 地球表面出现大片白色，像白圈/白块；
- 白色区域基本沿国界/陆地形状，卫星底图被盖住；
- 加载风场 KMZ 后更明显：风羽/网格正常，但底图是白的；
- 高画质档位有时看起来正常，切到「流畅」就变白。

## 根因

不是云、不是地形缺失，主要是两个图层问题叠加：

1. **国界 GeoJSON 面默认白色填充**
   - 默认示例国界用 `Cesium.GeoJsonDataSource` 加载，虽然传了 `fill: false`，但在低画质/无地形/不同渲染路径下，部分面仍以默认白色材质参与绘制，直接盖住卫星底图。
   - 白色区域沿国界形状，正好对应这个原因。

2. **Sentinel-2 JPEG 缺失瓦片显示为白块**
   - S2 数据只覆盖东亚局部；`UrlTemplateImageryProvider` 对缺失 JPEG 瓦片默认按不透明处理，边缘出现白色方块/白点。

## 修复

- `js/main.js`：加载默认国界后**逐要素显式**设置：
  ```js
  polygon.fill = false;
  polygon.material = Cesium.Color.TRANSPARENT;
  polygon.outline = true;
  ```
  只保留蓝色描边，不再填充白色面。
- `js/terrain.js`：S2 影像 provider 增加 `hasAlphaChannel: true`，缺失瓦片按透明合成，透出 Blue Marble 底图。
- 详细国界（公共矢量）原本已用“隐藏面 + 贴地折线”方式只描边，不受影响。

## 验证

环境：headless Edge + Cesium 1.146，`?perf=low`，相机 102.4E, 25N, 7445 km，加载 `wind_animation_timeline.kmz`。

| 项 | 修复前 | 修复后 |
|---|---|---|
| 地球底色 | 大片白色（国界面填充） | 正常 Blue Marble/S2 |
| 风场 KMZ | 白底 + 风羽 | 正常底图 + 风羽/时间轴 |
| page-error | 0 | 0 |

截图：

- 修复前：`docs/screenshots/12-map-before.png`
- 修复后：`docs/screenshots/11-map-fix.png`

复现/验证脚本：`tools/cdp_low_kmz_afterfix.mjs`、`tools/cdp_low_after_countryfix.mjs`。

## 说明

- 这是显示层修复，不改变数据或性能档位逻辑。
- 若仍看到局部白色小方块，通常是该区域 S2 瓦片本身缺失；现在会透出 Blue Marble，而不是白色。
- 低画质仍会降低地形网格/点云密度，但底图不再被国界面盖住。

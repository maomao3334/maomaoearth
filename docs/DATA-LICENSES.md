# 数据与第三方组件许可 / Attribution

MaomaoEarth（猫猫地球）代码以 MIT 许可发布。随项目分发的数据与第三方组件遵循各自许可；再分发或公开演示时请保留本页与界面中的版权说明。

## 软件库

| 组件 | 许可 | 说明 |
|---|---|---|
| CesiumJS 1.146 | Apache License 2.0 | 三维地球渲染引擎；`vendor/cesium/` |
| geotiff.js | MIT | 本地 GeoTIFF/COG 解析 |
| 本项目代码 | MIT | 见根目录 `LICENSE` |

## 底图与影像

| 数据 | 来源 | 许可 / 要求 |
|---|---|---|
| Blue Marble 全球底图（21600×10800，z0–z5 瓦片） | NASA Earth Observatory / Visible Earth | 公有领域（NASA 图像使用政策），建议保留 “NASA Blue Marble” 字样 |
| Sentinel-2 cloudless（东亚 z5–z14 瓦片） | EOX IT Services GmbH（Sentinel-2 cloudless 2020/2024） | **CC BY 4.0**；必须注明 “Sentinel-2 cloudless by EOX IT Services GmbH (CC BY 4.0)”，并链接 https://s2maps.eu |
| 本地 XYZ 瓦片（用户自备） | 用户提供 | 由用户自行确认版权 |
| 北京正射影像（本机 `data/local/`） | 用户提供（ENVI 镶嵌，约 5 m） | **不随项目/Release 分发**；仅本机使用，版权与使用限制由数据提供方决定 |

## 矢量与地形

| 数据 | 来源 | 许可 |
|---|---|---|
| Natural Earth 10m admin_0 / rivers / lakes / populated places | Natural Earth | 公有领域（Public Domain） |
| SRTM / ETOPO / 东亚与全球地形网格 | NASA SRTM、NOAA ETOPO、公开 DEM | 公有领域/开放数据；本项目的 `.bin` 为再采样产品，非测绘精度 |
| 风场示例（WindNinja 输出） | 用户本地 WindNinja 运行结果 | 由用户自行确认 |

## 界面/图标

- 箭头、图标为本项目内联 SVG/Canvas 绘制或使用本地 sprite，不依赖在线图标库。
- 字体使用系统字体（Microsoft YaHei / Segoe UI 等），未打包第三方字体。

## 免责声明

- 地形高度、影像位置为科研/演示用途，**不作为测绘、导航、工程设计的法定依据**。
- Sentinel-2 cloudless 影像的云量、时相与分辨率有限；请以原始数据为准。
- 第三方数据版权归各自所有者；如用于商业发布，请再次核对上游许可条款。

# P2 验收记录（2026-10-21）

## 范围

- 风场粒子（高性能、风向正确、与箭头切换）
- 垂直风廓线 + 3D 高度切片
- 离线地名/坐标搜索增强（413 条中国城市）
- HTML 快照 + 分享链接
- P0/P1 全量回归

## 交付物

- `js/wind-particles.js`、`js/wind-profile.js`、`js/places.js`、`js/snapshot.js`
- `data/public/places/zh-cities.json`（413 条）
- `docs/PARTICLES.md`、`docs/WIND-PROFILE.md`、`docs/PLACES.md`、`docs/SNAPSHOT.md`
- `docs/testdata/p2-*.png`
- `js/api.js` 增加 `MaoMaoEarth.particles / windProfile / places / snapshot`

## 粒子方向修复（关键回归）

p2-dev 初版把东西/南北分量写反，整场风被旋转 +90°，粒子尾迹竖直。
修复后按 bearing 0=北/90=东、row 向南增大：

```js
p.cf +=  speed * Math.sin(bearing) * dt / metersPerCell;  // 东→列
p.rf += -speed * Math.cos(bearing) * dt / metersPerCell;  // 北→行
```

同场逐点验证：箭头平均 bearing 90.0°，粒子平均位移方向 86.9°，逐点误差 <6°。
`docs/testdata/p2-particles.png` 已重生成，`p2-particles-arrows.png` 显示两者同向。

## 自动化测试（p2-dev，headless Edge + CDP :9342）

| 项 | 结果 |
|---|---|
| 粒子数量 | low/medium/high = 600/1200/2200 正确；stop 后残留 primitives=2（无粒子/尾迹） |
| 性能 | 基线 60.3 fps；high 2200 = 52.0–52.7 fps（下降 12.6–13.8%）；medium 60 fps；both ~49 fps |
| 风廓线 | 3 层 h050/h100/h200 → 5.77/8.02/10.59 m/s；3D 切片 858 箭头；绘制中点击不抢占 |
| 地名 | 昆明/北京/kunming/bj/Peking/`102.4,25.05` 命中；413 条；原 Natural Earth 搜索不回归 |
| 快照 | 单文件 HTML 1,803,985 B，内嵌 PNG；无 script/外链；file:// 打开仅 file+data 请求 |
| 分享 | cam/exag/terrain/imagery/windninja/perf/windmode/particles 均包含，?terrain=0&imagery=0 可恢复 |
| P0/P1 回归 | 1428 箭头、PNG/GeoJSON/KMZ/PDF、工程、光照/图层/诊断/绘制/剖面、KML 均正常，无 page-error |

## Lead 复核（CDP :9337）

场景：`?windninja=...&cam=102.4,25.05,9000,-50&exag=1.3&windmode=particles&particles=1200`

```
mods = true,true,true,true（LEWindParticles/LEWindProfile/LEPlaces/LESnapshot）
apiP2 = true,true,true,true
particles = {running:true, count:1200, mode:"particles", fps:60.58}
searchKunming = 1, searchCoord = 1
snapshot = {len:1450625, hasImage:true}
share = ...?cam=102.399646...&exag=1.3&terrain=1&imagery=1&windninja=...&perf=medium&windmode=particles&particles=1200
placesCount = 413
page errors = 0
```

截图：`p2-particles.png`、`p2-particles-arrows.png`、`p2-wind-profile.png`、`p2-wind-slices.png`、`p2-search.png`、`p2-snapshot.png`、`p2-regression.png`、`p2-acceptance.png`。

## 已知限制

- 粒子为 CPU 逐粒子更新（high 每步约 5–6ms；both 模式帧率更低）；仅当前场景，忽略垂直速度。
- 风廓线为单点；高度来自 `h\d+m` 目录名；无多高度目录时提示。
- 地名仅中国城市，坐标为 Natural Earth 点位（非精确行政中心）。
- 快照下载在部分 headless 浏览器会被取消（GUI 浏览器正常）；快照为静态图片+信息，不是交互地图。
- 分享链接只在本机 `127.0.0.1:8123` 有效。

## 结论

**P2 通过**。P0/P1/P2 全部验收，进入发布收尾。

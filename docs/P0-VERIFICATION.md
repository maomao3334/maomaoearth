# P0 验收记录（2026-10-21）

## 范围

- 免安装 EXE + 保留 CLI
- 稳定 JS API
- Wind3D/WindNinja 结果直读
- 工程保存/恢复（.leproj）
- 导出：PNG / PDF / GeoJSON / KMZ

## 交付物

- `MaoMaoEarth.exe`（13.8 KB，.NET Framework csc 编译）
- `maomaoearth.cmd`、`tools/build-launcher.ps1`
- `js/api.js` + [API.md](API.md)、[CLI.md](CLI.md)、[PACKAGING.md](PACKAGING.md)
- `js/windninja.js`、`js/project.js`、`js/exporter.js` + 三份文档
- 验收截图：`docs/testdata/p0-*.png`

## EXE / CLI 验证

| 项 | 结果 |
|---|---|
| `MaoMaoEarth.exe check` | 应用目录/index.html/serve.ps1/Edge/data 全部 OK；8123 运行中 |
| `serve --port 8124 --no-browser` | HTTP 200，页面 8785 B |
| `stop` | 停止 PID 26244，端口释放 |
| `windninja <样例目录> --no-browser --port 8125` | 复制 5 个 ASC/PRJ/CFG 到 `data/samples/windninja/cli-*`，URL 生成正确，HTTP 200 |

## JS API 验证（headless Edge + CDP）

场景：`?windninja=data/samples/windninja/terrain_point_10-13-2026_1810_200m_vel.asc&cam=102.4,25.05,12000,-50`

| API | 结果 |
|---|---|
| `await MaoMaoEarth.ready()` | true，version 0.2.0 |
| `windninja.getStats()` | 102×57 / 200 m / UTM48N；风速 4.2–11.18 m/s；箭头 1428 |
| `project.capture()` | 含 format/version/app/savedAt/camera/settings/layers/windninja/measure |
| `export.png({download:false})` | 1596750 B，1070×719，whiteRatio=0，blank=false |
| `export.kmz({download:false})` | 763841 B |
| `export.geojson({download:false})` | FeatureCollection，含 speed_mps/direction_deg/flow_deg/lon/lat（同步返回） |
| `getCamera()` | lon 102.3996 / lat 25.0494 / height 17842 / pitch -90 |

Wind3D 箭头、分级图例、场景切换/播放、状态栏统计均正常；现有 KMZ/地形/性能档共存无 page-error。
p0-dev 侧 47/47 项自测通过（文件夹导入、工程恢复、PDF 打印窗口、KMZ ZIP/CRC、2× PNG 等）。

## 已知限制（不阻塞 P0）

- 仅 ESRI ASCII + WGS84/UTM；无 `.prj` 时启发式并告警。
- 箭头抽稀在加载时确定，切性能档需重载场景。
- 工程不内嵌本地 KML/KMZ/GeoTIFF；Wind3D 仅当前场景。
- GeoJSON/KMZ 导出当前抽稀后采样点。
- KMZ 为 store 不压缩。

## 结论

**P0 通过**，进入 P1。

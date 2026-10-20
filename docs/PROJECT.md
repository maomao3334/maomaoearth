# 工程保存 / 恢复（.leproj，P0）

`js/project.js` 提供 **纯 JSON、UTF-8、完全离线** 的工程文件（扩展名 `.leproj`），
用于保存/恢复相机视角、显示设置、可恢复图层和当前 Wind3D 风场。

## 1. 入口

| 入口 | 说明 |
|---|---|
| 侧栏「保存工程」 | 生成 `project-<YYYYMMDD-HHmmss>.leproj` 并下载 |
| 侧栏「打开工程」 | 选择 `.leproj` / `.json` 后恢复 |
| API | `LEProject.save() / load(file) / loadText(text) / capture() / apply(state)` |

打开工程后：
- 先应用设置（性能档、地形开关/夸张、卫星影像），
- 移除当前用户图层并按工程重新加载（URL 图层 / Wind3D），
- 最后恢复相机（`camera.cancelFlight()` + `setView`，避免被加载时的 flyTo 覆盖），
- 丢失的本地文件会以 toast/status 提示（不会中断恢复）。

`localStorage['localEarth.lastProjectName']` 记住最近保存的工程名（仅记录，不自动打开）。

## 2. `.leproj` 结构（version 1）

```json
{
  "format": "local-earth-project",
  "version": 1,
  "app": "本地地球 Local Earth",
  "savedAt": "2026-10-21T00:45:00.000Z",
  "camera": {
    "longitude": 102.4, "latitude": 25.05, "height": 7000,
    "heading": 0.25, "pitch": -0.9, "roll": 0,
    "sceneMode": 3
  },
  "settings": {
    "terrain": { "enabled": false, "exaggeration": 1.3, "imagery": true },
    "perfMode": "high"
  },
  "layers": [
    {
      "id": "layer-xxxx", "name": "ne_10m_lakes.geojson", "type": "vector",
      "visible": true, "kind": "url",
      "url": "data/public/vectors/ne_10m_lakes.geojson"
    }
  ],
  "windninja": {
    "label": "terrain_point_10-13-2026_1810_200m",
    "index": 0, "source": "url",
    "velUrl": "data/samples/windninja/terrain_point_10-13-2026_1810_200m_vel.asc"
  },
  "measure": { "text": "测距 1.23 km", "restorable": false }
}
```

### 字段说明

| 字段 | 说明 |
|---|---|
| `camera` | 经纬度（度）、高度（米）、heading/pitch/roll（弧度，Cesium 约定）；`sceneMode` 仅记录 |
| `settings.terrain.enabled` | 3D 地形开关（恢复时若状态不同会 `LETerrain.toggle`） |
| `settings.terrain.exaggeration` | 地形夸张（1.0–3.0），恢复时同步滑杆数值 |
| `settings.terrain.imagery` | 卫星影像开关（`LETerrain.toggleImagery`） |
| `settings.perfMode` | `auto`/`low`/`medium`/`high`（`LEPerf.setMode`） |
| `layers[].kind` | `url`：可按 URL 恢复；`file`：本地文件（仅记录文件名，不恢复）；`local`：本地影像（不恢复）；`unknown` |
| `windninja.source` | `url`：记录 `velUrl`，恢复时重新读取；`file`：内嵌 `velText/angText/prjText` 原文，**自包含可离线恢复** |
| `measure` | 仅保存测量面板文字（几何不可恢复） |

### Wind3D 段示例（本地文件，自包含）

```json
"windninja": {
  "label": "20240403T080600Z / h050m / r0200m",
  "index": 0,
  "source": "file",
  "velText": "ncols 102\nnrows 57\n...",
  "angText": "ncols 102\n...",
  "prjText": "PROJCS[\"WGS_1984_UTM_Zone_48N\", ... ]"
}
```

样例工程约 66 KB（vel 29 KB + ang 23 KB + prj）；仅保存**当前**场景，不保存多场景列表。

## 3. 可恢复范围

| 内容 | 是否恢复 | 说明 |
|---|---|---|
| 相机（位置/朝向/高度） | ✅ | `setView` 精确恢复 |
| 地形开关 / 夸张 | ✅ | 含夸张滑杆 UI 同步 |
| 卫星影像开关 | ✅ | 由 `LETerrain` 管理的影像图层不写入 `layers` |
| 性能模式 | ✅ | `LEPerf.setMode` |
| 公开矢量图层（按 URL） | ✅ | 侧栏按钮/`LEImports.importUrl` 加载的图层自动记录 URL |
| 通过 URL 加载的 KML/KMZ | ✅ | 恢复时重新加载（本地相对 URL） |
| 拖入的本地 KML/KMZ/GeoJSON | ❌ | 记录文件名并提示"请重新拖入" |
| 本地 GeoTIFF/影像 | ❌ | 仅提示 |
| Wind3D：URL 场景 | ✅ | 重新 fetch ASC/PRJ |
| Wind3D：本地文件场景 | ✅ | ASC 原文内嵌工程，离线可恢复 |
| Wind3D：多场景列表/播放位置 | ❌ | 只恢复当前场景 |
| 测量几何 | ❌ | 仅保存面板文字，恢复时给出提示 |
| 2D/3D 视图模式、图层显隐顺序细节 | 部分 | 相机可恢复；2D 模式未恢复 |

## 4. API：`window.LEProject`

```js
LEProject.init(le)                    // 通常由 'local-earth-ready' 自动调用
LEProject.capture() -> project        // 抓取当前状态（不落盘）
LEProject.save(opts?) -> {
  filename, json, project, bytes
}                                     // opts = { name?, download?: false }
LEProject.load(file) -> Promise<{      // File/Blob 或 URL 字符串
  ok, warnings: string[], project
}>
LEProject.loadText(text) -> Promise<{ ok, warnings, project }>
LEProject.apply(project) -> Promise<{ ok, warnings, project }>
LEProject.getLastSaved() -> { filename, json, project, bytes } | null
LEProject.getLastProjectName() -> string | null
```

- `save({download:false})` 不触发下载，返回 JSON 文本（供 CLI/自动化/测试）。
- `apply` 收集所有非致命问题到 `warnings`，返回后由 UI toast/status 汇总提示。
- 恢复过程不会抛出"单个文件丢失"错误；只有 JSON 非法/format 不符/版本过新才 reject。

## 5. 实现要点

- **URL 图层追踪**：不改 `importers.js`，在 `LEProject.init` 中包装
  `LEImports.importUrl`，记录「新注册图层 id → 原始 URL」；恢复时按 URL 重放。
- **地形管理的图层**（`卫星影像…`、`…地形阴影…`）不写入 `layers`、恢复时也不移除，
  统一由 `settings.terrain.imagery` 控制，避免破坏地形/影像联动。
- 恢复相机前调用 `camera.cancelFlight()`，避免加载 Wind3D/图层触发的 1.6s 飞行动画覆盖工程视角。

## 6. 限制

- 工程不内嵌本地 KML/KMZ/GeoTIFF 文件（体积与权限考虑），跨机器打开需同时带上被引用的
  `data/` 相对 URL 资源或重新拖入文件。
- `windninja.source='file'` 时 ASC 原文内嵌，适用于单场景；多场景/超大网格会使工程文件明显变大。
- 图层恢复按 URL 串行重放，恢复耗时与图层数量、数据大小成正比。
- 2D/哥伦布视图、时间轴播放位置、KML 动画帧、测量几何不在恢复范围。
- 工程格式版本为 1；未来字段新增保持向后兼容，未知字段忽略。

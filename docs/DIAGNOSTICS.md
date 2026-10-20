# 诊断面板（P1）

> 代码：`js/diagnostics.js`　｜　API：`window.LEDiagnostics`　｜　截图：`docs/testdata/p1-diagnostics.png`、`docs/testdata/p1-diagnostics-errors.png`
> 侧栏「应用诊断 · 打开诊断面板」打开；右侧浮层，1 s 自动刷新，Esc 关闭。

## 面板内容

| 区块 | 字段 |
|---|---|
| 渲染 / 显示 | GPU（`WEBGL_debug_renderer_info.UNMASKED_RENDERER_WEBGL`，失败回退 `gl.RENDERER`）、厂商、WebGL 版本（WebGL1/2）、GLSL 版本、FPS（postRender 2 s 采样，显示最近窗口）、分辨率 + DPR、canvas 实际像素、JS 堆（`performance.memory` used/limit） |
| 场景 / 图层 | 场景模式（3D/2D/Columbus）、图层总数与可见数、影像层数/数据源数、实体数/图元数、地形 Provider 类型、顶点法线有无、瓦片是否加载完成、光照开关与时间 |
| 地形 / KML | 地形开关/网格/夸张、示例区/东亚/全球三源就绪状态、最近重建耗时与次数、影像档位；`LEKml.getPerfStats()` 的加载次数/总耗时/placemark 数/点云渲染数与降采样/最大主线程阻塞 |
| 最近 `scene.renderError` | 时间、message、完整 stack；无错误时显示“暂无（监听已注册）” |
| `console.error` 最近 50 条 | 环形缓冲；时间 + message（DOM 中截断 400 字符，完整内容在 JSON 里） |
| 按钮 | 复制诊断 JSON、下载诊断日志（`local-earth-diagnostics-<ISO>.json`）、刷新、重载页面、关闭 |

## 实现要点

1. **console.error 环形缓冲**：`diagnostics.js` 在**脚本解析时**（早于 `main.js` 启动）即包装
   `console.error`，先入队（最多 50 条）再调用原始实现，因此能捕获启动早期错误；不会吞日志。
2. **页面异常**：额外监听 `window.addEventListener('error')` 与 `unhandledrejection`（最多 20 条），
   在 JSON 的 `pageErrors` 中区分展示。
3. **FPS**：`viewer.scene.postRender` 累计帧数，每 2 s 计算一次，保留最近 6 个窗口。
4. **renderError**：`viewer.scene.renderError.addEventListener((scene, error) => …)` 保存时间/message/stack，
   与 main.js 里现有日志监听并存（Cesium `Event` 支持多监听）。
5. **`viewer.showRenderLoopErrors = false` 实测结论**：
   - Cesium 1.146 的 `Viewer`/`CesiumWidget` 只在**构造参数**里接收 `showRenderLoopErrors`，
     内部字段 `cesiumWidget._showRenderLoopErrors` 控制是否弹出内置错误面板；**没有公开的 getter/setter**。
   - 运行时赋值 `viewer.showRenderLoopErrors=false` 只是给实例加了一个普通属性，**不会生效**
     （诊断 JSON 中 `showRenderLoopErrors: {publicSetter:false, effective:false, method:'none'}`）。
   - 按“若无效则保留 Cesium 面板并记录”的要求，**没有**去改内部字段伪造成功；
     内置错误面板保留，同时自研面板照常记录 `renderError`/`console.error` 并在面板中说明原因。
   - 注意：Cesium 收到 `renderError` 后默认会停止渲染循环并显示内置错误面板（P0 已有行为），
     因此自动化测试**不会主动 raise renderError**（那会让页面停止渲染），只验证监听已注册、
     并用可控的 `console.error`/运行时异常验证记录链路。
6. **下载/复制**：复制优先 `navigator.clipboard.writeText`，失败回退 `textarea + execCommand`；
   下载用 `Blob` + `a[download]`，记录最后一次导出 `{name,size,at}`。

## API

```js
window.LEDiagnostics = {
  init(le),                    // local-earth-ready 自动调用
  open(), close(), toggle(),   // 面板显隐（打开后 1 s 自动刷新）
  getReport(),                 // => 完整诊断对象（JSON 可序列化）
  getConsoleErrors(),          // => [{at,message}]
  getPageErrors(),             // => [{at,message,stack,source}]
  getLastDownload(),           // => {name,size,at} | null
  copyReport(),                // => Promise<string>（复制并返回 JSON 文本）
  downloadReport(),            // => {name,size,at} | null
  clearConsoleErrors(),        // 清空环形缓冲（测试用）
  isRenderErrorListenerInstalled(), // => boolean
};
```

`getReport()` 结构（摘要）：

```js
{
  generatedAt, uptimeMs,
  app: { name, url, cesium: '1.146.0', userAgent, language, hardwareConcurrency, deviceMemoryGB },
  gpu: { available, webgl2, renderer, vendor, version, shadingLanguageVersion, maxTextureSize,
         unmaskedRenderer, unmaskedVendor },
  display: { window:{width,height}, screen, devicePixelRatio, resolutionScale, canvas:{...} },
  fps: { current, history: [...], sampleWindowMs: 2000 },
  memory: { usedMB, totalMB, limitMB } | null,
  scene: { mode, morphing, globe:{enableLighting, tilesLoaded, depthTestAgainstTerrain,
           terrainProvider, hasVertexNormals}, imageryLayers, dataSources, entities, primitives },
  layers: { count, visible, types, names },
  terrain: { enabled, ready, grid, exaggeration, provider, high/eastasia/world 状态, imagery, perf },
  kml: { loads, totalLoadMs, domParseMs, walkMs, buildMs, framesMs, heartbeatMaxGapMs,
         placemarks, sourcePoints, renderedPoints, pointSubsample, ... },
  draw: { features },                 // 绘制要素数（若 LEDraw 已加载）
  lighting: { ... },                  // LELighting.getState()
  renderError: { at, message, stack } | null,
  renderErrorListener,
  showRenderLoopErrors: { publicSetter, effective, method, note },
  consoleErrors: [...], pageErrors: [...]
}
```

## 已知限制

- `performance.memory` 是 Chromium 专有 API（Edge/Chrome 可用，Firefox 无），无时显示“不支持”。
- FPS 是整页渲染帧率（含 P1 面板/图表绘制），不能单独代表 Cesium 渲染耗时。
- GPU 信息依赖 `WEBGL_debug_renderer_info` 扩展；被浏览器策略屏蔽时回退 `gl.RENDERER` 或显示“未知”。
- `scene.renderError` 一旦真实触发，Cesium 会停止渲染循环（内置面板出现），诊断面板仍可读取已记录堆栈，
  但页面需要“重载”才能恢复。
- “重载”按钮直接 `location.reload()`，会丢失未保存的绘制/工程状态。
- 面板每 1 s 刷新会做一次 `getReport()`（含 WebGL 参数查询），开销很小；如不需要可关闭面板。

## 自测结果（headless Edge 155 + CDP，页面加载 Wind3D + 3D 地形 + 光照）

| 检查 | 结果 |
|---|---|
| GPU | `ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 Ti … Direct3D11 vs_5_0 ps_5_0, D3D11)` |
| WebGL | `WebGL 2.0 (OpenGL ES 3.0 Chromium)` / `WebGL GLSL ES 3.00` |
| FPS | 59.5–60（2 s 采样，6 个历史窗口） |
| JS 堆 | 190.1 / 4192 MB |
| 分辨率 | 1370×805 @ DPR 1，canvas 1070×719 |
| 图层 | 8 层（可见 8）：矢量 1 / 影像 6 / 风场 1 |
| 地形 | enabled=true，grid 49²，示例区/东亚/全球均就绪，顶点法线“无（无地形起伏光照）” |
| 人为错误 | `console.error('P1 deliberate error', TypeError…)` → `consoleErrors.length=1`，面板日志可见 |
| 复制 JSON | 5441 字节（返回文本长度与 JSON 一致） |
| 下载日志 | `local-earth-diagnostics-*.json`，5441 字节 |
| renderError 监听 | 已注册；测试中未触发（避免中断渲染循环） |
| `showRenderLoopErrors` | `publicSetter=false, effective=false, method='none'`，结论已写入 JSON/面板 |
| 页面错误 | 除故意触发的 1 条被捕获 console.error 外，无 page-error |

截图：`p1-diagnostics.png`（上部：GPU/FPS/内存）、`p1-diagnostics-errors.png`（下部：地形/KML/renderError/console.error 与 showRenderLoopErrors 说明）。

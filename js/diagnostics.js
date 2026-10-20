/*
 * 诊断面板（P1）
 * - GPU / WebGL 版本、分辨率 / DPR、FPS（postRender 采样 2s）、JS 堆、场景与图层数、
 *   地形 stats、KML stats、最近 scene.renderError、最近 console.error（环形缓冲 50 条）
 * - 「复制诊断 JSON」「下载诊断日志」「重新加载页面」「刷新」
 * - 监听 scene.renderError；尝试 viewer.showRenderLoopErrors = false（Cesium 1.146 无此访问器，
 *   赋值无效时保留内置错误面板并把结论写进诊断 JSON，不伪造成功）
 *
 * 对外 API：window.LEDiagnostics
 *   init(le) / open() / close() / toggle() / getReport() / getConsoleErrors()
 */
(function () {
  'use strict';

  const C = window.Cesium;
  const MAX_CONSOLE = 50;
  const MAX_PAGE_ERRORS = 20;

  const state = {
    le: null,
    bound: false,
    panelOpen: false,
    timer: null,
    frames: 0,
    windowStart: 0,
    fps: null,
    fpsHistory: [],
    renderError: null,
    pageErrors: [],
    consoleErrors: [],
    showRenderLoopErrors: null,
    renderErrorListener: false,
    startedAt: Date.now(),
    lastDownload: null,
  };

  /* --------------------- console.error 环形缓冲（模块加载即生效） --------------------- */

  const originalConsoleError = console.error.bind(console);
  function formatArg(arg) {
    if (arg instanceof Error) return arg.stack || arg.message || String(arg);
    if (arg && typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 0).slice(0, 800);
      } catch (err) {
        return String(arg);
      }
    }
    return String(arg);
  }
  console.error = function () {
    try {
      const args = Array.prototype.slice.call(arguments);
      state.consoleErrors.push({
        at: new Date().toISOString(),
        message: args.map(formatArg).join(' | ').slice(0, 4000),
      });
      if (state.consoleErrors.length > MAX_CONSOLE) state.consoleErrors.shift();
    } catch (err) {
      /* 忽略记录失败，绝不吞掉原始日志 */
    }
    return originalConsoleError.apply(console, arguments);
  };

  window.addEventListener('error', (ev) => {
    try {
      state.pageErrors.push({
        at: new Date().toISOString(),
        message: String((ev && ev.message) || 'unknown'),
        stack: ev && ev.error && ev.error.stack ? String(ev.error.stack) : '',
        source: ev && ev.filename ? String(ev.filename) + ':' + ev.lineno + ':' + ev.colno : '',
      });
      if (state.pageErrors.length > MAX_PAGE_ERRORS) state.pageErrors.shift();
    } catch (err) {
      /* ignore */
    }
  });
  window.addEventListener('unhandledrejection', (ev) => {
    try {
      const reason = ev && ev.reason;
      state.pageErrors.push({
        at: new Date().toISOString(),
        message: 'unhandledrejection: ' + formatArg(reason),
        stack: reason && reason.stack ? String(reason.stack) : '',
        source: 'promise',
      });
      if (state.pageErrors.length > MAX_PAGE_ERRORS) state.pageErrors.shift();
    } catch (err) {
      /* ignore */
    }
  });

  /* ------------------------------ 基础工具 ------------------------------ */

  function byId(id) {
    return document.getElementById(id);
  }

  function getLE() {
    return state.le || window.LE;
  }

  function viewerOf() {
    const le = getLE();
    return le && le.viewer ? le.viewer : null;
  }

  function mb(bytes) {
    if (!isFinite(bytes) || bytes < 0) return null;
    return Math.round((bytes / 1048576) * 10) / 10;
  }

  function isoOrNull(ms) {
    return ms ? new Date(ms).toISOString() : null;
  }

  /* ------------------------------ GPU / WebGL ------------------------------ */

  function glInfo() {
    const viewer = viewerOf();
    let gl = null;
    try {
      const ctx = viewer && viewer.scene ? viewer.scene.context : null;
      gl = (ctx && (ctx._gl || ctx._context || ctx.gl)) || null;
    } catch (err) {
      gl = null;
    }
    if (!gl) {
      try {
        const canvas = document.createElement('canvas');
        gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      } catch (err) {
        gl = null;
      }
    }
    if (!gl) return { available: false, note: 'WebGL 上下文不可用' };
    const info = { available: true, webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext };
    try {
      info.renderer = String(gl.getParameter(gl.RENDERER) || '');
      info.vendor = String(gl.getParameter(gl.VENDOR) || '');
      info.version = String(gl.getParameter(gl.VERSION) || '');
      info.shadingLanguageVersion = String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION) || '');
      info.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        info.unmaskedRenderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
        info.unmaskedVendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || '');
      }
    } catch (err) {
      info.note = '读取 WebGL 参数失败：' + (err && err.message ? err.message : err);
    }
    return info;
  }

  /* ------------------------------- 采样 ------------------------------- */

  function onFrame() {
    state.frames += 1;
    const now = performance.now();
    if (!state.windowStart) state.windowStart = now;
    const elapsed = now - state.windowStart;
    if (elapsed < 2000) return;
    const fps = (state.frames * 1000) / elapsed;
    state.frames = 0;
    state.windowStart = now;
    state.fps = Math.round(fps * 10) / 10;
    state.fpsHistory.push(state.fps);
    if (state.fpsHistory.length > 6) state.fpsHistory.shift();
  }

  function setupRenderErrorListener(viewer) {
    if (!viewer || !viewer.scene || state.renderErrorListener) return;
    try {
      viewer.scene.renderError.addEventListener(function (scene, error) {
        state.renderError = {
          at: new Date().toISOString(),
          message: error && (error.message || String(error)),
          stack: error && error.stack ? String(error.stack) : '',
        };
      });
      state.renderErrorListener = true;
    } catch (err) {
      console.warn('[LEDiagnostics] renderError 监听失败', err);
    }
  }

  // Cesium 1.146 的 Viewer 只在构造参数里接受 showRenderLoopErrors（内部字段 _showRenderLoopErrors），
  // 没有公开访问器；这里按任务要求尝试赋值并如实记录是否生效。
  function tryShowRenderLoopErrors(viewer) {
    const result = {
      publicSetter: false,
      effective: null,
      method: 'none',
      note: '',
    };
    if (!viewer) {
      result.note = 'viewer 不可用';
      return result;
    }
    try {
      const widget = viewer.cesiumWidget;
      const effectiveBefore = widget && typeof widget._showRenderLoopErrors === 'boolean' ? widget._showRenderLoopErrors : null;
      // 查找原型链上是否存在带 setter 的公开访问器
      let descriptor = null;
      let proto = viewer;
      while (proto && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(proto, 'showRenderLoopErrors') || null;
        proto = Object.getPrototypeOf(proto);
      }
      const hasPublicAccessor = !!(descriptor && typeof descriptor.set === 'function');
      let publicSet = false;
      try {
        viewer.showRenderLoopErrors = false;
        publicSet = true;
      } catch (err) {
        publicSet = false;
      }
      const effectiveAfter = widget && typeof widget._showRenderLoopErrors === 'boolean' ? widget._showRenderLoopErrors : null;
      result.publicSetter = publicSet && hasPublicAccessor;
      result.effective = effectiveAfter === false;
      if (hasPublicAccessor && effectiveAfter === false) {
        result.method = 'viewer.showRenderLoopErrors';
        result.note = '已关闭 Cesium 内置渲染错误面板，改由本面板记录 renderError 堆栈。';
      } else {
        result.method = 'none';
        result.note =
          'Cesium ' + (C.VERSION || '1.146') + ' 的 Viewer 没有公开的 showRenderLoopErrors 访问器（仅构造参数，'
          + '内部字段 cesiumWidget._showRenderLoopErrors 控制）。运行时赋值 viewer.showRenderLoopErrors=false 不会生效，'
          + '因此保留 Cesium 内置错误面板；本面板同时记录 scene.renderError 堆栈与 console.error，不伪造成功。'
          + (effectiveBefore == null ? '（未能读取内部字段，结论按无公开访问器记录）' : '');
      }
    } catch (err) {
      result.method = 'none';
      result.note = '尝试设置 showRenderLoopErrors 出错：' + (err && err.message ? err.message : err);
    }
    state.showRenderLoopErrors = result;
    return result;
  }

  /* ------------------------------ 报告 ------------------------------ */

  function terrainReport() {
    if (!window.LETerrain || typeof window.LETerrain.stats !== 'function') return null;
    try {
      const s = window.LETerrain.stats();
      const loading = s.loading || {};
      return {
        enabled: s.enabled,
        ready: s.ready,
        grid: s.grid,
        exaggeration: s.exaggeration,
        provider: s.provider,
        tilingScheme: s.tilingScheme,
        providerGrid: s.providerGrid,
        heavyLoaded: s.heavyLoaded,
        // 注意：s.high 是 sourceStats（没有 ready 字段），示例区是否就绪用 s.ready + s.high
        high: { ready: !!(s.ready && s.high), failed: false, loading: !!loading.high },
        eastasia: s.eastasia && { ready: s.eastasia.ready, failed: s.eastasia.failed, loading: s.eastasia.loading },
        world: s.world && { ready: s.world.ready, failed: s.world.failed, loading: s.world.loading },
        imagery: s.imagery && {
          enabled: s.imagery.enabled,
          quality: s.imagery.quality,
          layers: (s.imagery.layers || []).map((l) => ({ name: l.name, present: l.present, visible: l.visible })),
        },
        detailHillshadeMounted: s.detailHillshadeMounted,
        perf: s.perf,
      };
    } catch (err) {
      return { error: String(err && err.message ? err.message : err) };
    }
  }

  function kmlReport() {
    if (!window.LEKml || typeof window.LEKml.getPerfStats !== 'function') return null;
    try {
      const s = window.LEKml.getPerfStats();
      return {
        loads: s.loads,
        totalLoadMs: s.totalLoadMs,
        domParseMs: s.domParseMs,
        walkMs: s.walkMs,
        buildMs: s.buildMs,
        framesMs: s.framesMs,
        heartbeatMaxGapMs: s.heartbeatMaxGapMs,
        placemarks: s.placemarks,
        sourcePoints: s.sourcePoints,
        renderedPoints: s.renderedPoints,
        pointSubsample: s.pointSubsample,
        activePointCloudLayers: s.activePointCloudLayers,
        heapMB: s.heapMB,
      };
    } catch (err) {
      return { error: String(err && err.message ? err.message : err) };
    }
  }

  function layersReport() {
    const le = getLE();
    const list = le && typeof le.listLayers === 'function' ? le.listLayers() : [];
    const types = {};
    for (const layer of list) types[layer.type || 'other'] = (types[layer.type || 'other'] || 0) + 1;
    return {
      count: list.length,
      visible: list.filter((l) => l.visible !== false).length,
      types,
      names: list.map((l) => l.name),
    };
  }

  function terrainProviderLabel(viewer) {
    if (!viewer || !viewer.terrainProvider) return null;
    const provider = viewer.terrainProvider;
    try {
      if (C.CustomHeightmapTerrainProvider && provider instanceof C.CustomHeightmapTerrainProvider) {
        return 'CustomHeightmapTerrainProvider';
      }
      if (C.EllipsoidTerrainProvider && provider instanceof C.EllipsoidTerrainProvider) {
        return 'EllipsoidTerrainProvider';
      }
    } catch (err) {
      /* ignore */
    }
    return provider.constructor ? provider.constructor.name : null;
  }

  function getReport() {
    const viewer = viewerOf();
    const scene = viewer ? viewer.scene : null;
    const canvas = viewer && viewer.canvas ? viewer.canvas : null;
    const mem = typeof performance !== 'undefined' && performance.memory ? performance.memory : null;
    const gl = glInfo();
    const report = {
      generatedAt: new Date().toISOString(),
      uptimeMs: Date.now() - state.startedAt,
      app: {
        name: '本地地球 Local Earth',
        url: location.href,
        cesium: C ? C.VERSION || '1.146' : null,
        userAgent: navigator.userAgent,
        language: navigator.language,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemoryGB: navigator.deviceMemory || null,
      },
      gpu: gl,
      display: {
        window: { width: window.innerWidth, height: window.innerHeight },
        screen: { width: screen.width, height: screen.height },
        devicePixelRatio: window.devicePixelRatio || 1,
        resolutionScale: viewer ? viewer.resolutionScale : null,
        canvas: canvas ? { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight } : null,
      },
      fps: {
        current: state.fps,
        history: state.fpsHistory.slice(),
        sampleWindowMs: 2000,
      },
      memory: mem
        ? {
            usedMB: mb(mem.usedJSHeapSize),
            totalMB: mb(mem.totalJSHeapSize),
            limitMB: mb(mem.jsHeapSizeLimit),
          }
        : null,
      scene: scene
        ? {
            mode: scene.mode,
            morphing: scene.morphTime,
            globe: scene.globe
              ? {
                  enableLighting: !!scene.globe.enableLighting,
                  tilesLoaded: !!scene.globe.tilesLoaded,
                  depthTestAgainstTerrain: !!scene.globe.depthTestAgainstTerrain,
                  terrainProvider: terrainProviderLabel(viewer),
                  hasVertexNormals:
                    viewer.terrainProvider && typeof viewer.terrainProvider.hasVertexNormals === 'boolean'
                      ? viewer.terrainProvider.hasVertexNormals
                      : null,
                }
              : null,
            imageryLayers: viewer.imageryLayers ? viewer.imageryLayers.length : null,
            dataSources: viewer.dataSources ? viewer.dataSources.length : null,
            entities: viewer.entities ? viewer.entities.values.length : null,
            primitives: scene.primitives ? scene.primitives.length : null,
            renderErrorCount: 0,
          }
        : null,
      layers: layersReport(),
      terrain: terrainReport(),
      kml: kmlReport(),
      draw: window.LEDraw && typeof window.LEDraw.list === 'function' ? { features: window.LEDraw.list().length } : null,
      lighting: window.LELighting && typeof window.LELighting.getState === 'function' ? window.LELighting.getState() : null,
      renderError: state.renderError,
      renderErrorListener: state.renderErrorListener,
      showRenderLoopErrors: state.showRenderLoopErrors,
      consoleErrors: state.consoleErrors.slice(),
      pageErrors: state.pageErrors.slice(),
    };
    if (report.scene) report.scene.renderErrorCount = state.renderError ? 1 : 0;
    return report;
  }

  /* ------------------------------ 面板渲染 ------------------------------ */

  function appendDl(container, pairs) {
    if (!container) return;
    container.innerHTML = '';
    for (const pair of pairs) {
      const dt = document.createElement('dt');
      dt.textContent = pair[0];
      const dd = document.createElement('dd');
      dd.textContent = pair[1] == null || pair[1] === '' ? '--' : String(pair[1]);
      container.appendChild(dt);
      container.appendChild(dd);
    }
  }

  function renderPanel() {
    if (!state.panelOpen) return;
    const report = getReport();
    const fpsText =
      report.fps.current == null
        ? '采样中…'
        : report.fps.current + ' FPS' + (report.fps.history.length > 1 ? '（最近 ' + report.fps.history.length + ' 窗口）' : '');
    appendDl(byId('diag-render'), [
      ['GPU', report.gpu.unmaskedRenderer || report.gpu.renderer || '未知'],
      ['厂商', report.gpu.unmaskedVendor || report.gpu.vendor || '--'],
      ['WebGL', (report.gpu.webgl2 ? 'WebGL2 · ' : 'WebGL1 · ') + (report.gpu.version || '--')],
      ['GLSL', report.gpu.shadingLanguageVersion || '--'],
      ['FPS', fpsText],
      ['分辨率', report.display.window.width + '×' + report.display.window.height + ' @ DPR ' + report.display.devicePixelRatio],
      ['画布', report.display.canvas ? report.display.canvas.width + '×' + report.display.canvas.height : '--'],
      ['JS 堆', report.memory ? report.memory.usedMB + ' / ' + report.memory.limitMB + ' MB' : '不支持 performance.memory'],
    ]);

    const globe = report.scene && report.scene.globe;
    appendDl(byId('diag-scene'), [
      ['场景模式', report.scene ? (report.scene.mode === 3 ? '3D' : report.scene.mode === 2 ? '2D' : 'Columbus') : '--'],
      ['图层', report.layers.count + '（可见 ' + report.layers.visible + '）'],
      ['影像层 / 数据源', (report.scene ? report.scene.imageryLayers : '--') + ' / ' + (report.scene ? report.scene.dataSources : '--')],
      ['实体 / 图元', (report.scene ? report.scene.entities : '--') + ' / ' + (report.scene ? report.scene.primitives : '--')],
      ['地形 Provider', globe ? globe.terrainProvider || 'EllipsoidTerrainProvider' : '--'],
      ['顶点法线', globe ? (globe.hasVertexNormals === null ? '未知' : globe.hasVertexNormals ? '有' : '无（无地形起伏光照）') : '--'],
      ['瓦片加载完成', globe ? (globe.tilesLoaded ? '是' : '否') : '--'],
      ['光照', report.lighting ? (report.lighting.enabled ? '开 · ' + report.lighting.utc + ' UTC' : '关') : '--'],
    ]);

    const t = report.terrain;
    const k = report.kml;
    appendDl(byId('diag-terrain'), [
      ['地形开关', t ? (t.enabled ? '开' : '关') + ' · 网格 ' + t.grid + '² · 夸张 ' + Number(t.exaggeration).toFixed(1) + '×' : '--'],
      ['地形源', t ? ['示例区 ' + (t.high && t.high.ready ? '✓' : '…'), '东亚 ' + (t.eastasia && t.eastasia.ready ? '✓' : '…'), '全球 ' + (t.world && t.world.ready ? '✓' : '…')].join(' / ') : '--'],
      ['地形重建', t && t.perf ? (t.perf.lastRebuildMs == null ? '--' : t.perf.lastRebuildMs + ' ms · 共 ' + t.perf.rebuildCount + ' 次') : '--'],
      ['影像档位', t && t.imagery ? (t.imagery.enabled ? '开' : '关') + ' · ' + t.imagery.quality : '--'],
      ['KML 加载', k ? k.loads + ' 次 · ' + k.totalLoadMs + ' ms · ' + k.placemarks + ' placemark' : 'LEKml 不可用'],
      ['KML 点云', k ? k.renderedPoints + ' / ' + k.sourcePoints + ' 点（1/' + k.pointSubsample + '）' : '--'],
      ['KML 最大阻塞', k ? (k.heartbeatMaxGapMs || 0) + ' ms' : '--'],
    ]);

    const errBox = byId('diag-render-error');
    if (errBox) {
      if (report.renderError) {
        errBox.textContent = '[' + report.renderError.at + '] ' + report.renderError.message + '\n' + (report.renderError.stack || '');
      } else {
        errBox.textContent = '暂无 scene.renderError（监听' + (report.renderErrorListener ? '已注册' : '未注册') + '）';
      }
    }
    const noteBox = byId('diag-note');
    if (noteBox && report.showRenderLoopErrors) {
      noteBox.textContent = report.showRenderLoopErrors.note || '';
    }
    const log = byId('diag-console');
    if (log) {
      log.innerHTML = '';
      const errors = report.consoleErrors.slice(-50).reverse();
      for (const item of errors) {
        const li = document.createElement('li');
        li.textContent = item.at.replace('T', ' ').slice(0, 23) + ' ' + item.message.slice(0, 400);
        li.title = item.message;
        log.appendChild(li);
      }
      if (!errors.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = '暂无 console.error';
        log.appendChild(li);
      }
    }
    const badge = byId('diag-badge');
    if (badge) {
      badge.textContent = 'FPS ' + (report.fps.current == null ? '--' : report.fps.current);
    }
  }

  function open() {
    const panel = byId('diag-panel');
    if (!panel) return false;
    panel.classList.remove('hidden');
    state.panelOpen = true;
    renderPanel();
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(renderPanel, 1000);
    return true;
  }

  function close() {
    const panel = byId('diag-panel');
    if (panel) panel.classList.add('hidden');
    state.panelOpen = false;
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    return true;
  }

  function togglePanel() {
    return state.panelOpen ? close() : open();
  }

  /* ------------------------------ 导出 ------------------------------ */

  function copyReport() {
    const text = JSON.stringify(getReport(), null, 2);
    const done = () => {
      const le = getLE();
      if (le && le.toast) le.toast('诊断 JSON 已复制（' + text.length + ' 字节）', 'ok', 2600);
      return text;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(done, () => {
        fallbackCopy(text);
        return done();
      });
    }
    fallbackCopy(text);
    return Promise.resolve(done());
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (err) {
      console.warn('[LEDiagnostics] 复制失败', err);
    }
  }

  function downloadReport() {
    const text = JSON.stringify(getReport(), null, 2);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = 'local-earth-diagnostics-' + stamp + '.json';
    try {
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 1500);
      state.lastDownload = { name: name, size: text.length, at: new Date().toISOString() };
      const le = getLE();
      if (le && le.toast) le.toast('诊断日志已导出：' + name, 'ok', 3000);
      return state.lastDownload;
    } catch (err) {
      originalConsoleError('[LEDiagnostics] 下载诊断日志失败', err);
      return null;
    }
  }

  /* ------------------------------ 绑定/初始化 ------------------------------ */

  function bindUI() {
    if (state.bound) return;
    state.bound = true;
    const on = (id, fn) => {
      const el = byId(id);
      if (el) el.addEventListener('click', fn);
    };
    on('btn-diagnostics', () => togglePanel());
    on('diag-close', () => close());
    on('diag-copy', () => copyReport());
    on('diag-download', () => downloadReport());
    on('diag-refresh', () => renderPanel());
    on('diag-reload', () => {
      const le = getLE();
      if (le && le.status) le.status('诊断面板：正在重新加载页面…');
      setTimeout(() => location.reload(), 80);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && state.panelOpen) close();
    });
  }

  function init(le) {
    state.le = le || window.LE;
    bindUI();
    const viewer = viewerOf();
    setupRenderErrorListener(viewer);
    tryShowRenderLoopErrors(viewer);
    if (viewer && viewer.scene && viewer.scene.postRender) {
      try {
        viewer.scene.postRender.addEventListener(onFrame);
      } catch (err) {
        console.warn('[LEDiagnostics] FPS 采样监听失败', err);
      }
    }
    if (state.panelOpen) renderPanel();
    return getReport();
  }

  window.LEDiagnostics = {
    init,
    open,
    close,
    toggle: togglePanel,
    getReport,
    getConsoleErrors: () => state.consoleErrors.slice(),
    getPageErrors: () => state.pageErrors.slice(),
    getLastDownload: () => state.lastDownload,
    copyReport,
    downloadReport,
    clearConsoleErrors: () => {
      state.consoleErrors.length = 0;
      return true;
    },
    // 测试辅助：不实际触发 renderError（Cesium 会因此停止渲染循环），只读取监听状态
    isRenderErrorListenerInstalled: () => state.renderErrorListener,
  };

  // 模块自行初始化
  if (window.LE && window.LE.viewer) {
    init(window.LE);
  } else {
    document.addEventListener('local-earth-ready', (ev) => init((ev && ev.detail) || window.LE), { once: true });
  }
})();

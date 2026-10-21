/*
 * 原生 KML / KMZ 渲染器（js/kml-native.js）
 * ---------------------------------------------------------------
 * 目的：不依赖 Cesium.KmlDataSource 的渲染（对 1479 个短线段风场 KMZ 会“加载成功但看不见”），
 *       自行解析 KML/KMZ 并用 Cesium.CustomDataSource 构建实体，保证用户数据“打开即见”。
 *
 * 对外 API：window.LEKml
 *   load(input, le?, options?) -> Promise<{ layer, count, bounds, warnings, dataSource, kmlName, overlays, frames, timeline }>
 *       input: File | Blob | ArrayBuffer | Uint8Array | URL string（相对/同源 URL）
 *       options: { name?, fly?, duration?, onProgress?({phase, percent, placemarks, total}) }
 *   setQuality({ pointSubsample: 1|2|4 }) / getQuality()  —— 点云降采样（性能模式，可在加载前后调用）
 *   getPerfStats() / resetPerfStats()                     —— 解析/切帧/渲染性能指标
 *   parseKmlText(text) -> Promise<模型摘要>（调试用；v1.2.0 起异步）
 *   config        -> 可视性/性能参数（线宽下限 / relativeToGround 抬升 / 图标像素 / 动画预算 / 解析分片）
 *   version
 *
 * 性能：
 *   - 解析分片：每 config.parseChunkPlacemarks(2000) 个 Placemark 让出主线程
 *     （MessageChannel，回退 setTimeout(0)），进度经 LE.setStatus('解析 KML：xx%') 展示，
 *     避免 13.5 万 Placemark / 56 MB KML 首开时长时间冻结。
 *   - 点云降采样：setQuality({pointSubsample:2|4}) 原位更新 PointPrimitiveCollection（不清空重建）。
 *
 * 动画 KMZ（Point + IconStyle + TimeSpan）：
 *   - IconStyle：颜色 / scale / heading / href；外部 http(s) 图标不联网，统一用内置箭头 sprite；
 *   - 时间：TimeSpan / gx:TimeSpan / TimeStamp → 按 begin 去重成帧，仅显示当前帧；
 *     生成时间轴控制器（DOM/播放由 js/ui.js 绑定 'lekml-timeline' 事件）与颜色-风速图例。
 *
 * 约束：完全离线；KMZ 用浏览器原生 DecompressionStream('deflate-raw') 解压；
 *       外部 URL 的图例/图标一律拒绝（不发起网络请求）。
 * 说明：详细实现与限制见 docs/KML-ANIMATION.md、docs/kml-native.md。
 */
(function () {
  'use strict';

  const C = window.Cesium;
  if (!C) {
    console.error('[LEKml] Cesium 未加载，原生 KML 渲染器不可用');
    return;
  }

  // 预热 XML 解析器（DOMParser 首次调用有冷启动开销；在加载前完成，避免计入首开阻塞）
  try {
    new DOMParser().parseFromString('<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>', 'text/xml');
  } catch (err) {
    /* ignore */
  }

  /* ------------------------------ 可调参数 ------------------------------ */

  const config = {
    // KML style 里的 width=1 在数据范围视角下太细，渲染时给一个像素下限
    minLineWidth: 1,
    // relativeToGround 的 25m 贴地高度在椭球地形上几乎与地面重合；抬到至少 60m 保证可见
    relativeGroundMinHeight: 60,
    relativeGroundOffset: 6,
    // clampToGround 折线是否改用“抬升 60m 的 3D 折线”近似
    // 原因：动态折线的 clampToGround 分支会创建 GroundPolylinePrimitive，本应用
    // 无地形数据时 arcType=NONE 会触发 Cesium 内部异常（surfaceDistance 未定义）并
    // 导致整个渲染循环停止；抬升近似在无地形的椭球场景下视觉等价且稳定。
    clampToGroundAsHeight: true,
    // 安全上限，避免畸形 KML 撑爆内存
    maxEntities: 50000,
    maxZipEntries: 4096,
    maxUncompressedBytes: 128 * 1024 * 1024,

    // ---- 动画 KMZ（Point + IconStyle + TimeSpan）----
    // 外部图标（http/https，例如 maps.google.com）不联网：统一用内置白色箭头 sprite，
    // 再用 billboard.color 按 IconStyle <color> 着色。scale 按“基础像素 × scale”换算。
    iconBasePixels: 22,
    iconMinPixels: 9,
    iconMaxPixels: 96,
    // 动画实体预算：超过后只保留当前帧前后窗口（避免十几万实体卡死主线程/内存）。
    // 预算内则一次性构建全部实体，切帧只改 entity.show，不重建数据源。
    animEntityBudget: 36000,
    animFrameWindow: 3,

    // ---- 解析异步化 / 性能模式 ----
    // 每处理多少个 Placemark 让出一次主线程（setTimeout/MessageChannel）
    // 2000 时让出过频（每次让出都会渲染一帧，~30–50ms），大文件总耗时反而增加；
    // 6000 时单次同步块约 80–120ms，既保证 UI/心跳 <1s，又接近原加载耗时。
    parseChunkPlacemarks: 6000,
    // 进度回调最小间隔（毫秒），避免频繁改 DOM
    progressMinIntervalMs: 120,
    // 点云每帧位置缓存帧数（LRU，控制内存）
    pointCloudCacheFrames: 4,
    // 超过该字节数的 KML 在原生解析阶段释放全屏加载遮罩（改用状态栏进度），保证界面可交互
    unblockOverlayMinBytes: 8 * 1024 * 1024,
  };

  const KML_NS = 'http://www.opengis.net/kml/2.2';

  /* ------------------------------ 小工具 ------------------------------ */

  function extOf(name) {
    const m = /\.([^.]+)$/.exec(String(name || '').toLowerCase());
    return m ? m[1] : '';
  }

  function basename(name) {
    const s = String(name || '').replace(/\\/g, '/');
    const i = s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function stripTags(text) {
    return String(text == null ? '' : text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function toNumber(value, fallback) {
    const n = parseFloat(value);
    return isFinite(n) ? n : fallback;
  }

  function createContext() {
    return {
      warnings: [],
      _once: new Set(),
      _counts: Object.create(null),
      warn(message) {
        const msg = String(message);
        if (this._once.has(msg)) return;
        this._once.add(msg);
        this.warnings.push(msg);
      },
      count(key, n) {
        this._counts[key] = (this._counts[key] || 0) + (n == null ? 1 : n);
      },
      flushCounts() {
        const c = this._counts;
        if (c.unsupportedGeometry) {
          this.warn('已忽略 ' + c.unsupportedGeometry + ' 个暂不支持的 KML 几何（Model / gx:Track 等）');
        }
        if (c.extrude) {
          this.warn('已忽略 ' + c.extrude + ' 个 extrude（拉伸体）设置，按普通折线渲染');
        }
        if (c.badCoordinates) {
          this.warn('已跳过 ' + c.badCoordinates + ' 个无效坐标点');
        }
        if (c.skippedPlacemark) {
          this.warn('已跳过 ' + c.skippedPlacemark + ' 个无可用几何的 Placemark');
        }
      },
    };
  }

  /* ------------------ 性能统计 / 异步让出 / 质量（点云降采样） ------------------ */

  const PERF_DEBUG = (function () {
    try {
      return new URLSearchParams(location.search).get('kmlperf') === '1';
    } catch (err) {
      return false;
    }
  })();

  const perfStats = {
    loads: 0,
    totalLoadMs: 0,
    decodeMs: 0,
    zipMs: 0,
    domParseMs: 0,
    domMaxMs: 0,
    planMs: 0,
    readMs: 0,
    zipMs: 0,
    decodeMs: 0,
    styleScanMs: 0,
    walkMs: 0,
    walkPureMs: 0,
    walkYieldMs: 0,
    framesMs: 0,
    iconPlanMs: 0,
    buildMs: 0,
    yieldCount: 0,
    maxYieldGapMs: 0,
    heartbeatMaxGapMs: 0,
    placemarks: 0,
    frameSwitchCount: 0,
    lastFrameSwitchMs: 0,
    maxFrameSwitchMs: 0,
    pointSubsample: 1,
    sourcePoints: 0,
    renderedPoints: 0,
    qualityChanges: 0,
    activePointClouds: 0,
    heapMB: 0,
    longTaskCount: 0,
    longTaskMaxMs: 0,
  };

  /** ?kmlperf=1 时用 PerformanceObserver 记录 >100ms 长任务（定位主线程阻塞来源）。 */
  function startLongTaskObserver() {
    if (!PERF_DEBUG || typeof PerformanceObserver !== 'function') return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < 100) continue;
          perfStats.longTaskCount++;
          perfStats.longTaskMaxMs = Math.max(perfStats.longTaskMaxMs, Math.round(entry.duration));
          perfLog('longtask', {
            start: Math.round(entry.startTime),
            duration: Math.round(entry.duration),
            name: entry.name,
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch (err) {
      /* ignore */
    }
  }

  startLongTaskObserver();

  function perfNow() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function perfLog(label, data) {
    if (!PERF_DEBUG) return;
    try {
      console.log('[LEKml-perf] ' + label + ' ' + JSON.stringify(data));
    } catch (err) {
      /* ignore */
    }
  }

  /** 让出主线程：优先 MessageChannel（无 setTimeout 4ms 钳制），回退 setTimeout(0)。 */
  function yieldToMain() {
    return new Promise((resolve) => {
      if (typeof MessageChannel === 'function') {
        try {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            try {
              channel.port1.close();
            } catch (err) {
              /* ignore */
            }
            resolve();
          };
          channel.port2.postMessage(0);
          return;
        } catch (err) {
          /* fallthrough */
        }
      }
      setTimeout(resolve, 0);
    });
  }

  /** 轻量心跳：加载期间每 64ms 采样一次，最大间隔即主线程阻塞（>1s 会明显体现）。 */
  function startHeartbeat() {
    const hb = { id: 0, last: perfNow(), maxGap: 0, ticks: 0 };
    hb.id = setInterval(() => {
      const now = perfNow();
      const gap = now - hb.last;
      hb.last = now;
      if (gap > hb.maxGap) hb.maxGap = gap;
      hb.ticks++;
    }, 64);
    return hb;
  }

  function stopHeartbeat(hb) {
    if (!hb) return 0;
    clearInterval(hb.id);
    return hb.maxGap;
  }

  /**
   * 进度上报：优先 LE.setStatus（非阻塞状态栏）；若加载浮层已显示，只更新其文案，
   * 不改变遮挡状态（不重新盖住界面）。支持 options.onProgress({phase, percent, placemarks, total})。
   */
  function createProgressReporter(le, options) {
    let lastAt = 0;
    let lastPercent = -1;
    const onProgress = options && typeof options.onProgress === 'function' ? options.onProgress : null;
    return {
      report(phase, percent, detail) {
        const now = perfNow();
        const pct = Math.max(0, Math.min(100, Math.round(percent)));
        if (pct === lastPercent && now - lastAt < config.progressMinIntervalMs) return;
        if (now - lastAt < 40 && pct - lastPercent < 10) return;
        lastAt = now;
        lastPercent = pct;
        const text =
          phase === 'parse'
            ? '解析 KML：' + pct + '%'
            : phase === 'build'
              ? '构建 KML 图层：' + pct + '%'
              : phase === 'read'
                ? '读取 KML：' + pct + '%'
                : '处理 KML：' + pct + '%';
        try {
          if (le && typeof le.setStatus === 'function') le.setStatus(text);
          else if (le && typeof le.status === 'function') le.status(text);
        } catch (err) {
          /* ignore */
        }
        try {
          const loading = document.getElementById('loading');
          if (loading && !loading.classList.contains('hidden')) {
            const loadingText = document.getElementById('loading-text');
            if (loadingText) loadingText.textContent = text;
          }
        } catch (err) {
          /* ignore */
        }
        if (onProgress) {
          try {
            onProgress({
              phase,
              percent: pct,
              text,
              placemarks: detail && detail.placemarks,
              total: detail && detail.total,
            });
          } catch (err) {
            /* ignore */
          }
        }
      },
    };
  }

  /* ---- 质量（点云降采样）：perf.js 调用 setQuality({pointSubsample:1|2|4}) ---- */

  function readInitialSubsample() {
    try {
      const raw = Number(new URLSearchParams(location.search).get('points'));
      if (raw === 2 || raw === 4) return raw;
    } catch (err) {
      /* ignore */
    }
    return 1;
  }

  const qualityState = { pointSubsample: readInitialSubsample() };
  const pointCloudLayers = new Set();

  function normalizeSubsample(value) {
    const n = Number(value);
    if (n === 2 || n === 4) return n;
    return 1;
  }

  function getQuality() {
    return { pointSubsample: qualityState.pointSubsample };
  }

  function setQuality(options) {
    if (options && typeof options === 'object' && Object.prototype.hasOwnProperty.call(options, 'pointSubsample')) {
      const next = normalizeSubsample(options.pointSubsample);
      if (next !== qualityState.pointSubsample) {
        qualityState.pointSubsample = next;
        perfStats.pointSubsample = next;
        perfStats.qualityChanges++;
        refreshPointCloudQuality();
        perfLog('quality', { pointSubsample: next });
      }
    }
    return getQuality();
  }

  /** 让所有活动点云图层按最新 quality 原位更新（复用 PointPrimitiveCollection，不整体销毁重建）。 */
  function refreshPointCloudQuality() {
    for (const entry of pointCloudLayers) {
      try {
        entry.applyQuality();
      } catch (err) {
        console.warn('[LEKml] 点云降采样应用失败', err);
      }
    }
    updateQualityBadge();
  }

  function ensureQualityBadge() {
    const host = document.getElementById('viewer');
    if (!host) return null;
    let el = document.getElementById('kml-quality-note');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kml-quality-note';
      el.className = 'kml-quality-note';
      el.style.cssText =
        'position:absolute;right:12px;top:12px;z-index:7;padding:7px 10px;border-radius:8px;' +
        'background:rgba(9,16,23,.82);border:1px solid #2c4a66;color:#bfe3ff;font-size:12px;' +
        'line-height:1.4;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.35)';
      host.appendChild(el);
    }
    return el;
  }

  /**
   * 大文件解析期间让全屏加载遮罩“可穿透”（pointer-events:none），
   * 不改变其显示/隐藏状态（自动化里 wait_for('#loading', hidden) 仍表示加载完成），
   * 同时状态栏/遮罩文案持续显示“解析 KML：xx%”。加载结束后恢复。
   */
  let unblockedLoadingEl = null;

  function unblockLoadingOverlay() {
    try {
      const el = document.getElementById('loading');
      if (!el || el.classList.contains('hidden') || el.style.pointerEvents === 'none') return;
      el.dataset.kmlPointerEvents = el.style.pointerEvents || '';
      el.style.pointerEvents = 'none';
      unblockedLoadingEl = el;
      perfLog('unblock-overlay', { mode: 'pointer-events' });
    } catch (err) {
      /* ignore */
    }
  }

  function restoreLoadingOverlayInteraction() {
    if (!unblockedLoadingEl) return;
    try {
      unblockedLoadingEl.style.pointerEvents = unblockedLoadingEl.dataset.kmlPointerEvents || '';
      delete unblockedLoadingEl.dataset.kmlPointerEvents;
    } catch (err) {
      /* ignore */
    }
    unblockedLoadingEl = null;
  }

  /** 点云降采样时显示“性能模式：1/N 点”提示（无图例文件也能看到；有图例时图例内也会注明）。 */
  function updateQualityBadge() {
    const el = ensureQualityBadge();
    if (!el) return;
    const subsample = qualityState.pointSubsample;
    let active = false;
    for (const entry of pointCloudLayers) {
      if (entry.visible !== false) {
        active = true;
        break;
      }
    }
    if (subsample <= 1 || !active) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.textContent = '性能模式：1/' + subsample + ' 点（点云降采样）';
    el.style.display = '';
  }

  /** 仅 ?kmlperf=1 时执行：用 postRender 采样近似 FPS，便于对比降采样效果。 */
  function startRenderSampler(le) {
    if (!PERF_DEBUG || !le || !le.viewer || !le.viewer.scene) return;
    const scene = le.viewer.scene;
    let frames = 0;
    let windowStart = perfNow();
    let windows = 0;
    const samples = [];
    const handler = () => {
      frames++;
      const now = perfNow();
      const elapsed = now - windowStart;
      if (elapsed < 1200) return;
      samples.push(Math.round((frames * 1000 * 10) / elapsed) / 10);
      frames = 0;
      windowStart = now;
      windows++;
      if (windows >= 3) {
        try {
          scene.postRender.removeEventListener(handler);
        } catch (err) {
          /* ignore */
        }
        perfLog('fps', {
          samples,
          pointSubsample: qualityState.pointSubsample,
          renderedPoints: perfStats.renderedPoints,
        });
      }
    };
    try {
      scene.postRender.addEventListener(handler);
    } catch (err) {
      /* ignore */
    }
  }

  function schedulePerfDebugLog() {
    if (!PERF_DEBUG) return;
    const snapshot = () => {
      const mem = typeof performance !== 'undefined' && performance.memory;
      return {
        heapMB: mem ? Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10 : -1,
        renderedPoints: perfStats.renderedPoints,
        pointSubsample: qualityState.pointSubsample,
      };
    };
    perfLog('mem', Object.assign({ tag: 'load' }, snapshot()));
    setTimeout(() => perfLog('mem', Object.assign({ tag: '+2s' }, snapshot())), 2000);
    setTimeout(() => perfLog('mem', Object.assign({ tag: '+4s' }, snapshot())), 4000);
    setTimeout(() => perfLog('mem', Object.assign({ tag: '+6s' }, snapshot())), 6000);
  }

  /* ------------------------------ 输入读取 ------------------------------ */

  async function readInput(input, ctx) {
    if (input == null) throw new Error('未提供 KML/KMZ 数据');

    if (typeof input === 'string') {
      const url = input;
      let response;
      try {
        response = await fetch(url, { credentials: 'same-origin' });
      } catch (err) {
        throw new Error('读取 KML/KMZ 失败（' + url + '）：' + (err && err.message ? err.message : err));
      }
      if (!response.ok) throw new Error('读取 KML/KMZ 失败（' + url + '）：HTTP ' + response.status);
      const buffer = await response.arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        name: basename(url.split('?')[0]) || 'kml',
        url: new URL(url, location.href).href,
      };
    }

    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      const buffer = await input.arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        name: input.name || 'kml',
        url: null,
      };
    }

    if (input instanceof ArrayBuffer) {
      return { bytes: new Uint8Array(input), name: 'kml', url: null };
    }

    if (ArrayBuffer.isView(input)) {
      const view = input;
      return {
        bytes: new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
        name: 'kml',
        url: null,
      };
    }

    throw new Error('不支持的 KML/KMZ 输入类型（需要 File/Blob/ArrayBuffer/URL 字符串）');
  }

  function looksLikeZip(bytes) {
    return (
      bytes &&
      bytes.byteLength >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
    );
  }

  /* ------------------------------ ZIP 解压 ------------------------------ */

  function zipDataView(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function decodeZipName(nameBytes, utf8Hint) {
    // KMZ 一般写 UTF-8；极少数老工具用本地代码页，失败时退回 latin1 保证可用
    try {
      return new TextDecoder('utf-8').decode(nameBytes);
    } catch (_) {
      let out = '';
      for (let i = 0; i < nameBytes.length; i++) out += String.fromCharCode(nameBytes[i]);
      return out;
    }
  }

  function findEndOfCentralDirectory(bytes) {
    const dv = zipDataView(bytes);
    const len = bytes.byteLength;
    const min = Math.max(0, len - 65557);
    for (let i = len - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  function readZipCentralDirectory(bytes, ctx) {
    const dv = zipDataView(bytes);
    const len = bytes.byteLength;
    const eocd = findEndOfCentralDirectory(bytes);
    if (eocd < 0) return null;

    const entryCount = dv.getUint16(eocd + 10, true);
    const cdSize = dv.getUint32(eocd + 12, true);
    const cdOffset = dv.getUint32(eocd + 16, true);
    if (entryCount === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
      throw new Error('暂不支持 ZIP64 格式的 KMZ');
    }
    if (cdOffset >= len) return null;

    const entries = [];
    let p = cdOffset;
    for (let i = 0; i < entryCount; i++) {
      if (p + 46 > len || dv.getUint32(p, true) !== 0x02014b50) {
        ctx.warn('ZIP 中央目录不完整，已停止读取剩余条目');
        break;
      }
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const size = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOffset = dv.getUint32(p + 42, true);
      const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
      const name = decodeZipName(nameBytes, (flags & 0x0800) !== 0).replace(/\\/g, '/');
      p += 46 + nameLen + extraLen + commentLen;

      if (flags & 0x0001) {
        ctx.warn('已跳过加密的 ZIP 条目：' + name);
        continue;
      }
      if (entries.length >= config.maxZipEntries) {
        ctx.warn('ZIP 条目过多（>' + config.maxZipEntries + '），只读取前 ' + config.maxZipEntries + ' 个');
        break;
      }
      entries.push({ name, method, compSize, size, localOffset, flags });
    }
    return entries.length ? entries : null;
  }

  /** 无中央目录时的兜底：顺序扫描本地文件头（部分工具生成的非标准 KMZ）。 */
  function readZipLocalHeaders(bytes, ctx) {
    const dv = zipDataView(bytes);
    const len = bytes.byteLength;
    const entries = [];
    let p = 0;
    while (p + 30 <= len && entries.length < config.maxZipEntries) {
      if (dv.getUint32(p, true) !== 0x04034b50) {
        p++;
        continue;
      }
      const flags = dv.getUint16(p + 6, true);
      const method = dv.getUint16(p + 8, true);
      let compSize = dv.getUint32(p + 18, true);
      const size = dv.getUint32(p + 22, true);
      const nameLen = dv.getUint16(p + 26, true);
      const extraLen = dv.getUint16(p + 28, true);
      const name = decodeZipName(bytes.subarray(p + 30, p + 30 + nameLen), (flags & 0x0800) !== 0).replace(/\\/g, '/');
      const dataStart = p + 30 + nameLen + extraLen;
      if (!compSize) {
        // 数据描述符模式：向后找下一个本地文件头/中央目录头，估计压缩长度
        let next = -1;
        for (let q = dataStart + 4; q < len - 4; q++) {
          const sig = dv.getUint32(q, true);
          if (sig === 0x04034b50 || sig === 0x02014b50) {
            next = q;
            break;
          }
        }
        if (next < 0) break;
        compSize = next - dataStart;
      }
      if (dataStart + compSize > len) break;
      entries.push({ name, method, compSize, size, localOffset: p, flags });
      p = dataStart + compSize;
    }
    if (!entries.length) ctx.warn('未能识别 ZIP 目录结构，KMZ 可能已损坏');
    return entries;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('当前浏览器不支持 DecompressionStream(deflate-raw)，无法解压 KMZ');
    }
    const input = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice();
    const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  async function extractZipEntry(bytes, entry) {
    if (entry.method !== 0 && entry.method !== 8) {
      throw new Error('不支持的 ZIP 压缩方式（method=' + entry.method + '）：' + entry.name);
    }
    const dv = zipDataView(bytes);
    const off = entry.localOffset;
    if (off + 30 > bytes.byteLength || dv.getUint32(off, true) !== 0x04034b50) {
      throw new Error('ZIP 本地文件头无效：' + entry.name);
    }
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataStart = off + 30 + nameLen + extraLen;
    const compSize = entry.compSize;
    if (entry.method === 0) {
      if (dataStart + compSize > bytes.byteLength) {
        throw new Error('ZIP 条目数据越界：' + entry.name);
      }
      return bytes.subarray(dataStart, dataStart + compSize);
    }
    if (dataStart + compSize > bytes.byteLength) {
      throw new Error('ZIP 条目数据越界：' + entry.name);
    }
    return inflateRaw(bytes.subarray(dataStart, dataStart + compSize));
  }

  async function readZip(bytes, ctx) {
    let entries = null;
    try {
      entries = readZipCentralDirectory(bytes, ctx);
    } catch (err) {
      if (/ZIP64/.test(String(err && err.message))) throw err;
      ctx.warn('读取 ZIP 中央目录失败：' + (err && err.message ? err.message : err));
    }
    if (!entries) entries = readZipLocalHeaders(bytes, ctx);

    // 记录每个条目压缩数据前真实的本地头名字长度，供 stored 条目直接切片
    const dv = zipDataView(bytes);
    for (const entry of entries) {
      const off = entry.localOffset;
      if (off + 30 <= bytes.byteLength && dv.getUint32(off, true) === 0x04034b50) {
        entry._nameLen = dv.getUint16(off + 26, true);
      } else {
        entry._nameLen = 0;
      }
    }

    // 预检总解压大小，防止 zip bomb（在真正解压每个条目时再严格校验）
    let declaredTotal = 0;
    for (const entry of entries) declaredTotal += entry.size || 0;
    if (declaredTotal > config.maxUncompressedBytes) {
      throw new Error('KMZ 解压后体积过大（' + Math.round(declaredTotal / 1048576) + ' MB），已拒绝加载');
    }
    return { entries };
  }

  function pickKmlEntry(entries, ctx) {
    const kmls = entries.filter((entry) => /\.kml$/i.test(entry.name));
    if (!kmls.length) return null;
    const rank = (entry) => {
      const lower = entry.name.toLowerCase();
      if (lower === 'doc.kml') return 0;
      if (lower === 'files/doc.kml' || lower.endsWith('/doc.kml')) return 1;
      if (lower === 'index.kml' || lower.endsWith('/index.kml')) return 2;
      return 3;
    };
    kmls.sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length);
    if (kmls.length > 1) {
      ctx.warn('KMZ 内含 ' + kmls.length + ' 个 .kml，已选择最优先的：' + kmls[0].name);
    }
    return kmls[0];
  }

  /* ------------------------------ 文本解码 ------------------------------ */

  function decodeText(bytes) {
    if (!bytes || !bytes.byteLength) return '';
    // BOM
    if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes.byteLength >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
    // 依据 XML 声明里的 encoding 选择解码器（GB2312/GBK 在国内工具导出中常见）
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 256));
    const match = /encoding\s*=\s*["']([^"']+)["']/i.exec(head);
    let decoderName = 'utf-8';
    if (match) {
      const enc = match[1].toLowerCase();
      if (enc === 'gb2312' || enc === 'gbk' || enc === 'gb18030') decoderName = 'gbk';
      else if (enc === 'big5') decoderName = 'big5';
      else if (enc === 'utf-16' || enc === 'utf16') decoderName = 'utf-16le';
      else if (enc === 'iso-8859-1' || enc === 'latin1') decoderName = 'latin1';
    }
    try {
      return new TextDecoder(decoderName).decode(bytes);
    } catch (_) {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }

  /* ------------------------------ KML 颜色 ------------------------------ */

  /**
   * KML 颜色是 aabbggrr（与 CSS/常见 RGBA 相反）。
   * 返回 Cesium.Color，alpha 按 KML 语义保留。
   */
  function parseKmlColor(text) {
    if (!text) return null;
    const s = String(text).trim();
    if (!/^[0-9a-fA-F]{8}$/.test(s)) return null;
    const a = parseInt(s.slice(0, 2), 16);
    const b = parseInt(s.slice(2, 4), 16);
    const g = parseInt(s.slice(4, 6), 16);
    const r = parseInt(s.slice(6, 8), 16);
    return C.Color.fromBytes(r, g, b, a);
  }

  function parseKmlColorParts(text) {
    const color = parseKmlColor(text);
    if (!color) return null;
    return {
      color,
      a: Math.round(color.alpha * 255),
      r: Math.round(color.red * 255),
      g: Math.round(color.green * 255),
      b: Math.round(color.blue * 255),
    };
  }

  /* ------------------------------ XML 辅助 ------------------------------ */

  function firstChild(el, localName) {
    if (!el) return null;
    const children = el.children;
    for (let i = 0; i < children.length; i++) {
      if (children[i].localName === localName) return children[i];
    }
    return null;
  }

  function childText(el, localName) {
    const child = firstChild(el, localName);
    return child ? String(child.textContent || '').trim() : '';
  }

  function parseXml(text) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(text, 'text/xml');
    } catch (err) {
      throw new Error('KML XML 解析失败：' + (err && err.message ? err.message : err));
    }
    const root = doc.documentElement;
    const parserErrors = doc.getElementsByTagNameNS
      ? doc.getElementsByTagNameNS('*', 'parsererror')
      : doc.getElementsByTagName('parsererror');
    if ((root && root.localName === 'parsererror') || (parserErrors && parserErrors.length)) {
      const detail = parserErrors && parserErrors.length
        ? stripTags(parserErrors[0].textContent || '').slice(0, 200)
        : '';
      throw new Error('KML XML 格式错误' + (detail ? '：' + detail : ''));
    }
    if (!root) throw new Error('KML 内容为空');
    return { doc, root };
  }

  /* ------------------------------ 样式解析 ------------------------------ */

  function parseLineStyle(el) {
    if (!el) return null;
    return {
      color: parseKmlColor(childText(el, 'color')),
      width: toNumber(childText(el, 'width'), 1),
    };
  }

  function parsePolyStyle(el) {
    if (!el) return null;
    return {
      color: parseKmlColor(childText(el, 'color')),
      fill: childText(el, 'fill') !== '0',
      outline: childText(el, 'outline') !== '0',
    };
  }

  function parseIconStyle(el) {
    if (!el) return null;
    const icon = firstChild(el, 'Icon');
    // KML 里 heading 在 IconStyle 下；个别工具写到 Icon 下，一并兼容
    const headingText = childText(el, 'heading') || (icon ? childText(icon, 'heading') : '');
    return {
      color: parseKmlColor(childText(el, 'color')),
      scale: toNumber(childText(el, 'scale'), 1),
      heading: toNumber(headingText, 0),
      iconHref: icon ? childText(icon, 'href') : '',
    };
  }

  function parseStyleElement(el) {
    return {
      line: parseLineStyle(firstChild(el, 'LineStyle')),
      poly: parsePolyStyle(firstChild(el, 'PolyStyle')),
      icon: parseIconStyle(firstChild(el, 'IconStyle')),
    };
  }

  function mergeStyle(base, over) {
    if (!over) return base || null;
    const out = {
      line: over.line ? Object.assign({}, base && base.line, over.line) : (base && base.line) || null,
      poly: over.poly ? Object.assign({}, base && base.poly, over.poly) : (base && base.poly) || null,
      icon: over.icon ? Object.assign({}, base && base.icon, over.icon) : (base && base.icon) || null,
    };
    return out;
  }

  function resolveStyleUrl(styleUrl, styles, styleMaps, depth) {
    if (!styleUrl) return null;
    if (depth > 8) return null;
    const raw = String(styleUrl).trim();
    const ref = raw.charAt(0) === '#' ? raw.slice(1) : raw;
    if (styles.has(ref)) return styles.get(ref);
    if (styleMaps.has(ref)) {
      const map = styleMaps.get(ref);
      const target = map.normal || map.highlight;
      if (target) return resolveStyleUrl(target, styles, styleMaps, depth + 1);
    }
    return null;
  }

  /* --------------------------- 时间（TimeSpan / gx:TimeSpan / TimeStamp） --------------------------- */

  function parseIsoTime(text) {
    const raw = String(text || '').trim();
    if (!raw) return NaN;
    const ms = Date.parse(raw);
    return isFinite(ms) ? ms : NaN;
  }

  function parseTimeStamp(el) {
    const stamp = firstChild(el, 'TimeStamp');
    if (!stamp) return null;
    const when = parseIsoTime(childText(stamp, 'when'));
    if (!isFinite(when)) return null;
    return { begin: when, end: when, source: 'TimeStamp' };
  }

  /**
   * 解析 Placemark 的 TimeSpan（含 gx:TimeSpan，DOM localName 相同）/ TimeStamp。
   * 返回 { begin, end }（毫秒时间戳）或 null。
   */
  function parseTimeInterval(el) {
    if (!el) return null;
    const span = firstChild(el, 'TimeSpan');
    if (!span) return parseTimeStamp(el);
    let begin = parseIsoTime(childText(span, 'begin'));
    let end = parseIsoTime(childText(span, 'end'));
    if (!isFinite(begin) && isFinite(end)) begin = end;
    if (!isFinite(end) && isFinite(begin)) end = begin;
    if (!isFinite(begin)) return null;
    if (end < begin) end = begin;
    return { begin, end, source: 'TimeSpan' };
  }

  /** 帧时间文本（UTC，避免受浏览器本地时区影响；数据本身是 Z 时间）。 */
  function formatFrameTime(ms) {
    if (!isFinite(ms)) return '--';
    const d = new Date(ms);
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    return (
      d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
      ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' UTC'
    );
  }

  /**
   * 按 TimeSpan.begin 去重成离散帧：只显示“当前帧”的实体。
   * 返回 frames[{ index, begin, end, count, label }]，并给每个 Placemark 写 frameIndex。
   * 大文件按块让出主线程（onChunk 回调负责 await）。
   */
  async function assignFrames(placemarks, onChunk) {
    const byBegin = new Map();
    const frames = [];
    const total = placemarks.length;
    let processed = 0;
    for (const placemark of placemarks) {
      processed++;
      if ((processed % 20000) === 0) {
        if (onChunk) await onChunk(processed, total);
      }
      if (!placemark.visible || !placemark.time) continue;
      const begin = placemark.time.begin;
      let frame = byBegin.get(begin);
      if (!frame) {
        frame = { index: frames.length, begin, end: placemark.time.end, count: 0 };
        byBegin.set(begin, frame);
        frames.push(frame);
      }
      frame.count++;
      if (placemark.time.end > frame.end) frame.end = placemark.time.end;
    }
    if (!frames.length) return [];
    frames.sort((a, b) => a.begin - b.begin);
    const indexOf = new Map();
    frames.forEach((frame, index) => {
      frame.index = index;
      indexOf.set(frame.begin, index);
    });
    processed = 0;
    for (const placemark of placemarks) {
      processed++;
      if ((processed % 20000) === 0) {
        if (onChunk) await onChunk(processed, total);
      }
      if (placemark.visible && placemark.time) {
        const index = indexOf.get(placemark.time.begin);
        placemark.frameIndex = index == null ? -1 : index;
      } else {
        placemark.frameIndex = -1;
      }
    }
    for (const frame of frames) frame.label = formatFrameTime(frame.begin);
    return frames;
  }

  /* ------------------------------ 几何解析 ------------------------------ */

  function parseCoordinates(text, ctx) {
    if (!text) return [];
    const tuples = String(text).trim().split(/\s+/);
    const out = [];
    for (let i = 0; i < tuples.length; i++) {
      const tuple = tuples[i];
      if (!tuple) continue;
      const parts = tuple.split(',');
      if (parts.length < 2) {
        ctx.count('badCoordinates');
        continue;
      }
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      const alt = parts.length > 2 ? parseFloat(parts[2]) : 0;
      if (!isFinite(lon) || !isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
        ctx.count('badCoordinates');
        continue;
      }
      out.push({ lon, lat, alt: isFinite(alt) ? alt : 0 });
    }
    return out;
  }

  function altitudeModeOf(geometryEl) {
    const raw = childText(geometryEl, 'altitudeMode').toLowerCase();
    if (!raw) return 'clampToGround'; // KML 规范默认值
    if (raw === 'relativetoground') return 'relativeToGround';
    if (raw === 'absolute') return 'absolute';
    if (raw === 'clamptoground') return 'clampToGround';
    if (raw === 'relativetoseafloor' || raw === 'clamptoseafloor') return 'relativeToGround';
    return 'relativeToGround';
  }

  function collectGeometries(el, out, ctx) {
    if (!el) return;
    const name = el.localName;
    if (name === 'LineString') {
      const coords = parseCoordinates(childText(el, 'coordinates'), ctx);
      out.push({ type: 'line', coords, altitudeMode: altitudeModeOf(el), extrude: childText(el, 'extrude') === '1' });
    } else if (name === 'Polygon') {
      const rings = [];
      const outer = firstChild(el, 'outerBoundaryIs');
      if (outer) {
        const ring = firstChild(outer, 'LinearRing');
        const coords = parseCoordinates(childText(ring, 'coordinates'), ctx);
        if (coords.length >= 3) rings.push(coords);
      }
      for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i];
        if (child.localName !== 'innerBoundaryIs') continue;
        const ring = firstChild(child, 'LinearRing');
        const coords = parseCoordinates(childText(ring, 'coordinates'), ctx);
        if (coords.length >= 3) rings.push(coords);
      }
      if (rings.length) out.push({ type: 'polygon', rings, altitudeMode: altitudeModeOf(el) });
    } else if (name === 'Point') {
      const coords = parseCoordinates(childText(el, 'coordinates'), ctx);
      if (coords.length) out.push({ type: 'point', coords, altitudeMode: altitudeModeOf(el) });
    } else if (name === 'MultiGeometry') {
      for (let i = 0; i < el.children.length; i++) collectGeometries(el.children[i], out, ctx);
    } else if (name === 'Model' || name === 'Track' || name === 'MultiTrack') {
      ctx.count('unsupportedGeometry');
    } else if (name === 'LinearRing') {
      // 独立 LinearRing（非 Polygon 内）按折线处理
      const coords = parseCoordinates(childText(el, 'coordinates'), ctx);
      if (coords.length >= 2) out.push({ type: 'line', coords, altitudeMode: altitudeModeOf(el), extrude: false });
    }
  }

  /** 当前是否启用了本地 3D 地形。 */
  function terrainEnabled() {
    return !!(window.LETerrain && typeof window.LETerrain.isEnabled === 'function' && window.LETerrain.isEnabled());
  }

  /** 地形高度（米）；未启用地形时为 0。 */
  function groundHeightAt(lon, lat) {
    if (!terrainEnabled()) return 0;
    const h = window.LETerrain.heightAt(lon, lat);
    return isFinite(h) ? h : 0;
  }

  function heightFor(point, altitudeMode) {
    const alt = isFinite(point.alt) ? point.alt : 0;
    if (altitudeMode === 'absolute') return alt;
    if (terrainEnabled()) {
      // 有真实地形：贴合地形后再抬高数据中的高度；clampToGround 贴地 +1m 防闪烁（尽量贴近 Google Earth 的贴地观感）
      const ground = groundHeightAt(point.lon, point.lat);
      if (altitudeMode === 'relativeToGround') return ground + Math.max(alt, 0) + 1;
      return ground + 1;
    }
    if (altitudeMode === 'relativeToGround') {
      return Math.max(alt, config.relativeGroundMinHeight) + config.relativeGroundOffset;
    }
    return 0; // clampToGround（无地形时的近似）
  }

  function positionsFor(coords, altitudeMode) {
    const positions = [];
    for (let i = 0; i < coords.length; i++) {
      const h = heightFor(coords[i], altitudeMode);
      const position = C.Cartesian3.fromDegrees(
        coords[i].lon,
        coords[i].lat,
        isFinite(h) ? h : 0
      );
      if (position) positions.push(position);
    }
    return positions;
  }

  /* ------------------------------ KML 文档模型 ------------------------------ */

  function parseRegion(regionEl) {
    if (!regionEl) return null;
    const box = firstChild(regionEl, 'LatLonAltBox');
    if (!box) return null;
    const west = toNumber(childText(box, 'west'), NaN);
    const east = toNumber(childText(box, 'east'), NaN);
    const south = toNumber(childText(box, 'south'), NaN);
    const north = toNumber(childText(box, 'north'), NaN);
    if (![west, east, south, north].every((n) => isFinite(n))) return null;
    return { west, east, south, north, has: true, source: 'Region' };
  }

  /**
   * 解析 KML 文本 → 文档模型。
   * 大文件分片：每 config.parseChunkPlacemarks 个 Placemark 让出主线程一次（await），
   * 输出进度（LE.setStatus / onProgress），避免 135k Placemark 文件首开长时间冻结。
   * 注意：DOMParser.parseFromString 本身不可拆分，只能在其前后让出并显示进度。
   */
  async function walkKmlChildren(node, folderPath, inheritedStyle, styles, styleMaps, ctx, state, progress, reportBase, reportSpan) {
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const name = child.localName;
      if (name === 'Document' || name === 'Folder') {
        const folderName = childText(child, 'name');
        const styleUrl = childText(child, 'styleUrl');
        const resolved = resolveStyleUrl(styleUrl, styles, styleMaps, 0);
        await walkKmlChildren(
          child,
          folderName ? folderPath.concat(folderName) : folderPath,
          mergeStyle(inheritedStyle, resolved),
          styles,
          styleMaps,
          ctx,
          state,
          progress,
          reportBase,
          reportSpan
        );
      } else if (name === 'Placemark') {
        const tRead = perfNow();
        const placemark = readPlacemark(child, folderPath, inheritedStyle, styles, styleMaps, ctx);
        state.placemarks.push(placemark);
        if (placemark.style && placemark.style.icon) state.iconStyleCount++;
        state.pureMs += perfNow() - tRead;
        state.seen++;
        if (state.seen % config.parseChunkPlacemarks === 0) {
          const tYield = perfNow();
          await yieldToMain();
          state.yieldMs += perfNow() - tYield;
          perfStats.yieldCount++;
          if (progress && state.total > 0) {
            const pct = reportBase + Math.round((state.seen / Math.max(1, state.total)) * reportSpan);
            progress.report('parse', pct, { placemarks: state.seen, total: state.total });
          }
        }
      } else if (name === 'ScreenOverlay') {
        state.overlayEls.push(child);
      } else if (name === 'GroundOverlay') {
        ctx.count('unsupportedGeometry');
      } else if (name === 'NetworkLink') {
        ctx.warn('已忽略 KML NetworkLink（离线模式不访问网络）');
      } else if (name === 'Style' || name === 'StyleMap' || name === 'Region' || name === 'name' || name === 'description') {
        // 文档级元数据 / 样式，已在样式表阶段处理
      }
    }
  }

  /* ---------------- 大 KML 分片 DOM 解析（降低 DOMParser 单次阻塞） ---------------- */

  const DOM_SPLIT_MIN_BYTES = 8 * 1024 * 1024;
  const DOM_SPLIT_MIN_FOLDERS = 2;

  /**
   * 为超大 KML 规划“按顶层 Folder 分片解析”：
   * - 仅在 >8MB、且全文件没有任何 Style/StyleMap（如 13.5 万点的纯点云动画）时启用；
   * - 这样跨分片的样式引用不存在，各分片可独立 DOMParser（每块约几 MB，阻塞更短）；
   * - 其余情况返回 null，走整份 DOM 解析（正确性优先）。
   */
  function planLargeKmlSplit(text) {
    if (text.length < DOM_SPLIT_MIN_BYTES) return null;
    // 扁平分片会把 Document 头部（含 Style/StyleMap）复制进每个分片，因此允许样式；
    // 顶层 Folder 分片暂不处理跨片样式引用，在下面单独返回 null。
    const hasStyles = text.indexOf('<Style') >= 0 || text.indexOf('<StyleMap') >= 0;
    const head = text.slice(0, 16384);
    const kmlMatch = /<kml\b[^>]*>/i.exec(head);
    if (!kmlMatch) return null;
    const kmlOpen = kmlMatch[0];
    const docMatch = /<Document\b[^>]*>/i.exec(head);
    const docOpen = docMatch ? docMatch[0] : '';
    const contentStart = docMatch ? docMatch.index + docMatch[0].length : kmlMatch.index + kmlMatch[0].length;
    const docClose = text.lastIndexOf('</Document>');
    const kmlClose = text.lastIndexOf('</kml>');
    const contentEnd = docClose > contentStart ? docClose : kmlClose > contentStart ? kmlClose : text.length;
    if (contentEnd - contentStart < DOM_SPLIT_MIN_BYTES) return null;

    // 扫描顶层 Folder（depth 0），并记录对应闭合位置
    const re = /<(\/?)Folder\b/g;
    let depth = 0;
    const folders = [];
    let match;
    while ((match = re.exec(text)) !== null) {
      const closing = match[1] === '/';
      if (!closing) {
        if (depth === 0) {
          if (match.index < contentStart || match.index > contentEnd) return null;
          folders.push({ start: match.index, end: -1 });
        }
        depth++;
      } else if (depth > 0) {
        depth--;
        if (depth === 0) {
          // 正则只匹配到 "</Folder"（\b 在 > 前），闭合标签要补到 '>' 之后
          const closeAt = text.indexOf('>', re.lastIndex);
          folders[folders.length - 1].end = closeAt >= 0 ? closeAt + 1 : re.lastIndex;
        }
      }
    }
    // 扁平大 KML（没有 Folder，13 万 Placemark 直接挂在 Document 下）：
    // 按 Placemark 连续块切片，每片都带上 Document 头部（Style/StyleMap），
    // 这样既有跨片样式，又能把单次 DOMParser 阻塞控制在几 MB。
    if (folders.length === 0) {
      const pmRe = /<Placemark\b/g;
      const opens = [];
      let pm;
      while ((pm = pmRe.exec(text)) !== null) {
        if (pm.index >= contentStart && pm.index < contentEnd) opens.push(pm.index);
      }
      if (opens.length < 100) return null;
      const firstPm = opens[0];
      const header = text.slice(contentStart, firstPm);
      if (header.length > 1024 * 1024) return null;
      const target = 4 * 1024 * 1024;
      const parts = [];
      let chunkStart = firstPm;
      for (let i = 0; i < opens.length; i++) {
        const close = text.indexOf('</Placemark>', opens[i]);
        if (close < 0) return null;
        const chunkEnd = close + 12;
        const last = i === opens.length - 1;
        if (last || chunkEnd - chunkStart >= target) {
          parts.push({ kind: 'chunk', start: chunkStart, end: last ? contentEnd : chunkEnd });
          if (!last) chunkStart = opens[i + 1];
        }
      }
      if (parts.length < 2) return null;
      return { kmlOpen, docOpen, header, flat: true, parts };
    }
    if (hasStyles) return null;
    if (depth !== 0 || folders.length < DOM_SPLIT_MIN_FOLDERS) return null;
    if (folders.some((folder) => folder.end < 0)) return null;
    for (let i = 1; i < folders.length; i++) {
      if (folders[i].start < folders[i - 1].end) return null;
    }
    // 组装分片：顶层 Folder + 它们之间/首尾的 Document 直属内容（保证不丢 Placemark/ScreenOverlay）
    const parts = [];
    let cursor = contentStart;
    for (const folder of folders) {
      if (folder.start > cursor) parts.push({ kind: 'document', start: cursor, end: folder.start });
      parts.push({ kind: 'folder', start: folder.start, end: folder.end });
      cursor = folder.end;
    }
    if (contentEnd > cursor) parts.push({ kind: 'document', start: cursor, end: contentEnd });
    return { kmlOpen, docOpen, parts };
  }


  function fastXmlText(value) {
    return String(value == null ? '' : value)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .trim();
  }

  function fastTagText(source, tag) {
    const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i');
    const m = re.exec(source);
    return m ? fastXmlText(m[1]) : '';
  }

  function fastAltitudeMode(raw) {
    const text = String(raw || '').toLowerCase();
    if (text === 'absolute') return 'absolute';
    if (text === 'relativetoground') return 'relativeToGround';
    if (text === 'clamptoground' || text === '') return 'clampToGround';
    return 'relativeToGround';
  }

  /**
   * 扁平 Simple KML 快速解析：只处理“Document 下直接挂 Placemark、每块只有
   * LineString/Point + TimeSpan + styleUrl + 简单 ExtendedData”的常见导出格式。
   * 任何不支持的标签/内联 Style 都返回 null，由调用方回退完整 DOM 分片解析。
   */
  async function fastParseFlatKml(text, plan, ctx, state, progress) {
    if (/<(Polygon|MultiGeometry|Model|GroundOverlay|NetworkLink|ScreenOverlay|gx:Track|MultiTrack)\b/i.test(text)) return null;
    if (plan.header.indexOf('<Style') < 0) return null;
    const wrapper = plan.kmlOpen + plan.docOpen + plan.header + (plan.docOpen ? '</Document>' : '') + '</kml>';
    let header;
    try { header = parseXml(wrapper).root; } catch (err) { return null; }
    const styles = new Map();
    const styleMaps = new Map();
    const styleEls = header.getElementsByTagNameNS
      ? header.getElementsByTagNameNS('*', 'Style')
      : header.getElementsByTagName('Style');
    for (let i = 0; i < styleEls.length; i++) {
      const el = styleEls[i];
      const id = el.getAttribute('id');
      if (id) styles.set(id, parseStyleElement(el));
    }
    const mapEls = header.getElementsByTagNameNS
      ? header.getElementsByTagNameNS('*', 'StyleMap')
      : header.getElementsByTagName('StyleMap');
    for (let i = 0; i < mapEls.length; i++) {
      const el = mapEls[i];
      const id = el.getAttribute('id');
      if (!id) continue;
      const map = { normal: null, highlight: null };
      for (let j = 0; j < el.children.length; j++) {
        const pair = el.children[j];
        if (pair.localName !== 'Pair') continue;
        const key = childText(pair, 'key') || 'normal';
        const target = childText(pair, 'styleUrl');
        if (target) map[key === 'highlight' ? 'highlight' : 'normal'] = target;
      }
      styleMaps.set(id, map);
    }
    if (!styles.size) return null;

    const t0 = perfNow();
    let cursor = 0;
    let parsed = 0;
    const totalBytes = text.length;
    while (true) {
      const start = text.indexOf('<Placemark', cursor);
      if (start < 0) break;
      const openEnd = text.indexOf('>', start);
      const end = text.indexOf('</Placemark>', openEnd + 1);
      if (openEnd < 0 || end < 0) return null;
      const body = text.slice(openEnd + 1, end);
      if (body.indexOf('<Style') >= 0) return null;
      const name = fastTagText(body, 'name') || '(未命名地物)';
      const visible = fastTagText(body, 'visibility') !== '0';
      const styleUrl = fastTagText(body, 'styleUrl');
      const timeSpan = fastTagText(body, 'TimeSpan');
      let time = null;
      if (timeSpan) {
        let begin = parseIsoTime(fastTagText(timeSpan, 'begin'));
        let endT = parseIsoTime(fastTagText(timeSpan, 'end'));
        if (!isFinite(begin) && isFinite(endT)) begin = endT;
        if (!isFinite(endT) && isFinite(begin)) endT = begin;
        if (isFinite(begin)) time = { begin, end: endT < begin ? begin : endT, source: 'TimeSpan' };
      } else {
        const stamp = fastTagText(body, 'TimeStamp');
        const when = parseIsoTime(stamp ? fastTagText(stamp, 'when') : '');
        if (isFinite(when)) time = { begin: when, end: when, source: 'TimeStamp' };
      }
      const geometryMode = fastAltitudeMode(fastTagText(body, 'altitudeMode'));
      const geometries = [];
      const lineAt = body.indexOf('<LineString');
      const pointAt = body.indexOf('<Point');
      if (lineAt >= 0 && body.indexOf('<LineString', lineAt + 1) < 0) {
        const coords = parseCoordinates(fastTagText(body.slice(lineAt), 'coordinates'), ctx);
        if (coords.length >= 2) geometries.push({ type: 'line', coords, altitudeMode: geometryMode, extrude: false });
      } else if (pointAt >= 0 && body.indexOf('<Point', pointAt + 1) < 0) {
        const coords = parseCoordinates(fastTagText(body.slice(pointAt), 'coordinates'), ctx);
        if (coords.length) geometries.push({ type: 'point', coords, altitudeMode: geometryMode });
      } else {
        return null;
      }
      const style = resolveStyleUrl(styleUrl, styles, styleMaps, 0);
      state.placemarks.push({
        name,
        visible,
        description: '',
        time,
        style,
        extended: {},
        folderPath: [],
        geometries,
      });
      if (!geometries.length) ctx.count('skippedPlacemark');
      state.seen++;
      parsed++;
      if (parsed % 6000 === 0) {
        await yieldToMain();
        perfStats.yieldCount++;
        if (progress) progress.report('parse', 10 + Math.round((end / totalBytes) * 52), { placemarks: parsed, total: 0 });
      }
      cursor = end + 12;
    }
    if (!parsed) return null;
    perfStats.styleScanMs = 0;
    perfStats.walkMs = Math.round(perfNow() - t0);
    perfStats.walkPureMs = perfStats.walkMs;
    perfStats.walkYieldMs = 0;
    perfStats.fastFlat = true;
    return header;
  }

  async function parseDocumentModelSplit(text, plan, ctx, progress, state) {
    const styles = new Map();
    const styleMaps = new Map();
    state.total = 0; // 进度按 Folder 分片数推进，避免额外扫描 56MB 统计 Placemark 数
    state.domMs = 0;
    state.domMaxMs = 0;
    const parsePart = async (content, asDocument) => {
      const header = asDocument && plan.header ? plan.header : '';
      const wrapper = asDocument
        ? plan.kmlOpen + plan.docOpen + header + content + (plan.docOpen ? '</Document>' : '') + '</kml>'
        : plan.kmlOpen + content + '</kml>';
      const t0 = perfNow();
      const parsed = parseXml(wrapper);
      const ms = perfNow() - t0;
      state.domMs += ms;
      if (ms > state.domMaxMs) state.domMaxMs = ms;
      const root = parsed.root;
      const styleEls = root.getElementsByTagNameNS
        ? root.getElementsByTagNameNS('*', 'Style')
        : root.getElementsByTagName('Style');
      for (let i = 0; i < styleEls.length; i++) {
        const el = styleEls[i];
        const id = el.getAttribute('id');
        if (id) styles.set(id, parseStyleElement(el));
      }
      return root;
    };
    const walkPart = async (root, asDocument) => {
      const container = asDocument ? firstChild(root, 'Document') || root : root;
      if (!asDocument) {
        const folderEl = container.children && container.children[0];
        if (!folderEl) return;
        const folderName = childText(folderEl, 'name');
        const resolved = resolveStyleUrl(childText(folderEl, 'styleUrl'), styles, styleMaps, 0);
        await walkKmlChildren(folderEl, folderName ? [folderName] : [], resolved, styles, styleMaps, ctx, state, progress, 10, 52);
        return;
      }
      await walkKmlChildren(container, [], null, styles, styleMaps, ctx, state, progress, 10, 52);
    };

    if (progress) progress.report('parse', 8);
    const totalParts = plan.parts.length;
    let finishedParts = 0;
    const reportChunk = () => {
      finishedParts++;
      if (progress) {
        progress.report('parse', 10 + Math.round((finishedParts / Math.max(1, totalParts)) * 52));
      }
    };
    let headerRoot = null;
    let folderPartCount = 0;
    let fastFlat = false;
    if (plan.flat) {
      const fast = await fastParseFlatKml(text, plan, ctx, state, progress);
      if (fast) {
        headerRoot = fast;
        fastFlat = true;
      }
    }
    if (!fastFlat) for (const part of plan.parts) {
      if (part.kind === 'document' && part.end - part.start < 4096 && !text.slice(part.start, part.end).trim()) {
        reportChunk();
        continue;
      }
      const asDocument = part.kind === 'document' || part.kind === 'chunk';
      if (!asDocument) folderPartCount++;
      const root = await parsePart(text.slice(part.start, part.end), asDocument);
      await yieldToMain();
      perfStats.yieldCount++;
      await walkPart(root, asDocument);
      if (asDocument && !headerRoot) headerRoot = root;
      reportChunk();
    }
    perfStats.styleScanMs = 0;
    if (progress) progress.report('parse', 62, { placemarks: state.seen, total: state.total });
    const tFrames = perfNow();
    const frames = await assignFrames(state.placemarks, async (processed, total) => {
      await yieldToMain();
      perfStats.yieldCount++;
      if (progress) {
        progress.report('parse', 62 + Math.round((processed / Math.max(1, total)) * 8), { placemarks: processed, total });
      }
    });
    perfStats.framesMs = Math.round(perfNow() - tFrames);
    const docEl = headerRoot ? firstChild(headerRoot, 'Document') || headerRoot : null;
    const model = {
      name: docEl ? childText(docEl, 'name') || '' : '',
      description: docEl ? childText(docEl, 'description') || '' : '',
      region: docEl ? parseRegion(firstChild(docEl, 'Region')) : null,
      placemarks: state.placemarks,
      overlays: state.overlayEls.map(parseOverlayElement),
      styleCount: styles.size,
      iconStyleCount: state.iconStyleCount,
      frames,
    };
    perfLog('split-parse', {
      chunks: folderPartCount + (headerRoot ? 1 : 0),
      parts: plan.parts.length,
      placemarks: model.placemarks.length,
      frames: frames.length,
      planMs: perfStats.planMs,
      domParseMs: Math.round(state.domMs || 0),
      domMaxMs: Math.round(state.domMaxMs || 0),
      walkPureMs: Math.round(state.pureMs),
      walkYieldMs: Math.round(state.yieldMs),
      fastFlat: fastFlat,
    });
    return model;
  }

  async function parseDocumentModel(text, ctx, progress) {
    const tStart = perfNow();
    await yieldToMain(); // 让首屏/状态栏先绘制
    perfStats.yieldCount++;
    if (progress) progress.report('parse', 1);

    const state = { placemarks: [], overlayEls: [], iconStyleCount: 0, seen: 0, total: 0, pureMs: 0, yieldMs: 0 };
    const tPlan = perfNow();
    const plan = planLargeKmlSplit(text);
    perfStats.planMs = Math.round(perfNow() - tPlan);
    if (plan) {
      try {
        const model = await parseDocumentModelSplit(text, plan, ctx, progress, state);
        perfStats.domParseMs = Math.round(state.domMs || 0);
        perfStats.domMaxMs = Math.round(state.domMaxMs || 0);
        perfStats.walkMs = Math.round(state.pureMs + state.yieldMs);
        perfStats.walkPureMs = Math.round(state.pureMs);
        perfStats.walkYieldMs = Math.round(state.yieldMs);
        perfStats.placemarks = model.placemarks.length;
        perfLog('parse', {
          mode: 'split',
          domParseMs: perfStats.domParseMs,
          styleScanMs: perfStats.styleScanMs,
          walkMs: perfStats.walkMs,
          walkPureMs: perfStats.walkPureMs,
          walkYieldMs: perfStats.walkYieldMs,
          framesMs: perfStats.framesMs,
          styles: model.styleCount,
          placemarks: model.placemarks.length,
          frames: model.frames.length,
          yields: perfStats.yieldCount,
        });
        return model;
      } catch (err) {
        perfLog('split-parse-fallback', { message: String(err && err.message ? err.message : err) });
        state.placemarks.length = 0;
        state.overlayEls.length = 0;
        state.iconStyleCount = 0;
        state.seen = 0;
        state.pureMs = 0;
        state.yieldMs = 0;
      }
    }

    // 整份解析（同步 DOMParser；大文件若无法拆分仍会是一次较长阻塞，见文档限制）
    const tDom = perfNow();
    const parsed = parseXml(text);
    perfStats.domParseMs = Math.round(perfNow() - tDom);
    perfStats.domMaxMs = perfStats.domParseMs;
    const root = parsed.root;
    if (progress) progress.report('parse', 8);
    await yieldToMain();
    perfStats.yieldCount++;

    // 样式表：用原生 getElementsByTagNameNS 精确收集（避免遍历上百万个元素；无 Style 时几乎零成本）
    const styles = new Map();
    const styleMaps = new Map();
    const tStyle = perfNow();
    const styleEls = root.getElementsByTagNameNS
      ? root.getElementsByTagNameNS('*', 'Style')
      : root.getElementsByTagName('Style');
    for (let i = 0; i < styleEls.length; i++) {
      const el = styleEls[i];
      const id = el.getAttribute('id');
      if (id) styles.set(id, parseStyleElement(el));
      if ((i + 1) % 500 === 0) {
        await yieldToMain();
        perfStats.yieldCount++;
      }
    }
    const styleMapEls = root.getElementsByTagNameNS
      ? root.getElementsByTagNameNS('*', 'StyleMap')
      : root.getElementsByTagName('StyleMap');
    for (let i = 0; i < styleMapEls.length; i++) {
      const el = styleMapEls[i];
      const id = el.getAttribute('id');
      if (!id) continue;
      const map = { normal: null, highlight: null };
      for (let j = 0; j < el.children.length; j++) {
        const pair = el.children[j];
        if (pair.localName !== 'Pair') continue;
        const key = childText(pair, 'key') || 'normal';
        const target = childText(pair, 'styleUrl');
        if (target) map[key === 'highlight' ? 'highlight' : 'normal'] = target;
      }
      styleMaps.set(id, map);
      if ((i + 1) % 500 === 0) {
        await yieldToMain();
        perfStats.yieldCount++;
      }
    }
    perfStats.styleScanMs = Math.round(perfNow() - tStyle);
    if (progress) progress.report('parse', 10);
    await yieldToMain();
    perfStats.yieldCount++;

    const documentEl = firstChild(root, 'Document');
    const placemarkEls = root.getElementsByTagNameNS
      ? root.getElementsByTagNameNS('*', 'Placemark')
      : root.getElementsByTagName('Placemark');
    state.total = placemarkEls ? placemarkEls.length : 0;
    const tWalk = perfNow();
    await walkKmlChildren(documentEl || root, [], null, styles, styleMaps, ctx, state, progress, 10, 52);
    perfStats.walkMs = Math.round(perfNow() - tWalk);
    perfStats.walkPureMs = Math.round(state.pureMs);
    perfStats.walkYieldMs = Math.round(state.yieldMs);
    perfStats.placemarks = state.placemarks.length;
    if (progress) progress.report('parse', 62, { placemarks: state.seen, total: state.total });
    await yieldToMain();
    perfStats.yieldCount++;

    const tFrames = perfNow();
    const frames = await assignFrames(state.placemarks, async (processed, total) => {
      await yieldToMain();
      perfStats.yieldCount++;
      if (progress) {
        progress.report('parse', 62 + Math.round((processed / Math.max(1, total)) * 8), { placemarks: processed, total });
      }
    });
    perfStats.framesMs = Math.round(perfNow() - tFrames);
    if (progress) progress.report('parse', 72, { placemarks: state.placemarks.length, total: state.total });
    perfLog('parse', {
      mode: 'full',
      domParseMs: perfStats.domParseMs,
      styleScanMs: perfStats.styleScanMs,
      walkMs: perfStats.walkMs,
      walkPureMs: perfStats.walkPureMs,
      walkYieldMs: perfStats.walkYieldMs,
      framesMs: perfStats.framesMs,
      styles: styles.size,
      placemarks: state.placemarks.length,
      frames: frames.length,
      yields: perfStats.yieldCount,
    });

    return {
      name: childText(documentEl || root, 'name') || childText(root, 'name') || '',
      description: childText(documentEl || root, 'description') || '',
      region: parseRegion((documentEl && firstChild(documentEl, 'Region')) || firstChild(root, 'Region')),
      placemarks: state.placemarks,
      overlays: state.overlayEls.map(parseOverlayElement),
      styleCount: styles.size,
      iconStyleCount: state.iconStyleCount,
      // 时间帧：按 TimeSpan.begin 去重排序；无时间信息时为空数组（不显示时间轴）
      frames,
    };
  }

  function readPlacemark(el, folderPath, inheritedStyle, styles, styleMaps, ctx) {
    const name = childText(el, 'name') || '(未命名地物)';
    const visible = childText(el, 'visibility') !== '0';
    const description = childText(el, 'description');
    const time = parseTimeInterval(el);
    const styleUrl = childText(el, 'styleUrl');
    let style = mergeStyle(inheritedStyle, resolveStyleUrl(styleUrl, styles, styleMaps, 0));
    const inlineStyle = firstChild(el, 'Style');
    if (inlineStyle) style = mergeStyle(style, parseStyleElement(inlineStyle));

    const extended = {};
    const extendedEl = firstChild(el, 'ExtendedData');
    if (extendedEl) {
      for (let i = 0; i < extendedEl.children.length; i++) {
        const child = extendedEl.children[i];
        if (child.localName === 'Data') {
          const key = child.getAttribute('name') || '数据';
          extended[key] = childText(child, 'value') || childText(child, 'displayName');
        } else if (child.localName === 'SchemaData') {
          for (let j = 0; j < child.children.length; j++) {
            const simple = child.children[j];
            if (simple.localName !== 'SimpleData') continue;
            const key = simple.getAttribute('name') || '数据';
            extended[key] = String(simple.textContent || '').trim();
          }
        }
      }
    }

    const geometries = [];
    for (let i = 0; i < el.children.length; i++) collectGeometries(el.children[i], geometries, ctx);
    if (!visible) return { name, visible: false, description, time, style, extended, folderPath, geometries };
    if (!geometries.length) ctx.count('skippedPlacemark');

    return { name, visible: true, description, time, style, extended, folderPath, geometries };
  }

  function parseOverlayElement(el) {
    const color = parseKmlColorParts(childText(el, 'color'));
    const size = parseXyElement(firstChild(el, 'size'));
    return {
      name: childText(el, 'name') || '图例',
      visible: childText(el, 'visibility') !== '0',
      color: color || { a: 255, r: 255, g: 255, b: 255 },
      href: (function () {
        const icon = firstChild(el, 'Icon');
        return icon ? childText(icon, 'href') : childText(el, 'href');
      })(),
      overlayXY: parseXyElement(firstChild(el, 'overlayXY')),
      screenXY: parseXyElement(firstChild(el, 'screenXY')),
      rotationXY: parseXyElement(firstChild(el, 'rotationXY')),
      size: size || { x: 0, y: 0, xunits: 'fraction', yunits: 'fraction' },
      rotation: toNumber(childText(el, 'rotation'), 0),
    };
  }

  function parseXyElement(el) {
    if (!el) return null;
    return {
      x: toNumber(el.getAttribute('x'), 0),
      y: toNumber(el.getAttribute('y'), 0),
      xunits: el.getAttribute('xunits') || 'fraction',
      yunits: el.getAttribute('yunits') || 'fraction',
    };
  }

  /* ------------------------------ 实体构建 ------------------------------ */

  function lineColorOf(style) {
    return (style && style.line && style.line.color) || C.Color.WHITE;
  }

  function lineWidthOf(style) {
    const width = style && style.line && isFinite(style.line.width) ? style.line.width : 1;
    return Math.max(config.minLineWidth, width);
  }

  function buildDescription(placemark, geometry, ctx) {
    const rows = [];
    rows.push('<div><b>' + escapeHtml(placemark.name) + '</b></div>');
    if (placemark.folderPath && placemark.folderPath.length) {
      rows.push('<div>目录：' + escapeHtml(placemark.folderPath.join(' / ')) + '</div>');
    }
    if (placemark.description) {
      const text = stripTags(placemark.description);
      if (text) rows.push('<div>' + escapeHtml(text.slice(0, 220)) + (text.length > 220 ? '…' : '') + '</div>');
    }
    const extendedKeys = Object.keys(placemark.extended || {});
    for (let i = 0; i < extendedKeys.length && i < 8; i++) {
      rows.push('<div>' + escapeHtml(extendedKeys[i]) + '：' + escapeHtml(placemark.extended[extendedKeys[i]]) + '</div>');
    }
    if (geometry) {
      const modeLabel = geometry.altitudeMode === 'relativeToGround'
        ? 'relativeToGround（渲染抬升至 ≥' + config.relativeGroundMinHeight + ' m）'
        : geometry.altitudeMode;
      rows.push('<div>高程模式：' + escapeHtml(modeLabel) + '</div>');
    }
    return rows.join('');
  }

  function addPolyline(ds, placemark, geometry, bounds, ctx) {
    const coords = geometry.coords;
    if (coords.length < 2) return 0;
    const clampToGround = geometry.altitudeMode === 'clampToGround' && !config.clampToGroundAsHeight;
    // clampToGround 默认走相对地面抬升，保证在椭球地形上也可见（详见 config 注释）
    const altitudeMode = geometry.altitudeMode === 'clampToGround' && config.clampToGroundAsHeight
      ? 'relativeToGround'
      : geometry.altitudeMode;
    const positions = positionsFor(coords, altitudeMode);
    const color = lineColorOf(placemark.style).withAlpha(0.95);
    // 线宽随相机高度缩放：近景 1px（接近 Google Earth），远景加粗避免消失
    const widthValue = lineWidthOf(placemark.style);
    const width = new C.CallbackProperty(function () {
      let h = 1e5;
      try {
        const v = window.LE && window.LE.viewer;
        if (v && v.camera && v.camera.positionCartographic) h = v.camera.positionCartographic.height;
      } catch (err) { /* ignore */ }
      const scale = h > 2e5 ? 2.2 : h > 5e4 ? 1.6 : h > 1e4 ? 1.15 : 1.0;
      return Math.max(0.8, widthValue * scale);
    }, false);
    if (geometry.extrude) ctx.count('extrude');

    const midpoint = positions[Math.floor(positions.length / 2)];
    // 关键：positions 用 CallbackProperty 让 PolylineGeometryUpdater 走“动态”分支。
    // 静态分支会把全部折线合并成一个异步 Primitive（Web Worker 创建几何），在本环境
    // （48 逻辑核、47 个 createGeometry worker）里实例数 > 32 时 worker 永不返回，
    // 折线永远不 ready（这正是 Cesium KmlDataSource 加载风场却不显示的原因）。
    // 动态分支用同步的 PolylineCollection 渲染，无 Worker、无异步几何，稳定可见。
    const positionsValue = positions;
    const positionsProperty = new C.CallbackProperty(function () {
      return positionsValue;
    }, false);
    const entity = ds.entities.add({
      name: placemark.name,
      description: buildDescription(placemark, geometry, ctx),
      position: midpoint, // 供搜索索引/缩放使用（polyline 自身位置仍由 positions 决定）
      polyline: {
        positions: positionsProperty,
        width,
        material: color,
        clampToGround,
        // 动态分支每帧会对 GEODESIC 做测地线加密（1479 条 × 5 点，开销大）；
        // KML 线段本身是经纬度线性插值，NONE 更贴近语义且避免逐帧重算。
        // 仅真正走 clampToGround 时必须用 GEODESIC（GroundPolylineGeometry 不支持 NONE）。
        arcType: clampToGround ? C.ArcType.GEODESIC : C.ArcType.NONE,
      },
    });
    entity.LEKml = {
      folder: (placemark.folderPath || []).join(' / '),
      altitudeMode: geometry.altitudeMode,
      effectiveAltitudeMode: altitudeMode,
      extendedData: placemark.extended,
      source: 'LEKml',
      dynamicPolyline: true,
      kind: 'line',
      coords,
    };
    addBounds(bounds, coords);
    return entity;
  }

  function addPolygon(ds, placemark, geometry, bounds, ctx) {
    const rings = geometry.rings;
    if (!rings.length || rings[0].length < 3) return 0;
    const clamp = geometry.altitudeMode === 'clampToGround' && !config.clampToGroundAsHeight;
    const outer = clamp
      ? rings[0].map((p) => C.Cartesian3.fromDegrees(p.lon, p.lat))
      : positionsFor(rings[0], geometry.altitudeMode);
    const holes = [];
    for (let i = 1; i < rings.length; i++) {
      holes.push(
        clamp
          ? rings[i].map((p) => C.Cartesian3.fromDegrees(p.lon, p.lat))
          : positionsFor(rings[i], geometry.altitudeMode)
      );
    }
    const polyStyle = placemark.style && placemark.style.poly;
    const lineStyle = placemark.style && placemark.style.line;
    const fillColor = (polyStyle && polyStyle.color) || C.Color.WHITE.withAlpha(0.5);
    const outlineColor = (lineStyle && lineStyle.color) || fillColor;
    const entity = ds.entities.add({
      name: placemark.name,
      description: buildDescription(placemark, geometry, ctx),
      polygon: {
        hierarchy: new C.PolygonHierarchy(outer, holes),
        material: fillColor,
        perPositionHeight: !clamp,
        // 避免 Cesium 默认 RHUMB 细分在大面（国家/区域轮廓）上算出非法数组而中断渲染
        arcType: C.ArcType.GEODESIC,
        outline: polyStyle ? polyStyle.outline : true,
        outlineColor,
        outlineWidth: Math.max(config.minLineWidth, lineStyle && lineStyle.width ? lineStyle.width : 1),
      },
    });
    entity.LEKml = {
      folder: (placemark.folderPath || []).join(' / '),
      altitudeMode: geometry.altitudeMode,
      extendedData: placemark.extended,
      source: 'LEKml',
      kind: 'polygon',
      rings,
    };
    for (const ring of rings) addBounds(bounds, ring);
    return entity;
  }

  /** 无 IconStyle 的点标记：静态文件沿用白点，动画文件用更小的中性色点（避免“白点网格”）。 */
  function addPlainPoint(ds, placemark, geometry, bounds, ctx, renderCtx) {
    const point = geometry.coords[0];
    if (!point) return null;
    const useTerrain = terrainEnabled();
    const clamp = geometry.altitudeMode === 'clampToGround' && !useTerrain;
    const height = useTerrain
      ? heightFor(point, geometry.altitudeMode)
      : clamp
        ? 0
        : heightFor(point, geometry.altitudeMode);
    const position = C.Cartesian3.fromDegrees(point.lon, point.lat, height);
    const animated = !!(renderCtx && renderCtx.animated);
    const color = animated
      ? C.Color.fromCssColorString('#8fd7ff').withAlpha(0.85)
      : ((placemark.style && placemark.style.line && placemark.style.line.color) || C.Color.WHITE);
    const pixelSize = animated ? 4 : Math.max(7, Math.round(8 * (renderCtx && renderCtx.pointScale ? renderCtx.pointScale : 1)));
    const entity = ds.entities.add({
      name: placemark.name,
      description: buildDescription(placemark, geometry, ctx),
      position,
      point: {
        pixelSize,
        color,
        outlineColor: animated ? C.Color.TRANSPARENT : C.Color.BLACK.withAlpha(0.85),
        outlineWidth: animated ? 0 : 1,
        heightReference: clamp ? C.HeightReference.CLAMP_TO_GROUND : C.HeightReference.NONE,
      },
    });
    entity.LEKml = {
      folder: (placemark.folderPath || []).join(' / '),
      altitudeMode: geometry.altitudeMode,
      extendedData: placemark.extended,
      source: 'LEKml',
      kind: 'point',
      point,
      clamp,
    };
    addBounds(bounds, [point]);
    return entity;
  }

  /**
   * Point + IconStyle → Cesium Billboard。
   * - 图标：KMZ 内相对路径优先；外部 http(s)/data 图标绝不联网，统一使用内置白色箭头 sprite。
   * - 颜色：KML aabbggrr → billboard.color（tint，含 alpha）。
   * - 朝向：KML heading 为“从北顺时针”，Cesium billboard.rotation 为“逆时针弧度”，故取负。
   * - 大小：iconBasePixels × scale → 像素，再按贴图原始宽度换算 billboard.scale。
   */
  function addIconPoint(ds, placemark, geometry, bounds, ctx, renderCtx) {
    const point = geometry.coords[0];
    if (!point) return null;
    const iconStyle = (placemark.style && placemark.style.icon) || null;
    const plan = renderCtx && renderCtx.iconPlan;
    const sprite = plan && plan.sprite ? plan.sprite : { url: null, width: 48, height: 48 };
    const icon = plan ? plan.resolve(iconStyle.iconHref) : null;
    const image = (icon && icon.url) || sprite.url;
    if (!image) return addPlainPoint(ds, placemark, geometry, bounds, ctx, renderCtx);

    const useTerrain = terrainEnabled();
    const clamp = geometry.altitudeMode === 'clampToGround' && !useTerrain;
    const height = useTerrain
      ? heightFor(point, geometry.altitudeMode)
      : clamp
        ? 0
        : heightFor(point, geometry.altitudeMode);
    const position = C.Cartesian3.fromDegrees(point.lon, point.lat, height);

    const scaleKml = isFinite(iconStyle.scale) && iconStyle.scale > 0 ? iconStyle.scale : 1;
    const desiredPixels = Math.max(
      config.iconMinPixels,
      Math.min(config.iconMaxPixels, config.iconBasePixels * scaleKml)
    );
    const textureWidth = (icon && icon.width) || sprite.width || config.iconBasePixels;
    const billboardScale = textureWidth > 0 ? desiredPixels / textureWidth : scaleKml;
    const color = iconStyle.color || C.Color.WHITE;
    const heading = isFinite(iconStyle.heading) ? iconStyle.heading : 0;

    const entity = ds.entities.add({
      name: placemark.name,
      description: buildDescription(placemark, geometry, ctx),
      position,
      billboard: {
        image,
        color,
        // KML：顺时针从北；Cesium：逆时针弧度 → 取负
        rotation: C.Math.toRadians(-heading),
        scale: billboardScale,
        verticalOrigin: C.VerticalOrigin.CENTER,
        horizontalOrigin: C.HorizontalOrigin.CENTER,
        heightReference: clamp ? C.HeightReference.CLAMP_TO_GROUND : C.HeightReference.NONE,
      },
    });
    entity.LEKml = {
      folder: (placemark.folderPath || []).join(' / '),
      altitudeMode: geometry.altitudeMode,
      extendedData: placemark.extended,
      source: 'LEKml',
      kind: 'billboard',
      point,
      clamp,
      heading,
      iconFromZip: !!(icon && icon.fromZip),
      iconExternalReplaced: !!(iconStyle.iconHref && !(icon && icon.url)),
    };
    addBounds(bounds, [point]);
    return entity;
  }

  function addPoint(ds, placemark, geometry, bounds, ctx, renderCtx) {
    const iconStyle = placemark.style && placemark.style.icon;
    if (iconStyle) return addIconPoint(ds, placemark, geometry, bounds, ctx, renderCtx || {});
    return addPlainPoint(ds, placemark, geometry, bounds, ctx, renderCtx || {});
  }

  function addGeometryEntity(ds, placemark, geometry, bounds, ctx, renderCtx) {
    if (geometry.type === 'line') return addPolyline(ds, placemark, geometry, bounds, ctx);
    if (geometry.type === 'polygon') return addPolygon(ds, placemark, geometry, bounds, ctx);
    if (geometry.type === 'point') return addPoint(ds, placemark, geometry, bounds, ctx, renderCtx);
    return null;
  }

  function addBounds(bounds, coords) {
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (c.lon < bounds.west) bounds.west = c.lon;
      if (c.lon > bounds.east) bounds.east = c.lon;
      if (c.lat < bounds.south) bounds.south = c.lat;
      if (c.lat > bounds.north) bounds.north = c.lat;
      bounds.has = true;
    }
  }

  /* ------------------------------ 屏幕叠加层 ------------------------------ */

  function mimeOfName(name) {
    const ext = extOf(name);
    if (ext === 'bmp' || ext === 'dib') return 'image/bmp';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'svg') return 'image/svg+xml';
    return 'application/octet-stream';
  }

  function normalizeOverlayHref(href) {
    let h = String(href || '').trim();
    if (!h) return '';
    h = h.split('?')[0].split('#')[0].replace(/\\/g, '/');
    if (/^\.\//.test(h)) h = h.slice(2);
    h = h.replace(/^\/+/, '');
    try {
      h = decodeURIComponent(h);
    } catch (_) {
      /* 保留原始字符串 */
    }
    return h;
  }

  function createMediaResolver(zip, input, ctx) {
    const byName = new Map();
    if (zip) {
      for (const entry of zip.entries) {
        byName.set(normalizeOverlayHref(entry.name).toLowerCase(), entry);
      }
    }
    return async function resolve(href) {
      if (!href) return null;
      const raw = String(href).trim();
      if (!raw) return null;
      if (/^data:/i.test(raw)) {
        const parsed = parseDataUrl(raw);
        if (parsed) return parsed;
        ctx.warn('无法解析 data: 图例：' + raw.slice(0, 60));
        return null;
      }
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
        ctx.warn('已阻止外部网络图例（离线模式不访问网络）：' + raw);
        return null;
      }
      const normalized = normalizeOverlayHref(raw);
      if (zip) {
        let entry = byName.get(normalized.toLowerCase());
        if (!entry) entry = byName.get(basename(normalized).toLowerCase());
        if (entry) {
          try {
            const bytes = await extractZipEntry(zip.bytes, entry);
            return { bytes, mime: mimeOfName(entry.name) };
          } catch (err) {
            ctx.warn('读取 KMZ 内图例失败：' + entry.name + '（' + (err && err.message) + '）');
            return null;
          }
        }
      }
      if (input && input.url) {
        // 同源相对路径（例如直接加载 .kml 时旁边的图例）允许读取；跨域一律拒绝
        try {
          const url = new URL(raw, input.url);
          if (url.origin === location.origin && /^https?:$/.test(url.protocol)) {
            const response = await fetch(url.href, { credentials: 'same-origin' });
            if (response.ok) {
              return {
                bytes: new Uint8Array(await response.arrayBuffer()),
                mime: response.headers.get('content-type') || mimeOfName(url.pathname),
              };
            }
            ctx.warn('读取图例失败：HTTP ' + response.status + '（' + url.href + '）');
            return null;
          }
          ctx.warn('已阻止跨域图例（离线模式不访问网络）：' + raw);
        } catch (err) {
          ctx.warn('无法解析图例路径：' + raw);
        }
        return null;
      }
      ctx.warn('KML 为本地文件，无法读取相对路径图例（请使用 KMZ）：' + raw);
      return null;
    };
  }

  function parseDataUrl(raw) {
    const match = /^data:([^;,]*)(;base64)?,(.*)$/i.exec(raw);
    if (!match) return null;
    const mime = match[1] || 'application/octet-stream';
    const isBase64 = !!match[2];
    try {
      if (isBase64) {
        const binary = atob(match[3]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return { bytes, mime };
      }
      return { bytes: new TextEncoder().encode(decodeURIComponent(match[3])), mime };
    } catch (_) {
      return null;
    }
  }

  function layoutOverlayItem(item, W, H) {
    const img = item.img;
    const descriptor = item.overlay;
    const naturalWidth = img.naturalWidth || 0;
    const naturalHeight = img.naturalHeight || 0;
    if (!naturalWidth || !naturalHeight) return;

    const size = descriptor.size || {};
    let width = 0;
    let height = 0;
    if (size.xunits === 'pixels' && size.x > 0) width = size.x;
    else if (size.xunits !== 'pixels' && size.x > 0) width = size.x * W;
    if (size.yunits === 'pixels' && size.y > 0) height = size.y;
    else if (size.yunits !== 'pixels' && size.y > 0) height = size.y * H;
    if (width > 0 && height <= 0) height = (width * naturalHeight) / naturalWidth;
    if (height > 0 && width <= 0) width = (height * naturalWidth) / naturalHeight;
    if (width <= 0 && height <= 0) {
      width = naturalWidth;
      height = naturalHeight;
    }

    const overlayXY = descriptor.overlayXY || { x: 0, y: 0, xunits: 'fraction' };
    const screenXY = descriptor.screenXY || { x: 0, y: 0, xunits: 'fraction' };
    const anchorX = overlayXY.xunits === 'pixels' ? overlayXY.x : overlayXY.x * width;
    // KML 的 y 轴从下往上；overlayXY 的像素值相对图像，screenXY 的像素值相对视口
    const anchorY = overlayXY.yunits === 'pixels' ? height - overlayXY.y : (1 - overlayXY.y) * height;
    const screenX = screenXY.xunits === 'pixels' ? screenXY.x : screenXY.x * W;
    const screenY = screenXY.yunits === 'pixels' ? H - screenXY.y : (1 - screenXY.y) * H;

    img.style.width = width + 'px';
    img.style.height = height + 'px';
    img.style.left = Math.round(screenX - anchorX) + 'px';
    img.style.top = Math.round(screenY - anchorY) + 'px';

    const rotation = descriptor.rotation || 0;
    const rotationXY = descriptor.rotationXY || { x: 0, y: 0 };
    if (rotation) {
      const rx = rotationXY.xunits === 'pixels' ? (width ? rotationXY.x / width : 0) : rotationXY.x;
      const ry = rotationXY.yunits === 'pixels' ? (height ? (H - rotationXY.y) / height : 0) : 1 - rotationXY.y;
      img.style.transformOrigin = rx * 100 + '% ' + ry * 100 + '%';
      img.style.transform = 'rotate(' + -rotation + 'deg)';
    }
  }

  function buildOverlayLayer(le, overlays, mediaResolver, ctx, docName) {
    if (!overlays || !overlays.length) return null;
    const host = document.getElementById('viewer') || le.viewer.container || le.viewer.scene.canvas.parentElement;
    if (!host) {
      ctx.warn('未找到 #viewer，无法显示 KML 屏幕图例');
      return null;
    }
    const container = document.createElement('div');
    container.className = 'kml-overlays';
    container.setAttribute('data-kml', docName || '');
    container.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5;';
    host.appendChild(container);

    const items = [];
    const blobUrls = [];
    let pending = 0;
    let anyLoaded = false;

    for (const overlay of overlays) {
      if (!overlay.visible) continue;
      pending++;
      mediaResolver(overlay.href)
        .then((media) => {
          pending--;
          if (!media || !media.bytes || !media.bytes.byteLength) {
            ctx.warn('图例未能读取，已跳过：' + (overlay.name || overlay.href));
            return;
          }
          const blob = new Blob([media.bytes], { type: media.mime || 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          blobUrls.push(url);
          const img = document.createElement('img');
          img.alt = overlay.name || '';
          img.draggable = false;
          img.style.cssText = 'position:absolute;left:0;top:0;user-select:none;';
          const alpha = overlay.color && isFinite(overlay.color.a) ? overlay.color.a / 255 : 1;
          img.style.opacity = String(Math.max(0, Math.min(1, alpha)));
          img.addEventListener('error', () => {
            ctx.warn('浏览器无法解码图例图像（' + (media.mime || '未知') + '）：' + (overlay.name || overlay.href));
            img.style.display = 'none';
          });
          img.addEventListener('load', relayout);
          img.src = url;
          container.appendChild(img);
          items.push({ img, overlay });
          anyLoaded = true;
          layout();
        })
        .catch((err) => {
          pending--;
          ctx.warn('图例加载失败：' + (overlay.name || overlay.href) + '（' + (err && err.message) + '）');
        });
    }

    let raf = 0;
    function layout() {
      const width = container.clientWidth || host.clientWidth || 1;
      const height = container.clientHeight || host.clientHeight || 1;
      for (const item of items) layoutOverlayItem(item, width, height);
    }
    function relayout() {
      if (!container.isConnected) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        layout();
      });
    }
    window.addEventListener('resize', relayout);
    layout();

    // 异步读取完成后如果一张图都没成功（全部失败），移除空容器
    setTimeout(() => {
      if (!pending && !anyLoaded && container.isConnected) {
        container.remove();
      }
    }, 5000);

    return {
      container,
      disposed: false,
      get count() {
        return items.length;
      },
      setVisible(visible) {
        container.style.display = visible ? '' : 'none';
      },
      dispose() {
        if (this.disposed) return;
        this.disposed = true;
        window.removeEventListener('resize', relayout);
        if (raf) cancelAnimationFrame(raf);
        for (const item of items) {
          if (item.img.parentNode) item.img.parentNode.removeChild(item.img);
        }
        for (const url of blobUrls) URL.revokeObjectURL(url);
        if (container.parentNode) container.parentNode.removeChild(container);
      },
    };
  }

  /* --------------------------- 图标：离线箭头 sprite / KMZ 内图标 --------------------------- */

  const ICON_SPRITE_SIZE = 48;
  let iconSpriteUrl = null;

  /**
   * 内置箭头 sprite（指向屏幕上方 = 北）。白色填充 + 半透明深色描边，
   * 便于用 Cesium billboard.color 按 KML <color> 着色；不访问任何外部图标。
   */
  function arrowSpriteDataUrl() {
    if (iconSpriteUrl) return iconSpriteUrl;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = ICON_SPRITE_SIZE;
      canvas.height = ICON_SPRITE_SIZE;
      const g = canvas.getContext('2d');
      if (!g) throw new Error('canvas 2d 不可用');
      g.clearRect(0, 0, ICON_SPRITE_SIZE, ICON_SPRITE_SIZE);
      g.beginPath();
      g.moveTo(24, 2);
      g.lineTo(43, 19);
      g.lineTo(30, 19);
      g.lineTo(30, 46);
      g.lineTo(18, 46);
      g.lineTo(18, 19);
      g.lineTo(5, 19);
      g.closePath();
      g.fillStyle = '#ffffff';
      g.fill();
      g.lineWidth = 2.5;
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.stroke();
      iconSpriteUrl = canvas.toDataURL('image/png');
      return iconSpriteUrl;
    } catch (err) {
      // Canvas 不可用时退回等价 SVG data URL（同样指向上/北）
      iconSpriteUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
        '<path d="M24 2 L43 19 L30 19 L30 46 L18 46 L18 19 L5 19 Z" fill="#ffffff" ' +
        'stroke="rgba(0,0,0,0.55)" stroke-width="2.5" stroke-linejoin="round"/></svg>'
      );
      return iconSpriteUrl;
    }
  }

  function blobUrlFromBytes(bytes, mime) {
    if (!bytes || !bytes.byteLength) return null;
    return URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
  }

  function imageSizeOf(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
        } else {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  /**
   * 预解析所有 Point+IconStyle 的图标：
   * - data: URL / KMZ 内相对路径 / 同源相对路径 → 本地图片（Blob URL）；
   * - extern http(s)（如 maps.google.com）→ 不发起请求，由调用方回退内置箭头；
   * - 解析失败 → 回退内置箭头。
   */
  async function buildIconPlan(model, zip, source, ctx) {
    const sprite = { url: arrowSpriteDataUrl(), width: ICON_SPRITE_SIZE, height: ICON_SPRITE_SIZE };
    const cache = new Map();
    const createdUrls = [];
    const hrefs = new Set();

    // 快速路径：没有 Point+IconStyle（例如纯点云 timeline）时跳过 13 万次 Placemark 遍历
    if (model.iconStyleCount) {
      let processed = 0;
      for (const placemark of model.placemarks) {
        if (!placemark.visible) continue;
        const iconStyle = placemark.style && placemark.style.icon;
        if (!iconStyle) continue;
        if (!placemark.geometries.some((geometry) => geometry.type === 'point')) continue;
        const href = String(iconStyle.iconHref || '').trim();
        if (href) hrefs.add(href);
        processed++;
        if ((processed % 20000) === 0) {
          await yieldToMain();
          perfStats.yieldCount++;
        }
      }
    }

    let zipIndex = null;
    if (zip) {
      zipIndex = new Map();
      for (const entry of zip.entries) {
        zipIndex.set(normalizeOverlayHref(entry.name).toLowerCase(), entry);
      }
      for (const entry of zip.entries) {
        const base = basename(normalizeOverlayHref(entry.name)).toLowerCase();
        if (!zipIndex.has(base)) zipIndex.set(base, entry);
      }
    }

    async function resolveOne(href) {
      if (/^data:/i.test(href)) {
        const parsed = parseDataUrl(href);
        if (!parsed || !parsed.bytes || !parsed.bytes.byteLength) return null;
        const url = blobUrlFromBytes(parsed.bytes, parsed.mime);
        const size = await imageSizeOf(url);
        if (!size) {
          URL.revokeObjectURL(url);
          return null;
        }
        return { url, width: size.width, height: size.height, fromZip: false, created: true };
      }
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
        // http(s) 等外部协议：离线模式直接忽略，绝不联网
        return { external: true };
      }
      const normalized = normalizeOverlayHref(href);
      if (zipIndex) {
        let entry = zipIndex.get(normalized.toLowerCase());
        if (!entry) entry = zipIndex.get(basename(normalized).toLowerCase());
        if (entry) {
          const bytes = await extractZipEntry(zip.bytes, entry);
          const url = blobUrlFromBytes(bytes, mimeOfName(entry.name));
          const size = await imageSizeOf(url);
          if (!size) {
            URL.revokeObjectURL(url);
            return null;
          }
          return { url, width: size.width, height: size.height, fromZip: true, created: true };
        }
      }
      if (source && source.url) {
        try {
          const url = new URL(href, source.url);
          if (url.origin === location.origin && /^https?:$/.test(url.protocol)) {
            const response = await fetch(url.href, { credentials: 'same-origin' });
            if (response.ok) {
              const bytes = new Uint8Array(await response.arrayBuffer());
              const blobUrl = blobUrlFromBytes(bytes, response.headers.get('content-type') || mimeOfName(url.pathname));
              const size = await imageSizeOf(blobUrl);
              if (size) return { url: blobUrl, width: size.width, height: size.height, fromZip: false, created: true };
              URL.revokeObjectURL(blobUrl);
            }
          }
        } catch (err) {
          /* 同源读取失败 → 回退 sprite */
        }
      }
      return null;
    }

    let externalCount = 0;
    let unresolvedCount = 0;
    let resolvedCount = 0;
    for (const href of hrefs) {
      let resolved = null;
      try {
        resolved = await resolveOne(href);
      } catch (err) {
        resolved = null;
      }
      if (resolved && resolved.url) {
        if (resolved.created) createdUrls.push(resolved.url);
        cache.set(href, resolved);
      } else if (resolved && resolved.external) {
        externalCount++;
      } else {
        unresolvedCount++;
      }
      resolvedCount++;
      if (resolvedCount % 8 === 0) {
        await yieldToMain();
        perfStats.yieldCount++;
      }
    }
    if (externalCount) {
      ctx.warn('已用内置箭头替代 ' + externalCount + ' 类外部图标 href（离线模式，不访问网络）');
    }
    if (unresolvedCount) {
      ctx.warn('有 ' + unresolvedCount + ' 类图标无法从本地读取，已用内置箭头替代');
    }

    return {
      sprite,
      externalCount,
      unresolvedCount,
      resolve(href) {
        const key = String(href || '').trim();
        return (key && cache.get(key)) || null;
      },
      dispose() {
        for (const url of createdUrls) {
          try {
            URL.revokeObjectURL(url);
          } catch (err) {
            /* ignore */
          }
        }
        createdUrls.length = 0;
        cache.clear();
      },
    };
  }

  /* ------------------------------ 图例（HTML 覆盖层） ------------------------------ */

  function colorKeyOf(color) {
    return [
      Math.round(color.red * 255),
      Math.round(color.green * 255),
      Math.round(color.blue * 255),
      Math.round(color.alpha * 255),
    ].join(',');
  }

  function colorCssOf(color) {
    const r = Math.round(color.red * 255);
    const g = Math.round(color.green * 255);
    const b = Math.round(color.blue * 255);
    const a = isFinite(color.alpha) ? Math.round(color.alpha * 100) / 100 : 1;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function fmtSpeed(v) {
    return (isFinite(v) ? Math.round(v * 10) / 10 : 0).toFixed(1);
  }

  /** 从 name / description / ExtendedData 里提取风速（m/s）。 */
  function speedOfPlacemark(placemark) {
    const texts = [];
    if (placemark.name) texts.push(String(placemark.name));
    if (placemark.description) texts.push(stripTags(placemark.description));
    const extended = placemark.extended || {};
    for (const key of Object.keys(extended)) {
      if (/speed|风速/i.test(key)) texts.push(String(extended[key]));
    }
    for (const text of texts) {
      const match = /(\d+(?:\.\d+)?)\s*(?:m\/s|m·s|米\/秒|米每秒)/i.exec(text);
      if (match) {
        const value = parseFloat(match[1]);
        if (isFinite(value)) return value;
      }
    }
    return null;
  }

  /** 按 IconStyle 颜色聚合风速区间；没有风速信息时按颜色分组标注“分级”。 */
  function buildLegendItems(model) {
    const map = new Map();
    // 快速路径：没有 IconStyle（如点云 timeline）时无需遍历全部 Placemark
    if (!model.iconStyleCount) return { items: [], hasSpeed: false };
    for (const placemark of model.placemarks) {
      if (!placemark.visible) continue;
      const iconStyle = placemark.style && placemark.style.icon;
      if (!iconStyle || !iconStyle.color) continue;
      if (!placemark.geometries.some((geometry) => geometry.type === 'point')) continue;
      const key = colorKeyOf(iconStyle.color);
      let item = map.get(key);
      if (!item) {
        item = { key, color: iconStyle.color, count: 0, speedCount: 0, min: Infinity, max: -Infinity };
        map.set(key, item);
      }
      item.count++;
      const speed = speedOfPlacemark(placemark);
      if (speed != null) {
        item.speedCount++;
        if (speed < item.min) item.min = speed;
        if (speed > item.max) item.max = speed;
      }
    }
    const all = Array.from(map.values());
    const withSpeed = all.filter((item) => item.speedCount > 0).sort((a, b) => a.min - b.min || a.max - b.max);
    const noSpeed = all.filter((item) => item.speedCount === 0).sort((a, b) => b.count - a.count);
    let previousMax = null;
    for (const item of withSpeed) {
      let low = item.min;
      if (previousMax != null) low = Math.min(item.max, Math.max(item.min, previousMax));
      item.low = low;
      item.rangeText = fmtSpeed(low) + '–' + fmtSpeed(item.max) + ' m/s';
      previousMax = item.max;
    }
    noSpeed.forEach((item, index) => {
      item.rangeText = '分级 ' + (index + 1);
    });
    return { items: withSpeed.concat(noSpeed), hasSpeed: withSpeed.length > 0 };
  }

  function buildLegendLayer(le, legend, frames, ctx, docName) {
    if (!legend || !legend.items.length) return null;
    const host = document.getElementById('viewer') || (le.viewer && le.viewer.container) || null;
    if (!host) {
      ctx.warn('未找到 #viewer，无法显示图例');
      return null;
    }
    const container = document.createElement('div');
    container.className = 'kml-legend';
    container.setAttribute('data-kml', docName || '');
    const rows = legend.items
      .map((item) => (
        '<li><span class="kml-legend-arrow" style="background-color:' + colorCssOf(item.color) + '"></span>' +
        '<span class="kml-legend-range">' + escapeHtml(item.rangeText) + '</span>' +
        '<span class="kml-legend-count" title="该颜色地物数量">' + item.count + '</span></li>'
      ))
      .join('');
    const subtitle = frames && frames.length > 1 ? String(frames.length) + ' 帧' : '';
    container.innerHTML =
      '<div class="kml-legend-head"><span class="kml-legend-title">' +
      (legend.hasSpeed ? '风速图例 (m/s)' : '风速分级图例') +
      '</span>' +
      (subtitle ? '<span class="kml-legend-sub">' + escapeHtml(subtitle) + '</span>' : '') +
      '</div><ul>' + rows + '</ul>';
    host.appendChild(container);
    return {
      container,
      get count() {
        return legend.items.length;
      },
      /** 性能模式提示（点云降采样时在图例内注明；无图例时由右上角 badge 提示）。 */
      setQualityNote(text) {
        let note = container.querySelector('.kml-legend-quality');
        if (!text) {
          if (note) note.parentNode.removeChild(note);
          return;
        }
        if (!note) {
          note = document.createElement('div');
          note.className = 'kml-legend-quality';
          note.style.cssText =
            'margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.14);' +
            'color:#bfe3ff;font-size:11px;line-height:1.4;';
          container.appendChild(note);
        }
        note.textContent = text;
      },
      setVisible(visible) {
        container.style.display = visible ? '' : 'none';
      },
      dispose() {
        if (container.parentNode) container.parentNode.removeChild(container);
      },
    };
  }

  /* --------------------- 时间轴控制器（DOM 与播放由 js/ui.js 绑定） --------------------- */

  function dispatchTimeline(action, controller) {
    try {
      document.dispatchEvent(new CustomEvent('lekml-timeline', { detail: { action, controller } }));
    } catch (err) {
      /* 事件派发失败不影响渲染 */
    }
  }

  /**
   * 超大动画的“点云”播放器：用一个 Cesium.PointPrimitiveCollection 原地改 position，
   * 避免每帧创建/销毁上万 Entity（实测会把主线程卡死几十秒）。
   * 仅用于“全部是无 IconStyle 的 Point”的动画文件（如 wind_animation_timeline.kmz）。
   *
   * 性能模式：qualityState.pointSubsample（1/2/4）按步长抽稀显示；切换时只更新 position / show，
   * 复用同一个 PointPrimitiveCollection（多余点用 show=false 隐藏，不逐点 remove 重建）。
   */
  function createPointFrameAnimation(le, frames, frameGroups) {
    const collection = new C.PointPrimitiveCollection();
    const color = C.Color.fromCssColorString('#8fd7ff').withAlpha(0.9);
    // 帧位置缓存（LRU，避免 13 帧 × 1 万点无限占内存）
    const cache = new Map();
    const cacheLimit = Math.max(1, Number(config.pointCloudCacheFrames) || 4);
    let poolSize = 0; // 已创建的 PointPrimitive 数量（只增不减，复用）
    let visibleCount = 0;
    let sourceCount = 0;
    let currentFrame = -1;

    function cacheGet(index) {
      const positions = cache.get(index);
      if (positions) {
        cache.delete(index);
        cache.set(index, positions);
      }
      return positions || null;
    }

    function cacheSet(index, positions) {
      cache.delete(index);
      cache.set(index, positions);
      while (cache.size > cacheLimit) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
      }
    }

    function positionsOf(index) {
      const cached = cacheGet(index);
      if (cached) return cached;
      const group = frameGroups[index] || [];
      const positions = [];
      for (const placemark of group) {
        for (const geometry of placemark.geometries) {
          if (geometry.type !== 'point' || !geometry.coords.length) continue;
          const point = geometry.coords[0];
          positions.push(C.Cartesian3.fromDegrees(point.lon, point.lat, heightFor(point, geometry.altitudeMode)));
        }
      }
      cacheSet(index, positions);
      return positions;
    }

    function ensurePool(count) {
      while (poolSize < count) {
        collection.add(new C.PointPrimitive({ pixelSize: 4, color, outlineWidth: 0, show: false }));
        poolSize++;
      }
    }

    function sync(positions) {
      const stride = qualityState.pointSubsample;
      const wanted = Math.ceil(positions.length / stride);
      ensurePool(wanted);
      for (let i = 0; i < poolSize; i++) {
        const primitive = collection.get(i);
        if (i < wanted) {
          primitive.position = positions[i * stride];
          primitive.show = true;
        } else {
          primitive.show = false;
        }
      }
      visibleCount = wanted;
      sourceCount = positions.length;
      perfStats.sourcePoints = sourceCount;
      perfStats.renderedPoints = visibleCount;
      perfStats.pointSubsample = stride;
      return wanted;
    }

    function applyFrame(index) {
      const t0 = perfNow();
      const positions = positionsOf(index);
      currentFrame = index;
      const wanted = sync(positions);
      const ms = perfNow() - t0;
      perfStats.frameSwitchCount++;
      perfStats.lastFrameSwitchMs = Math.round(ms * 10) / 10;
      if (ms > perfStats.maxFrameSwitchMs) perfStats.maxFrameSwitchMs = Math.round(ms * 10) / 10;
      perfLog('frame', {
        frame: index,
        ms: Math.round(ms * 10) / 10,
        rendered: wanted,
        source: sourceCount,
        subsample: qualityState.pointSubsample,
      });
      return wanted;
    }

    function applyQuality() {
      if (currentFrame < 0) return;
      const t0 = perfNow();
      sync(positionsOf(currentFrame));
      perfLog('quality-apply', {
        subsample: qualityState.pointSubsample,
        rendered: visibleCount,
        source: sourceCount,
        ms: Math.round((perfNow() - t0) * 10) / 10,
      });
    }

    le.viewer.scene.primitives.add(collection);
    const api = {
      collection,
      legend: null,
      visible: true,
      applyFrame,
      applyQuality,
      get count() {
        return visibleCount;
      },
      get sourceCount() {
        return sourceCount;
      },
      get currentFrame() {
        return currentFrame;
      },
      get qualityLabel() {
        return qualityState.pointSubsample > 1 ? '1/' + qualityState.pointSubsample : '1';
      },
      dispose() {
        pointCloudLayers.delete(api);
        try {
          le.viewer.scene.primitives.remove(collection);
        } catch (err) {
          /* ignore */
        }
        cache.clear();
        perfStats.activePointClouds = pointCloudLayers.size;
        updateQualityBadge();
      },
    };
    pointCloudLayers.add(api);
    perfStats.activePointClouds = pointCloudLayers.size;
    return api;
  }


  /**
   * 超大“线”动画播放器：每条 LineString 用 Csysium.PolylineCollection 渲染（比 3 万 Entity 轻得多）。
   * 每帧一个 PolylineCollection，按需构建并缓存少量帧；切帧只把 collection 换入/换出 scene。
   */
  function createLineFrameAnimation(le, frames, frameGroups) {
    const cache = new Map();
    const cacheLimit = Math.max(1, Number(config.pointCloudCacheFrames) || 3);
    const materialCache = new Map();
    let active = null;
    let current = -1;
    let visible = true;

    function buildFrame(index) {
      const instances = [];
      const group = frameGroups[index] || [];
      for (const placemark of group) {
        if (!placemark.visible) continue;
        const lineStyle = placemark.style && placemark.style.line;
        const color = ((lineStyle && lineStyle.color) || C.Color.WHITE).withAlpha(0.95);
        const widthValue = Math.max(0.8, lineWidthOf(placemark.style));
        for (const geometry of placemark.geometries) {
          if (geometry.type !== 'line' || !geometry.coords || geometry.coords.length < 2) continue;
          const clampToGround = geometry.altitudeMode === 'clampToGround' && !config.clampToGroundAsHeight;
          const altitudeMode = geometry.altitudeMode === 'clampToGround' && config.clampToGroundAsHeight
            ? 'relativeToGround'
            : geometry.altitudeMode;
          const positions = positionsFor(geometry.coords, altitudeMode);
          if (positions.length < 2) continue;
          const colors = new Array(positions.length);
          for (let k = 0; k < colors.length; k++) colors[k] = color;
          instances.push(new C.GeometryInstance({
            geometry: new C.PolylineGeometry({
              positions: positions,
              width: widthValue,
              colors: colors,
              vertexFormat: C.PolylineColorAppearance.VERTEX_FORMAT,
            }),
          }));
        }
      }
      if (!instances.length) return null;
      return new C.Primitive({
        geometryInstances: instances,
        appearance: new C.PolylineColorAppearance({ translucent: true }),
        asynchronous: false,
        releaseGeometryInstances: false,
      });
    }

    function prune() {
      while (cache.size > cacheLimit) {
        const oldest = cache.keys().next().value;
        if (oldest === current) break;
        const old = cache.get(oldest);
        cache.delete(oldest);
        try { le.viewer.scene.primitives.remove(old); } catch (err) { /* ignore */ }
      }
    }

    function applyFrame(index) {
      const t0 = perfNow();
      if (active) {
        try { active.show = false; } catch (err) { /* ignore */ }
      }
      if (!cache.has(index)) cache.set(index, buildFrame(index));
      active = cache.get(index);
      current = index;
      if (active) {
        try {
          if (!active.__leAttached) {
            le.viewer.scene.primitives.add(active);
            active.__leAttached = true;
          }
          active.show = visible;
        } catch (err) { /* ignore */ }
      }
      prune();
      const ms = perfNow() - t0;
      perfStats.frameSwitchCount++;
      perfStats.lastFrameSwitchMs = Math.round(ms * 10) / 10;
      if (ms > perfStats.maxFrameSwitchMs) perfStats.maxFrameSwitchMs = Math.round(ms * 10) / 10;
      perfLog('frame-lines', {
        frame: index,
        ms: Math.round(ms * 10) / 10,
        sourceLines: (frameGroups[index] || []).length,
        cached: cache.size,
      });
    }

    function setVisible(on) {
      visible = !!on;
      if (!active) return;
      try { active.show = visible; } catch (err) { /* ignore */ }
    }

    function dispose() {
      for (const collection of cache.values()) {
        try { le.viewer.scene.primitives.remove(collection); } catch (err) { /* ignore */ }
      }
      cache.clear();
      materialCache.clear();
      active = null;
    }

    return {
      applyFrame,
      applyQuality: function () {},
      setVisible,
      dispose,
      get count() { return active ? active.length : 0; },
      get sourceCount() {
        const found = frameGroups[current] || [];
        let n = 0;
        for (const pm of found) n += pm.geometries.length;
        return n;
      },
      get currentFrame() { return current; },
    };
  }

  function createTimelineController(displayName, frames, applyFrame) {
    let current = 0;
    let disposed = false;
    const listeners = new Set();
    const controller = {
      source: displayName,
      frames,
      get disposed() {
        return disposed;
      },
      get frameCount() {
        return frames.length;
      },
      get frameIndex() {
        return current;
      },
      get label() {
        return frames[current] ? frames[current].label : '--';
      },
      get timeText() {
        return this.label + ' · ' + (current + 1) + '/' + frames.length;
      },
      setFrame(index, opts) {
        if (disposed) return;
        const next = Math.max(0, Math.min(frames.length - 1, Math.round(index)));
        if (next === current && !(opts && opts.force)) return;
        current = next;
        try {
          applyFrame(current);
        } catch (err) {
          console.warn('[LEKml] 切换时间帧失败', err);
        }
        for (const fn of listeners) {
          try {
            fn(current, controller);
          } catch (err) {
            /* 单个监听器失败继续 */
          }
        }
      },
      next() {
        this.setFrame(current + 1 >= frames.length ? 0 : current + 1);
      },
      previous() {
        this.setFrame(current - 1 < 0 ? frames.length - 1 : current - 1);
      },
      onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        listeners.clear();
        dispatchTimeline('deactivate', controller);
      },
    };
    return controller;
  }

  /* ------------------------------ 相机定位 ------------------------------ */

  function cameraBoundsOf(model) {
    const bounds = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity, has: false };
    for (const placemark of model.placemarks) {
      for (const geometry of placemark.geometries) {
        if (geometry.type === 'polygon') {
          for (const ring of geometry.rings) addBounds(bounds, ring);
        } else if (geometry.coords) {
          addBounds(bounds, geometry.coords);
        }
      }
    }
    if (!bounds.has && model.region && model.region.has) {
      return Object.assign({}, model.region, { has: true, source: 'Region' });
    }
    return bounds.has ? bounds : null;
  }

  function flyToBounds(le, dataSource, bounds, duration) {
    if (!bounds || !bounds.has) return false;
    if (window.LEImports && typeof window.LEImports.fitDataSource === 'function') {
      try {
        if (window.LEImports.fitDataSource(le, dataSource, duration)) return true;
      } catch (err) {
        console.warn('[LEKml] LEImports.fitDataSource 失败，改用本地定位算法', err);
      }
    }
    const padLon = Math.max((bounds.east - bounds.west) * 0.1, 0.0008);
    const padLat = Math.max((bounds.north - bounds.south) * 0.1, 0.0008);
    const west = Math.max(-179.999, bounds.west - padLon);
    const east = Math.min(179.999, bounds.east + padLon);
    const south = Math.max(-89.999, bounds.south - padLat);
    const north = Math.min(89.999, bounds.north + padLat);
    le.viewer.camera.flyTo({
      destination: C.Rectangle.fromDegrees(west, south, east, north),
      duration: duration || 1.4,
    });
    return true;
  }

  /* ------------------------------ 主加载流程 ------------------------------ */

  /**
   * 公共入口：包一层性能统计/心跳，保证异常时清理定时器。
   * 内部 loadInternal 负责真正的读取、异步解析（分片让出）与构建。
   */
  async function load(input, le, options) {
    perfStats.loads++;
    // 每次加载重置“本次”的解析指标（帧切换等累计指标保留）
    perfStats.yieldCount = 0;
    perfStats.domParseMs = 0;
    perfStats.domMaxMs = 0;
    perfStats.planMs = 0;
    perfStats.readMs = 0;
    perfStats.zipMs = 0;
    perfStats.decodeMs = 0;
    perfStats.styleScanMs = 0;
    perfStats.walkMs = 0;
    perfStats.walkPureMs = 0;
    perfStats.walkYieldMs = 0;
    perfStats.framesMs = 0;
    perfStats.iconPlanMs = 0;
    perfStats.buildMs = 0;
    perfStats.heartbeatMaxGapMs = 0;
    perfStats.maxYieldGapMs = 0;
    perfStats.longTaskCount = 0;
    perfStats.longTaskMaxMs = 0;
    perfStats.placemarks = 0;
    perfStats.sourcePoints = 0;
    perfStats.renderedPoints = 0;
    const t0 = perfNow();
    const heartbeat = startHeartbeat();
    perfLog('load-start', { at: Math.round(t0) });
    try {
      const result = await loadInternal(input, le, options);
      const maxGap = stopHeartbeat(heartbeat);
      perfStats.heartbeatMaxGapMs = Math.round(maxGap * 10) / 10;
      perfStats.maxYieldGapMs = perfStats.heartbeatMaxGapMs;
      perfStats.totalLoadMs = Math.round(perfNow() - t0);
      perfStats.placemarks = result.placemarkCount || 0;
      perfStats.pointSubsample = qualityState.pointSubsample;
      perfLog('load', {
        totalLoadMs: perfStats.totalLoadMs,
        readMs: perfStats.readMs,
        zipMs: perfStats.zipMs,
        decodeMs: perfStats.decodeMs,
        planMs: perfStats.planMs,
        domParseMs: perfStats.domParseMs,
        domMaxMs: perfStats.domMaxMs,
        styleScanMs: perfStats.styleScanMs,
        walkMs: perfStats.walkMs,
        walkPureMs: perfStats.walkPureMs,
        walkYieldMs: perfStats.walkYieldMs,
        framesMs: perfStats.framesMs,
        iconPlanMs: perfStats.iconPlanMs,
        buildMs: perfStats.buildMs,
        yieldCount: perfStats.yieldCount,
        heartbeatMaxGapMs: perfStats.heartbeatMaxGapMs,
        placemarks: perfStats.placemarks,
        frames: result.frames,
        pointSubsample: qualityState.pointSubsample,
        renderedPoints: perfStats.renderedPoints,
        primitiveAnimation: !!result.primitiveAnimation,
      });
      updateQualityBadge();
      // ?kmlperf=1：记录内存快照与近似 FPS（用于性能对比，可随时移除）
      schedulePerfDebugLog();
      startRenderSampler(le || window.LE);
      restoreLoadingOverlayInteraction();
      return result;
    } catch (err) {
      const maxGap = stopHeartbeat(heartbeat);
      restoreLoadingOverlayInteraction();
      perfStats.heartbeatMaxGapMs = Math.round(maxGap * 10) / 10;
      perfStats.totalLoadMs = Math.round(perfNow() - t0);
      perfLog('load-error', {
        totalLoadMs: perfStats.totalLoadMs,
        heartbeatMaxGapMs: perfStats.heartbeatMaxGapMs,
        message: String(err && err.message ? err.message : err),
      });
      throw err;
    }
  }

  async function loadInternal(input, le, options) {
    le = le || window.LE;
    if (!le || !le.viewer) throw new Error('本地地球尚未初始化（window.LE 不存在），无法加载 KML/KMZ');

    const opts = options || {};
    const ctx = createContext();
    const progress = createProgressReporter(le, opts);
    progress.report('read', 2);

    // 1) 读取字节
    const tRead = perfNow();
    const source = await readInput(input, ctx);
    perfStats.readMs = Math.round(perfNow() - tRead);
    progress.report('read', 4);

    // 2) KMZ / KML 分流
    let kmlText = null;
    let zip = null;
    let kmlEntryName = '';
    if (looksLikeZip(source.bytes)) {
      const tZip = perfNow();
      zip = await readZip(source.bytes, ctx);
      zip.bytes = source.bytes;
      if (!zip.entries.length) throw new Error('KMZ 中没有可读取的文件');
      const kmlEntry = pickKmlEntry(zip.entries, ctx);
      if (!kmlEntry) throw new Error('KMZ 中未找到 .kml 文件');
      kmlEntryName = kmlEntry.name;
      let kmlBytes;
      try {
        kmlBytes = await extractZipEntry(source.bytes, kmlEntry);
      } catch (err) {
        throw new Error('KMZ 解压失败（' + (err && err.message ? err.message : err) + '）');
      }
      perfStats.zipMs = Math.round(perfNow() - tZip);
      const tDecode = perfNow();
      kmlText = decodeText(kmlBytes);
      perfStats.decodeMs = Math.round(perfNow() - tDecode);
    } else {
      const tDecode = perfNow();
      kmlText = decodeText(source.bytes);
      perfStats.decodeMs = Math.round(perfNow() - tDecode);
    }
    if (!kmlText || !kmlText.trim()) throw new Error('KML 内容为空');
    // 大文件解析阶段：让调用方打开的全屏加载遮罩可穿透（界面可交互），状态栏仍显示解析进度。
    // 小文件保持原有遮罩行为。
    if (kmlText.length >= config.unblockOverlayMinBytes) unblockLoadingOverlay();
    progress.report('parse', 6);

    // 3) 解析（异步分片，每 ~2000 Placemark 让出主线程；进度写状态栏）
    const model = await parseDocumentModel(kmlText, ctx, progress);
    // 释放 56MB 级 KML 文本引用，降低峰值内存（模型不再依赖原始文本）
    kmlText = null;
    progress.report('build', 74);

    // 4) 构建实体（Point+IconStyle → billboard；支持 TimeSpan 时间帧）
    const displayName = opts.name || source.name || basename(model.name) || 'KML';
    const dataSource = new C.CustomDataSource(displayName);
    const bounds = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity, has: false };
    const frames = model.frames || [];
    const animated = frames.length >= 2;
    perfStats.frames = frames.length;
    perfStats.animated = animated;

    // 4.1 预解析图标：KMZ 内图标优先；外部 http(s) 图标绝不联网，回退内置箭头 sprite
    let iconPlan = null;
    const tIcon = perfNow();
    try {
      iconPlan = await buildIconPlan(model, zip, source, ctx);
    } catch (err) {
      ctx.warn('图标初始化失败，已统一使用内置箭头：' + (err && err.message ? err.message : err));
    }
    perfStats.iconPlanMs = Math.round(perfNow() - tIcon);
    const renderCtx = { iconPlan, animated };
    progress.report('build', 80);

    // 4.2 统计：决定“全部构建 + 切 show” / “时间窗口 + 懒构建” / “点云原地更新”
    let totalGeometries = 0;
    for (const placemark of model.placemarks) {
      if (placemark.visible) totalGeometries += placemark.geometries.length;
    }
    await yieldToMain();
    perfStats.yieldCount++;
    progress.report('build', 82);
    let frameGroups = null;
    let windowMode = false;
    let animatedGeometries = 0;
    if (animated) {
      frameGroups = frames.map(() => []);
      animatedGeometries = 0;
      for (const placemark of model.placemarks) {
        if (!placemark.visible || placemark.frameIndex < 0) continue;
        frameGroups[placemark.frameIndex].push(placemark);
        animatedGeometries += Math.max(1, placemark.geometries.length);
      }
      windowMode = animatedGeometries > config.animEntityBudget;
    }

    // 超大动画若“全部是无 IconStyle 的 Point”（如 13.5 万 Placemark 的 timeline），
    // 改用 PointPrimitiveCollection 原地更新位置：每帧只改 position，不创建/销毁 Entity。
    // 实测窗口实体模式下每帧建/删 1 万 Entity 会卡死主线程数十秒。
    let primitiveMode = false;
    if (windowMode) {
      primitiveMode = true;
      let checked = 0;
      for (const placemark of model.placemarks) {
        if (!placemark.visible) continue;
        if (placemark.style && placemark.style.icon) {
          primitiveMode = false;
          break;
        }
        for (const geometry of placemark.geometries) {
          if (geometry.type !== 'point') {
            primitiveMode = false;
            break;
          }
        }
        if (!primitiveMode) break;
        checked++;
        if (checked % 20000 === 0) {
          await yieldToMain();
          perfStats.yieldCount++;
        }
      }
      if (primitiveMode) windowMode = false;
    }

    // 超大动画若全是 LineString：改用 PolylineCollection 帧播放器（避免数万 Entity）。
    let primitiveLineMode = false;
    if (windowMode) {
      primitiveLineMode = true;
      let checked = 0;
      for (const placemark of model.placemarks) {
        if (!placemark.visible) continue;
        for (const geometry of placemark.geometries) {
          if (geometry.type !== 'line') { primitiveLineMode = false; break; }
        }
        if (!primitiveLineMode) break;
        checked++;
        if (checked % 20000 === 0) {
          await yieldToMain();
          perfStats.yieldCount++;
        }
      }
      if (primitiveLineMode) windowMode = false;
    }
    perfStats.frameIndexed = frameGroups ? frameGroups.reduce(function (n, g) { return n + g.length; }, 0) : 0;
    perfStats.windowMode = windowMode;
    perfStats.primitiveLineMode = primitiveLineMode;
    perfStats.primitiveMode = primitiveMode;
    perfLog('anim-probe', {
      frames: frames.length,
      animated: animated,
      frameIndexed: frameGroups ? frameGroups.reduce(function (n, g) { return n + g.length; }, 0) : 0,
      animatedGeometries: animatedGeometries,
      windowMode: windowMode,
      primitiveMode: primitiveMode,
      primitiveLineMode: primitiveLineMode,
    });

    let primitives = null;
    const tBuild = perfNow();
    if (primitiveMode) {
      try {
        primitives = createPointFrameAnimation(le, frames, frameGroups);
        progress.report('build', 86);
      } catch (err) {
        primitives = null;
        primitiveMode = false;
        windowMode = true;
        ctx.warn('点云动画初始化失败，已回退实体窗口模式：' + (err && err.message ? err.message : err));
      }
    }

    let linePrimitives = null;
    if (primitiveLineMode) {
      try {
        linePrimitives = createLineFrameAnimation(le, frames, frameGroups);
        progress.report('build', 86);
      } catch (err) {
        linePrimitives = null;
        primitiveLineMode = false;
        windowMode = true;
        ctx.warn('线动画初始化失败，已回退实体窗口模式：' + (err && err.message ? err.message : err));
      }
    }

    let entityCount = 0; // 当前 materialize 的 entity 数（窗口模式下只统计窗口内）
    let builtEntities = 0;
    const frameEntities = animated && !windowMode && !primitiveMode ? frames.map(() => []) : null;
    let frameCapWarned = false;

    function buildPlacemark(placemark, cap, targetList) {
      for (const geometry of placemark.geometries) {
        if (cap != null && builtEntities >= cap) {
          if (!frameCapWarned) {
            ctx.warn('单帧实体数超过上限（' + cap + '），已截断当前帧渲染');
            frameCapWarned = true;
          }
          break;
        }
        try {
          const entity = addGeometryEntity(dataSource, placemark, geometry, bounds, ctx, renderCtx);
          if (!entity) continue;
          entityCount++;
          builtEntities++;
          if (animated && placemark.frameIndex >= 0) {
            entity.LEKml.frame = placemark.frameIndex;
            if (targetList) targetList.push(entity);
          }
        } catch (err) {
          ctx.warn('构建地物失败：' + placemark.name + '（' + (err && err.message ? err.message : err) + '）');
        }
      }
    }

    // 非窗口/非点云模式：一次性构建全部（切帧只改 entity.show，不重建数据源）
    // 构建过程同样分片让出主线程，避免大量 entity/billboard 一次性创建造成长冻结。
    if (!windowMode && !primitiveMode && !primitiveLineMode) {
      const totalPlacemarks = Math.max(1, model.placemarks.length);
      let processed = 0;
      for (const placemark of model.placemarks) {
        if (!placemark.visible) continue;
        const targetList = animated && placemark.frameIndex >= 0 ? frameEntities[placemark.frameIndex] : null;
        buildPlacemark(placemark, config.maxEntities, targetList);
        processed++;
        if (processed % 2000 === 0) {
          await yieldToMain();
          perfStats.yieldCount++;
          progress.report('build', 84 + Math.round((processed / totalPlacemarks) * 10));
        }
      }
    }

    // 4.3 时间过滤：仅显示当前帧（初始第一帧）
    let frameControls = null;
    if (animated) {
      if (primitiveLineMode && linePrimitives) {
        frameControls = function applyFrameLines(index) {
          linePrimitives.applyFrame(index);
        };
      } else if (primitiveMode && primitives) {
        frameControls = function applyFramePrimitives(index) {
          primitives.applyFrame(index);
        };
      } else if (!windowMode) {
        frameControls = function applyFrameAll(index) {
          for (let f = 0; f < frameEntities.length; f++) {
            const visible = f === index;
            const list = frameEntities[f];
            for (let i = 0; i < list.length; i++) list[i].show = visible;
          }
        };
      } else {
        // 超大动画（如 56 MB doc.kml / 13.5 万 Placemark）：只保留当前帧前后窗口，
        // 切帧时补建新帧、释放窗口外实体；数据源本身不重建。
        const windowFrameEntities = new Map();
        const half = Math.max(0, Math.floor(config.animFrameWindow / 2));
        const frameCap = Math.max(1, Math.floor(config.maxEntities / config.animFrameWindow));
        frameControls = function applyFrameWindow(index) {
          const low = Math.max(0, index - half);
          const high = Math.min(frames.length - 1, index + half);
          for (let f = low; f <= high; f++) {
            if (windowFrameEntities.has(f)) continue;
            const list = [];
            builtEntities = 0;
            for (const placemark of frameGroups[f]) buildPlacemark(placemark, frameCap, list);
            windowFrameEntities.set(f, list);
          }
          for (const f of Array.from(windowFrameEntities.keys())) {
            if (f >= low && f <= high) continue;
            const list = windowFrameEntities.get(f);
            for (const entity of list) {
              try {
                dataSource.entities.remove(entity);
              } catch (err) {
                /* ignore */
              }
            }
            windowFrameEntities.delete(f);
            entityCount -= list.length;
          }
          windowFrameEntities.forEach((list, f) => {
            const visible = f === index;
            for (const entity of list) entity.show = visible;
          });
        };
      }
      frameControls(0);
    }
    perfStats.buildMs = Math.round(perfNow() - tBuild);
    progress.report('build', 94);
    await yieldToMain();
    perfStats.yieldCount++;

    const renderedCount = windowMode || primitiveMode || primitiveLineMode ? totalGeometries : entityCount;

    // 动画/点云模式的实体可能只覆盖当前帧窗口：用完整模型坐标补全定位范围，
    // 保证初始视角能框住全部时间帧（primitiveMode 甚至不创建 Entity）。
    if (animated) {
      const modelBounds = cameraBoundsOf(model);
      if (modelBounds && modelBounds.has) {
        if (!bounds.has) {
          bounds.west = modelBounds.west;
          bounds.east = modelBounds.east;
          bounds.south = modelBounds.south;
          bounds.north = modelBounds.north;
          bounds.has = true;
        } else {
          bounds.west = Math.min(bounds.west, modelBounds.west);
          bounds.east = Math.max(bounds.east, modelBounds.east);
          bounds.south = Math.min(bounds.south, modelBounds.south);
          bounds.north = Math.max(bounds.north, modelBounds.north);
        }
      }
    }
    progress.report('build', 96);
    const overlayCount = model.overlays.filter((overlay) => overlay.visible).length;
    if (!renderedCount && !overlayCount) {
      ctx.flushCounts();
      // 没有可渲染几何 → 让调用方回退 Cesium KmlDataSource（可能支持 GroundOverlay 等）
      throw new Error('KML 中未发现可渲染的点/线/面要素' + (overlayCount ? '（仅含屏幕图例）' : ''));
    }

    // 5) 图例（HTML 覆盖层）：按 IconStyle 颜色聚合风速区间
    let legend = null;
    if (animated) {
      try {
        legend = buildLegendLayer(le, buildLegendItems(model), frames, ctx, displayName);
      } catch (err) {
        ctx.warn('图例初始化失败：' + (err && err.message ? err.message : err));
      }
    }
    // 点云降采样提示：有图例时在图例内注明（无图例时用右上角 badge）
    if (primitives && legend) {
      primitives.legend = legend;
      if (qualityState.pointSubsample > 1) {
        legend.setQualityNote('性能模式：1/' + qualityState.pointSubsample + ' 点');
      }
    }
    progress.report('build', 98);

    // 6) 屏幕图例（异步读取图标；失败只告警不阻断）
    let overlay = null;
    if (model.overlays.length) {
      try {
        const resolver = createMediaResolver(zip, source, ctx);
        overlay = buildOverlayLayer(le, model.overlays, resolver, ctx, displayName);
      } catch (err) {
        ctx.warn('屏幕图例初始化失败：' + (err && err.message ? err.message : err));
      }
    }

    // 7) 时间轴控制器（DOM 与播放由 js/ui.js 通过 'lekml-timeline' 事件绑定）
    let timeline = null;
    if (animated && frameControls) {
      timeline = createTimelineController(displayName, frames, frameControls);
    }

    // 8) 加入 viewer
    await le.viewer.dataSources.add(dataSource);

    // 9) 注册图层
    const layerName = displayName;
    const layer = le.registerLayer({
      id: 'kmlnative-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      name: layerName,
      type: 'vector',
      datasource: dataSource,
      meta: {
        format: zip ? 'kmz' : 'kml',
        kmlEntry: kmlEntryName,
        kmlName: model.name,
        placemarks: model.placemarks.length,
        entities: renderedCount,
        frames: frames.length,
        animated,
        timelineWindow: windowMode,
        primitiveAnimation: primitiveMode,
        primitiveLineAnimation: primitiveLineMode,
        pointSubsample: qualityState.pointSubsample,
        sourcePoints: perfStats.sourcePoints,
        renderedPoints: perfStats.renderedPoints,
        legendItems: legend ? legend.count : 0,
        externalIcons: iconPlan ? iconPlan.externalCount : 0,
        overlays: overlayCount,
        overlaysLoaded: overlay ? overlay.count : 0,
        bounds,
        warnings: ctx.warnings.slice(),
        native: true,
      },
      onVisible(visible) {
        if (overlay) overlay.setVisible(visible);
        if (legend) legend.setVisible(visible);
        if (primitives) {
          primitives.visible = visible;
          primitives.collection.show = visible;
          updateQualityBadge();
        }
        if (timeline) dispatchTimeline(visible ? 'activate' : 'deactivate', timeline);
      },
      zoomTo: () => flyToBounds(le, dataSource, bounds, 1.4),
      flyTo: () => flyToBounds(le, dataSource, bounds, 1.4),
      remove: () => {
        try {
          le.viewer.dataSources.remove(dataSource, true);
        } catch (err) {
          console.warn('[LEKml] 移除数据源失败', err);
        }
        if (overlay) overlay.dispose();
        if (legend) legend.dispose();
        if (timeline) timeline.dispose();
        if (iconPlan) iconPlan.dispose();
        if (primitives) primitives.dispose();
      if (linePrimitives) linePrimitives.dispose();
      },
    });

    if (timeline) dispatchTimeline('activate', timeline);
    updateQualityBadge();
    progress.report('build', 99);
    // 加载完成：恢复状态栏（调用方随后会写入“已加载 …”，这里只在直接调用 API 时兜底）
    try {
      if (le && typeof le.setStatus === 'function') le.setStatus('KML 图层已就绪');
    } catch (err) {
      /* ignore */
    }

    // 10) 定位 + 刷新搜索索引
    if (opts.fly !== false) flyToBounds(le, dataSource, bounds, opts.duration || 1.4);
    try {
      if (window.LETools && typeof window.LETools.rebuildSearchIndex === 'function') {
        window.LETools.rebuildSearchIndex();
      }
    } catch (err) {
      console.warn('[LEKml] 刷新搜索索引失败', err);
    }

    ctx.flushCounts();
    if (ctx.warnings.length) {
      console.warn('[LEKml] ' + layerName + ' 原生渲染提示：\n - ' + ctx.warnings.join('\n - '));
    }

    return {
      layer,
      count: renderedCount,
      bounds,
      warnings: ctx.warnings.slice(),
      dataSource,
      kmlName: model.name,
      overlays: overlayCount,
      overlaysLoaded: overlay ? overlay.count : 0,
      frames: frames.length,
      animated,
      timelineWindow: windowMode,
      primitiveAnimation: primitiveMode,
      pointSubsample: qualityState.pointSubsample,
      renderedPoints: perfStats.renderedPoints,
      sourcePoints: perfStats.sourcePoints,
      timeline,
      legend: legend ? legend.count : 0,
      native: true,
      placemarkCount: model.placemarks.length,
    };
  }

  /* ------------------------------ 调试辅助 ------------------------------ */

  async function inspectText(text) {
    const ctx = createContext();
    const model = await parseDocumentModel(String(text || ''), ctx);
    const bounds = cameraBoundsOf(model);
    ctx.flushCounts();
    return {
      name: model.name,
      placemarks: model.placemarks.length,
      overlays: model.overlays.map((overlay) => ({ name: overlay.name, href: overlay.href, visible: overlay.visible })),
      region: model.region,
      bounds,
      styles: model.styleCount,
      iconStyles: model.iconStyleCount,
      frames: (model.frames || []).map((frame) => ({ index: frame.index, begin: frame.begin, end: frame.end, count: frame.count, label: frame.label })),
      warnings: ctx.warnings,
    };
  }

  /** 地形开/关后，重新按当前地形高度贴合已加载的 KML 折线/面/点。 */
  function redrape(viewer) {
    if (!viewer || !viewer.dataSources) return 0;
    let updated = 0;
    const dsList = viewer.dataSources;
    for (let i = 0; i < dsList.length; i++) {
      const ds = dsList.get(i);
      const entities = ds.entities && ds.entities.values;
      if (!entities) continue;
      for (const entity of entities) {
        const info = entity.LEKml;
        if (!info) continue;
        try {
          if (info.kind === 'line' && info.coords && entity.polyline) {
            const positions = positionsFor(info.coords, info.effectiveAltitudeMode || info.altitudeMode);
            entity.polyline.positions = new C.CallbackProperty(() => positions, false);
            updated++;
          } else if (info.kind === 'polygon' && info.rings && entity.polygon) {
            const rings = info.rings;
            const outer = positionsFor(rings[0], info.altitudeMode);
            const holes = [];
            for (let r = 1; r < rings.length; r++) holes.push(positionsFor(rings[r], info.altitudeMode));
            entity.polygon.hierarchy = new C.PolygonHierarchy(outer, holes);
            updated++;
          } else if ((info.kind === 'point' || info.kind === 'billboard') && info.point) {
            const h = heightFor(info.point, info.altitudeMode);
            entity.position = C.Cartesian3.fromDegrees(info.point.lon, info.point.lat, h);
            const graphics = entity.point || entity.billboard;
            if (graphics) {
              graphics.heightReference = terrainEnabled()
                ? C.HeightReference.NONE
                : C.HeightReference.CLAMP_TO_GROUND;
            }
            updated++;
          }
        } catch (err) {
          /* 单个要素失败继续 */
        }
      }
    }
    return updated;
  }

  /** 性能指标快照（供 perf.js / 自动化测试读取，不修改任何状态）。 */
  function getPerfStats() {
    const mem = typeof performance !== 'undefined' && performance.memory;
    if (mem) perfStats.heapMB = Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10;
    return Object.assign({}, perfStats, {
      quality: getQuality(),
      activePointCloudLayers: pointCloudLayers.size,
      perfDebug: PERF_DEBUG,
    });
  }

  /** 清零“累计”指标（保留加载次数），便于性能测试分段统计。 */
  function resetPerfStats() {
    const loads = perfStats.loads;
    for (const key of Object.keys(perfStats)) {
      if (key === 'loads') continue;
      if (typeof perfStats[key] === 'number') perfStats[key] = 0;
    }
    perfStats.loads = loads;
    perfStats.pointSubsample = qualityState.pointSubsample;
    perfStats.renderedPoints = 0;
    perfStats.sourcePoints = 0;
    return getPerfStats();
  }

  window.LEKml = {
    version: '1.2.0',
    load,
    inspectText,
    config,
    redrape,
    // 性能模式：点云降采样（1=全部，2=隔一点，4=1/4）；可在加载前后安全调用
    setQuality,
    getQuality,
    // 性能指标（异步解析耗时、最大阻塞、切帧耗时、渲染点数等）
    getPerfStats,
    resetPerfStats,
    // 便于排查：解析纯文本 KML（不加入 viewer）；v1.2.0 起返回 Promise
    parseKmlText: inspectText,
  };
})();

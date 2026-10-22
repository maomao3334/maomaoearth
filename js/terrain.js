/*
 * 本地 3D 地形（多源 heightmap + 地形夸张 + 卫星影像）
 * - 示例区高分辨率源：data/public/dem/N25E102-terrain.json + .bin（1025² int16，102–103E / 25–26N，≈1″）
 * - 东亚源（懒加载）：data/public/dem/eastasia-terrain.json + .bin（4750×3000 int16，55–150E / 0–60N，0.02°）
 * - 全球源（懒加载）：data/public/dem/world-terrain.json + .bin（3600×1700 int16，-180–180E / -85–85N，0.1°）
 * - 通过 Cesium.CustomHeightmapTerrainProvider（33×33/瓦片，见 TERRAIN_GRID 说明）生成地形
 * - 提供 heightAt(lon,lat) 给 KML 渲染器做“箭头贴地”；地形夸张只在此处乘，保证网格与箭头一致
 * - 开启时按 world → eastasia → N25 细节 的顺序叠加坡向阴影图（N25 细节按相机高度挂载）
 * - 卫星影像：本地 Sentinel-2 cloudless（EOX，CC BY 4.0）EPSG:3857 瓦片，三级覆盖（z5–8 / z9–12 / z13–14）
 * 完全离线，不访问网络。原始数据保留 Int16Array，双线性采样时就地换算，避免复制千万级浮点数组。
 */
(function () {
  'use strict';

  const C = window.Cesium;

  const HIGH_META_URL = 'data/public/dem/N25E102-terrain.json';
  const HIGH_FALLBACK_FILE = 'N25E102-terrain.bin';
  const EASTASIA_META_URL = 'data/public/dem/eastasia-terrain.json';
  const EASTASIA_FALLBACK_FILE = 'eastasia-terrain.bin';
  const WORLD_META_URL = 'data/public/dem/world-terrain.json';
  const WORLD_FALLBACK_FILE = 'world-terrain.bin';

  // 每块地形瓦片的高度采样数由性能档位控制（state.grid）：
  // 低 17（289 点/瓦片，快） / 中 33（1089 点，默认） / 高 49（2401 点，细）。
  // 任何 2^n+1（或任意宽高）Provider 都兼容；这里提供 9..65 的离散档位，便于 perf 调度器调用。
  const QUALITY_GRID_DEFAULT = 33;
  const QUALITY_GRIDS = [9, 17, 25, 33, 41, 49, 57, 65];
  const QUALITY_IMAGERY_LEVELS = ['low', 'medium', 'high'];
  const EDGE_FADE_DEG = 0.005; // 示例区外边缘淡出（无更粗数据时的旧行为）
  const EASTASIA_EDGE_FADE_DEG = 0.05; // 东亚 bbox 边缘 ↔ 全球数据的平滑混合带
  const BLEND_DEG = 0.02; // 示例区 ↔ 下一级数据的边界过渡带（约 2 km）
  const WORLD_LAT_FADE_DEG = 0.1; // 全球 bbox 纬度边缘（±85°）淡出

  const EXAG_MIN = 1.0;
  const EXAG_MAX = 3.0;
  const EXAG_REBUILD_DELAY = 250; // 松手后等待重建的节流（ms）
  const EXAG_STORAGE_KEY = 'localEarth.terrainExaggeration';

  // N25 细节阴影：只在相机低于该高度（近景）时挂载，减少常驻纹理/绘制调用与显存占用
  const DETAIL_HILLSHADE_MAX_HEIGHT = 700000; // 700 km
  const DETAIL_HILLSHADE_CHECK_MS = 300; // 相机变化后延迟检查（节流）

  // 阴影图层（自底向上：world → eastasia → N25 细节）
  const WORLD_HILLSHADE_NAME = '全球地形阴影（3D 地形配套）';
  const EASTASIA_HILLSHADE_NAME = '东亚地形阴影（3D 地形配套）';
  const DETAIL_HILLSHADE_NAME = 'SRTM 地形阴影（示例区高精度）';
  // 旧版本自动阴影名，仅用于清理
  const LEGACY_HILLSHADE_NAMES = ['中国地形阴影（3D 地形配套）', 'SRTM 地形阴影（3D 地形配套）'];
  const WORLD_HILLSHADE_URL = 'data/public/dem/world-hillshade.png';
  const EASTASIA_HILLSHADE_FALLBACK_URL = 'data/public/dem/eastasia-hillshade.png';
  const N25_HILLSHADE_URL = 'data/public/dem/N25E102-hillshade.png';
  const N25_HILLSHADE_RECT = [102, 25, 103, 26];
  const HILLSHADE_REMOVE_NAMES = [WORLD_HILLSHADE_NAME, EASTASIA_HILLSHADE_NAME, DETAIL_HILLSHADE_NAME].concat(
    LEGACY_HILLSHADE_NAMES
  );

  // 卫星影像（Sentinel-2 cloudless，EOX，CC BY 4.0；本地 EPSG:3857 瓦片）
  // 顺序自底向上：主影像（z5–8 东亚）→ 宽域高清（z9–12 风场周边）→ 超清（z13–14 示例区）
  const IMAGERY_URL = 'data/public/imagery/s2cloudless/{z}/{x}/{y}.jpg';
  const IMAGERY_CREDIT = 'Sentinel-2 cloudless by EOX IT Services GmbH (CC BY 4.0)';
  const IMAGERY_MAIN_NAME = '卫星影像（Sentinel-2 cloudless）';
  const IMAGERY_WIDE_NAME = '卫星影像·宽域高清（z9–12）';
  const IMAGERY_ULTRA_NAME = '卫星影像·超清（z13–14）';
  const IMAGERY_LAYER_SPECS = [
    {
      name: IMAGERY_MAIN_NAME,
      rectangle: [55, 0, 150, 60],
      minLevel: 5,
      maxLevel: 8,
      alpha: 0.92,
      opacityBlend: true,
    },
    {
      name: IMAGERY_WIDE_NAME,
      rectangle: [100, 23, 105, 27],
      minLevel: 9,
      maxLevel: 12,
      alpha: 1.0,
    },
    {
      name: IMAGERY_ULTRA_NAME,
      rectangle: [102.2, 24.95, 102.6, 25.15],
      minLevel: 13,
      maxLevel: 14,
      alpha: 1.0,
    },
  ];
  const IMAGERY_LAYER_NAMES = IMAGERY_LAYER_SPECS.map((spec) => spec.name);

  const state = {
    le: null,
    // 高分辨率示例区源
    high: null,
    highReady: false,
    highLoading: null,
    // 东亚源（懒加载）
    eastasia: null,
    eastasiaReady: false,
    eastasiaFailed: false,
    eastasiaLoading: null,
    // 全球源（懒加载）
    world: null,
    worldReady: false,
    worldFailed: false,
    worldLoading: null,
    // 地形 Provider / 开关状态
    provider: null,
    providerExag: null,
    providerGrid: null,
    tilingScheme: null,
    enabled: false,
    ready: false,
    // 地形夸张（只在 heightAt 出口乘，Provider 与 LEKml 贴地共用该值）
    exaggeration: 1.0,
    exagTimer: null,
    // 性能档位（setQuality）
    grid: QUALITY_GRID_DEFAULT,
    detailHillshade: true,
    imageryDetail: 'high',
    deferHeavy: false,
    heavyLoaded: false,
    heavyPromise: null,
    // 重建性能统计 / 延后重建
    rebuildPending: false,
    perf: {
      lastRebuildMs: null,
      lastRebuildAt: null,
      rebuildCount: 0,
      grid: QUALITY_GRID_DEFAULT,
      tileSamples: QUALITY_GRID_DEFAULT * QUALITY_GRID_DEFAULT,
      lastReason: null,
    },
    // 卫星影像
    imageryEnabled: true,
    // 相机高度门控的 N25 细节阴影
    detailHillshadeMounted: false,
    cameraHandlerBound: false,
  };

  const existsCache = new Map();

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function smoothstep(t) {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function normalizeExaggeration(value) {
    const n = Number(value);
    const v = clamp(isFinite(n) ? n : 1, EXAG_MIN, EXAG_MAX);
    return Math.round(v * 10) / 10; // 与滑杆 step=0.1 一致
  }

  function readStoredExaggeration() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(EXAG_STORAGE_KEY);
      if (raw == null || raw === '') return null;
      const v = Number(raw);
      return isFinite(v) ? normalizeExaggeration(v) : null;
    } catch (err) {
      return null;
    }
  }

  function writeStoredExaggeration(value) {
    try {
      if (window.localStorage) window.localStorage.setItem(EXAG_STORAGE_KEY, String(value));
    } catch (err) {
      // 隐私模式等场景忽略
    }
  }

  /** 读取一份 heightmap 元数据 + int16 数据（保留 Int16Array，scale/offset 采样时换算）。 */
  async function loadSource(metaUrl, fallbackFile) {
    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) throw new Error('地形元数据读取失败：' + metaRes.status);
    const meta = await metaRes.json();
    const base = new URL(metaUrl, location.href);
    const fileUrl = new URL(meta.file || fallbackFile, base).href;
    const binRes = await fetch(fileUrl);
    if (!binRes.ok) throw new Error('地形数据读取失败：' + binRes.status);
    const buf = await binRes.arrayBuffer();
    const count = meta.width * meta.height;
    if (buf.byteLength !== count * 2) {
      throw new Error('地形数据大小不符：' + buf.byteLength + ' != ' + count * 2);
    }
    const width = Number(meta.width);
    const height = Number(meta.height);
    const west = Number(meta.west);
    const south = Number(meta.south);
    const east = Number(meta.east);
    const north = Number(meta.north);
    return {
      meta,
      data: new Int16Array(buf),
      width,
      height,
      west,
      south,
      east,
      north,
      scale: Number(meta.scale) || 1,
      offset: Number(meta.offset) || 0,
      resolutionDeg:
        Number(meta.resolutionDeg) || (width > 1 ? (east - west) / (width - 1) : 0),
      hillshadeUrl: meta.hillshade ? new URL(meta.hillshade, base).href : null,
    };
  }

  /** 单源双线性采样；坐标先夹到 bbox 内（用于示例区边缘延拓）。 */
  function sourceHeightAt(src, lon, lat) {
    const { data, width, height, west, south, east, north, scale, offset } = src;
    const fx = clamp(((lon - west) / (east - west)) * (width - 1), 0, width - 1);
    const fy = clamp(((north - lat) / (north - south)) * (height - 1), 0, height - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = x0 + 1 < width ? x0 + 1 : x0;
    const y1 = y0 + 1 < height ? y0 + 1 : y0;
    const tx = fx - x0;
    const ty = fy - y0;
    const row0 = y0 * width;
    const row1 = y1 * width;
    const v =
      data[row0 + x0] * (1 - tx) * (1 - ty) +
      data[row0 + x1] * tx * (1 - ty) +
      data[row1 + x0] * (1 - tx) * ty +
      data[row1 + x1] * tx * ty;
    return v * scale + offset;
  }

  /** bbox 边缘平滑系数：距离边界 >= fadeDeg 时为 1，边界处为 0。 */
  function edgeFade(lon, lat, src, fadeDeg) {
    const d = Math.min(lon - src.west, src.east - lon, lat - src.south, src.north - lat);
    if (d >= fadeDeg) return 1;
    if (d <= 0) return 0;
    return smoothstep(d / fadeDeg);
  }

  function inBox(src, lon, lat) {
    return !!src && lon >= src.west && lon <= src.east && lat >= src.south && lat <= src.north;
  }

  /** 到 bbox 外部的距离（内部为 0）。 */
  function outsideDistance(src, lon, lat) {
    const dx = lon < src.west ? src.west - lon : lon > src.east ? lon - src.east : 0;
    const dy = lat < src.south ? src.south - lat : lat > src.north ? lat - src.north : 0;
    return Math.hypot(dx, dy);
  }

  function rectOverlaps(src, west, east, south, north) {
    return !!src && !(east < src.west || west > src.east || north < src.south || south > src.north);
  }

  function maybeRequestEastAsia() {
    if (state.deferHeavy) return; // 延迟加载大源：只能由 loadHeavySources() 显式触发
    if (state.eastasia || state.eastasiaLoading || state.eastasiaFailed) return;
    if (!state.highReady) return;
    ensureEastAsiaLoaded(state.le).catch(() => {});
  }

  function maybeRequestWorld() {
    if (state.deferHeavy) return; // 延迟加载大源：只能由 loadHeavySources() 显式触发
    if (state.world || state.worldLoading || state.worldFailed) return;
    if (!state.highReady) return;
    ensureWorldLoaded(state.le).catch(() => {});
  }

  /* --------------------------- 分级高度（不含夸张） --------------------------- */

  /** 全球 0.1° 源；纬度 ±85° 边缘 0.1° 内淡出到 0。 */
  function worldHeightAt(lon, lat) {
    const world = state.world;
    if (!world || !inBox(world, lon, lat)) return 0;
    const v = sourceHeightAt(world, lon, lat);
    const dLat = Math.min(lat - world.south, world.north - lat);
    if (dLat >= WORLD_LAT_FADE_DEG) return v;
    return v * smoothstep(dLat / WORLD_LAT_FADE_DEG);
  }

  /** 东亚 0.02° 源；bbox 边缘 0.05° 内与全球源平滑混合（无全球源时淡出到 0）。 */
  function eastAsiaHeightAt(lon, lat) {
    const ea = state.eastasia;
    if (!ea || !inBox(ea, lon, lat)) return 0;
    const v = sourceHeightAt(ea, lon, lat);
    const dEdge = Math.min(lon - ea.west, ea.east - lon, lat - ea.south, ea.north - lat);
    const t = smoothstep(clamp(dEdge / EASTASIA_EDGE_FADE_DEG, 0, 1));
    if (t >= 1) return v;
    if (!state.world) return v * t;
    return v * t + worldHeightAt(lon, lat) * (1 - t);
  }

  /**
   * 多源组合高度（米，未乘夸张）：
   * 1) 示例区 1″ → 高分辨率双线性（有更粗数据时保持原值，边界过渡在外侧处理）；
   * 2) 示例区外 0.02° 过渡带 → 高分辨率边缘延拓值 ↔ 下一级源平滑混合；
   * 3) 东亚 0.02° → 东亚网格，bbox 边缘与全球 0.05° 混合；
   * 4) 全球 0.1° → 全球网格，|lat| 接近 85° 时淡出；
   * 5) 其它（|lat|>85 等）→ 0。
   */
  function rawHeightAt(lon, lat) {
    const high = state.high;
    const eastasia = state.eastasia;
    const world = state.world;

    if (high && inBox(high, lon, lat)) {
      const v = sourceHeightAt(high, lon, lat);
      return eastasia || world ? v : v * edgeFade(lon, lat, high, EDGE_FADE_DEG);
    }

    if (high) {
      const dOut = outsideDistance(high, lon, lat);
      if (dOut > 0 && dOut < BLEND_DEG) {
        const hv = sourceHeightAt(high, lon, lat);
        const t = smoothstep(dOut / BLEND_DEG); // 0=示例区边缘，1=过渡带外沿
        if (eastasia && inBox(eastasia, lon, lat)) {
          return hv * (1 - t) + eastAsiaHeightAt(lon, lat) * t;
        }
        if (world && inBox(world, lon, lat)) return hv * (1 - t) + worldHeightAt(lon, lat) * t;
      }
    }

    if (eastasia && inBox(eastasia, lon, lat)) {
      maybeRequestEastAsia();
      return eastAsiaHeightAt(lon, lat);
    }

    if (world && inBox(world, lon, lat)) {
      maybeRequestWorld();
      return worldHeightAt(lon, lat);
    }

    // 需要更粗数据但尚未加载：后台开始加载（本次仍返回 0，不阻塞渲染）
    if (!eastasia) maybeRequestEastAsia();
    if (!world) maybeRequestWorld();
    return 0;
  }

  /** 地形高度（米）；已乘地形夸张系数。Provider 与 KML 贴地都走这里，保证一致。 */
  function heightAt(lon, lat) {
    if (!isFinite(lon) || !isFinite(lat)) return 0;
    // 快速路径：数据尚未加载/非有限坐标直接 0，避免每个瓦片采样点走完整优先级链
    if (!state.high && !state.eastasia && !state.world) return 0;
    return rawHeightAt(lon, lat) * state.exaggeration;
  }

  /** 返回某地形瓦片的高度数组（Float32Array，row-major，北→南，与 HeightmapTerrainData 约定一致）。 */
  function tileHeights(x, y, level) {
    const scheme = state.tilingScheme;
    const rect = scheme.tileXYToRectangle(x, y, level);
    const west = C.Math.toDegrees(rect.west);
    const east = C.Math.toDegrees(rect.east);
    const south = C.Math.toDegrees(rect.south);
    const north = C.Math.toDegrees(rect.north);
    const size = state.grid;
    const out = new Float32Array(size * size);
    const exag = state.exaggeration;

    // 快速路径 1：与已加载数据范围无交集 → 全 0（极区/区域外平地）
    const cover = state.world || state.eastasia || state.high;
    if (!cover) return out;
    if (!rectOverlaps(cover, west, east, south, north)) return out;

    // 快速路径 2：瓦片不与示例区/东亚相交（只会用到全球 0.1° 源）→ 直接单源采样，跳过组合分支
    if (state.world && !rectOverlaps(state.high, west, east, south, north) && !rectOverlaps(state.eastasia, west, east, south, north)) {
      for (let j = 0; j < size; j++) {
        const lat = north - ((north - south) * j) / (size - 1);
        const row = j * size;
        for (let i = 0; i < size; i++) {
          const lon = west + ((east - west) * i) / (size - 1);
          out[row + i] = worldHeightAt(lon, lat) * exag;
        }
      }
      return out;
    }

    // 快速路径 3：瓦片不与示例区相交（只会用到东亚/全球）→ 二分分支更少
    if (!rectOverlaps(state.high, west, east, south, north)) {
      for (let j = 0; j < size; j++) {
        const lat = north - ((north - south) * j) / (size - 1);
        const row = j * size;
        for (let i = 0; i < size; i++) {
          const lon = west + ((east - west) * i) / (size - 1);
          out[row + i] = (state.eastasia && inBox(state.eastasia, lon, lat) ? eastAsiaHeightAt(lon, lat) : worldHeightAt(lon, lat)) * exag;
        }
      }
      return out;
    }

    // 常规路径（示例区及其过渡带）
    // CustomHeightmapTerrainProvider/HeightmapTerrainData 约定：buffer 第一行是瓦片最北行（north→south）
    for (let j = 0; j < size; j++) {
      const lat = north - ((north - south) * j) / (size - 1);
      const row = j * size;
      for (let i = 0; i < size; i++) {
        const lon = west + ((east - west) * i) / (size - 1);
        out[row + i] = heightAt(lon, lat);
      }
    }
    return out;
  }

  function createProvider() {
    if (!state.tilingScheme) state.tilingScheme = new C.GeographicTilingScheme();
    const grid = state.grid;
    return new C.CustomHeightmapTerrainProvider({
      width: grid,
      height: grid,
      tilingScheme: state.tilingScheme,
      credit: 'SRTM / ETOPO / AWS Terrain Tiles (public domain, open data)',
      // 每个瓦片的高度采样延后到独立宏任务，避免大量瓦片在同一帧内同步计算造成长时间无响应；
      // Cesium 的 requestTileGeometry 支持 Promise 返回值。
      callback: function (x, y, level) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            let heights = null;
            try {
              heights = tileHeights(x, y, level);
            } catch (err) {
              console.warn('[LETerrain] 瓦片高度采样失败', err);
            }
            resolve(heights || new Float32Array(state.grid * state.grid));
          }, 0);
        });
      },
    });
  }

  function makeProvider() {
    state.provider = createProvider();
    state.providerExag = state.exaggeration;
    state.providerGrid = state.grid;
    return state.provider;
  }

  function ensureTiling() {
    if (!state.provider || state.providerGrid !== state.grid || state.providerExag !== state.exaggeration) {
      makeProvider();
    }
    return state.provider;
  }

  /**
   * 重建 Provider（Cesium 只在 provider 实例变化时重新请求瓦片），并重新贴地。
   * 触发条件：夸张系数或地形网格与当前 Provider 不一致（同值不重建）。
   * 通过 requestAnimationFrame + setTimeout(0) 延后执行，避免阻塞当前滑杆/点击事件；
   * 记录重建耗时到 console.debug 与 stats().perf。
   */
  function rebuildProvider(reason, force) {
    if (!state.enabled || !state.le || !state.highReady) return false;
    const stale = function () {
      if (force) return true; // 数据源集合变化（如 loadHeavySources 后）需要强制刷新
      return !state.provider || state.providerExag !== state.exaggeration || state.providerGrid !== state.grid;
    };
    if (!stale()) return false;
    if (state.rebuildPending) return true; // 已排队，执行时取最新 grid/exag
    state.rebuildPending = true;
    const run = function () {
      state.rebuildPending = false;
      if (!state.enabled || !state.le) return;
      if (!stale()) return;
      const t0 = performance.now();
      try {
        makeProvider();
        state.le.viewer.terrainProvider = state.provider;
        redrape(state.le);
        // 夸张后地形可能高于相机：重建后检查一次离地间隙，避免相机埋进山体造成卡顿
        ensureCameraClearance(state.le, 400);
        const ms = Math.round((performance.now() - t0) * 10) / 10;
        state.perf.lastRebuildMs = ms;
        state.perf.lastRebuildAt = Date.now();
        state.perf.rebuildCount += 1;
        state.perf.lastReason = reason || 'exaggeration';
        state.perf.grid = state.grid;
        state.perf.tileSamples = state.grid * state.grid;
        console.debug(
          '[LETerrain] rebuild ms=' + ms + ' grid=' + state.grid + ' exag=' + state.exaggeration + ' reason=' + (reason || 'exaggeration')
        );
        if (typeof state.le.status === 'function') {
          state.le.status('地形已重建（网格 ' + state.grid + '²，' + ms + ' ms）');
        }
      } catch (err) {
        console.warn('[LETerrain] 重建地形 Provider 失败', err);
      }
    };
    // 延后到下一帧 + 宏任务，先让当前 UI 事件（点击/滑杆松手）完成
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(run, 0));
    } else {
      setTimeout(run, 0);
    }
    return true;
  }

  /* ------------------------------ 数据加载 ------------------------------ */

  async function loadHigh() {
    if (state.high) return state.high;
    if (state.highLoading) return state.highLoading;
    state.highLoading = (async () => {
      const src = await loadSource(HIGH_META_URL, HIGH_FALLBACK_FILE);
      state.high = src;
      state.highReady = true;
      state.ready = true;
      return src;
    })();
    try {
      return await state.highLoading;
    } finally {
      state.highLoading = null;
    }
  }

  /** 懒加载东亚数据（约 28.5 MB）；失败时回退到全球/示例区，并 toast 提示。 */
  async function ensureEastAsiaLoaded(le) {
    if (state.eastasia) return true;
    if (state.eastasiaFailed) return false;
    if (state.eastasiaLoading) return state.eastasiaLoading;
    if (le) state.le = le;
    const target = state.le;
    state.eastasiaLoading = (async () => {
      if (target && typeof target.setLoading === 'function') {
        target.setLoading(true, '正在加载东亚地形数据（0.02°，约 28.5 MB）…');
      }
      if (target && typeof target.status === 'function') {
        target.status('正在加载东亚地形数据（0.02°，约 28.5 MB）…');
      }
      try {
        const src = await loadSource(EASTASIA_META_URL, EASTASIA_FALLBACK_FILE);
        state.eastasia = src;
        state.eastasiaReady = true;
        if (target && typeof target.status === 'function') {
          target.status('东亚地形数据已就绪（55–150E / 0–60N，0.02°）');
        }
        return true;
      } catch (err) {
        state.eastasiaFailed = true;
        console.error('[LETerrain] 东亚地形加载失败', err);
        if (target && typeof target.toast === 'function') {
          target.toast('东亚地形数据加载失败，已回退为全球/示例区地形：' + err.message, 'error', 6000);
        }
        if (target && typeof target.status === 'function') {
          target.status('东亚地形不可用，3D 地形仅覆盖全球/示例区', 'error');
        }
        return false;
      } finally {
        if (target && typeof target.setLoading === 'function') target.setLoading(false);
        state.eastasiaLoading = null;
      }
    })();
    return state.eastasiaLoading;
  }

  /** 懒加载全球数据（约 12 MB）；失败时继续用东亚/示例区，并 toast 提示。 */
  async function ensureWorldLoaded(le) {
    if (state.world) return true;
    if (state.worldFailed) return false;
    if (state.worldLoading) return state.worldLoading;
    if (le) state.le = le;
    const target = state.le;
    state.worldLoading = (async () => {
      if (target && typeof target.setLoading === 'function') {
        target.setLoading(true, '正在加载全球地形数据（0.1°，约 12 MB）…');
      }
      if (target && typeof target.status === 'function') {
        target.status('正在加载全球地形数据（0.1°，约 12 MB）…');
      }
      try {
        const src = await loadSource(WORLD_META_URL, WORLD_FALLBACK_FILE);
        state.world = src;
        state.worldReady = true;
        if (target && typeof target.status === 'function') {
          target.status('全球地形数据已就绪（-180–180E / -85–85N，0.1°）');
        }
        return true;
      } catch (err) {
        state.worldFailed = true;
        console.error('[LETerrain] 全球地形加载失败', err);
        if (target && typeof target.toast === 'function') {
          target.toast('全球地形数据加载失败，已回退为东亚/示例区地形：' + err.message, 'error', 6000);
        }
        if (target && typeof target.status === 'function') {
          target.status('全球地形不可用，3D 地形仅覆盖东亚/示例区', 'error');
        }
        return false;
      } finally {
        if (target && typeof target.setLoading === 'function') target.setLoading(false);
        state.worldLoading = null;
      }
    })();
    return state.worldLoading;
  }

  /** 首次开启地形时按需加载：东亚 → 全球（约 40 MB），并可被 loadHeavySources() 外部触发。 */
  async function ensureTerrainSources(le) {
    if (le) state.le = le;
    try {
      await ensureEastAsiaLoaded(state.le);
      await ensureWorldLoaded(state.le);
    } finally {
      state.heavyLoaded = true;
    }
    return state.eastasiaReady || state.worldReady;
  }

  /**
   * 显式加载东亚 + 全球大源（供性能调度器在空闲时调用；deferHeavy=true 时不会自动加载）。
   * 返回 Promise<{eastasia, world}>；失败已由 ensure* 内部 toast/回退，不再抛出。
   * 完成后刷新 provider（新源参与地形采样）与阴影/影像层顺序。
   */
  async function loadHeavySources(le) {
    if (le) state.le = le;
    if (state.heavyPromise) return state.heavyPromise;
    if (state.heavyLoaded && state.eastasiaReady && state.worldReady) {
      return { eastasia: true, world: true };
    }
    const target = state.le;
    state.heavyPromise = (async () => {
      try {
        await ensureTerrainSources(target);
      } catch (err) {
        console.warn('[LETerrain] 大范围地形加载失败（已回退）', err);
      } finally {
        state.heavyPromise = null;
      }
      if (state.enabled && state.le) {
        // 新源参与采样：强制刷新地形 Provider（延后执行，不阻塞当前任务）
        rebuildProvider('heavy-sources', true);
        syncTerrainLayers(state.le);
      }
      return { eastasia: state.eastasiaReady, world: state.worldReady };
    })();
    return state.heavyPromise;
  }

  /* ------------------------------ 卫星影像（三级覆盖） ------------------------------ */

  function findImageryLayer(le, name) {
    const layers = (le && le.listLayers && le.listLayers()) || [];
    for (let i = 0; i < layers.length; i++) {
      if (layers[i].name === name) return layers[i];
    }
    return null;
  }

  function addImageryLayer(le, spec) {
    if (!le || !le.viewer || !C.UrlTemplateImageryProvider) return null;
    const existing = findImageryLayer(le, spec.name);
    if (existing) return existing;
    // EOX Sentinel-2 cloudless 为 EPSG:3857（Web Mercator）瓦片，256×256 JPEG
    const provider = new C.UrlTemplateImageryProvider({
      url: IMAGERY_URL,
      tilingScheme: new C.WebMercatorTilingScheme(),
      rectangle: C.Rectangle.fromDegrees(spec.rectangle[0], spec.rectangle[1], spec.rectangle[2], spec.rectangle[3]),
      minimumLevel: spec.minLevel,
      maximumLevel: spec.maxLevel,
      tileWidth: 256,
      tileHeight: 256,
      // 数据覆盖外/缺失的 JPEG 瓦片按透明处理，避免在蓝马赛克底图上出现白色方块
      hasAlphaChannel: true,
      credit: IMAGERY_CREDIT,
    });
    // 低层级/范围外瓦片缺失时按透明处理，避免 Cesium 抛错刷屏（浏览器网络日志仍可能显示 404）
    try {
      provider.errorEvent.addEventListener(function (err) {
        console.debug('[LETerrain] imagery tile unavailable (' + spec.name + '): ' + (err && err.message ? err.message : err));
      });
    } catch (err) {
      /* ignore */
    }
    const imageryLayer = le.viewer.imageryLayers.addImageryProvider(provider);
    imageryLayer.alpha = spec.alpha;
    imageryLayer.show = true;
    return le.registerLayer({
      name: spec.name,
      type: 'imagery',
      imageryLayer,
      remove: () => le.viewer.imageryLayers.remove(imageryLayer, true),
      zoomTo: () =>
        le.flyTo({
          rectangle: C.Rectangle.fromDegrees(spec.rectangle[0], spec.rectangle[1], spec.rectangle[2], spec.rectangle[3]),
        }),
    });
  }

  function removeAllImageryLayers(le) {
    for (let i = 0; i < IMAGERY_LAYER_NAMES.length; i++) {
      const entry = findImageryLayer(le, IMAGERY_LAYER_NAMES[i]);
      if (entry) {
        try {
          le.removeLayer(entry.id);
        } catch (err) {
          console.warn('[LETerrain] 移除卫星影像失败', err);
        }
      }
    }
  }

  /** 当前 imageryDetail 档位启用的影像层（low: 主影像；medium: 主+宽域；high: 三层）。 */
  function activeImagerySpecs() {
    const count = state.imageryDetail === 'low' ? 1 : state.imageryDetail === 'medium' ? 2 : 3;
    return IMAGERY_LAYER_SPECS.slice(0, count);
  }

  /** 把当前档位启用的影像层按 主→宽域→超清 重新提到最上层（防止后挂载的阴影层压在影像上面）。 */
  function raiseActiveImagery(le) {
    le = le || state.le;
    if (!le || !le.viewer || !le.viewer.imageryLayers || !state.imageryEnabled) return;
    const active = activeImagerySpecs();
    for (let i = 0; i < active.length; i++) {
      const entry = findImageryLayer(le, active[i].name);
      if (entry && entry.imageryLayer) {
        try {
          le.viewer.imageryLayers.raiseToTop(entry.imageryLayer);
        } catch (err) {
          console.warn('[LETerrain] 提升影像层级失败', err);
        }
      }
    }
    // 本地影像（如北京正射）应保持在卫星影像之上；地形/画质切换后重新提层。
    try {
      if (window.LELocalImagery && typeof window.LELocalImagery.raiseAll === 'function') {
        window.LELocalImagery.raiseAll();
      }
    } catch (err) {
      console.warn('[LETerrain] 提升本地影像层级失败', err);
    }
  }

  /** 保证当前档位的影像层存在、可见，并按 主影像 → 宽域高清 → 超清 的顺序叠在最上层。 */
  function syncImagery(le) {
    le = le || state.le;
    if (!le || !le.viewer) return;
    if (!state.imageryEnabled) {
      removeAllImageryLayers(le);
      return;
    }
    const active = activeImagerySpecs();
    const activeNames = active.map((spec) => spec.name);
    // 该档位不需要的层移除（保证 low/medium/high 切换后图层数量正确、去重）
    for (let i = 0; i < IMAGERY_LAYER_NAMES.length; i++) {
      const name = IMAGERY_LAYER_NAMES[i];
      if (activeNames.indexOf(name) !== -1) continue;
      const extra = findImageryLayer(le, name);
      if (extra) {
        try {
          le.removeLayer(extra.id);
        } catch (err) {
          console.warn('[LETerrain] 移除影像层失败', err);
        }
      }
    }
    for (let i = 0; i < active.length; i++) {
      const spec = active[i];
      const entry = addImageryLayer(le, spec);
      if (!entry) continue;
      if (typeof entry.setVisible === 'function') entry.setVisible(true);
      else if (entry.imageryLayer) entry.imageryLayer.show = true;
      if (entry.imageryLayer) entry.imageryLayer.alpha = spec.alpha;
      if (entry.imageryLayer && le.viewer.imageryLayers) {
        try {
          le.viewer.imageryLayers.raiseToTop(entry.imageryLayer);
        } catch (err) {
          console.warn('[LETerrain] 提升卫星影像层级失败', err);
        }
      }
    }
    // 最后再按档位顺序统一提升一次，确保新增的宽域/超清不会压住主影像
    raiseActiveImagery(le);
  }

  /** 侧栏「卫星影像」开关；返回切换后的启用状态（同时控制主影像/宽域/超清三层）。 */
  function toggleImagery(le) {
    le = le || state.le;
    if (!le) return state.imageryEnabled;
    const anyVisible = IMAGERY_LAYER_NAMES.some((name) => {
      const entry = findImageryLayer(le, name);
      return entry && entry.visible !== false;
    });
    if (anyVisible) {
      state.imageryEnabled = false;
      removeAllImageryLayers(le);
    } else {
      state.imageryEnabled = true;
      syncImagery(le);
    }
    return state.imageryEnabled;
  }

  /* ------------------------------ 阴影图层 ------------------------------ */

  async function urlExists(url) {
    if (existsCache.has(url)) return existsCache.get(url);
    let ok = false;
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      ok = !!(res && res.ok);
    } catch (err) {
      ok = false;
    }
    existsCache.set(url, ok);
    return ok;
  }

  function findHillshadeLayer(le, name) {
    const layers = (le && le.listLayers && le.listLayers()) || [];
    for (let i = 0; i < layers.length; i++) {
      if (layers[i].name === name) return layers[i];
    }
    return null;
  }

  function removeHillshadeLayers(le) {
    const layers = (le.listLayers && le.listLayers()) || [];
    for (let i = 0; i < layers.length; i++) {
      if (HILLSHADE_REMOVE_NAMES.indexOf(layers[i].name) !== -1) {
        try {
          le.removeLayer(layers[i].id);
        } catch (err) {
          console.warn('[LETerrain] 移除地形阴影失败', err);
        }
      }
    }
    state.detailHillshadeMounted = false;
  }

  function cameraHeightOf(le) {
    try {
      return le.viewer.camera.positionCartographic.height;
    } catch (err) {
      return 0;
    }
  }

  function detailHillshadeAllowed(le) {
    // 性能档位（detailHillshade=false 时低档不挂）+ 相机高度（远景无细节需求）
    return state.detailHillshade && cameraHeightOf(le) <= DETAIL_HILLSHADE_MAX_HEIGHT;
  }

  function mountDetailHillshade(le) {
    if (state.detailHillshadeMounted) return;
    if (!state.highReady || !window.LELayers || typeof window.LELayers.addImageOverlay !== 'function') return;
    if (findHillshadeLayer(le, DETAIL_HILLSHADE_NAME)) {
      state.detailHillshadeMounted = true;
      return;
    }
    window.LELayers.addImageOverlay(le, {
      name: DETAIL_HILLSHADE_NAME,
      url: N25_HILLSHADE_URL,
      rectangle: N25_HILLSHADE_RECT,
      opacity: 1.0,
    });
    state.detailHillshadeMounted = true;
  }

  function unmountDetailHillshade(le) {
    if (!state.detailHillshadeMounted) return;
    const entry = findHillshadeLayer(le, DETAIL_HILLSHADE_NAME);
    if (entry) {
      try {
        le.removeLayer(entry.id);
      } catch (err) {
        console.warn('[LETerrain] 移除细节阴影失败', err);
      }
    }
    state.detailHillshadeMounted = false;
  }

  /** 相机离地安全抬升：夸张后地形可能高于相机（例如 6 km 高度、地面 2 km×3×），否则会出现“埋进山体”的瓦片风暴/卡死。 */
  function ensureCameraClearance(le, minClearance) {
    le = le || state.le;
    if (!le || !state.enabled || !le.viewer) return false;
    try {
      const cam = le.viewer.camera;
      const carto = cam.positionCartographic;
      if (!carto) return false;
      const lon = C.Math.toDegrees(carto.longitude);
      const lat = C.Math.toDegrees(carto.latitude);
      const ground = heightAt(lon, lat); // 已含夸张
      const clearance = minClearance == null ? 400 : minClearance;
      if (!isFinite(ground) || carto.height >= ground + clearance) return false;
      const newHeight = ground + clearance;
      const heading = cam.heading;
      const pitch = cam.pitch;
      const roll = cam.roll;
      cam.setView({
        destination: C.Cartesian3.fromDegrees(lon, lat, newHeight),
        orientation: { heading: heading, pitch: pitch, roll: roll },
      });
      console.debug('[LETerrain] camera clearance lift: ' + Math.round(carto.height) + 'm -> ' + Math.round(newHeight) + 'm (ground ' + Math.round(ground) + 'm)');
      return true;
    } catch (err) {
      console.warn('[LETerrain] 相机离地安全检查失败', err);
      return false;
    }
  }

  /** 相机高度跨阈值时挂载/卸载 N25 细节阴影（近景才需要，远景减少纹理与绘制调用）。 */
  function syncDetailHillshade(le) {
    le = le || state.le;
    if (!le || !state.enabled) return;
    const params = new URLSearchParams(location.search);
    if (params.get('hillshade') === '0') return;
    ensureCameraClearance(le, 400);
    if (detailHillshadeAllowed(le)) {
      mountDetailHillshade(le);
      syncImagery(le); // 新增阴影层可能在影像之上，重新把影像提到最上层
    } else {
      unmountDetailHillshade(le);
    }
  }

  function bindCameraTierChanges(le) {
    if (state.cameraHandlerBound || !le || !le.viewer) return;
    state.cameraHandlerBound = true;
    let timer = null;
    const handler = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        syncDetailHillshade(le);
      }, DETAIL_HILLSHADE_CHECK_MS);
    };
    try {
      le.viewer.camera.changed.addEventListener(handler);
    } catch (err) {
      console.warn('[LETerrain] 相机高度监听失败', err);
    }
  }

  /**
   * 3D 地形开启时按 world → eastasia → N25 细节 的顺序叠加阴影图（均为 opacity 1.0），
   * 关闭 / ?hillshade=0 时全部移除；按名称去重，避免重复叠加。
   * N25 细节只在相机低于 DETAIL_HILLSHADE_MAX_HEIGHT 时挂载（降低远景纹理/绘制开销）。
   */
  async function syncHillshade(le, on) {
    try {
      removeHillshadeLayers(le);
      if (!on) return;
      const params = new URLSearchParams(location.search);
      if (params.get('hillshade') === '0') return;
      if (!window.LELayers || typeof window.LELayers.addImageOverlay !== 'function') return;

      const overlays = [];

      // 1) 全球底图阴影
      if (state.worldReady && state.world) {
        const url = state.world.hillshadeUrl || WORLD_HILLSHADE_URL;
        if (await urlExists(url)) {
          overlays.push({
            name: WORLD_HILLSHADE_NAME,
            url,
            rectangle: [state.world.west, state.world.south, state.world.east, state.world.north],
            opacity: 1.0,
          });
        }
      }

      // 2) 东亚 0.02° 覆盖
      if (state.eastasiaReady && state.eastasia) {
        const url = state.eastasia.hillshadeUrl || EASTASIA_HILLSHADE_FALLBACK_URL;
        if (await urlExists(url)) {
          overlays.push({
            name: EASTASIA_HILLSHADE_NAME,
            url,
            rectangle: [state.eastasia.west, state.eastasia.south, state.eastasia.east, state.eastasia.north],
            opacity: 1.0,
          });
        }
      }

      // 3) 示例区 N25 高精度细节（近景才挂载，≈54 m/px）
      if (detailHillshadeAllowed(le) && (await urlExists(N25_HILLSHADE_URL))) {
        overlays.push({
          name: DETAIL_HILLSHADE_NAME,
          url: N25_HILLSHADE_URL,
          rectangle: N25_HILLSHADE_RECT,
          opacity: 1.0,
        });
        state.detailHillshadeMounted = true;
      }

      if (!overlays.length) return;
      // 异步检查期间地形可能已被关闭，避免“关了又出现阴影层”
      if (!state.enabled) return;
      for (const overlay of overlays) window.LELayers.addImageOverlay(le, overlay);
    } catch (err) {
      console.warn('[LETerrain] 阴影图同步失败', err);
    }
  }

  /** 阴影层全部就绪后，把卫星影像提到最上层（确保“影像在地形阴影之上”）。 */
  async function syncTerrainLayers(le) {
    await syncHillshade(le, true);
    syncImagery(le);
  }

  /* ------------------------------ 开关与初始化 ------------------------------ */

  function redrape(le) {
    if (window.LEKml && typeof window.LEKml.redrape === 'function') {
      try {
        window.LEKml.redrape(le.viewer);
      } catch (err) {
        console.warn(err);
      }
    }
  }

  function apply(le) {
    le = le || state.le;
    if (!le) return false;
    if (!state.highReady) return false;

    // 直接调用 apply（未经过 init/toggle）时，后台懒加载更粗的源，就绪后刷地形瓦片；
    // deferHeavy=true（性能档位）时绝不自动加载大源，等 loadHeavySources() 显式触发。
    const eaMissing = !state.eastasia && !state.eastasiaFailed;
    const worldMissing = !state.world && !state.worldFailed;
    if (!state.deferHeavy && (eaMissing || worldMissing)) {
      ensureTerrainSources(le)
        .then((ok) => {
          if (ok && state.enabled && state.le) {
            try {
              makeProvider();
              state.le.viewer.terrainProvider = state.provider;
            } catch (err) {
              console.warn(err);
            }
            syncTerrainLayers(state.le);
            redrape(state.le);
          }
        })
        .catch(() => {});
    }

    le.viewer.terrainProvider = ensureTiling();
    le.viewer.scene.globe.depthTestAgainstTerrain = true;
    // 粗网格地形在掠射角下会因背面剔除露出黑洞；关闭背面剔除后显示真实地表
    le.viewer.scene.globe.backFaceCulling = false;
    state.enabled = true;
    bindCameraTierChanges(le);
    syncTerrainLayers(le);
    redrape(le);

    const parts = [];
    if (state.worldReady) parts.push('全球 0.1°');
    if (state.eastasiaReady) parts.push('东亚 0.02°');
    parts.push('示例区 1″');
    const exagDesc = state.exaggeration !== 1 ? '，夸张 ' + state.exaggeration.toFixed(1) + '×' : '';
    const heavyDesc = state.deferHeavy && !state.eastasiaReady && !state.worldReady ? '，大范围地形按需加载' : '';
    if (typeof le.status === 'function') {
      le.status('3D 地形已开启（' + parts.join(' + ') + '，网格 ' + state.grid + '²' + exagDesc + heavyDesc + '；箭头按地形高度贴地）');
    }
    return true;
  }

  function disable(le) {
    le = le || state.le;
    if (!le) return;
    le.viewer.terrainProvider = new C.EllipsoidTerrainProvider();
    le.viewer.scene.globe.depthTestAgainstTerrain = false;
    le.viewer.scene.globe.backFaceCulling = true;
    state.enabled = false;
    syncHillshade(le, false);
    state.detailHillshadeMounted = false;
    redrape(le);
    if (typeof le.status === 'function') le.status('3D 地形已关闭（椭球地形）');
  }

  async function ensureLoaded(le) {
    if (le) state.le = le;
    await loadHigh();
    return state.highReady;
  }

  async function toggle(le) {
    le = le || state.le;
    if (!le) return;
    if (state.enabled) {
      disable(le);
      return false;
    }
    await ensureLoaded(le);
    // 首次开启时懒加载东亚 + 全球数据（约 40 MB）；deferHeavy 时只加载 N25，等 loadHeavySources()
    if (!state.deferHeavy) {
      await ensureTerrainSources(le);
    }
    return apply(le);
  }

  async function init(le) {
    state.le = le;
    try {
      const params = new URLSearchParams(location.search);
      if (params.get('imagery') === '0') state.imageryEnabled = false;

      // 地形夸张：URL ?exag= 优先于 localStorage
      const exagParam = params.get('exag');
      if (exagParam != null && exagParam !== '') {
        const v = Number(exagParam);
        if (isFinite(v)) state.exaggeration = normalizeExaggeration(v);
      } else {
        const stored = readStoredExaggeration();
        if (stored != null) state.exaggeration = stored;
      }

      await ensureLoaded(le);
      if (params.get('terrain') !== '0') {
        // deferHeavy=true（性能档位）：只 await N25（≈2.1MB），不 await 东亚/全球（≈40MB）；
        // 大范围地形由 LEPerf 空闲时调用 loadHeavySources() 触发。
        if (!state.deferHeavy) {
          await ensureTerrainSources(le);
        }
        apply(le);
      } else {
        // 不开启地形时仍可按需显示卫星影像（独立图层）
        syncImagery(le);
      }
    } catch (err) {
      console.error('[LETerrain] 初始化失败', err);
      if (le && typeof le.toast === 'function') {
        le.toast('3D 地形加载失败：' + err.message, 'error', 5000);
      }
    }
  }

  /* ------------------------------ 夸张设置 ------------------------------ */

  function setExaggeration(value) {
    const next = normalizeExaggeration(value);
    // 先持久化（拖动/重置都记忆），再由节流重建 Provider
    writeStoredExaggeration(next);
    if (next === state.exaggeration) return state.exaggeration;
    state.exaggeration = next;
    if (state.exagTimer) clearTimeout(state.exagTimer);
    state.exagTimer = setTimeout(() => {
      state.exagTimer = null;
      rebuildProvider();
    }, EXAG_REBUILD_DELAY);
    return state.exaggeration;
  }

  function getExaggeration() {
    return state.exaggeration;
  }

  /* ------------------------------ 性能档位 ------------------------------ */

  function normalizeGrid(value) {
    const n = Number(value);
    if (!isFinite(n)) return state.grid;
    let best = QUALITY_GRIDS[0];
    let bestD = Infinity;
    for (let i = 0; i < QUALITY_GRIDS.length; i++) {
      const d = Math.abs(QUALITY_GRIDS[i] - n);
      if (d < bestD) {
        bestD = d;
        best = QUALITY_GRIDS[i];
      }
    }
    return best;
  }

  function normalizeImageryDetail(value) {
    const s = String(value == null ? '' : value).toLowerCase();
    return QUALITY_IMAGERY_LEVELS.indexOf(s) !== -1 ? s : state.imageryDetail;
  }

  /** deferHeavy 关闭后，若地形已开启且大源尚未加载，则后台补加载（不阻塞调用方）。 */
  function maybeTriggerHeavyLoad() {
    if (state.deferHeavy) return;
    if (state.eastasiaReady && state.worldReady) return;
    if (!state.enabled || !state.highReady) return;
    loadHeavySources(state.le).catch(() => {});
  }

  /**
   * 性能档位 API（供 js/perf.js 调用，init 之前调用也安全：只记录配置，不重建/不加载）：
   *   setQuality({ grid: 17|33|49, detailHillshade: boolean, imageryDetail: 'low'|'medium'|'high', deferHeavy: boolean })
   * 返回是否已生效（配置被接受）；grid 变化的 Provider 重建异步/延后执行。
   */
  function setQuality(options) {
    if (!options || typeof options !== 'object') return false;
    let changed = false;
    let gridChanged = false;
    let detailChanged = false;
    let imageryChanged = false;
    let deferChanged = false;

    if (options.grid != null) {
      const g = normalizeGrid(options.grid);
      if (g !== state.grid) {
        state.grid = g;
        gridChanged = true;
        changed = true;
      }
    }
    if (options.detailHillshade != null) {
      const d = !!options.detailHillshade;
      if (d !== state.detailHillshade) {
        state.detailHillshade = d;
        detailChanged = true;
        changed = true;
      }
    }
    if (options.imageryDetail != null) {
      const lv = normalizeImageryDetail(options.imageryDetail);
      if (lv !== state.imageryDetail) {
        state.imageryDetail = lv;
        imageryChanged = true;
        changed = true;
      }
    }
    if (options.deferHeavy != null) {
      const d = !!options.deferHeavy;
      if (d !== state.deferHeavy) {
        state.deferHeavy = d;
        deferChanged = true;
        changed = true;
      }
    }
    if (!changed) return true;

    state.perf.grid = state.grid;
    state.perf.tileSamples = state.grid * state.grid;

    // init 之前（state.le 为空）只记录配置：不建 Provider、不加载数据，避免拖慢首屏
    if (state.le && state.enabled) {
      if (gridChanged) rebuildProvider('quality-grid');
      if (detailChanged) syncDetailHillshade(state.le);
      if (imageryChanged) syncImagery(state.le);
      raiseActiveImagery(state.le);
      // 重建/挂载可能延后到下一帧：再补一次置顶，保证阴影层不会压住影像
      setTimeout(() => {
        if (state.le && state.enabled) raiseActiveImagery(state.le);
      }, 350);
    } else if (state.le) {
      if (imageryChanged) syncImagery(state.le);
      // grid/detail 在下次 apply（开启地形）时按新配置创建
    }
    if (deferChanged && !state.deferHeavy) maybeTriggerHeavyLoad();
    return true;
  }

  function getQuality() {
    return {
      grid: state.grid,
      detailHillshade: state.detailHillshade,
      imageryDetail: state.imageryDetail,
      deferHeavy: state.deferHeavy,
    };
  }

  /* ------------------------------ 公开 API ------------------------------ */

  function sourceStats(src) {
    if (!src) return null;
    return {
      bbox: [src.west, src.south, src.east, src.north],
      width: src.width,
      height: src.height,
      resolutionDeg: src.resolutionDeg,
      minHeight: src.meta.minHeight,
      maxHeight: src.meta.maxHeight,
      rowOrder: src.meta.rowOrder,
      file: src.meta.file,
      hillshade: src.hillshadeUrl,
    };
  }

  function sourceState(src, ready, failed, loading) {
    return {
      ready,
      failed,
      loading: !!loading,
      source: sourceStats(src),
    };
  }

  function imageryStats(le) {
    const layers = IMAGERY_LAYER_SPECS.map((spec) => {
      const entry = findImageryLayer(le, spec.name);
      return {
        name: spec.name,
        rectangle: spec.rectangle,
        minLevel: spec.minLevel,
        maxLevel: spec.maxLevel,
        alpha: spec.alpha,
        present: !!entry,
        visible: entry ? entry.visible !== false : false,
      };
    });
    return {
      enabled: state.imageryEnabled,
      quality: state.imageryDetail,
      layers,
      layer: !!findImageryLayer(le, IMAGERY_MAIN_NAME),
      url: IMAGERY_URL,
      credit: IMAGERY_CREDIT,
    };
  }

  window.LETerrain = {
    init,
    ensureLoaded,
    apply,
    disable,
    toggle,
    heightAt,
    isEnabled: () => state.enabled,
    isReady: () => state.ready,
    setExaggeration,
    getExaggeration,
    rebuildProvider,
    toggleImagery,
    isImageryEnabled: () => state.imageryEnabled,
    setQuality,
    getQuality,
    loadHeavySources,
    stats: () => ({
      ready: state.ready,
      enabled: state.enabled,
      exaggeration: state.exaggeration,
      quality: getQuality(),
      grid: state.grid,
      heavyLoaded: state.heavyLoaded,
      heavyLoading: !!state.heavyPromise,
      providerGrid: state.providerGrid,
      perf: {
        lastRebuildMs: state.perf.lastRebuildMs,
        lastRebuildAt: state.perf.lastRebuildAt,
        rebuildCount: state.perf.rebuildCount,
        lastReason: state.perf.lastReason,
        grid: state.perf.grid,
        tileSamples: state.perf.tileSamples,
        providerExag: state.providerExag,
        providerGrid: state.providerGrid,
        rebuildPending: state.rebuildPending,
      },
      loading: {
        high: !!state.highLoading,
        eastasia: !!state.eastasiaLoading,
        world: !!state.worldLoading,
      },
      // 兼容旧字段：默认返回示例区源信息
      meta: state.high
        ? {
            bbox: [state.high.west, state.high.south, state.high.east, state.high.north],
            width: state.high.width,
            height: state.high.height,
            minHeight: state.high.meta.minHeight,
            maxHeight: state.high.meta.maxHeight,
          }
        : null,
      high: sourceStats(state.high),
      eastasia: sourceState(state.eastasia, state.eastasiaReady, state.eastasiaFailed, state.eastasiaLoading),
      // 兼容旧字段（内容为东亚源；china-terrain 文件保留但不再加载）
      china: sourceState(state.eastasia, state.eastasiaReady, state.eastasiaFailed, state.eastasiaLoading),
      world: sourceState(state.world, state.worldReady, state.worldFailed, state.worldLoading),
      imagery: imageryStats(state.le),
      detailHillshadeMounted: state.detailHillshadeMounted,
      provider: state.provider ? state.provider.constructor.name : null,
      tilingScheme: state.tilingScheme ? state.tilingScheme.constructor.name : null,
    }),
  };
})();

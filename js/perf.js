/*
 * 本地地球 · 性能调度器（LEPerf）
 * - 自动探测设备性能（GPU/核心数/内存/移动端），选择 高画质 / 均衡 / 流畅
 * - 自动根据实时帧率降级，避免开项目后浏览卡死
 * - 提供手动切换（性能按钮）、?perf=auto|high|medium|low、localStorage 记忆
 * - 调用地形（LETerrain.setQuality）与 KML 点云（LEKml.setQuality）降载接口
 */
(function () {
  'use strict';

  const MODE_ORDER = ['auto', 'low', 'medium', 'high'];
  const MODE_LABEL = { auto: '自动', low: '流畅', medium: '均衡', high: '高画质' };
  const PROFILES = {
    high: {
      resolutionScale: 1.0,
      screenSpaceError: 2.0,
      grid: 49,
      detailHillshade: true,
      imageryDetail: 'high',
      pointSubsample: 1,
      heavy: true,
    },
    medium: {
      resolutionScale: 0.85,
      screenSpaceError: 3.0,
      grid: 33,
      detailHillshade: true,
      imageryDetail: 'medium',
      pointSubsample: 2,
      heavy: true,
    },
    low: {
      resolutionScale: 0.7,
      screenSpaceError: 5.0,
      grid: 17,
      detailHillshade: false,
      imageryDetail: 'low',
      pointSubsample: 4,
      heavy: false,
    },
  };
  const STORE_KEY = 'localEarth.perfMode';
  const state = {
    mode: 'auto',
    tier: 'medium',
    effective: 'medium',
    le: null,
    pending: false,
    frames: 0,
    windowStart: 0,
    lowWindows: 0,
    highWindows: 0,
    lastApply: 0,
    heavyScheduled: false,
    timer: null,
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function readStoredMode() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(STORE_KEY);
      if (raw && MODE_ORDER.indexOf(raw) >= 0) return raw;
    } catch (err) {
      /* ignore */
    }
    return null;
  }

  function writeStoredMode(mode) {
    try {
      if (window.localStorage) window.localStorage.setItem(STORE_KEY, mode);
    } catch (err) {
      /* ignore */
    }
  }

  function detectGPU() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return '';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const info = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return String(info || '');
    } catch (err) {
      return '';
    }
  }

  function detectTier() {
    const gpu = detectGPU().toLowerCase();
    const cores = Number(navigator.hardwareConcurrency) || 4;
    const mem = Number(navigator.deviceMemory) || 4;
    const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent || '');
    if (!gpu) return 'medium';
    if (/swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(gpu)) return 'low';
    if (mobile && (cores <= 6 || mem <= 4)) return 'low';
    let score = 0;
    if (cores >= 8) score += 2;
    else if (cores >= 6) score += 1;
    else if (cores <= 4) score -= 1;
    if (mem >= 8) score += 2;
    else if (mem >= 6) score += 1;
    else if (mem <= 4) score -= 1;
    if (/nvidia|geforce|radeon|rx \d|apple m\d|arc|discrete/i.test(gpu)) score += 2;
    else if (/intel|uhd|iris|vega|mali|adreno/i.test(gpu)) score += 0;
    if (mobile) score -= 2;
    if (score >= 4) return 'high';
    if (score <= -1) return 'low';
    return 'medium';
  }

  function profileFor(mode) {
    const m = mode === 'auto' ? state.tier : mode;
    return { key: m, ...PROFILES[m] };
  }

  function updateButton() {
    const btn = byId('btn-perf');
    if (!btn) return;
    const label = MODE_LABEL[state.mode] || '自动';
    const eff = state.mode === 'auto' ? '·' + MODE_LABEL[state.effective] : '';
    btn.textContent = '性能：' + label + eff;
    btn.title =
      '性能模式：' +
      label +
      (state.mode === 'auto' ? '（当前实际：' + MODE_LABEL[state.effective] + '）' : '') +
      '；点击切换 自动 → 流畅 → 均衡 → 高画质';
  }

  function notify(text) {
    const le = state.le;
    if (le && typeof le.toast === 'function') le.toast(text, 'info', 3500);
  }

  function scheduleHeavyLoad(profile) {
    if (!profile.heavy || state.heavyScheduled) return;
    state.heavyScheduled = true;
    const run = () => {
      try {
        const T = window.LETerrain;
        if (T && typeof T.loadHeavySources === 'function') {
          T.loadHeavySources().catch(() => {});
        }
      } catch (err) {
        console.warn('[LEPerf] 后台地形数据加载失败', err);
      }
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 4000 });
    } else {
      setTimeout(run, 2500);
    }
  }

  function applyProfile(profile, reason) {
    const le = state.le;
    state.effective = profile.key;
    state.lastApply = Date.now();
    try {
      const viewer = le && le.viewer;
      if (viewer) {
        viewer.resolutionScale = profile.resolutionScale;
        if (viewer.scene && viewer.scene.globe) {
          viewer.scene.globe.maximumScreenSpaceError = profile.screenSpaceError;
        }
      }
      const T = window.LETerrain;
      if (T && typeof T.setQuality === 'function') {
        T.setQuality({
          grid: profile.grid,
          detailHillshade: profile.detailHillshade,
          imageryDetail: profile.imageryDetail,
          deferHeavy: true,
        });
      }
      const K = window.LEKml;
      if (K && typeof K.setQuality === 'function') {
        K.setQuality({ pointSubsample: profile.pointSubsample });
      }
      scheduleHeavyLoad(profile);
    } catch (err) {
      console.warn('[LEPerf] 应用性能档位失败', err);
    }
    updateButton();
    if (reason === 'auto') {
      notify('已自动切换到「' + MODE_LABEL[state.effective] + '」模式，保证浏览流畅');
    }
  }

  function currentProfile() {
    return profileFor(state.mode);
  }

  function apply() {
    applyProfile(currentProfile());
  }

  function cycleMode() {
    const idx = MODE_ORDER.indexOf(state.mode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    setMode(next, 'manual');
    return next;
  }

  function setMode(mode, reason) {
    if (MODE_ORDER.indexOf(mode) < 0) mode = 'auto';
    state.mode = mode;
    writeStoredMode(mode);
    if (mode === 'auto') state.tier = detectTier();
    state.lowWindows = 0;
    state.highWindows = 0;
    applyProfile(currentProfile(), reason);
    return mode;
  }

  function onFrame() {
    const scene = state.le && state.le.viewer && state.le.viewer.scene;
    if (!scene || scene.mode === 2 || scene.mode === 1) return; // 2D/哥伦布视图不统计
    const now = performance.now();
    if (!state.windowStart) state.windowStart = now;
    state.frames += 1;
    const elapsed = now - state.windowStart;
    if (elapsed < 1800) return;
    const fps = (state.frames * 1000) / elapsed;
    state.frames = 0;
    state.windowStart = now;
    if (state.mode !== 'auto') return;
    if (fps < 16) {
      state.lowWindows += 1;
      state.highWindows = 0;
      if (state.lowWindows >= 2 && state.effective !== 'low') {
        const next = state.effective === 'high' ? 'medium' : 'low';
        state.tier = next;
        state.lowWindows = 0;
        applyProfile(profileFor(next), 'auto');
      }
    } else if (fps > 50) {
      state.highWindows += 1;
      state.lowWindows = 0;
      if (state.highWindows >= 6 && state.effective !== 'high') {
        const next = state.effective === 'low' ? 'medium' : 'high';
        state.tier = next;
        state.highWindows = 0;
        applyProfile(profileFor(next));
      }
    } else {
      state.lowWindows = 0;
      state.highWindows = 0;
    }
  }

  function bindButton() {
    const btn = byId('btn-perf');
    if (!btn) return;
    btn.addEventListener('click', () => {
      cycleMode();
    });
  }

  /** 在 LETerrain.init 之前调用：只做设备探测、按档位设置 deferHeavy / grid，避免启动加载 40MB */
  function preboot() {
    const params = new URLSearchParams(location.search);
    const urlMode = params.get('perf');
    const stored = readStoredMode();
    state.mode = urlMode && MODE_ORDER.indexOf(urlMode) >= 0 ? urlMode : stored || 'auto';
    if (urlMode) writeStoredMode(urlMode);
    state.tier = detectTier();
    const p = currentProfile();
    state.effective = p.key;
    try {
      const T = window.LETerrain;
      if (T && typeof T.setQuality === 'function') {
        T.setQuality({
          grid: p.grid,
          detailHillshade: p.detailHillshade,
          imageryDetail: p.imageryDetail,
          deferHeavy: true,
        });
      }
    } catch (err) {
      /* ignore */
    }
    return p.key;
  }

  function init(le) {
    state.le = le;
    if (!le || !le.viewer) return;
    const params = new URLSearchParams(location.search);
    const urlMode = params.get('perf');
    if (urlMode && MODE_ORDER.indexOf(urlMode) >= 0) state.mode = urlMode;
    state.tier = detectTier();
    bindButton();
    applyProfile(currentProfile());
    try {
      le.viewer.scene.postRender.addEventListener(onFrame);
    } catch (err) {
      console.warn('[LEPerf] 帧率监听失败', err);
    }
    console.info(
      '[LEPerf] GPU=' + detectGPU() + ' cores=' + navigator.hardwareConcurrency + ' tier=' + state.tier + ' mode=' + state.mode
    );
  }

  window.LEPerf = {
    preboot,
    init,
    setMode,
    cycleMode,
    getMode: () => state.mode,
    getTier: () => state.tier,
    getEffective: () => state.effective,
    getProfile: () => ({ ...currentProfile() }),
  };
})();

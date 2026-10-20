/*
 * 侧栏与对话框（Lead 版基础实现，tools-dev 在此扩展）
 * 对外 API：window.LEUI
 *   init(le)
 *   refreshLayers(layers)
 *   toggleHelp(show)
 *   promptGoto()
 *   showInfo(entity)
 */
(function () {
  'use strict';

  const C = window.Cesium;
  const state = { le: null, infoTimer: null };

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function refreshLayers(layers) {
    // P1：图层管理器接管渲染（搜索/分组/透明度/上下移）；失败时回退到基础列表
    if (window.LELayerPanel && typeof window.LELayerPanel.refresh === 'function') {
      try {
        window.LELayerPanel.refresh(layers);
        return;
      } catch (err) {
        console.warn('[LEUI] 图层管理器渲染失败，回退基础列表', err);
      }
    }
    const list = document.getElementById('layer-list');
    const count = document.getElementById('layer-count');
    if (!list) return;
    const visible = (layers || []).filter((l) => !l.system);
    if (count) count.textContent = String(visible.length);
    if (!visible.length) {
      list.innerHTML = '<li class="layer-empty">暂无图层，拖放文件或点击“打开数据”</li>';
      return;
    }
    list.innerHTML = visible
      .map((l) => {
        const typeLabel = l.type === 'imagery' ? '影像' : l.type === 'vector' ? '矢量' : l.type;
        return (
          '<li class="layer-item" data-id="' + escapeHtml(l.id) + '">' +
          '<button class="eye ' + (l.visible ? 'on' : '') + '" title="显示/隐藏">' +
          (l.visible ? '●' : '○') +
          '</button>' +
          '<span class="layer-name" title="' + escapeHtml(l.name) + '">' + escapeHtml(l.name) + '</span>' +
          '<span class="layer-type">' + escapeHtml(typeLabel) + '</span>' +
          '<button class="zoom" title="缩放到图层">⌖</button>' +
          '<button class="zoom" title="移除">✕</button>' +
          '</li>'
        );
      })
      .join('');

    Array.from(list.querySelectorAll('.layer-item')).forEach((row) => {
      const id = row.dataset.id;
      const layer = (layers || []).find((l) => l.id === id);
      if (!layer) return;
      const btns = row.querySelectorAll('button');
      const eyeBtn = btns[0];
      const zoomBtn = btns[1];
      const removeBtn = btns[2];
      eyeBtn.addEventListener('click', () => layer.setVisible(!layer.visible));
      zoomBtn.addEventListener('click', () => {
        if (typeof layer.zoomTo === 'function') {
          try { layer.zoomTo(); } catch (err) { console.warn(err); }
        }
      });
      removeBtn.addEventListener('click', () => state.le.removeLayer(id));
      row.querySelector('.layer-name').addEventListener('click', () => {
        if (typeof layer.zoomTo === 'function') {
          try { layer.zoomTo(); } catch (err) { console.warn(err); }
        }
      });
    });
  }

  function toggleHelp(show) {
    const dlg = document.getElementById('help-dialog');
    if (!dlg) return;
    const next = show == null ? dlg.classList.contains('hidden') : !!show;
    dlg.classList.toggle('hidden', !next);
  }

  /* ------------------------------ 飞到坐标 ------------------------------ */

  function buildGotoDialog() {
    let dlg = document.getElementById('goto-dialog');
    if (dlg) return dlg;
    dlg = document.createElement('div');
    dlg.id = 'goto-dialog';
    dlg.className = 'modal hidden';
    dlg.innerHTML =
      '<div class="modal-card">' +
      '<h2>飞到坐标</h2>' +
      '<div class="field"><label for="goto-lat">纬度</label><input id="goto-lat" type="text" placeholder="39.909" /></div>' +
      '<div class="field"><label for="goto-lon">经度</label><input id="goto-lon" type="text" placeholder="116.397" /></div>' +
      '<div class="field"><label for="goto-height">高度</label><input id="goto-height" type="text" placeholder="5000（米，可空）" /></div>' +
      '<div class="error" id="goto-error"></div>' +
      '<div class="actions"><button class="btn" id="goto-cancel">取消</button><button class="btn primary" id="goto-ok">飞到</button></div>' +
      '</div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#goto-cancel').addEventListener('click', () => dlg.classList.add('hidden'));
    dlg.addEventListener('click', (ev) => {
      if (ev.target === dlg) dlg.classList.add('hidden');
    });
    dlg.querySelector('#goto-ok').addEventListener('click', submitGoto);
    dlg.querySelectorAll('input').forEach((input) => {
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') submitGoto();
      });
    });
    return dlg;
  }

  function submitGoto() {
    const dlg = document.getElementById('goto-dialog');
    const errEl = dlg.querySelector('#goto-error');
    const lat = parseFloat(dlg.querySelector('#goto-lat').value);
    const lon = parseFloat(dlg.querySelector('#goto-lon').value);
    const heightRaw = dlg.querySelector('#goto-height').value.trim();
    const height = heightRaw ? parseFloat(heightRaw) : 5000;
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      errEl.textContent = '请输入有效纬度（-90~90）与经度（-180~180）';
      return;
    }
    if (!isFinite(height) || height < 0) {
      errEl.textContent = '高度需为非负数字';
      return;
    }
    errEl.textContent = '';
    dlg.classList.add('hidden');
    state.le.flyTo({ longitude: lon, latitude: lat, height });
    state.le.status('已飞到 ' + lat + ', ' + lon);
  }

  function promptGoto() {
    const dlg = buildGotoDialog();
    dlg.classList.remove('hidden');
    const lat = dlg.querySelector('#goto-lat');
    lat.focus();
    lat.select();
  }

  /* ------------------------------- 信息展示 ------------------------------- */

  function showInfo(entity) {
    const le = state.le;
    if (!le || !entity) return;
    const name = entity.name || '未命名地物';
    let desc = '';
    try {
      if (entity.description && typeof entity.description.getValue === 'function') {
        desc = String(entity.description.getValue(C.JulianDate.now()) || '');
      } else if (typeof entity.description === 'string') {
        desc = entity.description;
      }
    } catch (_) {}
    desc = desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (desc.length > 140) desc = desc.slice(0, 140) + '…';
    le.toast(name + (desc ? ' — ' + desc : ''), null, 4200);
  }

  /* ------------------------------- 初始化 ------------------------------- */

  function bindShortcuts(le) {
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        toggleHelp(false);
        const gotoDlg = document.getElementById('goto-dialog');
        if (gotoDlg) gotoDlg.classList.add('hidden');
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'f') {
        ev.preventDefault();
        const input = document.getElementById('search-input');
        if (input) {
          input.focus();
          input.select();
        }
      }
      if (ev.key === '?' && !ev.ctrlKey && !ev.metaKey && document.activeElement.tagName !== 'INPUT') {
        toggleHelp();
      }
    });
  }

  /* --------------------------- 公开数据（离线） --------------------------- */

  function bindPublicData(le) {
    const addVector = async (url, message) => {
      if (!window.LEImports || typeof window.LEImports.importUrl !== 'function') return;
      le.setLoading(true, message || '正在加载本地数据…');
      try {
        await window.LEImports.importUrl(url);
        le.status('已加载：' + url.split('/').pop());
      } catch (err) {
        console.error(err);
        le.toast('加载失败：' + (err && err.message ? err.message : err), 'error', 5000);
      } finally {
        le.setLoading(false);
      }
    };

    const bind = (id, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', handler);
    };

    bind('btn-pub-admin0', () =>
      addVector('data/public/vectors/ne_10m_admin_0_countries.geojson', '正在加载详细国界…')
    );
    bind('btn-pub-rivers', () =>
      addVector('data/public/vectors/ne_10m_rivers_lake_centerlines.geojson', '正在加载河流…')
    );
    bind('btn-pub-lakes', () =>
      addVector('data/public/vectors/ne_10m_lakes.geojson', '正在加载湖泊…')
    );
    bind('btn-pub-places', () =>
      addVector('data/public/vectors/ne_10m_populated_places_simple.geojson', '正在加载城市…')
    );
    bind('btn-pub-dem', () => {
      try {
        window.LELayers.addImageOverlay(le, {
          name: 'SRTM 地形阴影（102–103E, 25–26N）',
          url: 'data/public/dem/N25E102-hillshade.png',
          rectangle: [102, 25, 103, 26],
          opacity: 0.9,
        });
        le.flyTo({ rectangle: window.Cesium.Rectangle.fromDegrees(102, 25, 103, 26) });
        le.status('已加载 SRTM 地形阴影（示例区）');
      } catch (err) {
        le.toast('地形阴影加载失败：' + err.message, 'error', 5000);
      }
    });
    bind('btn-terrain', async () => {
      if (!window.LETerrain) return;
      try {
        const enabled = await window.LETerrain.toggle(le);
        le.toast(enabled ? '3D 地形已开启：箭头按地形高度贴地' : '3D 地形已关闭', 'ok', 3000);
      } catch (err) {
        console.error(err);
        le.toast('3D 地形切换失败：' + err.message, 'error', 5000);
      }
    });
    bind('btn-imagery', () => {
      if (!window.LETerrain || typeof window.LETerrain.toggleImagery !== 'function') return;
      try {
        const enabled = window.LETerrain.toggleImagery(le);
        updateImageryButton(enabled);
        le.status(enabled ? '卫星影像已开启（Sentinel-2 cloudless / EOX，CC BY 4.0）' : '卫星影像已关闭');
        le.toast(enabled ? '卫星影像已开启' : '卫星影像已关闭', 'ok', 2200);
      } catch (err) {
        console.error(err);
        le.toast('卫星影像切换失败：' + err.message, 'error', 5000);
      }
    });
  }

  /* --------------------------- 3D 地形夸张滑杆 --------------------------- */

  function formatExaggeration(v) {
    return (Number(v) || 1).toFixed(1) + '×';
  }

  function updateExaggerationUI(v) {
    const slider = document.getElementById('terrain-exaggeration');
    const valueEl = document.getElementById('terrain-exaggeration-value');
    if (slider) slider.value = String(v);
    if (valueEl) valueEl.textContent = formatExaggeration(v);
  }

  function updateImageryButton(enabled) {
    const btn = document.getElementById('btn-imagery');
    if (btn) btn.textContent = enabled ? '卫星影像（开）' : '卫星影像（关）';
  }

  function applyExaggeration(le, value) {
    if (!window.LETerrain || typeof window.LETerrain.setExaggeration !== 'function') return null;
    try {
      const v = window.LETerrain.setExaggeration(value);
      updateExaggerationUI(v);
      return v;
    } catch (err) {
      console.error(err);
      if (le && typeof le.toast === 'function') {
        le.toast('地形夸张设置失败：' + err.message, 'error', 4000);
      }
      return null;
    }
  }

  function bindTerrainControls(le) {
    const slider = document.getElementById('terrain-exaggeration');
    if (!slider || !window.LETerrain || typeof window.LETerrain.getExaggeration !== 'function') return;

    // 初始化：URL ?exag= / localStorage 的结果在 terrain.init 时已生效
    updateExaggerationUI(window.LETerrain.getExaggeration());

    // 拖动过程中只更新数值，松手（change）才重建地形，避免每 100ms 重建导致卡死
    let sliderPending = null;
    slider.addEventListener('input', () => {
      sliderPending = parseFloat(slider.value);
      updateExaggerationUI(sliderPending);
    });
    slider.addEventListener('change', () => {
      const v = sliderPending != null ? sliderPending : parseFloat(slider.value);
      sliderPending = null;
      applyExaggeration(le, v);
    });

    const resetBtn = document.getElementById('terrain-exaggeration-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => applyExaggeration(le, 1));
    }

    // 快捷键：1 重置、[ / ] ±0.1；输入框/搜索框聚焦时不触发
    document.addEventListener('keydown', (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const target = ev.target;
      const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable)) {
        return;
      }
      if (!window.LETerrain || typeof window.LETerrain.setExaggeration !== 'function') return;
      let next = null;
      if (ev.key === '1') {
        next = 1;
      } else if (ev.key === '[') {
        next = window.LETerrain.getExaggeration() - 0.1;
      } else if (ev.key === ']') {
        next = window.LETerrain.getExaggeration() + 0.1;
      }
      if (next == null) return;
      ev.preventDefault();
      applyExaggeration(le, next);
    });
  }

  /* --------------------------- 视角控制（类似 Google Earth） --------------------------- */

  function bindNavControls(le) {
    const viewer = le && le.viewer;
    if (!viewer) return;
    const camera = viewer.camera;
    const safe = (fn) => {
      try {
        fn();
      } catch (err) {
        console.warn('[LEUI] 视角操作失败', err);
      }
    };
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => safe(fn));
    };

    // 旋转：绕“相机所在点的地心径向轴”原地转向（相机位置不变），
    // 比绕地球极轴 UNIT_Z 更接近 Google Earth 的“视图左右旋转”。
    const rotateView = (delta) => {
      const axis = C.Cartesian3.normalize(camera.position, new C.Cartesian3());
      if (C.Cartesian3.equalsEpsilon(axis, C.Cartesian3.ZERO, C.Epsilon1)) return;
      camera.rotate(axis, delta);
    };
    bind('nav-rotate-left', () => rotateView(-0.08));
    bind('nav-rotate-right', () => rotateView(0.08));

    // 俯仰：Cesium 1.146 的 Camera 没有 tilt()，用 look(right, -delta) 实现等价俯仰，
    // 并按 pitch 允许范围钳制（-π/2 俯视 ↔ 接近 0 平视）。
    const tiltBy = (delta) => {
      // delta > 0 = 向上（更接近平视）
      if (typeof camera.look !== 'function') return;
      const pitch = camera.pitch;
      if (!isFinite(pitch)) return;
      if (delta > 0 && pitch >= -0.08) return;
      if (delta < 0 && pitch <= -1.55) return;
      camera.look(camera.right, -delta);
    };
    bind('nav-tilt-up', () => tiltBy(0.08));
    bind('nav-tilt-down', () => tiltBy(-0.08));

    // 缩放：按当前相机高度的比例缩放
    bind('nav-zoom-in', () => camera.zoomIn(Math.max(30, camera.positionCartographic.height * 0.35)));
    bind('nav-zoom-out', () => camera.zoomOut(Math.max(30, camera.positionCartographic.height * 0.35)));

    // 复位正北：保持相机位置，heading=0、pitch=-90（垂直俯视）
    bind('nav-reset', () => {
      const carto = camera.positionCartographic;
      camera.setView({
        destination: C.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
    });
  }

  /* --------------------------- KML 动画时间轴 --------------------------- */

  const kmlTimeline = { controller: null, unsubscribe: null, timer: 0, playing: false };

  function setTimelineVisible(visible) {
    const el = document.getElementById('kml-timeline');
    if (el) el.classList.toggle('hidden', !visible);
  }

  function updateTimelineUI(controller) {
    const playBtn = document.getElementById('kml-tl-play');
    const range = document.getElementById('kml-tl-range');
    const label = document.getElementById('kml-tl-label');
    const count = document.getElementById('kml-tl-count');
    if (!controller) {
      setTimelineVisible(false);
      if (playBtn) playBtn.textContent = '▶';
      return;
    }
    setTimelineVisible(true);
    const frameCount = controller.frameCount;
    if (range) {
      range.max = String(Math.max(0, frameCount - 1));
      if (document.activeElement !== range) range.value = String(controller.frameIndex);
    }
    if (label) label.textContent = controller.label;
    if (count) count.textContent = controller.frameIndex + 1 + ' / ' + frameCount;
    if (playBtn) playBtn.textContent = kmlTimeline.playing ? '⏸' : '▶';
  }

  function stopKmlPlayback() {
    if (kmlTimeline.timer) {
      clearInterval(kmlTimeline.timer);
      kmlTimeline.timer = 0;
    }
    kmlTimeline.playing = false;
    updateTimelineUI(kmlTimeline.controller);
  }

  function startKmlPlayback() {
    if (!kmlTimeline.controller) return;
    stopKmlPlayback();
    kmlTimeline.playing = true;
    // 每 ~600 ms 前进一帧并循环（帧数很多时也足够流畅，且不做数据源重建）
    kmlTimeline.timer = setInterval(() => {
      const controller = kmlTimeline.controller;
      if (!controller || controller.disposed) {
        stopKmlPlayback();
        return;
      }
      controller.next();
    }, 600);
    updateTimelineUI(kmlTimeline.controller);
  }

  function bindKmlController(controller) {
    if (kmlTimeline.unsubscribe) {
      kmlTimeline.unsubscribe();
      kmlTimeline.unsubscribe = null;
    }
    if (kmlTimeline.timer) {
      clearInterval(kmlTimeline.timer);
      kmlTimeline.timer = 0;
    }
    kmlTimeline.playing = false;
    kmlTimeline.controller = controller || null;
    if (!controller) {
      updateTimelineUI(null);
      return;
    }
    kmlTimeline.unsubscribe = controller.onChange(() => updateTimelineUI(controller));
    updateTimelineUI(controller);
  }

  function bindKmlTimeline() {
    // js/kml-native.js 在加载带 TimeSpan 的 KML/KMZ 后派发该事件
    document.addEventListener('lekml-timeline', (ev) => {
      const detail = (ev && ev.detail) || {};
      const controller = detail.controller || null;
      if (detail.action === 'activate') {
        if (controller && !controller.disposed) bindKmlController(controller);
      } else if (detail.action === 'deactivate') {
        if (!controller || controller === kmlTimeline.controller) bindKmlController(null);
      }
    });

    const playBtn = document.getElementById('kml-tl-play');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (!kmlTimeline.controller || kmlTimeline.controller.disposed) return;
        if (kmlTimeline.playing) stopKmlPlayback();
        else startKmlPlayback();
      });
    }
    const range = document.getElementById('kml-tl-range');
    if (range) {
      range.addEventListener('input', () => {
        if (!kmlTimeline.controller) return;
        if (kmlTimeline.timer) {
          clearInterval(kmlTimeline.timer);
          kmlTimeline.timer = 0;
        }
        kmlTimeline.playing = false;
        kmlTimeline.controller.setFrame(parseInt(range.value, 10) || 0);
      });
    }
  }

  window.LEUI = {
    init(le) {
      state.le = le;
      refreshLayers(le.listLayers());
      bindShortcuts(le);
      bindPublicData(le);
      bindTerrainControls(le);
      bindNavControls(le);
      bindKmlTimeline();
      if (window.LETerrain && typeof window.LETerrain.isImageryEnabled === 'function') {
        updateImageryButton(window.LETerrain.isImageryEnabled());
      }
    },
    refreshLayers,
    toggleHelp,
    promptGoto,
    showInfo,
    // 调试/自动化：读取当前 KML 动画时间轴控制器
    getKmlTimeline: () => kmlTimeline.controller,
    isKmlPlaying: () => kmlTimeline.playing,
  };
})();

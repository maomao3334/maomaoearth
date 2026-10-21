/*
 * 本地地球 Local Earth — 应用入口
 * 职责：创建 Cesium Viewer、加载本地公版底图/示例数据、提供全局 LE 接口、
 *       初始化各功能模块（layers / importers / tools / ui）。
 * 离线约束：所有资源使用相对路径，由本地 serve.ps1 提供；页面 CSP 禁止外部请求。
 */
(function () {
  'use strict';

  const C = window.Cesium;
  if (!C) {
    document.getElementById('status-text').textContent = 'CesiumJS 加载失败：请确认 vendor/cesium 完整。';
    return;
  }

  const $ = (sel) => document.querySelector(sel);
  const byId = (id) => document.getElementById(id);

  const state = {
    layers: new Map(),
    ready: false,
    baseLayerReady: false,
    samples: { countries: null, places: null },
  };

  /* ------------------------------ UI 基础 ------------------------------ */

  let toastTimer = null;
  function toast(message, kind, ms) {
    const el = byId('toast');
    if (!el) return;
    clearTimeout(toastTimer);
    el.textContent = message;
    el.classList.remove('hidden', 'error', 'ok');
    if (kind) el.classList.add(kind);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms || 3200);
  }

  function status(message, kind) {
    const el = byId('status-text');
    if (!el) return;
    el.textContent = message;
    if (kind === 'error') el.style.color = 'var(--danger)';
    else el.style.color = '';
  }

  function setLoading(show, text) {
    const el = byId('loading');
    if (!el) return;
    if (show) byId('loading-text').textContent = text || '正在加载…';
    el.classList.toggle('hidden', !show);
  }

  let coordRaf = 0;
  function setCoords(lon, lat, height) {
    if (coordRaf) return;
    coordRaf = requestAnimationFrame(() => {
      coordRaf = 0;
      const el = byId('coords-text');
      if (!el) return;
      const fmt = (v) => (v == null || !isFinite(v) ? '--' : v.toFixed(6));
      const fmtH = (h) => {
        if (h == null || !isFinite(h)) return '--';
        return Math.abs(h) >= 1000 ? (h / 1000).toFixed(2) + ' km' : h.toFixed(0) + ' m';
      };
      el.textContent = '纬度 ' + fmt(lat) + '　经度 ' + fmt(lon) + '　高度 ' + fmtH(height);
      el.dataset.lon = lon == null ? '' : String(lon);
      el.dataset.lat = lat == null ? '' : String(lat);
      el.dataset.height = height == null ? '' : String(height);
    });
  }

  /* ---------------------------- Viewer 初始化 ---------------------------- */

  const viewer = new C.Viewer('viewer', {
    baseLayer: false,
    terrainProvider: new C.EllipsoidTerrainProvider(),
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: false,
    requestRenderMode: false,
    contextOptions: { webgl: { alpha: false, antialias: true } },
  });

  const scene = viewer.scene;

  // 渲染循环异常时把完整堆栈打到控制台，便于定位（Cesium 默认只弹面板）
  try {
    scene.renderError.addEventListener(function (sc, error) {
      console.error('[Cesium renderError]', error && (error.stack || error.message || error));
    });
  } catch (err) {
    console.warn('renderError 监听失败', err);
  }

  scene.globe.baseColor = C.Color.fromCssColorString('#0a1622');
  scene.globe.showGroundAtmosphere = true;
  scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;
  scene.globe.enableLighting = false;
  scene.screenSpaceCameraController.minimumZoomDistance = 30;
  scene.screenSpaceCameraController.maximumZoomDistance = 5.0e7;

  /** 本地底图：NASA Blue Marble（公有领域），不访问网络。
   *  优先使用本地 XYZ 瓦片（z0–z5，21600×10800 高清来源），失败回退单幅 5400×2700。 */
  function addLocalBaseImage() {
    try {
      const tiled = new C.UrlTemplateImageryProvider({
        url: 'data/public/tiles/blue-marble/{z}/{x}/{y}.jpg',
        minimumLevel: 0,
        maximumLevel: 5,
        credit: 'NASA Blue Marble (public domain)',
      });
      viewer.imageryLayers.addImageryProvider(tiled);
      state.baseLayerReady = true;
      state.baseLayerKind = 'tiles';
      return;
    } catch (err) {
      console.warn('高清瓦片底图不可用，回退单幅底图', err);
    }
    try {
      const provider = new C.SingleTileImageryProvider({
        url: 'data/samples/world.topo.bathy.200412.3x5400x2700.jpg',
        rectangle: C.Rectangle.fromDegrees(-180, -90, 180, 90),
        tileWidth: 5400,
        tileHeight: 2700,
        credit: 'NASA Blue Marble (public domain)',
      });
      viewer.imageryLayers.addImageryProvider(provider);
      state.baseLayerReady = true;
      state.baseLayerKind = 'single';
    } catch (err) {
      console.error(err);
      status('本地底图加载失败：' + err.message, 'error');
    }
  }

  /* ------------------------------- 图层注册 ------------------------------- */

  function layerApi(desc) {
    const entry = Object.assign(
      {
        id: desc.id || 'layer-' + Math.random().toString(36).slice(2, 9),
        name: desc.name || '未命名图层',
        type: desc.type || 'overlay',
        system: !!desc.system,
        visible: desc.visible !== false,
        zoomTo:
          desc.zoomTo ||
          (typeof desc.flyTo === 'function' ? () => desc.flyTo() : undefined),
        remove:
          desc.remove ||
          (() => {
            if (desc.datasource) viewer.dataSources.remove(desc.datasource, true);
            if (desc.imageryLayer) viewer.imageryLayers.remove(desc.imageryLayer, true);
            if (desc.primitive) viewer.entities.removeAll();
          }),
      },
      desc
    );

    entry.setVisible = function (on) {
      entry.visible = !!on;
      if (entry.datasource) entry.datasource.show = entry.visible;
      if (entry.imageryLayer) entry.imageryLayer.show = entry.visible;
      if (entry.onVisible) entry.onVisible(entry.visible);
      refreshLayers();
    };

    entry.setOpacity = function (alpha) {
      if (entry.imageryLayer) entry.imageryLayer.alpha = Math.max(0, Math.min(1, alpha));
    };

    state.layers.set(entry.id, entry);
    if (entry.datasource && entry.visible === false) entry.datasource.show = false;
    refreshLayers();
    return entry;
  }

  function removeLayer(id) {
    const entry = state.layers.get(id);
    if (!entry) return;
    try {
      entry.remove();
    } catch (err) {
      console.error(err);
    }
    state.layers.delete(id);
    refreshLayers();
  }

  function listLayers() {
    return Array.from(state.layers.values());
  }

  function refreshLayers() {
    if (window.LEUI && typeof window.LEUI.refreshLayers === 'function') {
      window.LEUI.refreshLayers(listLayers());
    }
  }

  /* ------------------------------ 视角与选择 ------------------------------ */

  function flyTo(target) {
    if (!target) return;
    if (target.rectangle) {
      viewer.camera.flyTo({ destination: target.rectangle, duration: 1.6 });
      return;
    }
    if (target instanceof C.Entity) {
      viewer.flyTo(target, { duration: 1.6 }).catch(() => {});
      return;
    }
    if (target.datasource) {
      viewer.flyTo(target.datasource, { duration: 1.6 }).catch(() => {});
      return;
    }
    const height = target.height != null ? target.height : 2500;
    const dest = C.Cartesian3.fromDegrees(target.longitude, target.latitude, height);
    const orientation = target.heading != null
      ? {
          heading: C.Math.toRadians(target.heading || 0),
          pitch: C.Math.toRadians(target.pitch || -90),
          roll: 0,
        }
      : undefined;
    viewer.camera.flyTo({ destination: dest, orientation, duration: target.duration || 1.6 });
  }

  function flyHome() {
    viewer.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(105, 32, 2.0e7),
      duration: 1.4,
    });
  }

  let is2D = false;
  function toggle2D() {
    is2D = !is2D;
    if (is2D) scene.morphTo2D(1.0);
    else scene.morphTo3D(1.0);
    const btn = byId('btn-2d');
    if (btn) btn.textContent = is2D ? '3D' : '2D';
  }

  let selectedEntity = null;
  function selectEntity(entity) {
    selectedEntity = entity;
    if (!entity) return;
    const name = entity.name || '未命名地物';
    status('已选择：' + name);
    if (window.LEUI && typeof window.LEUI.showInfo === 'function') {
      window.LEUI.showInfo(entity);
    }
  }

  /* ---------------------------- 文件与拖放 ---------------------------- */

  function openFileDialog() {
    const input = byId('file-input');
    if (input) input.click();
  }

  function currentApi() {
    return window.LE;
  }

  /* ------------------------------- 示例数据 ------------------------------- */

  async function loadSampleVectors() {
    try {
      const countries = await C.GeoJsonDataSource.load(
        'data/samples/ne_110m_admin_0_countries.geojson',
        {
          stroke: C.Color.fromCssColorString('#7fb2e5').withAlpha(0.85),
          strokeWidth: 1.2,
          fill: false,
          clampToGround: false,
        }
      );
      if (window.LEImports && typeof LEImports.sanitizeDataSource === 'function') {
        LEImports.sanitizeDataSource(countries);
      }
      // 国界只描边：显式关闭 polygon 填充，避免低画质/无地形时 GeoJSON 默认白色面盖住底图
      try {
        const ents = countries.entities.values;
        for (let i = 0; i < ents.length; i++) {
          const polygon = ents[i].polygon;
          if (!polygon) continue;
          polygon.fill = false;
          polygon.material = C.Color.TRANSPARENT;
          polygon.outline = true;
        }
      } catch (err) {
        /* ignore */
      }
      countries.name = '国界（Natural Earth）';
      viewer.dataSources.add(countries);
      state.samples.countries = countries;
      layerApi({
        id: 'sample-countries',
        name: '国界 · Natural Earth',
        type: 'vector',
        datasource: countries,
        zoomTo: undefined,
        remove: () => viewer.dataSources.remove(countries, true),
      });
    } catch (err) {
      console.error(err);
      toast('国界数据加载失败：' + err.message, 'error', 4200);
    }
  }

  async function loadSamplePlaces() {
    try {
      const places = await C.GeoJsonDataSource.load(
        'data/samples/ne_110m_populated_places_simple.geojson',
        { markerSize: 0, clampToGround: false }
      );
      if (window.LEImports && typeof LEImports.sanitizeDataSource === 'function') {
        LEImports.sanitizeDataSource(places);
      }
      places.show = false;
      places.name = '地名索引（Natural Earth）';
      await viewer.dataSources.add(places);
      state.samples.places = places;
    } catch (err) {
      console.warn('地名索引加载失败', err);
    }
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  function bindViewerEvents() {
    const handler = new C.ScreenSpaceEventHandler(scene.canvas);

    handler.setInputAction((movement) => {
      if (window.LE && window.LE.state.measureActive) return;
      const picked = scene.pick(movement.position);
      if (picked && picked.id instanceof C.Entity) {
        selectEntity(picked.id);
      }
    }, C.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((movement) => {
      const ray = viewer.camera.getPickRay(movement.endPosition);
      const pos = ray ? scene.globe.pick(ray, scene) : null;
      if (pos) {
        const carto = C.Cartographic.fromCartesian(pos);
        setCoords(
          C.Math.toDegrees(carto.longitude),
          C.Math.toDegrees(carto.latitude),
          carto.height
        );
      } else {
        setCoords(null, null, null);
      }
    }, C.ScreenSpaceEventType.MOUSE_MOVE);

    byId('coords-text').addEventListener('click', () => {
      const el = byId('coords-text');
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(
          () => toast('坐标已复制', 'ok'),
          () => toast('复制失败', 'error')
        );
      }
    });

    // 相机位置（帮助定位问题，也让用户知道当前视点高度）
    const updateCameraText = () => {
      const carto = viewer.camera.positionCartographic;
      if (!carto) return;
      const lon = C.Math.toDegrees(carto.longitude).toFixed(4);
      const lat = C.Math.toDegrees(carto.latitude).toFixed(4);
      const h = carto.height;
      const hs = Math.abs(h) >= 1000 ? (h / 1000).toFixed(1) + ' km' : h.toFixed(0) + ' m';
      const el = byId('camera-text');
      if (el) el.textContent = '相机 ' + lat + ', ' + lon + ' · ' + hs;
    };
    viewer.camera.changed.addEventListener(updateCameraText);
    updateCameraText();
  }

  function bindChromeEvents() {
    byId('btn-open').addEventListener('click', openFileDialog);
    byId('btn-home').addEventListener('click', flyHome);
    byId('btn-2d').addEventListener('click', toggle2D);
    byId('btn-help').addEventListener('click', () => window.LEUI && window.LEUI.toggleHelp(true));
    byId('help-close').addEventListener('click', () => window.LEUI && window.LEUI.toggleHelp(false));
    byId('btn-goto').addEventListener('click', () => window.LEUI && window.LEUI.promptGoto());
    byId('btn-measure-distance').addEventListener('click', () =>
      window.LETools && window.LETools.startMeasure('distance')
    );
    byId('btn-measure-area').addEventListener('click', () =>
      window.LETools && window.LETools.startMeasure('area')
    );
    byId('btn-clear-measure').addEventListener('click', () =>
      window.LETools && window.LETools.clearMeasure()
    );

    const input = byId('file-input');
    input.addEventListener('change', () => {
      if (window.LEImports) window.LEImports.importFiles(input.files);
      input.value = '';
    });

    window.addEventListener('error', (ev) => {
      console.error(ev.error || ev.message);
      status('发生错误：' + (ev.message || '未知'), 'error');
    });
    window.addEventListener('unhandledrejection', (ev) => {
      console.error(ev.reason);
    });
  }

  /* ------------------------------- 全局 API ------------------------------- */

  const LE = {
    Cesium: C,
    viewer,
    scene,
    state,
    status,
    setStatus: (text) => status(text),
    toast,
    setLoading,
    setCoords,
    flyTo,
    flyHome,
    toggle2D,
    selectEntity,
    openFileDialog,
    registerLayer: layerApi,
    removeLayer,
    listLayers,
    refreshLayers,
    getSelected: () => selectedEntity,
    hasGeoTiff: () => !!window.GeoTIFF,
    // 本地 3D 地形高度（米）；未启用地形时返回 0，供 KML 贴地渲染使用
    heightAt: (lon, lat) =>
      window.LETerrain && window.LETerrain.isEnabled() ? window.LETerrain.heightAt(lon, lat) : 0,
    isTerrainEnabled: () => !!(window.LETerrain && window.LETerrain.isEnabled()),
  };

  window.LE = LE;

  function initModules() {
    const order = [
      ['LELayers', 'init'],
      ['LEImports', 'init'],
      ['LETools', 'init'],
      ['LEUI', 'init'],
    ];
    for (const [name, fn] of order) {
      const mod = window[name];
      if (mod && typeof mod[fn] === 'function') {
        try {
          mod[fn](LE);
        } catch (err) {
          console.error('模块初始化失败：' + name, err);
          toast('模块初始化失败：' + name, 'error', 4000);
        }
      }
    }
  }

  async function boot() {
    setLoading(true, '正在加载本地底图…');
    addLocalBaseImage();
    bindChromeEvents();
    bindViewerEvents();
    viewer.camera.setView({
      destination: C.Cartesian3.fromDegrees(105, 32, 2.0e7),
    });

    const versionEl = byId('help-version');
    if (versionEl) {
      versionEl.textContent =
        '版本 0.1.0 · CesiumJS ' + (C.VERSION || '1.146') + ' · 数据全部本地读取';
    }

    await Promise.all([loadSampleVectors(), loadSamplePlaces()]);

    // 性能调度器在挂载前先探测设备，并让地形延迟加载东亚/全球大源，启动更快
    if (window.LEPerf && typeof window.LEPerf.preboot === 'function') {
      try {
        window.LEPerf.preboot();
      } catch (err) {
        console.warn('[main] 性能预探测失败', err);
      }
    }

    // 3D 地形：在导入 KML 之前加载，这样 relativeToGround/clampToGround 的箭头能贴合地形
    if (window.LETerrain && typeof window.LETerrain.init === 'function') {
      try {
        await window.LETerrain.init(LE);
      } catch (err) {
        console.error('[main] 3D 地形初始化失败', err);
      }
    }

    initModules();

    // 挂上性能调度器（探测设备、应用档位、实时帧率自动降级）
    if (window.LEPerf && typeof window.LEPerf.init === 'function') {
      try {
        window.LEPerf.init(LE);
      } catch (err) {
        console.warn('[main] 性能调度器初始化失败', err);
      }
    }

    // 底图/矢量/地形基础已就绪：先关闭全屏加载层，让界面可交互；后续数据加载走状态栏进度
    setLoading(false);
    status('就绪 · 正在按需加载数据…');

    const params = new URLSearchParams(location.search);

    // ?demo=<本地相对路径>：启动后自动加载示例数据（便于演示与自动化验证）
    const demo = params.get('demo');
    if (demo && window.LEImports && typeof window.LEImports.importUrl === 'function') {
      try {
        await window.LEImports.importUrl(demo);
      } catch (err) {
        console.error(err);
        toast('演示数据加载失败：' + err.message, 'error', 5000);
      }
    }

    // ?tiles=<本地 XYZ 模板>：例如 data/samples/tiles/{z}/{x}/{y}.png
    const tiles = params.get('tiles');
    if (tiles) {
      try {
        window.LELayers.addXyzTemplate(LE, { name: '本地瓦片', template: tiles });
      } catch (err) {
        console.error(err);
        toast('本地瓦片加载失败：' + err.message, 'error', 5000);
      }
    }

    // ?dem=<本地阴影图>&demBounds=w,s,e,n ：例如 data/public/dem/N25E102-hillshade.png
    const dem = params.get('dem');
    if (dem) {
      try {
        const bounds = (params.get('demBounds') || '102,25,103,26')
          .split(',')
          .map(Number);
        window.LELayers.addImageOverlay(LE, {
          name: '本地 DEM 阴影',
          url: dem,
          rectangle: bounds,
          opacity: 0.9,
          visible: params.get('demVisible') !== '0',
        });
      } catch (err) {
        console.error(err);
        toast('DEM 阴影加载失败：' + err.message, 'error', 5000);
      }
    }

    // ?cam=lon,lat,height[,pitch] ：可选，启动后定位相机（便于分享视角/自动化截图）
    const cam = params.get('cam');
    if (cam) {
      try {
        const parts = cam.split(',').map(Number);
        if (parts.length >= 3 && parts.every((v) => isFinite(v))) {
          viewer.camera.flyTo({
            destination: C.Cartesian3.fromDegrees(parts[0], parts[1], parts[2]),
            orientation: {
              heading: 0,
              pitch: C.Math.toRadians(parts.length >= 4 ? parts[3] : -45),
              roll: 0,
            },
            duration: 0,
          });
        }
      } catch (err) {
        console.warn('相机参数解析失败', err);
      }
    }

    state.ready = true;
    setLoading(false);
    status('就绪 · 完全离线运行（拖放数据或点击“打开数据”）');
    setCoords(null, null, null);
    document.dispatchEvent(new CustomEvent('local-earth-ready', { detail: LE }));
  }

  boot().catch((err) => {
    console.error(err);
    setLoading(false);
    status('启动失败：' + err.message, 'error');
    toast('启动失败：' + err.message, 'error', 6000);
  });
})();

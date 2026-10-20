/*
 * 绘制与标注（P1）
 * - 点 / 线 / 面 绘制：单击加顶点，双击结束（线/面），Esc 取消
 * - 贴地：点按 LE.heightAt(lon,lat)+2 m；线/面顶点按 LE.heightAt 抬高 2 m（地形关闭时为 0+2 m）
 * - 撤销 / 清空 / 导出 GeoJSON / 导入 GeoJSON；自动命名（点 1、线 1、面 1 …）
 * - 与测量/相机共存：绘制时禁用相机双击默认跟踪动作、暂停 main.js 的选择动作；
 *   启动测量会自动结束当前绘制
 *
 * 对外 API：window.LEDraw
 *   init(le) / start(mode) / stop() / clear() / undo()
 *   getGeoJSON() / loadGeoJSON(geojson) / list() / getFeatures()
 */
(function () {
  'use strict';

  const C = window.Cesium;

  const state = {
    le: null,
    mode: null, // null | 'point' | 'line' | 'polygon'
    pending: [], // {lon, lat, height}
    hover: null,
    previewEntities: [],
    features: [],
    counters: { point: 0, line: 0, polygon: 0 },
    handler: null,
    bound: false,
    hoverRaf: 0,
    hoverScreen: null,
    savedDblClick: null,
    savedMeasureActive: false,
    hudTimer: null,
    style: { color: '#ffd93b', width: 3 },
  };

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

  function colorOf(alpha) {
    try {
      const c = C.Color.fromCssColorString(state.style.color);
      return alpha == null ? c : c.withAlpha(alpha);
    } catch (err) {
      return C.Color.YELLOW;
    }
  }

  function groundHeight(lon, lat) {
    const le = getLE();
    let h = 0;
    try {
      if (le && typeof le.heightAt === 'function') h = Number(le.heightAt(lon, lat)) || 0;
    } catch (err) {
      h = 0;
    }
    return h;
  }

  function pickCartographic(screenPos) {
    const viewer = viewerOf();
    if (!viewer || !screenPos) return null;
    try {
      const scene = viewer.scene;
      const ray = viewer.camera.getPickRay(screenPos);
      let cartesian = ray ? scene.globe.pick(ray, scene) : null;
      if (!cartesian) cartesian = viewer.camera.pickEllipsoid(screenPos, scene.globe.ellipsoid);
      if (!cartesian) return null;
      const carto = C.Cartographic.fromCartesian(cartesian);
      if (!carto) return null;
      return {
        lon: C.Math.toDegrees(carto.longitude),
        lat: C.Math.toDegrees(carto.latitude),
      };
    } catch (err) {
      return null;
    }
  }

  function cartesianOf(point) {
    return C.Cartesian3.fromDegrees(point.lon, point.lat, point.height || 0);
  }

  function positionsOf(points) {
    return points.map(cartesianOf);
  }

  function nextName(type) {
    state.counters[type] += 1;
    const label = type === 'point' ? '点' : type === 'line' ? '线' : '面';
    return label + ' ' + state.counters[type];
  }

  function removeEntity(entity) {
    const viewer = viewerOf();
    if (!viewer || !entity) return;
    try {
      viewer.entities.remove(entity);
    } catch (err) {
      /* ignore */
    }
  }

  function clearPreview() {
    for (const entity of state.previewEntities) removeEntity(entity);
    state.previewEntities = [];
  }

  function buildPreview() {
    const viewer = viewerOf();
    if (!viewer) return;
    clearPreview();
    const points = state.pending.slice();
    if (state.hover) points.push(state.hover);
    if (points.length < 2) return;
    const positions = positionsOf(points);
    try {
      if (state.mode === 'polygon') {
        if (points.length >= 3) {
          state.previewEntities.push(
            viewer.entities.add({
              polygon: {
                hierarchy: new C.PolygonHierarchy(positions),
                material: colorOf(0.2),
                perPositionHeight: true,
                outline: false,
              },
            })
          );
        }
        const ring = positionsOf(state.pending.slice());
        if (state.hover) ring.push(cartesianOf(state.hover));
        if (ring.length >= 2) ring.push(ring[0]);
        state.previewEntities.push(
          viewer.entities.add({
            polyline: {
              positions: ring,
              width: state.style.width,
              material: colorOf(0.9),
              clampToGround: false,
            },
          })
        );
      } else {
        state.previewEntities.push(
          viewer.entities.add({
            polyline: {
              positions: positions,
              width: state.style.width,
              material: colorOf(0.9),
              clampToGround: false,
            },
          })
        );
      }
      // 顶点标记
      for (const p of state.pending) {
        state.previewEntities.push(
          viewer.entities.add({
            position: cartesianOf(p),
            point: {
              pixelSize: 6,
              color: colorOf(1),
              outlineColor: C.Color.BLACK.withAlpha(0.8),
              outlineWidth: 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          })
        );
      }
    } catch (err) {
      console.warn('[LEDraw] 预览绘制失败', err);
    }
  }

  function updateHud() {
    const hud = byId('draw-hud');
    if (!hud) return;
    if (!state.mode) {
      hud.classList.add('hidden');
      hud.textContent = '';
      return;
    }
    const modeLabel = state.mode === 'point' ? '点' : state.mode === 'line' ? '线' : '面';
    const tips =
      state.mode === 'point'
        ? '单击地图添加点'
        : '单击添加顶点 · 双击结束 · Esc 取消';
    hud.textContent = '绘制' + modeLabel + '：' + tips + (state.pending.length ? '（已 ' + state.pending.length + ' 点）' : '');
    hud.classList.remove('hidden');
  }

  function reflectUI() {
    for (const mode of ['point', 'line', 'polygon']) {
      const btn = byId('btn-draw-' + mode);
      if (btn) btn.classList.toggle('tool-active', state.mode === mode);
    }
    const stopBtn = byId('btn-draw-stop');
    if (stopBtn) stopBtn.disabled = !state.mode;
    const count = byId('draw-count');
    if (count) count.textContent = String(state.features.length);
    updateHud();
  }

  function status(text, kind) {
    const le = getLE();
    if (!le) return;
    if (kind === 'error' && le.toast) le.toast(text, 'error', 3600);
    else if (le.status) le.status(text);
  }

  /* --------------------------- 双击默认动作 --------------------------- */

  function disableDoubleClickTracking() {
    const viewer = viewerOf();
    const widget = viewer && viewer.cesiumWidget;
    const handler = widget && widget.screenSpaceEventHandler;
    if (!handler) return;
    try {
      state.savedDblClick = handler.getInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK) || null;
      if (state.savedDblClick) handler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    } catch (err) {
      state.savedDblClick = null;
    }
  }

  function restoreDoubleClickTracking() {
    if (!state.savedDblClick) return;
    const viewer = viewerOf();
    const widget = viewer && viewer.cesiumWidget;
    const handler = widget && widget.screenSpaceEventHandler;
    if (handler) {
      try {
        handler.setInputAction(state.savedDblClick, C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      } catch (err) {
        /* ignore */
      }
    }
    state.savedDblClick = null;
  }

  /* ------------------------------ 要素管理 ------------------------------ */

  function tagDrawEntity(entity) {
    if (entity) {
      try {
        entity.__leDraw = true;
      } catch (err) {
        /* ignore */
      }
    }
    return entity;
  }

  function makePointEntity(point, color, width) {
    const viewer = viewerOf();
    return tagDrawEntity(viewer.entities.add({
      position: cartesianOf(point),
      point: {
        pixelSize: 9,
        color: color,
        outlineColor: C.Color.BLACK.withAlpha(0.85),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }));
  }

  function makeLineEntity(points, color, width) {
    const viewer = viewerOf();
    return tagDrawEntity(viewer.entities.add({
      polyline: {
        positions: positionsOf(points),
        width: width,
        material: color,
        clampToGround: false,
      },
    }));
  }

  function makePolygonEntities(points, color, width) {
    const viewer = viewerOf();
    const positions = positionsOf(points);
    const entities = [];
    entities.push(
      tagDrawEntity(
        viewer.entities.add({
          polygon: {
            hierarchy: new C.PolygonHierarchy(positions),
            material: color.withAlpha(0.25),
            perPositionHeight: true,
            outline: false,
          },
        })
      )
    );
    const ring = positions.slice();
    ring.push(ring[0]);
    entities.push(
      tagDrawEntity(
        viewer.entities.add({
          polyline: {
            positions: ring,
            width: width,
            material: color,
            clampToGround: false,
          },
        })
      )
    );
    return entities;
  }

  function createFeature(type, points, name) {
    const viewer = viewerOf();
    if (!viewer || !points.length) return null;
    const color = colorOf(1);
    const width = state.style.width;
    let entities;
    if (type === 'point') entities = [makePointEntity(points[0], color, width)];
    else if (type === 'line') entities = [makeLineEntity(points, color, width)];
    else entities = makePolygonEntities(points, color, width);
    const feature = {
      id: 'draw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      name: name || nextName(type),
      type: type,
      points: points.map((p) => ({ lon: p.lon, lat: p.lat, height: p.height || 0 })),
      entities: entities,
    };
    state.features.push(feature);
    // 给实体命名，方便 main.js 的实体选择提示与调试
    for (const entity of entities) {
      try {
        entity.name = feature.name;
      } catch (err) {
        /* ignore */
      }
    }
    reflectUI();
    return feature;
  }

  function removeFeature(feature) {
    for (const entity of feature.entities || []) removeEntity(entity);
    const idx = state.features.indexOf(feature);
    if (idx >= 0) state.features.splice(idx, 1);
    reflectUI();
  }

  function dedupePoints(points) {
    const out = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (last) {
        const dx = (p.lon - last.lon) * Math.cos((p.lat * Math.PI) / 180);
        const dy = p.lat - last.lat;
        // 约 0.6 m 内视为重复点（双击会在同一像素触发两次单击）
        if (Math.hypot(dx, dy) < 5e-6) continue;
      }
      out.push(p);
    }
    return out;
  }

  /* ------------------------------ 交互处理 ------------------------------ */

  function addVertex(screenPos) {
    const hit = pickCartographic(screenPos);
    if (!hit) return false;
    const point = { lon: hit.lon, lat: hit.lat, height: groundHeight(hit.lon, hit.lat) + 2 };
    if (state.mode === 'point') {
      const feature = createFeature('point', [point]);
      if (feature) status('已添加 ' + feature.name + '（' + feature.points.length + ' 点）');
      return true;
    }
    state.pending.push(point);
    state.hover = null;
    buildPreview();
    updateHud();
    status(
      (state.mode === 'line' ? '绘制线' : '绘制面') +
        '：已添加 ' + state.pending.length + ' 个顶点（双击结束，Esc 取消）'
    );
    return true;
  }

  function finishCurrent() {
    if (!state.mode) return null;
    const mode = state.mode;
    const points = dedupePoints(state.pending);
    state.pending = [];
    state.hover = null;
    clearPreview();
    let feature = null;
    if (mode === 'line' && points.length >= 2) {
      feature = createFeature('line', points);
    } else if (mode === 'polygon' && points.length >= 3) {
      feature = createFeature('polygon', points);
    } else if (mode !== 'point') {
      const le = getLE();
      if (le && le.toast) {
        le.toast(mode === 'line' ? '线至少需要 2 个顶点' : '面至少需要 3 个顶点', 'error', 3200);
      }
    }
    stopDrawing();
    if (feature) {
      status('已创建 ' + feature.name + '（' + feature.points.length + ' 点）');
    }
    return feature;
  }

  function cancelCurrent() {
    state.pending = [];
    state.hover = null;
    clearPreview();
    stopDrawing();
    status('已取消绘制');
  }

  function stopDrawing() {
    const viewer = viewerOf();
    if (state.handler) {
      try {
        state.handler.destroy();
      } catch (err) {
        /* ignore */
      }
      state.handler = null;
    }
    state.mode = null;
    state.pending = [];
    state.hover = null;
    state.hoverScreen = null;
    clearPreview();
    restoreDoubleClickTracking();
    const le = getLE();
    if (le && le.state) {
      le.state.drawActive = false;
      // 仅在绘制期间由我们接管 measureActive 时恢复
      le.state.measureActive = state.savedMeasureActive;
    }
    const timer = state.hudTimer;
    if (timer) {
      clearTimeout(timer);
      state.hudTimer = null;
    }
    reflectUI();
  }

  function bindHandler() {
    const viewer = viewerOf();
    if (!viewer) return;
    if (state.handler) {
      try {
        state.handler.destroy();
      } catch (err) {
        /* ignore */
      }
    }
    const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      addVertex(movement.position);
    }, C.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((movement) => {
      if (state.mode === 'point') {
        finishCurrentPointless();
        return;
      }
      finishCurrent();
    }, C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    handler.setInputAction((movement) => {
      if (state.mode === 'line' || state.mode === 'polygon') {
        state.hoverScreen = movement.endPosition;
        if (!state.hoverRaf) {
          state.hoverRaf = requestAnimationFrame(() => {
            state.hoverRaf = 0;
            if (!state.mode) return;
            const hit = pickCartographic(state.hoverScreen);
            if (hit) {
              state.hover = {
                lon: hit.lon,
                lat: hit.lat,
                height: groundHeight(hit.lon, hit.lat) + 2,
              };
              buildPreview();
            }
          });
        }
      }
    }, C.ScreenSpaceEventType.MOUSE_MOVE);

    state.handler = handler;
  }

  // 点模式双击没有待结束内容，直接退出模式
  function finishCurrentPointless() {
    if (state.mode === 'point') stopDrawing();
  }

  /* ------------------------------ 公开 API ------------------------------ */

  function start(mode) {
    const viewer = viewerOf();
    if (!viewer) return null;
    if (['point', 'line', 'polygon'].indexOf(mode) < 0) mode = 'point';
    // 若正在测量，先清掉测量，避免两套点击处理同时生效
    if (window.LETools && typeof window.LETools.clearMeasure === 'function') {
      const le = getLE();
      if (le && le.state && le.state.measureActive) {
        try {
          window.LETools.clearMeasure(true);
        } catch (err) {
          /* ignore */
        }
      }
    }
    if (state.mode) stopDrawing();
    state.mode = mode;
    state.pending = [];
    state.hover = null;
    const le = getLE();
    if (le && le.state) {
      state.savedMeasureActive = !!le.state.measureActive;
      le.state.measureActive = true; // 让 main.js 的实体选择器在绘制期间让路
      le.state.drawActive = true;
    }
    disableDoubleClickTracking();
    bindHandler();
    reflectUI();
    const label = mode === 'point' ? '点' : mode === 'line' ? '线' : '面';
    status('绘制' + label + '：单击地图添加' + (mode === 'point' ? '点' : '顶点；双击结束，Esc 取消'));
    return mode;
  }

  function stop() {
    if (!state.mode) return false;
    finishCurrent();
    return true;
  }

  function undo() {
    // 绘制中：撤掉最后一个顶点
    if (state.mode && state.mode !== 'point' && state.pending.length) {
      state.pending.pop();
      buildPreview();
      updateHud();
      status('已撤销最后一个顶点（剩余 ' + state.pending.length + ' 个）');
      return { kind: 'vertex', remaining: state.pending.length };
    }
    if (!state.features.length) {
      const le = getLE();
      if (le && le.toast) le.toast('没有可撤销的绘制要素', 'error', 2400);
      return { kind: 'none' };
    }
    const feature = state.features[state.features.length - 1];
    removeFeature(feature);
    status('已撤销 ' + feature.name);
    return { kind: 'feature', name: feature.name, remaining: state.features.length };
  }

  function clear() {
    for (const feature of state.features.slice()) removeFeature(feature);
    state.features = [];
    state.pending = [];
    state.hover = null;
    clearPreview();
    if (state.mode) stopDrawing();
    reflectUI();
    status('已清空所有绘制要素');
    return true;
  }

  function featureToGeoJSON(feature) {
    const props = { name: feature.name, type: feature.type };
    let geometry = null;
    if (feature.type === 'point') {
      const p = feature.points[0];
      geometry = { type: 'Point', coordinates: [p.lon, p.lat, p.height] };
    } else if (feature.type === 'line') {
      geometry = { type: 'LineString', coordinates: feature.points.map((p) => [p.lon, p.lat, p.height]) };
    } else if (feature.type === 'polygon') {
      const ring = feature.points.map((p) => [p.lon, p.lat, p.height]);
      if (ring.length) ring.push(ring[0].slice());
      geometry = { type: 'Polygon', coordinates: [ring] };
    }
    return { type: 'Feature', properties: props, geometry: geometry };
  }

  function getGeoJSON() {
    return {
      type: 'FeatureCollection',
      features: state.features.map(featureToGeoJSON),
    };
  }

  function coordToPoint(coord, fallbackHeight) {
    if (!Array.isArray(coord) || coord.length < 2) return null;
    const lon = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!isFinite(lon) || !isFinite(lat)) return null;
    let height = coord.length > 2 ? Number(coord[2]) : NaN;
    if (!isFinite(height)) height = groundHeight(lon, lat) + 2;
    return { lon: lon, lat: lat, height: height };
  }

  function loadGeoJSON(geojson) {
    let obj = geojson;
    if (typeof obj === 'string') obj = JSON.parse(obj);
    if (!obj) throw new Error('GeoJSON 为空');
    const features = obj.type === 'FeatureCollection'
      ? obj.features || []
      : obj.type === 'Feature'
        ? [obj]
        : [{ type: 'Feature', properties: {}, geometry: obj }];
    let added = 0;
    const skipped = [];
    for (const feature of features) {
      const geometry = feature && feature.geometry;
      if (!geometry) {
        skipped.push('无 geometry');
        continue;
      }
      const name = feature.properties && feature.properties.name ? String(feature.properties.name) : null;
      if (geometry.type === 'Point') {
        const p = coordToPoint(geometry.coordinates);
        if (p) {
          createFeature('point', [p], name || undefined);
          added += 1;
        }
      } else if (geometry.type === 'LineString') {
        const pts = (geometry.coordinates || []).map((c) => coordToPoint(c)).filter(Boolean);
        if (pts.length >= 2) {
          createFeature('line', pts, name || undefined);
          added += 1;
        } else skipped.push('LineString 顶点不足');
      } else if (geometry.type === 'Polygon') {
        const ring = (geometry.coordinates && geometry.coordinates[0]) || [];
        let pts = ring.map((c) => coordToPoint(c)).filter(Boolean);
        // 去掉 GeoJSON 规范要求的闭合重复点
        if (pts.length > 1) {
          const a = pts[0];
          const b = pts[pts.length - 1];
          if (Math.abs(a.lon - b.lon) < 1e-9 && Math.abs(a.lat - b.lat) < 1e-9) pts = pts.slice(0, -1);
        }
        if (pts.length >= 3) {
          createFeature('polygon', pts, name || undefined);
          added += 1;
        } else skipped.push('Polygon 顶点不足');
      } else {
        skipped.push('不支持的几何类型：' + geometry.type);
      }
    }
    reflectUI();
    const le = getLE();
    if (le) {
      if (le.toast) {
        le.toast(
          '已导入 ' + added + ' 个绘制要素' + (skipped.length ? '（跳过 ' + skipped.length + ' 个）' : ''),
          'ok',
          3400
        );
      }
      if (le.status) le.status('GeoJSON 导入：' + added + ' 个要素');
    }
    return { added: added, skipped: skipped };
  }

  function list() {
    return state.features.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      pointCount: f.points.length,
      pending: state.mode && state.mode !== 'point' ? state.pending.length : 0,
    }));
  }

  function getFeatures() {
    return state.features.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      points: f.points.map((p) => ({ lon: p.lon, lat: p.lat, height: p.height })),
    }));
  }

  function downloadGeoJSON() {
    const gj = getGeoJSON();
    const text = JSON.stringify(gj, null, 2);
    try {
      const blob = new Blob([text], { type: 'application/geo+json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'local-earth-draw-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.geojson';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 1200);
      return { bytes: text.length, count: gj.features.length };
    } catch (err) {
      console.warn('[LEDraw] GeoJSON 导出失败', err);
      return { bytes: 0, count: gj.features.length };
    }
  }

  /* ------------------------------ 绑定/初始化 ------------------------------ */

  function bindUI() {
    if (state.bound) return;
    state.bound = true;
    for (const mode of ['point', 'line', 'polygon']) {
      const btn = byId('btn-draw-' + mode);
      if (btn) btn.addEventListener('click', () => (state.mode === mode ? stop() : start(mode)));
    }
    const undoBtn = byId('btn-draw-undo');
    if (undoBtn) undoBtn.addEventListener('click', () => undo());
    const clearBtn = byId('btn-draw-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => clear());
    const stopBtn = byId('btn-draw-stop');
    if (stopBtn) stopBtn.addEventListener('click', () => stop());
    const exportBtn = byId('btn-draw-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const result = downloadGeoJSON();
        const le = getLE();
        if (le && le.toast) {
          le.toast('GeoJSON 已导出（' + result.count + ' 个要素，' + result.bytes + ' 字节）', 'ok', 3200);
        }
      });
    }
    const importBtn = byId('btn-draw-import');
    if (importBtn) {
      importBtn.addEventListener('click', () => {
        const input = byId('draw-geojson-input');
        if (input) input.click();
      });
    }
    const fileInput = byId('draw-geojson-input');
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        const le = getLE();
        if (le && le.setLoading) le.setLoading(true, '正在导入 GeoJSON…');
        file
          .text()
          .then((text) => loadGeoJSON(text))
          .catch((err) => {
            console.error('[LEDraw] GeoJSON 导入失败', err);
            if (le && le.toast) le.toast('GeoJSON 导入失败：' + (err && err.message ? err.message : err), 'error', 4200);
          })
          .finally(() => {
            if (le && le.setLoading) le.setLoading(false);
          });
      });
    }
    const colorSelect = byId('draw-color');
    if (colorSelect) {
      colorSelect.addEventListener('change', () => {
        state.style.color = colorSelect.value || '#ffd93b';
      });
      state.style.color = colorSelect.value || state.style.color;
    }
    const widthSelect = byId('draw-width');
    if (widthSelect) {
      widthSelect.addEventListener('change', () => {
        const w = Number(widthSelect.value);
        if (isFinite(w)) state.style.width = Math.max(1, Math.min(10, w));
      });
      const w = Number(widthSelect.value);
      if (isFinite(w)) state.style.width = Math.max(1, Math.min(10, w));
    }
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      const tag = ev.target && ev.target.tagName ? ev.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (state.mode) {
        ev.preventDefault();
        cancelCurrent();
      }
    });
  }

  function init(le) {
    state.le = le || window.LE;
    bindUI();
    // 启动测量时自动结束绘制，避免两套点击处理冲突
    if (window.LETools && typeof window.LETools.startMeasure === 'function' && !window.LETools.__drawWrapped) {
      const original = window.LETools.startMeasure;
      window.LETools.startMeasure = function (mode) {
        try {
          if (state.mode) stopDrawing();
        } catch (err) {
          /* ignore */
        }
        return original.call(window.LETools, mode);
      };
      window.LETools.__drawWrapped = true;
    }
    reflectUI();
    return list();
  }

  window.LEDraw = {
    init,
    start,
    stop,
    clear,
    undo,
    getGeoJSON,
    loadGeoJSON,
    list,
    getFeatures,
    downloadGeoJSON,
    isActive: () => !!state.mode,
    getMode: () => state.mode,
    getPending: () => state.pending.length,
    getStyle: () => ({ color: state.style.color, width: state.style.width }),
  };

  // 模块自行初始化
  if (window.LE && window.LE.viewer) {
    init(window.LE);
  } else {
    document.addEventListener('local-earth-ready', (ev) => init((ev && ev.detail) || window.LE), { once: true });
  }
})();

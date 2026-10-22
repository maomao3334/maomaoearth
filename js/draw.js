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
    style: { color: '#ffd93b', width: 3, opacity: 1, depthFail: true, vertexLabels: true },
    labelSeq: 0,
    featureDialog: null,
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
                perPositionHeight: false,
                heightReference: C.HeightReference.CLAMP_TO_GROUND,
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
              clampToGround: true,
              depthFailMaterial: depthFailMaterialOf(colorOf(1)),
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
              clampToGround: true,
              depthFailMaterial: depthFailMaterialOf(colorOf(1)),
            },
          })
        );
      }
      // 顶点标记
      for (const p of state.pending) {
        state.previewEntities.push(
          viewer.entities.add({
            position: C.Cartesian3.fromDegrees(p.lon, p.lat, 0),
            point: {
              pixelSize: 6,
              color: colorOf(1),
              outlineColor: C.Color.BLACK.withAlpha(0.8),
              outlineWidth: 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              heightReference: C.HeightReference.CLAMP_TO_GROUND,
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
    const tips = state.mode === 'point' ? '单击地图添加点' : '单击添加顶点 · 双击结束 · Esc 取消';
    let extra = '';
    if (state.pending.length) {
      const last = state.pending[state.pending.length - 1];
      extra += ' · 已 ' + state.pending.length + ' 点';
      extra += ' · 最后 ' + last.lat.toFixed(6) + ', ' + last.lon.toFixed(6);
      if (state.mode === 'line' && state.pending.length >= 2) extra += ' · 长度 ' + formatDistance(lengthOf(state.pending));
      if (state.mode === 'polygon' && state.pending.length >= 3) extra += ' · 面积 ' + formatArea(areaOf(state.pending));
    }
    if (state.hover) {
      extra += ' · 光标 ' + state.hover.lat.toFixed(6) + ', ' + state.hover.lon.toFixed(6);
    }
    hud.textContent = '绘制' + modeLabel + '：' + tips + extra;
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

  function nextLabel() {
    state.labelSeq += 1;
    return '标记点 ' + state.labelSeq;
  }

  function styleAlpha(alpha) {
    const a = state.style.opacity == null ? 1 : state.style.opacity;
    return Math.max(0.05, Math.min(1, a * (alpha == null ? 1 : alpha)));
  }

  function depthFailMaterialOf(color) {
    if (!state.style.depthFail) return undefined;
    try {
      return new C.PolylineDashMaterialProperty({
        color: color.withAlpha(0.45),
        dashLength: 16,
      });
    } catch (err) {
      return color.withAlpha(0.45);
    }
  }

  function labelOptions(text) {
    return {
      text: text,
      font: '12px "Microsoft YaHei", sans-serif',
      fillColor: C.Color.WHITE,
      outlineColor: C.Color.BLACK,
      outlineWidth: 2,
      style: C.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new C.Cartesian2(0, -20),
      verticalOrigin: C.VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      showBackground: true,
      backgroundColor: C.Color.fromCssColorString('rgba(0,0,0,0.55)'),
      heightReference: C.HeightReference.CLAMP_TO_GROUND,
      distanceDisplayCondition: new C.DistanceDisplayCondition(0, 3000000),
      show: state.style.vertexLabels !== false,
    };
  }

  function makePointEntity(point, color, width, labelText) {
    const viewer = viewerOf();
    return tagDrawEntity(viewer.entities.add({
      position: C.Cartesian3.fromDegrees(point.lon, point.lat, 0),
      point: {
        pixelSize: 9,
        color: color,
        outlineColor: C.Color.BLACK.withAlpha(0.85),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
      },
      label: labelOptions(labelText || nextLabel()),
    }));
  }

  function makeVertexEntity(point, color, labelText) {
    const viewer = viewerOf();
    return tagDrawEntity(viewer.entities.add({
      position: C.Cartesian3.fromDegrees(point.lon, point.lat, 0),
      point: {
        pixelSize: 7,
        color: color,
        outlineColor: C.Color.BLACK.withAlpha(0.85),
        outlineWidth: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
      },
      label: labelOptions(labelText || nextLabel()),
    }));
  }

  function makeLineEntity(points, color, width) {
    const viewer = viewerOf();
    return tagDrawEntity(viewer.entities.add({
      polyline: {
        positions: positionsOf(points),
        width: width,
        material: color.withAlpha(styleAlpha(1)),
        clampToGround: true,
        depthFailMaterial: depthFailMaterialOf(color),
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
            material: color.withAlpha(styleAlpha(0.25)),
            perPositionHeight: false,
            heightReference: C.HeightReference.CLAMP_TO_GROUND,
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
            material: color.withAlpha(styleAlpha(1)),
            clampToGround: true,
            depthFailMaterial: depthFailMaterialOf(color),
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
    let labels = [];
    if (type === 'point') {
      entities = [makePointEntity(points[0], color, width, nextLabel())];
      labels = entities.slice();
    } else if (type === 'line') {
      entities = [makeLineEntity(points, color, width)];
      labels = points.map((p) => makeVertexEntity(p, color, nextLabel()));
      entities = entities.concat(labels);
    } else {
      entities = makePolygonEntities(points, color, width);
      labels = points.map((p) => makeVertexEntity(p, color, nextLabel()));
      entities = entities.concat(labels);
    }
    const feature = {
      id: 'draw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      name: name || nextName(type),
      type: type,
      points: points.map((p) => ({ lon: p.lon, lat: p.lat, height: p.height || 0 })),
      entities: entities,
      labels: labels,
      visible: true,
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

  function lengthOf(points) {
    if (!points || points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      try {
        const a = C.Cartographic.fromDegrees(points[i - 1].lon, points[i - 1].lat);
        const b = C.Cartographic.fromDegrees(points[i].lon, points[i].lat);
        total += new C.EllipsoidGeodesic(a, b).surfaceDistance;
      } catch (err) { /* ignore */ }
    }
    return total;
  }

  function areaOf(points) {
    if (!points || points.length < 3) return 0;
    const R = 6378137;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const lon1 = a.lon * Math.PI / 180;
      const lon2 = b.lon * Math.PI / 180;
      const lat1 = a.lat * Math.PI / 180;
      const lat2 = b.lat * Math.PI / 180;
      sum += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    return Math.abs(sum * R * R / 2);
  }

  function formatDistance(m) {
    if (!isFinite(m)) return '--';
    return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : m.toFixed(0) + ' m';
  }

  function formatArea(m2) {
    if (!isFinite(m2)) return '--';
    return m2 >= 1e6 ? (m2 / 1e6).toFixed(2) + ' km²' : m2.toFixed(0) + ' m²';
  }

  function snapToVertex(screenPos) {
    const viewer = viewerOf();
    if (!viewer || !screenPos) return null;
    let best = null;
    let bestD = 14;
    const groups = [state.pending].concat(state.features.map(function (f) { return f.points; }));
    for (const points of groups) {
      for (const p of points || []) {
        try {
          const w = C.SceneTransforms.worldToWindowCoordinates(
            viewer.scene,
            C.Cartesian3.fromDegrees(p.lon, p.lat, p.height || 0)
          );
          if (!w) continue;
          const d = Math.hypot(w.x - screenPos.x, w.y - screenPos.y);
          if (d < bestD) {
            bestD = d;
            best = { lon: p.lon, lat: p.lat, height: p.height || 0 };
          }
        } catch (err) { /* ignore */ }
      }
    }
    return best;
  }

  function addVertex(screenPos) {
    const hit = pickCartographic(screenPos);
    if (!hit) return false;
    const snapped = snapToVertex(screenPos);
    const point = snapped || { lon: hit.lon, lat: hit.lat, height: 0 };
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
                height: 0,
              };
              buildPreview();
              updateHud();
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


  function setVertexLabels(on) {
    state.style.vertexLabels = !!on;
    for (const feature of state.features) {
      for (const entity of feature.labels || []) {
        try {
          if (entity.label) entity.label.show = state.style.vertexLabels;
        } catch (err) { /* ignore */ }
      }
    }
  }

  function featureStats(feature) {
    if (!feature) return { length: 0, area: 0 };
    return {
      length: feature.type === 'point' ? 0 : lengthOf(feature.points),
      area: feature.type === 'polygon' ? areaOf(feature.points) : 0,
    };
  }

  function typeLabel(type) {
    return type === 'point' ? '点' : type === 'line' ? '线' : '面';
  }

  function zoomToFeature(feature) {
    if (!feature || !feature.points.length) return false;
    const le = getLE();
    if (!le || !le.flyTo) return false;
    if (feature.points.length === 1) {
      const p = feature.points[0];
      le.flyTo({ longitude: p.lon, latitude: p.lat, height: 5000 });
      return true;
    }
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const p of feature.points) {
      west = Math.min(west, p.lon); east = Math.max(east, p.lon);
      south = Math.min(south, p.lat); north = Math.max(north, p.lat);
    }
    const pad = Math.max(0.001, Math.max(east - west, north - south) * 0.15);
    le.flyTo({ rectangle: C.Rectangle.fromDegrees(west - pad, south - pad, east + pad, north + pad) });
    return true;
  }

  function renameFeature(feature, newName) {
    if (!feature) return false;
    const name = String(newName || '').trim();
    if (!name) return false;
    feature.name = name;
    for (const entity of feature.entities || []) {
      try { entity.name = name; } catch (err) { /* ignore */ }
    }
    renderFeatureList();
    return true;
  }

  function setFeatureVisible(feature, visible) {
    if (!feature) return false;
    feature.visible = visible !== false;
    for (const entity of feature.entities || []) {
      try { entity.show = feature.visible; } catch (err) { /* ignore */ }
    }
    renderFeatureList();
    return true;
  }

  function ensureFeatureDialog() {
    if (state.featureDialog) return state.featureDialog;
    const dlg = document.createElement('div');
    dlg.id = 'draw-feature-dialog';
    dlg.className = 'modal hidden';
    dlg.innerHTML =
      '<div class="modal-card draw-feature-card">' +
      '<h2>绘制要素 <span id="draw-feature-count" class="count">0</span></h2>' +
      '<div class="marker-table-wrap"><table class="marker-table"><thead><tr><th>名称</th><th>类型</th><th>量算</th><th>操作</th></tr></thead><tbody id="draw-feature-tbody"></tbody></table></div>' +
      '<div class="actions"><button type="button" class="btn" id="draw-feature-close">关闭</button></div>' +
      '</div>';
    document.body.appendChild(dlg);
    state.featureDialog = dlg;
    dlg.querySelector('#draw-feature-close').addEventListener('click', function () { dlg.classList.add('hidden'); });
    dlg.querySelector('#draw-feature-tbody').addEventListener('click', function (ev) {
      const btn = ev.target.closest('button[data-draw-action]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-draw-action');
      const feature = state.features.find(function (f) { return f.id === id; });
      if (!feature) return;
      if (action === 'zoom') zoomToFeature(feature);
      else if (action === 'rename') {
        const name = window.prompt('重命名要素', feature.name);
        if (name) renameFeature(feature, name);
      } else if (action === 'toggle') setFeatureVisible(feature, feature.visible === false);
      else if (action === 'delete') {
        removeFeature(feature);
        renderFeatureList();
      }
    });
    return dlg;
  }

  function openFeatureList() {
    const dlg = ensureFeatureDialog();
    dlg.classList.remove('hidden');
    renderFeatureList();
  }

  function renderFeatureList() {
    const dlg = state.featureDialog;
    if (!dlg) return;
    const tbody = dlg.querySelector('#draw-feature-tbody');
    const count = dlg.querySelector('#draw-feature-count');
    if (count) count.textContent = String(state.features.length);
    if (!tbody) return;
    if (!state.features.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="marker-empty">暂无绘制要素</td></tr>';
      return;
    }
    tbody.innerHTML = state.features.map(function (f) {
      const s = featureStats(f);
      const stat = f.type === 'point' ? (f.points[0] ? f.points[0].lat.toFixed(5) + ', ' + f.points[0].lon.toFixed(5) : '--')
        : f.type === 'line' ? formatDistance(s.length)
        : formatArea(s.area);
      return '<tr>' +
        '<td>' + escapeText(f.name) + '</td>' +
        '<td>' + typeLabel(f.type) + '</td>' +
        '<td class="marker-coord">' + stat + '</td>' +
        '<td class="marker-row-actions">' +
        '<button type="button" class="btn subtle" data-draw-action="zoom" data-id="' + escapeText(f.id) + '">定位</button>' +
        '<button type="button" class="btn subtle" data-draw-action="rename" data-id="' + escapeText(f.id) + '">改名</button>' +
        '<button type="button" class="btn subtle" data-draw-action="toggle" data-id="' + escapeText(f.id) + '">' + (f.visible === false ? '显示' : '隐藏') + '</button>' +
        '<button type="button" class="btn subtle danger" data-draw-action="delete" data-id="' + escapeText(f.id) + '">删除</button>' +
        '</td></tr>';
    }).join('');
  }

  function escapeText(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function downloadText(text, filename, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 800);
  }

  function downloadKML() {
    const placemarks = state.features.map(function (f) {
      const coords = f.points.map(function (p) { return p.lon.toFixed(8) + ',' + p.lat.toFixed(8) + ',' + (p.height || 0); });
      let geom = '';
      if (f.type === 'point') {
        geom = '<Point><coordinates>' + coords[0] + '</coordinates></Point>';
      } else if (f.type === 'line') {
        geom = '<LineString><tessellate>1</tessellate><coordinates>' + coords.join(' ') + '</coordinates></LineString>';
      } else {
        const ring = coords.slice();
        if (ring.length) ring.push(ring[0]);
        geom = '<Polygon><outerBoundaryIs><LinearRing><coordinates>' + ring.join(' ') + '</coordinates></LinearRing></outerBoundaryIs></Polygon>';
      }
      return '<Placemark><name>' + escapeText(f.name) + '</name>' + geom + '</Placemark>';
    }).join('');
    const kml = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>MaomaoEarth 绘制要素</name>' + placemarks + '</Document></kml>';
    downloadText(kml, 'draw-' + Date.now() + '.kml', 'application/vnd.google-earth.kml+xml;charset=utf-8');
    return { count: state.features.length };
  }

  function downloadCSV() {
    const rows = [['feature', 'type', 'vertex', 'latitude', 'longitude', 'height', 'length_m', 'area_m2']];
    state.features.forEach(function (f) {
      const s = featureStats(f);
      f.points.forEach(function (p, i) {
        rows.push([f.name, f.type, i + 1, p.lat.toFixed(8), p.lon.toFixed(8), p.height || 0, s.length.toFixed(2), s.area.toFixed(2)]);
      });
    });
    const text = rows.map(function (row) {
      return row.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    downloadText('\ufeff' + text, 'draw-' + Date.now() + '.csv', 'text/csv;charset=utf-8');
    return { count: state.features.length };
  }

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
    const opacityInput = byId('draw-opacity');
    if (opacityInput) {
      opacityInput.addEventListener('input', function () {
        const v = Number(opacityInput.value);
        if (isFinite(v)) state.style.opacity = Math.max(0.05, Math.min(1, v));
      });
      const v = Number(opacityInput.value);
      if (isFinite(v)) state.style.opacity = Math.max(0.05, Math.min(1, v));
    }
    const depthFailInput = byId('draw-depthfail');
    if (depthFailInput) {
      depthFailInput.addEventListener('change', function () { state.style.depthFail = !!depthFailInput.checked; });
      state.style.depthFail = depthFailInput.checked !== false;
    }
    const vertexLabelsInput = byId('draw-vertex-labels');
    if (vertexLabelsInput) {
      vertexLabelsInput.addEventListener('change', function () { setVertexLabels(!!vertexLabelsInput.checked); });
      state.style.vertexLabels = vertexLabelsInput.checked !== false;
    }
    const listBtn = byId('btn-draw-list');
    if (listBtn) listBtn.addEventListener('click', openFeatureList);
    const kmlBtn = byId('btn-draw-export-kml');
    if (kmlBtn) kmlBtn.addEventListener('click', function () {
      const r = downloadKML();
      const le = getLE();
      if (le && le.toast) le.toast('KML 已导出（' + r.count + ' 个要素）', 'ok', 3000);
    });
    const csvBtn = byId('btn-draw-export-csv');
    if (csvBtn) csvBtn.addEventListener('click', function () {
      const r = downloadCSV();
      const le = getLE();
      if (le && le.toast) le.toast('CSV 已导出（' + r.count + ' 个要素）', 'ok', 3000);
    });
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
    downloadKML,
    downloadCSV,
    openList: openFeatureList,
    renameFeature,
    removeFeature,
    setFeatureVisible,
    zoomToFeature,
    featureStats,
    setVertexLabels,
    isActive: () => !!state.mode,
    getMode: () => state.mode,
    getPending: () => state.pending.length,
    getStyle: () => ({ color: state.style.color, width: state.style.width, opacity: state.style.opacity, depthFail: state.style.depthFail, vertexLabels: state.style.vertexLabels }),
  };

  // 模块自行初始化
  if (window.LE && window.LE.viewer) {
    init(window.LE);
  } else {
    document.addEventListener('local-earth-ready', (ev) => init((ev && ev.detail) || window.LE), { once: true });
  }
})();

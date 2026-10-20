/*
 * 搜索与测量（Lead 版基础实现，tools-dev 在此扩展）
 * 对外 API：window.LETools
 *   init(le)
 *   startMeasure('distance' | 'area')
 *   clearMeasure()
 *   search(query)
 *   gotoItem(item)
 */
(function () {
  'use strict';

  const C = window.Cesium;

  const state = {
    le: null,
    mode: null,
    positions: [],
    entities: [],
    clickHandler: null,
    panel: null,
    searchItems: [],
    activeIndex: -1,
    searchTimer: null,
  };

  /* ------------------------------- 搜索 ------------------------------- */

  function buildSearchIndex(le) {
    const items = [];
    const seen = new Set();
    const push = (name, lon, lat, height, kind, entity) => {
      const key = name + '|' + lon.toFixed(3) + '|' + lat.toFixed(3);
      if (!name || seen.has(key)) return;
      seen.add(key);
      items.push({ name, lon, lat, height: height || 50000, kind: kind || '地标', entity });
    };

    const places = le.state.samples.places;
    if (places && places.entities) {
      for (const entity of places.entities.values) {
        if (!entity.position || !entity.name) continue;
        const carto = C.Cartographic.fromCartesian(entity.position.getValue(C.JulianDate.now()));
        if (!carto) continue;
        push(
          entity.name,
          C.Math.toDegrees(carto.longitude),
          C.Math.toDegrees(carto.latitude),
          Math.max(1000, carto.height || 0),
          '城市/地名',
          entity
        );
      }
    }

    le.dataSources = le.viewer.dataSources;
    for (let i = 0; i < le.viewer.dataSources.length; i++) {
      const ds = le.viewer.dataSources.get(i);
      if (!ds || ds === places) continue;
      const entities = ds.entities && ds.entities.values ? ds.entities.values : [];
      for (const entity of entities) {
        if (!entity.position || !entity.name) continue;
        const carto = C.Cartographic.fromCartesian(entity.position.getValue(C.JulianDate.now()));
        if (!carto) continue;
        push(
          entity.name,
          C.Math.toDegrees(carto.longitude),
          C.Math.toDegrees(carto.latitude),
          Math.max(2000, carto.height || 0),
          ds.name || '已加载图层',
          entity
        );
      }
    }
    state.searchItems = items;
    return items;
  }

  function rank(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // 每次搜索重建索引：导入新图层后立即可搜到，无需手动刷新
    if (state.le) buildSearchIndex(state.le);
    const starts = [];
    const includes = [];
    for (const item of state.searchItems) {
      const n = item.name.toLowerCase();
      if (n.startsWith(q)) starts.push(item);
      else if (n.includes(q)) includes.push(item);
      if (starts.length + includes.length > 60) break;
    }
    return starts.concat(includes).slice(0, 12);
  }

  function renderResults(results, query) {
    const box = document.getElementById('search-results');
    if (!box) return;
    state.activeIndex = results.length ? 0 : -1;
    if (!results.length) {
      box.innerHTML = '<div class="empty">没有找到“' + escapeHtml(query) + '”</div>';
      box.classList.remove('hidden');
      return;
    }
    box.innerHTML = results
      .map(
        (item, i) =>
          '<div class="item' +
          (i === 0 ? ' active' : '') +
          '" data-idx="' + i + '"><span class="name">' +
          escapeHtml(item.name) +
          '</span><span class="kind">' +
          escapeHtml(item.kind) +
          '</span></div>'
      )
      .join('');
    box.classList.remove('hidden');
    Array.from(box.querySelectorAll('.item')).forEach((el) => {
      el.addEventListener('click', () => {
        gotoItem(results[Number(el.dataset.idx)]);
      });
    });
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function hideResults() {
    const box = document.getElementById('search-results');
    if (box) box.classList.add('hidden');
    state.activeIndex = -1;
  }

  function gotoItem(item) {
    if (!item) return;
    hideResults();
    state.le.flyTo({
      longitude: item.lon,
      latitude: item.lat,
      height: item.height,
    });
    state.le.status('已飞到：' + item.name);
  }

  /** 新图层加载后刷新搜索索引（importers 在加载完成后调用）。 */
  function refreshIndex() {
    if (state.le) buildSearchIndex(state.le);
  }

  function bindSearch(le) {
    const input = document.getElementById('search-input');
    if (!input) return;
    buildSearchIndex(le);

    input.addEventListener('input', () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        const q = input.value;
        if (!q.trim()) {
          hideResults();
          return;
        }
        renderResults(rank(q), q);
      }, 160);
    });

    input.addEventListener('focus', () => {
      if (input.value.trim()) {
        buildSearchIndex(le);
        renderResults(rank(input.value), input.value);
      }
    });

    input.addEventListener('keydown', (ev) => {
      const box = document.getElementById('search-results');
      const items = box ? Array.from(box.querySelectorAll('.item')) : [];
      if (ev.key === 'Escape') {
        hideResults();
        input.blur();
        return;
      }
      if (!items.length) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const dir = ev.key === 'ArrowDown' ? 1 : -1;
        state.activeIndex = (state.activeIndex + dir + items.length) % items.length;
        items.forEach((el, i) => el.classList.toggle('active', i === state.activeIndex));
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const q = input.value;
        const results = rank(q);
        if (results.length) gotoItem(results[Math.max(0, state.activeIndex)]);
      }
    });

    document.addEventListener('click', (ev) => {
      if (!ev.target.closest('.searchbox')) hideResults();
    });
  }

  /* ------------------------------- 测量 ------------------------------- */

  function ensurePanel() {
    if (state.panel) return state.panel;
    const panel = document.createElement('div');
    panel.id = 'measure-panel';
    panel.className = 'hidden';
    panel.innerHTML =
      '<h4><span id="measure-title">测量</span><button class="btn icon" id="measure-close" title="关闭">×</button></h4>' +
      '<div class="value" id="measure-value">--</div>' +
      '<div class="detail" id="measure-detail"></div>' +
      '<div class="actions">' +
      '<button class="btn" id="measure-finish">完成</button>' +
      '<button class="btn" id="measure-clear">清除</button>' +
      '</div>';
    const host = document.getElementById('viewer');
    host.appendChild(panel);
    panel.querySelector('#measure-close').addEventListener('click', clearMeasure);
    panel.querySelector('#measure-finish').addEventListener('click', () => finishMeasure());
    panel.querySelector('#measure-clear').addEventListener('click', clearMeasure);
    state.panel = panel;
    return panel;
  }

  function setPanel(title, value, detail) {
    const panel = ensurePanel();
    panel.classList.remove('hidden');
    panel.querySelector('#measure-title').textContent = title;
    panel.querySelector('#measure-value').textContent = value || '--';
    panel.querySelector('#measure-detail').textContent = detail || '';
  }

  function formatDistance(meters) {
    if (!isFinite(meters)) return '--';
    if (meters >= 1000) return (meters / 1000).toFixed(2) + ' km';
    return meters.toFixed(1) + ' m';
  }

  function formatArea(squareMeters) {
    if (!isFinite(squareMeters)) return '--';
    if (squareMeters >= 1e6) return (squareMeters / 1e6).toFixed(2) + ' km²';
    return squareMeters.toFixed(0) + ' m²';
  }

  function surfaceDistanceMeters(a, b) {
    const ga = C.Cartographic.fromCartesian(a);
    const gb = C.Cartographic.fromCartesian(b);
    const geo = new C.EllipsoidGeodesic(ga, gb, C.Ellipsoid.WGS84);
    return geo.surfaceDistance;
  }

  function polygonAreaMeters2(positions) {
    // 球面多边形面积（近似，WGS84 平均半径）
    const R = 6371008.8;
    let sum = 0;
    for (let i = 0; i < positions.length; i++) {
      const a = C.Cartographic.fromCartesian(positions[i]);
      const b = C.Cartographic.fromCartesian(positions[(i + 1) % positions.length]);
      sum +=
        (C.Math.toDegrees(b.longitude) - C.Math.toDegrees(a.longitude)) *
        (2 + Math.sin(a.latitude) + Math.sin(b.latitude));
    }
    return Math.abs((sum * R * R) / 2);
  }

  function totalDistance(positions) {
    let total = 0;
    for (let i = 1; i < positions.length; i++) {
      total += surfaceDistanceMeters(positions[i - 1], positions[i]);
    }
    return total;
  }

  function redraw() {
    const le = state.le;
    for (const entity of state.entities) le.viewer.entities.remove(entity);
    state.entities = [];
    if (!state.positions.length) {
      state.panel && state.panel.classList.add('hidden');
      return;
    }

    for (const pos of state.positions) {
      state.entities.push(
        le.viewer.entities.add({
          position: pos,
          point: { pixelSize: 7, color: C.Color.fromCssColorString('#7ee0c0'), outlineColor: C.Color.BLACK, outlineWidth: 1 },
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        })
      );
    }

    if (state.mode === 'area' && state.positions.length >= 2) {
      state.entities.push(
        le.viewer.entities.add({
          polygon: {
            hierarchy: new C.PolygonHierarchy(state.positions),
            material: C.Color.fromCssColorString('#3ea6ff').withAlpha(0.22),
            outline: true,
            outlineColor: C.Color.fromCssColorString('#3ea6ff').withAlpha(0.9),
            perPositionHeight: false,
          },
        })
      );
    } else if (state.positions.length >= 2) {
      state.entities.push(
        le.viewer.entities.add({
          polyline: {
            positions: state.positions,
            width: 3,
            clampToGround: false,
            material: C.Color.fromCssColorString('#7ee0c0'),
          },
        })
      );
    }

    if (state.mode === 'distance') {
      const meters = totalDistance(state.positions);
      setPanel(
        '测距',
        formatDistance(meters),
        state.positions.length + ' 个点 · 双击或点“完成”结束；Esc 取消'
      );
    } else if (state.mode === 'area') {
      const area = state.positions.length >= 3 ? polygonAreaMeters2(state.positions) : NaN;
      setPanel(
        '测面积',
        state.positions.length >= 3 ? formatArea(area) : '--',
        state.positions.length + ' 个点（至少 3 点）· 双击或点“完成”结束；Esc 取消'
      );
    }
  }

  function addPoint(position) {
    state.positions.push(position);
    redraw();
    const le = state.le;
    le.status(
      state.mode === 'distance'
        ? '测距：已选 ' + state.positions.length + ' 个点'
        : '测面积：已选 ' + state.positions.length + ' 个点'
    );
  }

  function finishMeasure() {
    if (!state.mode) return;
    state.mode = null;
    state.le.status('测量完成');
    cycleButtons(false);
    if (state.panel) {
      state.panel.querySelector('#measure-finish').disabled = false;
    }
  }

  function startMeasure(mode) {
    const le = state.le;
    clearMeasure(true);
    state.mode = mode;
    le.state.measureActive = true;
    cycleButtons(true, mode);
    le.status(mode === 'distance' ? '测距：在地球上点击起点' : '测面积：在地球上点击第一个点');
    ensurePanel();
    setPanel(mode === 'distance' ? '测距' : '测面积', '--', '点击地球添加点；双击或点“完成”结束');
    redraw();
    const handler = new C.ScreenSpaceEventHandler(le.viewer.scene.canvas);
    handler.setInputAction((movement) => {
      if (!state.mode) return;
      const ray = le.viewer.camera.getPickRay(movement.position);
      const pos = ray ? le.viewer.scene.globe.pick(ray, le.viewer.scene) : null;
      if (pos) addPoint(pos);
    }, C.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(() => {
      if (state.mode) finishMeasure();
    }, C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    state.clickHandler && state.clickHandler.destroy();
    state.clickHandler = handler;
  }

  function cycleButtons(active, mode) {
    const d = document.getElementById('btn-measure-distance');
    const a = document.getElementById('btn-measure-area');
    if (!d || !a) return;
    d.classList.toggle('tool-active', !!active && mode === 'distance');
    a.classList.toggle('tool-active', !!active && mode === 'area');
  }

  function clearMeasure(silent) {
    const le = state.le;
    if (!le) return;
    if (state.clickHandler) {
      state.clickHandler.destroy();
      state.clickHandler = null;
    }
    for (const entity of state.entities) le.viewer.entities.remove(entity);
    state.entities = [];
    state.positions = [];
    state.mode = null;
    le.state.measureActive = false;
    cycleButtons(false);
    if (state.panel) state.panel.classList.add('hidden');
    if (!silent) le.status('测量已清除');
  }

  window.LETools = {
    init(le) {
      state.le = le;
      bindSearch(le);
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && state.mode) clearMeasure();
      });
    },
    startMeasure,
    clearMeasure,
    finishMeasure,
    search(query) {
      return rank(String(query || ''));
    },
    gotoItem,
    rebuildSearchIndex() {
      return state.le ? buildSearchIndex(state.le) : [];
    },
  };
})();

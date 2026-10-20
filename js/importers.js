/*
 * 本地数据导入（Lead 版基础实现，importers-dev 在此扩展）
 * 支持：KML / KMZ / GeoJSON / GeoTIFF（经 LELayers / Cesium 数据源）
 * 要求：只读本地文件，不发起网络请求。
 */
(function () {
  'use strict';

  const C = window.Cesium;
  const VECTOR_EXT = ['kml', 'kmz', 'geojson', 'json'];
  const RASTER_EXT = ['tif', 'tiff', 'gtiff'];

  function extOf(name) {
    const m = /\.([^.]+)$/.exec(String(name || '').toLowerCase());
    return m ? m[1] : '';
  }

  function fileKind(file) {
    const ext = extOf(file && file.name);
    if (VECTOR_EXT.includes(ext)) return 'vector';
    if (RASTER_EXT.includes(ext)) return 'raster';
    return 'unknown';
  }


  /** 按当前地形高度把经纬度点抬高，得到贴地的 3D 折线坐标（不依赖 GroundPolyline，避免不渲染）。 */
  function drapePositions(positions) {
    const out = [];
    if (!positions) return out;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const c = C.Cartographic.fromCartesian(p);
      if (!c || !isFinite(c.longitude) || !isFinite(c.latitude)) continue;
      let h = 0;
      try {
        if (window.LE && typeof window.LE.heightAt === 'function') {
          h = window.LE.heightAt(C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude)) || 0;
        }
      } catch (err) {
        h = 0;
      }
      out.push(C.Cartesian3.fromRadians(c.longitude, c.latitude, h + 2));
    }
    return out;
  }

  /** 公共矢量后处理：国界只留描边、湖泊淡蓝填充（GeoJsonDataSource 的 fill 选项不一定生效）。 */
  function stylePublicVectorDataSource(dataSource, lower) {
    if (!dataSource || !dataSource.entities) return;
    const now = C.JulianDate.now();
    const ents = dataSource.entities.values;
    const isAdmin = /admin_0/.test(lower);
    const isLakes = /lakes/.test(lower);
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.polygon) {
        try {
          if (isAdmin) {
            // 贴地面的多边形轮廓在 GroundPrimitive 上不一定渲染：转成贴地折线（GroundPolyline）
            try {
              const hierarchy = e.polygon.hierarchy.getValue ? e.polygon.hierarchy.getValue(now) : e.polygon.hierarchy;
              if (hierarchy && hierarchy.positions) {
                const rings = [hierarchy.positions];
                if (hierarchy.holes) for (let h = 0; h < hierarchy.holes.length; h++) rings.push(hierarchy.holes[h].positions);
                const strokeColor = C.Color.fromCssColorString('#86b7e8').withAlpha(0.95);
                for (let r = 0; r < rings.length; r++) {
                  if (!rings[r] || rings[r].length < 2) continue;
                  const draped = drapePositions(rings[r]);
                  if (draped.length < 2) continue;
                  dataSource.entities.add({
                    polyline: {
                      positions: draped,
                      width: 1.6,
                      material: strokeColor,
                      clampToGround: false,
                      arcType: C.ArcType.NONE,
                    },
                  });
                }
                e.show = false;
              }
            } catch (err) {
              /* ignore */
            }
          } else if (isLakes) {
            e.polygon.material = C.Color.fromCssColorString('#2f6f9f').withAlpha(0.35);
            e.polygon.outline = true;
            e.polygon.outlineColor = C.Color.fromCssColorString('#5fa8d8').withAlpha(0.9);
            e.polygon.outlineWidth = 1.0;
          }
        } catch (err) {
          /* ignore */
        }
      }
      if (!isAdmin && !isLakes && e.polyline) {
        try {
          const raw = e.polyline.positions && e.polyline.positions.getValue ? e.polyline.positions.getValue(now) : e.polyline.positions;
          const draped = drapePositions(raw);
          if (draped.length >= 2) {
            e.polyline.positions = draped;
            e.polyline.clampToGround = false;
            e.polyline.arcType = C.ArcType.NONE;
          }
        } catch (err) {
          /* ignore */
        }
      }
    }
    // 城市点：拉远时隐藏，避免几千个黄点铺满整屏（近景 ≤1200 km 才显示）
    if (/populated_places/.test(lower)) {
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        try {
          if (e.billboard) {
            e.billboard.distanceDisplayCondition = new C.DistanceDisplayCondition(0, 1200000);
          }
          if (e.label) {
            e.label.distanceDisplayCondition = new C.DistanceDisplayCondition(0, 1200000);
          }
        } catch (err) {
          /* ignore */
        }
      }
    }
  }

  function dataSourceOptions(le) {
    return {
      clampToGround: false,
      camera: le.viewer.scene.camera,
      canvas: le.viewer.scene.canvas,
    };
  }

  /**
   * 修复 Cesium GeoJsonDataSource 默认把折线建成 RHUMB（ArcType=2）导致的崩溃：
   * Natural Earth 河流等数据的极区/跨日期变更线段会让 subdivideRhumbLine 计算出
   * 非法数组长度，抛出 "RangeError: Invalid array length" 并停止整个渲染循环。
   * 这里统一改为 GEODESIC，并清理非法/重复坐标。
   */
  function sanitizePolylineDataSource(dataSource) {
    if (!dataSource || !dataSource.entities) return;
    const now = C.JulianDate.now();
    const ents = dataSource.entities.values;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      // 面（国界/湖泊）同样会被 GeoJsonDataSource 默认成 RHUMB（=2）；
      // Cesium 的 PolygonGeometry 会按边做 subdivideRhumbLine，大面会算出非法长度。
      if (e.polygon) {
        try {
          e.polygon.arcType = C.ArcType.GEODESIC;
        } catch (err) {
          /* ignore */
        }
      }
      if (!e.polyline) continue;
      try {
        e.polyline.arcType = C.ArcType.GEODESIC;
      } catch (err) {
        /* ignore */
      }
      try {
        const raw =
          e.polyline.positions && e.polyline.positions.getValue
            ? e.polyline.positions.getValue(now)
            : e.polyline.positions;
        if (!Array.isArray(raw) || raw.length < 2) continue;
        const cleaned = [];
        for (let j = 0; j < raw.length; j++) {
          const p = raw[j];
          if (!p || !isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) continue;
          if (cleaned.length) {
            const prev = cleaned[cleaned.length - 1];
            const dx = p.x - prev.x;
            const dy = p.y - prev.y;
            const dz = p.z - prev.z;
            if (dx * dx + dy * dy + dz * dz < 1e-6) continue;
          }
          cleaned.push(p);
        }
        if (cleaned.length >= 2) e.polyline.positions = cleaned;
      } catch (err) {
        /* ignore */
      }
    }
  }

  /** 从数据源的实体几何估算经纬度范围（不依赖 viewer.flyTo 对数据源的启发式）。 */
  function dataSourceBounds(dataSource) {
    const now = C.JulianDate.now();
    const bounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity, has: false };
    const addPosition = (position) => {
      if (!position || !(position instanceof C.Cartesian3)) return;
      const carto = C.Cartographic.fromCartesian(position);
      if (!carto) return;
      const lon = C.Math.toDegrees(carto.longitude);
      const lat = C.Math.toDegrees(carto.latitude);
      bounds.west = Math.min(bounds.west, lon);
      bounds.east = Math.max(bounds.east, lon);
      bounds.south = Math.min(bounds.south, lat);
      bounds.north = Math.max(bounds.north, lat);
      bounds.has = true;
    };
    const addPositions = (value) => {
      if (!value) return;
      const positions = Array.isArray(value) ? value : value.getValue ? value.getValue(now) : null;
      if (!positions) return;
      for (const p of positions) addPosition(p);
    };

    const entities = dataSource && dataSource.entities ? dataSource.entities.values : [];
    for (const entity of entities) {
      try {
        if (entity.position) addPositions([entity.position.getValue(now)]);
        if (entity.polyline && entity.polyline.positions) addPositions(entity.polyline.positions);
        if (entity.polygon && entity.polygon.hierarchy) {
          const hierarchy = entity.polygon.hierarchy.getValue(now);
          if (hierarchy && hierarchy.positions) addPositions(hierarchy.positions);
        }
        if (entity.rectangle && entity.rectangle.coordinates) {
          const rect = entity.rectangle.coordinates.getValue(now);
          if (rect) {
            addPosition(C.Cartesian3.fromRadians(rect.west, rect.south));
            addPosition(C.Cartesian3.fromRadians(rect.east, rect.north));
          }
        }
      } catch (_) {
        /* 单个实体几何不可用时继续 */
      }
    }
    return bounds.has ? bounds : null;
  }

  /** 把相机飞到数据范围（带边距）；返回是否成功定位。 */
  function fitDataSource(le, dataSource, duration) {
    const b = dataSourceBounds(dataSource);
    if (!b) return false;
    const padLon = Math.max((b.east - b.west) * 0.1, 0.0008);
    const padLat = Math.max((b.north - b.south) * 0.1, 0.0008);
    const west = Math.max(-179.999, b.west - padLon);
    const east = Math.min(179.999, b.east + padLon);
    const south = Math.max(-89.999, b.south - padLat);
    const north = Math.min(89.999, b.north + padLat);
    le.viewer.camera.flyTo({
      destination: C.Rectangle.fromDegrees(west, south, east, north),
      duration: duration || 1.4,
    });
    return true;
  }

  function countEntities(dataSource) {
    if (!dataSource || !dataSource.entities || !dataSource.entities.values) return 0;
    return dataSource.entities.values.length;
  }

  function boundsTextOf(b) {
    if (!b || !b.has) return ' · 无位置范围';
    return (
      ' · 范围 ' +
      b.west.toFixed(3) + ',' + b.south.toFixed(3) +
      ' → ' + b.east.toFixed(3) + ',' + b.north.toFixed(3)
    );
  }

  /**
   * 优先用自研 KML/KMZ 渲染器（js/kml-native.js）。
   * 返回 null 表示原生路径不可用或失败，调用方回退 Cesium.KmlDataSource。
   */
  async function tryNativeKml(input, le) {
    if (!window.LEKml || typeof window.LEKml.load !== 'function') return null;
    try {
      const result = await window.LEKml.load(input, le);
      if (!result || !result.layer) throw new Error('原生渲染器返回空图层');
      return result;
    } catch (err) {
      console.warn('[LEImports] 原生 KML/KMZ 渲染失败，回退 Cesium KmlDataSource：', err);
      if (le && typeof le.toast === 'function') {
        le.toast(
          '原生 KML 渲染失败，已切换兼容模式：' + (err && err.message ? err.message : err),
          'error',
          5200
        );
      }
      return null;
    }
  }

  async function importVector(file, le) {
    const ext = extOf(file.name);
    const isKml = ext === 'kml' || ext === 'kmz';

    // .kml/.kmz 先走原生渲染（CustomDataSource），失败再回退 Cesium KmlDataSource
    if (isKml) {
      const native = await tryNativeKml(file, le);
      if (native) {
        return {
          entry: native.layer,
          count: native.count,
          warnings: native.warnings || [],
          native: true,
        };
      }
    }

    let dataSource;
    if (isKml) {
      dataSource = await C.KmlDataSource.load(file, dataSourceOptions(le));
      sanitizePolylineDataSource(dataSource);
    } else {
      dataSource = await C.GeoJsonDataSource.load(file, {
        clampToGround: false,
        markerSize: 24,
        strokeWidth: 2,
      });
      sanitizePolylineDataSource(dataSource);
    }
    dataSource.name = file.name;
    await le.viewer.dataSources.add(dataSource);
    const entry = le.registerLayer({
      name: file.name,
      type: 'vector',
      datasource: dataSource,
      remove: () => le.viewer.dataSources.remove(dataSource, true),
      zoomTo: () => {
        if (!fitDataSource(le, dataSource)) {
          le.viewer.flyTo(dataSource, { duration: 1.4 }).catch(() => {});
        }
      },
      flyTo: () => {
        if (!fitDataSource(le, dataSource)) {
          le.viewer.flyTo(dataSource, { duration: 1.4 }).catch(() => {});
        }
      },
    });
    if (!fitDataSource(le, dataSource)) {
      try {
        await le.viewer.flyTo(dataSource, { duration: 1.2 });
      } catch (_) {
        /* 空数据源时忽略 */
      }
    }
    if (window.LETools && typeof window.LETools.rebuildSearchIndex === 'function') {
      window.LETools.rebuildSearchIndex();
    }
    return { entry, count: countEntities(dataSource), warnings: [], native: false };
  }

  async function importRaster(file, le) {
    if (!window.LELayers || !window.LELayers.addGeoTiff) {
      throw new Error('GeoTIFF 支持未初始化');
    }
    return window.LELayers.addGeoTiff(le, { file, name: file.name });
  }

  async function importFiles(files, le) {
    le = le || window.LE;
    const list = Array.from(files || []);
    if (!list.length) return;
    if (typeof le.setStatus === 'function') le.setStatus('正在加载 ' + list.length + ' 个文件…');
    const ok = [];
    const failed = [];
    for (const file of list) {
      try {
        const kind = fileKind(file);
        if (kind === 'vector') {
          const result = await importVector(file, le);
          ok.push(
            file.name +
              '（' + result.count + ' 个地物' + (result.native ? '，原生渲染' : '') + '）'
          );
          if (result.warnings && result.warnings.length) {
            console.warn('[LEImports] ' + file.name + ' 解析提示：', result.warnings);
          }
        } else if (kind === 'raster') {
          await importRaster(file, le);
          ok.push(file.name);
        } else {
          failed.push(file.name + '（不支持的类型）');
        }
      } catch (err) {
        console.error(err);
        failed.push(file.name + '：' + (err && err.message ? err.message : err));
      }
    }
    // 非阻塞：进度只走状态栏（加载浮层由 main.js 在首屏后关闭）
    if (ok.length) {
      le.toast('已加载：' + ok.join('；'), 'ok', 4200);
      le.status('已加载 ' + ok.length + ' 个图层');
    }
    if (failed.length) {
      le.toast('加载失败：' + failed.join('；'), 'error', 7000);
      le.status('有 ' + failed.length + ' 个文件加载失败', 'error');
    }
  }

  function setupDropZone(le) {
    const overlay = document.getElementById('drop-overlay');
    let depth = 0;
    const hasFiles = (ev) =>
      ev.dataTransfer &&
      Array.from(ev.dataTransfer.types || []).includes('Files');

    window.addEventListener('dragenter', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      depth++;
      if (depth === 1) overlay.classList.remove('hidden');
    });
    window.addEventListener('dragover', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (ev) => {
      if (!hasFiles(ev)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) overlay.classList.add('hidden');
    });
    window.addEventListener('drop', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      depth = 0;
      overlay.classList.add('hidden');
      const files = ev.dataTransfer.files;
      if (files && files.length) importFiles(files, le);
    });
  }

  /** 通过本地相对 URL 加载矢量数据（用于 ?demo= 演示参数）。 */
  async function importUrl(url, le) {
    le = le || window.LE;
    const lower = String(url).toLowerCase();
    if (typeof le.setStatus === 'function') le.setStatus('正在加载 ' + url + ' …');
    try {
      // .kml/.kmz 优先走原生渲染器，失败再回退 Cesium KmlDataSource
      if (/\.kml$|\.kmz$/.test(lower)) {
        const native = await tryNativeKml(url, le);
        if (native) {
          const name = native.layer.name;
          const warnings = native.warnings || [];
          le.toast('已加载：' + name + '（' + native.count + ' 个地物 · 原生渲染）', 'ok', 4200);
          le.status(
            '已加载 ' + name + ' · ' + native.count + ' 个地物' +
            boundsTextOf(native.bounds) +
            ' · 原生 KML 渲染' +
            (warnings.length ? ' · ' + warnings.length + ' 条提示' : '')
          );
          return native.dataSource;
        }
      }

      let dataSource;
      if (/\.kml$|\.kmz$/.test(lower)) {
        dataSource = await C.KmlDataSource.load(url, dataSourceOptions(le));
        sanitizePolylineDataSource(dataSource);
      } else if (/\.geojson$|\.json$/.test(lower)) {
        // 公共 Natural Earth 矢量：默认贴地渲染（clampToGround），国界只描边、湖泊淡蓝填充，
        // 避免高度 0 的面被 3D 地形遮成蓝色块；?drape=0 可关闭。
        const isPublicVector = /data\/public\/vectors\//.test(url) || /ne_10m_(admin_0|rivers|lakes|populated_places)/.test(lower);
        const drape = isPublicVector && new URLSearchParams(location.search).get('drape') !== '0';
        const geoOptions = { clampToGround: drape, markerSize: 24, strokeWidth: 2 };
        if (isPublicVector) {
          if (/admin_0/.test(lower)) {
            geoOptions.stroke = C.Color.fromCssColorString('#86b7e8').withAlpha(0.9);
            geoOptions.strokeWidth = 1.2;
            geoOptions.fill = false;
          } else if (/rivers/.test(lower)) {
            geoOptions.stroke = C.Color.fromCssColorString('#4f9fd8').withAlpha(0.95);
            geoOptions.strokeWidth = 1.3;
          } else if (/lakes/.test(lower)) {
            geoOptions.fill = C.Color.fromCssColorString('#2f6f9f').withAlpha(0.35);
            geoOptions.stroke = C.Color.fromCssColorString('#5fa8d8').withAlpha(0.9);
            geoOptions.strokeWidth = 1.0;
          } else if (/populated_places/.test(lower)) {
            geoOptions.markerColor = C.Color.fromCssColorString('#ffd166').withAlpha(0.9);
            geoOptions.markerSize = 6;
          }
        }
        dataSource = await C.GeoJsonDataSource.load(url, geoOptions);
        sanitizePolylineDataSource(dataSource);
        if (isPublicVector) stylePublicVectorDataSource(dataSource, lower);
      } else {
        throw new Error('不支持的 URL 类型（仅 .kml/.kmz/.geojson/.json）');
      }
      dataSource.name = String(url).split('/').pop();
      await le.viewer.dataSources.add(dataSource);
      le.registerLayer({
        name: dataSource.name,
        type: 'vector',
        datasource: dataSource,
        remove: () => le.viewer.dataSources.remove(dataSource, true),
        zoomTo: () => {
          if (!fitDataSource(le, dataSource)) {
            le.viewer.flyTo(dataSource, { duration: 1.2 }).catch(() => {});
          }
        },
      });
      // 不再在导入后自动把相机飞到数据范围（加载公共图层会跳回全球视角）；
      // 需要定位时用图层列表的“定位”按钮（zoomTo）或 ?fit=1。
      if (new URLSearchParams(location.search).get('fit') === '1') {
        if (!fitDataSource(le, dataSource)) {
          await le.viewer.flyTo(dataSource, { duration: 1.2 }).catch(() => {});
        }
      }
      if (window.LETools && typeof window.LETools.rebuildSearchIndex === 'function') {
        window.LETools.rebuildSearchIndex();
      }
      le.toast('已加载：' + dataSource.name + '（' + countEntities(dataSource) + ' 个地物）', 'ok');
      const b = dataSourceBounds(dataSource);
      le.status('已加载 ' + dataSource.name + ' · ' + countEntities(dataSource) + ' 个地物' + boundsTextOf(b));
      return dataSource;
    } finally {
      // 非阻塞：进度只走状态栏（加载浮层由 main.js 在首屏后关闭）
    }
  }

  window.LEImports = {
    init(le) {
      this.le = le;
      setupDropZone(le);
    },
    importFiles(files, le) {
      return importFiles(files, le);
    },
    importUrl,
    fitDataSource,
    dataSourceBounds,
    fileKind,
    // 供 main.js 等外部加载的 GeoJSON/KML 数据源做 RHUMB→GEODESIC 修复，避免渲染崩溃
    sanitizeDataSource(dataSource) {
      sanitizePolylineDataSource(dataSource);
    },
    // 原生 KML/KMZ 渲染器可用时返回 true（js/kml-native.js 已加载）
    hasNativeKml() {
      return !!(window.LEKml && typeof window.LEKml.load === 'function');
    },
    // 直接调用原生加载器（调试/外部调用），失败返回 null
    loadNativeKml(input, le) {
      return tryNativeKml(input, le);
    },
  };
})();

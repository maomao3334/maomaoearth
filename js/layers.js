/*
 * 图层能力（Lead 版基础实现，layers-dev 在此扩展）
 * 对外 API：window.LELayers
 *   init(le)
 *   addXyzTemplate(le, { name, template, minimumLevel, maximumLevel })
 *   addGeoTiff(le, { file, url, name })
 *   addTerrainFolder(le, { name, url })   // 可选，Cesium quantized-mesh 目录
 */
(function () {
  'use strict';

  const C = window.Cesium;

  function normalizeTemplate(template) {
    return String(template || '').trim().replace(/\\/g, '/');
  }

  function addXyzTemplate(le, opts) {
    const template = normalizeTemplate(opts.template);
    if (!template) throw new Error('瓦片地址模板为空');
    if (!/\{z\}/.test(template) || !/\{x\}/.test(template) || !/\{y\}/.test(template)) {
      throw new Error('模板必须包含 {z}/{x}/{y}');
    }
    const provider = new C.UrlTemplateImageryProvider({
      url: template,
      minimumLevel: opts.minimumLevel != null ? opts.minimumLevel : 0,
      maximumLevel: opts.maximumLevel != null ? opts.maximumLevel : 20,
      credit: opts.credit || opts.name || '本地瓦片',
    });
    const imageryLayer = le.viewer.imageryLayers.addImageryProvider(provider);
    const entry = le.registerLayer({
      name: opts.name || '本地瓦片图层',
      type: 'imagery',
      imageryLayer,
      remove: () => le.viewer.imageryLayers.remove(imageryLayer, true),
      zoomTo: undefined,
    });
    return entry;
  }

  /** GeoTIFF 以单幅贴图方式叠加（不重投影；适合小范围/经纬度坐标的影像）。 */
  async function addGeoTiff(le, opts) {
    const GeoTIFF = window.GeoTIFF;
    if (!GeoTIFF) throw new Error('GeoTIFF 解析器未加载');
    if (!window.GeoTIFFReady) {
      await new Promise((resolve) => {
        if (window.GeoTIFFReady) return resolve();
        window.addEventListener('geotiff-ready', resolve, { once: true });
        setTimeout(resolve, 3000);
      });
    }
    const tiff = opts.file
      ? await GeoTIFF.fromBlob(opts.file)
      : await GeoTIFF.fromUrl(opts.url, { allowFullFile: true });
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const bbox = image.getBoundingBox();
    const rasters = await image.readRasters();
    const samples = rasters.length;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);

    function stretch(arr) {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (!isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      return { min, max: max === min ? min + 1 : max };
    }
    const r = rasters[0];
    const g = samples > 1 ? rasters[1] : rasters[0];
    const b = samples > 2 ? rasters[2] : rasters[0];
    const alpha = samples > 3 ? rasters[3] : null;
    const sr = stretch(r);
    const sg = stretch(g);
    const sb = stretch(b);
    const sa = alpha ? stretch(alpha) : null;
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      imgData.data[o] = Math.round(((r[i] - sr.min) / (sr.max - sr.min)) * 255);
      imgData.data[o + 1] = Math.round(((g[i] - sg.min) / (sg.max - sg.min)) * 255);
      imgData.data[o + 2] = Math.round(((b[i] - sb.min) / (sb.max - sb.min)) * 255);
      imgData.data[o + 3] = alpha
        ? Math.round(((alpha[i] - sa.min) / (sa.max - sa.min)) * 255)
        : 255;
    }
    ctx.putImageData(imgData, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    const rectangle = C.Rectangle.fromDegrees(bbox[0], bbox[1], bbox[2], bbox[3]);
    const provider = new C.SingleTileImageryProvider({
      url: dataUrl,
      rectangle,
      tileWidth: width,
      tileHeight: height,
      credit: opts.name || '本地 GeoTIFF',
    });
    const imageryLayer = le.viewer.imageryLayers.addImageryProvider(provider);
    return le.registerLayer({
      name: opts.name || (opts.file ? opts.file.name : 'GeoTIFF 图层'),
      type: 'imagery',
      imageryLayer,
      remove: () => le.viewer.imageryLayers.remove(imageryLayer, true),
      zoomTo: () => le.flyTo({ rectangle }),
      flyTo: () => le.flyTo({ rectangle }),
    });
  }

  /** 单幅本地图片叠加（如 DEM 阴影图、扫描图），给出经纬度边界。 */
  function addImageOverlay(le, opts) {
    const r = opts.rectangle;
    if (!r || r.length !== 4) throw new Error('需要 rectangle: [west, south, east, north]');
    const rectangle = C.Rectangle.fromDegrees(r[0], r[1], r[2], r[3]);
    const provider = new C.SingleTileImageryProvider({
      url: opts.url,
      rectangle,
      credit: opts.credit || opts.name || '本地影像',
    });
    const imageryLayer = le.viewer.imageryLayers.addImageryProvider(provider);
    if (opts.opacity != null) imageryLayer.alpha = Math.max(0, Math.min(1, opts.opacity));
    return le.registerLayer({
      name: opts.name || '图片图层',
      type: 'imagery',
      visible: opts.visible !== false,
      imageryLayer,
      remove: () => le.viewer.imageryLayers.remove(imageryLayer, true),
      zoomTo: () => le.flyTo({ rectangle }),
      flyTo: () => le.flyTo({ rectangle }),
    });
  }

  window.InitGeoTiff = function () { window.GeoTIFFReady = true; };
  window.addEventListener('geotiff-ready', window.InitGeoTiff, { once: true });

  window.LELayers = {
    init(le) {
      this.le = le;
    },
    addXyzTemplate,
    addImageOverlay,
    addGeoTiff,
  };
})();

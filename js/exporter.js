/*
 * 本地地球 Local Earth — 导出（PNG / PDF / GeoJSON / KMZ，P0）
 * ---------------------------------------------------------------------------
 * 全部离线实现，不依赖第三方库：
 *   PNG     — 在 Cesium 渲染帧内读回 canvas（避免 WebGL 缓冲被清空），叠加标题/时间/
 *             相机坐标/风速图例后下载，可选 2× 分辨率渲染。
 *   PDF     — 生成新窗口 HTML（内嵌 PNG + 元数据），调用 window.print() 让用户
 *             在浏览器里“另存为 PDF”，不需要任何 PDF 库。
 *   GeoJSON — 当前 Wind3D 采样点（speed_mps/direction_deg/flow_deg/lon/lat）。
 *   KMZ     — 手写 ZIP store（no compression）打包 KML + 图例 PNG；
 *             KML 内含按风速着色的箭头 LineString、风速/风向属性与相机 Placemark。
 *
 * 对外 API：window.LEExport
 *   init(le)
 *   png(opts?) -> Promise<{filename,dataUrl,width,height,bytes}>
 *   pdf(opts?) -> Promise<{window,html,filename,png}>
 *   geojson(opts?) -> {filename,text,json,count}
 *   kmz(opts?) -> Promise<{filename,bytes,kml,blob}>
 *   buildPdfHtml(dataUrl, meta?) -> string
 *   getLast() -> {png?,pdf?,geojson?,kmz?}
 *
 * opts：{ download:false, name, scale:1|2, print:false, title }
 */
(function () {
  'use strict';

  const C = window.Cesium;
  const EXPORT_PREFIX = 'maomaoearth';
  const state = { le: null, ready: false, last: {} };

  const byId = (id) => document.getElementById(id);

  function nowStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return (
      d.getFullYear() +
      p(d.getMonth() + 1) +
      p(d.getDate()) +
      '-' +
      p(d.getHours()) +
      p(d.getMinutes()) +
      p(d.getSeconds())
    );
  }

  function nowText() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return (
      d.getFullYear() +
      '年' +
      p(d.getMonth() + 1) +
      '月' +
      p(d.getDate()) +
      '日 ' +
      p(d.getHours()) +
      ':' +
      p(d.getMinutes()) +
      ':' +
      p(d.getSeconds())
    );
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 2000);
  }

  function escapeXml(text) {
    return String(text == null ? '' : text).replace(/[<>&"']/g, (ch) => ({
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&apos;',
    }[ch]));
  }

  function windLegend() {
    const W = window.LEWindninja;
    if (W && typeof W.getLegend === 'function') {
      try {
        return W.getLegend();
      } catch (err) {
        /* ignore */
      }
    }
    return [];
  }

  function cameraMeta() {
    const le = state.le;
    if (!le || !le.viewer) return null;
    const cam = le.viewer.camera;
    const carto = cam.positionCartographic;
    return {
      longitude: C.Math.toDegrees(carto.longitude),
      latitude: C.Math.toDegrees(carto.latitude),
      height: carto.height,
      heading: C.Math.toDegrees(cam.heading),
      pitch: C.Math.toDegrees(cam.pitch),
    };
  }

  /* --------------------------- 读回渲染画面 --------------------------- */

  /**
   * 在 Cesium 的 postRender 回调内立刻读回 canvas：
   * WebGL 默认 preserveDrawingBuffer=false，帧结束后缓冲会被清空，
   * 因此必须在同一渲染任务内 drawImage 到 2D canvas。
   */
  /** 从 16×16 缩略图统计纯白像素占比：用于识别偶发的全白读回帧（WebGL 缓冲状态异常）。 */
  function probeCanvas(canvas) {
    const probe = document.createElement('canvas');
    probe.width = 16;
    probe.height = 16;
    const pctx = probe.getContext('2d');
    pctx.drawImage(canvas, 0, 0, 16, 16);
    const px = pctx.getImageData(0, 0, 16, 16).data;
    let white = 0;
    let alpha = 0;
    for (let i = 0; i < px.length; i += 4) {
      alpha += px[i + 3];
      if (px[i] >= 252 && px[i + 1] >= 252 && px[i + 2] >= 252) white += 1;
    }
    return { whiteRatio: white / (px.length / 4), transparent: alpha === 0 };
  }

  /** 在下一个（或第 waitFrames 个）Cesium postRender 回调内把 WebGL 画面读回 2D canvas。 */
  function grabFrameOnce(waitFrames) {
    const viewer = state.le.viewer;
    const scene = viewer.scene;
    return new Promise((resolve, reject) => {
      let settled = false;
      let frames = 0;
      const cleanup = () => {
        try {
          scene.postRender.removeEventListener(handler);
        } catch (err) {
          /* ignore */
        }
      };
      const handler = () => {
        frames += 1;
        if (frames < (waitFrames || 1)) return;
        if (settled) return;
        settled = true;
        cleanup();
        try {
          const glCanvas = scene.canvas;
          if (!glCanvas.width || !glCanvas.height) throw new Error('渲染画布尺寸为 0');
          const out = document.createElement('canvas');
          out.width = glCanvas.width;
          out.height = glCanvas.height;
          out.getContext('2d').drawImage(glCanvas, 0, 0);
          resolve(out);
        } catch (err) {
          reject(err);
        }
      };
      try {
        scene.postRender.addEventListener(handler);
        viewer.render();
        scene.requestRender();
      } catch (err) {
        cleanup();
        reject(err);
      }
      setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error('截取画面超时（渲染器无响应）'));
        }
      }, 8000);
    });
  }

  async function captureFrame(opts) {
    const o = opts || {};
    const le = state.le;
    if (!le || !le.viewer) throw new Error('应用尚未就绪');
    const viewer = le.viewer;
    const scene = viewer.scene;
    const scale = o.scale === 2 ? 2 : 1;
    const initialResolution = viewer.resolutionScale;
    if (scale !== 1) {
      try {
        viewer.resolutionScale = initialResolution * scale;
        scene.requestRender();
      } catch (err) {
        /* ignore */
      }
    }
    try {
      let last = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        const canvas = await grabFrameOnce(scale !== 1 ? 2 : 1);
        const probe = probeCanvas(canvas);
        last = { canvas, blank: probe.transparent, whiteRatio: probe.whiteRatio, attempts: attempt + 1 };
        // 偶发全白帧（地形/影像切换瞬间）重试，避免导出纯白底图
        if (!probe.transparent && probe.whiteRatio < 0.9) return last;
        await new Promise((r) => setTimeout(r, 280));
      }
      if (last) return last;
      throw new Error('截取画面失败');
    } finally {
      if (scale !== 1) {
        try {
          viewer.resolutionScale = initialResolution;
          scene.requestRender();
        } catch (err) {
          /* ignore */
        }
      }
    }
  }

  /* --------------------------- 画面合成 --------------------------- */

  function drawArrow(ctx, x, y, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y);
    ctx.lineTo(x + size, y + size * 0.66);
    ctx.lineTo(x + size * 0.64, y + size * 0.66);
    ctx.lineTo(x + size * 0.64, y + size);
    ctx.lineTo(x + size * 0.36, y + size);
    ctx.lineTo(x + size * 0.36, y + size * 0.66);
    ctx.lineTo(x, y + size * 0.66);
    ctx.closePath();
    ctx.fill();
  }

  function composeImage(frameCanvas, opts) {
    const o = opts || {};
    const le = state.le;
    const out = document.createElement('canvas');
    out.width = frameCanvas.width;
    out.height = frameCanvas.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(frameCanvas, 0, 0);

    const cssWidth = le && le.viewer ? le.viewer.scene.canvas.clientWidth || out.width : out.width;
    const s = Math.max(0.75, Math.min(3, out.width / Math.max(1, cssWidth)));

    const pad = Math.round(18 * s);
    const fs = (n) => Math.round(n * s) + 'px';

    // 顶部标题条（半透明渐变，保证白色文字可读）
    const grad = ctx.createLinearGradient(0, 0, 0, Math.round(96 * s));
    grad.addColorStop(0, 'rgba(5,10,16,0.82)');
    grad.addColorStop(1, 'rgba(5,10,16,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, out.width, Math.round(96 * s));

    const title = o.title || '本地地球 Local Earth';
    const wd = window.LEWindninja;
    const stats = wd && typeof wd.getStats === 'function' ? wd.getStats() : null;
    const subtitle = stats
      ? 'Wind3D 风场 · ' +
        stats.label +
        ' · 网格 ' +
        stats.grid.ncols +
        '×' +
        stats.grid.nrows +
        ' · ' +
        Number(stats.grid.cellsize).toFixed(0) +
        ' m · 风速 ' +
        Number(stats.speed.min).toFixed(1) +
        '–' +
        Number(stats.speed.max).toFixed(1) +
        ' m/s'
      : '三维地球 · 完全离线';

    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(232,238,246,0.98)';
    ctx.font = 'bold ' + fs(24) + " 'Segoe UI','Microsoft YaHei',sans-serif";
    ctx.fillText(title, pad, pad);
    ctx.fillStyle = 'rgba(147,164,184,0.98)';
    ctx.font = fs(14) + " 'Segoe UI','Microsoft YaHei',sans-serif";
    ctx.fillText(subtitle, pad, pad + Math.round(34 * s));

    // 左下：时间 + 相机坐标 + 数据来源
    const cam = cameraMeta();
    const lines = [];
    lines.push(nowText());
    if (cam) {
      lines.push(
        '相机 ' +
          cam.latitude.toFixed(5) +
          ', ' +
          cam.longitude.toFixed(5) +
          ' · 高度 ' +
          (Math.abs(cam.height) >= 1000
            ? (cam.height / 1000).toFixed(2) + ' km'
            : cam.height.toFixed(0) + ' m')
      );
    }
    lines.push('数据：NASA Blue Marble · Natural Earth · CesiumJS · 本机离线渲染');
    const lineH = Math.round(20 * s);
    const boxH = lineH * lines.length + Math.round(16 * s);
    const boxW = Math.max(
      Math.round(360 * s),
      Math.min(out.width - pad * 2, Math.round(760 * s))
    );
    ctx.fillStyle = 'rgba(5,10,16,0.62)';
    ctx.fillRect(pad, out.height - boxH - pad, boxW, boxH);
    ctx.fillStyle = 'rgba(232,238,246,0.96)';
    ctx.font = fs(13) + " 'Segoe UI','Microsoft YaHei',sans-serif";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], pad + Math.round(12 * s), out.height - boxH - pad + Math.round(8 * s) + i * lineH);
    }

    // 右上：风速图例
    const legend = windLegend();
    if (legend.length && stats) {
      const rowH = Math.round(22 * s);
      const legendW = Math.round(210 * s);
      const legendH = rowH * legend.length + Math.round(58 * s);
      const lx = out.width - legendW - pad;
      const ly = pad;
      ctx.fillStyle = 'rgba(9,16,23,0.82)';
      ctx.fillRect(lx, ly, legendW, legendH);
      ctx.strokeStyle = 'rgba(36,50,68,0.9)';
      ctx.lineWidth = Math.max(1, s);
      ctx.strokeRect(lx + 0.5, ly + 0.5, legendW - 1, legendH - 1);
      ctx.fillStyle = 'rgba(232,238,246,0.98)';
      ctx.font = 'bold ' + fs(13) + " 'Segoe UI','Microsoft YaHei',sans-serif";
      ctx.fillText('风速 (m/s)', lx + Math.round(12 * s), ly + Math.round(10 * s));
      const arrowSize = Math.round(13 * s);
      for (let i = 0; i < legend.length; i++) {
        const item = legend[i];
        const y = ly + Math.round(36 * s) + i * rowH;
        drawArrow(ctx, lx + Math.round(12 * s), y, arrowSize, item.color);
        ctx.fillStyle = 'rgba(232,238,246,0.94)';
        ctx.font = fs(12.5) + " 'Segoe UI','Microsoft YaHei',sans-serif";
        ctx.fillText(item.label, lx + Math.round(36 * s), y);
      }
    }
    return out;
  }

  /* --------------------------- PNG --------------------------- */

  async function png(opts) {
    const o = opts || {};
    const frame = await captureFrame({ scale: o.scale });
    const composed = composeImage(frame.canvas, o);
    const dataUrl = composed.toDataURL('image/png');
    if (!dataUrl || dataUrl.length < 2000) throw new Error('PNG 生成失败（dataURL 为空）');
    const filename =
      o.name ||
      EXPORT_PREFIX + '-' + nowStamp() + (o.scale === 2 ? '-2x' : '') + '.png';
    if (o.download !== false) {
      const bin = dataUrl.split(',')[1];
      const bytes = atob(bin);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      downloadBlob(new Blob([arr], { type: 'image/png' }), filename);
    }
    const result = {
      filename,
      dataUrl,
      width: composed.width,
      height: composed.height,
      bytes: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75),
      blank: frame.blank,
      whiteRatio: frame.whiteRatio,
      attempts: frame.attempts,
      scale: o.scale === 2 ? 2 : 1,
    };
    state.last.png = result;
    return result;
  }

  /* --------------------------- PDF（打印窗口） --------------------------- */

  function buildPdfHtml(pngDataUrl, opts) {
    const o = opts || {};
    const cam = cameraMeta();
    const wd = window.LEWindninja;
    const stats = wd && typeof wd.getStats === 'function' ? wd.getStats() : null;
    const legend = windLegend();
    const legendRows = legend
      .map(
        (item) =>
          '<li><span class="sw" style="background:' +
          escapeXml(item.color) +
          '"></span>' +
          escapeXml(item.label) +
          ' m/s</li>'
      )
      .join('');
    const gridText = stats
      ? stats.grid.ncols +
        ' × ' +
        stats.grid.nrows +
        ' 格 / ' +
        Number(stats.grid.cellsize).toFixed(0) +
        ' m · 风速 ' +
        Number(stats.speed.min).toFixed(2) +
        '–' +
        Number(stats.speed.max).toFixed(2) +
        ' m/s · 箭头 ' +
        stats.arrowCount
      : '无 Wind3D 风场（仅三维地球视图）';
    const camText = cam
      ? cam.latitude.toFixed(6) +
        ', ' +
        cam.longitude.toFixed(6) +
        ' · 高度 ' +
        cam.height.toFixed(0) +
        ' m · 方位 ' +
        cam.heading.toFixed(1) +
        '° · 俯仰 ' +
        cam.pitch.toFixed(1) +
        '°'
      : '--';
    const title = o.title || '本地地球 · 三维地图导出';
    const autoPrint =
      o.print === false
        ? ''
        : '<script>window.addEventListener("load",function(){setTimeout(function(){try{window.print();}catch(e){}},400);});<\/script>';
    return (
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8" />' +
      '<title>' +
      escapeXml(title) +
      ' · ' +
      nowStamp() +
      '</title>' +
      '<style>' +
      '@page{size:A4 landscape;margin:10mm}' +
      'html,body{margin:0;padding:0;background:#fff;color:#111;font-family:"Segoe UI","Microsoft YaHei",sans-serif}' +
      '.sheet{padding:6mm 8mm}' +
      'h1{font-size:18px;margin:0 0 2mm;color:#123}' +
      '.meta{font-size:11px;color:#445;line-height:1.6;margin-bottom:4mm}' +
      '.shot{width:100%;border:1px solid #ccd;display:block}' +
      '.row{display:flex;gap:8mm;margin-top:4mm;align-items:flex-start}' +
      '.info{flex:1;font-size:11px;line-height:1.7;color:#223}' +
      '.info b{color:#089}' +
      '.legend{font-size:11px;color:#223;min-width:36mm}' +
      '.legend ul{list-style:none;padding:0;margin:0 0 2mm}' +
      '.legend li{display:flex;align-items:center;gap:2mm;margin:1mm 0}' +
      '.sw{display:inline-block;width:9mm;height:2.6mm;border-radius:1mm}' +
      '.foot{margin-top:4mm;font-size:10px;color:#667;border-top:1px solid #dde;padding-top:2mm}' +
      '@media print{.no-print{display:none}}' +
      '</style></head><body><div class="sheet">' +
      '<h1>' +
      escapeXml(title) +
      '</h1>' +
      '<div class="meta">导出时间：' +
      nowText() +
      ' · 相机：' +
      escapeXml(camText) +
      '</div>' +
      '<img class="shot" src="' +
      pngDataUrl +
      '" alt="三维地图截图" />' +
      '<div class="row"><div class="info">' +
      '<div><b>数据范围：</b>' +
      escapeXml(gridText) +
      '</div>' +
      '<div><b>图层：</b>' +
      escapeXml(
        (state.le && state.le.listLayers
          ? state.le.listLayers().filter((l) => !l.system).length
          : 0) + ' 个可见图层'
      ) +
      '</div>' +
      '<div><b>数据来源：</b>NASA Blue Marble（公有领域）、Natural Earth（公有领域）、' +
      'WindNinja / Wind3D 本地结果、CesiumJS 1.146</div>' +
      '<div><b>说明：</b>本页由「本地地球」完全离线生成；在打印对话框中选择“另存为 PDF”即可保存。</div>' +
      '</div><div class="legend"><b>风速图例 (m/s)</b><ul>' +
      legendRows +
      '</ul></div></div>' +
      '<div class="foot">本地地球 Local Earth · 完全离线运行 · 本文件不含任何联网资源</div>' +
      '</div>' +
      '<div class="no-print" style="position:fixed;right:12px;top:12px">' +
      '<button onclick="window.print()" style="padding:8px 14px;font-size:13px">打印 / 另存为 PDF</button>' +
      '</div>' +
      autoPrint +
      '</body></html>'
    );
  }

  async function pdf(opts) {
    const o = opts || {};
    const shot = await png({ download: false, scale: o.scale, title: o.title });
    const html = buildPdfHtml(shot.dataUrl, o);
    // 返回窗口供用户打印；测试时可用 {print:false} 并直接读取内容
    const win = window.open('', '_blank');
    if (!win) throw new Error('浏览器阻止了打印窗口，请允许本站弹出窗口');
    const filename = EXPORT_PREFIX + '-' + nowStamp() + '.pdf';
    try {
      win.document.open();
      win.document.write(html);
      win.document.close();
    } catch (err) {
      throw new Error('无法写入打印窗口：' + err.message);
    }
    const result = { window: win, html, filename, png: shot };
    state.last.pdf = result;
    return result;
  }

  /* --------------------------- GeoJSON --------------------------- */

  function buildGeoJson() {
    const wd = window.LEWindninja;
    const data = wd && typeof wd.getExportData === 'function' ? wd.getExportData() : null;
    const cam = cameraMeta();
    const features = [];
    if (data && data.points && data.points.length) {
      for (const p of data.points) {
        features.push({
          type: 'Feature',
          properties: {
            speed_mps: +Number(p.speed).toFixed(3),
            direction_deg: +Number(p.angle).toFixed(2), // 风来向（气象角度）
            flow_deg: +(((Number(p.angle) + 180) % 360)).toFixed(2), // 风去向
            lon: +Number(p.lon).toFixed(7),
            lat: +Number(p.lat).toFixed(7),
            row: p.row,
            col: p.col,
            scene: data.label,
          },
          geometry: { type: 'Point', coordinates: [+Number(p.lon).toFixed(7), +Number(p.lat).toFixed(7)] },
        });
      }
    } else if (cam) {
      features.push({
        type: 'Feature',
        properties: { name: '相机位置', kind: 'camera' },
        geometry: {
          type: 'Point',
          coordinates: [
            +cam.longitude.toFixed(7),
            +cam.latitude.toFixed(7),
            +cam.height.toFixed(2),
          ],
        },
      });
    }
    const fc = {
      type: 'FeatureCollection',
      generator: '本地地球 Local Earth (offline)',
      generated_at: new Date().toISOString(),
      scene: data ? data.label : null,
      grid: data ? data.stats && data.stats.grid : null,
      speed_range_mps: data && data.stats ? [data.stats.speed.min, data.stats.speed.max] : null,
      features,
    };
    return fc;
  }

  function geojson(opts) {
    const o = opts || {};
    const fc = buildGeoJson();
    const text = JSON.stringify(fc, null, 2);
    const filename = o.name || EXPORT_PREFIX + '-' + nowStamp() + '.geojson';
    if (o.download !== false) {
      downloadBlob(new Blob([text], { type: 'application/geo+json;charset=utf-8' }), filename);
    }
    const result = { filename, text, json: fc, count: fc.features.length };
    state.last.geojson = result;
    return result;
  }

  /* --------------------------- KMZ（手写 ZIP store） --------------------------- */

  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipStore(entries) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xffff;
    const dosDate =
      (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
    const parts = [];
    const central = [];
    let offset = 0;
    for (const entry of entries) {
      const nameBytes = enc.encode(entry.name);
      const data = entry.data instanceof Uint8Array ? entry.data : enc.encode(String(entry.data));
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true); // version needed
      lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
      lv.setUint16(8, 0, true); // store (no compression)
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      const cen = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); // version made by
      cv.setUint16(6, 20, true); // version needed
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true); // extra len
      cv.setUint16(32, 0, true); // comment len
      cv.setUint16(34, 0, true); // disk
      cv.setUint16(36, 0, true); // internal attrs
      cv.setUint32(38, 0, true); // external attrs
      cv.setUint32(42, offset, true);
      cen.set(nameBytes, 46);

      parts.push(local, data);
      central.push(cen);
      offset += local.length + data.length;
    }
    const centralStart = offset;
    let centralSize = 0;
    for (const c of central) centralSize += c.length;
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralStart, true);
    ev.setUint16(20, 0, true);

    const total = offset + centralSize + eocd.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const part of parts) {
      out.set(part, p);
      p += part.length;
    }
    for (const c of central) {
      out.set(c, p);
      p += c.length;
    }
    out.set(eocd, p);
    return out;
  }

  function kmlColor(hex) {
    const r = hex.replace('#', '');
    const rr = r.slice(0, 2);
    const gg = r.slice(2, 4);
    const bb = r.slice(4, 6);
    return ('ff' + bb + gg + rr).toLowerCase();
  }

  function buildLegendPngBase64() {
    const legend = windLegend();
    const w = 210;
    const rowH = 30;
    const h = 46 + rowH * Math.max(1, legend.length) + 8;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(9,16,23,0.88)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(80,110,140,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.fillStyle = '#e8eef6';
    ctx.font = 'bold 14px "Microsoft YaHei","Segoe UI",sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('风速 (m/s)', 12, 10);
    for (let i = 0; i < legend.length; i++) {
      const y = 40 + i * rowH;
      ctx.fillStyle = legend[i].color;
      ctx.beginPath();
      const size = 16;
      ctx.moveTo(12 + size / 2, y);
      ctx.lineTo(12 + size, y + size * 0.66);
      ctx.lineTo(12 + size * 0.64, y + size * 0.66);
      ctx.lineTo(12 + size * 0.64, y + size);
      ctx.lineTo(12 + size * 0.36, y + size);
      ctx.lineTo(12 + size * 0.36, y + size * 0.66);
      ctx.lineTo(12, y + size * 0.66);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e8eef6';
      ctx.font = '13px "Microsoft YaHei","Segoe UI",sans-serif';
      ctx.fillText(legend[i].label, 36, y);
    }
    return canvas.toDataURL('image/png').split(',')[1] || '';
  }

  function buildKml(opts) {
    const o = opts || {};
    const wd = window.LEWindninja;
    const data = wd && typeof wd.getExportData === 'function' ? wd.getExportData() : null;
    const cam = cameraMeta();
    const legend = windLegend();
    const stats = data && data.stats ? data.stats : null;
    const docName = o.title || (data ? '本地地球 Wind3D · ' + data.label : '本地地球导出');
    const nowIso = new Date().toISOString();

    const styles = legend
      .map(
        (item, i) =>
          '<Style id="windbin' +
          i +
          '"><LineStyle><color>' +
          kmlColor(item.color) +
          '</color><width>1.6</width></LineStyle></Style>'
      )
      .join('');
    const styleIdOf = (color) => {
      const idx = legend.findIndex((it) => String(it.color).toLowerCase() === String(color).toLowerCase());
      return 'windbin' + (idx >= 0 ? idx : 0);
    };

    let placemarks = '';
    if (data && data.arrows && data.arrows.length) {
      placemarks = data.arrows
        .map((a, i) => {
          const coords = a.positions
            .map((p) => Number(p[0]).toFixed(7) + ',' + Number(p[1]).toFixed(7) + ',0')
            .join(' ');
          return (
            '<Placemark><name>Arrow ' +
            (i + 1) +
            ' · ' +
            Number(a.speed).toFixed(2) +
            ' m/s</name>' +
            '<ExtendedData>' +
            '<Data name="Speed"><value>' +
            Number(a.speed).toFixed(3) +
            '</value></Data>' +
            '<Data name="Angle"><value>' +
            Number(a.angle).toFixed(2) +
            '</value></Data>' +
            '<Data name="FlowDirection"><value>' +
            Number(a.bearing).toFixed(2) +
            '</value></Data>' +
            '</ExtendedData>' +
            '<styleUrl>#' +
            styleIdOf(a.color) +
            '</styleUrl>' +
            '<LineString><extrude>0</extrude><tessellate>1</tessellate>' +
            '<altitudeMode>clampToGround</altitudeMode>' +
            '<coordinates>' +
            coords +
            '</coordinates></LineString></Placemark>'
          );
        })
        .join('');
    }

    const cameraPlacemark = cam
      ? '<Placemark><name>相机位置</name><description>高度 ' +
        cam.height.toFixed(1) +
        ' m · 方位 ' +
        cam.heading.toFixed(1) +
        '° · 俯仰 ' +
        cam.pitch.toFixed(1) +
        '°</description><Point><coordinates>' +
        cam.longitude.toFixed(7) +
        ',' +
        cam.latitude.toFixed(7) +
        ',' +
        cam.height.toFixed(1) +
        '</coordinates></Point></Placemark>'
      : '';

    const docDescription =
      (stats
        ? 'Wind3D 风场 · 网格 ' +
          stats.grid.ncols +
          '×' +
          stats.grid.nrows +
          ' · 分辨率 ' +
          Number(stats.grid.cellsize).toFixed(0) +
          ' m · 风速 ' +
          Number(stats.speed.min).toFixed(2) +
          '–' +
          Number(stats.speed.max).toFixed(2) +
          ' m/s · 箭头 ' +
          data.arrows.length +
          '（每 ' +
          data.step +
          ' 格抽稀）\n'
        : '') +
      '由「本地地球 Local Earth」离线导出 · ' +
      nowIso +
      '\n数据来源：WindNinja / Wind3D 本地结果 · NASA Blue Marble · Natural Earth';

    return (
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">' +
      '<Document><name>' +
      escapeXml(docName) +
      '</name><description>' +
      escapeXml(docDescription) +
      '</description>' +
      styles +
      '<ScreenOverlay><name>风速图例</name><Icon><href>legend.png</href></Icon>' +
      '<overlayXY x="0" y="1" xunits="fraction" yunits="fraction"/>' +
      '<screenXY x="0.01" y="0.98" xunits="fraction" yunits="fraction"/>' +
      '<size x="0" y="0" xunits="fraction" yunits="fraction"/></ScreenOverlay>' +
      cameraPlacemark +
      (placemarks ? '<Folder><name>Wind Speed（箭头 ' + data.arrows.length + '）</name>' + placemarks + '</Folder>' : '') +
      '</Document></kml>'
    );
  }

  async function kmz(opts) {
    const o = opts || {};
    const kml = buildKml(o);
    const legendB64 = buildLegendPngBase64();
    const bin = atob(legendB64);
    const pngBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) pngBytes[i] = bin.charCodeAt(i);
    const enc = new TextEncoder();
    const zipBytes = zipStore([
      { name: 'doc.kml', data: enc.encode(kml) },
      { name: 'legend.png', data: pngBytes },
    ]);
    const filename = o.name || EXPORT_PREFIX + '-' + nowStamp() + '.kmz';
    const blob = new Blob([zipBytes], { type: 'application/vnd.google-earth.kmz' });
    if (o.download !== false) downloadBlob(blob, filename);
    const result = { filename, bytes: zipBytes, kml, blob, size: zipBytes.length };
    state.last.kmz = result;
    return result;
  }

  /* --------------------------- UI 绑定 --------------------------- */

  function bindUI() {
    const run = (fn, label) => (ev) => {
      if (ev) ev.preventDefault();
      Promise.resolve()
        .then(fn)
        .catch((err) => {
          console.error('[LEExport] ' + label + ' 失败', err);
          if (state.le && state.le.toast) state.le.toast(label + '失败：' + err.message, 'error', 6000);
          if (state.le && state.le.status) state.le.status(label + '失败：' + err.message, 'error');
        });
    };
    const bind = (id, fn, label) => {
      const el = byId(id);
      if (el) el.addEventListener('click', run(fn, label));
    };
    bind('btn-export-png', () => png({ scale: 1 }), 'PNG 导出');
    bind('btn-export-pdf', () => pdf(), 'PDF 导出');
    bind('btn-export-geojson', () => {
      const res = geojson();
      if (state.le) {
        state.le.toast('GeoJSON 已导出：' + res.count + ' 个要素', 'ok', 3200);
        state.le.status('GeoJSON 已导出 · ' + res.count + ' 个要素 · ' + res.filename);
      }
      return res;
    }, 'GeoJSON 导出');
    bind('btn-export-kmz', () => {
      const res = kmz();
      if (state.le) {
        state.le.toast('KMZ 已导出：' + Math.round(res.size / 1024) + ' KB', 'ok', 3200);
        state.le.status('KMZ 已导出 · ' + Math.round(res.size / 1024) + ' KB · ' + res.filename);
      }
      return res;
    }, 'KMZ 导出');
  }

  function init(le) {
    if (state.ready) return;
    state.le = le || window.LE;
    if (!state.le || !state.le.viewer) return;
    state.ready = true;
    bindUI();
  }

  window.LEExport = {
    init,
    png,
    pdf,
    geojson,
    kmz,
    buildPdfHtml,
    // 测试/调试辅助
    _zipStore: zipStore,
    _crc32: crc32,
    _buildKml: buildKml,
    _buildGeoJson: buildGeoJson,
    getLast: () => state.last,
  };

  if (window.LE) init(window.LE);
  else document.addEventListener('local-earth-ready', () => init(window.LE), { once: true });
})();

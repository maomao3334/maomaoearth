/*
 * Local Earth — 纯 JS Mapbox Vector Tile (MVT / pbf) 解码 + Canvas 栅格化 + Cesium ImageryProvider
 * ---------------------------------------------------------------------------------------------
 * 无第三方依赖、完全离线；兼容 Cesium 1.146 的 ImageryProvider 接口。
 *
 * 对外接口：
 *   window.LEMvt.decodeTile(arrayBuffer)                       -> { layers, featureCount, layerCount }
 *   window.LEMvt.renderTileToCanvas(arrayBuffer, size, opts)   -> HTMLCanvasElement
 *   window.LEMvt.renderTileToCanvasLayer(buffer, layerName, size, opts) -> HTMLCanvasElement
 *   window.LEMvt.createImageryProvider({ base, token, meta })  -> Cesium ImageryProvider 兼容对象
 *   window.LEMvt.decodeTileAsync(arrayBuffer)                  -> Promise<decoded>（自动处理 gzip）
 *   window.LEMvt.decompressTile(arrayBuffer)                   -> Promise<ArrayBuffer>（gzip 自动解压）
 *   window.LEMvt.styleForLayer(name)                           -> 稳定的图层配色
 *
 * 兼容：window.MVT = { parse: decodeTile }，供旧版 js/mbtiles.js 继续使用。
 *
 * 说明 / 限制见 docs/MVT.md：不解析表达式 / 过滤器 / 标签；不感知 style.json；gzip 仅异步路径处理。
 */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';

  /* =========================================================================================
   * 1. 基础工具
   * ======================================================================================= */

  function toUint8(input) {
    if (input == null) throw new TypeError('MVT：输入为空');
    if (input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    if (typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function' && Buffer.isBuffer(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    if (typeof input.length === 'number') return Uint8Array.prototype.slice.call(input);
    throw new TypeError('MVT：不支持的输入类型，需要 ArrayBuffer / Uint8Array');
  }

  function Reader(bytes, start, end) {
    this.bytes = bytes;
    this.pos = start || 0;
    this.end = end == null ? bytes.length : end;
  }

  Reader.prototype.varint = function () {
    var result = 0;
    var shift = 0;
    var b;
    while (true) {
      if (this.pos >= this.end) throw new Error('MVT：varint 数据截断（offset ' + this.pos + '）');
      b = this.bytes[this.pos++];
      // JS Number 可精确表示到 2^53；MVT 几何/属性远超这个范围没有实际意义。
      result += (b & 0x7f) * Math.pow(2, shift);
      if (!(b & 0x80)) return result;
      shift += 7;
      if (shift > 63) throw new Error('MVT：varint 过长');
    }
  };

  Reader.prototype.skip = function (wire) {
    if (wire === 0) { this.varint(); return; }
    if (wire === 1) { this.need(8); this.pos += 8; return; }
    if (wire === 2) { var n = this.varint(); this.need(n); this.pos += n; return; }
    if (wire === 5) { this.need(4); this.pos += 4; return; }
    throw new Error('MVT：不支持的 protobuf wire type ' + wire);
  };

  Reader.prototype.need = function (n) {
    if (this.pos + n > this.end) throw new Error('MVT：数据截断（需要 ' + n + ' 字节，剩余 ' + (this.end - this.pos) + '）');
  };

  Reader.prototype.string = function (len) {
    this.need(len);
    var start = this.pos;
    var end = start + len;
    this.pos = end;
    var sub = this.bytes.subarray(start, end);
    if (typeof TextDecoder === 'function') {
      try { return new TextDecoder('utf-8').decode(sub); } catch (e) { /* fallthrough */ }
    }
    var s = '';
    for (var i = 0; i < sub.length; i++) s += String.fromCharCode(sub[i]);
    return s;
  };

  Reader.prototype.bytesView = function (len) {
    this.need(len);
    var start = this.pos;
    this.pos += len;
    return this.bytes.subarray(start, start + len);
  };

  // protobuf zigzag（比位运算版本对 >32bit 的数值更稳）
  function zigzag(n) {
    if (n < 0) return NaN;
    return (n % 2 === 0) ? n / 2 : -(n + 1) / 2;
  }

  function readFixed(bytes, offset, size) {
    var view = new DataView(bytes.buffer, bytes.byteOffset + offset, size);
    return size === 4 ? view.getFloat32(0, true) : view.getFloat64(0, true);
  }

  /* =========================================================================================
   * 2. MVT 解码（Mapbox Vector Tile spec 2.x）
   * -----------------------------------------------------------------------------------------
   * Tile    : layers = 3
   * Layer   : name = 1, features = 2, keys = 3, values = 4, extent = 5, version = 15
   * Feature : id = 1, tags = 2 (packed), type = 3, geometry = 4 (packed)
   * Value   : string = 1, float = 2, double = 3, int = 4, uint = 5, sint = 6, bool = 7
   * Geom    : MoveTo = 1, LineTo = 2, ClosePath = 7（参数 zigzag delta 编码）
   * ======================================================================================= */

  var GEOM_POINT = 1;
  var GEOM_LINE = 2;
  var GEOM_POLYGON = 3;

  function decodeGeometry(commands, typeId) {
    var i = 0;
    var x = 0;
    var y = 0;
    var parts = [];
    var current = null;
    var pointParts = [];

    while (i < commands.length) {
      var cmd = commands[i++];
      var id = cmd & 0x7;
      var count = cmd >>> 3;
      if (!count) break;

      if (id === 1) { // MoveTo：开始新的 part / ring
        for (var m = 0; m < count; m++) {
          if (i + 1 >= commands.length) return parts; // 容错：截断几何
          x += zigzag(commands[i++]);
          y += zigzag(commands[i++]);
          if (typeId === GEOM_POINT) {
            pointParts.push([x, y]);
          } else {
            current = [[x, y]];
            parts.push(current);
          }
        }
      } else if (id === 2) { // LineTo
        for (var l = 0; l < count; l++) {
          if (i + 1 >= commands.length) return parts;
          x += zigzag(commands[i++]);
          y += zigzag(commands[i++]);
          if (current) current.push([x, y]);
        }
      } else if (id === 7) { // ClosePath：环按规范闭合，绘制时由 ctx.closePath() 处理
        current = null;
      } else {
        // 未知命令：停止解析该要素，保留已解析部分
        break;
      }
    }

    if (typeId === GEOM_POINT) {
      // 点要素返回 [[x,y], ...] 形式，便于与多点（MultiPoint）统一处理
      return pointParts.map(function (pt) { return [pt]; });
    }
    return parts;
  }

  function parseValue(r) {
    var value = null;
    while (r.pos < r.end) {
      var key = r.varint();
      var field = key >>> 3;
      var wire = key & 0x7;
      if (field === 1 && wire === 2) {
        value = r.string(r.varint());
      } else if (field === 2 && wire === 5) {
        r.need(4);
        value = readFixed(r.bytes, r.pos, 4);
        r.pos += 4;
      } else if (field === 3 && wire === 1) {
        r.need(8);
        value = readFixed(r.bytes, r.pos, 8);
        r.pos += 8;
      } else if (field === 4 && wire === 0) {
        value = r.varint();
      } else if (field === 5 && wire === 0) {
        value = r.varint();
      } else if (field === 6 && wire === 0) {
        value = zigzag(r.varint());
      } else if (field === 7 && wire === 0) {
        value = r.varint() !== 0;
      } else {
        r.skip(wire);
      }
    }
    return value;
  }

  function parseFeature(r) {
    var feature = { id: 0, tags: [], typeId: 0, geometry: [] };
    while (r.pos < r.end) {
      var key = r.varint();
      var field = key >>> 3;
      var wire = key & 0x7;
      if (field === 1 && wire === 0) {
        feature.id = r.varint();
      } else if (field === 2 && wire === 2) {
        var tagsLen = r.varint();
        var tagsEnd = r.pos + tagsLen;
        if (tagsEnd > r.end) throw new Error('MVT：feature.tags 越界');
        while (r.pos < tagsEnd) feature.tags.push(r.varint());
      } else if (field === 3 && wire === 0) {
        feature.typeId = r.varint();
      } else if (field === 4 && wire === 2) {
        var geomLen = r.varint();
        var geomEnd = r.pos + geomLen;
        if (geomEnd > r.end) throw new Error('MVT：feature.geometry 越界');
        while (r.pos < geomEnd) feature.geometry.push(r.varint());
      } else {
        r.skip(wire);
      }
    }
    return feature;
  }

  function parseLayer(r, end) {
    var layer = {
      name: '',
      extent: 4096,
      version: 2,
      features: [],
      featureCount: 0,
    };
    var rawFeatures = [];
    var keys = [];
    var values = [];

    while (r.pos < end) {
      var key = r.varint();
      var field = key >>> 3;
      var wire = key & 0x7;
      if (field === 1 && wire === 2) {
        layer.name = r.string(r.varint());
      } else if (field === 2 && wire === 2) {
        var len = r.varint();
        var subEnd = r.pos + len;
        if (subEnd > end) throw new Error('MVT：layer.features 越界');
        rawFeatures.push(parseFeature(new Reader(r.bytes, r.pos, subEnd)));
        r.pos = subEnd;
      } else if (field === 3 && wire === 2) {
        keys.push(r.string(r.varint()));
      } else if (field === 4 && wire === 2) {
        var vlen = r.varint();
        var vend = r.pos + vlen;
        if (vend > end) throw new Error('MVT：layer.values 越界');
        values.push(parseValue(new Reader(r.bytes, r.pos, vend)));
        r.pos = vend;
      } else if (field === 5 && wire === 0) {
        layer.extent = r.varint();
      } else if (field === 15 && wire === 0) {
        layer.version = r.varint();
      } else {
        r.skip(wire);
      }
    }

    if (!isFinite(layer.extent) || layer.extent <= 0) layer.extent = 4096;

    for (var i = 0; i < rawFeatures.length; i++) {
      var f = rawFeatures[i];
      var type;
      if (f.typeId === GEOM_POINT) type = 'point';
      else if (f.typeId === GEOM_LINE) type = 'line';
      else if (f.typeId === GEOM_POLYGON) type = 'polygon';
      else continue; // 未知类型（0）按规范不出现，跳过

      var parts = decodeGeometry(f.geometry, f.typeId);
      if (!parts.length) continue;

      var properties = {};
      for (var t = 0; t + 1 < f.tags.length; t += 2) {
        var k = keys[f.tags[t]];
        var v = values[f.tags[t + 1]];
        if (k != null) properties[k] = v;
      }

      layer.features.push({
        id: f.id,
        type: type,
        typeId: f.typeId,
        geometry: parts,
        properties: properties,
      });
      layer.featureCount++;
    }
    return layer;
  }

  /**
   * 解码一个 MVT/pbf 瓦片（同步；输入必须是未压缩的 pbf 字节）。
   * @param {ArrayBuffer|Uint8Array} buffer
   * @returns {{layers: Array, featureCount: number, layerCount: number}}
   */
  function decodeTile(buffer) {
    var bytes = toUint8(buffer);
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      throw new Error('MVT：瓦片是 gzip 压缩数据，请使用 LEMvt.decodeTileAsync / LEMvt.decompressTile（ImageryProvider 会自动处理）');
    }
    var r = new Reader(bytes);
    var layers = [];
    var featureCount = 0;

    while (r.pos < r.end) {
      var key = r.varint();
      var field = key >>> 3;
      var wire = key & 0x7;
      if (field === 3 && wire === 2) {
        var len = r.varint();
        var end = r.pos + len;
        if (end > r.end) throw new Error('MVT：layer 长度越界');
        var layer = parseLayer(new Reader(r.bytes, r.pos, end), end);
        layers.push(layer);
        featureCount += layer.featureCount;
        r.pos = end;
      } else {
        r.skip(wire);
      }
    }

    return {
      layers: layers,
      featureCount: featureCount,
      layerCount: layers.length,
    };
  }

  /* =========================================================================================
   * 3. 样式：按图层名稳定调色（FNV-1a 哈希 -> HSL），可被 opts.style 覆盖
   * ======================================================================================= */

  function hash32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  var styleCache = Object.create(null);

  function styleForLayer(name) {
    var key = String(name == null ? '' : name);
    var cached = styleCache[key];
    if (cached) return cached;
    var h = hash32(key);
    var hue = h % 360;
    var sat = 52 + ((h >>> 9) % 20);          // 52–71%
    var light = 56 + ((h >>> 17) % 12);        // 56–67%
    var strokeLight = Math.min(88, light + 20);
    var style = {
      hue: hue,
      fill: 'hsla(' + hue + ',' + sat + '%,' + light + '%,0.42)',
      stroke: 'hsla(' + hue + ',' + Math.min(92, sat + 18) + '%,' + strokeLight + '%,0.92)',
      point: 'hsl(' + hue + ',' + Math.min(94, sat + 22) + '%,' + Math.min(84, light + 20) + '%)',
      lineWidth: 1.4,
      pointRadius: 2.6,
    };
    styleCache[key] = style;
    return style;
  }

  function mergeStyle(base, patch) {
    if (!patch) return base;
    var out = {
      fill: patch.fill !== undefined ? patch.fill : base.fill,
      stroke: patch.stroke !== undefined ? patch.stroke : base.stroke,
      point: patch.point !== undefined ? patch.point : base.point,
      lineWidth: patch.lineWidth !== undefined ? patch.lineWidth : base.lineWidth,
      pointRadius: patch.pointRadius !== undefined ? patch.pointRadius : base.pointRadius,
      hue: base.hue,
    };
    return out;
  }

  function resolveStyle(name, opts) {
    var base = styleForLayer(name);
    if (!opts || !opts.style) return base;
    if (typeof opts.style === 'function') return mergeStyle(base, opts.style(name));
    if (typeof opts.style === 'object') return mergeStyle(base, opts.style[name]);
    return base;
  }

  /* =========================================================================================
   * 4. Canvas 栅格化
   * ======================================================================================= */

  function createCanvas(width, height) {
    var doc = root.document;
    if (!doc || typeof doc.createElement !== 'function') {
      throw new Error('MVT：当前环境没有 document，无法创建 canvas（Node 仅支持 decodeTile）');
    }
    var canvas = doc.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  }

  function blankCanvas(size) {
    return createCanvas(size, size);
  }

  function drawFeatures(canvas, tile, opts) {
    opts = opts || {};
    var size = opts.size || 256;
    var ratio = opts.pixelRatio || 1;
    var scaleBase = size; // 以 256 CSS px 为基准的线宽/点半径
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('MVT：无法获取 2d context');

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, size, size);
    }

    var lineFactor = size / 256;
    var layers = tile.layers;
    var typeOrder = ['polygon', 'line', 'point'];

    for (var ti = 0; ti < typeOrder.length; ti++) {
      var wantType = typeOrder[ti];
      for (var li = 0; li < layers.length; li++) {
        var layer = layers[li];
        var extent = layer.extent || 4096;
        var k = size / extent;
        var style = resolveStyle(layer.name, opts);
        var lineWidth = Math.max(0.5, style.lineWidth * lineFactor);
        var pointRadius = Math.max(1.2, style.pointRadius * lineFactor);
        var features = layer.features;
        for (var fi = 0; fi < features.length; fi++) {
          var feature = features[fi];
          if (feature.type !== wantType) continue;

          if (wantType === 'polygon') {
            if (!style.fill && !style.stroke) continue;
            ctx.beginPath();
            var rings = feature.geometry;
            for (var p = 0; p < rings.length; p++) {
              var ring = rings[p];
              if (!ring || ring.length < 2) continue;
              ctx.moveTo(ring[0][0] * k, ring[0][1] * k);
              for (var q = 1; q < ring.length; q++) ctx.lineTo(ring[q][0] * k, ring[q][1] * k);
              ctx.closePath();
            }
            if (style.fill) {
              ctx.fillStyle = style.fill;
              // evenodd：内环（洞）不被填充；不依赖 ring winding
              try { ctx.fill('evenodd'); } catch (e) { ctx.fill(); }
            }
            if (style.stroke) {
              ctx.strokeStyle = style.stroke;
              ctx.lineWidth = lineWidth;
              ctx.lineJoin = 'round';
              ctx.stroke();
            }
          } else if (wantType === 'line') {
            if (!style.stroke) continue;
            ctx.strokeStyle = style.stroke;
            ctx.lineWidth = lineWidth;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            var lines = feature.geometry;
            for (var l = 0; l < lines.length; l++) {
              var line = lines[l];
              if (!line || line.length < 2) continue;
              ctx.moveTo(line[0][0] * k, line[0][1] * k);
              for (var m = 1; m < line.length; m++) ctx.lineTo(line[m][0] * k, line[m][1] * k);
            }
            ctx.stroke();
          } else { // point
            if (!style.point) continue;
            ctx.fillStyle = style.point;
            var pts = feature.geometry;
            for (var pp = 0; pp < pts.length; pp++) {
              var part = pts[pp];
              var pt = (part && part.length && typeof part[0] === 'number') ? part : (part && part[0]);
              if (!pt || pt.length < 2) continue;
              ctx.beginPath();
              ctx.arc(pt[0] * k, pt[1] * k, pointRadius, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
    }
    return canvas;
  }

  function makeCanvasAndDraw(tile, size, opts) {
    size = sanitizeSize(size, 256);
    opts = opts || {};
    var ratio = opts.pixelRatio || 1;
    var canvas = createCanvas(size * ratio, size * ratio);
    if (ratio !== 1) {
      try {
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
      } catch (e) { /* ignore */ }
    }
    return drawFeatures(canvas, tile, {
      size: size,
      pixelRatio: ratio,
      background: opts.background,
      style: opts.style,
    });
  }

  function sanitizeSize(size, fallback) {
    var n = Number(size);
    if (!isFinite(n) || n <= 0) return fallback;
    return Math.max(1, Math.min(4096, Math.round(n)));
  }

  function filterTileLayers(tile, layerName) {
    var name = String(layerName == null ? '' : layerName);
    var matched = tile.layers.filter(function (layer) {
      return layer.name === name;
    });
    if (!matched.length) {
      matched = tile.layers.filter(function (layer) {
        return String(layer.name).toLowerCase() === name.toLowerCase();
      });
    }
    if (!matched.length) return null;
    var featureCount = 0;
    for (var i = 0; i < matched.length; i++) featureCount += matched[i].featureCount;
    return { layers: matched, featureCount: featureCount, layerCount: matched.length };
  }

  /**
   * 解码并栅格化整块瓦片（同步；输入不能是 gzip）。
   * @param {ArrayBuffer|Uint8Array} buffer
   * @param {number} [size=256]
   * @param {{pixelRatio?: number, background?: string, style?: object|Function}} [opts]
   * @returns {HTMLCanvasElement}
   */
  function renderTileToCanvas(buffer, size, opts) {
    var tile = decodeTile(buffer);
    return makeCanvasAndDraw(tile, size, opts);
  }

  /**
   * 只渲染指定图层（同步；输入不能是 gzip）。图层不存在时返回透明空白 canvas。
   */
  function renderTileToCanvasLayer(buffer, layerName, size, opts) {
    var tile = decodeTile(buffer);
    var only = filterTileLayers(tile, layerName);
    if (!only) return blankCanvas(sanitizeSize(size, 256));
    return makeCanvasAndDraw(only, size, opts);
  }

  /* =========================================================================================
   * 5. gzip 解压（浏览器 DecompressionStream），用于本地 MBTiles 服务不自动解压的场景
   * ======================================================================================= */

  function decompressTile(buffer) {
    var bytes = toUint8(buffer);
    if (!(bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b)) {
      return Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    if (typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error('MVT：瓦片为 gzip 压缩，但当前浏览器不支持 DecompressionStream'));
    }
    var stream;
    try {
      stream = new DecompressionStream('gzip');
    } catch (e) {
      return Promise.reject(new Error('MVT：浏览器不支持 DecompressionStream("gzip")'));
    }
    try {
      var body = new Response(bytes).body;
      return new Response(body.pipeThrough(stream)).arrayBuffer();
    } catch (e) {
      return Promise.reject(e);
    }
  }

  /**
   * 异步解码：自动识别 gzip 并解压后解码。
   */
  function decodeTileAsync(buffer) {
    return decompressTile(buffer).then(function (raw) { return decodeTile(raw); });
  }

  /* =========================================================================================
   * 6. Cesium ImageryProvider
   * ======================================================================================= */

  function getCesium(explicit) {
    var C = explicit || root.Cesium;
    if (!C) throw new Error('LEMvt.createImageryProvider 需要 Cesium（未找到 window.Cesium）');
    return C;
  }

  function clampLevel(v, fallback, min, max) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function parseBounds(meta) {
    if (!meta) return null;
    var bounds = meta.bounds;
    if (!bounds) return null;
    var arr;
    if (Array.isArray(bounds)) {
      arr = bounds.map(Number);
    } else {
      arr = String(bounds).split(',').map(Number);
    }
    if (arr.length !== 4) return null;
    for (var i = 0; i < 4; i++) if (!isFinite(arr[i])) return null;
    var west = Math.max(-180, Math.min(180, arr[0]));
    var south = Math.max(-90, Math.min(90, arr[1]));
    var east = Math.max(-180, Math.min(180, arr[2]));
    var north = Math.max(-90, Math.min(90, arr[3]));
    if (east <= west || north <= south) return null;
    return [west, south, east, north];
  }

  function isGeographicCrs(crs) {
    return /4326|geographic|wgs\s*84|wgs84/i.test(String(crs || ''));
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 创建 Cesium ImageryProvider（矢量瓦片按需 fetch + 解码 + 栅格化）。
   *
   * @param {Object} options
   * @param {string} options.base  MBTiles 瓦片服务根地址，如 http://127.0.0.1:8140
   * @param {string} [options.token]  服务 token
   * @param {Object} [options.meta]   /meta.json 的内容（format/crs/bounds/minzoom/maxzoom/attribution/name）
   * @param {string} [options.tileUrlTemplate] 可选，覆盖默认 `${base}/tiles/{z}/{x}/{y}.pbf?token={token}`
   * @param {number} [options.tileSize=256]
   * @param {Function} [options.onError]  单个瓦片失败时的回调（默认 console.warn），失败本身不抛异常
   * @returns {Object} 满足 Cesium.ImageryProvider 形状的对象
   */
  function createImageryProvider(options) {
    options = options || {};
    var C = getCesium(options.Cesium);
    var base = String(options.base || '').replace(/\/+$/, '');
    if (!base && !options.tileUrlTemplate) throw new Error('LEMvt.createImageryProvider：请提供 base（MBTiles 服务地址）');

    var meta = options.meta || {};
    var token = options.token == null ? '' : String(options.token);
    var tileSize = sanitizeSize(options.tileSize, 256);
    var crs = meta.crs || meta.projection || 'EPSG:3857';
    var geographic = isGeographicCrs(crs);
    var tilingScheme = geographic ? new C.GeographicTilingScheme() : new C.WebMercatorTilingScheme();

    var bounds = parseBounds(meta);
    var rectangle = null;
    if (bounds) {
      rectangle = C.Rectangle.fromDegrees(bounds[0], bounds[1], bounds[2], bounds[3]);
    } else {
      rectangle = tilingScheme.rectangle;
    }

    var minLevel = clampLevel(options.minimumLevel != null ? options.minimumLevel : meta.minzoom, 0, 0, 30);
    var maxLevel = clampLevel(options.maximumLevel != null ? options.maximumLevel : meta.maxzoom, 22, 0, 30);
    if (maxLevel < minLevel) maxLevel = minLevel;

    var creditText = meta.attribution || meta.name || 'MBTiles (MVT)';
    var credit = new C.Credit(escapeHtml(creditText));

    var onError = typeof options.onError === 'function'
      ? options.onError
      : function (err) {
        if (root.console && root.console.warn) {
          root.console.warn('[LEMvt] 瓦片渲染失败：', err && err.message ? err.message : err);
        }
      };

    var template = options.tileUrlTemplate || null;

    function tileUrl(level, x, y) {
      if (template) {
        return String(template)
          .replace(/\{z\}/g, String(level))
          .replace(/\{x\}/g, String(x))
          .replace(/\{y\}/g, String(y))
          .replace(/\{token\}/g, encodeURIComponent(token));
      }
      return base + '/tiles/' + level + '/' + x + '/' + y + '.pbf?token=' + encodeURIComponent(token);
    }

    function requestImage(x, y, level, request) {
      var url = tileUrl(level, x, y);
      var controller = (typeof AbortController === 'function') ? new AbortController() : null;
      if (request && typeof request === 'object') {
        // Cesium 取消瓦片请求时会调用 cancelFunction
        try { request.cancelFunction = function () { if (controller) controller.abort(); }; } catch (e) { /* ignore */ }
      }
      var fetchOpts = { cache: options.cache || 'no-store' };
      if (controller) fetchOpts.signal = controller.signal;

      return fetch(url, fetchOpts).then(function (res) {
        if (res.status === 204 || res.status === 404) return blankCanvas(tileSize);
        if (!res.ok) {
          onError(new Error('MBTiles 瓦片 HTTP ' + res.status + '：' + url));
          return blankCanvas(tileSize);
        }
        return res.arrayBuffer().then(decompressTile).then(function (raw) {
          try {
            return renderTileToCanvas(raw, tileSize, { pixelRatio: options.pixelRatio || 1, style: options.style });
          } catch (err) {
            onError(err);
            return blankCanvas(tileSize);
          }
        });
      }).catch(function (err) {
        if (!(err && err.name === 'AbortError')) onError(err);
        return blankCanvas(tileSize);
      });
    }

    var provider = {
      ready: true,
      readyPromise: Promise.resolve(true),
      tilingScheme: tilingScheme,
      rectangle: rectangle,
      tileWidth: tileSize,
      tileHeight: tileSize,
      minimumLevel: minLevel,
      maximumLevel: maxLevel,
      hasAlphaChannel: true,
      credit: credit,
      // 便于调试/测试
      isVectorProvider: true,
      crs: String(crs),
      geographic: geographic,
      getTileCredits: function () { return [credit]; },
      requestImage: requestImage,
      tileUrl: tileUrl,
    };
    return provider;
  }

  /* =========================================================================================
   * 7. 导出
   * ======================================================================================= */

  var api = {
    version: VERSION,
    decodeTile: decodeTile,
    decodeTileAsync: decodeTileAsync,
    decompressTile: decompressTile,
    renderTileToCanvas: renderTileToCanvas,
    renderTileToCanvasLayer: renderTileToCanvasLayer,
    createImageryProvider: createImageryProvider,
    styleForLayer: styleForLayer,
    // 便于测试/调试
    _internals: {
      toUint8: toUint8,
      decodeGeometry: decodeGeometry,
      hash32: hash32,
      isGeographicCrs: isGeographicCrs,
    },
  };

  root.LEMvt = api;
  // 向后兼容：旧版 js/mbtiles.js 使用 window.MVT.parse(buffer)
  root.MVT = { parse: decodeTile };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

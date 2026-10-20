/*
 * 本地地球 Local Earth — Wind3D / WindNinja 结果直读（P0）
 * ---------------------------------------------------------------------------
 * 离线读取 WindNinja / Wind3D 的 ESRI ASCII Grid 结果（*_vel.asc + *_ang.asc + *.prj），
 * 在 JS 内完成 UTM → WGS84 反算，把风速/风向渲染为按风速分级的 3D 箭头。
 *
 * 对外 API：window.LEWindninja
 *   init(le)                              初始化（通常由 'local-earth-ready' 自动触发）
 *   load({vel, ang, prj, label})          直接加载（每个参数可为 ASC/PRJ 文本、File/Blob 或 URL）
 *   loadUrl(velUrl)                       通过本地相对 URL 加载（自动找同名 _ang.asc / .prj）
 *   loadFiles(files)                      通过 <input webkitdirectory> 的 File 列表加载（可含多个场景）
 *   listScenes()                          场景列表 [{index,label,group,timestamp,height,resolution,active}]
 *   showScene(i)                          切换场景（async）
 *   next() / prev() / play(on?) / isPlaying()
 *   clear()                               清除风场渲染与图例
 *   getBounds()                           当前场景经纬度范围 {west,south,east,north}
 *   getStats()                            当前场景统计（网格/分辨率/风速范围/箭头数等）
 *   getScenes()                           原始场景描述（调试）
 *   getExportData()                       供 js/exporter.js 使用的采样点/箭头数据
 *   getProjectState()                     供 js/project.js 保存工程使用（当前场景 + 源）
 *   getLegend()                           当前风速分级定义
 *
 * 性能：箭头用 Cesium.PolylineCollection（单 primitive 批量绘制），按性能档位抽稀
 *      （高画质每 2 格、均衡每 3 格、流畅每 4 格，且总数上限约 3000）。
 * 离线：只 fetch 同源相对 URL 或读取本地 File；不访问任何外部网络。
 */
(function () {
  'use strict';

  const C = window.Cesium;

  /* ------------------------------ 风速分级 ------------------------------ */
  // 与内置 Wind3D KML 图例一致：0–2.14 蓝、2.15–4.30 绿、4.31–6.45 黄、
  // 6.46–8.60 橙、8.61–10.76 红、>10.76 深红（m/s）。
  const WIND_BINS = [
    { min: -Infinity, max: 2.14, color: '#3a63ff', label: '0.00 – 2.14', name: 'blue' },
    { min: 2.15, max: 4.30, color: '#29c65a', label: '2.15 – 4.30', name: 'green' },
    { min: 4.31, max: 6.45, color: '#ffdb39', label: '4.31 – 6.45', name: 'yellow' },
    { min: 6.46, max: 8.60, color: '#ff8c1a', label: '6.46 – 8.60', name: 'orange' },
    { min: 8.61, max: 10.76, color: '#ff3a3a', label: '8.61 – 10.76', name: 'red' },
    { min: 10.77, max: Infinity, color: '#ae1414', label: '> 10.76', name: 'darkred' },
  ];

  const ARROW_WIDTH = 1.6; // 屏幕像素
  const ARROW_LIFT = 3; // 贴地抬升（米）
  const MAX_ARROWS = 3000;
  const PLAY_INTERVAL_MS = 1400;

  const state = {
    le: null,
    ready: false,
    scenes: [], // 场景描述（含文件/URL 与懒读取的文本缓存）
    current: -1,
    polylines: null,
    arrowCount: 0,
    layer: null,
    legendEl: null,
    playing: false,
    timer: 0,
    autoLoaded: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const byId = (id) => document.getElementById(id);

  function fmt(v, digits) {
    if (v == null || !isFinite(v)) return '--';
    return Number(v).toFixed(digits == null ? 2 : digits);
  }

  /* --------------------------- ESRI ASCII Grid 解析 --------------------------- */

  function parseAsciiGrid(text) {
    const raw = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/);
    const header = {};
    let idx = 0;
    for (; idx < lines.length; idx++) {
      const line = lines[idx].trim();
      if (!line) continue;
      const m = /^([A-Za-z_]+)\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/.exec(line);
      if (!m) break;
      header[m[1].toLowerCase()] = parseFloat(m[2]);
    }
    const ncols = Math.round(header.ncols);
    const nrows = Math.round(header.nrows);
    if (!(ncols > 0) || !(nrows > 0)) {
      throw new Error('ASC 缺少有效的 ncols/nrows 头信息');
    }
    const cellsize = header.cellsize != null ? header.cellsize : 1;
    const nodata = header.nodata_value != null ? header.nodata_value : -32768;
    const xll =
      header.xllcorner != null
        ? header.xllcorner
        : header.xllcenter != null
          ? header.xllcenter - cellsize / 2
          : NaN;
    const yll =
      header.yllcorner != null
        ? header.yllcorner
        : header.yllcenter != null
          ? header.yllcenter - cellsize / 2
          : NaN;
    if (!isFinite(xll) || !isFinite(yll)) throw new Error('ASC 缺少 xllcorner/yllcorner（或 center）');

    const total = ncols * nrows;
    const data = new Float32Array(total);
    let p = 0;
    for (; idx < lines.length && p < total; idx++) {
      const line = lines[idx];
      if (!line || !line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      for (let i = 0; i < parts.length && p < total; i++) {
        const t = parts[i];
        if (!t) continue;
        data[p++] = parseFloat(t);
      }
    }
    if (p < total) {
      throw new Error('ASC 数据不足：期望 ' + total + ' 个值，实际 ' + p + ' 个');
    }
    return { ncols, nrows, cellsize, xll, yll, nodata, data };
  }

  /* ------------------------------ PRJ 解析 ------------------------------ */

  function parsePrj(text) {
    const raw = String(text == null ? '' : text);
    const out = {
      raw,
      geographic: true,
      zone: null,
      hemisphere: 'N',
      centralMeridian: null,
      latitudeOfOrigin: 0,
      scaleFactor: 0.9996,
      falseEasting: 500000,
      falseNorthing: 0,
      projection: 'Geographic',
    };
    if (!raw.trim()) return out;

    const projMatch = /PROJECTION\s*\[\s*"([^"]+)"/i.exec(raw);
    const isTM = /Transverse_Mercator/i.test(raw) || (projMatch && /Transverse/i.test(projMatch[1]));
    if (!isTM) return out; // 经纬度网格（GEOGCS）直接返回

    out.geographic = false;
    out.projection = 'Transverse_Mercator';

    const num = (name) => {
      const m = new RegExp(
        'PARAMETER\\s*\\[\\s*"' + name + '"\\s*,\\s*(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)\\s*\\]',
        'i'
      ).exec(raw);
      return m ? parseFloat(m[1]) : null;
    };
    const cm = num('central_meridian');
    const lo = num('latitude_of_origin');
    const sf = num('scale_factor');
    const fe = num('false_easting');
    const fn = num('false_northing');
    if (cm != null) out.centralMeridian = cm;
    if (lo != null) out.latitudeOfOrigin = lo;
    if (sf != null) out.scaleFactor = sf;
    if (fe != null) out.falseEasting = fe;
    if (fn != null) out.falseNorthing = fn;

    // 典型：WGS_1984_UTM_Zone_48N / WGS_1984_UTM_Zone_48S
    const zoneMatch = /UTM[_\s-]*Zone[_\s-]*(\d{1,2})\s*([NS])?/i.exec(raw);
    if (zoneMatch) {
      out.zone = parseInt(zoneMatch[1], 10);
      out.hemisphere = (zoneMatch[2] || 'N').toUpperCase();
      out.centralMeridian = out.zone * 6 - 183;
    } else if (out.centralMeridian != null) {
      out.zone = Math.round((out.centralMeridian + 183) / 6);
      // 南半球通常 false_northing=10000000
      out.hemisphere = out.falseNorthing >= 5000000 ? 'S' : 'N';
    }
    if (!isFinite(out.centralMeridian)) out.centralMeridian = 105;
    return out;
  }

  /** 无 .prj 时的兜底：按网格数值猜测经纬度网格，否则按样例默认 UTM 48N。 */
  function guessPrj(grid) {
    const x = grid.xll;
    const y = grid.yll;
    if (Math.abs(x) <= 360 && Math.abs(y) <= 90 && grid.cellsize < 10) {
      return parsePrj('GEOGCS["GCS_WGS_1984"]');
    }
    return parsePrj(
      'PROJCS["WGS_1984_UTM_Zone_48N",GEOGCS["GCS_WGS_1984"],PROJECTION["Transverse_Mercator"],' +
        'PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",105],' +
        'PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0]]'
    );
  }

  /* ---------------------------- UTM → WGS84 反算 ---------------------------- */
  // Snyder, Map Projections — A Working Manual (USGS Professional Paper 1395), 标准公式。
  const WGS84_A = 6378137;
  const WGS84_F = 1 / 298.257223563;

  function utmToLonLat(x, y, utm) {
    if (!utm || utm.geographic) return [x, y];
    const a = WGS84_A;
    const f = WGS84_F;
    const e2 = f * (2 - f);
    const ep2 = e2 / (1 - e2);
    const k0 = utm.scaleFactor || 0.9996;
    const FE = utm.falseEasting != null ? utm.falseEasting : 500000;
    const FN =
      utm.falseNorthing != null
        ? utm.falseNorthing
        : utm.hemisphere === 'S'
          ? 10000000
          : 0;
    const zone =
      utm.zone != null
        ? utm.zone
        : Math.round(((utm.centralMeridian != null ? utm.centralMeridian : 105) + 183) / 6);

    const xr = x - FE; // easting offset
    const yr = y - FN; // northing offset
    const M = yr / k0;
    const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const J1 = (3 * e1) / 2 - (27 * e1 * e1 * e1) / 32;
    const J2 = (21 * e1 * e1) / 16 - (55 * e1 * e1 * e1 * e1) / 32;
    const J3 = (151 * e1 * e1 * e1) / 96;
    const J4 = (1097 * e1 * e1 * e1 * e1) / 512;
    const fp =
      mu +
      J1 * Math.sin(2 * mu) +
      J2 * Math.sin(4 * mu) +
      J3 * Math.sin(6 * mu) +
      J4 * Math.sin(8 * mu);

    const sinfp = Math.sin(fp);
    const cosfp = Math.cos(fp);
    const tanfp = Math.tan(fp);
    const C1 = ep2 * cosfp * cosfp;
    const T1 = tanfp * tanfp;
    const denom = 1 - e2 * sinfp * sinfp;
    const N1 = a / Math.sqrt(denom);
    const R1 = (a * (1 - e2)) / Math.pow(denom, 1.5);
    const D = xr / (N1 * k0);

    const lat =
      fp -
      ((N1 * tanfp) / R1) *
        (D * D / 2 -
          ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4)) / 24 +
          ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(D, 6)) /
            720);
    const lon =
      (D -
        ((1 + 2 * T1 + C1) * Math.pow(D, 3)) / 6 +
        ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(D, 5)) / 120) /
      cosfp;

    return [zone * 6 - 183 + (lon * 180) / Math.PI, (lat * 180) / Math.PI];
  }

  /* ------------------------------ 输入读取 ------------------------------ */

  function looksLikeAsc(text) {
    return /^\s*(ncols|nrows|xllcorner|xllcenter)\s/i.test(text);
  }
  function looksLikePrj(text) {
    return /(PROJCS|GEOGCS)\s*\[/i.test(text);
  }

  async function fetchText(url) {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('读取失败：HTTP ' + resp.status + ' — ' + url);
    return await resp.text();
  }

  /** 把 {text|file|blob|url} 或 File/Blob/文本/URL 统一读成文本。 */
  async function resolveText(input, kind) {
    if (input == null) return null;
    if (typeof input === 'string') {
      const t = input.trim();
      if (looksLikeAsc(t) || looksLikePrj(t) || t.indexOf('\n') >= 0) return input;
      return await fetchText(input);
    }
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      if (typeof input.text === 'function') return await input.text();
      return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error(kind + ' 读取失败'));
        fr.readAsText(input);
      });
    }
    if (input.file || input.blob) return await resolveText(input.file || input.blob, kind);
    if (input.url) return await fetchText(input.url);
    if (input.text != null) return String(input.text);
    throw new Error('无法识别的 ' + kind + ' 输入');
  }

  function readInputMeta(input) {
    const out = { url: null, name: null };
    if (input == null) return out;
    if (typeof input === 'string') {
      if (looksLikeAsc(input) || looksLikePrj(input)) return out;
      out.url = input;
      out.name = decodeURIComponent(String(input).split(/[\\/]/).pop() || '');
    } else if (typeof Blob !== 'undefined' && input instanceof Blob) {
      out.name = input.name || '';
    } else if (input.file || input.blob) {
      const f = input.file || input.blob;
      out.name = f.name || '';
    } else if (input.url) {
      out.url = input.url;
      out.name = decodeURIComponent(String(input.url).split(/[\\/]/).pop() || '');
    }
    return out;
  }

  /* ------------------------------ 场景构建 ------------------------------ */

  function computeStats(grid, angGrid) {
    const d = grid.data;
    const nodata = grid.nodata;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;
    let nodataCount = 0;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!isFinite(v) || v === nodata || v === -9999) {
        nodataCount++;
        continue;
      }
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      count++;
    }
    const angStats = { min: null, max: null, count: 0 };
    if (angGrid && angGrid.data) {
      let amin = Infinity;
      let amax = -Infinity;
      let ac = 0;
      const ad = angGrid.data;
      const anodata = angGrid.nodata;
      for (let i = 0; i < ad.length; i++) {
        const v = ad[i];
        if (!isFinite(v) || v === anodata || v === -9999) continue;
        if (v < amin) amin = v;
        if (v > amax) amax = v;
        ac++;
      }
      if (ac) {
        angStats.min = amin;
        angStats.max = amax;
        angStats.count = ac;
      }
    }
    return {
      min: count ? min : null,
      max: count ? max : null,
      mean: count ? sum / count : null,
      count,
      nodataCount,
      ang: angStats,
    };
  }

  function computeBounds(grid, utm) {
    const cs = grid.cellsize;
    const x0 = grid.xll;
    const y0 = grid.yll;
    const x1 = x0 + grid.ncols * cs;
    const y1 = y0 + grid.nrows * cs;
    const corners = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].map(([x, y]) => utmToLonLat(x, y, utm));
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [lon, lat] of corners) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
    // 网格面积很小时也保证非零范围，方便相机 fit
    if (!(east > west)) east = west + 0.001;
    if (!(north > south)) north = south + 0.001;
    return { west, south, east, north };
  }

  function chooseStep(ncols, nrows) {
    let step = 3;
    const eff = window.LEPerf && typeof window.LEPerf.getEffective === 'function'
      ? window.LEPerf.getEffective()
      : 'medium';
    if (eff === 'high') step = 2;
    else if (eff === 'low') step = 4;
    while (
      Math.ceil(ncols / step) * Math.ceil(nrows / step) > MAX_ARROWS &&
      step < 64
    ) {
      step += 1;
    }
    return step;
  }

  /** 场景描述 + 解析后的数据；文本懒加载，showScene 时才读取。 */
  async function buildSceneData(entry) {
    if (entry.grid && entry.utm) return entry;

    const velText = entry.velText != null ? entry.velText : await resolveText(entry.velSource, '风速 ASC');
    entry.velText = velText;
    let angText = null;
    try {
      angText = entry.angText != null ? entry.angText : entry.angSource ? await resolveText(entry.angSource, '风向 ASC') : null;
      entry.angText = angText;
    } catch (err) {
      entry.warnings.push('未读取到风向文件（_ang.asc），箭头方向按 0° 处理：' + err.message);
    }
    let prjText = null;
    try {
      prjText = entry.prjText != null ? entry.prjText : entry.prjSource ? await resolveText(entry.prjSource, 'PRJ') : null;
      entry.prjText = prjText;
    } catch (err) {
      entry.warnings.push('未读取到 .prj，按 UTM 48N（中央经线 105°）或经纬度网格猜测：' + err.message);
    }

    const grid = parseAsciiGrid(velText);
    let angGrid = null;
    if (angText) {
      try {
        angGrid = parseAsciiGrid(angText);
        if (angGrid.ncols !== grid.ncols || angGrid.nrows !== grid.nrows) {
          entry.warnings.push(
            '风向网格 ' + angGrid.ncols + '×' + angGrid.nrows + ' 与风速网格不一致，已忽略风向文件'
          );
          angGrid = null;
        }
      } catch (err) {
        entry.warnings.push('风向 ASC 解析失败，箭头方向按 0° 处理：' + err.message);
        angGrid = null;
      }
    }
    const utm = prjText ? parsePrj(prjText) : guessPrj(grid);
    if (!prjText) {
      entry.warnings.push(
        utm.geographic
          ? '缺少 .prj：按经纬度网格解析'
          : '缺少 .prj：按 UTM 48N（中央经线 105°）解析，实际区域需核对'
      );
    }
    const stats = computeStats(grid, angGrid);
    const bounds = computeBounds(grid, utm);
    entry.grid = grid;
    entry.angGrid = angGrid;
    entry.utm = utm;
    entry.stats = stats;
    entry.bounds = bounds;
    entry.step = chooseStep(grid.ncols, grid.nrows);
    return entry;
  }

  function sceneLabelOf(entry) {
    if (entry.label) return entry.label;
    return entry.name || 'WindNinja 结果';
  }

  function makeEntry(opts) {
    return {
      label: opts.label || '',
      name: opts.name || '',
      group: opts.group || '',
      timestamp: opts.timestamp || '',
      height: opts.height || '',
      resolution: opts.resolution || '',
      velSource: opts.velSource,
      angSource: opts.angSource || null,
      prjSource: opts.prjSource || null,
      velText: opts.velText != null ? opts.velText : null,
      angText: opts.angText != null ? opts.angText : null,
      prjText: opts.prjText != null ? opts.prjText : null,
      grid: null,
      angGrid: null,
      utm: null,
      stats: null,
      bounds: null,
      step: 3,
      arrowCount: 0,
      warnings: [],
    };
  }

  /* ------------------------------ 箭头几何 ------------------------------ */

  function destination(lon, lat, bearingDeg, distM) {
    const R = 6378137;
    const br = (bearingDeg * Math.PI) / 180;
    const lat1 = (lat * Math.PI) / 180;
    const lon1 = (lon * Math.PI) / 180;
    const d = distM / R;
    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinD = Math.sin(d);
    const cosD = Math.cos(d);
    const lat2 = Math.asin(sinLat1 * cosD + cosLat1 * sinD * Math.cos(br));
    const lon2 = lon1 + Math.atan2(Math.sin(br) * sinD * cosLat1, cosD - sinLat1 * Math.sin(lat2));
    return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
  }

  function binIndex(speed) {
    for (let i = 0; i < WIND_BINS.length; i++) {
      if (speed <= WIND_BINS[i].max) return i;
    }
    return WIND_BINS.length - 1;
  }

  function heightAt(le, lon, lat) {
    try {
      if (le && typeof le.heightAt === 'function') return le.heightAt(lon, lat) || 0;
    } catch (err) {
      /* ignore */
    }
    return 0;
  }

  /** 按当前档位抽稀网格，生成箭头采样（供渲染与导出共用，保证两者一致）。 */
  function sampleArrows(entry) {
    const grid = entry.grid;
    const angGrid = entry.angGrid;
    const utm = entry.utm;
    const stats = entry.stats;
    const step = entry.step || 3;
    const cs = grid.cellsize;
    const le = state.le;
    const half = step / 2;
    const arrows = [];
    const points = [];
    const startRow = Math.floor(half);
    const startCol = Math.floor(half);

    for (let row = startRow; row < grid.nrows; row += step) {
      for (let col = startCol; col < grid.ncols; col += step) {
        const idx = row * grid.ncols + col;
        const speed = grid.data[idx];
        if (!isFinite(speed) || speed === grid.nodata || speed === -9999) continue;
        let angle = 0;
        if (angGrid && isFinite(angGrid.data[idx]) && angGrid.data[idx] !== angGrid.nodata) {
          angle = angGrid.data[idx];
        }
        const x = grid.xll + (col + 0.5) * cs;
        const y = grid.yll + (grid.nrows - row - 0.5) * cs;
        const lonLat = utmToLonLat(x, y, utm);
        if (!isFinite(lonLat[0]) || !isFinite(lonLat[1])) continue;
        const lon = lonLat[0];
        const lat = lonLat[1];
        // WindNinja _ang 为风“来向”（气象角度，0=北、90=东）；箭头指向风的去向。
        const bearing = (angle + 180) % 360;
        const length = cs * 0.85;
        const tail = destination(lon, lat, (bearing + 180) % 360, length / 2);
        const head = destination(lon, lat, bearing, length / 2);
        const barb1 = destination(head[0], head[1], (bearing + 180 - 28 + 360) % 360, length * 0.36);
        const barb2 = destination(head[0], head[1], (bearing + 180 + 28) % 360, length * 0.36);
        const hTail = heightAt(le, tail[0], tail[1]);
        const hHead = heightAt(le, head[0], head[1]);
        arrows.push({
          row,
          col,
          lon,
          lat,
          speed,
          angle,
          bearing,
          color: WIND_BINS[binIndex(speed)].color,
          tail,
          head,
          barb1,
          barb2,
          hTail,
          hHead,
        });
        points.push({ lon, lat, speed, angle, bearing, row, col });
      }
    }
    entry.arrowCount = arrows.length;
    entry.points = points;
    entry.arrows = arrows;
    return arrows;
  }

  /* ------------------------------ 渲染与图例 ------------------------------ */

  function disposeRender() {
    const le = state.le;
    if (state.polylines) {
      try {
        if (le && le.viewer) le.viewer.scene.primitives.remove(state.polylines);
      } catch (err) {
        /* ignore */
      }
      state.polylines = null;
    }
    if (state.layer) {
      try {
        le.removeLayer(state.layer.id);
      } catch (err) {
        /* ignore */
      }
      state.layer = null;
    }
    if (state.legendEl && state.legendEl.parentNode) {
      state.legendEl.parentNode.removeChild(state.legendEl);
    }
    state.legendEl = null;
    state.arrowCount = 0;
  }

  function buildLegend(entry) {
    const viewerEl = byId('viewer');
    if (!viewerEl) return;
    if (state.legendEl && state.legendEl.parentNode) {
      state.legendEl.parentNode.removeChild(state.legendEl);
    }
    const el = document.createElement('div');
    el.className = 'wn-legend';
    const rows = WIND_BINS.map(
      (b) =>
        '<li><span class="wn-legend-arrow" style="background-color:' +
        b.color +
        '"></span><span class="wn-legend-range">' +
        b.label +
        '</span></li>'
    ).join('');
    const stats = entry.stats;
    const subtitle =
      entry.grid.ncols + '×' + entry.grid.nrows + ' · ' + fmt(entry.grid.cellsize, 0) + ' m';
    el.innerHTML =
      '<div class="wn-legend-head"><span class="wn-legend-title">风速 (m/s)</span>' +
      '<span class="wn-legend-sub">' +
      subtitle +
      '</span></div>' +
      '<ul>' +
      rows +
      '</ul>' +
      '<div class="wn-legend-foot">' +
      sceneLabelOf(entry) +
      ' · 风速 ' +
      fmt(stats.min, 1) +
      '–' +
      fmt(stats.max, 1) +
      ' m/s · 箭头 ' +
      entry.arrowCount +
      '（每 ' +
      entry.step +
      ' 格）</div>';
    viewerEl.appendChild(el);
    state.legendEl = el;
  }

  function renderCurrent() {
    const entry = state.scenes[state.current];
    if (!entry || !state.le) return;
    disposeRender();
    const arrows = sampleArrows(entry);
    const viewer = state.le.viewer;
    const polylineCollection = new C.PolylineCollection();
    const materials = WIND_BINS.map((b) =>
      C.Material.fromType('Color', { color: C.Color.fromCssColorString(b.color).withAlpha(0.95) })
    );
    for (let i = 0; i < arrows.length; i++) {
      const a = arrows[i];
      const positions = [
        C.Cartesian3.fromDegrees(a.tail[0], a.tail[1], a.hTail + ARROW_LIFT),
        C.Cartesian3.fromDegrees(a.head[0], a.head[1], a.hHead + ARROW_LIFT),
        C.Cartesian3.fromDegrees(a.barb1[0], a.barb1[1], a.hHead + ARROW_LIFT),
        C.Cartesian3.fromDegrees(a.head[0], a.head[1], a.hHead + ARROW_LIFT),
        C.Cartesian3.fromDegrees(a.barb2[0], a.barb2[1], a.hHead + ARROW_LIFT),
      ];
      polylineCollection.add({
        positions,
        width: ARROW_WIDTH,
        material: materials[binIndex(a.speed)],
      });
    }
    viewer.scene.primitives.add(polylineCollection);
    state.polylines = polylineCollection;
    state.arrowCount = arrows.length;

    const b = entry.bounds;
    const label = sceneLabelOf(entry);
    state.layer = state.le.registerLayer({
      id: 'windninja-layer',
      name: 'Wind3D · ' + label,
      type: 'wind3d',
      visible: true,
      remove: () => {
        try {
          viewer.scene.primitives.remove(polylineCollection);
        } catch (err) {
          /* ignore */
        }
        if (state.polylines === polylineCollection) state.polylines = null;
        if (state.legendEl && state.legendEl.parentNode) state.legendEl.parentNode.removeChild(state.legendEl);
        state.legendEl = null;
      },
      onVisible: (visible) => {
        polylineCollection.show = visible;
        if (state.legendEl) state.legendEl.classList.toggle('hidden', !visible);
      },
      zoomTo: () => state.le.flyTo({ rectangle: C.Rectangle.fromDegrees(b.west, b.south, b.east, b.north) }),
    });

    buildLegend(entry);

    const stats = entry.stats;
    state.le.status(
      'Wind3D 已加载 · ' +
        label +
        ' · 网格 ' +
        entry.grid.ncols +
        '×' +
        entry.grid.nrows +
        ' · 分辨率 ' +
        fmt(entry.grid.cellsize, 0) +
        ' m · 风速 ' +
        fmt(stats.min, 1) +
        '–' +
        fmt(stats.max, 1) +
        ' m/s · 箭头 ' +
        arrows.length
    );
  }

  /* ------------------------------ 场景管理 ------------------------------ */

  function sceneSummary(entry) {
    return {
      index: state.scenes.indexOf(entry),
      label: sceneLabelOf(entry),
      group: entry.group,
      timestamp: entry.timestamp,
      height: entry.height,
      resolution: entry.resolution,
      warnings: entry.warnings.slice(),
      source: entry.velSource && typeof entry.velSource === 'string' ? 'url' : 'file',
    };
  }

  function fillSceneSelect() {
    const sel = byId('wn-scene-select');
    const row = byId('wn-scene-row');
    if (!sel || !row) return;
    const multi = state.scenes.length > 1;
    row.classList.toggle('hidden', !state.scenes.length);
    sel.innerHTML = state.scenes
      .map((entry, i) => {
        const label = sceneLabelOf(entry) || '场景 ' + (i + 1);
        return '<option value="' + i + '">' + escapeHtml(label) + '</option>';
      })
      .join('');
    sel.value = String(Math.max(0, state.current));
    sel.disabled = !multi;
    const playBtn = byId('wn-play');
    if (playBtn) playBtn.disabled = !multi;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  async function showScene(i, opts) {
    if (!state.scenes.length) return false;
    const idx = Math.max(0, Math.min(state.scenes.length - 1, Number(i) || 0));
    const entry = state.scenes[idx];
    const le = state.le;
    if (!le) throw new Error('应用尚未就绪');
    if (le.setLoading) le.setLoading(true, '正在解析 WindNinja 结果…');
    try {
      await buildSceneData(entry);
      state.current = idx;
      renderCurrent();
      fillSceneSelect();
      if (opts && opts.fly === false) {
        /* 不自动定位（恢复工程时用保存的相机） */
      } else {
        const b = entry.bounds;
        le.flyTo({ rectangle: C.Rectangle.fromDegrees(b.west, b.south, b.east, b.north) });
      }
      const warnings = entry.warnings;
      if (warnings.length && le.toast) {
        le.toast('Wind3D 提示：' + warnings[0] + (warnings.length > 1 ? '（共 ' + warnings.length + ' 条）' : ''), 'error', 6000);
      }
      return true;
    } finally {
      if (le.setLoading) le.setLoading(false);
    }
  }

  function stopPlay() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = 0;
    }
    state.playing = false;
    const btn = byId('wn-play');
    if (btn) btn.textContent = '▶';
  }

  function play(on) {
    if (state.scenes.length < 2) return false;
    stopPlay();
    if (on === false) return false;
    state.playing = true;
    const btn = byId('wn-play');
    if (btn) btn.textContent = '⏸';
    state.timer = setInterval(() => {
      if (!state.scenes.length) {
        stopPlay();
        return;
      }
      const next = (state.current + 1) % state.scenes.length;
      showScene(next).catch((err) => console.warn('[LEWindninja] 播放切换失败', err));
    }, PLAY_INTERVAL_MS);
    return true;
  }

  /* ------------------------------ 加载入口 ------------------------------ */

  async function load(opts) {
    const o = opts || {};
    const meta = readInputMeta(o.vel);
    const entry = makeEntry({
      label: o.label || (meta.name ? meta.name.replace(/_vel\.asc$/i, '') : 'WindNinja 结果'),
      name: meta.name || '',
      velSource: o.vel,
      angSource: o.ang || null,
      prjSource: o.prj || null,
      velText: typeof o.vel === 'string' && looksLikeAsc(o.vel) ? o.vel : null,
      angText: typeof o.ang === 'string' && looksLikeAsc(o.ang) ? o.ang : null,
      prjText: typeof o.prj === 'string' && looksLikePrj(o.prj) ? o.prj : null,
    });
    state.scenes = [entry];
    state.current = -1;
    await showScene(0);
    return getStats();
  }

  async function loadUrl(velUrl) {
    if (!velUrl) throw new Error('缺少 vel.asc URL');
    const url = String(velUrl);
    const name = decodeURIComponent(url.split(/[\\/]/).pop() || '');
    const base = url.replace(/\.asc$/i, '');
    const isVel = /_vel\.asc$/i.test(url);
    const angUrl = isVel ? url.replace(/_vel\.asc$/i, '_ang.asc') : base + '_ang.asc';
    const prjUrl = url.replace(/\.asc$/i, '.prj');
    const meta = sceneMetaFromPath(url);
    const entry = makeEntry({
      label: meta.label || name.replace(/_vel\.asc$/i, ''),
      name,
      group: meta.group,
      timestamp: meta.timestamp,
      height: meta.height,
      resolution: meta.resolution,
      velSource: url,
      angSource: angUrl,
      prjSource: prjUrl,
    });
    state.scenes = [entry];
    state.current = -1;
    await showScene(0);
    return getStats();
  }

  function sceneMetaFromPath(path) {
    const parts = String(path || '')
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean);
    const file = parts.length ? parts[parts.length - 1] : '';
    const dirs = parts.slice(0, -1);
    const ts =
      dirs.find((p) => /^\d{8}T\d{6}Z?$/i.test(p)) ||
      dirs.find((p) => /^\d{4}-\d{2}-\d{2}/.test(p)) ||
      '';
    const height = dirs.find((p) => /^h\d+m$/i.test(p)) || '';
    const resolution = dirs.find((p) => /^r\d+m$/i.test(p)) || '';
    const bits = [];
    if (ts) bits.push(ts);
    if (height) bits.push(height);
    if (resolution) bits.push(resolution);
    const label = bits.length
      ? bits.join(' / ')
      : file.replace(/_vel\.asc$/i, '').replace(/\.asc$/i, '');
    return { group: dirs.join('/'), timestamp: ts, height, resolution, label };
  }

  function relPathOf(file) {
    return file.webkitRelativePath || file.relativePath || file.name || '';
  }

  async function loadFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) throw new Error('未选择任何文件');
    // 按目录分组；每个 *_vel.asc 视为一个场景，自动配对同目录的 _ang.asc / .prj
    const groups = new Map();
    for (const file of list) {
      const rel = relPathOf(file);
      const dir = rel.replace(/[\\/][^\\/]*$/, '');
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push({ file, rel, name: file.name || rel.split(/[\\/]/).pop() });
    }
    const scenes = [];
    for (const [dir, items] of groups) {
      const velItems = items.filter((it) => /_vel\.asc$/i.test(it.name));
      if (!velItems.length) continue;
      for (const velItem of velItems) {
        const base = velItem.name.replace(/_vel\.asc$/i, '');
        const angItem =
          items.find((it) => it.name.toLowerCase() === (base + '_ang.asc').toLowerCase()) ||
          items.find((it) => /_ang\.asc$/i.test(it.name) && it.name.replace(/_ang\.asc$/i, '') === base);
        const prjItem =
          items.find((it) => it.name.toLowerCase() === (base + '_vel.prj').toLowerCase()) ||
          items.find((it) => it.name.toLowerCase() === (base + '.prj').toLowerCase()) ||
          items.find((it) => /\.prj$/i.test(it.name) && (it.name === base + '.prj' || it.name.startsWith(base)));
        const meta = sceneMetaFromPath(velItem.rel);
        scenes.push(
          makeEntry({
            label: meta.label,
            name: velItem.name,
            group: dir,
            timestamp: meta.timestamp,
            height: meta.height,
            resolution: meta.resolution,
            velSource: velItem.file,
            angSource: angItem ? angItem.file : null,
            prjSource: prjItem ? prjItem.file : null,
          })
        );
      }
    }
    if (!scenes.length) {
      throw new Error('所选文件夹中未找到 WindNinja 结果文件（*_vel.asc）');
    }
    scenes.sort((a, b) => String(a.group).localeCompare(String(b.group)));
    state.scenes = scenes;
    state.current = -1;
    stopPlay();
    await showScene(0);
    if (state.le) {
      state.le.toast('Wind3D：已载入 ' + scenes.length + ' 个场景（' + sceneLabelOf(scenes[0]) + '）', 'ok', 4200);
    }
    return listScenes();
  }

  /* ------------------------------ 清理与查询 ------------------------------ */

  function clear() {
    stopPlay();
    disposeRender();
    state.scenes = [];
    state.current = -1;
    fillSceneSelect();
    if (state.le) {
      state.le.status('已清除 Wind3D 风场');
      if (state.le.toast) state.le.toast('已清除 Wind3D 风场', null, 2200);
    }
    return true;
  }

  function currentEntry() {
    return state.scenes[state.current] || null;
  }

  function getBounds() {
    const entry = currentEntry();
    return entry && entry.bounds ? Object.assign({}, entry.bounds) : null;
  }

  function getStats() {
    const entry = currentEntry();
    if (!entry || !entry.grid) return null;
    const e = entry;
    return {
      label: sceneLabelOf(e),
      source: typeof e.velSource === 'string' ? 'url' : 'file',
      file: e.name,
      grid: { ncols: e.grid.ncols, nrows: e.grid.nrows, cellsize: e.grid.cellsize },
      utm: {
        zone: e.utm.zone,
        hemisphere: e.utm.hemisphere,
        centralMeridian: e.utm.centralMeridian,
        geographic: e.utm.geographic,
      },
      speed: { min: e.stats.min, max: e.stats.max, mean: e.stats.mean, count: e.stats.count },
      angle: e.stats.ang,
      bounds: Object.assign({}, e.bounds),
      step: e.step,
      arrowCount: e.arrowCount,
      scenes: state.scenes.length,
      index: state.current,
      warnings: e.warnings.slice(),
    };
  }

  function listScenes() {
    return state.scenes.map((entry, i) => ({
      index: i,
      label: sceneLabelOf(entry),
      group: entry.group,
      timestamp: entry.timestamp,
      height: entry.height,
      resolution: entry.resolution,
      active: i === state.current,
      source: typeof entry.velSource === 'string' ? 'url' : 'file',
    }));
  }

  function getExportData() {
    const entry = currentEntry();
    if (!entry || !entry.arrows) return null;
    return {
      label: sceneLabelOf(entry),
      stats: getStats(),
      step: entry.step,
      points: entry.points.map((p) => Object.assign({}, p)),
      arrows: entry.arrows.map((a) => ({
        lon: a.lon,
        lat: a.lat,
        speed: a.speed,
        angle: a.angle,
        bearing: a.bearing,
        color: a.color,
        positions: [a.tail, a.head, a.barb1, a.head, a.barb2],
      })),
      bins: WIND_BINS.map((b) => ({ label: b.label, color: b.color, name: b.name })),
    };
  }

  function getProjectState() {
    const entry = currentEntry();
    if (!entry || !entry.bounds) return null;
    const out = {
      label: sceneLabelOf(entry),
      index: state.current,
      source: typeof entry.velSource === 'string' ? 'url' : 'file',
      gridStep: entry.step,
    };
    if (out.source === 'url') {
      out.velUrl = entry.velSource;
    } else {
      // 本地文件：把原始文本存进工程文件，保证离线可恢复
      out.velText = entry.velText;
      out.angText = entry.angText || '';
      out.prjText = entry.prjText || '';
    }
    return out;
  }

  /** 从工程状态恢复（当前场景）。 */
  async function restoreProjectState(wind) {
    if (!wind) return false;
    if (wind.source === 'url' && wind.velUrl) {
      await loadUrl(wind.velUrl);
      return true;
    }
    if (wind.velText) {
      await load({
        vel: wind.velText,
        ang: wind.angText || null,
        prj: wind.prjText || null,
        label: wind.label || 'WindNinja 结果',
      });
      // showScene 内部会 flyTo；工程恢复时由 project.js 覆盖相机，这里不再额外处理
      return true;
    }
    throw new Error('工程中的 Wind3D 数据缺少可恢复内容');
  }

  /* ------------------------------ UI 绑定 ------------------------------ */

  function bindUI() {
    const dirInput = byId('windninja-dir-input');
    const btnDir = byId('btn-windninja');
    if (btnDir && dirInput) {
      btnDir.addEventListener('click', () => dirInput.click());
      dirInput.addEventListener('change', () => {
        const files = dirInput.files;
        if (files && files.length) {
          loadFiles(files).catch((err) => {
            console.error(err);
            if (state.le && state.le.toast) state.le.toast('Wind3D 加载失败：' + err.message, 'error', 6000);
          });
        }
        dirInput.value = '';
      });
    }
    const clearBtn = byId('btn-wn-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => clear());
    const sel = byId('wn-scene-select');
    if (sel) {
      sel.addEventListener('change', () => {
        showScene(parseInt(sel.value, 10) || 0).catch((err) =>
          console.warn('[LEWindninja] 场景切换失败', err)
        );
      });
    }
    const prev = byId('wn-prev');
    if (prev) {
      prev.addEventListener('click', () => {
        if (state.scenes.length) {
          showScene((state.current - 1 + state.scenes.length) % state.scenes.length).catch(() => {});
        }
      });
    }
    const nextBtn = byId('wn-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (state.scenes.length) {
          showScene((state.current + 1) % state.scenes.length).catch(() => {});
        }
      });
    }
    const playBtn = byId('wn-play');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (state.playing) play(false);
        else play(true);
      });
    }
  }

  function handleUrlParam() {
    const params = new URLSearchParams(location.search);
    const vel = params.get('windninja');
    if (!vel || state.autoLoaded) return;
    state.autoLoaded = true;
    loadUrl(vel).catch((err) => {
      console.error('[LEWindninja] ?windninja 自动加载失败', err);
      if (state.le && state.le.toast) state.le.toast('Wind3D 自动加载失败：' + err.message, 'error', 6500);
      if (state.le && state.le.status) state.le.status('Wind3D 加载失败：' + err.message, 'error');
    });
  }

  function init(le) {
    if (state.ready) return;
    state.le = le || window.LE;
    if (!state.le || !state.le.viewer) return;
    state.ready = true;
    bindUI();
    fillSceneSelect();
    handleUrlParam();
  }

  window.LEWindninja = {
    init,
    load,
    loadUrl,
    loadFiles,
    listScenes,
    showScene,
    next: () => (state.scenes.length ? showScene((state.current + 1) % state.scenes.length) : false),
    prev: () =>
      state.scenes.length
        ? showScene((state.current - 1 + state.scenes.length) % state.scenes.length)
        : false,
    play,
    isPlaying: () => state.playing,
    clear,
    getBounds,
    getStats,
    getScenes: () => state.scenes.map(sceneSummary),
    getExportData,
    getProjectState,
    restoreProjectState,
    getLegend: () => WIND_BINS.map((b) => ({ label: b.label, color: b.color, name: b.name })),
    // 调试辅助（不参与对外契约）
    _parseAsciiGrid: parseAsciiGrid,
    _parsePrj: parsePrj,
    _utmToLonLat: utmToLonLat,
    _state: state,
  };

  if (window.LE) {
    init(window.LE);
  } else {
    document.addEventListener('local-earth-ready', () => init(window.LE), { once: true });
  }
})();

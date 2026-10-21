p=r'G:\sh\local-earth\js\mbtiles.js'
c=open(p,encoding='utf-8').read()
helpers=r'''
  function isVectorFormat(fmt) {
    return /^(pbf|mvt)$/i.test(String(fmt || ''));
  }

  function blankCanvas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }

  function styleForLayer(name) {
    const n = String(name || '').toLowerCase();
    if (/(water|ocean|sea|lake|river|canal|reservoir)/.test(n)) {
      return { fill: 'rgba(55,125,175,0.88)', stroke: 'rgba(110,185,230,0.9)', width: 1.0, point: '#66c2ff', order: 1 };
    }
    if (/(landuse|landcover|forest|wood|grass|park|vegetation|farm|meadow)/.test(n)) {
      return { fill: 'rgba(75,130,75,0.45)', stroke: 'rgba(90,150,90,0.55)', width: 0.8, point: '#7bd07b', order: 2 };
    }
    if (/(building|house)/.test(n)) {
      return { fill: 'rgba(150,150,150,0.55)', stroke: 'rgba(190,190,190,0.55)', width: 0.6, point: '#cccccc', order: 3 };
    }
    if (/(road|street|highway|transport|rail|bridge|tunnel)/.test(n)) {
      return { fill: null, stroke: 'rgba(225,170,80,0.95)', width: 1.8, point: '#ffcc66', order: 4 };
    }
    if (/(boundary|admin|border)/.test(n)) {
      return { fill: null, stroke: 'rgba(200,110,210,0.95)', width: 1.2, point: '#e08be8', order: 5 };
    }
    if (/(place|poi|label|city|town|village)/.test(n)) {
      return { fill: null, stroke: null, width: 0, point: '#ffffff', order: 6 };
    }
    const palette = ['rgba(110,160,200,0.5)', 'rgba(140,180,120,0.5)', 'rgba(190,160,110,0.5)', 'rgba(160,130,190,0.5)'];
    let h = 0;
    for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 997;
    return { fill: palette[h % palette.length], stroke: 'rgba(220,230,240,0.5)', width: 0.8, point: '#dddddd', order: 3 };
  }

  function renderMvtTile(buffer, size) {
    const canvas = blankCanvas(size);
    let tile;
    try { tile = window.MVT.parse(buffer); } catch (e) { return canvas; }
    const ctx = canvas.getContext('2d');
    const layers = (tile.layers || []).slice().sort((a, b) => styleForLayer(a.name).order - styleForLayer(b.name).order);
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const style = styleForLayer(layer.name);
      const extent = layer.extent || 4096;
      const scale = size / extent;
      for (let fi = 0; fi < layer.features.length; fi++) {
        const f = layer.features[fi];
        if (f.type === 'polygon') {
          ctx.beginPath();
          for (let p = 0; p < f.geometry.length; p++) {
            const ring = f.geometry[p];
            if (!ring.length) continue;
            ctx.moveTo(ring[0][0] * scale, ring[0][1] * scale);
            for (let q = 1; q < ring.length; q++) ctx.lineTo(ring[q][0] * scale, ring[q][1] * scale);
            ctx.closePath();
          }
          if (style.fill) {
            ctx.globalAlpha = 1;
            ctx.fillStyle = style.fill;
            try { ctx.fill('evenodd'); } catch (e) { ctx.fill(); }
          }
          if (style.stroke) {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = style.stroke;
            ctx.lineWidth = Math.max(0.5, style.width * (size / 256));
            ctx.stroke();
          }
        } else if (f.type === 'line') {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = style.stroke || 'rgba(230,230,230,0.8)';
          ctx.lineWidth = Math.max(0.6, style.width * (size / 256));
          ctx.beginPath();
          for (let p = 0; p < f.geometry.length; p++) {
            const line = f.geometry[p];
            if (!line.length) continue;
            ctx.moveTo(line[0][0] * scale, line[0][1] * scale);
            for (let q = 1; q < line.length; q++) ctx.lineTo(line[q][0] * scale, line[q][1] * scale);
          }
          ctx.stroke();
        } else if (f.type === 'point') {
          ctx.globalAlpha = 1;
          ctx.fillStyle = style.point || '#ffffff';
          for (let p = 0; p < f.geometry.length; p++) {
            const pt = f.geometry[p][0];
            if (!pt) continue;
            ctx.beginPath();
            ctx.arc(pt[0] * scale, pt[1] * scale, Math.max(1.2, 2.2 * (size / 256)), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    return canvas;
  }

  function createVectorProvider(base, token, meta, tilingScheme, rectangle, minLevel, maxLevel) {
    const urlBase = String(base).replace(/\/+$/, '');
    return {
      ready: true,
      readyPromise: Promise.resolve(true),
      tilingScheme: tilingScheme,
      rectangle: rectangle || undefined,
      tileWidth: 256,
      tileHeight: 256,
      minimumLevel: minLevel,
      maximumLevel: maxLevel,
      hasAlphaChannel: true,
      credit: meta.attribution || 'MBTiles',
      getTileCredits: function () { return []; },
      requestImage: function (x, y, level) {
        const url = urlBase + '/tiles/' + level + '/' + x + '/' + y + '.pbf?token=' + encodeURIComponent(token || '');
        return fetch(url, { cache: 'no-store' }).then(function (res) {
          if (res.status === 204 || res.status === 404) return blankCanvas(256);
          if (!res.ok) throw new Error('MBTiles tile HTTP ' + res.status);
          return res.arrayBuffer().then(function (buf) { return renderMvtTile(buf, 256); });
        }).catch(function () { return blankCanvas(256); });
      },
    };
  }

'''
anchor='''  async function loadFromUrl(base, token, opts) {'''
c=c.replace(anchor, helpers+anchor,1)
old='''    const meta = await resp.json();
    const ext = normalizeExt(meta.format);
    const rectangle = parseBounds(meta.bounds);
    const minLevel = parseInt(meta.minzoom, 10);
    const maxLevel = parseInt(meta.maxzoom, 10);
    const provider = new C.UrlTemplateImageryProvider({
      url: tileUrl(base, token, ext),
      tilingScheme: new C.WebMercatorTilingScheme(),
      minimumLevel: isFinite(minLevel) ? minLevel : 0,
      maximumLevel: isFinite(maxLevel) ? maxLevel : 22,
      rectangle: rectangle || undefined,
      credit: meta.attribution || 'MBTiles',
    });'''
new='''    const meta = await resp.json();
    const ext = normalizeExt(meta.format);
    const rectangle = parseBounds(meta.bounds);
    const minLevel = parseInt(meta.minzoom, 10);
    const maxLevel = parseInt(meta.maxzoom, 10);
    const minZ = isFinite(minLevel) ? minLevel : 0;
    const maxZ = isFinite(maxLevel) ? maxLevel : 22;
    const crs = String(meta.crs || 'EPSG:3857');
    const geographic = /4326|geographic/i.test(crs);
    const tilingScheme = geographic ? new C.GeographicTilingScheme() : new C.WebMercatorTilingScheme();
    let provider;
    if (isVectorFormat(meta.format)) {
      provider = createVectorProvider(base, token, meta, tilingScheme, rectangle, minZ, maxZ);
    } else {
      provider = new C.UrlTemplateImageryProvider({
        url: tileUrl(base, token, ext),
        tilingScheme: tilingScheme,
        minimumLevel: minZ,
        maximumLevel: maxZ,
        rectangle: rectangle || undefined,
        credit: meta.attribution || 'MBTiles',
      });
    }'''
assert old in c
c=c.replace(old,new,1)
old2='''      bounds: state.meta ? state.meta.bounds : null,
      minzoom: state.meta ? state.meta.minzoom : null,
      maxzoom: state.meta ? state.meta.maxzoom : null,
      attribution: state.meta ? state.meta.attribution : null,'''
new2='''      bounds: state.meta ? state.meta.bounds : null,
      crs: state.meta ? state.meta.crs : null,
      minzoom: state.meta ? state.meta.minzoom : null,
      maxzoom: state.meta ? state.meta.maxzoom : null,
      attribution: state.meta ? state.meta.attribution : null,
      token: state.token || '','''
assert old2 in c
c=c.replace(old2,new2,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('mbtiles vector/4326 patched')

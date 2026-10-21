p=r'G:\sh\local-earth\js\kml-native.js'
c=open(p,encoding='utf-8').read()
anchor='  async function parseDocumentModelSplit(text, plan, ctx, progress, state) {'
fast=r'''
  function fastXmlText(value) {
    return String(value == null ? '' : value)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .trim();
  }

  function fastTagText(source, tag) {
    const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i');
    const m = re.exec(source);
    return m ? fastXmlText(m[1]) : '';
  }

  function fastAltitudeMode(raw) {
    const text = String(raw || '').toLowerCase();
    if (text === 'absolute') return 'absolute';
    if (text === 'relativetoground') return 'relativeToGround';
    if (text === 'clamptoground' || text === '') return 'clampToGround';
    return 'relativeToGround';
  }

  /**
   * 扁平 Simple KML 快速解析：只处理“Document 下直接挂 Placemark、每块只有
   * LineString/Point + TimeSpan + styleUrl + 简单 ExtendedData”的常见导出格式。
   * 任何不支持的标签/内联 Style 都返回 null，由调用方回退完整 DOM 分片解析。
   */
  async function fastParseFlatKml(text, plan, ctx, state, progress) {
    if (/<(Polygon|MultiGeometry|Model|GroundOverlay|NetworkLink|ScreenOverlay|gx:Track|MultiTrack)\b/i.test(text)) return null;
    if (plan.header.indexOf('<Style') < 0) return null;
    const wrapper = plan.kmlOpen + plan.docOpen + plan.header + (plan.docOpen ? '</Document>' : '') + '</kml>';
    let header;
    try { header = parseXml(wrapper).root; } catch (err) { return null; }
    const styles = new Map();
    const styleMaps = new Map();
    const styleEls = header.getElementsByTagNameNS
      ? header.getElementsByTagNameNS('*', 'Style')
      : header.getElementsByTagName('Style');
    for (let i = 0; i < styleEls.length; i++) {
      const el = styleEls[i];
      const id = el.getAttribute('id');
      if (id) styles.set(id, parseStyleElement(el));
    }
    const mapEls = header.getElementsByTagNameNS
      ? header.getElementsByTagNameNS('*', 'StyleMap')
      : header.getElementsByTagName('StyleMap');
    for (let i = 0; i < mapEls.length; i++) {
      const el = mapEls[i];
      const id = el.getAttribute('id');
      if (!id) continue;
      const map = { normal: null, highlight: null };
      for (let j = 0; j < el.children.length; j++) {
        const pair = el.children[j];
        if (pair.localName !== 'Pair') continue;
        const key = childText(pair, 'key') || 'normal';
        const target = childText(pair, 'styleUrl');
        if (target) map[key === 'highlight' ? 'highlight' : 'normal'] = target;
      }
      styleMaps.set(id, map);
    }
    if (!styles.size) return null;

    const t0 = perfNow();
    let cursor = 0;
    let parsed = 0;
    const totalBytes = text.length;
    while (true) {
      const start = text.indexOf('<Placemark', cursor);
      if (start < 0) break;
      const openEnd = text.indexOf('>', start);
      const end = text.indexOf('</Placemark>', openEnd + 1);
      if (openEnd < 0 || end < 0) return null;
      const body = text.slice(openEnd + 1, end);
      if (body.indexOf('<Style') >= 0) return null;
      const name = fastTagText(body, 'name') || '(未命名地物)';
      const visible = fastTagText(body, 'visibility') !== '0';
      const styleUrl = fastTagText(body, 'styleUrl');
      const timeSpan = fastTagText(body, 'TimeSpan');
      let time = null;
      if (timeSpan) {
        let begin = parseIsoTime(fastTagText(timeSpan, 'begin'));
        let endT = parseIsoTime(fastTagText(timeSpan, 'end'));
        if (!isFinite(begin) && isFinite(endT)) begin = endT;
        if (!isFinite(endT) && isFinite(begin)) endT = begin;
        if (isFinite(begin)) time = { begin, end: endT < begin ? begin : endT, source: 'TimeSpan' };
      } else {
        const when = parseIsoTime(fastTagText(body, 'TimeStamp'));
        if (isFinite(when)) time = { begin: when, end: when, source: 'TimeStamp' };
      }
      const geometryMode = fastAltitudeMode(fastTagText(body, 'altitudeMode'));
      const geometries = [];
      const lineAt = body.indexOf('<LineString');
      const pointAt = body.indexOf('<Point');
      if (lineAt >= 0 && body.indexOf('<LineString', lineAt + 1) < 0) {
        const coords = parseCoordinates(fastTagText(body.slice(lineAt), 'coordinates'), ctx);
        if (coords.length >= 2) geometries.push({ type: 'line', coords, altitudeMode: geometryMode, extrude: false });
      } else if (pointAt >= 0 && body.indexOf('<Point', pointAt + 1) < 0) {
        const coords = parseCoordinates(fastTagText(body.slice(pointAt), 'coordinates'), ctx);
        if (coords.length) geometries.push({ type: 'point', coords, altitudeMode: geometryMode });
      } else {
        return null;
      }
      const style = resolveStyleUrl(styleUrl, styles, styleMaps, 0);
      state.placemarks.push({
        name,
        visible,
        description: '',
        time,
        style,
        extended: {},
        folderPath: [],
        geometries,
      });
      if (!geometries.length) ctx.count('skippedPlacemark');
      state.seen++;
      parsed++;
      if (parsed % 6000 === 0) {
        await yieldToMain();
        perfStats.yieldCount++;
        if (progress) progress.report('parse', 10 + Math.round((end / totalBytes) * 52), { placemarks: parsed, total: 0 });
      }
      cursor = end + 12;
    }
    if (!parsed) return null;
    perfStats.styleScanMs = 0;
    perfStats.walkMs = Math.round(perfNow() - t0);
    perfStats.walkPureMs = perfStats.walkMs;
    perfStats.walkYieldMs = 0;
    perfStats.fastFlat = true;
    return header;
  }

'''
assert anchor in c
c=c.replace(anchor,fast+anchor,1)
# modify split parser to use fast path
old='''    let headerRoot = null;
    let folderPartCount = 0;
    for (const part of plan.parts) {'''
new='''    let headerRoot = null;
    let folderPartCount = 0;
    let fastFlat = false;
    if (plan.flat) {
      const fast = await fastParseFlatKml(text, plan, ctx, state, progress);
      if (fast) {
        headerRoot = fast;
        fastFlat = true;
      }
    }
    if (!fastFlat) for (const part of plan.parts) {'''
assert old in c
c=c.replace(old,new,1)
# avoid duplicate headerRoot assignment inside loop? it uses if (!headerRoot), fine
# log fast flag
c=c.replace("      walkYieldMs: Math.round(state.yieldMs),\n    });","      walkYieldMs: Math.round(state.yieldMs),\n      fastFlat: fastFlat,\n    });",1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('fast flat parser added')

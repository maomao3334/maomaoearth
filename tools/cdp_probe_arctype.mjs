/* 探测 GeoJSON 实体的 polyline.arcType 与坐标有效性，定位 Cesium subdivideRhumbLine 崩溃来源。 */
const CDP = 'http://127.0.0.1:9333';
const URL_APP = 'http://127.0.0.1:8123/?cam=102.4,25.0,9000,-60';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(CDP + '/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id; pending.set(mid, { resolve });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL_APP });
  await sleep(8000);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await ev("document.querySelector('#btn-pub-rivers').click()");
  await sleep(9000);
  const result = await ev(`(() => {
    const C = window.LE.Cesium;
    const out = { sources: [], bad: [] };
    const now = C.JulianDate.now();
    for (const ds of window.LE.viewer.dataSources) {
      const ents = ds.entities && ds.entities.values ? ds.entities.values : [];
      let polylines = 0, types = {}, badPos = 0;
      for (const e of ents) {
        if (!e.polyline) continue;
        polylines++;
        let arc = 'n/a';
        try {
          arc = e.polyline.arcType && e.polyline.arcType.getValue ? String(e.polyline.arcType.getValue(now)) : String(e.polyline.arcType);
        } catch (err) { arc = 'err'; }
        types[arc] = (types[arc] || 0) + 1;
        try {
          const pos = e.polyline.positions && e.polyline.positions.getValue ? e.polyline.positions.getValue(now) : e.polyline.positions;
          if (!Array.isArray(pos) || pos.length < 2) { badPos++; }
          else {
            let bad = 0;
            for (const p of pos) {
              const c = C.Cartographic.fromCartesian(p);
              if (!c || !isFinite(c.longitude) || !isFinite(c.latitude) || Math.abs(c.latitude) > Math.PI/2) bad++;
            }
            if (bad) { badPos++; if (out.bad.length < 3) out.bad.push({ name: e.name && e.name.getValue ? e.name.getValue(now) : e.name, len: pos.length, bad }); }
          }
        } catch (err) { badPos++; }
      }
      out.sources.push({ name: ds.name, entities: ents.length, polylines, types, badPos });
    }
    return out;
  })()`);
  console.log(JSON.stringify({ result, errors }, null, 2));
  ws.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

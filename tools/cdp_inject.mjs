import fs from 'node:fs';
const CDP = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const t = await (await fetch(CDP + '/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id; pending.set(mid, { resolve });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__errs = [];
      window.__cons = [];
      window.addEventListener('error', function (e) {
        try { window.__errs.push(String(e.message) + '\\n' + (e.error && e.error.stack ? e.error.stack : '')); } catch (x) {}
      });
      window.addEventListener('unhandledrejection', function (e) {
        try { window.__errs.push('REJECT: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)); } catch (x) {}
      });
      (function () {
        var oe = console.error;
        console.error = function () {
          try {
            window.__cons.push(Array.prototype.map.call(arguments, function (a) {
              return a && (a.stack || a.message) ? (a.stack || a.message) : String(a);
            }).join(' | '));
          } catch (x) {}
          return oe.apply(console, arguments);
        };
      })();
    `,
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:8123/?demo=data%2Fsamples%2Fwind%2Fwind3d_test.kmz&cam=102.40,25.02,9000,-60&exag=2.3' });
  await sleep(18000);
  for (const sel of ['#btn-pub-rivers', '#btn-pub-lakes', '#btn-pub-places', '#btn-pub-admin0']) {
    await send('Runtime.evaluate', { expression: `document.querySelector('${sel}').click()`, returnByValue: true });
    await sleep(4500);
  }
  await sleep(6000);
  const r = await send('Runtime.evaluate', {
    expression: `(() => ({
      errs: window.__errs || [],
      cons: window.__cons || [],
      panel: !!document.querySelector('.cesium-widget-errorPanel'),
      panelText: (document.querySelector('.cesium-widget-errorPanel') || {}).innerText || '',
      layers: window.LE && LE.listLayers ? LE.listLayers().map(l=>l.name) : []
    }))()`,
    returnByValue: true,
  });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('G:/sh/local-earth/docs/testdata/cdp-inject-final.png', Buffer.from(shot.result.data, 'base64'));
  console.log(JSON.stringify(r.result && r.result.result ? r.result.result.value : r.result, null, 2));
  ws.close();
  await fetch(CDP + '/json/close/' + t.id);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });

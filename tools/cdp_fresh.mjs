import fs from 'node:fs';
const CDP = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openTarget() {
  const r = await fetch(CDP + '/json/new?about:blank', { method: 'PUT' });
  return await r.json();
}

async function main() {
  const url = process.argv[2] || 'http://127.0.0.1:8123/';
  const clicks = (process.argv[3] || '').split(',').filter(Boolean);
  const waitMs = Number(process.argv[4] || 18000);
  const shotPath = process.argv[5] || '';
  const target = await openTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push({ text: d.text, desc: d.exception && d.exception.description, stack: d.stackTrace });
    }
    if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || e.level === 'warning') logs.push({ level: e.level, text: e.text });
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id; pending.set(mid, { resolve });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(waitMs);
  for (const sel of clicks) {
    await send('Runtime.evaluate', { expression: `document.querySelector('${sel}') && document.querySelector('${sel}').click()`, returnByValue: true });
    await sleep(4500);
  }
  await sleep(3000);
  if (shotPath) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));
  }
  const state = await send('Runtime.evaluate', {
    expression: "(() => ({ url: location.href, layers: window.LE && LE.listLayers ? LE.listLayers().map(l=>l.name) : [], perf: window.LEPerf ? {mode:LEPerf.getMode(), effective:LEPerf.getEffective(), tier:LEPerf.getTier()} : null }))()",
    returnByValue: true,
  });
  console.log(JSON.stringify({ errors, logs, state: state.result && state.result.result ? state.result.result.value : null }, null, 2));
  ws.close();
  await fetch(CDP + '/json/close/' + target.id);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });

/* 通过 CDP 复现：加载风场+城市等图层，模拟鼠标拖拽/滚轮，收集异常堆栈。 */
const CDP = 'http://127.0.0.1:9333';
const URL_APP = 'http://127.0.0.1:8123/?demo=data%2Fsamples%2Fwind%2Fwind3d_test.kmz&cam=102.40,25.02,9000,-60&exag=2.3';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(CDP + '/json/list')).json();
  let page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push({
        text: d.text,
        exception: d.exception ? { description: d.exception.description, value: d.exception.value } : null,
        url: d.url,
        line: d.lineNumber,
        column: d.columnNumber,
        stack: d.stackTrace,
      });
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error' || e.level === 'warning') logs.push({ level: e.level, text: e.text, url: e.url });
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const t = msg.params.type;
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (t === 'error' || /error|fail|exception/i.test(text)) logs.push({ level: t, text });
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, { resolve });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_APP });
  await sleep(20000);
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  // 打开城市/国界/河流/湖泊
  for (const sel of ['#btn-pub-admin0', '#btn-pub-rivers', '#btn-pub-lakes', '#btn-pub-places']) {
    await evalJs(`document.querySelector('${sel}') && document.querySelector('${sel}').click()`);
    await sleep(4000);
  }
  // 模拟鼠标拖拽与滚轮（多次）
  const drag = async (x0, y0, x1, y1) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: x0 + ((x1 - x0) * i) / steps,
        y: y0 + ((y1 - y0) * i) / steps,
        button: 'left',
        buttons: 1,
      });
      await sleep(25);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
    await sleep(400);
  };
  for (let i = 0; i < 6; i++) {
    await drag(750, 450, 550, 380);
  }
  for (let i = 0; i < 3; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaX: 0, deltaY: -600 });
    await sleep(500);
  }
  await evalJs("(() => { const v = window.LE && LE.viewer; if (v) { v.camera.rotate(0.15); v.camera.rotate(-0.15); } return true; })()");
  await sleep(6000);
  const info = await evalJs(
    "(() => ({ layers: (window.LE && LE.listLayers ? LE.listLayers().map(l => l.name) : []), terrain: window.LETerrain && LETerrain.stats ? LETerrain.stats() : null, perf: window.LEPerf && LEPerf.getEffective ? LEPerf.getEffective() : null }))()"
  );
  console.log(JSON.stringify({ errors, logs, info }, null, 2));
  ws.close();
}

main().catch((e) => {
  console.error('REPRO FAILED', e);
  process.exit(1);
});

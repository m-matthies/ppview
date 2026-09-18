/**
 * Minimal Chrome DevTools Protocol driver.
 *
 * Deliberately not Puppeteer: `ws` is already present via react-scripts, and the
 * whole job is "open a page, hand it files, run some JS, read the canvas back".
 */
const WebSocket = require('ws');
const http = require('http');

const httpJson = (port, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path }, res => {
    let body = '';
    res.on('data', c => (body += c));
    res.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
  }).on('error', reject);
});

async function connect(port = 9222) {
  const targets = await httpJson(port, '/json');
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let nextId = 0;
  const pending = new Map();
  const logs = [];

  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      logs.push({ level: 'exception', text: msg.params.exceptionDetails.text });
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push({
        level: msg.params.type,
        text: (msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' '),
      });
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await new Promise(r => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');

  return {
    logs,
    send,
    close: () => ws.close(),

    async goto(url, settleMs = 3500) {
      logs.length = 0;
      await send('Page.navigate', { url });
      await new Promise(r => setTimeout(r, settleMs));
    },

    async dropFiles(paths, settleMs = 4500) {
      const doc = await send('DOM.getDocument');
      const node = await send('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: '.dropzone input[type=file]',
      });
      if (!node.nodeId) throw new Error('drop zone not found');
      await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: paths });
      await new Promise(r => setTimeout(r, settleMs));
    },

    async evaluate(expression) {
      const res = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
      }
      return res.result.value;
    },

    async screenshot(file) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      require('fs').writeFileSync(file, Buffer.from(shot.data, 'base64'));
    },
  };
}

module.exports = { connect };

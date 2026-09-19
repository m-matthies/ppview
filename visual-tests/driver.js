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

/**
 * Opens a fresh tab and returns its debugger URL. Scenarios are independent, so
 * running several tabs at once is the single biggest speed-up available — the
 * suite was almost entirely waiting, not computing.
 */
async function openPage(port = 9222) {
  const version = await httpJson(port, '/json/version');
  const browser = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise(r => browser.on('open', r));
  const targetId = await new Promise((resolve, reject) => {
    browser.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.id === 1) msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result.targetId);
    });
    browser.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank' } }));
  });
  browser.close();
  return `ws://127.0.0.1:${port}/devtools/page/${targetId}`;
}

async function connect(port = 9222, wsUrl = null) {
  let debuggerUrl = wsUrl;
  if (!debuggerUrl) {
    const targets = await httpJson(port, '/json');
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error('no page target');
    debuggerUrl = page.webSocketDebuggerUrl;
  }

  const ws = new WebSocket(debuggerUrl, { perMessageDeflate: false });
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

  // Without a timeout a scenario that wedges the page takes the whole suite
  // with it, and the run just stops producing output.
  const TIMEOUT_MS = Number(process.env.PPVIEW_CDP_TIMEOUT || 120000);
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
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

    // Poll for the page to be genuinely ready rather than sleeping a guess.
    async waitForSelector(selector, timeoutMs = 20000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const res = await send('Runtime.evaluate', {
          expression: `!!document.querySelector(${JSON.stringify(selector)})`,
          returnByValue: true,
        });
        if (res.result.value) return true;
        await new Promise(r => setTimeout(r, 50));
      }
      throw new Error(`timed out waiting for ${selector}`);
    },

    async goto(url, readySelector = '.dropzone') {
      logs.length = 0;
      await send('Page.navigate', { url });
      if (readySelector) await this.waitForSelector(readySelector);
    },

    async dropFiles(paths) {
      const doc = await send('DOM.getDocument');
      const node = await send('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: '.dropzone input[type=file]',
      });
      if (!node.nodeId) throw new Error('drop zone not found');
      await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: paths });
      // The controls bar only mounts once positions are in the store, so it is
      // a reliable "the scene is up" signal.
      await this.waitForSelector('.controls-panel');

      // But "up" is not "drawn". The canvas can be present and still showing
      // bare background, and settle() will happily call that stable — two
      // identical all-background frames look exactly like a finished render.
      // A scenario measuring there records zeros, which surfaced as a run where
      // every tint in `load.loaded` came back 0 and did not reproduce. Waiting
      // for actual geometry removes the race rather than sleeping past it.
      const drawn = await this.evaluate(`(async () => {
        const started = Date.now();
        while (Date.now() - started < 15000) {
          const canvas = document.querySelector('canvas');
          if (canvas && canvas.width) {
            const w = 160, h = Math.max(1, Math.round(canvas.height * (w / canvas.width)));
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(canvas, 0, 0, w, h);
            const d = ctx.getImageData(0, 0, w, h).data;
            for (let i = 0; i < d.length; i += 4) {
              const mx = Math.max(d[i], d[i + 1], d[i + 2]);
              const mn = Math.min(d[i], d[i + 1], d[i + 2]);
              if (mx - mn > 45) return true;
            }
          }
          await new Promise(r => setTimeout(r, 50));
        }
        return false;
      })()`);
      if (!drawn) throw new Error('scene never drew any geometry');
    },

    async clearStorage(origin) {
      await send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage' });
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

module.exports = { connect, openPage };

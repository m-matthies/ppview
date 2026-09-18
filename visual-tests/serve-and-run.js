#!/usr/bin/env node
/**
 * Starts the dev server and headless Chrome, runs the suite, tears both down.
 * Extra arguments are forwarded to run.js (e.g. `npm run test:visual -- --update`).
 */
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = process.env.PPVIEW_PORT || 3111;
const URL = `http://localhost:${PORT}/ppview`;
const DEBUG_PORT = 9222;

const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(p => fs.existsSync(p));

const waitFor = (check, timeoutMs, label) => new Promise((resolve, reject) => {
  const started = Date.now();
  const tick = () => {
    check()
      .then(resolve)
      .catch(() => {
        if (Date.now() - started > timeoutMs) reject(new Error(`timed out waiting for ${label}`));
        else setTimeout(tick, 1000);
      });
  };
  tick();
});

const get = (url) => new Promise((resolve, reject) => {
  http.get(url, res => { res.resume(); res.statusCode === 200 ? resolve() : reject(); })
    .on('error', reject);
});

(async () => {
  if (!CHROME) {
    console.error('No Chrome found. Set CHROME_PATH.');
    process.exit(2);
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ppview-visual-'));
  const children = [];
  const cleanup = () => {
    children.forEach(c => { try { c.kill('SIGTERM'); } catch (_) {} });
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  console.log('starting dev server…');
  children.push(spawn('npx', ['react-scripts', 'start'], {
    env: { ...process.env, BROWSER: 'none', PORT: String(PORT), CI: 'true' },
    stdio: 'ignore',
  }));
  await waitFor(() => get(URL), 180000, 'dev server');

  console.log('starting headless chrome…');
  children.push(spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    // Retina-class pixel ratio: several past bugs only showed above dpr 1.
    '--force-device-scale-factor=2',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--window-size=1440,900', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' }));
  await waitFor(() => get(`http://127.0.0.1:${DEBUG_PORT}/json/version`), 60000, 'chrome');

  const args = process.argv.slice(2);
  const res = spawnSync(process.execPath, [path.join(__dirname, 'run.js'), ...args], {
    stdio: 'inherit',
    env: { ...process.env, PPVIEW_URL: URL },
  });
  cleanup();
  process.exit(res.status ?? 1);
})();

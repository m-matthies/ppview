#!/usr/bin/env node
/**
 * A CPU profile of trajectory playback, aggregated by self time.
 *
 * Wall-clock per frame cannot answer Phase 5's question: under a software
 * rasteriser most of it is drawing, and the proposal is about JavaScript
 * allocation. This samples the main thread instead and reports which functions
 * actually own the time.
 */
const path = require('path');
const { connect, openPage } = require('../visual-tests/driver');
const { wrap } = require('../visual-tests/probe');

const APP_URL = process.env.PPVIEW_URL || 'http://localhost:3111/ppview';
const F = (...names) => names.map(n => path.join(__dirname, 'fixtures', n));

const STEP = `
  for (let i = 0; i < 8; i++) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle(4000);
  }
  return { stepped: 8 };
`;

/** Self time per function, from a CDP CPU profile. */
function summarise(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const self = new Map();
  const interval = (profile.endTime - profile.startTime) / Math.max(profile.samples.length, 1);

  for (const id of profile.samples) {
    const node = byId.get(id);
    if (!node) continue;
    const f = node.callFrame;
    const where = f.url ? f.url.replace(/^.*\/(static\/js\/)?/, '') : '(native)';
    const key = `${f.functionName || '(anonymous)'}  ${where}`;
    self.set(key, (self.get(key) || 0) + interval);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([name, us]) => ({
      pct: +(100 * us / total).toFixed(1),
      ms: Math.round(us / 1000),
      name,
    }));
}

(async () => {
  const cdp = await connect(9222, await openPage(9222));
  try {
    await cdp.goto(APP_URL);
    await cdp.dropFiles(F('large.top', 'large.dat', 'patches.dat'));
    await cdp.evaluate(wrap('for (let i=0;i<3;i++){document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));await sleep(200);} await settle(5000); return {};'));

    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    await cdp.evaluate(wrap(STEP));
    const { profile } = await cdp.send('Profiler.stop');

    const rows = summarise(profile);
    const wall = Math.round((profile.endTime - profile.startTime) / 1000);
    console.log(`\nCPU profile over ${wall}ms of playback (8 frames, 8000 particles)\n`);
    console.log('  pct     ms  function');
    for (const r of rows) console.log(`  ${String(r.pct).padStart(5)}%  ${String(r.ms).padStart(5)}  ${r.name}`);
  } finally {
    cdp.close();
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

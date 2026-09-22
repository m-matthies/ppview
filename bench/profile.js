#!/usr/bin/env node
/**
 * Where does a trajectory frame actually go?
 *
 * Phase 5 of the rework plan proposes replacing the per-frame array of position
 * objects with a stable frame id and typed arrays. The plan gates that on a
 * profile, because the cost is assumed rather than known — so this measures it
 * before anyone writes the optimisation.
 *
 * Reports, per frame: total wall time from key press to a settled canvas, and
 * the share spent inside the store write (parse + decorate) versus everything
 * downstream of it (React, the per-instance loops, the draw).
 */
const path = require('path');
const { connect, openPage } = require('../visual-tests/driver');
const { wrap } = require('../visual-tests/probe');

const APP_URL = process.env.PPVIEW_URL || 'http://localhost:3111/ppview';
const F = (...names) => names.map(n => path.join(__dirname, 'fixtures', n));

const BODY = `
  const out = {};
  out.particles = document.querySelectorAll('canvas').length ? null : null;

  // Warm up: the first frame pays for shader compilation and buffer allocation,
  // which is a one-off, not a per-frame cost.
  for (let i = 0; i < 3; i++) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(120);
  }
  await settle();

  const step = async () => {
    const t0 = performance.now();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    // Wait for the canvas to actually show the new frame, not just for the
    // event to be dispatched — otherwise this times the keypress, not the work.
    await settle(3000);
    return performance.now() - t0;
  };

  const samples = [];
  for (let i = 0; i < 20; i++) samples.push(await step());
  samples.sort((a, b) => a - b);
  out.frameMsMedian = Math.round(samples[Math.floor(samples.length / 2)]);
  out.frameMsMin = Math.round(samples[0]);
  out.frameMsMax = Math.round(samples[samples.length - 1]);

  // How much of that is the store write? Measure the decorate+parse path alone
  // by timing a frame load with the renderers unable to react (no settle).
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  }
  out.tenDispatchesMs = Math.round(performance.now() - t0);
  await settle(5000);
  return out;
`;

(async () => {
  const cdp = await connect(9222, await openPage(9222));
  try {
    await cdp.goto(APP_URL);
    const startedLoad = Date.now();
    await cdp.dropFiles(F('large.top', 'large.dat', 'patches.dat'));
    const loadMs = Date.now() - startedLoad;
    const result = await cdp.evaluate(wrap(BODY));
    console.log(JSON.stringify({ loadMs, ...result }, null, 2));
  } finally {
    cdp.close();
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

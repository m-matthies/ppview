#!/usr/bin/env node
/**
 * Redraw cost with real sphere geometry versus impostors.
 *
 * Orbiting never touches the load path — it is pure redraw — so this is the
 * measurement that decides whether a large structure can be moved at all.
 */
const path = require('path');
const { connect, openPage } = require('../visual-tests/driver');
const { wrap } = require('../visual-tests/probe');

const F = (...n) => n.map(x => path.join(__dirname, 'fixtures', x));

// Orbit by dragging, and time the redraws it forces.
const ORBIT = `
  const canvas = document.querySelector('canvas');
  await settle(30000);

  // Wheel, not pointer drag: OrbitControls handles it directly, and an earlier
  // attempt with synthesised pointer events measured nothing but the settle
  // timeout because the drag never reached the controls.
  const CAP = 15000;
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const before = quickHash();
    const t0 = performance.now();
    canvas.dispatchEvent(new WheelEvent('wheel', {
      deltaY: (i % 2 ? 1 : -1) * 120, bubbles: true, cancelable: true,
    }));
    await settle(CAP);
    const ms = performance.now() - t0;
    samples.push({ ms, changed: quickHash() !== before });
  }
  const moved = samples.filter(s => s.changed).map(s => s.ms).sort((a, b) => a - b);
  return {
    redraws: moved.length,
    redrawMsMedian: moved.length ? Math.round(moved[Math.floor(moved.length / 2)]) : null,
    hitCap: samples.some(s => s.ms >= CAP - 100),
  };
`;



(async () => {
  const out = {};
  for (const [label, url] of [
    ['impostors', 'http://localhost:3111/ppview?impostors=1'],
  ]) {
    const cdp = await connect(9222, await openPage(9222));
    try {
      const t0 = Date.now();
      await cdp.goto(url);
      await cdp.dropFiles(F('large.top', 'large.dat', 'patches.dat'));
      out[label] = { loadMs: Date.now() - t0, ...(await cdp.evaluate(wrap(ORBIT))) };
    } finally { cdp.close(); }
  }
  console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });

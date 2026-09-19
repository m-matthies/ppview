/**
 * The in-page half of the harness, as a string injected via Runtime.evaluate.
 *
 * Measurements are pixel-bucket counts rather than image hashes: they survive
 * antialiasing jitter between runs but still move decisively when geometry
 * appears, disappears, changes size, or loses its colour — which is exactly the
 * class of regression a rendering refactor introduces.
 */
// Everything is measured on a downscaled copy of the canvas.
//
// The real canvas is 2880x1626 at dpr 2 — 4.6M pixels — and reading it back on
// every poll was costing enough under a software rasteriser to blow the
// scenario timeout non-deterministically. Sampling a 640px-wide copy is ~20x
// cheaper and preserves every comparison this suite makes, because all of them
// are relative: counts move together when geometry appears, vanishes, resizes
// or loses its colour.
const SAMPLE_WIDTH = 640;
const SAMPLE = `
  const canvas = document.querySelector('canvas');
  const w = ${SAMPLE_WIDTH};
  const h = Math.max(1, Math.round(canvas.height * (w / canvas.width)));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
`;

const MEASURE = `
(() => {
  const canvas0 = document.querySelector('canvas');
  if (!canvas0) return null;
  ${SAMPLE}
  const W = w;
  let coloured = 0, neutral = 0, edges = 0, sumR = 0, sumG = 0, sumB = 0;
  // Channel means over the coloured pixels only — "what colour is the geometry",
  // as opposed to how much of it there is.
  //
  // Counting saturated pixels cannot tell magenta from green, so recolouring a
  // cluster moved the buckets by two pixels and a regression that dropped
  // colour overrides entirely would have read as no change at all. Averaging
  // over the whole frame does not help either: a handful of particles is a
  // rounding error against a light background. Averaging over just the coloured
  // pixels makes a recolour of one cluster a decisive shift.
  let tintR = 0, tintG = 0, tintB = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn > 45) { coloured++; tintR += r; tintG += g; tintB += b; }
    else if (mx > 40 && mx < 170) neutral++;
    sumR += r; sumG += g; sumB += b;

    // Horizontal gradient. Colour buckets cannot see white geometry against a
    // light background — that is exactly how a bug where raspberry beads
    // rendered untinted white stayed invisible to this harness. Silhouettes and
    // shading still produce edges, so this catches "geometry is there but the
    // wrong colour" and "geometry vanished" alike.
    const x = (i >> 2) % W;
    if (x > 0) {
      const p = i - 4;
      if (Math.abs(r - d[p]) + Math.abs(g - d[p + 1]) + Math.abs(b - d[p + 2]) > 24) edges++;
    }
  }
  const n = d.length / 4;
  const litPixels = coloured || 1;
  return {
    coloured, neutral, edges,
    mean: +((sumR + sumG + sumB) / (3 * n)).toFixed(2),
    tintR: +(tintR / litPixels).toFixed(1),
    tintG: +(tintG / litPixels).toFixed(1),
    tintB: +(tintB / litPixels).toFixed(1),
  };
})()
`;

// A sparse sample of the canvas — cheap enough to poll in a loop, dense enough
// to notice any change worth waiting for.
const QUICK_HASH = `
(() => {
  const canvas0 = document.querySelector('canvas');
  if (!canvas0) return 'none';
  ${SAMPLE}
  let acc = 0, lit = 0;
  for (let i = 0; i < d.length; i += 16) {
    acc = (acc * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
    if (d[i] | d[i + 1] | d[i + 2]) lit++;
  }
  // An entirely black canvas is never a real state in this app — the background
  // is light, or #15171c when dark — so it means the read landed mid-redraw.
  // Reporting it as a distinct value stops settle() from accepting two blank
  // samples in a row as "settled" and recording zeros.
  return lit === 0 ? 'blank' : acc;
})()
`;

// Small helpers the scenarios lean on, injected alongside each expression.
const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const measure = () => ${MEASURE};
const quickHash = () => ${QUICK_HASH};

/**
 * Wait until the canvas stops changing, rather than guessing how long a redraw
 * takes. frameloop is "demand", so once the scene has redrawn the pixels are
 * final — three identical samples in a row means finished. Fixed sleeps were the
 * entire cost of this suite.
 */
const settle = async (timeout = 4000) => {
  const started = Date.now();
  // Give the action a chance to commit before sampling at all. React commits
  // asynchronously and a heavy scene under a software rasteriser can take
  // longer to redraw than the three samples below span, so sampling
  // immediately can find the *pre-action* frame already "stable" and return
  // before anything has changed. That recorded a light frame as a dark
  // background in one baseline run, and a hidden cluster as a restored one in
  // another — both times passing the very next run, which is the worst way for
  // a harness to be wrong.
  await sleep(60);
  let previous = quickHash();
  let stable = 0;
  while (Date.now() - started < timeout) {
    // Deliberately not requestAnimationFrame: workers run in background tabs,
    // where Chrome never fires it, and awaiting it hung the scenario until the
    // CDP timeout fired.
    await sleep(40);
    const next = quickHash();
    if (next === 'blank') {           // never settle on a blank frame
      stable = 0;
      previous = next;
    } else if (next === previous) {
      // Three in a row, not two: one extra 40ms sample is far cheaper than a
      // baseline recorded mid-transition.
      if (++stable >= 3) return;
    } else {
      stable = 0;
      previous = next;
    }
  }
};

/** Poll a predicate instead of sleeping a guessed interval. */
const waitFor = async (fn, timeout = 4000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fn()) return true;
    await sleep(25);
  }
  return false;
};
const byLabel = (label) =>
  [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label);
const setNative = (el, value) => {
  const proto = Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const clusterBoxes = () => [...document.querySelectorAll('.highlight-checkbox input')];

// Two <select>s live in the same settings cluster and a third in the clustering
// pane, so position is not a safe way to tell them apart — the View control only
// exists once an overlay is registered, which shifts the others along. Identify
// each by an option only it has.
const selectWithOption = (label) => [...document.querySelectorAll('select')]
  .find(s => [...s.options].some(o => o.textContent.trim() === label));
const viewSelect = () => selectWithOption('Particle type');
const clustersSelect = () => selectWithOption('Computed (DBSCAN)');

/**
 * Drop a file onto the loaded scene.
 *
 * Not DOM.setFileInputFiles: the initial drop zone unmounts once a simulation
 * is up, and the additive path is a window drop listener with no input element
 * behind it. Synthesising the event is therefore the only way to reach the code
 * that actually runs when a user drags a cluster file onto the viewer.
 */
const dropJson = (name, text) => {
  const dt = new DataTransfer();
  dt.items.add(new File([text], name, { type: 'application/json' }));
  for (const type of ['dragenter', 'drop']) {
    window.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }
};
`;

const wrap = (body) => `(async () => {${PRELUDE}\n${body}\n})()`;

module.exports = { wrap, MEASURE };

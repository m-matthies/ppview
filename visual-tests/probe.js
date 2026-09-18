/**
 * The in-page half of the harness, as a string injected via Runtime.evaluate.
 *
 * Measurements are pixel-bucket counts rather than image hashes: they survive
 * antialiasing jitter between runs but still move decisively when geometry
 * appears, disappears, changes size, or loses its colour — which is exactly the
 * class of regression a rendering refactor introduces.
 */
const MEASURE = `
(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return null;
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  c.getContext('2d').drawImage(canvas, 0, 0);
  const d = c.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const W = c.width;
  let coloured = 0, neutral = 0, edges = 0, sumR = 0, sumG = 0, sumB = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn > 45) coloured++;
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
  return {
    coloured, neutral, edges,
    mean: +((sumR + sumG + sumB) / (3 * n)).toFixed(2),
  };
})()
`;

// Small helpers the scenarios lean on, injected alongside each expression.
const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const measure = () => ${MEASURE};
const byLabel = (label) =>
  [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label);
const setNative = (el, value) => {
  const proto = Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const clusterBoxes = () => [...document.querySelectorAll('.highlight-checkbox input')];
`;

const wrap = (body) => `(async () => {${PRELUDE}\n${body}\n})()`;

module.exports = { wrap, MEASURE };

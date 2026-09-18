/**
 * What each fixture is put through.
 *
 * Every scenario returns a bag of measurements. The runner compares them against
 * a committed baseline, so any change in what reaches the screen shows up as a
 * diff even when no test asserts on that value directly.
 */
const path = require('path');
const F = (...names) => names.map(n => path.join(__dirname, 'fixtures', n));

const FORMATS = [
  { name: 'mgl', files: F('mgl.mgl') },
  { name: 'raspberry', files: F('raspberry.top', 'raspberry.dat') },
  { name: 'oxdna', files: F('oxdna.top', 'oxdna.dat') },
  { name: 'srs', files: F('srs.psp', 'srs.dat') },
  { name: 'lorenzo', files: F('lorenzo.top', 'lorenzo.dat', 'patchesA.dat', 'patchesB.dat') },
  { name: 'flavio', files: F('flavio.top', 'flavio.dat', 'particles.txt', 'patches.txt') },
];

const SCENARIOS = {
  // Baseline render, plus the scene-furniture toggles.
  load: `
    // Settle before the very first measurement too: every other reading in the
    // suite follows an action that settles, but this one would otherwise
    // capture whatever happened to be on screen the instant the scenario began,
    // which is sometimes a frame mid-redraw.
    await settle();
    const out = { loaded: measure() };
    byLabel('Simulation box').click(); await settle();
    out.boxOn = measure();
    byLabel('Simulation box').click(); await settle();
    byLabel('Backdrop planes').click(); await settle();
    out.planesOff = measure();
    byLabel('Backdrop planes').click(); await settle();
    byLabel('Coordinate axes').click(); await settle();
    out.axesOff = measure();
    byLabel('Coordinate axes').click(); await settle();
    out.restored = measure();
    return out;
  `,

  // Geometry resolution and particle size must reach every renderer.
  detail: `
    const sel = document.querySelector('.settings-cluster select');
    const radius = document.querySelector('.settings-cluster input[type=number]');
    const out = {};
    setNative(sel, '8'); await settle(); out.detailLow = measure();
    setNative(sel, '32'); await settle(); out.detailUltra = measure();
    setNative(sel, '16'); await settle(); out.detailMedium = measure();
    setNative(radius, '1.2'); await settle(); out.radiusLarge = measure();
    setNative(radius, '0.5'); await settle(); out.radiusDefault = measure();
    return out;
  `,

  // Selection and cluster highlighting, the features that were ragged.
  clustering: `
    const out = {};
    byLabel('Clustering').click();
    await waitFor(() => document.querySelector('.cluster-item'), 15000);
    await settle();
    out.clusterRows = document.querySelectorAll('.cluster-item').length;
    out.open = measure();

    const boxes = clusterBoxes();
    boxes[0].click(); await settle();           // show only selected, nothing selected
    out.hiddenAll = measure();

    clusterBoxes()[1].click(); await settle();  // keep faint markers
    out.dimmedAll = measure();
    clusterBoxes()[1].click(); await settle();

    // Must name the checkbox: each row now leads with a colour swatch input.
    const first = document.querySelector('.cluster-item input[type=checkbox]');
    if (first) { first.click(); await settle(); }
    out.oneSelected = measure();

    clusterBoxes()[0].click(); await settle();  // back off
    out.restored = measure();
    return out;
  `,

  // Picking. Rewiring selection onto a shared service is invisible to pixel
  // counts, so this drives real clicks: sweep a grid over the canvas, count the
  // points that select something, then check modifier-click accumulates and a
  // click on empty space clears.
  selection: `
    // Enlarge particles first. Only some elements are clickable — an oxDNA
    // backbone sphere is r=0.2 in a 60-unit box, roughly 4px on screen — so at
    // default size this would measure marksmanship rather than whether picking
    // works.
    const radiusInput = document.querySelector('.settings-cluster input[type=number]');
    const setNativeValue = (el, v) => {
      const proto = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setNativeValue(radiusInput, '2');
    await settle();

    const canvas = document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    const click = (x, y, mods = {}) => canvas.dispatchEvent(new MouseEvent('click', {
      clientX: rect.left + x, clientY: rect.top + y, bubbles: true, ...mods,
    }));
    const selectedCount = () => {
      const h = document.querySelector('.selected-particles-display h3');
      if (!h) return 0;
      const m = h.textContent.match(/\((\d+)\)/);
      return m ? Number(m[1]) : 0;
    };

    // React commits selection asynchronously, so each click needs a settle
    // before the panel can be read — checking synchronously reports zero hits
    // even when picking is working perfectly.
    // Stop at the third hit: the point is that picking resolves, not how many
    // pixels happen to sit over geometry. Sweeping the whole canvas was by far
    // the slowest thing in the suite.
    const out = { hits: 0 };
    let firstHit = null;
    outer:
    for (let y = 40; y < rect.height - 40; y += 56) {
      for (let x = 40; x < rect.width - 40; x += 56) {
        click(x, y);
        await sleep(10);
        if (selectedCount() > 0) {
          out.hits++;
          if (!firstHit) firstHit = [x, y];
          if (out.hits >= 3) break outer;
        }
      }
    }

    if (firstHit) {
      // Wait for the expected state rather than a fixed interval; React commits
      // selection asynchronously but takes nowhere near 250ms to do it.
      click(firstHit[0], firstHit[1]);
      await waitFor(() => selectedCount() === 1);
      out.afterSingle = selectedCount();

      // A modifier click on the same particle toggles it back off.
      click(firstHit[0], firstHit[1], { ctrlKey: true });
      await waitFor(() => selectedCount() === 0);
      out.afterToggleOff = selectedCount();

      click(firstHit[0], firstHit[1]);
      await waitFor(() => selectedCount() === 1);
      click(4, rect.height - 4);                     // empty space clears
      await waitFor(() => selectedCount() === 0);
      out.afterMiss = selectedCount();
    }
    return out;
  `,

  // Lighting must drive the scene, and the patch legend gates patch rendering.
  appearance: `
    const out = {};
    byLabel('Patch legend').click(); await settle();
    out.patchesOn = measure();
    byLabel('Particle legend').click(); await settle();
    out.legendsOn = measure();

    byLabel('Lighting').click(); await settle();
    const preset = (n) => [...document.querySelectorAll('.preset-chip')]
      .find(b => b.textContent.trim() === n);
    for (const name of ['Depth', 'Publication', 'Relief', 'Flat']) {
      const chip = preset(name);
      if (chip) { chip.click(); await settle(); out['light_' + name] = measure(); }
    }
    document.querySelector('.scene-bg-toggle').click(); await settle();
    out.darkBackground = measure();
    document.querySelector('.scene-bg-toggle').click(); await settle();
    out.lightBackground = measure();
    return out;
  `,
};

module.exports = { FORMATS, SCENARIOS };

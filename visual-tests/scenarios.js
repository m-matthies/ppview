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
    const out = { loaded: measure() };
    byLabel('Simulation box').click(); await sleep(700);
    out.boxOn = measure();
    byLabel('Simulation box').click(); await sleep(700);
    byLabel('Backdrop planes').click(); await sleep(700);
    out.planesOff = measure();
    byLabel('Backdrop planes').click(); await sleep(700);
    byLabel('Coordinate axes').click(); await sleep(700);
    out.axesOff = measure();
    byLabel('Coordinate axes').click(); await sleep(700);
    out.restored = measure();
    return out;
  `,

  // Geometry resolution and particle size must reach every renderer.
  detail: `
    const sel = document.querySelector('.settings-cluster select');
    const radius = document.querySelector('.settings-cluster input[type=number]');
    const out = {};
    setNative(sel, '8'); await sleep(1100); out.detailLow = measure();
    setNative(sel, '32'); await sleep(1100); out.detailUltra = measure();
    setNative(sel, '16'); await sleep(1100); out.detailMedium = measure();
    setNative(radius, '1.2'); await sleep(1200); out.radiusLarge = measure();
    setNative(radius, '0.5'); await sleep(1200); out.radiusDefault = measure();
    return out;
  `,

  // Selection and cluster highlighting, the features that were ragged.
  clustering: `
    const out = {};
    byLabel('Clustering').click(); await sleep(2600);
    out.clusterRows = document.querySelectorAll('.cluster-item').length;
    out.open = measure();

    const boxes = clusterBoxes();
    boxes[0].click(); await sleep(1400);           // show only selected, nothing selected
    out.hiddenAll = measure();

    clusterBoxes()[1].click(); await sleep(1400);  // keep faint markers
    out.dimmedAll = measure();
    clusterBoxes()[1].click(); await sleep(1200);

    const first = document.querySelector('.cluster-item input');
    if (first) { first.click(); await sleep(1400); }
    out.oneSelected = measure();

    clusterBoxes()[0].click(); await sleep(1200);  // back off
    out.restored = measure();
    return out;
  `,

  // Lighting must drive the scene, and the patch legend gates patch rendering.
  appearance: `
    const out = {};
    byLabel('Patch legend').click(); await sleep(1200);
    out.patchesOn = measure();
    byLabel('Particle legend').click(); await sleep(900);
    out.legendsOn = measure();

    byLabel('Lighting').click(); await sleep(900);
    const preset = (n) => [...document.querySelectorAll('.preset-chip')]
      .find(b => b.textContent.trim() === n);
    for (const name of ['Depth', 'Publication', 'Relief', 'Flat']) {
      const chip = preset(name);
      if (chip) { chip.click(); await sleep(1100); out['light_' + name] = measure(); }
    }
    document.querySelector('.scene-bg-toggle').click(); await sleep(1100);
    out.darkBackground = measure();
    document.querySelector('.scene-bg-toggle').click(); await sleep(1100);
    out.lightBackground = measure();
    return out;
  `,
};

module.exports = { FORMATS, SCENARIOS };

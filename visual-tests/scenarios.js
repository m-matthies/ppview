/**
 * What each fixture is put through.
 *
 * Every scenario returns a bag of measurements. The runner compares them against
 * a committed baseline, so any change in what reaches the screen shows up as a
 * diff even when no test asserts on that value directly.
 */
const fs = require('fs');
const path = require('path');
const F = (...names) => names.map(n => path.join(__dirname, 'fixtures', n));

// Inlined into the scenario source rather than handed over as files, because
// the additive drop has no file input to point at. Read from the fixtures so
// they stay the single definition of what a cluster file looks like.
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const CLUSTERS_A = fixture('clusters.json');
const CLUSTERS_B = fixture('clusters-b.json');

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

    // The View control has to be there for computed clusters, not just for
    // clusters a file brought — that is the whole point of the pane's
    // grouping/colouring split, and it was reachable only with a file loaded.
    out.viewControl = viewSelect() ? 1 : 0;
    out.viewOptions = viewSelect() ? viewSelect().options.length : 0;
    setNative(viewSelect(), '');
    await settle();
    out.groupedColouredByType = measure();   // same grouping, type colours
    setNative(viewSelect(), 'computed');
    await settle();

    // One click back to an unrestricted scene, however deep in you are.
    const resetButton = () => [...document.querySelectorAll('.select-button')]
      .find(b => b.textContent.trim() === 'Show all particles');
    out.resetOffered = resetButton() ? 1 : 0;
    const restricted = measure().coloured;
    resetButton().click();
    await waitFor(() => measure().coloured > restricted + 10, 8000); await settle();
    out.afterReset = measure();
    out.resetWithdrawn = resetButton() ? 1 : 0;

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
    // Wait for the background to actually flip, not just for the canvas to hold
    // still. settle() needs three samples 40ms apart, and a heavy scene under a
    // software rasteriser can take longer than that to commit the change — so
    // settle() saw two identical *pre-toggle* frames and called it done. That
    // recorded a light frame as darkBackground in one baseline run and not the
    // next. Asserting the outcome removes the race; mean splits the two
    // backgrounds by 200 points, so the threshold is not delicate.
    document.querySelector('.scene-bg-toggle').click();
    await waitFor(() => measure().mean < 150, 8000); await settle();
    out.darkBackground = measure();
    document.querySelector('.scene-bg-toggle').click();
    await waitFor(() => measure().mean > 150, 8000); await settle();
    out.lightBackground = measure();
    return out;
  `,

  // Overlays: cluster files dropped onto a scene that is already up.
  //
  // Every fixture is 40 particles, so one pair of cluster files is valid for
  // all six formats and any difference between them is the renderer's, which is
  // the whole point of running this per format — the overlay colours have to
  // reach nucleotide meshes and raspberry beads as well as plain spheres.
  overlays: `
    await settle();
    const out = { before: measure() };

    dropJson('clusters.json', ${JSON.stringify(CLUSTERS_A)});
    out.viewControlAppeared = (await waitFor(() => viewSelect(), 8000)) ? 1 : 0;
    await settle();

    // A dropped overlay makes itself the active view: dropping a file and
    // seeing nothing change would read as the drop having failed.
    out.overlayActive = measure();
    out.viewOptions = viewSelect() ? viewSelect().options.length : 0;
    // ...and opens the pane, so there is somewhere to see what arrived.
    out.paneOpen = document.querySelector('.clustering-pane') ? 1 : 0;

    // The drop sets the View, not the pane's grouping, so the pane is still on
    // DBSCAN. Point it at the file to list the clusters the file describes.
    const groups = clustersSelect();
    out.groupOptions = groups ? groups.options.length : 0;
    setNative(groups, groups.options[1].value);
    await waitFor(() => document.querySelectorAll('.cluster-item').length > 0, 8000);
    await settle();
    // Four of the file's five clusters survive; the fifth indexes past the end
    // of a 40-particle structure and is rejected whole.
    out.clusterRows = document.querySelectorAll('.cluster-item').length;
    out.fileClusters = measure();

    // "Particle type" keeps the file's grouping but hands colour back to the
    // scheme — and the scheme control has to come back with it.
    setNative(viewSelect(), '');
    await settle();
    out.typeColours = measure();
    out.schemePickerShown = document.querySelector('.color-scheme-selector') ? 1 : 0;

    const overlayId = [...viewSelect().options].map(o => o.value).find(v => v.startsWith('overlay-'));
    setNative(viewSelect(), overlayId);
    await settle();
    // Under an overlay the scheme controls nothing visible, so it is hidden.
    out.schemePickerHidden = document.querySelector('.color-scheme-selector') ? 1 : 0;

    // The eye control hides that cluster's particles outright.
    //
    // Both toggles wait for the pixel count to actually move rather than for the
    // canvas to hold still: settle() alone recorded the still-hidden frame as
    // clusterRestored in one baseline run and the restored one in the next.
    const beforeHide = measure().coloured;
    document.querySelector('.cluster-visibility').click();
    await waitFor(() => measure().coloured < beforeHide - 10, 8000); await settle();
    out.oneClusterHidden = measure();
    const whileHidden = out.oneClusterHidden.coloured;
    document.querySelector('.cluster-visibility').click();
    await waitFor(() => measure().coloured > whileHidden + 10, 8000); await settle();
    out.clusterRestored = measure();

    // A per-cluster colour override repaints only its own cluster.
    setNative(document.querySelector('.cluster-swatch'), '#00ff00');
    await settle();
    out.recoloured = measure();

    // A second file registers alongside the first rather than replacing it.
    const optionsBefore = viewSelect().options.length;
    dropJson('clusters-b.json', ${JSON.stringify(CLUSTERS_B)});
    await waitFor(() => viewSelect().options.length > optionsBefore, 8000);
    await settle();
    out.viewOptionsAfterSecond = viewSelect().options.length;
    out.secondOverlay = measure();

    // DBSCAN is a view in its own right, and its colours must be its own — a
    // cluster file left active used to paint the computed clusters too.
    setNative(clustersSelect(), '');
    await waitFor(() => document.querySelectorAll('.cluster-item').length > 0, 15000);
    await settle();
    out.computedClusters = measure();
    return out;
  `,
};

module.exports = { FORMATS, SCENARIOS };

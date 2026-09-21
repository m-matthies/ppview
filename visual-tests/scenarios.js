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
    // Asserted, not measured: every fixture is five separable blobs, and a drop
    // to zero moves by less than ABSOLUTE_SLACK, so as a measurement it would be
    // swallowed exactly the way the dead selection test was.
    assert(document.querySelectorAll('.cluster-item').length === 5,
      'DBSCAN must find the five blobs every fixture is built from');
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
    assert(viewSelect(), 'View control must exist once DBSCAN has clusters');
    assert(viewSelect().options.length === 2,
      'with no cluster file loaded the View offers particle type and computed clusters');
    setNative(viewSelect(), '');
    await settle();
    out.groupedColouredByType = measure();   // same grouping, type colours
    setNative(viewSelect(), 'computed');
    await settle();

    // One click back to an unrestricted scene, however deep in you are.
    const resetButton = () => [...document.querySelectorAll('.select-button')]
      .find(b => b.textContent.trim() === 'Show all particles');
    assert(resetButton(), 'pane must offer a reset while the scene is restricted');
    const restricted = measure().coloured;
    resetButton().click();
    await waitFor(() => measure().coloured > restricted + 10, 8000); await settle();
    out.afterReset = measure();
    assert(!resetButton(), 'pane reset must withdraw once nothing is restricted');

    // Closing the panel must not switch the clustering off — and while it is
    // shut, both the View control and the way out have to keep working. They
    // did not: the panel owned the state and the effect that published it, so
    // unmounting it left the scene clustered with nothing listening.
    clusterBoxes()[0].click(); await settle();
    document.querySelector('.cluster-item input[type=checkbox]').click();
    await settle();
    const restrictedNow = measure();
    byLabel('Clustering').click(); await settle();
    assert(!document.querySelector('.clustering-pane'), 'panel must be closed');
    // Tolerance, not equality: the harness itself documents a pixel or two of
    // antialiasing jitter between reads.
    assert(Math.abs(measure().coloured - restrictedNow.coloured) <= 6,
      'closing the panel must not change what is on screen');
    assert(viewSelect(), 'View control must survive the panel closing');

    // Drive it in both directions with the panel shut. Setting it to whatever it
    // already holds proves nothing, and the reset above leaves it on "Particle
    // type" — so switch to cluster colours first, then back.
    setNative(viewSelect(), 'computed');
    await settle();
    out.clusterColoursWhileClosed = measure();
    setNative(viewSelect(), '');
    await settle();
    out.typeColoursWhileClosed = measure();
    // A magnitude, not mere inequality: antialiasing jitters these counts by a
    // point or two between reads, so "different" alone would pass even if the
    // control had stopped working entirely.
    assert(Math.abs(out.clusterColoursWhileClosed.tintG - out.typeColoursWhileClosed.tintG) > 6,
      'the View control must still recolour the scene while the panel is closed');
    setNative(viewSelect(), 'computed');
    await settle();

    assert(document.querySelector('.clear-clustering'),
      'control bar must offer a way out while the panel is closed');
    const beforeClear = measure().coloured;
    document.querySelector('.clear-clustering').click();
    await waitFor(() => measure().coloured > beforeClear + 10, 8000); await settle();
    out.afterClear = measure();
    assert(!document.querySelector('.clear-clustering'),
      'the way out must withdraw once nothing is restricted');

    // Reopen and leave the panel as the other scenarios expect to find it.
    byLabel('Clustering').click(); await settle();
    out.restored = measure();
    return out;
  `,

  // Picking. Rewiring selection onto a shared service is invisible to pixel
  // counts, so this drives real clicks: sweep a grid over the canvas, count the
  // points that select something, then check modifier-click accumulates and a
  // click on empty space clears.
  // Picking, asserted rather than counted.
  //
  // This scenario used to sweep a grid and record how many clicks selected
  // something. It waited 10ms after each click for React to commit a selection,
  // which is not enough, so it recorded hits: 0 — and because the baseline also
  // held 0, the suite reported "no visual change" for eight commits while the
  // only picking coverage in the suite was dead. Counting is what allowed that;
  // these are assertions now.
  selection: `
    // Enlarge particles first. Only some elements are clickable — an oxDNA
    // backbone sphere is r=0.2 in a 60-unit box, roughly 4px on screen — so at
    // default size this would measure marksmanship rather than whether picking
    // works. Hide the scene furniture too: the coordinate axes are saturated and
    // several pixels thick, so they read as solid geometry but are not pickable.
    setNative(document.querySelector('.settings-cluster input[type=number]'), '2');
    await settle();
    byLabel('Coordinate axes').click(); await settle();
    byLabel('Backdrop planes').click(); await settle();

    const canvas = document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    const click = (x, y, mods = {}) => canvas.dispatchEvent(new MouseEvent('click', {
      clientX: rect.left + x, clientY: rect.top + y, bubbles: true, ...mods,
    }));
    const selectedCount = () => {
      const h = document.querySelector('.selected-particles-display h3');
      if (!h) return 0;
      const m = h.textContent.match(/[(]([0-9]+)[)]/);
      return m ? Number(m[1]) : 0;
    };
    const clear = async () => {
      click(4, rect.height - 4);
      await waitFor(() => selectedCount() === 0, 2000);
    };
    // Try candidates in turn: a single point can sit on geometry that is drawn
    // but deliberately not pickable (a patch cone, a spring). A real picking
    // regression fails every one of them.
    const pickSomething = async () => {
      for (const [x, y] of pickTargets()) {
        click(x, y);
        if (await waitFor(() => selectedCount() === 1, 700)) return [x, y];
        await clear();
      }
      return null;
    };

    const out = {};
    const hit = await pickSomething();
    assert(hit, 'clicking a particle must select it');

    click(hit[0], hit[1], { ctrlKey: true });
    assert(await waitFor(() => selectedCount() === 0, 2000),
      'a modifier click on a selected particle must deselect it');

    click(hit[0], hit[1]);
    assert(await waitFor(() => selectedCount() === 1, 2000), 'reselect');
    click(4, rect.height - 4);
    assert(await waitFor(() => selectedCount() === 0, 2000),
      'a click on empty space must clear the selection');

    // And all of it again once the scene is clustered, which is where selecting
    // a highlighted particle used to shrink it from 1.3x to 1.0x — moving it out
    // from under the cursor, so the next modifier click hit whatever was behind
    // it and added that instead of deselecting.
    byLabel('Clustering').click();
    await waitFor(() => document.querySelector('.cluster-item'), 15000);
    await settle();
    clusterBoxes()[0].click(); await settle();
    document.querySelector('.cluster-item input[type=checkbox]').click();
    await settle();
    await clear();

    const clusteredHit = await pickSomething();
    assert(clusteredHit, 'clicking a particle must still select it once clustered');
    click(clusteredHit[0], clusteredHit[1], { ctrlKey: true });
    assert(await waitFor(() => selectedCount() === 0, 2000),
      'a modifier click on a selected particle must deselect it, not add another');

    // Deliberately records no pixel signature: which particle a sweep lands on
    // varies between runs, and a selected particle is yellow, so any measurement
    // here drifts. The assertions above are this scenario's output.
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
    assert(await waitFor(() => viewSelect(), 8000),
      'dropping a cluster file must reveal the View control');
    await settle();

    // A dropped overlay makes itself the active view: dropping a file and
    // seeing nothing change would read as the drop having failed.
    out.overlayActive = measure();
    assert(viewSelect().options.length === 3,
      'View offers particle type, computed clusters and the dropped file');
    // ...and opens the pane, so there is somewhere to see what arrived.
    assert(document.querySelector('.clustering-pane'),
      'a dropped cluster file must open the pane that explains it');

    // The drop sets the View, not the pane's grouping, so the pane is still on
    // DBSCAN. Point it at the file to list the clusters the file describes.
    const groups = clustersSelect();
    assert(groups && groups.options.length === 2,
      'the Clusters selector must offer DBSCAN and the dropped file');
    setNative(groups, groups.options[1].value);
    await waitFor(() => document.querySelectorAll('.cluster-item').length > 0, 8000);
    await settle();
    // Four of the file's five clusters survive; the fifth indexes past the end
    // of a 40-particle structure and is rejected whole.
    assert(document.querySelectorAll('.cluster-item').length === 4,
      'four of the five clusters in the file are in range and must be listed');
    out.fileClusters = measure();

    // "Particle type" keeps the file's grouping but hands colour back to the
    // scheme — and the scheme control has to come back with it.
    setNative(viewSelect(), '');
    await settle();
    out.typeColours = measure();
    assert(document.querySelector('.color-scheme-selector'),
      'the colour scheme returns under Particle type');

    const overlayId = [...viewSelect().options].map(o => o.value).find(v => v.startsWith('overlay-'));
    setNative(viewSelect(), overlayId);
    await settle();
    // Under an overlay the scheme controls nothing visible, so it is hidden.
    assert(!document.querySelector('.color-scheme-selector'),
      'the colour scheme is hidden under an overlay, where it controls nothing');

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
    assert(viewSelect().options.length === 4,
      'a second cluster file registers alongside the first, not instead of it');
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

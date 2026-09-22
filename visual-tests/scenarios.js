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

const IMPOSTORS_ON = (process.env.PPVIEW_URL || 'http://localhost:3111/ppview') + '?impostors=1';

const FORMATS = [
  { name: 'mgl', files: F('mgl.mgl') },
  { name: 'raspberry', files: F('raspberry.top', 'raspberry.dat') },
  { name: 'oxdna', files: F('oxdna.top', 'oxdna.dat') },
  { name: 'srs', files: F('srs.psp', 'srs.dat') },
  { name: 'lorenzo', files: F('lorenzo.top', 'lorenzo.dat', 'patchesA.dat', 'patchesB.dat') },
  { name: 'flavio', files: F('flavio.top', 'flavio.dat', 'particles.txt', 'patches.txt') },
  // The same structure drawn as impostors. Forced on by a query parameter,
  // because the threshold that selects them is 50,000 particles and every
  // fixture here is 40 — without this the impostor shader would have no
  // coverage at all, and a shader that fails to compile renders nothing.
  { name: 'migrate', files: F('migrate.top', 'migrate.dat', 'patchesA.dat') },
  {
    name: 'impostor',
    files: F('lorenzo.top', 'lorenzo.dat', 'patchesA.dat', 'patchesB.dat'),
    url: IMPOSTORS_ON,
  },
  // Impostors are per renderer, not per app: each mesh opts in separately and
  // three different shapes are involved. These two cover the ones the plain
  // sphere impostor cannot speak for.
  //
  // oxDNA is the format most likely to reach a million particles and it draws
  // four meshes per nucleotide — the backbone is a sphere impostor, the
  // nucleoside a rotated *ellipsoid* solved by a different shader, and the two
  // cylinders stay real geometry. A shader that fails to compile draws nothing,
  // and an ellipsoid solved wrongly still draws something, so this needs its own
  // fixture rather than an assurance.
  {
    name: 'impostor-oxdna',
    files: F('oxdna.top', 'oxdna.dat'),
    url: IMPOSTORS_ON,
  },
  // Raspberry draws beads, not particles, and the beads carry their radius in
  // the instance scale rather than in the geometry — the one case where the
  // shader's radius multiplier is 1.
  {
    name: 'impostor-raspberry',
    files: F('raspberry.top', 'raspberry.dat'),
    url: IMPOSTORS_ON,
  },
];

/**
 * Which fixtures a scenario runs against.
 *
 * Running all seven through all seven scenarios cost 334s, and a page load is
 * 2.6s of that before a scenario begins — Chrome building a software WebGL
 * context and the app drawing its first frame, which serving the production
 * build instead of the dev server does not improve at all. So the only way to
 * make the suite cheaper is to stop paying for coverage twice.
 *
 * The per-format claim this suite exists to make is that **scene-wide controls
 * reach every renderer**: detail, radius, clustering appearance and picking were
 * a ragged feature matrix once, and that is the bug class worth seven fixtures.
 * Formats that share a renderer set cannot make that claim twice:
 *
 * | fixture   | renderers |
 * |-----------|-----------|
 * | lorenzo   | spheres + patch cones |
 * | flavio    | spheres + patch cones — identical to lorenzo |
 * | mgl       | spheres only — a subset of lorenzo |
 * | raspberry | spheres + repulsion beads |
 * | oxdna     | four nucleotide meshes |
 * | srs       | spheres + patch cones + spring cylinders |
 * | impostor  | the impostor shader |
 *
 * So `flavio` and `mgl` earn their place by *loading* — a parser and a detection
 * path each — not by drawing something new, and they run the scenarios where
 * that is the subject.
 */
const RENDERERS = ['raspberry', 'oxdna', 'srs', 'lorenzo', 'impostor'];
// The two fixtures that exist only to exercise a shader. They join the scenarios
// where the *representation* is the subject — does it compile, does it draw the
// right shape, does the radius reach it, can it be clicked — and stay out of
// clustering, where hiding and highlighting happen in the write callback that
// both representations share.
const NEW_IMPOSTORS = ['impostor-oxdna', 'impostor-raspberry'];
// Springs are not pickable and srs otherwise picks exactly as lorenzo does.
const PICKABLE = ['raspberry', 'oxdna', 'lorenzo', 'impostor', ...NEW_IMPOSTORS];
// MGL frames live in memory; every other format slices them out of a file.
const LOADERS = ['mgl', 'oxdna'];
// Scene-wide behaviour — one lighting rig, one control bar, one set of stores.
// A second fixture would re-measure the same code against different pixels.
const ANY_ONE = ['lorenzo'];

const SCENARIOS = {
  // The clustering over time: what became of one cluster's particles.
  //
  // Runs against the one fixture where a cluster actually changes: two blobs of
  // eight and a particle that walks between them. DBSCAN walks particles in
  // order, so the first cluster listed is the blob holding particle 0 — the one
  // that loses it.
  kymograph: `
    await settle();
    byLabel('Clustering').click();
    await waitFor(() => document.querySelector('.cluster-item'), 15000);
    await settle();

    const paneColoursNow = () => [...document.querySelectorAll('.cluster-swatch')]
      .map(i => i.value).sort().join(',');

    // A cluster's colour must not move: not when it is selected, not when the
    // frame changes, and not when a time view is computed. All three moved it
    // before — selecting a near-black cluster in the pane gave it a green band,
    // because the colour came from one source with a silent fallback to another.
    const coloursAtStart = paneColoursNow();
    document.querySelector('.cluster-item input[type=checkbox]').click();
    await settle();
    assert(paneColoursNow() === coloursAtStart,
      'selecting a cluster must not change its colour');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await settle();
    assert(paneColoursNow() === coloursAtStart,
      'nor must changing the frame');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await settle();
    document.querySelector('.cluster-item input[type=checkbox]').click();
    await settle();

    const byText = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t);
    assert(byText('Clusters over time'), 'the pane must offer the time view');
    byText('Clusters over time').click();
    await waitFor(() => document.querySelector('.kymograph-panel'), 30000);

    // Nothing is drawn until a cluster is chosen: the picture is one cluster's
    // history, not the whole system's, and which one has to be picked first.
    assert(!document.querySelector('.kymograph-canvas'),
      'no picture before a cluster is selected');
    assert(document.querySelector('.kymograph-empty'), 'and it says so');

    document.querySelector('.cluster-item input[type=checkbox]').click();
    assert(await waitFor(() => document.querySelector('.kymograph-canvas'), 20000),
      'selecting a cluster must draw it');
    await settle();

    const canvas = document.querySelector('.kymograph-canvas');
    const hex2 = (n) => n.toString(16).padStart(2, '0');
    const out = { size: canvas.width + 'x' + canvas.height };
    assert(canvas.width > 1 && canvas.height > 1, 'the picture must have been drawn');

    // Axes, so the height and the width mean something stated rather than
    // guessed. The y scale tops out at the cohort, which is this cluster's size.
    const ticksY = [...document.querySelectorAll('.kymograph-ticks-y span')].map(t => t.textContent);
    const ticksX = [...document.querySelectorAll('.kymograph-ticks-x span')].map(t => t.textContent);
    out.ticksY = ticksY.join(',');
    out.ticksX = ticksX.join(',');
    assert(document.querySelector('.kymograph-axis-y').textContent === 'Particles',
      'the vertical axis is labelled');
    assert(document.querySelector('.kymograph-axis-x').textContent === 'Frame',
      'and so is the horizontal one');
    assert(ticksY[0] === '8', 'the scale tops out at the eight particles being followed');
    assert(ticksY[ticksY.length - 1] === '0', 'and starts at zero');
    assert(ticksX[0] === '0' && ticksX[ticksX.length - 1] === '5',
      'the frame axis spans the trajectory');

    const paneColours = () => [...document.querySelectorAll('.cluster-swatch')]
      .map(i => i.value).sort();
    const paneStart = paneColours();
    out.paneColours = paneStart.join(',');
    assert(paneStart.join(',') === coloursAtStart,
      'and computing a time view must not change them either');

    // The histogram, the list and the picture must agree. The histogram was the
    // last thing still coloured by size, so its bars disagreed with the swatches
    // beside them, with the scene and with the bands. A bar standing for exactly
    // one cluster now carries that cluster's colour; this fixture has two
    // clusters of different sizes at the last frame, so both bars do.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await settle();
    // Normalised, not compared as strings: the palette is hsl() and a colour
    // input reports hex, so the raw values differ while the colours match. A
    // canvas context is the shortest honest way to compare two CSS colours.
    const normalise = (colour) => {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.fillStyle = colour;
      return ctx.fillStyle;
    };
    const barColours = [...document.querySelectorAll('.histogram-bar')]
      .map(b => b.style.getPropertyValue('--bar-color'))
      .filter(Boolean).map(normalise).sort();
    out.barColours = barColours.join(',');
    assert(barColours.length === 2, 'each bar stands for one cluster, so each has a colour');
    assert(barColours.join(',') === paneColours().map(normalise).sort().join(','),
      'and those are the colours the list gives those clusters');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await settle();

    // Read a single column: the picture spans the whole run, so the question is
    // what one frame shows.
    const columnColours = (fraction) => {
      const c = document.createElement('canvas');
      c.width = canvas.width; c.height = canvas.height;
      c.getContext('2d').drawImage(canvas, 0, 0);
      const x = Math.min(canvas.width - 1, Math.floor(fraction * canvas.width));
      const d = c.getContext('2d').getImageData(x, 0, 1, canvas.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) {
        seen.add('#' + hex2(d[i]) + hex2(d[i+1]) + hex2(d[i+2]));
      }
      return paneStart.filter(col => seen.has(col));
    };
    const picture = () => {
      const c = document.createElement('canvas');
      c.width = canvas.width; c.height = canvas.height;
      c.getContext('2d').drawImage(canvas, 0, 0);
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) {
        seen.add('#' + hex2(d[i]) + hex2(d[i+1]) + hex2(d[i+2]));
      }
      return [...seen].sort().join(',');
    };

    // At the frame it was picked they are all still in their own cluster...
    assert(columnColours(0.02).length === 1,
      'at the frame it was picked, the cohort is all in its own cluster');
    const followed = columnColours(0.02)[0];
    out.followed = followed;
    assert(paneStart.includes(followed),
      'and that colour is the one the pane gives the cluster');

    // ...and by the end one of them has left for the other cluster. This is the
    // whole question, and a band of cluster size could not answer it: a cluster
    // can hold a steady count and have exchanged every member.
    out.fate = columnColours(0.98).join(',');
    assert(columnColours(0.98).length === 2,
      'and by the end it has split, showing where its particles went');
    assert(columnColours(0.98).includes(followed),
      'with the ones that stayed still in the cluster they started in');

    // Latched at the frame it was picked: scrubbing must not redefine who the
    // cohort is, or it would agree with whatever is on screen and answer nothing.
    // The pane's colours must hold too — colouring by size rank gave these two
    // clusters two near-identical reds at one frame and a green and a red at
    // another, the same clusters throughout.
    const beforeSeek = picture();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await settle();
    assert(picture() === beforeSeek, 'the cohort must not change when the frame does');
    assert(paneColours().join(',') === out.paneColours,
      'and a cluster must keep its colour as the trajectory plays');

    // A plain click seeks.
    const readout = () => [...document.querySelectorAll('input[type=range]')]
      .find(r => Number(r.max) > 0)?.value;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await settle();
    const startFrame = readout();
    const plot = document.querySelector('.kymograph-plot');
    const box = plot.getBoundingClientRect();
    plot.dispatchEvent(new MouseEvent('click', {
      clientX: box.left + box.width - 4, clientY: box.top + box.height / 2, bubbles: true }));
    assert(await waitFor(() => readout() !== startFrame, 4000),
      'clicking the picture must go to that frame');
    out.seeked = readout();
    return out;
  `,

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
    // Patch cones are gated on the patch legend (Particles/index.js reads
    // showPatchLegend), and which formats have patches at all is a per-format
    // fact — so this toggle belongs here rather than in the scene-wide
    // appearance scenario, which now runs against one fixture.
    byLabel('Patch legend').click(); await settle();
    out.patchesOn = measure();
    byLabel('Patch legend').click(); await settle();
    out.restored = measure();
    return out;
  `,

  // Stepping through a trajectory, and coming back.
  //
  // Frames are cached once decoded, because re-scanning the text is where
  // loading a large frame spends its time. That makes "a cached frame renders
  // exactly like a freshly parsed one" a thing worth checking — and it was
  // uncheckable until the fixtures grew past a single configuration.
  playback: `
    await settle();
    const out = { first: measure() };
    const step = async (key) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await settle();
      return measure();
    };

    // Distance, not a sum of bucket differences: the fixtures drift one blob of
    // five, so a frame step moves geometry without necessarily changing how much
    // of it there is. Counts alone called that "no change" for the one format
    // whose frames are not re-centred on the box.
    const apart = (a, b) => Math.abs(a.coloured - b.coloured) + Math.abs(a.edges - b.edges)
                          + Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);

    out.second = await step('ArrowRight');
    assert(apart(out.second, out.first) > 6,
      'stepping forward must change what is on screen');

    out.third = await step('ArrowRight');
    const backToSecond = await step('ArrowLeft');
    // The revisit comes from the cache; it has to be the same frame.
    assert(apart(backToSecond, out.second) <= 6,
      'a cached frame must render exactly like the parsed one');

    const backToFirst = await step('ArrowLeft');
    assert(apart(backToFirst, out.first) <= 6,
      'stepping back to the first frame must restore it');
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

  // Cluster appearance must reach every renderer.
  //
  // This is the half of clustering that is genuinely per-format: three renderers
  // draw parts of the same patchy particle, and each used to decide appearance
  // for itself — so raspberry particles ignored clustering entirely and springs
  // ignored both clustering and selection. Hiding, dimming and highlighting are
  // the three states `getClusterAppearance` returns, so all three are exercised
  // here against each distinct renderer set.
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

    // Show only selected, with nothing selected: everything the renderer draws
    // has to collapse, beads and springs and cones included.
    clusterBoxes()[0].click(); await settle();
    out.hiddenAll = measure();
    assert(out.hiddenAll.coloured < out.open.coloured - 10,
      'hiding every cluster must remove geometry from the screen');

    // Faint markers bring one small sphere back per particle — including for
    // raspberry, where the marker is the centre sphere its beads normally hide.
    clusterBoxes()[1].click(); await settle();
    out.dimmedAll = measure();
    // Neutral and edges, not the coloured bucket: the markers are deliberately
    // grey, so the saturated bucket cannot see them at all — it reads 14 either
    // way, for every format. Grey lands in neutral, silhouettes in edges.
    assert((out.dimmedAll.neutral - out.hiddenAll.neutral)
         + (out.dimmedAll.edges - out.hiddenAll.edges) > 20,
      'faint markers must put grey spheres back on screen');
    clusterBoxes()[1].click(); await settle();

    // Must name the checkbox: each row leads with a colour swatch input.
    document.querySelector('.cluster-item input[type=checkbox]').click();
    await settle();
    out.oneSelected = measure();
    assert(out.oneSelected.coloured > out.hiddenAll.coloured + 10,
      'selecting a cluster must bring its particles back');
    return out;
  `,

  // Everything about the clustering *controls*: the View selector, the way out,
  // and the fact that closing the panel does not switch the clustering off.
  //
  // None of it is format-specific — one pane, one control bar, one store — so it
  // runs against a single fixture. What is format-specific is whether cluster
  // appearance reaches each renderer, and that is the `clustering` scenario.
  clusterControls: `
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
    // The *second* cluster, not the first. Cluster colour now comes from the
    // cluster's lowest-numbered particle, and for the first cluster that lands
    // on the same palette entry as its particles' type — so switching the View
    // would change nothing and the check below would pass whatever happened.
    [...document.querySelectorAll('.cluster-item input[type=checkbox]')][1].click();
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
    // Records what it tried, so a failure says why. "clicking a particle must
    // select it" alone cannot distinguish picking being broken from the scan
    // finding nothing to click on, and those want completely different fixes.
    let lastAttempt = 'no attempt';
    const pickSomething = async () => {
      const targets = pickTargets();
      lastAttempt = targets.length + ' candidates: ' + targets.map(t => t.map(Math.round).join(',')).join(' ');
      for (const [x, y] of targets) {
        click(x, y);
        // Generous, because this wait is only ever paid in full when a click
        // genuinely missed. 700ms was not always enough for React to commit a
        // selection under a loaded machine, and losing that race on all twelve
        // candidates reported picking as broken when it was not — once in four
        // full runs. A real regression still fails every candidate, it just
        // takes longer to say so.
        if (await waitFor(() => selectedCount() === 1, 1500)) return [x, y];
        await clear();
      }
      return null;
    };

    const out = {};
    const hit = await pickSomething();
    assert(hit, 'clicking a particle must select it — tried ' + lastAttempt);

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
    assert(clusteredHit, 'clicking a particle must still select it once clustered — tried ' + lastAttempt);
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

/**
 * Which fixtures each scenario runs against. `null` means all of them.
 *
 * Read this as the suite's coverage argument: every entry says what the scenario
 * is a claim about, and therefore what a second fixture would add.
 */
const SCENARIO_FORMATS = {
  kymograph: ['migrate'],   // the one fixture where a cluster actually changes
  load: null,          // the per-format smoke test: parse, detect, draw
  playback: LOADERS,   // frame stepping and the cache, one per loading path
  detail: [...RENDERERS, ...NEW_IMPOSTORS],  // resolution and radius reach every renderer
  clustering: RENDERERS,     // and so must cluster appearance
  clusterControls: ANY_ONE,  // the pane and the View control: scene-wide
  selection: PICKABLE,       // picking, per pickable renderer
  appearance: ANY_ONE,       // one lighting rig, one background
  overlays: ANY_ONE,         // overlay registration and the View: scene-wide
};

module.exports = { FORMATS, SCENARIOS, SCENARIO_FORMATS };

import { createIdentity, colourForSlot } from '../../utils/clusterIdentity';

/**
 * The shape all three cluster/bond observables end up in.
 *
 * The three formats share no text layout at all — one line per step, a
 * configuration-style block, and a bare tuple list — so each needs its own
 * parser. What they do share is what they mean: a set of bonds per timestep,
 * from which cluster membership either falls out or is stated outright. Every
 * parser therefore ends here, and nothing downstream needs to know which
 * observable it came from.
 *
 * A frame holds its bonds as four parallel `Int32Array`s rather than an array
 * of objects. The renderer walks them per instance on every frame, and a long
 * trajectory can hold a great many bonds — objects would mean an allocation per
 * bond per frame and a pointer chase inside the write loop.
 */

/** Patch ids are not known for every format; -1 says so. */
export const NO_PATCH = -1;

/**
 * One bond per particle pair, carrying whatever patch ids were seen.
 *
 * Two of the three formats report a bond twice, once from each participating
 * particle — and each report only knows its own end's patch. Merging the two
 * directions is therefore not merely deduplication: it is the only way both
 * patch ids become known.
 *
 * Input is directed half-bonds, `{from, fromPatch, to, toPatch}`, which is what
 * all three parsers can produce; `toPatch` is NO_PATCH where the far end's patch
 * was not stated.
 */
export function dedupeBonds(halfBonds) {
  const merged = new Map();

  for (const { from, fromPatch = NO_PATCH, to, toPatch = NO_PATCH } of halfBonds) {
    // A particle bonded to itself would be drawn as a zero-length cylinder, and
    // means nothing in any of these formats.
    if (from === to) continue;

    // Normalised so the two directions land on the same key. `a` is always the
    // lower index, so `patchA` always belongs to it.
    const forward = from < to;
    const a = forward ? from : to;
    const b = forward ? to : from;
    const patchA = forward ? fromPatch : toPatch;
    const patchB = forward ? toPatch : fromPatch;

    const key = `${a}-${b}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { a, b, patchA, patchB });
      continue;
    }
    // First patch id seen for each end wins. Two particles bonded on more than
    // one patch are one cylinder either way, so there is nowhere to put a
    // second, and a duplicate drawn in the same place is invisible geometry.
    if (existing.patchA === NO_PATCH) existing.patchA = patchA;
    if (existing.patchB === NO_PATCH) existing.patchB = patchB;
  }

  // Sorted rather than left in discovery order: a frame's bonds are compared
  // against the frame before it in the tests, and instance order shows up in
  // the visual suite's pixel counts.
  return [...merged.values()].sort((x, y) => x.a - y.a || x.b - y.b);
}

/**
 * Clusters as the connected components of the bond graph.
 *
 * `RaspberryPatchyBonds` states no grouping at all and `PatchyBonds` states it
 * only per particle, so for both of those this is where clusters come from —
 * the same split pypatchy does with `nx.weakly_connected_components`.
 * `PLClusterTopology` states its grouping and does not need this.
 *
 * A particle in no bond appears in no cluster, which matches DBSCAN's treatment
 * of noise and keeps the pane's "clustered / noise" statistics honest.
 */
export function connectedComponents(bonds) {
  const parent = new Map();

  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    // Path compression, so a long chain of bonds does not make this quadratic.
    let walk = x;
    while (parent.get(walk) !== root) {
      const next = parent.get(walk);
      parent.set(walk, root);
      walk = next;
    }
    return root;
  };

  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };

  for (const { a, b } of bonds) {
    add(a);
    add(b);
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  }

  const byRoot = new Map();
  for (const particle of parent.keys()) {
    const root = find(particle);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(particle);
  }

  const clusters = [...byRoot.values()];
  clusters.forEach(cluster => cluster.sort((x, y) => x - y));
  // Ordered by lowest member so the same file always yields the same cluster
  // indices — the pane's selection and colour overrides are keyed by index.
  return clusters.sort((x, y) => x[0] - y[0]);
}

/** Packs one timestep's bonds and clusters into the frame shape. */
export function makeFrame(bonds, clusters) {
  const count = bonds.length;
  const frame = {
    a: new Int32Array(count),
    b: new Int32Array(count),
    patchA: new Int32Array(count),
    patchB: new Int32Array(count),
    clusters,
  };
  for (let i = 0; i < count; i++) {
    frame.a[i] = bonds[i].a;
    frame.b[i] = bonds[i].b;
    frame.patchA[i] = bonds[i].patchA ?? NO_PATCH;
    frame.patchB[i] = bonds[i].patchB ?? NO_PATCH;
  }
  return frame;
}

/**
 * Every cluster's colour, for every frame, decided once when the file loads.
 *
 * `clusterIdentity` gives a cluster the colour slot most of its particles
 * already had, so a cluster keeps its colour as it grows, shrinks, exchanges
 * members or is renumbered — which is what makes it followable while the
 * trajectory plays.
 *
 * Computed here over the whole file rather than live as frames arrive, for two
 * reasons. The register is stateful and order-dependent, so a live one would
 * give different colours scrubbing backwards than forwards. And it gets its own
 * register, not the pane's shared one, because these are a second sequence of
 * frames in play — the same reason the time view has its own.
 */
export function colourFrames(frames, palette) {
  const identity = createIdentity();
  return frames.map(frame => identity
    .assign(frame.clusters)
    .map(slot => colourForSlot(palette, slot)));
}

/**
 * Clusters over a trajectory: which cluster each particle is in, frame by frame.
 *
 * The data behind the time view. Its job is to give clusters an identity that
 * survives from one frame to the next, because DBSCAN renumbers from scratch
 * every time it runs — without that, "the same cluster" is not a thing that can
 * be said at all, and neither the picture nor a selection can track anything.
 *
 * `assignLineages` supplies that identity by matching clusters on the particles
 * they share. Everything else here is built on it: the colour a cluster keeps
 * for the whole run, the bands it is drawn as, and the path a single particle
 * takes between them.
 *
 * The file is named for the picture this started as — a kymograph, one row per
 * particle — which is kept in the history rather than the code: rows fall below
 * a pixel on any real structure, rows grouped by one frame's clustering decay as
 * membership churns, and it could show membership but never a merge or a split.
 * `components/ClusterKymograph` explains what replaced it.
 */

export const NOISE = 0;

// Past this many columns the picture stops being readable rather than merely
// large. Frames are sampled evenly rather than truncated, so it still spans the
// whole trajectory.
export const MAX_COLS = 800;

/**
 * `count` indices spread evenly across `total`, or all of them if they fit.
 *
 * Evenly, not the first N: a kymograph of the first 800 frames of a 5000-frame
 * run would answer a question nobody asked.
 */
export function pickIndices(total, max) {
  if (total <= max) return Array.from({ length: total }, (_, i) => i);
  const step = total / max;
  return Array.from({ length: max }, (_, i) => Math.min(total - 1, Math.round(i * step)));
}

/**
 * Matches this frame's clusters to the previous frame's lineages.
 *
 * DBSCAN renumbers from scratch every frame, so the only way to say "this is the
 * same cluster as before" is membership: whichever lineage this cluster shares
 * the most particles with is the one it continues.
 *
 * Contested lineages go to the larger overlap, and the loser starts a fresh one.
 * That is what makes a split read correctly — one half carries the history on,
 * the other appears as something new — and it stops two clusters both claiming
 * to be the same thing, which would draw one lineage in two places at once.
 *
 * @param clusters       arrays of particle indices, this frame
 * @param previous       per-particle lineage from the frame before, or null
 * @param nextLineage    the next unused lineage id
 * @returns {{ lineageOf: Int32Array, nextLineage: number }}
 */
export function assignLineages(clusters, particleCount, previous, nextLineage) {
  const claims = clusters.map((cluster, index) => {
    if (!previous) return { index, lineage: 0, overlap: 0 };
    const counts = new Map();
    for (const particle of cluster) {
      const lineage = previous[particle] ?? NOISE;
      if (lineage !== NOISE) counts.set(lineage, (counts.get(lineage) ?? 0) + 1);
    }
    let lineage = 0;
    let overlap = 0;
    // Ties break on the lower lineage id, so the result does not depend on Map
    // iteration order and two runs draw the same picture.
    for (const [candidate, count] of counts) {
      if (count > overlap || (count === overlap && candidate < lineage)) {
        lineage = candidate;
        overlap = count;
      }
    }
    return { index, lineage, overlap };
  });

  // Strongest claim first, so the cluster that inherited most of a lineage is
  // the one that keeps it.
  claims.sort((a, b) => b.overlap - a.overlap || a.index - b.index);

  const taken = new Set();
  const lineageOfCluster = new Array(clusters.length).fill(0);
  let next = nextLineage;
  for (const claim of claims) {
    if (claim.overlap > 0 && !taken.has(claim.lineage)) {
      taken.add(claim.lineage);
      lineageOfCluster[claim.index] = claim.lineage;
    } else {
      lineageOfCluster[claim.index] = next++;
    }
  }

  const lineageOf = new Int32Array(particleCount);
  clusters.forEach((cluster, index) => {
    for (const particle of cluster) {
      if (particle >= 0 && particle < particleCount) lineageOf[particle] = lineageOfCluster[index];
    }
  });
  return { lineageOf, nextLineage: next };
}

/**
 * Lineages in the order they first appear, as a lineage -> slot map.
 *
 * The palette is indexed by this slot rather than by the raw lineage id, so the
 * first few clusters get the first few palette entries however many lineages the
 * run went on to create. Indexing by the id directly meant a long run with many
 * short-lived clusters walked the palette and wrapped, giving two live clusters
 * the same colour while entries sat unused.
 */
export function lineageSlots(columns) {
  const slots = new Map();
  for (const column of columns) {
    for (const lineage of column) {
      if (lineage !== NOISE && !slots.has(lineage)) slots.set(lineage, slots.size);
    }
  }
  return slots;
}

/** Which column of a computed run holds a given trajectory frame. */
export function columnForFrame(data, frame) {
  if (!data?.frames?.length) return 0;
  const nearest = data.frames.findIndex(f => f >= frame);
  return nearest === -1 ? data.frames.length - 1 : nearest;
}

/**
 * A cluster's colour from its lineage: one colour per cluster, for all time.
 *
 * This is what makes a cluster trackable at all. Everywhere else the app colours
 * a cluster by its size, which is the right call for a single frame — but sizes
 * change from frame to frame, so the cluster you picked is a different colour
 * two frames later, in the pane and in the scene both. Measured on two clusters
 * of eight: two near-identical reds at one frame, a green and a red at another,
 * the same clusters throughout. Nothing then connects a band to a selection.
 *
 * Once a time view exists there is a stable identity to colour by, so the whole
 * app uses it: the pane's swatches, the particles in the scene and the bands
 * all agree, and none of them change as the trajectory plays.
 *
 * @returns (particleIndex) => hex, or null when that particle is in no cluster
 */
export function lineageColourer(data, palette, frame) {
  if (!data?.columns?.length || !palette?.length) return null;
  const slots = lineageSlots(data.columns);
  const column = data.columns[columnForFrame(data, frame)] ?? data.columns[0];
  return (particle) => {
    const lineage = column[particle];
    if (lineage === undefined || lineage === NOISE) return null;
    return palette[(slots.get(lineage) ?? 0) % palette.length];
  };
}

// ---------------------------------------------------------------- bands
//
// The picture this is actually drawn as.
//
// One row per particle was the obvious reading of "clusters over time" and the
// wrong one. Rows go below a pixel as soon as a structure is large, so the thing
// meant to show evolution becomes a smear; and because rows are grouped by one
// frame's clustering, every particle that later leaves is stranded in the wrong
// group, so the bands decay into noise exactly as the trajectory gets
// interesting. Worst of all it shows membership but never shows a *merge* or a
// *split* — the two events anyone watching clusters over time is watching for.
//
// A band per cluster, its height its size, fixes all three: height is a count so
// nothing goes sub-pixel, a cluster is one continuous shape however its
// membership churns, and a merge is two bands becoming one.

/** How many particles each lineage holds in a frame. */
export function bandSizes(column) {
  const sizes = new Map();
  for (const lineage of column) {
    if (lineage !== NOISE) sizes.set(lineage, (sizes.get(lineage) ?? 0) + 1);
  }
  return sizes;
}

/**
 * The order bands are stacked in, and it has to be one order for the whole run.
 *
 * Sorting per frame would make a band jump the stack whenever two clusters
 * swapped size, which reads as the cluster moving rather than growing. Longest
 * lived first, then largest, then by id so it is deterministic: a cluster that
 * is present throughout sits at the top and stays there.
 */
export function bandOrder(columns) {
  const life = new Map();
  const peak = new Map();
  for (const column of columns) {
    for (const [lineage, size] of bandSizes(column)) {
      life.set(lineage, (life.get(lineage) ?? 0) + 1);
      peak.set(lineage, Math.max(peak.get(lineage) ?? 0, size));
    }
  }
  return [...life.keys()].sort((a, b) =>
    life.get(b) - life.get(a) || peak.get(b) - peak.get(a) || a - b);
}

/**
 * Stacked spans per frame: where each band starts and ends, as a fraction.
 *
 * Fractions of the particle count rather than of the stack, so a frame where
 * half the particles are noise leaves half the height empty instead of silently
 * rescaling — losing particles to noise is a real event and hiding it would be a
 * lie about the structure.
 */
export function stackFrames(columns, order, particleCount) {
  return columns.map((column) => {
    const sizes = bandSizes(column);
    const spans = new Map();
    let offset = 0;
    for (const lineage of order) {
      const size = sizes.get(lineage) ?? 0;
      if (size === 0) continue;
      spans.set(lineage, {
        start: offset / particleCount,
        end: (offset + size) / particleCount,
        size,
      });
      offset += size;
    }
    return spans;
  });
}

/** Where a particle sits in the stack at each frame, or null while it is noise. */
export function particleTrace(columns, stacks, particle) {
  return columns.map((column, frame) => {
    const lineage = column[particle];
    if (lineage === undefined || lineage === NOISE) return null;
    const span = stacks[frame].get(lineage);
    return span ? (span.start + span.end) / 2 : null;
  });
}

// ---------------------------------------------------------------- cohort
//
// What became of the particles that made up one cluster.
//
// The bands above answer "how big was this cluster at each frame", which is not
// the same question as "where did its particles go". A cluster can hold a steady
// forty particles all run and have exchanged every one of them; the band would
// not flinch. So selecting a cluster switches to its cohort: the particles it
// held at that moment, followed individually, and grouped at every later frame
// by the cluster each of them is in *now*.
//
// The total height is then constant — it is the cohort, and the cohort does not
// change size — and what moves is how it is divided. A cohort that stays
// together is one solid block; one that disperses fans out into the colours of
// wherever its particles went.

/** The particles a lineage holds in a frame. */
export function cohortOf(column, lineages) {
  const cohort = [];
  for (let i = 0; i < column.length; i++) {
    if (lineages.has(column[i])) cohort.push(i);
  }
  return cohort;
}

/**
 * Where a cohort's particles are at each frame, stacked as fractions of it.
 *
 * Noise is a destination like any other and goes last, because "left every
 * cluster" is one of the fates worth seeing and dropping it would silently
 * shrink the cohort instead.
 */
export function cohortFrames(columns, cohort, order) {
  const rank = new Map(order.map((lineage, i) => [lineage, i]));
  const size = Math.max(1, cohort.length);

  return columns.map((column) => {
    const counts = new Map();
    for (const particle of cohort) {
      const lineage = column[particle] ?? NOISE;
      counts.set(lineage, (counts.get(lineage) ?? 0) + 1);
    }
    const destinations = [...counts.keys()].sort((a, b) => {
      if (a === NOISE) return 1;
      if (b === NOISE) return -1;
      return (rank.get(a) ?? order.length) - (rank.get(b) ?? order.length) || a - b;
    });

    const spans = new Map();
    let offset = 0;
    for (const lineage of destinations) {
      const count = counts.get(lineage);
      spans.set(lineage, {
        start: offset / size,
        end: (offset + count) / size,
        size: count,
      });
      offset += count;
    }
    return spans;
  });
}

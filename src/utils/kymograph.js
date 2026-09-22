/**
 * A kymograph of a clustering: time across, particles down.
 *
 * Each column is one trajectory frame, each row one particle, and the colour of
 * a pixel says how large the cluster that particle belonged to in that frame
 * was. A cluster reads as a horizontal band, so it is immediately visible
 * whether one persists, grows, splits or dissolves — which is the question a
 * single frame cannot answer.
 *
 * **Rows are particles, not clusters, and that is deliberate.** A cluster's
 * index is an artefact of the order DBSCAN happened to walk the particles, so it
 * means something different in every frame; a row per cluster would draw a line
 * through unrelated things and call it a history. A particle index is stable, so
 * the picture is honest without needing to track cluster identity between
 * frames at all.
 *
 * **Colour encodes cluster identity, tracked between frames.** This is the one
 * place in the app that does not colour by size. Size is what the rest of the UI
 * uses because a cluster index is an artefact of the order DBSCAN walked the
 * particles — but over time that reasoning inverts: colouring by size means a
 * particle moving from one cluster to another of the same size changes nothing,
 * and watching a particle change clusters is the entire point of this view.
 *
 * So clusters are matched between consecutive frames by how many particles they
 * share, and the colour follows that lineage. A row changing colour is a
 * particle changing cluster; a band changing colour is a cluster being taken
 * over by another.
 */

/** Noise, and the pixels of a particle no cluster claimed. */
import { parseColorToHsl, hslToHex } from '../colors';

export const NOISE = 0;

// A kymograph is an image, and past these it stops being readable rather than
// merely large: rows thinner than a pixel cannot be told apart, and neither can
// columns. Both are sampled evenly rather than truncated, so the picture still
// spans the whole trajectory and the whole structure.
export const MAX_ROWS = 1600;
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
 * Row order: particles grouped by the cluster they were in at a reference frame.
 *
 * Without this the rows are in file order, which interleaves every cluster and
 * turns the picture into static. Grouping them makes a cluster a contiguous
 * band, which is the whole point — and it is what lets a single row be followed
 * across the picture as it leaves one band and joins another.
 *
 * Clusters are ordered largest first, so the big ones stay together when the
 * rows are sampled, and ties break on particle index so two runs agree.
 */
export function orderRows(lineageOf, particleCount) {
  const sizes = new Map();
  for (let i = 0; i < particleCount; i++) {
    const lineage = lineageOf[i];
    if (lineage !== NOISE) sizes.set(lineage, (sizes.get(lineage) ?? 0) + 1);
  }
  const rank = new Map(
    [...sizes.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([lineage], position) => [lineage, position]),
  );
  // Noise last: it is the absence of a cluster, not the smallest one.
  const rankOf = (particle) => rank.get(lineageOf[particle]) ?? sizes.size;

  return Array.from({ length: particleCount }, (_, i) => i)
    .sort((a, b) => rankOf(a) - rankOf(b) || a - b);
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

/**
 * A palette entry as RGB, whichever way it is spelled.
 *
 * The static schemes are `#rrggbb` and the golden-angle generator produces
 * `hsl(h,s%,l%)`; `parseColorToHsl` and `hslToHex` already exist for exactly
 * this, and writing a second parser here got every pixel wrong — `parseInt` on
 * an `hsl(...)` string is NaN, which painted the whole picture black.
 */
const toRgb = (color) => {
  const hsl = parseColorToHsl(color);
  const hex = hsl ? hslToHex(hsl.h, hsl.s, hsl.l) : '#000000';
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/**
 * Paints the image.
 *
 * @param columns   one Int32Array of per-particle lineage ids per frame drawn
 * @param rows      particle indices, in display order
 * @param palette   hex colours, indexed by size rank
 * @param emphasis  null, or the set of *lineages* to keep at full strength
 *                  while everything else is muted
 * @returns {{ data: Uint8ClampedArray, width: number, height: number }}
 */
export function paintKymograph({ columns, rows, palette, emphasis = null }) {
  const width = columns.length;
  const height = rows.length;
  const data = new Uint8ClampedArray(width * height * 4);
  const slots = lineageSlots(columns);
  // Cache the parsed palette: this loop runs once per pixel and parsing a hex
  // string per pixel is the kind of thing that makes a picture take a second.
  const rgb = palette.map(toRgb);

  for (let y = 0; y < height; y++) {
    const particle = rows[y];
    for (let x = 0; x < width; x++) {
      const lineage = columns[x][particle] ?? NOISE;
      // Muted per *pixel*, on the lineage, not per row on the particle.
      //
      // Emphasising the particles that were in the cluster at one frame cannot
      // follow the cluster: a particle that joins it later stays grey, and one
      // that leaves stays coloured, so the band drifts away from the thing that
      // was selected. Keyed on the lineage, the selected cluster keeps its
      // colour wherever it goes and a particle changes shade at the frame it
      // joins or leaves — which is what tracking a lineage means.
      const muted = emphasis !== null && !emphasis.has(lineage);
      const offset = (y * width + x) * 4;
      if (lineage === NOISE) {
        // Background, not a colour: noise is what did not cluster.
        data[offset] = 28; data[offset + 1] = 30; data[offset + 2] = 36;
        data[offset + 3] = muted ? 90 : 160;
        continue;
      }
      const [r, g, b] = rgb[(slots.get(lineage) ?? 0) % rgb.length];
      if (muted) {
        // Toward grey rather than transparent: a translucent band over a dark
        // panel still reads as a colour, just a wrong one.
        const grey = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 0.55;
        data[offset] = grey; data[offset + 1] = grey; data[offset + 2] = grey;
      } else {
        data[offset] = r; data[offset + 1] = g; data[offset + 2] = b;
      }
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

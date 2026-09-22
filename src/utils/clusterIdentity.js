/**
 * Which cluster is which, in a way that does not move.
 *
 * A cluster needs a colour that stays put: the same colour when you select it,
 * when you step a frame, and when a time view is computed. Three things had been
 * used for this and all three move.
 *
 * **Size rank moves constantly.** Colouring by how big a cluster is relative to
 * the others is right for a single frame and wrong across a trajectory, because
 * sizes change. Measured on two clusters of eight particles: two near-identical
 * reds at one frame, a green and a red a few frames later — the same two
 * clusters throughout.
 *
 * **Cluster index moves too.** DBSCAN renumbers from scratch every frame, so
 * index 0 is a different cluster from one frame to the next.
 *
 * **Two sources move worst of all.** Colouring by lineage where one was known
 * and falling back to size rank where it was not meant a cluster changed colour
 * the moment a time view was computed, and again whenever a lookup missed — a
 * cluster the pane drew near-black had a green band in the picture.
 *
 * So: rank clusters by their **lowest-numbered member**. It needs no history, no
 * current frame and no second opinion, so every part of the app computes the
 * same answer from membership alone and none of them can disagree. And it barely
 * moves: a cluster keeps its colour while it keeps its lowest-numbered particle,
 * which survives the growing, shrinking and exchange that size rank does not.
 */

import { lightnessLadder } from '../colors';

/** How many shades a wrapped palette entry is split into. */
const LIGHTNESS_STEPS = 5;

/**
 * The colour for a rank — the one function, so nothing can disagree.
 *
 * Past the end of the palette, clusters are separated by lightness instead of
 * hue, so a system with more clusters than colours still tells them apart.
 */
export function colourForRank(palette, rank) {
  const wrap = Math.floor(rank / palette.length);
  const base = palette[rank % palette.length];
  if (wrap === 0) return base;
  const rungs = Math.min(wrap + 1, LIGHTNESS_STEPS);
  return lightnessLadder(base, rungs)[wrap % rungs];
}

/** The lowest-numbered particle in a cluster — its anchor. */
export function anchorOf(cluster) {
  let lowest = Infinity;
  for (const particle of cluster) if (particle < lowest) lowest = particle;
  return lowest;
}

/**
 * Cluster index -> rank, ordered by anchor.
 *
 * The rank, not the anchor itself: indexing a twelve-colour palette by a
 * particle number gives five blobs of eight the colours 0, 8, 4, 0, 8 — two
 * collisions out of five. Ranking spreads them across the palette in order.
 */
export function anchorRanks(clusters) {
  return new Map(
    clusters
      .map((cluster, index) => ({ index, anchor: anchorOf(cluster) }))
      .sort((a, b) => a.anchor - b.anchor)
      .map(({ index }, rank) => [index, rank]),
  );
}

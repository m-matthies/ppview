import { lightnessLadder } from '../colors';

/**
 * Which cluster is which, in a way that does not move.
 *
 * A cluster needs a colour that stays put: the same colour when you select it,
 * when you step a frame, when a neighbouring cluster appears or dissolves, when
 * it gains or loses particles, and when a time view is computed. Five things
 * were tried and all five moved.
 *
 * **Size rank moves constantly.** Right for a single frame and wrong across a
 * trajectory, because sizes change: two clusters of eight particles measured as
 * two near-identical reds at one frame and a green and a red a few frames later.
 *
 * **Cluster index moves too** — DBSCAN renumbers from scratch every frame.
 *
 * **Two sources move worst of all.** Colouring by lineage where one was known
 * and falling back to size rank where it was not meant a cluster changed colour
 * the moment a time view was computed, and again whenever a lookup missed.
 *
 * **A rank over the current clusters still moves.** With anchors 0, 50 and 100
 * holding ranks 0, 1 and 2, a new cluster forming at anchor 25 pushes the other
 * two down a colour each, though neither changed at all.
 *
 * **And the anchor itself moves.** Registering the lowest-numbered member fixed
 * that, until the cluster lost that particular particle — which is exactly what
 * happens in the one fixture where a particle changes cluster.
 *
 * So identity is **overlap**: a cluster keeps the slot most of its particles
 * already had. It survives growth, shrinkage, exchange, renumbering and the loss
 * of any one member, and it is computed from membership alone — so the pane, the
 * scene and the time view all get the same answer without consulting each other,
 * which is the only way they cannot disagree.
 */

/** How many shades a wrapped palette entry is split into. */
const LIGHTNESS_STEPS = 5;

// Particle -> the slot of the cluster it was last seen in, and the next free
// slot. Deliberately outside React: it has to survive re-renders, outlive any
// one component and be shared by the pane and the time view, and it is reset
// explicitly when a different structure is loaded.
let slotOfParticle = new Map();
let nextSlot = 0;

/** A new structure means new particles; the old slots mean nothing. */
export function resetClusterIdentity() {
  slotOfParticle = new Map();
  nextSlot = 0;
}

/** For tests, and for anyone wondering how many distinct clusters were seen. */
export const clusterIdentityCount = () => nextSlot;

/**
 * The slot a cluster holds — the one that most of its particles already had.
 *
 * Overlap, not one nominated particle. Ranking by the lowest-numbered member was
 * the previous attempt and it moved: a cluster that loses that particular
 * particle is still the same cluster, and in the one fixture where a particle
 * changes cluster it is precisely the lowest-numbered one, so the cluster it
 * left changed colour at that frame.
 *
 * Every member is then registered to the slot, so the next frame finds it again
 * however the membership has churned — the cluster keeps its colour as long as
 * it keeps *any* of its particles, which is what makes it the same cluster at
 * all. A cluster sharing nothing with anything seen before is new, and takes the
 * next free slot.
 *
 * One known imprecision, left because the alternative is worse: when a cluster
 * splits, both halves carry the same history, so both keep the colour. Telling
 * them apart would mean deciding which half is the "real" continuation, and the
 * time view already shows a split for what it is.
 */
export function slotForCluster(cluster) {
  const counts = new Map();
  for (const particle of cluster) {
    const slot = slotOfParticle.get(particle);
    if (slot !== undefined) counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }

  let slot = -1;
  let best = 0;
  // Ties break on the lower slot so the result does not depend on Map order.
  for (const [candidate, count] of counts) {
    if (count > best || (count === best && candidate < slot)) {
      slot = candidate;
      best = count;
    }
  }
  if (slot === -1) slot = nextSlot++;

  for (const particle of cluster) slotOfParticle.set(particle, slot);
  return slot;
}

/**
 * The colour for a slot — the one function, so nothing can disagree.
 *
 * Always `#rrggbb`, including for the first palette-worth of clusters. The
 * palette's golden-angle generator produces `hsl(...)`, and a cluster swatch is
 * an `<input type="color">`, which accepts nothing else: handing it the raw
 * entry left every swatch black on any browser whose sanitiser is not Chrome's.
 *
 * Past the end of the palette, clusters are separated by lightness instead of
 * hue, so a system with more clusters than colours still tells them apart.
 */
export function colourForSlot(palette, slot) {
  const wrap = Math.floor(slot / palette.length);
  const base = palette[slot % palette.length];
  const rungs = Math.min(wrap + 1, LIGHTNESS_STEPS);
  // lightnessLadder always returns hex, and returns the entry untouched when
  // asked for a single rung.
  return lightnessLadder(base, rungs)[wrap % rungs];
}

/** A cluster's colour, from its membership and nothing else. */
export function colourForCluster(palette, cluster) {
  return colourForSlot(palette, slotForCluster(cluster));
}

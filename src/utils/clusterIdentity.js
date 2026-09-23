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

/**
 * A register of which cluster is which, over one sequence of frames.
 *
 * Not a global, because there can be more than one sequence in play: the pane
 * follows the frames someone scrubs through, while the time view walks the whole
 * trajectory in one go. Sharing a register between them meant computing a time
 * view rewrote the pane's — it ran every frame through the same state and left
 * it at the last one — so the scene's colours changed the moment the picture
 * finished.
 */
export function createIdentity() {
  let slotOfParticle = new Map();

  return {
    reset() {
      slotOfParticle = new Map();
    },

    /**
     * The slot for every cluster of one frame, claimed in one pass.
     *
     * A cluster keeps the slot most of its particles already had, so it survives
     * growth, shrinkage, exchange, renumbering and losing any one member. A
     * cluster sharing nothing with the frame before is new.
     *
     * **Slots are recycled.** They used to be handed out from a counter that
     * only went up, and over a trajectory clusters form and dissolve constantly:
     * the counter climbed, ran past the twelve-colour palette, and the lightness
     * variants cycle every five — so after about sixty distinct clusters the
     * colours began repeating exactly. That is colours breaking part-way through
     * playing a trajectory. Allocating the lowest free slot instead bounds them
     * by how many clusters are on screen at once, which is the most colours
     * anyone needs to tell apart.
     *
     * One imprecision remains, left because the alternative is worse: when a
     * cluster splits, both halves carry the same history, so both keep the
     * colour. Deciding which half is the real continuation is not something
     * membership can answer.
     */
    assign(clusters) {
      const claims = clusters.map((cluster, index) => {
        const counts = new Map();
        for (const particle of cluster) {
          const slot = slotOfParticle.get(particle);
          if (slot !== undefined) counts.set(slot, (counts.get(slot) ?? 0) + 1);
        }
        let slot = -1;
        let overlap = 0;
        // Ties break on the lower slot, so the result does not depend on the
        // order a Map happens to iterate in.
        for (const [candidate, count] of counts) {
          if (count > overlap || (count === overlap && candidate < slot)) {
            slot = candidate;
            overlap = count;
          }
        }
        return { index, slot, overlap };
      });

      // Strongest claim first, so the cluster that inherited most of a slot is
      // the one that keeps it.
      const order = [...claims].sort((a, b) => b.overlap - a.overlap || a.index - b.index);
      const result = new Array(clusters.length).fill(-1);
      const taken = new Set();
      for (const claim of order) {
        if (claim.overlap > 0 && !taken.has(claim.slot)) {
          taken.add(claim.slot);
          result[claim.index] = claim.slot;
        }
      }

      let candidate = 0;
      for (let index = 0; index < clusters.length; index++) {
        if (result[index] !== -1) continue;
        while (taken.has(candidate)) candidate++;
        taken.add(candidate);
        result[index] = candidate;
      }

      // Rebuilt, not added to: a particle that has left every cluster should
      // stop counting towards one, or a cluster could inherit a slot from
      // members it lost frames ago.
      slotOfParticle = new Map();
      clusters.forEach((cluster, index) => {
        for (const particle of cluster) slotOfParticle.set(particle, result[index]);
      });
      return result;
    },
  };
}

// The pane's register: the frames someone is actually looking at.
const paneIdentity = createIdentity();

/** A new structure means new particles; the old slots mean nothing. */
export const resetClusterIdentity = () => paneIdentity.reset();

/** Every cluster's slot for the frame on screen. */
export const assignSlots = (clusters) => paneIdentity.assign(clusters);

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

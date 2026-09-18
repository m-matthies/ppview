import * as THREE from 'three';

/**
 * How cluster highlighting looks, in one place.
 *
 * Every renderer that draws part of a patchy particle — the sphere, the
 * raspberry repulsion beads, the patch cones — has to agree on what a
 * highlighted or hidden particle looks like, or the same particle ends up
 * drawn three different ways. These constants and `getClusterAppearance` are
 * the shared rule; do not re-derive them per renderer.
 */

export const CLUSTER_HIGHLIGHT_SCALE = 1.3;

// "Show only selected clusters" hides everything else outright, which is what
// the control says it does. It used to shrink them to 0.3x and grey them, but
// the leftover ghosts were still visually noisy — worst of all for raspberry
// particles, where each one leaves a cluster of shrunken beads behind.
// Zero scale is the established way to hide an instance in this codebase.
export const CLUSTER_HIDDEN_SCALE = 0;

// The optional alternative: keep a small grey marker where an unselected
// cluster is, instead of removing it. Raspberry particles show this as their
// single central sphere rather than a swarm of shrunken beads.
export const CLUSTER_DIMMED_SCALE = 0.3;
export const CLUSTER_DIMMED_COLOR = new THREE.Color(0.35, 0.36, 0.38);

export const SELECTED_COLOR = new THREE.Color('yellow');

/**
 * Resolve one particle's colour and a scale *factor* to apply on top of
 * whatever size the renderer already uses. Returning a factor rather than an
 * absolute scale is what lets a sphere, a bead offset and a patch cone share
 * the rule despite having completely different base geometry.
 *
 * Precedence matches the order a user would expect: an explicit selection wins
 * over cluster state, and highlighting wins over hiding.
 */
export function getClusterAppearance({
  isSelected = false,
  isInHighlightedCluster = false,
  shouldShow = true,
  hasHighlightedClusters = false,
  showOnlyHighlightedClusters = false,
  dimNonSelectedClusters = false,
  baseColor,
  // Patches keep their patch-ID colour when their particle is selected —
  // turning them yellow would throw away the identity the colour encodes.
  allowSelectionColor = true,
}) {
  if (isSelected) {
    return { color: allowSelectionColor ? SELECTED_COLOR : baseColor, scaleFactor: 1 };
  }
  if (isInHighlightedCluster && hasHighlightedClusters) {
    return { color: baseColor, scaleFactor: CLUSTER_HIGHLIGHT_SCALE };
  }
  if (showOnlyHighlightedClusters && !shouldShow) {
    return dimNonSelectedClusters
      ? { color: CLUSTER_DIMMED_COLOR, scaleFactor: CLUSTER_DIMMED_SCALE, dimmed: true }
      : { color: baseColor, scaleFactor: CLUSTER_HIDDEN_SCALE, hidden: true };
  }
  return { color: baseColor, scaleFactor: 1 };
}

import { useMemo } from 'react';
import * as THREE from 'three';
import { useUIStore } from '../store/uiStore';
import { useClusteringStore } from '../store/clusteringStore';
import { useOverlayStore } from '../store/overlayStore';
import { overlayColorFor } from '../utils/overlays';
import { getClusterAppearance, clusterColorFor } from '../utils/clusterAppearance';

/**
 * One subscription path to how a particle should look.
 *
 * Five layers draw parts of the same particle — the sphere, the raspberry beads,
 * the patch cones, the springs, the four nucleotide meshes — and each assembled
 * the same seven arguments for `getClusterAppearance` from the same five store
 * fields. Nothing kept them in step, and they had already drifted twice: once
 * when raspberry particles ignored clustering entirely, and once when springs
 * were left out of the per-cluster eye control and hung in space after their
 * particles were hidden.
 *
 * `appearanceOf(index)` answers for one particle. A layer that draws something
 * spanning two — a spring — asks about both and draws only if neither is hidden.
 */
export default function useClusterVisuals() {
  const selectedParticles = useUIStore(state => state.selectedParticles);
  const highlightedClusters = useClusteringStore(state => state.highlightedClusters);
  const showOnlyHighlightedClusters = useClusteringStore(state => state.showOnlyHighlightedClusters);
  const dimNonSelectedClusters = useClusteringStore(state => state.dimNonSelectedClusters);
  const hiddenParticles = useClusteringStore(state => state.hiddenParticles);
  const clusterColors = useClusteringStore(state => state.clusterColors);
  // An active overlay replaces the base colour for the particles it covers.
  const overlayColors = useOverlayStore(state =>
    state.overlays.find(o => o.id === state.activeOverlayId)?.colors ?? null);

  // A Set, not the array. Layers asked `selectedParticles.includes(i)` once per
  // particle, which is a linear scan inside a loop over every particle.
  const selected = useMemo(() => new Set(selectedParticles), [selectedParticles]);

  return useMemo(() => {
    const hasHighlightedClusters = highlightedClusters.size > 0;

    /**
     * @param index    particle index, in trajectory order
     * @param baseColor          the layer's own colour for this particle, which
     *                           an overlay may replace
     * @param allowSelectionColor false where the colour already encodes
     *                           something — a patch's ID — and turning it yellow
     *                           would throw that away
     */
    return (index, { baseColor = null, allowSelectionColor = true } = {}) => {
      const isInHighlightedCluster = highlightedClusters.has(index);
      return getClusterAppearance({
        forceHidden: hiddenParticles.has(index),
        isSelected: selected.has(index),
        isInHighlightedCluster,
        shouldShow: !showOnlyHighlightedClusters || isInHighlightedCluster,
        hasHighlightedClusters,
        showOnlyHighlightedClusters,
        dimNonSelectedClusters,
        baseColor: overlayColorFor(overlayColors, index, THREE) ?? baseColor,
        clusterColor: clusterColorFor(clusterColors, index, THREE),
        allowSelectionColor,
      });
    };
  }, [selected, highlightedClusters, showOnlyHighlightedClusters, dimNonSelectedClusters,
      hiddenParticles, clusterColors, overlayColors]);
}

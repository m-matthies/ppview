import { useEffect, useMemo, useState } from 'react';
import { useParticleStore } from '../../store/particleStore';
import { useClusteringStore, isSceneRestricted } from '../../store/clusteringStore';
import { useUIStore } from '../../store/uiStore';
import { useOverlayStore } from '../../store/overlayStore';
import { dbscan, maxMinimumImageRadius } from '../../utils/clustering';

/**
 * Where the pane's clusters come from: DBSCAN, or a file.
 *
 * `clusterSourceId` is deliberately not the active overlay. Which cluster set
 * the pane works with and which one paints the scene are separate choices —
 * tying them together meant picking "Particle type" in the View also threw away
 * the grouping, leaving no way to cluster by a file while colouring by type.
 */

// One shared empty array: returning a fresh [] would give every downstream memo
// and effect a new identity on each render, which is the churn the gate below
// exists to avoid.
const NO_CLUSTERS = [];

export default function useClusterSource() {
  const positions = useParticleStore(state => state.positions);
  const currentBoxSize = useParticleStore(state => state.currentBoxSize);
  const showClusteringPane = useUIStore(state => state.showClusteringPane);
  const sceneIsRestricted = useClusteringStore(isSceneRestricted);
  const overlays = useOverlayStore(state => state.overlays);

  const [clusterSourceId, setClusterSourceId] = useState(null);   // null = DBSCAN
  const [epsilon, setEpsilon] = useState(2.0);
  const [minPoints, setMinPoints] = useState(3);

  // Only a cluster overlay has clusters to list; a scalar-property overlay
  // colours particles without any grouping to show here.
  const clusterOverlays = useMemo(
    () => overlays.filter(o => o.kind === 'clusters'),
    [overlays],
  );
  const clusterSource = clusterOverlays.find(o => o.id === clusterSourceId) || null;
  const fileClusters = clusterSource?.clusters ?? null;

  /**
   * Cluster only when something uses the result.
   *
   * This component is mounted for every structure, and `positions` gets a fresh
   * identity on every trajectory frame, so an ungated memo ran DBSCAN — O(n^2) —
   * once per frame for every user, including everyone who never opens the panel.
   * A file's clusters replace the computed ones outright, so they make it
   * unnecessary too. Selection alone changes nothing on screen unless something
   * is hidden, so it is not a reason to keep clustering either.
   */
  const clusteringIsInUse = !fileClusters && (showClusteringPane || sceneIsRestricted);

  const computedClusters = useMemo(() => {
    if (!clusteringIsInUse || !positions?.length) return NO_CLUSTERS;
    try {
      // Distances are measured under periodic boundaries: a cluster straddling a
      // box wall is one cluster, not two. dbscan caps epsilon itself, so a value
      // saved from a larger box cannot produce nonsense here.
      return dbscan(positions, epsilon, minPoints, currentBoxSize);
    } catch (error) {
      console.error('Could not compute clusters:', error);
      return NO_CLUSTERS;
    }
  }, [clusteringIsInUse, positions, epsilon, minPoints, currentBoxSize]);

  // A loaded file replaces the computed clusters while it is present, so the
  // rest of the pane does not need to care where they came from.
  const clusters = useMemo(
    () => (fileClusters ? fileClusters.map(c => c.indices) : computedClusters),
    [fileClusters, computedClusters],
  );

  /**
   * Drop selection and visibility entries that no longer name a cluster.
   *
   * Both are cluster *indices*, and DBSCAN renumbers everything when epsilon or
   * minPoints move. Selecting clusters 7-9 of ten and then widening epsilon to
   * three left three indices pointing at nothing: the publication effect found
   * no members for any of them and published an empty highlighted set with
   * "show only selected" still on, so every particle was hidden and the viewport
   * went blank. Worse, isSceneRestricted compares `selectedClusters.size <
   * clusterCount` — 3 < 3 is false — so the "Show all particles" button that
   * would undo it was not rendered either.
   */
  useEffect(() => {
    const count = clusters.length;
    const { selectedClusters, hiddenClusters } = useClusteringStore.getState();
    const inRange = (set) => new Set([...set].filter(index => index < count));

    const prunedSelection = inRange(selectedClusters);
    if (prunedSelection.size !== selectedClusters.size) {
      useClusteringStore.getState().setSelectedClusters(prunedSelection);
    }
    const prunedHidden = inRange(hiddenClusters);
    if (prunedHidden.size !== hiddenClusters.size) {
      useClusteringStore.getState().setHiddenClusters(prunedHidden);
    }
  }, [clusters]);

  // Past half the shortest box dimension the minimum image convention stops
  // being meaningful, so the slider does not offer it.
  const epsilonLimit = useMemo(() => maxMinimumImageRadius(currentBoxSize), [currentBoxSize]);

  return {
    clusters,
    clusterSource,
    clusterSourceId,
    setClusterSourceId,
    clusterOverlays,
    fileClusters,
    epsilon,
    setEpsilon,
    epsilonLimit,
    minPoints,
    setMinPoints,
  };
}

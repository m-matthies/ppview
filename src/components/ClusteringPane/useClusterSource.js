import { useEffect, useMemo, useState } from 'react';
import { useParticleStore } from '../../store/particleStore';
import { useClusteringStore, isSceneRestricted } from '../../store/clusteringStore';
import { loadWasmCore } from '../../wasm/wasmCore';
import { useUIStore } from '../../store/uiStore';
import { useOverlayStore } from '../../store/overlayStore';
import { dbscan, maxMinimumImageRadius, withinSizeRange } from '../../utils/clustering';

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

// Long enough for the browser to commit the message and paint it, short enough
// that nobody waits on it for a small structure that clusters instantly.
const PAINT_DELAY_MS = 32;
// Below a few thousand particles DBSCAN finishes inside a frame or two.
const ANNOUNCE_CLUSTERING_ABOVE = 2000;

export default function useClusterSource() {
  const positions = useParticleStore(state => state.positions);
  const currentBoxSize = useParticleStore(state => state.currentBoxSize);
  const showClusteringPane = useUIStore(state => state.showClusteringPane);
  const sceneIsRestricted = useClusteringStore(isSceneRestricted);
  const overlays = useOverlayStore(state => state.overlays);
  const setBusyMessage = useUIStore(state => state.setBusyMessage);

  const [clusterSourceId, setClusterSourceId] = useState(null);   // null = DBSCAN
  const [epsilon, setEpsilon] = useState(2.0);
  const [minPoints, setMinPoints] = useState(3);
  // A band, not a floor: [1, Infinity] keeps everything, which is the default.
  const [minClusterSize, setMinClusterSize] = useState(1);
  const [maxClusterSize, setMaxClusterSize] = useState(Infinity);

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

  /**
   * Clustering runs after a paint, not during render.
   *
   * DBSCAN is O(n^2) and blocks the main thread for as long as it takes: 2.4s at
   * 4,000 particles, 15s at 10,000, 60s at 20,000. Computed in a `useMemo` it ran
   * inside the render that was supposed to announce it, so the window froze with
   * no explanation — and no message could ever have appeared, because nothing
   * gets painted between a state change and the work it triggers.
   *
   * Announcing it therefore means yielding first: set the message, let the
   * browser paint, then block. The delay is a timeout rather than
   * `requestAnimationFrame`, which never fires in a background tab — clustering
   * that silently stops happening when the tab is hidden would be a far worse
   * bug than the one this fixes.
   */
  const [computedClusters, setComputedClusters] = useState(NO_CLUSTERS);

  useEffect(() => {
    if (!clusteringIsInUse || !positions?.length) {
      setComputedClusters(NO_CLUSTERS);
      return undefined;
    }

    // Only worth announcing when it will actually be noticed; below this the
    // work finishes within a frame or two and a flashing message is just noise.
    const announce = positions.length >= ANNOUNCE_CLUSTERING_ABOVE;
    if (announce) {
      setBusyMessage(`Clustering ${positions.length.toLocaleString()} particles — this can take a while`);
    }

    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      // There is no JavaScript clustering to fall back to any more, so the core
      // has to be there before the first frame is clustered — which can happen
      // before the module has finished loading.
      await loadWasmCore();
      if (cancelled) return;
      try {
        // Distances are measured under periodic boundaries: a cluster straddling
        // a box wall is one cluster, not two. dbscan caps epsilon itself, so a
        // value saved from a larger box cannot produce nonsense here.
        setComputedClusters(dbscan(positions, epsilon, minPoints, currentBoxSize));
      } catch (error) {
        console.error('Could not compute clusters:', error);
        setComputedClusters(NO_CLUSTERS);
      } finally {
        if (announce) setBusyMessage(null);
      }
    }, PAINT_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
      if (announce) setBusyMessage(null);
    };
  }, [clusteringIsInUse, positions, epsilon, minPoints, currentBoxSize, setBusyMessage]);

  /**
   * Clusters too small to care about, dropped — *after* clustering, not during.
   *
   * Raising "neighbours needed" looks like it should do this and does something
   * quite different: it is a density threshold, so it stops particles being
   * core points, and a cluster that was held together through a thin waist comes
   * apart. Reported as DBSCAN failing, and it is not — but "set the minimum size
   * larger and clusters that were joined fall apart" is a reasonable thing to be
   * confused by, because nothing in the control said the two were different
   * questions.
   *
   * This is the other question, asked separately: cluster first, then keep the
   * ones whose size falls in a band. Moving either end can never break a cluster
   * apart, because the clustering has already happened.
   *
   * A band rather than a floor because "everything above N" is only half of what
   * gets asked — isolating the mid-sized clusters, or looking at just the
   * stragglers, needs an upper end too.
   */
  /** The largest cluster there is, which is where the upper bound starts. */
  const largestCluster = useMemo(
    () => computedClusters.reduce((most, c) => Math.max(most, c.length), 0),
    [computedClusters],
  );

  const keptClusters = useMemo(
    () => withinSizeRange(computedClusters, minClusterSize, maxClusterSize),
    [computedClusters, minClusterSize, maxClusterSize],
  );

  // A loaded file replaces the computed clusters while it is present, so the
  // rest of the pane does not need to care where they came from.
  const clusters = useMemo(
    () => (fileClusters ? fileClusters.map(c => c.indices) : keptClusters),
    [fileClusters, keptClusters],
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
    minClusterSize,
    setMinClusterSize,
    maxClusterSize,
    setMaxClusterSize,
    largestCluster,
  };
}

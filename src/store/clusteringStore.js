import { create } from 'zustand';

/**
 * True when the clustering is doing something to the scene.
 *
 * One definition shared by the pane's reset button and the control bar's, so the
 * two can never disagree about whether there is anything to undo.
 *
 * Selection alone does not count: with "show only selected" off it changes
 * nothing on screen, and offering to undo an invisible state is noise. Once that
 * box is ticked it always counts — either some particles are hidden, or the rest
 * are drawn enlarged in cluster colours, and both are states worth an escape
 * hatch.
 *
 * This briefly compared selected clusters against the cluster count, to avoid
 * offering a reset when a cluster file covers every particle. That was wrong
 * twice over: DBSCAN leaves noise particles in no cluster, so "everything
 * selected" still hides them; and even when nothing is hidden the scene is
 * visibly clustered — highlighted at 1.3x in cluster colours — so there is
 * plainly something to undo. Pressing Select all took both reset buttons off
 * screen.
 */
export const isSceneRestricted = (state) =>
  state.hiddenParticles.size > 0 || state.showOnlyHighlightedClusters;

export const useClusteringStore = create((set) => ({
  // Particle indices belonging to a highlighted cluster.
  highlightedClusters: new Set(),
  showOnlyHighlightedClusters: false,
  // Off by default: unselected clusters are hidden outright. Turning this on
  // leaves a faint grey marker where each one is, which is useful for keeping
  // your bearings in a dense system.
  dimNonSelectedClusters: false,

  // particleIndex -> '#rrggbb' for particles in a highlighted cluster.
  //
  // Stored per particle rather than per cluster because that is how the
  // renderers consume it: each one walks its instances and needs the colour for
  // a given particle without knowing which cluster it came from.
  clusterColors: new Map(),

  // Particles belonging to a cluster switched off in the pane. Independent of
  // selection: hiding a cluster works whether or not "show only selected" is on.
  hiddenParticles: new Set(),

  // How many clusters the pane currently has, computed or from a file.
  //
  // The View control needs this to know whether "Computed clusters" is a real
  // choice. It used to appear only once a cluster *file* was registered, so a
  // DBSCAN run could never be switched to particle-type colours — the one
  // combination the pane's own grouping/colouring split exists to offer.
  // It outlives the pane deliberately: closing the pane leaves the clustering
  // applied to the scene, so the control that explains it has to stay too.
  clusterCount: 0,

  // The pane's own controls, held here rather than in the component.
  //
  // They used to be `useState` inside ClusteringPane, which is unmounted when
  // the pane is closed — so closing it destroyed the state *and* the effect that
  // publishes it, leaving the scene clustered with nothing listening. Switching
  // the View then did nothing, and the one control that could undo it went with
  // the pane. Cluster indices, meaningful only against the current cluster list,
  // so they reset whenever that list is replaced.
  selectedClusters: new Set(),
  showOnlySelected: false,
  hiddenClusters: new Set(),

  /**
   * True while **Select all** is in force, as opposed to a selection that
   * happens to cover everything.
   *
   * Needed because a cluster/bond observable states a different number of
   * clusters at every frame — 240 at the start of the run this was built for
   * and 581 at the end. Remembering only the indices meant "select all" pressed
   * at one frame quietly became "the first 240 of 581" at another, and the
   * prune that keeps indices in range could never put them back.
   *
   * A mode rather than something inferred from `selectedClusters.size ===
   * clusters.length`: ticking every one of 240 boxes by hand is a choice of
   * those 240, and should not silently grow into 581.
   */
  allClustersSelected: false,

  /**
   * Which cluster set the pane works with: null for DBSCAN, otherwise the id of
   * a cluster overlay.
   *
   * In the store rather than in the pane because a second consumer needs it:
   * bonds from a cluster/bond observable are drawn for whichever observable is
   * the source, and `Bonds` cannot reach a hook's `useState`. It is also the
   * answer to "which cluster set is in use", which outlives the panel for the
   * same reason the rest of this state does.
   */
  clusterSourceId: null,

  // Actions
  setHighlightedClusters: (clusters) => set({ highlightedClusters: clusters }),
  setShowOnlyHighlightedClusters: (show) => set({ showOnlyHighlightedClusters: show }),
  setDimNonSelectedClusters: (dim) => set({ dimNonSelectedClusters: dim }),
  setHiddenParticles: (particles) => set({ hiddenParticles: particles }),
  setClusterCount: (count) => set({ clusterCount: count }),
  // Any explicit selection is a selection of *those* clusters, so it leaves
  // "select all" behind. The one path that must not is the refill below, which
  // goes through selectAllClusters.
  setSelectedClusters: (clusters) => set({
    selectedClusters: clusters,
    allClustersSelected: false,
  }),

  /** Select every cluster, and keep selecting every cluster as they change. */
  selectAllClusters: (count) => set({
    selectedClusters: new Set(Array.from({ length: count }, (_, i) => i)),
    allClustersSelected: true,
  }),
  setShowOnlySelected: (show) => set({ showOnlySelected: show }),
  setHiddenClusters: (clusters) => set({ hiddenClusters: clusters }),
  setClusterSourceId: (id) => set({ clusterSourceId: id }),

  // The clustering half of clearing the scene. The View also has to be pointed
  // away from a cluster overlay, which is a second store's business — see
  // store/commands.js, which owns the combined action.
  resetClusterState: () => set({
    selectedClusters: new Set(),
    allClustersSelected: false,
    showOnlySelected: false,
    hiddenClusters: new Set(),
    highlightedClusters: new Set(),
    showOnlyHighlightedClusters: false,
    clusterColors: new Map(),
    hiddenParticles: new Set(),
  }),

  // Combined action for cluster highlighting
  highlightClusters: (clusterIndices, showOnlySelected, clusterColors = new Map()) => set({
    highlightedClusters: clusterIndices,
    showOnlyHighlightedClusters: showOnlySelected,
    clusterColors,
  }),


  // Dropping a new simulation must also drop clusters computed for the old one.
  resetClusters: () => set({
    clusterSourceId: null,
    highlightedClusters: new Set(),
    showOnlyHighlightedClusters: false,
    clusterColors: new Map(),
    hiddenParticles: new Set(),
    clusterCount: 0,
    selectedClusters: new Set(),
    allClustersSelected: false,
    showOnlySelected: false,
    hiddenClusters: new Set(),
  }),
}));

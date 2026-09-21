import { create } from 'zustand';
import { useOverlayStore } from './overlayStore';

/**
 * True when the clustering is currently holding something back from the scene.
 *
 * One definition shared by the pane's own reset button and the control bar's,
 * so the two can never disagree about whether there is anything to undo.
 * Selection alone does not count: without "show only selected" it changes
 * nothing on screen, and offering to undo an invisible state is noise.
 */
export const isSceneRestricted = (state) =>
  state.showOnlySelected || state.hiddenClusters.size > 0;

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

  // Actions
  setHighlightedClusters: (clusters) => set({ highlightedClusters: clusters }),
  setShowOnlyHighlightedClusters: (show) => set({ showOnlyHighlightedClusters: show }),
  setDimNonSelectedClusters: (dim) => set({ dimNonSelectedClusters: dim }),
  setHiddenParticles: (particles) => set({ hiddenParticles: particles }),
  setClusterCount: (count) => set({ clusterCount: count }),
  setSelectedClusters: (clusters) => set({ selectedClusters: clusters }),
  setShowOnlySelected: (show) => set({ showOnlySelected: show }),
  setHiddenClusters: (clusters) => set({ hiddenClusters: clusters }),

  // Everything the clustering does to the scene, undone at once. Reachable from
  // the control bar as well as the pane, because the effect it undoes is visible
  // whether or not the pane is open.
  clearClustering: () => {
    // Also point the View away from any cluster set. A cluster file supplies the
    // particles' *base* colour, so clearing the selection alone left every
    // particle still painted by its cluster after a button that says otherwise.
    useOverlayStore.getState().setActiveOverlay(null);
    set({
    selectedClusters: new Set(),
    showOnlySelected: false,
    hiddenClusters: new Set(),
    highlightedClusters: new Set(),
    showOnlyHighlightedClusters: false,
    clusterColors: new Map(),
    hiddenParticles: new Set(),
    });
  },

  // Combined action for cluster highlighting
  highlightClusters: (clusterIndices, showOnlySelected, clusterColors = new Map()) => set({
    highlightedClusters: clusterIndices,
    showOnlyHighlightedClusters: showOnlySelected,
    clusterColors,
  }),

  // Clear highlighting
  clearHighlighting: () => set({
    highlightedClusters: new Set(),
    showOnlyHighlightedClusters: false,
    clusterColors: new Map(),
    hiddenParticles: new Set(),
    selectedClusters: new Set(),
    showOnlySelected: false,
    hiddenClusters: new Set(),
  }),

  // Dropping a new simulation must also drop clusters computed for the old one.
  resetClusters: () => set({
    highlightedClusters: new Set(),
    showOnlyHighlightedClusters: false,
    clusterColors: new Map(),
    hiddenParticles: new Set(),
    clusterCount: 0,
    selectedClusters: new Set(),
    showOnlySelected: false,
    hiddenClusters: new Set(),
  }),
}));

import { create } from 'zustand';

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

  // Actions
  setHighlightedClusters: (clusters) => set({ highlightedClusters: clusters }),
  setShowOnlyHighlightedClusters: (show) => set({ showOnlyHighlightedClusters: show }),
  setDimNonSelectedClusters: (dim) => set({ dimNonSelectedClusters: dim }),
  setHiddenParticles: (particles) => set({ hiddenParticles: particles }),
  setClusterCount: (count) => set({ clusterCount: count }),

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
  }),

  // Dropping a new simulation must also drop clusters computed for the old one.
  resetClusters: () => set({
    highlightedClusters: new Set(),
    showOnlyHighlightedClusters: false,
    clusterColors: new Map(),
    hiddenParticles: new Set(),
    clusterCount: 0,
  }),
}));

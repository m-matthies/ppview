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

  // Clusters loaded from a file, which replace the computed ones while present.
  fileClusters: null,

  // Actions
  setHighlightedClusters: (clusters) => set({ highlightedClusters: clusters }),
  setShowOnlyHighlightedClusters: (show) => set({ showOnlyHighlightedClusters: show }),
  setDimNonSelectedClusters: (dim) => set({ dimNonSelectedClusters: dim }),
  setFileClusters: (clusters) => set({ fileClusters: clusters }),

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
  }),

  // Dropping a new simulation must also drop clusters computed for the old one.
  resetClusters: () => set({
    highlightedClusters: new Set(),
    showOnlyHighlightedClusters: false,
    clusterColors: new Map(),
    fileClusters: null,
  }),
}));

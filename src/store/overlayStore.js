import { create } from 'zustand';

/**
 * Registered overlays: named, per-particle sources of colour.
 *
 * The default view colours particles by type, from the active colour scheme. An
 * overlay replaces that base colour for the particles it covers — cluster
 * membership today, and per-particle scalar properties later, which is why this
 * is a general `colors` map rather than anything cluster-specific.
 *
 * Several can be registered at once, by dropping more files onto a loaded
 * scene; exactly one is active, or none for the plain colour scheme.
 */
let nextOverlayId = 1;

/**
 * The pane's own DBSCAN output, as a view. It is not an overlay — it has no
 * colour map, because the pane paints its clusters itself — but naming it here
 * lets the View control describe every possibility, so "which thing is
 * colouring the scene" always has an answer.
 */
export const COMPUTED_VIEW = 'computed';

export const useOverlayStore = create((set, get) => ({
  overlays: [],
  // Defaults to the computed clusters, which is what the pane coloured by
  // before overlays existed.
  activeOverlayId: COMPUTED_VIEW,

  addOverlay: (overlay) => {
    const id = `overlay-${nextOverlayId++}`;
    const entry = { id, ...overlay };
    // A freshly dropped overlay becomes the active view: dropping a file and
    // seeing nothing change would read as the drop having failed.
    set(state => ({ overlays: [...state.overlays, entry], activeOverlayId: id }));
    return entry;
  },

  removeOverlay: (id) => set(state => ({
    overlays: state.overlays.filter(o => o.id !== id),
    activeOverlayId: state.activeOverlayId === id ? COMPUTED_VIEW : state.activeOverlayId,
  })),

  setActiveOverlay: (id) => set({ activeOverlayId: id }),

  // A new simulation invalidates every overlay: they are keyed by particle index.
  clearOverlays: () => set({ overlays: [], activeOverlayId: COMPUTED_VIEW }),

  getActiveOverlay: () => {
    const { overlays, activeOverlayId } = get();
    return overlays.find(o => o.id === activeOverlayId) || null;
  },
}));

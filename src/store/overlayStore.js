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

export const useOverlayStore = create((set, get) => ({
  overlays: [],
  activeOverlayId: null,

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
    activeOverlayId: state.activeOverlayId === id ? null : state.activeOverlayId,
  })),

  setActiveOverlay: (id) => set({ activeOverlayId: id }),

  // A new simulation invalidates every overlay: they are keyed by particle index.
  clearOverlays: () => set({ overlays: [], activeOverlayId: null }),

  getActiveOverlay: () => {
    const { overlays, activeOverlayId } = get();
    return overlays.find(o => o.id === activeOverlayId) || null;
  },
}));

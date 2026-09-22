import { create } from 'zustand';
import { getCurrentColorScheme } from '../colors';
import {
  getCurrentLightingPreset,
  getLightingSettings,
  saveLightingSettings,
  saveLightingPreset,
  getSceneBackground,
  saveSceneBackground,
  isDarkBackground,
  lightingPresets,
  DEFAULT_LIGHTING_PRESET,
  DEFAULT_BACKGROUND,
  LIGHT_BACKGROUND,
  DARK_BACKGROUND,
} from '../lighting';

export const useUIStore = create((set) => ({
  // Legend visibility
  showPatchLegend: false,
  showParticleLegend: false,
  
  // 3D scene toggles
  showSimulationBox: false,
  showBackdropPlanes: true,
  showCoordinateAxis: true,
  showStats: false,
  
  // UI visibility
  isControlsVisible: true,
  showClusteringPane: false,
  
  // File loading state
  filesDropped: false,
  isLoading: false,
  /**
   * What the app is busy doing, or null.
   *
   * Anything that blocks for long enough to look like a hang says so here. The
   * full-screen loading cover uses it as its caption while a scene is coming up,
   * and `BusyIndicator` shows it as a small panel the rest of the time — work on
   * an already-loaded scene should not hide the scene it is working on.
   */
  busyMessage: null,

  /**
   * Which layers are currently drawing impostors, by layer id.
   *
   * Reported by the renderers rather than worked out by the indicator, because
   * each one decides for itself and on a different count: `Particles` on the
   * particle count, `RepulsionSites` on the *bead* count — several per particle,
   * so a system under the threshold by particles can be over it by spheres.
   * Guessing from the particle count alone would be wrong for exactly the format
   * that draws the most.
   */
  impostorLayers: {},
  
  // Selection state
  selectedParticles: [],
  
  // Scene reference
  sceneRef: null,
  
  // Iframe and drag-drop
  isIframeMode: false,
  isDragDropEnabled: true,
  
  // Color scheme
  currentColorScheme: getCurrentColorScheme(),
  
  // Lighting preset and settings
  currentLightingPreset: getCurrentLightingPreset(),
  lightingSettings: getLightingSettings(),
  isLightingControlsModalOpen: false,

  // Scene background. Kept out of the presets on purpose — a preset is the light
  // rig, the background is a separate viewing choice.
  sceneBackground: getSceneBackground(),
  
  // Playback state
  isPlaying: false,
  playbackSpeed: 500,
  isSpeedPopupVisible: false,
  
  // Sphere geometry quality
  sphereSegments: 16,

  // Actions
  setShowPatchLegend: (show) => set({ showPatchLegend: show }),
  setShowParticleLegend: (show) => set({ showParticleLegend: show }),
  setShowSimulationBox: (show) => set({ showSimulationBox: show }),
  setShowBackdropPlanes: (show) => set({ showBackdropPlanes: show }),
  setShowCoordinateAxis: (show) => set({ showCoordinateAxis: show }),
  setShowStats: (show) => set({ showStats: show }),
  setIsControlsVisible: (visible) => set({ isControlsVisible: visible }),
  setShowClusteringPane: (show) => set({ showClusteringPane: show }),
  setFilesDropped: (dropped) => set({ filesDropped: dropped }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  // A no-op when the message is unchanged: this is written from effects and
  // from loops that report progress, and every renderer subscribing to the
  // store would otherwise re-render on a repeated write.
  // Written from renderer effects, so a repeated report must not re-render.
  setImpostorLayer: (id, active) => set((state) => {
    const current = !!state.impostorLayers[id];
    if (current === active) return state;
    const next = { ...state.impostorLayers };
    if (active) next[id] = true; else delete next[id];
    return { impostorLayers: next };
  }),

  setBusyMessage: (message) => set((state) => (
    state.busyMessage === message ? state : { busyMessage: message }
  )),
  setSelectedParticles: (particles) => set({ selectedParticles: particles }),
  setSceneRef: (ref) => set({ sceneRef: ref }),
  setIsIframeMode: (isIframe) => set({ isIframeMode: isIframe }),
  setIsDragDropEnabled: (enabled) => set({ isDragDropEnabled: enabled }),
  setCurrentColorScheme: (scheme) => set({ currentColorScheme: scheme }),
  setCurrentLightingPreset: (preset) => set({ currentLightingPreset: preset }),
  setLightingSettings: (settings) => {
    saveLightingSettings(settings);
    set({ lightingSettings: settings });
  },
  setIsLightingControlsModalOpen: (open) => set({ isLightingControlsModalOpen: open }),
  setSceneBackground: (color) => {
    saveSceneBackground(color);
    set({ sceneBackground: color });
  },
  // Flips between the two stock backgrounds. Which one is "current" is derived
  // from the colour's own luminance, so there is no second flag to fall out of
  // step with a background picked from the colour well.
  toggleSceneBackground: () => set((state) => {
    const next = isDarkBackground(state.sceneBackground) ? LIGHT_BACKGROUND : DARK_BACKGROUND;
    saveSceneBackground(next);
    return { sceneBackground: next };
  }),
  resetLighting: () => {
    const preset = lightingPresets[DEFAULT_LIGHTING_PRESET];
    saveLightingPreset(DEFAULT_LIGHTING_PRESET);
    saveLightingSettings(preset);
    saveSceneBackground(DEFAULT_BACKGROUND);
    set({
      currentLightingPreset: DEFAULT_LIGHTING_PRESET,
      lightingSettings: preset,
      sceneBackground: DEFAULT_BACKGROUND,
    });
  },
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  setIsSpeedPopupVisible: (visible) => set({ isSpeedPopupVisible: visible }),
  setSphereSegments: (segments) => set({ sphereSegments: segments }),
}));

/**
 * True when any layer is drawing impostors.
 *
 * One definition, exported, for the same reason `isSceneRestricted` is: two
 * copies of "is the scene impostored" would eventually disagree.
 */
export const usesImpostors = (state) => Object.keys(state.impostorLayers).length > 0;

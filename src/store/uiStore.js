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

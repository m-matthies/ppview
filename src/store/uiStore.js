import { create } from 'zustand';
import { getCurrentColorScheme } from '../colors';
import { getCurrentLightingPreset, getLightingSettings, saveLightingSettings } from '../lighting';

export const useUIStore = create((set) => ({
  // Legend visibility
  showPatchLegend: false,
  showParticleLegend: false,
  
  // 3D scene toggles
  showSimulationBox: false,
  showBackdropPlanes: false,
  showCoordinateAxis: true,
  
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
  
  // Playback state
  isPlaying: false,
  playbackSpeed: 500,
  isSpeedPopupVisible: false,
  
  // Pathtracer state
  isPathtracerEnabled: false,
  isPathtracerConfigModalOpen: false,
  pathtracerConfig: {
    samples: 500,
    minSamples: 5,
    bounces: 5,
    tiles: 1,
    denoise: true,
    filterGlossyThreshold: 0.5,
    resolutionScale: 1.0,
    enableMIS: true,
    transparentBackground: false,
  },
  pathtracerSamples: 0,
  pathtracerReset: 0, // Increment to trigger reset

  // Sphere geometry quality
  sphereSegments: 16,

  // Actions
  setShowPatchLegend: (show) => set({ showPatchLegend: show }),
  setShowParticleLegend: (show) => set({ showParticleLegend: show }),
  setShowSimulationBox: (show) => set({ showSimulationBox: show }),
  setShowBackdropPlanes: (show) => set({ showBackdropPlanes: show }),
  setShowCoordinateAxis: (show) => set({ showCoordinateAxis: show }),
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
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  setIsSpeedPopupVisible: (visible) => set({ isSpeedPopupVisible: visible }),
  setIsPathtracerEnabled: (enabled) => set({ isPathtracerEnabled: enabled }),
  setIsPathtracerConfigModalOpen: (open) => set({ isPathtracerConfigModalOpen: open }),
  setPathtracerConfig: (config) => set({ pathtracerConfig: config }),
  setPathtracerSamples: (samples) => set({ pathtracerSamples: samples }),
  resetPathtracer: () => set((state) => ({ pathtracerReset: state.pathtracerReset + 1, pathtracerSamples: 0 })),
  setSphereSegments: (segments) => set({ sphereSegments: segments }),
}));

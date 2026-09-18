// Lighting configuration for PPView.
//
// This is a data viewer: particle, patch and base colours carry meaning, so the
// rig is built to report them faithfully rather than to flatter them. Every
// light is neutral white — a warm fill or a cool rim would shift every colour in
// the scene and make two particle types read as more similar, or more
// different, than they are. Depth comes from occlusion and from the direction of
// the key light, not from colour temperature.

export const lightingPresets = {
  depth: {
    name: 'Depth',
    description: 'Flat light, heavy occlusion. Separates crowded assemblies.',
    ambientIntensity: 0.75,
    hemisphereIntensity: 0.45,
    hemisphereSkyColor: '#ffffff',
    hemisphereGroundColor: '#cdd1d7',
    keyLightIntensity: 0.5,
    keyLightPosition: [16, 24, 14],
    fillLightIntensity: 0.4,
    fillLightPosition: [-14, 10, -10],
    rimLightIntensity: 0.15,
    rimLightPosition: [-8, 5, -12],
    bottomFillIntensity: 0.35,
    environmentIntensity: 0.25,
    ssaoEnabled: true,
    ssaoIntensity: 26,
  },

  publication: {
    name: 'Publication',
    description: 'Even neutral light and strong occlusion. Colours read true.',
    // Ambient and hemisphere
    ambientIntensity: 0.55,
    hemisphereIntensity: 0.35,
    hemisphereSkyColor: '#ffffff',
    hemisphereGroundColor: '#d8dbe0',
    // Directional lights
    keyLightIntensity: 0.95,
    keyLightPosition: [18, 26, 16],
    fillLightIntensity: 0.45,
    fillLightPosition: [-16, 10, -10],
    rimLightIntensity: 0.25,
    rimLightPosition: [-8, 6, -14],
    bottomFillIntensity: 0.2,
    // Environment
    environmentIntensity: 0.35,
    // Contact shading
    ssaoEnabled: true,
    ssaoIntensity: 14,
  },

  studio: {
    name: 'Studio',
    description: 'Balanced key and fill with soft shadows. Good all-rounder.',
    ambientIntensity: 0.35,
    hemisphereIntensity: 0.3,
    hemisphereSkyColor: '#ffffff',
    hemisphereGroundColor: '#c8ccd2',
    keyLightIntensity: 1.15,
    keyLightPosition: [20, 25, 15],
    fillLightIntensity: 0.4,
    fillLightPosition: [-15, 10, -10],
    rimLightIntensity: 0.3,
    rimLightPosition: [-8, 5, -12],
    bottomFillIntensity: 0.15,
    environmentIntensity: 0.4,
    ssaoEnabled: true,
    ssaoIntensity: 12,
  },

  relief: {
    name: 'Relief',
    description: 'Hard directional light. Picks out surface shape and patches.',
    ambientIntensity: 0.18,
    hemisphereIntensity: 0.15,
    hemisphereSkyColor: '#ffffff',
    hemisphereGroundColor: '#9aa0a8',
    keyLightIntensity: 1.9,
    keyLightPosition: [30, 38, 20],
    fillLightIntensity: 0.2,
    fillLightPosition: [-20, 10, -15],
    rimLightIntensity: 0.5,
    rimLightPosition: [-10, 8, -15],
    bottomFillIntensity: 0.08,
    environmentIntensity: 0.2,
    ssaoEnabled: true,
    ssaoIntensity: 18,
  },

  flat: {
    name: 'Flat',
    description: 'No occlusion or relief. Fastest, and the most literal colour.',
    ambientIntensity: 0.85,
    hemisphereIntensity: 0.5,
    hemisphereSkyColor: '#ffffff',
    hemisphereGroundColor: '#dfe2e6',
    keyLightIntensity: 0.6,
    keyLightPosition: [20, 25, 15],
    fillLightIntensity: 0.5,
    fillLightPosition: [-15, 10, -10],
    rimLightIntensity: 0.3,
    rimLightPosition: [-8, 5, -12],
    bottomFillIntensity: 0.4,
    environmentIntensity: 0.5,
    ssaoEnabled: false,
    ssaoIntensity: 0,
  },
};

export const DEFAULT_LIGHTING_PRESET = 'depth';
const DEFAULT_PRESET = DEFAULT_LIGHTING_PRESET;

// Background is deliberately NOT part of a preset. A preset describes the light
// rig; the background is a separate viewing choice, and folding it in would mean
// the preset chip lied every time the background was toggled.
export const LIGHT_BACKGROUND = '#f2f4f7';
export const DARK_BACKGROUND = '#15171c';
export const DEFAULT_BACKGROUND = LIGHT_BACKGROUND;

// Storage keys are versioned: the v1 rig used tinted lights and a dark scene, so
// a blob saved under it would otherwise keep overriding the new defaults.
const STORAGE_KEY = 'ppview_lighting_preset_v2';
const SETTINGS_STORAGE_KEY = 'ppview_lighting_settings_v2';
const BACKGROUND_STORAGE_KEY = 'ppview_scene_background';

// Relative luminance, used to decide whether a background counts as dark. Lets
// the scene adapt without a second "is dark" flag that could drift out of sync
// with the colour itself.
export const isDarkBackground = (hex) => {
  const value = String(hex || '').replace('#', '');
  if (value.length !== 6) return false;
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 0.4;
};

// Get current lighting preset from localStorage or default
export const getCurrentLightingPreset = () => {
  try {
    const savedPreset = localStorage.getItem(STORAGE_KEY);
    if (savedPreset && (lightingPresets[savedPreset] || savedPreset === 'custom')) {
      return savedPreset;
    }
  } catch (error) {
    console.warn('Failed to load lighting preset from localStorage:', error);
  }
  return DEFAULT_PRESET;
};

// Save lighting preset to localStorage
export const saveLightingPreset = (presetName) => {
  try {
    localStorage.setItem(STORAGE_KEY, presetName);
    return true;
  } catch (error) {
    console.warn('Failed to save lighting preset to localStorage:', error);
  }
  return false;
};

// Get lighting settings from localStorage
export const getLightingSettings = () => {
  const fallback = lightingPresets[DEFAULT_PRESET];
  try {
    const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (savedSettings) {
      // Merge over the default so settings added after this blob was written
      // still have a value. A missing intensity reads as an unlit scene.
      return { ...fallback, ...JSON.parse(savedSettings) };
    }
  } catch (error) {
    console.warn('Failed to load lighting settings from localStorage:', error);
  }
  return fallback;
};

// Save lighting settings to localStorage
export const saveLightingSettings = (settings) => {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch (error) {
    console.warn('Failed to save lighting settings to localStorage:', error);
  }
  return false;
};

export const getSceneBackground = () => {
  try {
    const saved = localStorage.getItem(BACKGROUND_STORAGE_KEY);
    if (saved && /^#[0-9a-f]{6}$/i.test(saved)) return saved;
  } catch (error) {
    console.warn('Failed to load scene background from localStorage:', error);
  }
  return DEFAULT_BACKGROUND;
};

export const saveSceneBackground = (color) => {
  try {
    localStorage.setItem(BACKGROUND_STORAGE_KEY, color);
    return true;
  } catch (error) {
    console.warn('Failed to save scene background to localStorage:', error);
  }
  return false;
};

// Get lighting configuration for a preset
export const getLightingConfig = (presetName = null) => {
  const preset = presetName || getCurrentLightingPreset();
  return lightingPresets[preset] || lightingPresets[DEFAULT_PRESET];
};

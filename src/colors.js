// src/colors.js

// Define multiple color schemes
export const colorSchemes = {
  muted: {
    name: 'Muted Colors',
    colors: [
      '#8B0000', // Dark Red
      '#2F4F4F', // Dark Slate Gray
      '#556B2F', // Dark Olive Green
      '#9932CC', // Dark Orchid
      '#8B008B', // Dark Magenta
      '#FF4500', // Orange Red
      '#00CED1', // Dark Turquoise
      '#9400D3', // Dark Violet
      '#FF1493', // Deep Pink
      '#1E90FF', // Dodger Blue
    ]
  },
  bright: {
    name: 'Bright Colors',
    colors: [
      '#FF0000', // Red
      '#00FF00', // Green
      '#0000FF', // Blue
      '#FFFF00', // Yellow
      '#FF00FF', // Magenta
      '#00FFFF', // Cyan
      '#FFA500', // Orange
      '#800080', // Purple
      '#FFC0CB', // Pink
      '#A52A2A', // Brown
    ]
  },
  pastel: {
    name: 'Pastel Colors',
    colors: [
      '#FFB3BA', // Light Pink
      '#FFDFBA', // Light Orange
      '#FFFFBA', // Light Yellow
      '#BAFFC9', // Light Green
      '#BAE1FF', // Light Blue
      '#E1BAFF', // Light Purple
      '#FFBAE1', // Light Magenta
      '#C9FFBA', // Light Lime
      '#FFBAC9', // Light Rose
      '#BAD7FF', // Light Sky Blue
    ]
  },
  scientific: {
    name: 'Scientific Palette',
    colors: [
      '#1f77b4', // Blue
      '#ff7f0e', // Orange
      '#2ca02c', // Green
      '#d62728', // Red
      '#9467bd', // Purple
      '#8c564b', // Brown
      '#e377c2', // Pink
      '#7f7f7f', // Gray
      '#bcbd22', // Olive
      '#17becf', // Cyan
    ]
  },
  colorblind: {
    name: 'Colorblind Friendly',
    colors: [
      '#000000', // Black
      '#E69F00', // Orange
      '#56B4E9', // Sky Blue
      '#009E73', // Bluish Green
      '#F0E442', // Yellow
      '#0072B2', // Blue
      '#D55E00', // Vermillion
      '#CC79A7', // Reddish Purple
      '#999999', // Gray
      '#FFFFFF', // White
    ]
  },
  viridis: {
    name: 'Viridis',
    colors: [
      '#440154', // Dark Purple
      '#482777', // Purple
      '#3f4a8a', // Blue Purple
      '#31678e', // Blue
      '#26838f', // Teal
      '#1f9d8a', // Green Teal
      '#6cce5a', // Green
      '#b6de2b', // Yellow Green
      '#fee825', // Yellow
      '#f9fb0e', // Bright Yellow
    ]
  },
//
//   function colorFromInt(number) {
//    const hue = number * 137.508; // use golden angle approximation
//    return new THREE.Color(`hsl(${hue},50%,65%)`);
// }
  oxview: {
    name: 'oxView Golden Angle',
    // Use golden angle formula for distinct colors
    generateColor: (number) => {
      //let cnumber = number + 0
      const hue = (number) * 137.508; // use golden angle approximation
      return `hsl(${hue},50%,65%)`//hslToHex(hue, 50, 65);
    },
    colors: [] // Will be populated dynamically
  }
};

// Default scheme
const DEFAULT_SCHEME = 'oxview';
const STORAGE_KEY = 'ppview_color_scheme';

// Get current color scheme from localStorage or default
export const getCurrentColorScheme = () => {
  try {
    const savedScheme = localStorage.getItem(STORAGE_KEY);
    if (savedScheme && colorSchemes[savedScheme]) {
      return savedScheme;
    }
  } catch (error) {
    console.warn('Failed to load color scheme from localStorage:', error);
  }
  return DEFAULT_SCHEME;
};

// Save color scheme to localStorage
export const saveColorScheme = (schemeName) => {
  try {
    if (colorSchemes[schemeName]) {
      localStorage.setItem(STORAGE_KEY, schemeName);
      return true;
    }
  } catch (error) {
    console.warn('Failed to save color scheme to localStorage:', error);
  }
  return false;
};

// Get colors for current scheme with optional count parameter
export const getParticleColors = (schemeName = null, particleTypeCount = null) => {
  const scheme = schemeName || getCurrentColorScheme();
  const colorScheme = colorSchemes[scheme] || colorSchemes[DEFAULT_SCHEME];
  
  // Handle dynamic color generation (like oxview golden angle)
  if (colorScheme.generateColor && typeof colorScheme.generateColor === 'function') {
    // For dynamic schemes, use the actual number of particle types if provided
    // Otherwise fall back to a reasonable default
    const numColors = particleTypeCount || 50;
    const generatedColors = [];
    for (let i = 0; i < numColors; i++) {
      generatedColors.push(colorScheme.generateColor(i));
    }
    return generatedColors;
  }
  
  // For static color schemes, return the colors array
  return colorScheme.colors;
};

// Backward compatibility - this will use the current selected scheme
export const mutedParticleColors = getParticleColors();


// Palette entries come in two spellings: '#rrggbb' from the static schemes and
// 'hsl(h,s%,l%)' from the golden-angle generator. Anything deriving a colour
// from the palette has to read both, and must hand back '#rrggbb' — an
// <input type="color"> accepts nothing else.
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const HSL_COLOR = /^hsl\(\s*(-?[\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Wrapping unconditionally costs precision for no reason: ((137.508 % 360) +
// 360) % 360 comes back as 137.50800000000004.
const normaliseHue = (h) => (h >= 0 && h < 360 ? h : ((h % 360) + 360) % 360);

/** Parse a palette entry to `{h: 0-360, s: 0-100, l: 0-100}`, or null. */
export const parseColorToHsl = (color) => {
  if (typeof color !== 'string') return null;
  const text = color.trim();

  const hsl = text.match(HSL_COLOR);
  if (hsl) {
    return {
      h: normaliseHue(Number(hsl[1])),
      s: clamp(Number(hsl[2]), 0, 100),
      l: clamp(Number(hsl[3]), 0, 100),
    };
  }

  const hex = text.match(HEX_COLOR);
  if (!hex) return null;
  const digits = hex[1].length === 3
    ? hex[1].split('').map(d => d + d).join('')
    : hex[1];
  const r = parseInt(digits.slice(0, 2), 16) / 255;
  const g = parseInt(digits.slice(2, 4), 16) / 255;
  const b = parseInt(digits.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
};

export const hslToHex = (h, s, l) => {
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n) => {
    const value = light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * value).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
};

/**
 * `count` evenly spaced shades of `color`, for telling apart things that share
 * whatever the hue encodes.
 *
 * The window is centred on the colour where there is room, and **slid** to fit
 * where there is not. Clamping each shade individually instead collapses them:
 * a pastel base at lightness 86.5 sent three of five shades to the same 84, and
 * a black palette entry sent all five to the same grey — turning the feature
 * off precisely for the schemes that needed it, while the default golden-angle
 * palette at lightness 65 stayed clear of the edge and looked fine.
 *
 * The bounds stretch to include the colour's own lightness, so a shade is never
 * moved away from a colour that already sits outside them. With count 1 that
 * makes this exact: the single shade is the input colour, which matters because
 * the histogram bar beside it is painted with the raw palette entry.
 */
export const lightnessLadder = (color, count, step = 7.5, low = 30, high = 84) => {
  const hsl = parseColorToHsl(color);
  if (!hsl) return Array.from({ length: Math.max(1, count) }, () => color);

  const rungs = Math.max(1, count);
  const toHex = (l) => hslToHex(hsl.h, hsl.s, l);
  if (rungs === 1) return [toHex(hsl.l)];

  const floor = Math.min(low, hsl.l);
  const ceiling = Math.max(high, hsl.l);
  const span = (rungs - 1) * step;
  let start = hsl.l - span / 2;
  if (span <= ceiling - floor) start = clamp(start, floor, ceiling - span);

  return Array.from({ length: rungs }, (_, i) => toHex(clamp(start + i * step, floor, ceiling)));
};

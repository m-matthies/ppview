import { parseColorToHsl, hslToHex, shiftLightness } from './colors';

describe('parseColorToHsl', () => {
  // Both spellings occur in the palettes: the static schemes are hex, the
  // golden-angle generator emits hsl() strings.
  it('reads the hsl() strings the golden-angle scheme produces', () => {
    expect(parseColorToHsl('hsl(137.508,50%,65%)')).toEqual({
      h: 137.508, s: 50, l: 65,
    });
  });

  it('reads six- and three-digit hex', () => {
    expect(parseColorToHsl('#ff0000')).toEqual({ h: 0, s: 100, l: 50 });
    expect(parseColorToHsl('#f00')).toEqual({ h: 0, s: 100, l: 50 });
  });

  it('reads grey without inventing a hue', () => {
    expect(parseColorToHsl('#808080')).toEqual({ h: 0, s: 0, l: 50.19607843137255 });
  });

  it('normalises a negative or over-large hue', () => {
    expect(parseColorToHsl('hsl(-60,50%,65%)').h).toBe(300);
    expect(parseColorToHsl('hsl(420,50%,65%)').h).toBe(60);
  });

  it('returns null for anything it cannot read', () => {
    expect(parseColorToHsl('rebeccapurple')).toBeNull();
    expect(parseColorToHsl('')).toBeNull();
    expect(parseColorToHsl(undefined)).toBeNull();
  });
});

describe('hslToHex', () => {
  it('round-trips the primaries', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
  });

  it('round-trips through parseColorToHsl', () => {
    const { h, s, l } = parseColorToHsl('#4a90d9');
    expect(hslToHex(h, s, l)).toBe('#4a90d9');
  });
});

describe('shiftLightness', () => {
  it('always returns hex, whatever spelling it was given', () => {
    // An <input type="color"> accepts nothing else, and the swatch in the
    // clustering pane is one.
    expect(shiftLightness('hsl(0,50%,65%)', 0)).toMatch(/^#[0-9a-f]{6}$/);
    expect(shiftLightness('#d27979', 0)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps hue and saturation, moving only lightness', () => {
    const base = parseColorToHsl('hsl(200,50%,60%)');
    const lighter = parseColorToHsl(shiftLightness('hsl(200,50%,60%)', 15));
    expect(lighter.h).toBeCloseTo(base.h, 0);
    expect(lighter.s).toBeCloseTo(base.s, 0);
    expect(lighter.l).toBeGreaterThan(base.l + 10);
  });

  it('darkens as well as lightens', () => {
    const darker = parseColorToHsl(shiftLightness('hsl(200,50%,60%)', -15));
    expect(darker.l).toBeLessThan(50);
  });

  it('clamps short of black and white, where hue would be lost', () => {
    // A cluster pushed to pure white or black stops carrying the size it
    // encodes, which is the whole point of the colour.
    expect(parseColorToHsl(shiftLightness('hsl(200,50%,60%)', 500)).l).toBeLessThanOrEqual(84.5);
    expect(parseColorToHsl(shiftLightness('hsl(200,50%,60%)', -500)).l).toBeGreaterThanOrEqual(29.5);
  });

  it('gives back anything it cannot parse, rather than a broken colour', () => {
    expect(shiftLightness('rebeccapurple', 10)).toBe('rebeccapurple');
  });

  it('separates five clusters of one size into five distinct shades', () => {
    // The exact arrangement the pane applies: steps of 7.5 points centred on
    // the base colour, cycling every five.
    const shades = [0, 1, 2, 3, 4].map(ordinal =>
      shiftLightness('hsl(137.5,50%,65%)', ((ordinal % 5) - 2) * 7.5));
    expect(new Set(shades).size).toBe(5);
    const lightnesses = shades.map(s => parseColorToHsl(s).l);
    // Monotonic, so the shades read as an ordered set rather than noise.
    expect([...lightnesses].sort((a, b) => a - b)).toEqual(lightnesses);
    // ...and all still clearly the same hue. Tolerance because a round trip
    // through 8-bit hex moves the hue by about a degree, which no one can see.
    shades.forEach(s => expect(Math.abs(parseColorToHsl(s).h - 137.5)).toBeLessThan(2));
  });
});

import { colorSchemes, getParticleColors, parseColorToHsl, hslToHex, lightnessLadder } from './colors';

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

describe('lightnessLadder', () => {
  it('always returns hex, whatever spelling it was given', () => {
    // An <input type="color"> accepts nothing else, and the swatch in the
    // clustering pane is one.
    expect(lightnessLadder('hsl(0,50%,65%)', 1)[0]).toMatch(/^#[0-9a-f]{6}$/);
    expect(lightnessLadder('#d27979', 3).every(c => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
  });

  it('gives a single rung the colour itself, unchanged', () => {
    // The histogram bar beside it is painted with the raw palette entry, so any
    // drift here breaks the legend. Black and white are the cases that a clamp
    // on the result silently altered.
    expect(lightnessLadder('#000000', 1)).toEqual(['#000000']);
    expect(lightnessLadder('#ffffff', 1)).toEqual(['#ffffff']);
    expect(lightnessLadder('#d27979', 1)).toEqual(['#d27979']);
  });

  it('centres the ladder on the colour when there is room', () => {
    const rungs = lightnessLadder('hsl(200,50%,60%)', 5).map(c => parseColorToHsl(c).l);
    // 45 / 52.5 / 60 / 67.5 / 75, give or take what 8-bit hex can represent.
    [45, 52.5, 60, 67.5, 75].forEach((want, i) => {
      expect(Math.abs(rungs[i] - want)).toBeLessThan(0.5);
    });
  });

  it('keeps hue and saturation across every rung', () => {
    const rungs = lightnessLadder('hsl(200,50%,60%)', 5).map(parseColorToHsl);
    rungs.forEach(({ h, s }) => {
      expect(Math.abs(h - 200)).toBeLessThan(2);   // 8-bit hex moves hue ~1 degree
      expect(Math.abs(s - 50)).toBeLessThan(3);
    });
  });

  it('slides rather than squashing when the colour sits near an end', () => {
    // Clamping each rung instead sent three of five pastel shades to the same
    // value, and all five shades of a black entry to one grey — switching the
    // feature off for exactly the schemes that needed it most.
    for (const color of ['#000000', '#ffffff', '#ffb3ba']) {
      const rungs = lightnessLadder(color, 5);
      expect(new Set(rungs).size).toBe(5);
    }
  });

  it('never moves a lone colour that already sits outside the band', () => {
    expect(lightnessLadder('#000000', 1)[0]).toBe('#000000');
    const rungs = lightnessLadder('#000000', 5).map(c => parseColorToHsl(c).l);
    expect(Math.min(...rungs)).toBeGreaterThanOrEqual(0);
    expect(rungs[0]).toBeCloseTo(0, 1);            // anchored at the colour itself
  });

  it('gives every scheme five distinguishable shades for every palette entry', () => {
    // The sweep that would have caught the clamp bug: the visual suite only
    // exercises the default golden-angle palette, whose lightness of 65 sits
    // clear of both ends and so never collapsed.
    for (const name of Object.keys(colorSchemes)) {
      for (const entry of getParticleColors(name, 12)) {
        const rungs = lightnessLadder(entry, 5);
        expect(new Set(rungs).size).toBe(5);
      }
    }
  });

  it('hands back the input unchanged when it cannot parse the colour', () => {
    expect(lightnessLadder('rebeccapurple', 3)).toEqual(
      ['rebeccapurple', 'rebeccapurple', 'rebeccapurple']);
  });
});

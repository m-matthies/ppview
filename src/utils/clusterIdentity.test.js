import {
  slotForCluster, colourForSlot, colourForCluster,
  resetClusterIdentity, clusterIdentityCount,
} from './clusterIdentity';

const HEX = /^#[0-9a-f]{6}$/i;

beforeEach(resetClusterIdentity);

describe('slotForCluster', () => {
  test('gives a new cluster the next free slot', () => {
    expect(slotForCluster([0, 1])).toBe(0);
    expect(slotForCluster([8, 9])).toBe(1);
  });

  test('and recognises it again however it has been renumbered', () => {
    const a = slotForCluster([0, 1]);
    const b = slotForCluster([8, 9]);
    expect(slotForCluster([8, 9])).toBe(b);
    expect(slotForCluster([0, 1])).toBe(a);
  });

  // The failure of every earlier attempt, each in turn.
  test('survives the cluster growing and shrinking', () => {
    const slot = slotForCluster([0, 1, 2]);
    expect(slotForCluster([0, 1, 2, 3, 4])).toBe(slot);
    expect(slotForCluster([0, 1])).toBe(slot);
  });

  test('survives losing its lowest-numbered particle', () => {
    const slot = slotForCluster([0, 1, 2]);
    expect(slotForCluster([1, 2])).toBe(slot);
  });

  test('is not moved by another cluster appearing between others', () => {
    const first = slotForCluster([0, 1]);
    const second = slotForCluster([100, 101]);
    slotForCluster([50, 51]);
    expect(slotForCluster([0, 1])).toBe(first);
    expect(slotForCluster([100, 101])).toBe(second);
  });

  test('a cluster sharing nothing with the past is a new one', () => {
    slotForCluster([0, 1]);
    expect(slotForCluster([90, 91])).toBe(1);
  });

  test('takes the slot most of its particles had, not just any of them', () => {
    const big = slotForCluster([0, 1, 2, 3]);
    slotForCluster([9]);
    // Four from `big` and one stray: it is still `big`.
    expect(slotForCluster([0, 1, 2, 3, 9])).toBe(big);
  });

  test('a new structure starts over', () => {
    slotForCluster([0, 1]);
    resetClusterIdentity();
    expect(clusterIdentityCount()).toBe(0);
    expect(slotForCluster([500])).toBe(0);
  });
});

describe('colourForSlot', () => {
  // The palette's golden-angle generator produces hsl(), and a cluster swatch
  // is an <input type="color">, which accepts nothing but #rrggbb — handing it
  // the raw entry left every swatch black outside Chrome.
  test('is always hex, even for the first palette-worth of clusters', () => {
    const palette = ['hsl(137.508,50%,65%)', 'hsl(0,50%,65%)'];
    expect(colourForSlot(palette, 0)).toMatch(HEX);
    expect(colourForSlot(palette, 1)).toMatch(HEX);
  });

  test('and for a hex palette too', () => {
    expect(colourForSlot(['#123456'], 0)).toMatch(HEX);
  });

  test('separates clusters past the end of the palette by lightness', () => {
    const palette = ['#808080', '#404040'];
    expect(colourForSlot(palette, 0)).not.toBe(colourForSlot(palette, 2));
  });
});

describe('colourForCluster', () => {
  const palette = ['hsl(137.508,50%,65%)', 'hsl(0,50%,65%)', '#123456'];

  test('gives two clusters two colours', () => {
    expect(colourForCluster(palette, [0])).not.toBe(colourForCluster(palette, [9]));
  });

  test('and keeps one cluster the same colour as it changes', () => {
    const before = colourForCluster(palette, [0, 1, 2]);
    colourForCluster(palette, [50, 51]);
    expect(colourForCluster(palette, [1, 2, 3])).toBe(before);
  });
});

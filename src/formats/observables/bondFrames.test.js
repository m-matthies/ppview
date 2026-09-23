import { dedupeBonds, connectedComponents, makeFrame, colourFrames } from './bondFrames';

describe('dedupeBonds', () => {
  test('a bond reported from both ends becomes one bond carrying both patch ids', () => {
    const bonds = dedupeBonds([
      { from: 0, fromPatch: 2, to: 1, toPatch: -1 },
      { from: 1, fromPatch: 5, to: 0, toPatch: -1 },
    ]);
    expect(bonds).toEqual([{ a: 0, b: 1, patchA: 2, patchB: 5 }]);
  });

  test('two particles bonded on several patches draw one bond, not several', () => {
    const bonds = dedupeBonds([
      { from: 0, fromPatch: 1, to: 1, toPatch: -1 },
      { from: 0, fromPatch: 3, to: 1, toPatch: -1 },
    ]);
    expect(bonds).toHaveLength(1);
    expect(bonds[0].patchA).toBe(1);
  });

  test('a self-bond is dropped rather than drawn as a degenerate cylinder', () => {
    expect(dedupeBonds([{ from: 4, fromPatch: 0, to: 4, toPatch: 1 }])).toEqual([]);
  });

  test('bonds come back in a stable order whatever order they were found in', () => {
    const key = b => `${b.a}-${b.b}`;
    const forwards = dedupeBonds([
      { from: 3, fromPatch: -1, to: 4, toPatch: -1 },
      { from: 0, fromPatch: -1, to: 2, toPatch: -1 },
      { from: 0, fromPatch: -1, to: 1, toPatch: -1 },
    ]).map(key);
    expect(forwards).toEqual(['0-1', '0-2', '3-4']);
  });
});

describe('connectedComponents', () => {
  test('bonds that share a particle are one cluster', () => {
    expect(connectedComponents([
      { a: 0, b: 1 }, { a: 1, b: 2 },
    ])).toEqual([[0, 1, 2]]);
  });

  test('bond groups that share nothing are separate clusters', () => {
    expect(connectedComponents([
      { a: 5, b: 6 }, { a: 0, b: 1 },
    ])).toEqual([[0, 1], [5, 6]]);
  });

  test('a particle in no bond is in no cluster', () => {
    const clusters = connectedComponents([{ a: 0, b: 1 }]);
    expect(clusters.flat()).not.toContain(9);
  });
});

describe('makeFrame', () => {
  test('packs bonds into parallel typed arrays', () => {
    const frame = makeFrame([{ a: 0, b: 1, patchA: 2, patchB: 3 }], [[0, 1]]);
    expect(Array.from(frame.a)).toEqual([0]);
    expect(Array.from(frame.b)).toEqual([1]);
    expect(Array.from(frame.patchA)).toEqual([2]);
    expect(Array.from(frame.patchB)).toEqual([3]);
    expect(frame.clusters).toEqual([[0, 1]]);
  });

  test('a frame with no bonds is empty rather than absent', () => {
    const frame = makeFrame([], []);
    expect(frame.a).toHaveLength(0);
    expect(frame.clusters).toEqual([]);
  });
});

describe('colourFrames', () => {
  const palette = ['#111111', '#222222', '#333333'];

  test('a cluster that keeps most of its particles keeps its colour', () => {
    const frames = [
      makeFrame([], [[0, 1, 2], [7, 8, 9]]),
      // The clusters have swapped places in the list, and one lost a member.
      makeFrame([], [[7, 8, 9], [0, 1]]),
    ];
    const colours = colourFrames(frames, palette);
    expect(colours[1][1]).toBe(colours[0][0]);
    expect(colours[1][0]).toBe(colours[0][1]);
  });

  test('clusters present at the same time get different colours', () => {
    const colours = colourFrames([makeFrame([], [[0, 1], [2, 3]])], palette);
    expect(colours[0][0]).not.toBe(colours[0][1]);
  });

  test('colours are #rrggbb, because a cluster swatch is an input type=color', () => {
    const colours = colourFrames([makeFrame([], [[0, 1]])], palette);
    expect(colours[0][0]).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

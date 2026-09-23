import {
  assignSlots, resetClusterIdentity, createIdentity, colourForSlot,
} from './clusterIdentity';

const HEX = /^#[0-9a-f]{6}$/i;

beforeEach(resetClusterIdentity);

describe('assignSlots', () => {
  test('gives each cluster of the first frame its own slot, in order', () => {
    expect(assignSlots([[0, 1], [8, 9], [16, 17]])).toEqual([0, 1, 2]);
  });

  test('and recognises them again however DBSCAN renumbered them', () => {
    assignSlots([[0, 1], [8, 9]]);
    expect(assignSlots([[8, 9], [0, 1]])).toEqual([1, 0]);
  });

  // Each of these broke an earlier attempt.
  test('survives a cluster growing and shrinking', () => {
    const [slot] = assignSlots([[0, 1, 2]]);
    expect(assignSlots([[0, 1, 2, 3, 4]])).toEqual([slot]);
    expect(assignSlots([[0, 1]])).toEqual([slot]);
  });

  test('survives losing its lowest-numbered particle', () => {
    const [slot] = assignSlots([[0, 1, 2]]);
    expect(assignSlots([[1, 2]])).toEqual([slot]);
  });

  test('is not moved by another cluster appearing beside it', () => {
    const [a, b] = assignSlots([[0, 1], [100, 101]]);
    const next = assignSlots([[0, 1], [50, 51], [100, 101]]);
    expect(next[0]).toBe(a);
    expect(next[2]).toBe(b);
  });

  test('never gives two clusters of one frame the same slot', () => {
    const slots = assignSlots([[0, 1, 2, 3], [8, 9]]);
    // Both halves of a split share a history; they must still be told apart.
    const after = assignSlots([[0, 1], [2, 3], [8, 9]]);
    expect(new Set(after).size).toBe(3);
    expect(slots.length).toBe(2);
  });

  /**
   * The bug this recycling exists for: slots used to come from a counter that
   * only went up. Over a trajectory clusters form and dissolve constantly, so it
   * climbed past the twelve-colour palette, and the lightness variants cycle
   * every five — after about sixty distinct clusters the colours repeated
   * exactly, part-way through playing a trajectory.
   */
  test('reuses the slot of a cluster that has gone, however long the run', () => {
    let highest = 0;
    for (let frame = 0; frame < 500; frame++) {
      // Two lasting clusters, and a third that is different every frame.
      const slots = assignSlots([
        [0, 1, 2],
        [8, 9, 10],
        [100 + frame * 3, 101 + frame * 3],
      ]);
      highest = Math.max(highest, ...slots);
    }
    expect(highest).toBeLessThan(3);
  });

  test('and the two that last keep their slots throughout', () => {
    const first = assignSlots([[0, 1, 2], [8, 9, 10]]);
    let last = first;
    for (let frame = 0; frame < 200; frame++) {
      last = assignSlots([[0, 1, 2], [8, 9, 10], [500 + frame, 501 + frame]]);
    }
    expect(last.slice(0, 2)).toEqual(first);
  });

  test('a particle that left every cluster stops counting towards one', () => {
    assignSlots([[0, 1, 2]]);
    assignSlots([[5, 6, 7]]);          // the first cluster is gone
    // A new cluster of the original particles is new, not a continuation.
    expect(assignSlots([[5, 6, 7], [0, 1, 2]])).toEqual([0, 1]);
  });
});

describe('registers are separate', () => {
  // The time view walks the whole trajectory; the pane follows the frames
  // someone scrubs. Sharing one register meant computing the picture rewrote
  // the scene's colours the moment it finished.
  test('one does not disturb the other', () => {
    const before = assignSlots([[0, 1], [8, 9]]);
    const elsewhere = createIdentity();
    for (let frame = 0; frame < 50; frame++) {
      elsewhere.assign([[frame * 4, frame * 4 + 1], [frame * 4 + 2, frame * 4 + 3]]);
    }
    expect(assignSlots([[0, 1], [8, 9]])).toEqual(before);
  });
});

describe('colourForSlot', () => {
  // The golden-angle generator produces hsl(), and a cluster swatch is an
  // <input type="color">, which accepts nothing but #rrggbb.
  test('is always hex', () => {
    expect(colourForSlot(['hsl(137.508,50%,65%)'], 0)).toMatch(HEX);
    expect(colourForSlot(['#123456'], 0)).toMatch(HEX);
  });

  test('separates clusters past the end of the palette by lightness', () => {
    const palette = ['#808080', '#404040'];
    expect(colourForSlot(palette, 0)).not.toBe(colourForSlot(palette, 2));
  });
});

import { anchorOf, anchorRanks } from './clusterIdentity';

describe('anchorOf', () => {
  test('is the lowest-numbered particle, whatever order they are in', () => {
    expect(anchorOf([7, 2, 9])).toBe(2);
  });
});

describe('anchorRanks', () => {
  test('ranks clusters by their anchor, not by their position in the list', () => {
    const ranks = anchorRanks([[9, 10], [0, 1], [4, 5]]);
    expect(ranks.get(1)).toBe(0);
    expect(ranks.get(2)).toBe(1);
    expect(ranks.get(0)).toBe(2);
  });

  // The whole point: size rank moves as clusters grow and shrink, and index
  // moves because DBSCAN renumbers every frame. This does neither.
  test('a cluster keeps its rank while it keeps its lowest member', () => {
    const before = anchorRanks([[0, 1, 2], [8, 9]]);
    const after = anchorRanks([[0, 1], [8, 9, 2]]);   // particle 2 moved over
    expect(after.get(0)).toBe(before.get(0));
    expect(after.get(1)).toBe(before.get(1));
  });

  test('and keeps it when the list is renumbered', () => {
    const before = anchorRanks([[0, 1], [8, 9]]);
    const renumbered = anchorRanks([[8, 9], [0, 1]]);
    expect(renumbered.get(1)).toBe(before.get(0));
    expect(renumbered.get(0)).toBe(before.get(1));
  });

  // Ranking rather than using the anchor directly: five blobs of eight would
  // otherwise land on palette entries 0, 8, 4, 0, 8.
  test('spreads clusters across the palette instead of colliding', () => {
    const blobs = [0, 8, 16, 24, 32].map(start =>
      Array.from({ length: 8 }, (_, i) => start + i));
    expect([...anchorRanks(blobs).values()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
});

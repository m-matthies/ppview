import { dbscan, generateHistogram, maxMinimumImageRadius } from './clustering';

const BOX = [20, 20, 20];

/** Sort clusters into a comparable shape: members ascending, clusters by first member. */
const normalise = (clusters) =>
  clusters.map(c => [...c].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);

describe('dbscan periodic boundaries', () => {
  // Four particles in a tight knot either side of the x wall: two just inside
  // 0, two just inside 20. In the simulation they are ~1.0 apart across the
  // boundary; by raw coordinates they look 19 apart.
  const straddling = [
    { x: 0.2, y: 10, z: 10 },
    { x: 0.6, y: 10, z: 10 },
    { x: 19.6, y: 10, z: 10 },
    { x: 19.2, y: 10, z: 10 },
  ];

  it('joins a cluster that straddles a box wall', () => {
    expect(normalise(dbscan(straddling, 1.5, 3, BOX))).toEqual([[0, 1, 2, 3]]);
  });

  it('splits the same cluster in two without a box, which is the old behaviour', () => {
    expect(normalise(dbscan(straddling, 1.5, 2))).toEqual([[0, 1], [2, 3]]);
  });

  it('wraps on every axis, not just x', () => {
    const corners = [
      { x: 0.3, y: 0.3, z: 0.3 },
      { x: 19.7, y: 19.7, z: 19.7 },
      { x: 0.3, y: 19.7, z: 0.3 },
    ];
    // Each pair is ~1.04 apart through the corner, ~34 apart by raw coordinates.
    expect(normalise(dbscan(corners, 1.5, 3, BOX))).toEqual([[0, 1, 2]]);
    expect(dbscan(corners, 1.5, 3)).toEqual([]);
  });

  it('handles unwrapped coordinates spanning several box lengths', () => {
    // oxDNA does not wrap its output, so a particle can sit many boxes away and
    // still be a neighbour. A single wrap would leave this one unreachable.
    const unwrapped = [
      { x: 5, y: 5, z: 5 },
      { x: 5.4, y: 5, z: 5 },
      { x: 5 + 3 * BOX[0], y: 5, z: 5 },
    ];
    expect(normalise(dbscan(unwrapped, 1.0, 3, BOX))).toEqual([[0, 1, 2]]);
  });

  it('leaves genuinely distant particles apart', () => {
    // Half a box in x is the furthest anything can be, so these must stay two.
    const opposite = [
      { x: 1, y: 10, z: 10 },
      { x: 1.4, y: 10, z: 10 },
      { x: 11, y: 10, z: 10 },
      { x: 11.4, y: 10, z: 10 },
    ];
    expect(normalise(dbscan(opposite, 1.5, 2, BOX))).toEqual([[0, 1], [2, 3]]);
  });

  it('ignores a zero or missing box dimension rather than dividing by it', () => {
    const points = [
      { x: 1, y: 1, z: 1 },
      { x: 1.4, y: 1, z: 1 },
    ];
    expect(normalise(dbscan(points, 1.0, 2, [0, 0, 0]))).toEqual([[0, 1]]);
    expect(normalise(dbscan(points, 1.0, 2, null))).toEqual([[0, 1]]);
  });
});

describe('minimum image cutoff', () => {
  it('is half the shortest box dimension', () => {
    expect(maxMinimumImageRadius([20, 20, 20])).toBe(10);
    expect(maxMinimumImageRadius([30, 8, 20])).toBe(4);
    expect(maxMinimumImageRadius(null)).toBe(Infinity);
    expect(maxMinimumImageRadius([0, 0, 0])).toBe(Infinity);
  });

  it('caps epsilon so a particle cannot reach its own periodic image', () => {
    // Two particles exactly half a box apart in x are as far apart as periodic
    // boundaries allow. An epsilon past that would wrap all the way round and
    // report every pair as neighbours, inventing one cluster out of nothing.
    const far = [
      { x: 0, y: 5, z: 5 },
      { x: 5, y: 5, z: 5 },
    ];
    const box = [10, 10, 10];              // cutoff 5.0
    expect(normalise(dbscan(far, 5.0, 2, box))).toEqual([[0, 1]]);
    // 40 is four whole boxes; uncapped, minimum image would still call these
    // neighbours and so would every other pair.
    expect(normalise(dbscan(far, 40, 2, box))).toEqual([[0, 1]]);
  });
});

describe('dbscan textbook semantics', () => {
  it('counts minPoints including the point itself', () => {
    // Ester et al.: |N_eps(p)| >= minPts, and N_eps(p) contains p. So a pair is
    // a cluster at minPoints 2, and noise at 3.
    const pair = [{ x: 1, y: 1, z: 1 }, { x: 1.4, y: 1, z: 1 }];
    expect(normalise(dbscan(pair, 1.0, 2, BOX))).toEqual([[0, 1]]);
    expect(dbscan(pair, 1.0, 3, BOX)).toEqual([]);
  });

  it('lets a border point join a cluster without bridging two', () => {
    // Two dense groups joined only through index 4, which has three points in
    // range (itself and one from each group) and so is not core at minPoints 4.
    // A border point joins the cluster that reaches it first and stops there;
    // if it expanded, these two groups would be reported as one.
    const bridged = [
      { x: 0.0, y: 0, z: 0 },
      { x: 0.3, y: 0, z: 0 },
      { x: 0.6, y: 0, z: 0 },
      { x: 0.9, y: 0, z: 0 },
      { x: 1.8, y: 0, z: 0 },   // border of both groups, core of neither
      { x: 2.7, y: 0, z: 0 },
      { x: 3.0, y: 0, z: 0 },
      { x: 3.3, y: 0, z: 0 },
      { x: 3.6, y: 0, z: 0 },
    ];
    expect(normalise(dbscan(bridged, 1.0, 4, BOX))).toEqual([
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
  });

  it('assigns every particle to at most one cluster', () => {
    const grid = [];
    for (let i = 0; i < 60; i++) {
      grid.push({ x: (i % 5) * 0.4, y: Math.floor(i / 5) * 0.4, z: 0 });
    }
    const clusters = dbscan(grid, 1.0, 3, BOX);
    const seen = new Set();
    for (const cluster of clusters) {
      for (const index of cluster) {
        expect(seen.has(index)).toBe(false);
        seen.add(index);
      }
    }
  });

  it('reclaims a point rejected as noise as a border point later', () => {
    // Index 0 is visited first and has only two points in range, so it is not
    // core at minPoints 3. The dense group behind it reaches it afterwards, and
    // the textbook algorithm adopts it rather than leaving it as noise.
    const trailing = [
      { x: 0.0, y: 0, z: 0 },
      { x: 0.9, y: 0, z: 0 },
      { x: 1.3, y: 0, z: 0 },
      { x: 1.7, y: 0, z: 0 },
    ];
    expect(normalise(dbscan(trailing, 1.0, 3, BOX))).toEqual([[0, 1, 2, 3]]);
  });

  it('marks isolated particles as noise', () => {
    const sparse = [
      { x: 1, y: 1, z: 1 },
      { x: 9, y: 9, z: 9 },
      { x: 5, y: 1, z: 9 },
    ];
    expect(dbscan(sparse, 1.0, 2, BOX)).toEqual([]);
  });

  it('returns nothing for no points', () => {
    expect(dbscan([], 1.0, 3, BOX)).toEqual([]);
  });
});

describe('generateHistogram', () => {
  it('counts clusters per size, ascending', () => {
    expect(generateHistogram([3, 1, 3, 2])).toEqual([
      { size: 1, count: 1, label: '1 particles' },
      { size: 2, count: 1, label: '2 particles' },
      { size: 3, count: 2, label: '3 particles' },
    ]);
  });

  it('returns nothing for no clusters', () => {
    expect(generateHistogram([])).toEqual([]);
  });
});

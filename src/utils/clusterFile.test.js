import { parseClusterFile } from './clusterFile';

const json = (value) => JSON.stringify(value);

describe('parseClusterFile shapes', () => {
  it('accepts a bare array', () => {
    const { clusters } = parseClusterFile(json([{ particles: [0, 1] }]));
    expect(clusters).toHaveLength(1);
    expect(clusters[0].indices).toEqual([0, 1]);
  });

  it('accepts an object with a clusters array', () => {
    const { clusters } = parseClusterFile(json({ clusters: [{ particles: [2] }] }));
    expect(clusters[0].indices).toEqual([2]);
  });

  it.each(['particles', 'indices', 'ids'])('accepts the particle list under "%s"', (key) => {
    // Analysis scripts in this space spell it all three ways; rejecting a file
    // over the key name would be a poor trade.
    const { clusters } = parseClusterFile(json([{ [key]: [4, 5] }]));
    expect(clusters[0].indices).toEqual([4, 5]);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseClusterFile('not json')).toThrow(/Not valid JSON/);
  });

  it('rejects JSON of the wrong shape', () => {
    expect(() => parseClusterFile(json({ nope: [] }))).toThrow(/Expected an array/);
    expect(() => parseClusterFile(json(42))).toThrow(/Expected an array/);
  });

  it('rejects a file with nothing usable in it', () => {
    expect(() => parseClusterFile(json([{ particles: 'no' }]))).toThrow(/No usable clusters/);
  });
});

describe('parseClusterFile validation', () => {
  it('rejects a whole cluster if any index is invalid', () => {
    // Silently dropping one would misreport which particles are in the cluster,
    // which is worse than refusing the entry.
    const { clusters, warnings } = parseClusterFile(
      json([{ particles: [0, -1, 2] }, { particles: [3] }]),
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].indices).toEqual([3]);
    expect(warnings.join(' ')).toMatch(/no valid particle list/);
  });

  // Number() maps all of these to 0 or NaN; the first four would have become
  // "particle 0 is a member" without a warning.
  it.each([[null], [false], [''], [[]], [1.5], ['abc'], [{}], [-1]])(
    'treats %p as an invalid index', (bad) => {
    const { warnings } = parseClusterFile(json([{ particles: [0, bad] }, { particles: [1] }]));
    expect(warnings.join(' ')).toMatch(/no valid particle list/);
  });

  it('accepts numeric strings, which some analysis scripts emit', () => {
    const { clusters } = parseClusterFile(json([{ particles: ['0', ' 12 '] }]));
    expect(clusters[0].indices).toEqual([0, 12]);
  });

  it('skips a malformed entry but keeps the rest', () => {
    const { clusters, warnings } = parseClusterFile(json([null, { particles: [1] }]));
    expect(clusters).toHaveLength(1);
    expect(warnings.join(' ')).toMatch(/not an object/);
  });

  it('drops indices past the end of the system and says so', () => {
    // Usually means the file belongs to a different trajectory, which is worth
    // saying out loud rather than rendering nothing.
    const { clusters, warnings } = parseClusterFile(
      json([{ particles: [0, 1, 999] }]), { particleCount: 10 },
    );
    expect(clusters[0].indices).toEqual([0, 1]);
    expect(warnings.join(' ')).toMatch(/1 particle\(s\) outside this system/);
  });

  it('skips a cluster that matches nothing in this system', () => {
    const { clusters, warnings } = parseClusterFile(
      json([{ particles: [999] }, { particles: [0] }]), { particleCount: 10 },
    );
    expect(clusters).toHaveLength(1);
    expect(warnings.join(' ')).toMatch(/matched no particles/);
  });

  it('accepts any index when no particle count is given', () => {
    const { clusters } = parseClusterFile(json([{ particles: [10_000] }]));
    expect(clusters[0].indices).toEqual([10_000]);
  });
});

describe('parseClusterFile fields', () => {
  it('keeps a valid #rrggbb colour', () => {
    const { clusters } = parseClusterFile(json([{ particles: [0], color: '  #E7298A ' }]));
    expect(clusters[0].color).toBe('#E7298A');
  });

  it.each(['red', '#fff', '#12345', 'rgb(1,2,3)'])('rejects colour %p with a warning', (color) => {
    const { clusters, warnings } = parseClusterFile(json([{ particles: [0], color }]));
    expect(clusters[0].color).toBeNull();
    expect(warnings.join(' ')).toMatch(/not a #rrggbb value/);
  });

  it('leaves colour null when the file omits it, without warning', () => {
    const { clusters, warnings } = parseClusterFile(json([{ particles: [0] }]));
    expect(clusters[0].color).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('names a cluster, falling back to its position', () => {
    const { clusters } = parseClusterFile(json([{ particles: [0], name: ' Core ' }, { particles: [1] }]));
    expect(clusters[0].name).toBe('Core');
    expect(clusters[1].name).toBe('Cluster 2');
  });

  it('treats only an explicit false as hidden', () => {
    // A file that omits the field has to behave exactly as it did before the
    // field existed.
    const { clusters } = parseClusterFile(json([
      { particles: [0] },
      { particles: [1], visible: true },
      { particles: [2], visible: false },
      { particles: [3], visible: 0 },
    ]));
    expect(clusters.map(c => c.visible)).toEqual([true, true, false, true]);
  });

  it('numbers warnings by position in the file, not by surviving cluster', () => {
    // Entry 1 survives, entry 2 is skipped: the warning must say 2, or it points
    // the reader at the wrong line of their file.
    const { warnings } = parseClusterFile(json([{ particles: [0] }, null, { particles: [1] }]));
    expect(warnings[0]).toMatch(/^Cluster 2 /);
  });
});

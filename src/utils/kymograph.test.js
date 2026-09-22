import {
  pickIndices, assignLineages, lineageSlots, NOISE, lineageColourer, columnForFrame,
  cohortOf, cohortFrames,
  bandSizes, bandOrder, stackFrames, particleTrace,
} from './kymograph';

const lineages = (clusters, particleCount, previous = null, next = 1) =>
  assignLineages(clusters, particleCount, previous, next);

describe('pickIndices', () => {
  test('returns everything when it already fits', () => {
    expect(pickIndices(4, 10)).toEqual([0, 1, 2, 3]);
  });

  // The first N frames of a long run answer a question nobody asked.
  test('spreads across the whole range rather than truncating', () => {
    const picked = pickIndices(100, 5);
    expect(picked).toHaveLength(5);
    expect(picked[0]).toBe(0);
    expect(picked[picked.length - 1]).toBeGreaterThan(75);
    expect([...picked].sort((a, b) => a - b)).toEqual(picked);
  });

  test('never runs past the end', () => {
    expect(Math.max(...pickIndices(7, 5))).toBeLessThan(7);
  });
});

describe('assignLineages', () => {
  test('gives each cluster a fresh lineage on the first frame', () => {
    const { lineageOf, nextLineage } = lineages([[0, 1], [2, 3]], 4);
    expect(lineageOf[0]).toBe(lineageOf[1]);
    expect(lineageOf[2]).toBe(lineageOf[3]);
    expect(lineageOf[0]).not.toBe(lineageOf[2]);
    expect(nextLineage).toBe(3);
  });

  test('noise has no lineage', () => {
    expect(lineages([[0, 1]], 3).lineageOf[2]).toBe(NOISE);
  });

  // The whole point of tracking: a cluster that keeps most of its particles is
  // the same cluster, however DBSCAN renumbered it.
  test('a cluster keeps its lineage when it is renumbered', () => {
    const first = lineages([[0, 1, 2], [3, 4]], 5);
    const second = assignLineages([[3, 4], [0, 1, 2]], 5, first.lineageOf, first.nextLineage);
    expect(second.lineageOf[0]).toBe(first.lineageOf[0]);
    expect(second.lineageOf[3]).toBe(first.lineageOf[3]);
  });

  // This is what the view is for: colouring by size cannot show it, because
  // both clusters here are the same size throughout.
  test('a particle moving between two equal clusters changes lineage', () => {
    const first = lineages([[0, 1, 2], [3, 4, 5]], 6);
    const second = assignLineages([[0, 1, 3], [2, 4, 5]], 6, first.lineageOf, first.nextLineage);
    // Particle 3 left the second cluster for the first.
    expect(second.lineageOf[3]).toBe(first.lineageOf[0]);
    expect(second.lineageOf[3]).not.toBe(first.lineageOf[3]);
  });

  test('a split leaves the larger half carrying the history', () => {
    const first = lineages([[0, 1, 2, 3]], 4);
    const original = first.lineageOf[0];
    const second = assignLineages([[0, 1, 2], [3]], 4, first.lineageOf, first.nextLineage);
    expect(second.lineageOf[0]).toBe(original);
    expect(second.lineageOf[3]).not.toBe(original);
  });

  // Two clusters both claiming to be the same one would draw a single lineage
  // in two places at once.
  test('a lineage is never claimed twice', () => {
    const first = lineages([[0, 1, 2, 3]], 4);
    const second = assignLineages([[0, 1], [2, 3]], 4, first.lineageOf, first.nextLineage);
    expect(second.lineageOf[0]).not.toBe(second.lineageOf[2]);
  });

  test('a cluster sharing nothing with the past starts a new lineage', () => {
    const first = lineages([[0, 1]], 4);
    const second = assignLineages([[2, 3]], 4, first.lineageOf, first.nextLineage);
    expect(second.lineageOf[2]).toBe(first.nextLineage);
  });

  test('is deterministic, so two runs draw the same picture', () => {
    const first = lineages([[0, 1], [2, 3]], 4);
    const a = assignLineages([[0, 2], [1, 3]], 4, first.lineageOf, first.nextLineage);
    const b = assignLineages([[0, 2], [1, 3]], 4, first.lineageOf, first.nextLineage);
    expect(Array.from(a.lineageOf)).toEqual(Array.from(b.lineageOf));
  });
});

describe('lineageSlots', () => {
  // Indexed by first appearance, not by the raw id: a long run creates many
  // short-lived lineages, and indexing the palette by id walked past its end and
  // gave two live clusters the same colour.
  test('numbers lineages from zero in the order they appear', () => {
    const slots = lineageSlots([Int32Array.from([7, 7, 0]), Int32Array.from([7, 9, 0])]);
    expect(slots.get(7)).toBe(0);
    expect(slots.get(9)).toBe(1);
  });

  test('noise is not a lineage', () => {
    expect(lineageSlots([Int32Array.from([0, 0])]).has(NOISE)).toBe(false);
  });
});

describe('bands', () => {
  const columns = [
    Int32Array.from([1, 1, 1, 2, 2, 0]),   // 3 + 2, one noise
    Int32Array.from([1, 1, 2, 2, 2, 2]),   // 2 + 4
  ];

  test('a band is as tall as its cluster', () => {
    expect([...bandSizes(columns[0])]).toEqual([[1, 3], [2, 2]]);
  });

  test('noise is not a band', () => {
    expect(bandSizes(columns[0]).has(NOISE)).toBe(false);
  });

  // Sorting per frame would make a band jump the stack whenever two clusters
  // swapped size, which reads as the cluster moving rather than growing.
  test('the stacking order is one order for the whole run', () => {
    expect(bandOrder(columns)).toEqual(bandOrder(columns));
    expect(bandOrder(columns)).toHaveLength(2);
  });

  test('spans are fractions of the particle count, so noise leaves a gap', () => {
    const stacks = stackFrames(columns, bandOrder(columns), 6);
    const total = [...stacks[0].values()].reduce((n, s) => n + s.size, 0);
    expect(total).toBe(5);                                  // one particle is noise
    expect(Math.max(...[...stacks[0].values()].map(s => s.end))).toBeCloseTo(5 / 6);
  });

  test('bands do not overlap', () => {
    const stacks = stackFrames(columns, bandOrder(columns), 6);
    const spans = [...stacks[1].values()].sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end - 1e-9);
    }
  });

  test('a particle trace follows it from one band to the other', () => {
    const order = bandOrder(columns);
    const stacks = stackFrames(columns, order, 6);
    // Particle 2 is in lineage 1 at first and lineage 2 after.
    const trace = particleTrace(columns, stacks, 2);
    expect(trace[0]).not.toBeNull();
    expect(trace[1]).not.toBeNull();
    expect(trace[0]).not.toBeCloseTo(trace[1]);
  });

  test('and is null while the particle is in no cluster', () => {
    const order = bandOrder(columns);
    expect(particleTrace(columns, stackFrames(columns, order, 6), 5)[0]).toBeNull();
  });
});

describe('lineageColourer', () => {
  // Deleted once by an over-eager cleanup, which webpack only warns about — the
  // app compiled and then threw on render. Worth a test of its own.
  const data = { columns: [Int32Array.from([5, 5, 0])], frames: [0], particleCount: 3 };

  test('gives a cluster a colour from its lineage', () => {
    const colour = lineageColourer(data, ['#123456'], 0);
    expect(colour(0)).toBe('#123456');
  });

  test('and nothing for a particle in no cluster', () => {
    expect(lineageColourer(data, ['#123456'], 0)(2)).toBeNull();
  });

  test('the same cluster gets the same colour at every frame', () => {
    const twoFrames = {
      columns: [Int32Array.from([5, 5, 9]), Int32Array.from([5, 9, 9])],
      frames: [0, 1],
      particleCount: 3,
    };
    const palette = ['#111111', '#222222'];
    expect(lineageColourer(twoFrames, palette, 0)(0))
      .toBe(lineageColourer(twoFrames, palette, 1)(0));
  });
});

describe('cohort', () => {
  // Three particles start together in lineage 1. One stays, one moves to
  // lineage 2, one falls out of every cluster.
  const columns = [
    Int32Array.from([1, 1, 1, 2]),
    Int32Array.from([1, 2, 0, 2]),
  ];

  test('the cohort is who was in the cluster at that moment', () => {
    expect(cohortOf(columns[0], new Set([1]))).toEqual([0, 1, 2]);
  });

  test('its height is constant: what moves is how it is divided', () => {
    const frames = cohortFrames(columns, [0, 1, 2], bandOrder(columns));
    for (const spans of frames) {
      const total = [...spans.values()].reduce((n, s) => n + s.size, 0);
      expect(total).toBe(3);
      expect(Math.max(...[...spans.values()].map(s => s.end))).toBeCloseTo(1);
    }
  });

  test('it shows where each one went', () => {
    const [, second] = cohortFrames(columns, [0, 1, 2], bandOrder(columns));
    expect(second.get(1).size).toBe(1);        // stayed
    expect(second.get(2).size).toBe(1);        // joined the other cluster
    expect(second.get(NOISE).size).toBe(1);    // left every cluster
  });

  // "Left every cluster" is a fate worth seeing; dropping it would silently
  // shrink the cohort instead of showing it dispersing.
  test('noise is a destination, and comes last', () => {
    const [, second] = cohortFrames(columns, [0, 1, 2], bandOrder(columns));
    const last = [...second.entries()].pop();
    expect(last[0]).toBe(NOISE);
    expect(last[1].end).toBeCloseTo(1);
  });

  test('a cohort that stays together is one block', () => {
    const together = [Int32Array.from([1, 1]), Int32Array.from([1, 1])];
    const [, second] = cohortFrames(together, [0, 1], bandOrder(together));
    expect(second.size).toBe(1);
  });
});

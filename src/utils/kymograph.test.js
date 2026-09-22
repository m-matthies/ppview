import {
  pickIndices, assignLineages, orderRows, lineageSlots, paintKymograph, NOISE,
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

describe('orderRows', () => {
  const of = (clusters, count) => lineages(clusters, count).lineageOf;

  // Without grouping, rows interleave every cluster and the picture is static.
  test('groups a cluster into contiguous rows', () => {
    const order = orderRows(of([[0, 3], [1, 4]], 5), 5);
    const positionOf = new Map(order.map((particle, row) => [particle, row]));
    expect(Math.abs(positionOf.get(0) - positionOf.get(3))).toBe(1);
    expect(Math.abs(positionOf.get(1) - positionOf.get(4))).toBe(1);
  });

  test('puts the largest cluster first, so sampling keeps it', () => {
    const order = orderRows(of([[9], [0, 1, 2]], 10), 10);
    expect(order.slice(0, 3).sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  test('noise goes last: it is the absence of a cluster, not the smallest one', () => {
    const order = orderRows(of([[0, 1]], 4), 4);
    expect(order.slice(0, 2).sort((a, b) => a - b)).toEqual([0, 1]);
    expect(order.slice(2).sort((a, b) => a - b)).toEqual([2, 3]);
  });

  test('is stable, so two runs draw the same picture', () => {
    const lineageOf = of([[2, 0], [3, 1]], 4);
    expect(orderRows(lineageOf, 4)).toEqual(orderRows(lineageOf, 4));
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

describe('paintKymograph', () => {
  const columns = [Int32Array.from([2, 2, 0]), Int32Array.from([2, 0, 0])];
  const rows = [0, 1, 2];
  const palette = ['#ff0000', '#00ff00'];
  const pixel = (image, x, y) => {
    const o = (y * image.width + x) * 4;
    return [image.data[o], image.data[o + 1], image.data[o + 2], image.data[o + 3]];
  };

  test('is one pixel per particle per frame', () => {
    const image = paintKymograph({ columns, rows, palette });
    expect(image.width).toBe(2);
    expect(image.height).toBe(3);
  });

  test('paints a clustered particle in the palette and noise in the background', () => {
    const image = paintKymograph({ columns, rows, palette });
    expect(pixel(image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(image, 1, 1)[3]).toBeLessThan(255);       // noise
  });

  test('greys what is outside the selected lineage, and only that', () => {
    const image = paintKymograph({ columns, rows, palette, emphasis: new Set([2]) });
    expect(pixel(image, 0, 0)).toEqual([255, 0, 0, 255]);   // lineage 2, full colour
    const [r, g, b] = pixel(image, 0, 2);                   // noise, muted
    expect([r, g, b]).toEqual([28, 30, 36]);
  });

  // The reason emphasis is keyed on the lineage rather than the particle: a row
  // that leaves the selected cluster has to go grey at the frame it leaves, not
  // stay coloured for the whole run because of where it started.
  test('a particle that leaves the selected lineage is muted from then on', () => {
    const moving = [Int32Array.from([7]), Int32Array.from([9])];
    const image = paintKymograph({
      columns: moving, rows: [0], palette: ['#ff0000', '#00ff00'], emphasis: new Set([7]),
    });
    expect(pixel(image, 0, 0)).toEqual([255, 0, 0, 255]);   // still in lineage 7
    const [r, g, b] = pixel(image, 1, 0);                   // moved to lineage 9
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  test('and one that joins it is in colour from the frame it joins', () => {
    const joining = [Int32Array.from([9]), Int32Array.from([7])];
    const image = paintKymograph({
      columns: joining, rows: [0], palette: ['#ff0000', '#00ff00'], emphasis: new Set([7]),
    });
    const [r, g] = pixel(image, 0, 0);
    expect(r).toBe(g);                                       // not yet: muted
    // Lineage 7 appears second here, so it takes the second palette entry.
    const [jr, jg] = pixel(image, 1, 0);
    expect(jg).toBeGreaterThan(jr);
  });

  // The default scheme is the golden-angle generator, which emits
  // 'hsl(h,s%,l%)' rather than hex. Parsing only hex painted every pixel black,
  // and every test here used a hex palette, so none of them noticed.
  test('reads hsl palette entries, which the default scheme produces', () => {
    const image = paintKymograph({
      columns, rows, palette: ['hsl(120,50%,65%)'],
    });
    const [r, g, b] = pixel(image, 0, 0);
    expect([r, g, b]).not.toEqual([0, 0, 0]);
    expect(g).toBeGreaterThan(r);          // a green hue stays green
  });

  test('an empty selection is no selection, not everything greyed', () => {
    const all = paintKymograph({ columns, rows, palette });
    const none = paintKymograph({ columns, rows, palette, emphasis: null });
    expect(Array.from(none.data)).toEqual(Array.from(all.data));
  });
});

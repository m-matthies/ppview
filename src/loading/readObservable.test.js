import { readObservable } from './readObservable';

/**
 * A stand-in for the File API over an ASCII string: `readObservable` uses only
 * `.stream()` for the index pass and `.slice().text()` for the blocks it keeps.
 */
const fileOf = (text) => ({
  size: text.length,
  stream: () => new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  }),
  slice: (start, end) => ({ text: async () => text.slice(start, end) }),
});

// Four timesteps of PatchyBonds at a print interval of 100, over two particles.
// Steps 0 and 200 bond them; 100 and 300 leave them free.
const bonded = ['1', '2', '1', '1'];
const free = ['0', '', '0', ''];
const PATCHY = [
  '# step 0 N 2', ...bonded,
  '# step 100 N 2', ...free,
  '# step 200 N 2', ...bonded,
  '# step 300 N 2', ...free,
].join('\n') + '\n';

describe('readObservable, matching on the steps the file states', () => {
  test('each frame gets the block carrying its own step', async () => {
    // The trajectory prints every 200 steps, the observable every 100 — the
    // shape of the file that prompted streaming in the first place.
    const result = await readObservable(fileOf(PATCHY), {
      formatId: 'patchy_bonds', frameTimes: [0, 200],
    });
    expect(result.frames).toHaveLength(2);
    expect(result.frames[0].clusters).toEqual([[0, 1]]);
    expect(result.frames[1].clusters).toEqual([[0, 1]]);
    expect(result.method).toBe('step');
    expect(result.matched).toBe(2);
  });

  test('it does not simply take the blocks in order', async () => {
    // Positionally, frame 1 would be step 100 — which has no bonds at all.
    const result = await readObservable(fileOf(PATCHY), {
      formatId: 'patchy_bonds', frameTimes: [0, 200],
    });
    expect(result.frames[1].a).toHaveLength(1);
  });

  test('a frame the observable does not cover is empty, not borrowed', async () => {
    const result = await readObservable(fileOf(PATCHY), {
      formatId: 'patchy_bonds', frameTimes: [0, 150, 400],
    });
    expect(result.frames[0].clusters).toEqual([[0, 1]]);
    expect(result.frames[1].clusters).toEqual([]);
    expect(result.frames[1].a).toHaveLength(0);
    expect(result.frames[2].clusters).toEqual([]);
    expect(result.matched).toBe(1);
  });

  test('only the blocks it needs are read', async () => {
    // The whole point: the file that prompted this holds 21,798 timesteps for a
    // trajectory of 217 frames, and reading all of them is 4.79 GB of text.
    const reads = [];
    const file = fileOf(PATCHY);
    const counted = { ...file, slice: (a, b) => { reads.push([a, b]); return file.slice(a, b); } };
    await readObservable(counted, { formatId: 'patchy_bonds', frameTimes: [0, 200] });
    expect(reads).toHaveLength(2);
  });

  test('a step wanted by two frames is read once', async () => {
    const reads = [];
    const file = fileOf(PATCHY);
    const counted = { ...file, slice: (a, b) => { reads.push([a, b]); return file.slice(a, b); } };
    const result = await readObservable(counted, {
      formatId: 'patchy_bonds', frameTimes: [200, 200],
    });
    expect(reads).toHaveLength(1);
    expect(result.frames[0].clusters).toEqual(result.frames[1].clusters);
  });

  test('it reports progress over the bytes of the file', async () => {
    const seen = [];
    await readObservable(fileOf(PATCHY), {
      formatId: 'patchy_bonds', frameTimes: [0], onStatus: (m) => seen.push(m),
    });
    expect(seen.join(' ')).toMatch(/reading|indexing/i);
  });
});

describe('readObservable, formats that state no step', () => {
  const PL = [
    '1 ( 0 0 ) [0 -> (1), 1 -> (0)]',
    '1 ( 0 0 ) [2 -> (3), 3 -> (2)]',
    '',                                   // not a timestep in this format
    '1 ( 0 0 ) [4 -> (5), 5 -> (4)]',
  ].join('\n') + '\n';

  test('a blank line is not a timestep for PLClusterTopology', async () => {
    const result = await readObservable(fileOf(PL), {
      formatId: 'pl_cluster_topology', frameTimes: [0, 1, 2],
    });
    expect(result.frames.map(f => f.clusters[0])).toEqual([[0, 1], [2, 3], [4, 5]]);
  });

  const RASPBERRY = ['((0 0), (1, 0))', '', '((2 0), (3, 0))', ''].join('\n');

  test('a blank line IS a timestep for RaspberryPatchyBonds', async () => {
    // A step in which nothing was bonded. Dropping it slides every later frame
    // one step earlier.
    const result = await readObservable(fileOf(RASPBERRY), {
      formatId: 'raspberry_patchy_bonds', frameTimes: [0, 1, 2],
    });
    expect(result.frames.map(f => f.clusters)).toEqual([[[0, 1]], [], [[2, 3]]]);
  });

  test('the print interval lines the blocks up with the frames', async () => {
    const result = await readObservable(fileOf(PL), {
      formatId: 'pl_cluster_topology', frameTimes: [0, 2], printEvery: 1,
    });
    expect(result.method).toBe('interval');
    expect(result.frames.map(f => f.clusters[0])).toEqual([[0, 1], [4, 5]]);
  });

  test('without one, a count that does not match is refused', async () => {
    await expect(readObservable(fileOf(PL), {
      formatId: 'pl_cluster_topology', frameTimes: [0, 1],
    })).rejects.toThrow(/3 timesteps.*2 frames/i);
  });
});

describe('a PLClusterTopology step with no clusters', () => {
  // The line is just its cluster count: "0". Two bytes with the newline, which
  // is also the length of a CRLF blank line — so judging blankness by the byte
  // span dropped the step and read every later frame from the wrong block.
  const PL = [
    '1 ( 0 0 ) [0 -> (1), 1 -> (0)]',
    '0',
    '1 ( 0 0 ) [4 -> (5), 5 -> (4)]',
  ].join('\n') + '\n';

  test('is a timestep, and does not shift the ones after it', async () => {
    const result = await readObservable(fileOf(PL), {
      formatId: 'pl_cluster_topology', frameTimes: [0, 1, 2],
    });
    expect(result.frames.map(f => f.clusters)).toEqual([[[0, 1]], [], [[4, 5]]]);
  });

  test('a genuinely blank line is still not a timestep', async () => {
    const withBlank = PL.replace('0\n', '\n0\n');
    const result = await readObservable(fileOf(withBlank), {
      formatId: 'pl_cluster_topology', frameTimes: [0, 1, 2],
    });
    expect(result.frames.map(f => f.clusters)).toEqual([[[0, 1]], [], [[4, 5]]]);
  });
});

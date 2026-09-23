import { scanObservable, OBS_STEP_HEADERS, OBS_LINE_PER_STEP } from './wasmCore';

const bytes = (text) => new TextEncoder().encode(text);

/** Feeds the text in pieces of `size`, so chunk seams are actually exercised. */
const inChunks = (text, size) => {
  const all = bytes(text);
  return (async function* stream() {
    for (let at = 0; at < all.length; at += size) yield all.subarray(at, at + size);
  })();
};

const BLOCKS = [
  '# step 0 N 2', '1', '2', '0', '',
  '# step 100000 N 2', '0', '', '0', '',
  '# step 200000 N 2', '1', '2', '0', '',
].join('\n');

describe('scanObservable, step headers', () => {
  test('finds every block and reads its step', async () => {
    const index = await scanObservable(inChunks(BLOCKS, 4096), OBS_STEP_HEADERS);
    expect(Array.from(index.steps)).toEqual([0, 100000, 200000]);
  });

  test('the offsets point at the header lines', async () => {
    const index = await scanObservable(inChunks(BLOCKS, 4096), OBS_STEP_HEADERS);
    const text = BLOCKS;
    for (const offset of index.offsets) {
      expect(text.slice(offset, offset + 6)).toBe('# step');
    }
  });

  test('a chunk boundary inside a header line does not lose the step', async () => {
    // The seam is the whole reason this is a streaming scanner rather than a
    // per-chunk one; a header split across two chunks used to read as no step.
    const whole = await scanObservable(inChunks(BLOCKS, 1 << 20), OBS_STEP_HEADERS);
    for (const size of [1, 3, 7, 13, 64]) {
      // eslint-disable-next-line no-await-in-loop
      const index = await scanObservable(inChunks(BLOCKS, size), OBS_STEP_HEADERS);
      expect(Array.from(index.steps)).toEqual([0, 100000, 200000]);
      // Byte for byte the same index however the bytes happened to arrive.
      expect(Array.from(index.offsets)).toEqual(Array.from(whole.offsets));
    }
  });

  test('it reports the total size, which is where the last block ends', async () => {
    const index = await scanObservable(inChunks(BLOCKS, 8), OBS_STEP_HEADERS);
    expect(index.size).toBe(bytes(BLOCKS).length);
  });

  test('a header with no newline after it still counts', async () => {
    const index = await scanObservable(inChunks('# step 7 N 1', 3), OBS_STEP_HEADERS);
    expect(Array.from(index.steps)).toEqual([7]);
  });
});

describe('scanObservable, one line per step', () => {
  const LINES = 'a b c\n\nd e f\n';

  test('every line is a block, including a blank one', async () => {
    // A RaspberryPatchyBonds step in which nothing was bonded is a blank line,
    // and dropping it slides every later frame one step earlier.
    const index = await scanObservable(inChunks(LINES, 2), OBS_LINE_PER_STEP);
    expect(Array.from(index.offsets)).toEqual([0, 6, 7]);
    expect(Array.from(index.steps)).toEqual([-1, -1, -1]);
  });
});

describe('progress', () => {
  test('it reports bytes as they are consumed', async () => {
    const seen = [];
    await scanObservable(inChunks(BLOCKS, 8), OBS_STEP_HEADERS, {
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1][0]).toBe(bytes(BLOCKS).length);
  });
});

describe('scanObservable, lines that are timesteps only when they hold something', () => {
  const { OBS_LINE_PER_STEP_NONBLANK } = require('./wasmCore');
  // "0" is what PLClusterTopology writes for a step with no clusters, and with
  // its newline that is two bytes — the same span as a CRLF blank line. Judging
  // by the span dropped the step and shifted every later frame.
  const PL = '1 ( 0 0 ) [0 -> (1)]\n0\n\n1 ( 0 0 ) [4 -> (5)]\n';

  test('a lone cluster count is a timestep; a blank line is not', async () => {
    const index = await scanObservable(inChunks(PL, 4096), OBS_LINE_PER_STEP_NONBLANK);
    expect(Array.from(index.offsets).map(o => PL.slice(o, PL.indexOf('\n', o))))
      .toEqual(['1 ( 0 0 ) [0 -> (1)]', '0', '1 ( 0 0 ) [4 -> (5)]']);
  });

  test('and the answer does not depend on where the chunks fall', async () => {
    const whole = await scanObservable(inChunks(PL, 1 << 20), OBS_LINE_PER_STEP_NONBLANK);
    for (const size of [1, 2, 3, 7, 21, 22, 23]) {
      // eslint-disable-next-line no-await-in-loop
      const index = await scanObservable(inChunks(PL, size), OBS_LINE_PER_STEP_NONBLANK);
      expect(Array.from(index.offsets)).toEqual(Array.from(whole.offsets));
    }
  });
});

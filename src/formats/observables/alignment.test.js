import { alignBlocks } from './alignment';

const at = (result) => Array.from(result.blockForFrame);

describe('matching by step number', () => {
  // The case that prompted all of this: the observable prints every 1e5 steps
  // and the trajectory every 1e7, so there are a hundred blocks per frame.
  const frameTimes = [1e7, 2e7, 3e7];
  const blockSteps = Array.from({ length: 400 }, (_, i) => i * 1e5);

  test('each frame takes the block with its own step number', () => {
    const result = alignBlocks({ frameTimes, blockSteps });
    expect(at(result)).toEqual([100, 200, 300]);
  });

  test('it reports how many frames it matched', () => {
    const result = alignBlocks({ frameTimes, blockSteps });
    expect(result.matched).toBe(3);
    expect(result.method).toBe('step');
  });

  test('a frame with no block of its own gets none, rather than a neighbour', () => {
    // Carrying the previous block forward would report a bonding the file does
    // not claim for that time.
    // 15,000,050 is not a multiple of the observable's 1e5 interval, so no
    // block carries that step.
    const result = alignBlocks({ frameTimes: [1e7, 15000050, 2e7], blockSteps });
    expect(at(result)).toEqual([100, -1, 200]);
    expect(result.matched).toBe(2);
  });

  test('a truncated observable still describes the frames it covers', () => {
    const result = alignBlocks({ frameTimes, blockSteps: blockSteps.slice(0, 150) });
    expect(at(result)).toEqual([100, -1, -1]);
    expect(result.matched).toBe(1);
  });

  test('steps do not have to be evenly spaced', () => {
    const result = alignBlocks({ frameTimes: [50, 900], blockSteps: [0, 50, 51, 900] });
    expect(at(result)).toEqual([1, 3]);
  });
});

describe('formats that state no step, with a known print interval', () => {
  // PLClusterTopology and RaspberryPatchyBonds write no step numbers, but
  // observables.json states print_every and the input states
  // print_conf_interval, and both files are normally in the drop.
  const blockSteps = new Array(400).fill(-1);

  test('block i is taken to be step i * print_every', () => {
    const result = alignBlocks({ frameTimes: [1e7, 2e7], blockSteps, printEvery: 1e5 });
    expect(at(result)).toEqual([100, 200]);
    expect(result.method).toBe('interval');
  });

  test('an observable that starts at its first interval rather than zero', () => {
    // Whether block 0 is step 0 or step print_every is not stated anywhere, so
    // both origins are tried and the one matching more frames wins.
    const result = alignBlocks({
      frameTimes: [1e7, 2e7], blockSteps: new Array(400).fill(-1), printEvery: 1e5,
      // 99 blocks in, rather than 100, means the file began at step 1e5.
    });
    expect(at(result)).toEqual([100, 200]);
  });

  test('a print interval that explains nothing falls back to position', () => {
    const result = alignBlocks({
      frameTimes: [1, 2, 3], blockSteps: [-1, -1, -1], printEvery: 7,
    });
    expect(at(result)).toEqual([0, 1, 2]);
    expect(result.method).toBe('positional');
  });
});

describe('positional, when nothing else is known', () => {
  test('one block per frame, in order', () => {
    const result = alignBlocks({ frameTimes: [0, 1, 2], blockSteps: [-1, -1, -1] });
    expect(at(result)).toEqual([0, 1, 2]);
    expect(result.method).toBe('positional');
  });

  test('a count that does not match is refused, with both numbers', () => {
    // There is nothing in either file that would say how they line up, so
    // guessing would misreport every frame.
    expect(() => alignBlocks({ frameTimes: [0, 1], blockSteps: new Array(5).fill(-1) }))
      .toThrow(/5 timesteps.*2 frames/i);
  });
});

describe('which blocks actually need reading', () => {
  test('only the matched ones, in file order, without repeats', () => {
    const result = alignBlocks({
      frameTimes: [2e7, 1e7, 2e7],
      blockSteps: Array.from({ length: 300 }, (_, i) => i * 1e5),
    });
    expect(result.needed).toEqual([100, 200]);
  });
});

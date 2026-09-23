import { parseRaspberryBonds } from './raspberryBonds';

// pypatchy's regex reads the first pair space-separated and the second
// comma-separated — `\(\((\d+) (\d+)\), \((\d+), (\d+)\)\)` — which is odd
// enough to be worth accepting either way round.
const LINE = '((0 1), (2, 0)) ((2 3), (5, 1))';

test('each tuple is one bond between two particles', () => {
  const { frames } = parseRaspberryBonds(LINE);
  expect(Array.from(frames[0].a)).toEqual([0, 2]);
  expect(Array.from(frames[0].b)).toEqual([2, 5]);
});

test('both patch ids are known, because each tuple states both', () => {
  const { frames } = parseRaspberryBonds(LINE);
  expect(Array.from(frames[0].patchA)).toEqual([1, 3]);
  expect(Array.from(frames[0].patchB)).toEqual([0, 1]);
});

test('the separator inside a pair may be a space or a comma', () => {
  const spaces = parseRaspberryBonds('((0 1), (2 0))').frames[0];
  const commas = parseRaspberryBonds('((0, 1), (2, 0))').frames[0];
  expect(Array.from(commas.a)).toEqual(Array.from(spaces.a));
  expect(Array.from(commas.patchA)).toEqual(Array.from(spaces.patchA));
});

test('clusters are computed here, because the file states no grouping', () => {
  const { frames } = parseRaspberryBonds('((0 0), (1, 0)) ((1 1), (2, 0)) ((7 0), (8, 0))');
  expect(frames[0].clusters).toEqual([[0, 1, 2], [7, 8]]);
});

test('one line is one timestep', () => {
  const { frames } = parseRaspberryBonds(`${LINE}\n${LINE}\n`);
  expect(frames).toHaveLength(2);
});

test('a timestep with no bonds is a blank line, and still a frame', () => {
  // Dropping it would slide every later frame one step earlier.
  const { frames } = parseRaspberryBonds(`${LINE}\n\n${LINE}\n`);
  expect(frames).toHaveLength(3);
  expect(frames[1].a).toHaveLength(0);
  expect(frames[1].clusters).toEqual([]);
});

test('blank lines at the end of the file are not extra timesteps', () => {
  expect(parseRaspberryBonds(`${LINE}\n\n\n`).frames).toHaveLength(1);
});

test('reports no parsable timesteps rather than an empty success', () => {
  expect(() => parseRaspberryBonds('nothing here\nnor here\n')).toThrow(/timestep/i);
});

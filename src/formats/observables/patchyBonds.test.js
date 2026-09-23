import { parsePatchyBonds } from './patchyBonds';

// Three particles, two patches each. Particle 0's patch 0 is bonded to
// particle 2's patch 1; particle 1 is bonded to nothing, so its index line is
// BLANK — which is the trap in this format.
// Indices in the second line are 1-indexed, as oxDNA writes `bonded_id + 1`.
const BLOCK = [
  '# step 100 N 3',
  '1 0',
  '3',      // particle 0, patch 0 -> particle 2
  '0 0',
  '',       // particle 1, no bonds at all
  '0 1',
  '1',      // particle 2, patch 1 -> particle 0
].join('\n');

test('bonded indices are 1-indexed in the file and 0-indexed in the result', () => {
  const { frames } = parsePatchyBonds(BLOCK);
  expect(Array.from(frames[0].a)).toEqual([0]);
  expect(Array.from(frames[0].b)).toEqual([2]);
});

test('the per-patch counts partition the flat index line', () => {
  const { frames } = parsePatchyBonds(BLOCK);
  // Particle 0 bonded on patch 0, particle 2 on patch 1.
  expect(frames[0].patchA[0]).toBe(0);
  expect(frames[0].patchB[0]).toBe(1);
});

test('a particle with no bonds writes a blank line and does not shift the rest', () => {
  const { frames } = parsePatchyBonds(BLOCK);
  // If the blank line were skipped, particle 2's counts would be read from its
  // index line and every particle after it would be misread.
  expect(frames[0].clusters).toEqual([[0, 2]]);
});

test('clusters are the connected components of the bond graph', () => {
  const block = [
    '# step 0 N 4',
    '1', '2',
    '1', '1',
    '1', '4',
    '1', '3',
  ].join('\n');
  expect(parsePatchyBonds(block).frames[0].clusters).toEqual([[0, 1], [2, 3]]);
});

test('the step number of each block is kept', () => {
  const { steps } = parsePatchyBonds(`${BLOCK}\n${BLOCK.replace('step 100', 'step 250')}`);
  expect(steps).toEqual([100, 250]);
});

test('one header is one timestep', () => {
  const { frames } = parsePatchyBonds(`${BLOCK}\n${BLOCK.replace('step 100', 'step 250')}`);
  expect(frames).toHaveLength(2);
});

test('counts that do not add up to the index line are reported, not mis-partitioned', () => {
  const block = [
    '# step 0 N 2',
    '2 0',
    '2',      // says two bonds on patch 0, lists one
    '1 0',
    '1',
  ].join('\n');
  const { warnings } = parsePatchyBonds(block);
  expect(warnings.join(' ')).toMatch(/particle 0/i);
});

test('a truncated final block is reported rather than read as a short frame', () => {
  // A run cut off mid-write: the first block is whole, the second is not.
  const { frames, warnings } = parsePatchyBonds(`${BLOCK}\n# step 250 N 3\n1 0\n3\n`);
  expect(frames).toHaveLength(1);
  expect(warnings.join(' ')).toMatch(/incomplete/i);
});

test('a file whose only block is truncated is an error, not an empty success', () => {
  expect(() => parsePatchyBonds('# step 0 N 3\n1\n2\n')).toThrow(/timestep/i);
});

test('reports no parsable timesteps rather than an empty success', () => {
  expect(() => parsePatchyBonds('t = 0\nb = 10 10 10\n')).toThrow(/timestep/i);
});

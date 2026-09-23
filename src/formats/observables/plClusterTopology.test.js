import { parsePLClusterTopology } from './plClusterTopology';
import { NO_PATCH } from './bondFrames';

// Two clusters: {0,1,2} joined 0-1 and 0-2, and {3,4} joined 3-4.
// The `( ... )` member lists hold particle TYPES here, which is the default
// (show_types=true) — "0 0 1" is three particles of types 0, 0 and 1.
const LINE = '2 ( 0 0 1 ) [0 -> (1 2), 1 -> (0), 2 -> (0)] ( 1 1 ) [3 -> (4), 4 -> (3)]';

test('clusters come from the adjacency block, not the member list', () => {
  const { frames } = parsePLClusterTopology(LINE);
  // Read from "( 0 0 1 )" the members would be 0, 0 and 1 — types, not indices.
  expect(frames[0].clusters).toEqual([[0, 1, 2], [3, 4]]);
});

test('each bond is recorded once, though both ends report it', () => {
  const { frames } = parsePLClusterTopology(LINE);
  const pairs = Array.from(frames[0].a).map((a, i) => [a, frames[0].b[i]]);
  expect(pairs).toEqual([[0, 1], [0, 2], [3, 4]]);
});

test('the format carries no patch ids, and says so rather than guessing', () => {
  const { frames } = parsePLClusterTopology(LINE);
  expect(Array.from(frames[0].patchA)).toEqual([NO_PATCH, NO_PATCH, NO_PATCH]);
  expect(Array.from(frames[0].patchB)).toEqual([NO_PATCH, NO_PATCH, NO_PATCH]);
});

test('one line is one timestep', () => {
  const { frames } = parsePLClusterTopology(`${LINE}\n${LINE}\n`);
  expect(frames).toHaveLength(2);
});

test('a step with no clusters is still a frame, so the frames stay aligned', () => {
  const { frames } = parsePLClusterTopology(`0\n${LINE}\n`);
  expect(frames).toHaveLength(2);
  expect(frames[0].clusters).toEqual([]);
  expect(frames[0].a).toHaveLength(0);
});

test('blank lines are not timesteps', () => {
  const { frames } = parsePLClusterTopology(`\n${LINE}\n\n`);
  expect(frames).toHaveLength(1);
});

test('a cluster whose bracket is empty contributes nothing', () => {
  const { frames } = parsePLClusterTopology('1 ( 0 ) []');
  expect(frames[0].clusters).toEqual([]);
});

test('a leading count that disagrees with the clusters found is reported', () => {
  const { warnings } = parsePLClusterTopology('5 ( 0 0 ) [0 -> (1), 1 -> (0)]');
  expect(warnings.join(' ')).toMatch(/5/);
});

test('reports no parsable timesteps rather than an empty success', () => {
  expect(() => parsePLClusterTopology('hello\nworld\n')).toThrow(/timestep/i);
});

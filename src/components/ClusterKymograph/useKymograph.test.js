import { renderHook, act } from '@testing-library/react';
import useKymograph from './useKymograph';
import { useParticleStore } from '../../store/particleStore';
import { parsePLClusterTopology } from '../../formats/observables/plClusterTopology';

// Three frames, all of the same two clusters — except that in the last one the
// particle that started in the first cluster has moved into the second.
const OBSERVABLE = parsePLClusterTopology([
  '2 ( 0 0 ) [0 -> (1), 1 -> (0)] ( 0 0 ) [7 -> (8), 8 -> (7)]',
  '2 ( 0 0 ) [0 -> (1), 1 -> (0)] ( 0 0 ) [7 -> (8), 8 -> (7)]',
  '2 ( 0 ) [0 -> (1), 1 -> (0)] ( 0 0 0 ) [7 -> (8 1), 8 -> (7), 1 -> (7)]',
].join('\n'));

beforeEach(() => {
  useParticleStore.setState({
    positions: Array.from({ length: 9 }, () => ({ x: 0, y: 0, z: 0 })),
    currentConfigIndex: 0,
    trajFile: null,
    configIndex: [],
  });
});

test('an observable needs no trajectory read and no clustering', async () => {
  const { result } = renderHook(() => useKymograph());

  await act(async () => {
    // trajFile is null: with an observable there is nothing to read frames for,
    // and requiring one would refuse the very case this path exists for.
    await result.current.compute({ epsilon: 2, minPoints: 3, observable: OBSERVABLE });
  });

  expect(result.current.result.error).toBeNull();
  expect(result.current.result.columns).toHaveLength(3);
  expect(result.current.result.particleCount).toBe(9);
});

test('a particle changing cluster shows up as a change of lineage', async () => {
  const { result } = renderHook(() => useKymograph());
  await act(async () => {
    await result.current.compute({ epsilon: 2, minPoints: 3, observable: OBSERVABLE });
  });

  const [first, , last] = result.current.result.columns;
  // Particle 1 starts with particle 0 and ends with 7 and 8.
  expect(first[1]).toBe(first[0]);
  expect(last[1]).toBe(last[7]);
  expect(last[1]).not.toBe(last[0]);
});

test('a single-frame observable has no time axis and says so', async () => {
  const { result } = renderHook(() => useKymograph());
  await act(async () => {
    await result.current.compute({
      epsilon: 2, minPoints: 3, observable: parsePLClusterTopology('1 ( 0 0 ) [0 -> (1), 1 -> (0)]'),
    });
  });
  expect(result.current.result.error).toMatch(/one frame/i);
});

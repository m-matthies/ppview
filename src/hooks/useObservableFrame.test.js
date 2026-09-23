import { renderHook, act, waitFor } from '@testing-library/react';
import useObservableFrame from './useObservableFrame';
import { useOverlayStore } from '../store/overlayStore';
import { useParticleStore } from '../store/particleStore';
import { useClusteringStore } from '../store/clusteringStore';
import { bondObservableOverlay } from '../utils/overlays';
import { parsePLClusterTopology } from '../formats/observables/plClusterTopology';

// Frame 0 joins 0-1. Frame 1 joins 0-1-2. Frame 2 has no bonds at all.
const OBSERVABLE = parsePLClusterTopology([
  '1 ( 0 0 ) [0 -> (1), 1 -> (0)]',
  '1 ( 0 0 0 ) [0 -> (1 2), 1 -> (0), 2 -> (0)]',
  '0',
].join('\n'));

const register = () => useOverlayStore.getState().addOverlay(bondObservableOverlay({
  name: 'bonds', observable: OBSERVABLE, colorScheme: 'default',
}));

const overlayNow = (id) => useOverlayStore.getState().overlays.find(o => o.id === id);
const goToFrame = (index) => act(() => {
  useParticleStore.setState({ currentConfigIndex: index });
});

beforeEach(() => {
  useOverlayStore.getState().clearOverlays();
  useClusteringStore.getState().resetClusters();
  useParticleStore.setState({ currentConfigIndex: 0, bonds: null });
});

test('the overlay follows the frame on screen', async () => {
  const { id } = register();
  renderHook(() => useObservableFrame());

  expect(overlayNow(id).clusters[0].indices).toEqual([0, 1]);

  goToFrame(1);
  await waitFor(() => expect(overlayNow(id).clusters[0].indices).toEqual([0, 1, 2]));
});

test('a frame with no bonds leaves no clusters behind', async () => {
  const { id } = register();
  renderHook(() => useObservableFrame());

  goToFrame(2);
  await waitFor(() => expect(overlayNow(id).clusters).toEqual([]));
  expect(overlayNow(id).colors.size).toBe(0);
});

test('bonds reach the renderer only while that observable is the cluster source', async () => {
  const { id } = register();
  renderHook(() => useObservableFrame());

  // The pane's source defaults to DBSCAN, so nothing is drawn yet.
  expect(useParticleStore.getState().bonds).toBeNull();

  act(() => useClusteringStore.getState().setClusterSourceId(id));
  await waitFor(() => expect(useParticleStore.getState().bonds).not.toBeNull());
  expect(Array.from(useParticleStore.getState().bonds.a)).toEqual([0]);

  act(() => useClusteringStore.getState().setClusterSourceId(null));
  await waitFor(() => expect(useParticleStore.getState().bonds).toBeNull());
});

test('a frame in which nothing is bonded draws no bonds', async () => {
  const { id } = register();
  renderHook(() => useObservableFrame());
  act(() => useClusteringStore.getState().setClusterSourceId(id));

  goToFrame(2);
  await waitFor(() => expect(useParticleStore.getState().bonds).toBeNull());
});

test('a cluster file is not touched, however the frame moves', async () => {
  const entry = useOverlayStore.getState().addOverlay({
    name: 'file', kind: 'clusters', clusters: [{ indices: [3] }], colors: new Map([[3, '#fff']]),
  });
  renderHook(() => useObservableFrame());

  const before = overlayNow(entry.id);
  goToFrame(1);
  goToFrame(2);
  expect(overlayNow(entry.id)).toBe(before);
});

test('settling on a frame stops rewriting the overlay', async () => {
  // Every overlay write re-renders all five renderers, and this effect re-runs
  // on its own writes — so it has to converge rather than loop.
  const { id } = register();
  renderHook(() => useObservableFrame());
  goToFrame(1);

  await waitFor(() => expect(overlayNow(id).frameIndex).toBe(1));
  const settled = overlayNow(id);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(overlayNow(id)).toBe(settled);
});

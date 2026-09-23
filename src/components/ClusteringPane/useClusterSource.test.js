import { renderHook, act, waitFor } from '@testing-library/react';
import useClusterSource from './useClusterSource';
import useObservableFrame from '../../hooks/useObservableFrame';
import { useOverlayStore } from '../../store/overlayStore';
import { useClusteringStore } from '../../store/clusteringStore';
import { useParticleStore } from '../../store/particleStore';
import { bondObservableOverlay, clusterOverlayFromFile } from '../../utils/overlays';
import { parsePLClusterTopology } from '../../formats/observables/plClusterTopology';

// Frame 0 holds clusters of 2, 3 and 5 particles; frame 1 holds one of 8.
const OBSERVABLE = parsePLClusterTopology([
  '3 ( 0 0 ) [0 -> (1), 1 -> (0)]'
  + ' ( 0 0 0 ) [2 -> (3 4), 3 -> (2), 4 -> (2)]'
  + ' ( 0 0 0 0 0 ) [5 -> (6 7 8 9), 6 -> (5), 7 -> (5), 8 -> (5), 9 -> (5)]',
  '1 ( 0 ) [0 -> (1 2 3 4 5 6 7), 1 -> (0), 2 -> (0), 3 -> (0),'
  + ' 4 -> (0), 5 -> (0), 6 -> (0), 7 -> (0)]',
].join('\n'));

const sizes = (result) => result.current.clusters.map(c => c.length);

const useObservableSource = () => {
  const entry = useOverlayStore.getState().addOverlay(bondObservableOverlay({
    name: 'bonds', observable: OBSERVABLE, colorScheme: 'default',
  }));
  useClusteringStore.getState().setClusterSourceId(entry.id);
  return entry;
};

beforeEach(() => {
  useOverlayStore.getState().clearOverlays();
  useClusteringStore.getState().resetClusters();
  useParticleStore.setState({ positions: [], currentConfigIndex: 0, loadedConfigIndex: 0 });
});

describe('the size band applies to clusters from a file, not only to DBSCAN', () => {
  test('everything is kept by default', () => {
    useObservableSource();
    const { result } = renderHook(() => useClusterSource());
    expect(sizes(result)).toEqual([2, 3, 5]);
  });

  test('raising the lower end drops the small clusters', () => {
    useObservableSource();
    const { result } = renderHook(() => useClusterSource());
    act(() => result.current.setMinClusterSize(3));
    expect(sizes(result)).toEqual([3, 5]);
  });

  test('lowering the upper end drops the large ones', () => {
    useObservableSource();
    const { result } = renderHook(() => useClusterSource());
    act(() => { result.current.setMinClusterSize(3); result.current.setMaxClusterSize(3); });
    expect(sizes(result)).toEqual([3]);
  });

  test('it works for a static cluster file too', () => {
    const entry = useOverlayStore.getState().addOverlay(clusterOverlayFromFile({
      name: 'file',
      clusters: [
        { name: 'a', color: null, visible: true, indices: [0] },
        { name: 'b', color: null, visible: true, indices: [1, 2, 3] },
      ],
      colorScheme: 'default',
    }));
    useClusteringStore.getState().setClusterSourceId(entry.id);
    const { result } = renderHook(() => useClusterSource());
    act(() => result.current.setMinClusterSize(2));
    expect(sizes(result)).toEqual([3]);
  });
});

describe('the filtered list stays aligned with the file entries', () => {
  test('fileClusters is filtered too, so colours are not read off by index', () => {
    // clusterColorAt looks up `fileClusters[index].color`, and ClusterList reads
    // names and visibility the same way. Filtering one list and not the other
    // shifts every entry after the first removal onto a neighbour's colour.
    useObservableSource();
    const { result } = renderHook(() => useClusterSource());
    act(() => result.current.setMinClusterSize(3));

    expect(result.current.fileClusters).toHaveLength(result.current.clusters.length);
    result.current.fileClusters.forEach((entry, i) => {
      expect(entry.indices).toEqual(result.current.clusters[i]);
    });
  });
});

describe('the slider ceiling', () => {
  test('is the largest cluster anywhere in the observable, not just this frame', () => {
    // It moves the upper thumb, so taking it from the frame on screen would
    // make it jump about while the trajectory plays.
    useObservableSource();
    const { result } = renderHook(() => useClusterSource());
    expect(result.current.largestCluster).toBe(8);
  });

  test('is the largest cluster in a static file', () => {
    const entry = useOverlayStore.getState().addOverlay(clusterOverlayFromFile({
      name: 'file',
      clusters: [
        { name: 'a', color: null, visible: true, indices: [0] },
        { name: 'b', color: null, visible: true, indices: [1, 2, 3] },
      ],
      colorScheme: 'default',
    }));
    useClusteringStore.getState().setClusterSourceId(entry.id);
    const { result } = renderHook(() => useClusterSource());
    expect(result.current.largestCluster).toBe(3);
  });
});

// Frame 0 holds two clusters, frame 1 holds three — the shape of an observable,
// where the cluster count is a property of the frame.
const GROWING = parsePLClusterTopology([
  '2 ( 0 0 ) [0 -> (1), 1 -> (0)] ( 0 0 ) [2 -> (3), 3 -> (2)]',
  '3 ( 0 0 ) [0 -> (1), 1 -> (0)] ( 0 0 ) [2 -> (3), 3 -> (2)]'
  + ' ( 0 0 ) [4 -> (5), 5 -> (4)]',
].join('\n'));

describe('"Select all" keeps meaning all as the frame changes', () => {
  const mount = () => {
    const entry = useOverlayStore.getState().addOverlay(bondObservableOverlay({
      name: 'bonds', observable: GROWING, colorScheme: 'default',
    }));
    useClusteringStore.getState().setClusterSourceId(entry.id);
    return renderHook(() => {
      useObservableFrame();
      return useClusterSource();
    });
  };
  const selected = () => [...useClusteringStore.getState().selectedClusters];
  // Both, because the overlay follows the frame whose positions have loaded.
  const goToFrame = (i) => act(() => {
    useParticleStore.setState({ currentConfigIndex: i, loadedConfigIndex: i });
  });

  test('a cluster appearing is selected too', async () => {
    const { result } = mount();
    expect(result.current.clusters).toHaveLength(2);
    act(() => useClusteringStore.getState().selectAllClusters(2));

    goToFrame(1);
    await waitFor(() => expect(result.current.clusters).toHaveLength(3));
    // Without the latch this stayed [0, 1] — "select all" pressed at one frame
    // silently becoming "the first two of three".
    expect(selected()).toEqual([0, 1, 2]);
  });

  test('and going back again narrows it to what is there', async () => {
    const { result } = mount();
    goToFrame(1);
    await waitFor(() => expect(result.current.clusters).toHaveLength(3));
    act(() => useClusteringStore.getState().selectAllClusters(3));

    goToFrame(0);
    await waitFor(() => expect(result.current.clusters).toHaveLength(2));
    expect(selected()).toEqual([0, 1]);
    expect(useClusteringStore.getState().allClustersSelected).toBe(true);
  });

  test('a selection of some clusters is not grown behind your back', async () => {
    const { result } = mount();
    act(() => useClusteringStore.getState().setSelectedClusters(new Set([0, 1])));

    goToFrame(1);
    await waitFor(() => expect(result.current.clusters).toHaveLength(3));
    // Every cluster was selected, but by choosing them — not by asking for all.
    expect(selected()).toEqual([0, 1]);
  });

  test('indices that no longer name a cluster are still pruned', async () => {
    const { result } = mount();
    goToFrame(1);
    await waitFor(() => expect(result.current.clusters).toHaveLength(3));
    act(() => useClusteringStore.getState().setSelectedClusters(new Set([0, 2])));

    goToFrame(0);
    await waitFor(() => expect(result.current.clusters).toHaveLength(2));
    expect(selected()).toEqual([0]);
  });
});

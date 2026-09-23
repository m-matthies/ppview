import { renderHook, act } from '@testing-library/react';
import useClusterSource from './useClusterSource';
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
  useParticleStore.setState({ positions: [], currentConfigIndex: 0 });
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

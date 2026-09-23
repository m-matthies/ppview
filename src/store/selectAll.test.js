import { useClusteringStore } from './clusteringStore';

beforeEach(() => useClusteringStore.getState().resetClusters());

const state = () => useClusteringStore.getState();

describe('"Select all" is a mode, not a snapshot', () => {
  test('selecting all records that it was "all", not just which indices', () => {
    // A cluster/bond observable states a different number of clusters every
    // frame — 240 at the start of one run and 581 at the end — so a selection
    // remembered as {0..239} silently becomes "the first 240 of 581".
    state().selectAllClusters(3);
    expect([...state().selectedClusters]).toEqual([0, 1, 2]);
    expect(state().allClustersSelected).toBe(true);
  });

  test('any other selection leaves the mode behind', () => {
    state().selectAllClusters(3);
    state().setSelectedClusters(new Set([1]));
    expect(state().allClustersSelected).toBe(false);
  });

  test('clearing the selection leaves it behind too', () => {
    state().selectAllClusters(3);
    state().setSelectedClusters(new Set());
    expect(state().allClustersSelected).toBe(false);
  });

  test('a new structure forgets it', () => {
    state().selectAllClusters(3);
    state().resetClusters();
    expect(state().allClustersSelected).toBe(false);
  });

  test('clearing the clustering forgets it', () => {
    state().selectAllClusters(3);
    state().resetClusterState();
    expect(state().allClustersSelected).toBe(false);
  });
});

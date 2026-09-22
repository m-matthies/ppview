import { useClusteringStore, isSceneRestricted } from './clusteringStore';

const restricted = () => isSceneRestricted(useClusteringStore.getState());

beforeEach(() => {
  useClusteringStore.getState().resetClusterState();
});

describe('isSceneRestricted', () => {
  it('is false for an untouched scene', () => {
    expect(restricted()).toBe(false);
  });

  it('stays true after Select all', () => {
    // The reported bug. Comparing selected clusters against the cluster count
    // made this false the moment every cluster was selected, taking both reset
    // buttons off screen — while the scene was still visibly clustered, and any
    // particle DBSCAN left as noise was still hidden.
    useClusteringStore.setState({
      showOnlyHighlightedClusters: true,
      highlightedClusters: new Set(Array.from({ length: 40 }, (_, i) => i)),
    });
    expect(restricted()).toBe(true);
  });

  it('is true with "show only selected" on and nothing selected', () => {
    // Everything is hidden in this state, which is the one most in need of a
    // way out.
    useClusteringStore.setState({
      showOnlyHighlightedClusters: true, highlightedClusters: new Set(),
    });
    expect(restricted()).toBe(true);
  });

  it('is true whenever a cluster is hidden by its eye, selection aside', () => {
    useClusteringStore.setState({ hiddenParticles: new Set([3]) });
    expect(restricted()).toBe(true);
  });

  it('ignores selection while "show only selected" is off', () => {
    // Selection alone changes nothing on screen; offering to undo it is noise.
    useClusteringStore.setState({
      showOnlyHighlightedClusters: false,
      highlightedClusters: new Set([0, 1, 2]),
    });
    expect(restricted()).toBe(false);
  });

  it('is false again after the clustering is cleared', () => {
    useClusteringStore.setState({
      showOnlyHighlightedClusters: true,
      highlightedClusters: new Set([0]),
      hiddenParticles: new Set([1]),
    });
    useClusteringStore.getState().resetClusterState();
    expect(restricted()).toBe(false);
  });
});

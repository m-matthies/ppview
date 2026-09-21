import { clearClustering } from './commands';
import { useClusteringStore } from './clusteringStore';
import { useOverlayStore, COMPUTED_VIEW } from './overlayStore';

const clusterOverlay = (name) => ({ name, kind: 'clusters', colors: new Map(), clusters: [] });
const scalarOverlay = (name) => ({ name, kind: 'scalar', colors: new Map() });

beforeEach(() => {
  useOverlayStore.getState().clearOverlays();
  useClusteringStore.getState().resetClusterState();
});

describe('clearClustering', () => {
  it('clears selection, hiding and the published sets', () => {
    useClusteringStore.setState({
      selectedClusters: new Set([0, 1]),
      showOnlySelected: true,
      hiddenClusters: new Set([2]),
      highlightedClusters: new Set([5]),
      clusterColors: new Map([[1, '#ff0000']]),
      hiddenParticles: new Set([9]),
    });

    clearClustering();

    const state = useClusteringStore.getState();
    expect(state.selectedClusters.size).toBe(0);
    expect(state.showOnlySelected).toBe(false);
    expect(state.hiddenClusters.size).toBe(0);
    expect(state.highlightedClusters.size).toBe(0);
    expect(state.clusterColors.size).toBe(0);
    expect(state.hiddenParticles.size).toBe(0);
  });

  it('points the View back at the computed clusters, not at null', () => {
    // null is not a state a fresh load ever produces; landing there left the
    // next selection rendering in particle-type colours for no visible reason.
    const overlay = useOverlayStore.getState().addOverlay(clusterOverlay('run1'));
    expect(useOverlayStore.getState().activeOverlayId).toBe(overlay.id);

    clearClustering();

    expect(useOverlayStore.getState().activeOverlayId).toBe(COMPUTED_VIEW);
  });

  it('leaves a non-cluster overlay active', () => {
    // A scalar-property overlay is a colour view the person chose; this button
    // undoes clustering, not that.
    const overlay = useOverlayStore.getState().addOverlay(scalarOverlay('charge'));

    clearClustering();

    expect(useOverlayStore.getState().activeOverlayId).toBe(overlay.id);
  });

  it('keeps registered overlays: it clears the view, not the library', () => {
    useOverlayStore.getState().addOverlay(clusterOverlay('run1'));
    clearClustering();
    expect(useOverlayStore.getState().overlays).toHaveLength(1);
  });

  it('is safe with no overlay active at all', () => {
    expect(() => clearClustering()).not.toThrow();
    expect(useOverlayStore.getState().activeOverlayId).toBe(COMPUTED_VIEW);
  });
});

describe('store independence', () => {
  it('clusteringStore does not reach into overlayStore', async () => {
    // The combined action lives in commands.js precisely so neither store needs
    // to know about the other; a second cross-store action would otherwise
    // close a cycle.
    const source = await import('./clusteringStore');
    expect(Object.keys(source)).not.toContain('useOverlayStore');
    expect(useClusteringStore.getState().clearClustering).toBeUndefined();
  });
});

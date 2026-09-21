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
  // Reads the file. An earlier version of this test imported the module and
  // checked Object.keys(source) — which lists *exports*, so it passed just as
  // happily with the cross-store import present. A guard that cannot fail is
  // worse than none, because it is believed.
  const sourceOf = (file) =>
    require('fs').readFileSync(require('path').join(__dirname, file), 'utf8');

  it('clusteringStore does not import overlayStore', () => {
    expect(sourceOf('clusteringStore.js')).not.toMatch(/from\s+['"]\.\/overlayStore['"]/);
  });

  it('overlayStore does not import clusteringStore', () => {
    expect(sourceOf('overlayStore.js')).not.toMatch(/from\s+['"]\.\/clusteringStore['"]/);
  });

  it('commands.js is the only place that imports both', () => {
    const commands = sourceOf('commands.js');
    expect(commands).toMatch(/from\s+['"]\.\/clusteringStore['"]/);
    expect(commands).toMatch(/from\s+['"]\.\/overlayStore['"]/);
  });

  it('the combined action is not on the store itself', () => {
    expect(useClusteringStore.getState().clearClustering).toBeUndefined();
  });
});

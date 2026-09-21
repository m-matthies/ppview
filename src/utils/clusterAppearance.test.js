import * as THREE from 'three';
import {
  getClusterAppearance,
  clusterColorFor,
  CLUSTER_HIGHLIGHT_SCALE,
  CLUSTER_HIDDEN_SCALE,
  CLUSTER_DIMMED_SCALE,
  CLUSTER_DIMMED_COLOR,
  SELECTED_COLOR,
} from './clusterAppearance';

const BASE = new THREE.Color('red');
const CLUSTER = new THREE.Color('blue');

// Every case below is "what does one particle look like", so a helper that
// fills in the unremarkable defaults keeps the interesting field visible.
const appearance = (overrides) => getClusterAppearance({ baseColor: BASE, ...overrides });

describe('getClusterAppearance precedence', () => {
  // The order of these branches is the whole contract: each one has been the
  // cause of a real bug when it sat in the wrong place.

  it('hides an explicitly hidden cluster even when it is selected', () => {
    // The eye control has to work on a cluster you have selected, or it looks
    // broken. This is why forceHidden is checked before selection.
    const out = appearance({ forceHidden: true, isSelected: true });
    expect(out).toEqual({ color: BASE, scaleFactor: CLUSTER_HIDDEN_SCALE, hidden: true });
  });

  it('hides an explicitly hidden cluster even when it is highlighted', () => {
    const out = appearance({
      forceHidden: true, isInHighlightedCluster: true, hasHighlightedClusters: true,
    });
    expect(out.hidden).toBe(true);
    expect(out.scaleFactor).toBe(CLUSTER_HIDDEN_SCALE);
  });

  it('shows a selected particle that its cluster state would otherwise hide', () => {
    // Selection outranks "show only selected clusters": you can always see what
    // you picked, even if it belongs to a cluster that is switched off.
    const out = appearance({
      isSelected: true, showOnlyHighlightedClusters: true, shouldShow: false,
    });
    expect(out.color).toBe(SELECTED_COLOR);
    expect(out.scaleFactor).toBe(1);
    expect(out.hidden).toBeUndefined();
  });

  it('keeps the highlight scale when a highlighted particle is selected', () => {
    // Dropping to 1.0 moved the geometry out from under the cursor, so a second
    // modifier-click on the same pixel hit whatever was behind it and added
    // that instead of deselecting.
    const out = appearance({
      isSelected: true, isInHighlightedCluster: true, hasHighlightedClusters: true,
    });
    expect(out.scaleFactor).toBe(CLUSTER_HIGHLIGHT_SCALE);
    expect(out.color).toBe(SELECTED_COLOR);
  });

  it('does not inflate a selected particle that is not in a highlighted cluster', () => {
    expect(appearance({ isSelected: true }).scaleFactor).toBe(1);
    // ...nor when clusters exist but this particle is in none of them.
    expect(appearance({ isSelected: true, hasHighlightedClusters: true }).scaleFactor).toBe(1);
    // ...nor when it is in one but nothing is highlighted.
    expect(appearance({ isSelected: true, isInHighlightedCluster: true }).scaleFactor).toBe(1);
  });
});

describe('getClusterAppearance highlighting', () => {
  it('paints a highlighted particle in its cluster colour, enlarged', () => {
    const out = appearance({
      isInHighlightedCluster: true, hasHighlightedClusters: true, clusterColor: CLUSTER,
    });
    expect(out).toEqual({ color: CLUSTER, scaleFactor: CLUSTER_HIGHLIGHT_SCALE });
  });

  it('falls back to the base colour when the cluster has none', () => {
    const out = appearance({ isInHighlightedCluster: true, hasHighlightedClusters: true });
    expect(out.color).toBe(BASE);
    expect(out.scaleFactor).toBe(CLUSTER_HIGHLIGHT_SCALE);
  });

  it('ignores cluster membership while nothing is highlighted', () => {
    // hasHighlightedClusters is what distinguishes "no selection yet" from
    // "selected, and this particle is not in it".
    const out = appearance({ isInHighlightedCluster: true, hasHighlightedClusters: false });
    expect(out).toEqual({ color: BASE, scaleFactor: 1 });
  });
});

describe('getClusterAppearance hiding', () => {
  it('hides a particle outside the shown clusters', () => {
    const out = appearance({ showOnlyHighlightedClusters: true, shouldShow: false });
    expect(out).toEqual({ color: BASE, scaleFactor: CLUSTER_HIDDEN_SCALE, hidden: true });
  });

  it('leaves a faint marker instead when dimming is on', () => {
    const out = appearance({
      showOnlyHighlightedClusters: true, shouldShow: false, dimNonSelectedClusters: true,
    });
    expect(out).toEqual({
      color: CLUSTER_DIMMED_COLOR, scaleFactor: CLUSTER_DIMMED_SCALE, dimmed: true,
    });
    // dimmed and hidden are distinct signals: RepulsionSites collapses its beads
    // for both, but Particles draws its centre sphere only for dimmed.
    expect(out.hidden).toBeUndefined();
  });

  it('does not hide anything while "show only selected" is off', () => {
    const out = appearance({ showOnlyHighlightedClusters: false, shouldShow: false });
    expect(out).toEqual({ color: BASE, scaleFactor: 1 });
  });

  it('leaves a particle inside the shown clusters alone', () => {
    const out = appearance({ showOnlyHighlightedClusters: true, shouldShow: true });
    expect(out).toEqual({ color: BASE, scaleFactor: 1 });
  });
});

describe('getClusterAppearance for patches', () => {
  it('keeps the patch colour when its particle is selected', () => {
    // A patch colour encodes its patch ID; turning it yellow would throw that
    // away. It still follows the scale, so patches grow and vanish with their
    // particle.
    const out = appearance({ isSelected: true, allowSelectionColor: false });
    expect(out.color).toBe(BASE);
    expect(out.scaleFactor).toBe(1);
  });

  it('still follows the highlight scale with the selection colour suppressed', () => {
    const out = appearance({
      isSelected: true, allowSelectionColor: false,
      isInHighlightedCluster: true, hasHighlightedClusters: true,
    });
    expect(out.color).toBe(BASE);
    expect(out.scaleFactor).toBe(CLUSTER_HIGHLIGHT_SCALE);
  });
});

describe('getClusterAppearance defaults', () => {
  it('is a plain particle when nothing is going on', () => {
    expect(appearance({})).toEqual({ color: BASE, scaleFactor: 1 });
  });
});

describe('clusterColorFor', () => {
  it('returns null when the particle has no cluster colour', () => {
    expect(clusterColorFor(new Map(), 0, THREE)).toBeNull();
    expect(clusterColorFor(null, 0, THREE)).toBeNull();
    expect(clusterColorFor(undefined, 7, THREE)).toBeNull();
  });

  it('converts a hex string to a THREE.Color', () => {
    const colors = new Map([[3, '#ff0000']]);
    const color = clusterColorFor(colors, 3, THREE);
    expect(color.getHexString()).toBe('ff0000');
  });

  it('returns the same object for the same hex, across calls and maps', () => {
    // Renderers write colours per instance per update; allocating a Color each
    // time is the allocation this cache exists to avoid.
    const first = clusterColorFor(new Map([[1, '#00ff00']]), 1, THREE);
    const second = clusterColorFor(new Map([[2, '#00ff00']]), 2, THREE);
    expect(second).toBe(first);
  });
});

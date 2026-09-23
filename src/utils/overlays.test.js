import * as THREE from 'three';
import {
  clusterOverlayFromFile, overlayColorFor, bondObservableOverlay, observableFrameView,
} from './overlays';
import { parsePLClusterTopology } from '../formats/observables/plClusterTopology';

const cluster = (indices, color = null) => ({ name: 'c', color, visible: true, indices });

describe('clusterOverlayFromFile', () => {
  it('maps every particle in a cluster to that cluster colour', () => {
    const overlay = clusterOverlayFromFile({
      name: 'run1',
      clusters: [cluster([0, 1], '#ff0000'), cluster([2], '#00ff00')],
      colorScheme: 'scientific',
    });
    expect(overlay.colors.get(0)).toBe('#ff0000');
    expect(overlay.colors.get(1)).toBe('#ff0000');
    expect(overlay.colors.get(2)).toBe('#00ff00');
  });

  it('leaves unclustered particles out of the map entirely', () => {
    // Renderers fall back to the type colour for a missing entry. Painting them
    // some "unassigned" shade would claim the file said something about them.
    const overlay = clusterOverlayFromFile({
      name: 'run1', clusters: [cluster([0])], colorScheme: 'scientific',
    });
    expect(overlay.colors.has(1)).toBe(false);
    expect(overlay.colors.size).toBe(1);
  });

  it('falls back to the palette when a cluster has no colour', () => {
    const overlay = clusterOverlayFromFile({
      name: 'run1', clusters: [cluster([0]), cluster([1])], colorScheme: 'scientific',
    });
    expect(overlay.colors.get(0)).toBeTruthy();
    expect(overlay.colors.get(1)).toBeTruthy();
    expect(overlay.colors.get(0)).not.toBe(overlay.colors.get(1));
  });

  it("prefers the file's colour over the palette", () => {
    const overlay = clusterOverlayFromFile({
      name: 'run1', clusters: [cluster([0], '#123456')], colorScheme: 'scientific',
    });
    expect(overlay.colors.get(0)).toBe('#123456');
  });

  it('is tagged as a cluster overlay', () => {
    // The pane lists only cluster overlays, and clearClustering only resets the
    // View for one; both key off this.
    const overlay = clusterOverlayFromFile({
      name: 'run1', clusters: [cluster([0])], colorScheme: 'scientific',
    });
    expect(overlay.kind).toBe('clusters');
    expect(overlay.name).toBe('run1');
    expect(overlay.clusters).toHaveLength(1);
  });

  it('summarises the cluster count, singular and plural', () => {
    const one = clusterOverlayFromFile({
      name: 'a', clusters: [cluster([0])], colorScheme: 'scientific',
    });
    const two = clusterOverlayFromFile({
      name: 'b', clusters: [cluster([0]), cluster([1])], colorScheme: 'scientific',
    });
    expect(one.summary).toBe('1 cluster');
    expect(two.summary).toBe('2 clusters');
  });

  it('lets a later cluster win an overlapping particle', () => {
    // Files should not overlap, but if one does, the result must be defined
    // rather than depending on Map iteration luck.
    const overlay = clusterOverlayFromFile({
      name: 'a',
      clusters: [cluster([0], '#111111'), cluster([0], '#222222')],
      colorScheme: 'scientific',
    });
    expect(overlay.colors.get(0)).toBe('#222222');
  });
});

describe('overlayColorFor', () => {
  it('returns null for a particle the overlay does not cover', () => {
    expect(overlayColorFor(new Map(), 0, THREE)).toBeNull();
    expect(overlayColorFor(null, 0, THREE)).toBeNull();
  });

  it('converts hex to a THREE.Color', () => {
    expect(overlayColorFor(new Map([[0, '#0000ff']]), 0, THREE).getHexString()).toBe('0000ff');
  });

  it('caches by hex, since renderers call it per instance per update', () => {
    const first = overlayColorFor(new Map([[0, '#abcdef']]), 0, THREE);
    const second = overlayColorFor(new Map([[9, '#abcdef']]), 9, THREE);
    expect(second).toBe(first);
  });
});

describe('bondObservableOverlay', () => {
  const TWO_FRAMES = [
    // Frame 0: {0,1,2} and {7,8}
    '2 ( 0 0 0 ) [0 -> (1 2), 1 -> (0), 2 -> (0)] ( 0 0 ) [7 -> (8), 8 -> (7)]',
    // Frame 1: the first cluster has lost particle 2, and they have swapped order
    '2 ( 0 0 ) [7 -> (8), 8 -> (7)] ( 0 0 ) [0 -> (1), 1 -> (0)]',
  ].join('\n');

  const overlay = () => bondObservableOverlay({
    name: 'bonds',
    observable: parsePLClusterTopology(TWO_FRAMES),
    colorScheme: 'default',
  });

  test('an observable overlay looks like a loaded cluster file at any one frame', () => {
    const view = observableFrameView(overlay().observable, 0);
    expect(view.clusters).toEqual([
      expect.objectContaining({ indices: [0, 1, 2], visible: true }),
      expect.objectContaining({ indices: [7, 8], visible: true }),
    ]);
  });

  test('every particle in a cluster is coloured, and particles in none are not', () => {
    const { colors } = observableFrameView(overlay().observable, 0);
    expect(colors.get(0)).toBe(colors.get(1));
    expect(colors.get(0)).not.toBe(colors.get(7));
    expect(colors.has(4)).toBe(false);
  });

  test('a cluster keeps its colour when the frame changes', () => {
    const observable = overlay().observable;
    const before = observableFrameView(observable, 0);
    const after = observableFrameView(observable, 1);
    // {0,1,2} became {0,1} and moved from index 0 to index 1 in the list.
    expect(after.colors.get(0)).toBe(before.colors.get(0));
    expect(after.colors.get(7)).toBe(before.colors.get(7));
  });

  test('the frame carries its bonds for the renderer', () => {
    const { bonds } = observableFrameView(overlay().observable, 0);
    expect(Array.from(bonds.a)).toEqual([0, 0, 7]);
    expect(Array.from(bonds.b)).toEqual([1, 2, 8]);
  });

  test('the overlay starts on the first frame, so it is never blank before a frame change', () => {
    const built = overlay();
    expect(built.clusters).toHaveLength(2);
    expect(built.colors.size).toBe(5);
    expect(built.kind).toBe('clusters');
  });

  test('the summary names the observable, since the three behave differently', () => {
    expect(overlay().summary).toMatch(/PLClusterTopology/);
  });

  test('a frame index past the end yields nothing rather than throwing', () => {
    const view = observableFrameView(overlay().observable, 99);
    expect(view.clusters).toEqual([]);
    expect(view.colors.size).toBe(0);
  });
});

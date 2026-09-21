import * as THREE from 'three';
import { clusterOverlayFromFile, overlayColorFor } from './overlays';

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

import { getParticleColors } from '../colors';
import { colourFrames } from '../formats/observables/bondFrames';
import { observableById } from '../formats/observables';

/**
 * Builds an overlay from a parsed clusters file.
 *
 * Every particle in a cluster takes that cluster's colour; particles in no
 * cluster are left out of the map, so renderers fall back to the type colour
 * for them rather than being painted a misleading "unassigned" shade.
 */
export function clusterOverlayFromFile({ name, clusters, colorScheme }) {
  const palette = getParticleColors(colorScheme, 12);
  const colors = new Map();

  clusters.forEach((cluster, index) => {
    const color = cluster.color ?? palette[index % palette.length];
    cluster.indices.forEach(particleIndex => colors.set(particleIndex, color));
  });

  return {
    name,
    kind: 'clusters',
    colors,
    clusters,
    summary: `${clusters.length} cluster${clusters.length === 1 ? '' : 's'}`,
  };
}

const EMPTY_FRAME = { a: [], b: [], patchA: [], patchB: [], clusters: [] };

/**
 * One frame of a cluster/bond observable, shaped exactly like a loaded cluster
 * file.
 *
 * This is what lets a per-timestep observable use the whole of the clustering
 * pane — the list, the swatches, the histogram, selection, per-cluster
 * visibility, the scene colours — without any of it learning about frames. At
 * any one instant an observable overlay is indistinguishable from a
 * `clusters.json`; a hook swaps its contents as the frame changes.
 *
 * `bonds` rides along for the renderer, which is the one consumer that wants
 * the graph rather than the grouping.
 */
export function observableFrameView(observable, frameIndex) {
  const frame = observable.frames[frameIndex];
  if (!frame) return { clusters: [], colors: new Map(), bonds: EMPTY_FRAME };

  const colours = observable.colours[frameIndex];
  const colors = new Map();
  const clusters = frame.clusters.map((indices, index) => {
    const color = colours[index];
    for (const particle of indices) colors.set(particle, color);
    return {
      name: `Cluster ${index + 1}`,
      color,
      // Nothing in any of the three formats says a cluster starts hidden.
      visible: true,
      indices,
    };
  });

  return { clusters, colors, bonds: frame };
}

/**
 * Builds an overlay from a parsed cluster/bond observable.
 *
 * Colours are decided here, once, for every frame — see `colourFrames`. Doing
 * it per frame as the trajectory plays would make a cluster's colour depend on
 * which direction you scrubbed from.
 */
export function bondObservableOverlay({ name, observable, colorScheme }) {
  const palette = getParticleColors(colorScheme, 12);
  const enriched = {
    ...observable,
    colours: colourFrames(observable.frames, palette),
    label: observableById(observable.format)?.label ?? observable.format,
  };

  const steps = enriched.frames.length;
  return {
    name,
    // Deliberately the same kind as a cluster file: everything downstream
    // treats the two identically, which is the whole point of the frame view.
    kind: 'clusters',
    observable: enriched,
    summary: `${enriched.label}, ${steps} timestep${steps === 1 ? '' : 's'}`,
    // Start on the first frame, so the overlay is never blank before the first
    // frame change — a scene that only colours itself once you scrub would read
    // as the file not having loaded.
    ...observableFrameView(enriched, 0),
  };
}

/**
 * Caches hex → THREE.Color. Renderers call this per instance per update, so
 * allocating a Color each time would be the hot path.
 */
const cache = new Map();

export function overlayColorFor(colors, particleIndex, THREE) {
  const hex = colors?.get(particleIndex);
  if (!hex) return null;
  let color = cache.get(hex);
  if (!color) {
    color = new THREE.Color(hex);
    cache.set(hex, color);
  }
  return color;
}

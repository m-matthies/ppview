import { dbscan as wasmDbscan } from '../wasm/wasmCore';

/**
 * Cluster analysis, kept away from the pane that displays it.
 *
 * Pure functions over `[{x, y, z}]`, so they work for every format — the
 * analysis side was never format-specific, only its rendering was.
 */

/**
 * The largest cutoff the minimum image convention can actually represent.
 *
 * Beyond half the shortest box dimension the nearest image stops being unique:
 * a particle comes back into range as its own neighbour from the other side,
 * and pairs get counted through two images at once. Every MD code imposes the
 * same limit on its interaction cutoff, and DBSCAN needs it for the same
 * reason — past it the neighbour counts are not merely approximate, they are
 * wrong in a way that invents clusters.
 */
export function maxMinimumImageRadius(boxSize) {
  if (!boxSize) return Infinity;
  const dimensions = Array.from(boxSize).filter(d => d > 0);
  return dimensions.length ? Math.min(...dimensions) / 2 : Infinity;
}

/**
 * DBSCAN over `[{x, y, z}]`, as defined by Ester et al. (1996).
 *
 * The implementation is Rust, compiled to WebAssembly — see `wasm/src/lib.rs`
 * and `src/wasm/wasmCore.js`. There was a JavaScript one beside it, and
 * maintaining both was not worth it: the same algorithm in two languages, kept
 * in step by a suite that compared them, when one was twenty times faster and
 * always the one that ran.
 *
 * The behaviour it implements, which the tests here pin:
 *
 * `minPoints` counts the point itself, so `minPoints: 3` means "three particles
 * within epsilon, including this one" — the textbook definition, and the one
 * every other tool in this space uses. It is a **density**, not a minimum
 * cluster size: raising it stops particles being core points, so a cluster held
 * together through a thin waist comes apart. The pane offers a size filter
 * separately, which runs afterwards and can only remove whole clusters.
 *
 * A point with at least `minPoints` neighbours is a **core** point and extends
 * its cluster. A point within epsilon of a core point but not core itself is a
 * **border** point: it joins that cluster but does not extend it, which stops
 * two dense groups linked by a thin trail of stragglers being reported as one.
 * Anything else is noise — though a point rejected as noise early can still be
 * picked up later as a border point.
 *
 * `boxSize` is `[lx, ly, lz]` and makes distances periodic, under the minimum
 * image convention; omitting it measures plain Euclidean distance, which is what
 * a non-periodic system wants. `epsilon` is capped at
 * `maxMinimumImageRadius(boxSize)`, past which the nearest image stops being
 * unique and pairs get counted through two images at once.
 *
 * Neighbour search is a uniform grid rather than a scan of every point, which is
 * what took 20,000 particles from 59.8s to 44 ms.
 */
export const dbscan = (points, epsilon, minPoints, boxSize = null) =>
  wasmDbscan(points, epsilon, minPoints, boxSize);

// Generate histogram data - shows how many clusters have each size
export function generateHistogram(clusterSizes) {
  if (clusterSizes.length === 0) return [];
  
  // Create a frequency map of cluster sizes
  const sizeFrequency = new Map();
  clusterSizes.forEach(size => {
    sizeFrequency.set(size, (sizeFrequency.get(size) || 0) + 1);
  });
  
  // Convert to array format for visualization
  const bins = Array.from(sizeFrequency.entries())
    .map(([size, count]) => ({
      size: size,
      count: count,
      label: `${size} particles`
    }))
    .sort((a, b) => a.size - b.size); // Sort by cluster size
  
  return bins;
}

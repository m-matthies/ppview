/**
 * Cluster analysis, kept away from the pane that displays it.
 *
 * Pure functions over `[{x, y, z}]`, so they work for every format — the
 * analysis side was never format-specific, only its rendering was.
 */

/**
 * Shortest separation along one periodic axis — the minimum image convention.
 *
 * Two particles either side of a boundary are neighbours in the simulation, but
 * their raw coordinate difference reports them almost a whole box apart, so
 * without this DBSCAN splits every cluster that straddles a wall and calls the
 * pieces separate. Subtracting the nearest whole number of box lengths picks the
 * closest of the periodic images, which is the distance the simulation itself
 * used.
 *
 * `Math.round` rather than a single wrap, because oxDNA trajectories are not
 * wrapped into the box: a coordinate difference can legitimately span several
 * box lengths, and one subtraction would leave it still wrong.
 */
function minimumImage(delta, length) {
  if (!(length > 0)) return delta;
  return delta - length * Math.round(delta / length);
}

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
 * A uniform grid over the points, so a neighbour search does not read all of
 * them.
 *
 * The region query is the whole cost of DBSCAN, and scanning every point for
 * every point made it quadratic: 2.4s at 4,000 particles, 15s at 10,000 and 60s
 * at 20,000, with the main thread blocked throughout. Since a neighbour has to
 * be within epsilon, and cells are epsilon across, only the 27 cells around a
 * point can hold one — which turns the search into a constant-ish number of
 * cells whatever the structure's size.
 *
 * Stored the way a sparse matrix is, as counts turned into offsets and one flat
 * array of point indices, rather than an array of arrays per cell. A million
 * particles would otherwise mean a million small arrays, and the allocation
 * costs more than the search saves.
 *
 * The cells wrap when the box is periodic, so a point against a wall still finds
 * the neighbours on the other side — the same reason distances use the minimum
 * image. Axis counts are deduplicated because a box only two or three cells
 * across would otherwise visit the same cell twice and count its points twice.
 */
function buildGrid(points, radius, boxSize) {
  const count = points.length;
  const [lx = 0, ly = 0, lz = 0] = boxSize || [];
  const periodic = lx > 0 && ly > 0 && lz > 0;

  // Non-periodic: span the points themselves. Periodic: span the box, so the
  // wrap is meaningful.
  let originX = 0; let originY = 0; let originZ = 0;
  let spanX = lx; let spanY = ly; let spanZ = lz;
  if (!periodic) {
    let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
    originX = Infinity; originY = Infinity; originZ = Infinity;
    for (const p of points) {
      if (p.x < originX) originX = p.x;
      if (p.y < originY) originY = p.y;
      if (p.z < originZ) originZ = p.z;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.z > maxZ) maxZ = p.z;
    }
    spanX = maxX - originX; spanY = maxY - originY; spanZ = maxZ - originZ;
  }

  const along = (span) => (span > 0 ? Math.max(1, Math.floor(span / radius)) : 1);
  const nx = along(spanX); const ny = along(spanY); const nz = along(spanZ);

  const cellOf = (value, origin, span, n) => {
    // A flat structure has zero extent along an axis, and a box can carry a
    // zero dimension. Dividing by it gave every point a NaN cell and emptied
    // the grid; with one cell along that axis there is nothing to divide.
    if (!(span > 0) || n === 1) return 0;
    let t = value - origin;
    if (periodic) t -= span * Math.floor(t / span);       // real modulus
    const index = Math.floor((t / span) * n);
    return Math.min(n - 1, Math.max(0, index));
  };

  const cellIndex = new Int32Array(count);
  const counts = new Int32Array(nx * ny * nz + 1);
  for (let i = 0; i < count; i++) {
    const p = points[i];
    const cell = cellOf(p.x, originX, spanX, nx)
      + nx * (cellOf(p.y, originY, spanY, ny)
        + ny * cellOf(p.z, originZ, spanZ, nz));
    cellIndex[i] = cell;
    counts[cell + 1]++;
  }
  for (let c = 0; c < nx * ny * nz; c++) counts[c + 1] += counts[c];
  const ordered = new Int32Array(count);
  const cursor = counts.slice(0, -1);
  for (let i = 0; i < count; i++) ordered[cursor[cellIndex[i]]++] = i;

  /** The distinct cell coordinates adjacent to one, along a single axis. */
  const adjacent = (c, n) => {
    const out = [];
    for (let d = -1; d <= 1; d++) {
      let k = c + d;
      if (periodic) k = ((k % n) + n) % n;
      else if (k < 0 || k >= n) continue;
      if (!out.includes(k)) out.push(k);
    }
    return out;
  };

  return {
    /** Calls `visit` with every point that could be within radius of `index`. */
    near(index, visit) {
      const cell = cellIndex[index];
      const cx = cell % nx;
      const cy = Math.floor(cell / nx) % ny;
      const cz = Math.floor(cell / (nx * ny));
      for (const z of adjacent(cz, nz)) {
        for (const y of adjacent(cy, ny)) {
          for (const x of adjacent(cx, nx)) {
            const neighbourCell = x + nx * (y + ny * z);
            const from = counts[neighbourCell];
            const to = counts[neighbourCell + 1];
            for (let k = from; k < to; k++) visit(ordered[k]);
          }
        }
      }
    },
  };
}

/**
 * DBSCAN over `[{x, y, z}]`, as defined by Ester et al. (1996).
 *
 * `minPoints` counts the point itself, so `minPoints: 3` means "three particles
 * within epsilon, including this one" — the textbook definition, and the one
 * every other tool in this space uses.
 *
 * A point with at least `minPoints` neighbours is a **core** point and extends
 * its cluster. A point that is within epsilon of a core point but is not core
 * itself is a **border** point: it joins that cluster but does not extend it,
 * which is what stops two dense groups linked by a thin trail of stragglers
 * from being reported as one. Anything else is noise, and appears in no
 * cluster — though a point rejected as noise early can still be picked up later
 * as a border point of a cluster that reaches it.
 *
 * `boxSize` is `[lx, ly, lz]`; pass it to measure distances under periodic
 * boundaries. Omitting it measures plain Euclidean distance, which is what a
 * non-periodic system wants. `epsilon` is capped at
 * `maxMinimumImageRadius(boxSize)`.
 */
export function dbscan(points, epsilon, minPoints, boxSize = null) {
  const clusters = [];
  const visited = new Set();
  const assigned = new Set();

  const radius = Math.min(epsilon, maxMinimumImageRadius(boxSize));
  // Comparing squared distances keeps a sqrt out of the O(n^2) inner loop.
  const radiusSq = radius * radius;
  const [lx = 0, ly = 0, lz = 0] = boxSize || [];

  const grid = buildGrid(points, radius, boxSize);

  /**
   * The epsilon-neighbourhood of a point, including the point itself.
   *
   * Only the cells around the point are read, not every point — see buildGrid.
   * The distance test is unchanged, so the neighbourhood is exactly the one the
   * exhaustive version found; `clustering.test.js` checks that on random
   * structures rather than taking it on trust.
   */
  function regionQuery(pointIndex) {
    const neighbours = [];
    const point = points[pointIndex];

    grid.near(pointIndex, (i) => {
      const other = points[i];
      const dx = minimumImage(point.x - other.x, lx);
      const dy = minimumImage(point.y - other.y, ly);
      const dz = minimumImage(point.z - other.z, lz);

      // i === pointIndex falls out at distance zero, so the point counts
      // itself without a special case.
      if (dx * dx + dy * dy + dz * dz <= radiusSq) neighbours.push(i);
    });

    return neighbours;
  }

  function expandCluster(seedIndex, seedNeighbours) {
    const cluster = [seedIndex];
    assigned.add(seedIndex);

    // A Set alongside the queue: membership was tested with `Array.includes`,
    // which made expansion quadratic in the size of the cluster on top of the
    // quadratic region queries.
    const queue = [...seedNeighbours];
    const queued = new Set(queue);

    for (let i = 0; i < queue.length; i++) {
      const index = queue[i];

      if (!visited.has(index)) {
        visited.add(index);
        const neighbours = regionQuery(index);
        // Only core points extend the cluster. A border point joins and stops.
        if (neighbours.length >= minPoints) {
          for (const candidate of neighbours) {
            if (!queued.has(candidate)) {
              queued.add(candidate);
              queue.push(candidate);
            }
          }
        }
      }

      // Reached here, `index` is either core or a border point of this
      // cluster; either way it belongs to it, unless an earlier cluster
      // claimed it first.
      if (!assigned.has(index)) {
        cluster.push(index);
        assigned.add(index);
      }
    }

    return cluster;
  }

  for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue;
    visited.add(i);

    const neighbours = regionQuery(i);
    // Noise, for now: expandCluster can still adopt it as a border point.
    if (neighbours.length < minPoints) continue;

    clusters.push(expandCluster(i, neighbours));
  }

  return clusters;
}

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

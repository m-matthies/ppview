/**
 * Reads externally computed clusters from a JSON file.
 *
 * Accepts either a bare array or an object with a `clusters` key, and takes the
 * particle list under `particles`, `indices` or `ids` — analysis scripts in this
 * space spell it all three ways, and rejecting a file over the key name would
 * be a poor trade.
 *
 *   [ { "name": "core", "color": "#e7298a", "visible": true, "particles": [0, 1, 2] }, ... ]
 *
 * `visible` is optional and defaults to true; it sets the cluster's initial
 * visibility, which the pane can then toggle.
 */

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const readIndices = (entry) => {
  const list = entry.particles ?? entry.indices ?? entry.ids;
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const value of list) {
    const index = Number(value);
    // Silently dropping a bad index would misreport which particles are in a
    // cluster, so the whole entry is rejected instead.
    if (!Number.isInteger(index) || index < 0) return null;
    out.push(index);
  }
  return out;
};

/**
 * @returns {{ clusters: Array<{name: string, color: string|null, indices: number[]}>,
 *             warnings: string[] }}
 */
export function parseClusterFile(text, { particleCount = Infinity } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Not valid JSON: ${error.message}`);
  }

  const raw = Array.isArray(parsed) ? parsed : parsed?.clusters;
  if (!Array.isArray(raw)) {
    throw new Error('Expected an array of clusters, or an object with a "clusters" array.');
  }

  const clusters = [];
  const warnings = [];

  raw.forEach((entry, position) => {
    if (!entry || typeof entry !== 'object') {
      warnings.push(`Cluster ${position + 1} is not an object; skipped.`);
      return;
    }
    const indices = readIndices(entry);
    if (!indices) {
      warnings.push(`Cluster ${position + 1} has no valid particle list; skipped.`);
      return;
    }

    // Out-of-range indices usually mean the file belongs to a different
    // trajectory, which is worth saying out loud rather than rendering nothing.
    const inRange = indices.filter(i => i < particleCount);
    if (inRange.length === 0) {
      // Saying "n particles were ignored" as well would just restate this.
      warnings.push(`Cluster ${position + 1} matched no particles in this system; skipped.`);
      return;
    }
    if (inRange.length !== indices.length) {
      warnings.push(
        `Cluster ${position + 1}: ${indices.length - inRange.length} particle(s) outside this system were ignored.`,
      );
    }

    const color = typeof entry.color === 'string' && COLOR_PATTERN.test(entry.color.trim())
      ? entry.color.trim()
      : null;
    if (entry.color && !color) {
      warnings.push(`Cluster ${position + 1}: colour "${entry.color}" is not a #rrggbb value; using a palette colour.`);
    }

    clusters.push({
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : `Cluster ${position + 1}`,
      color,
      // Anything other than an explicit false counts as visible, so a file that
      // omits the field behaves exactly as before.
      visible: entry.visible !== false,
      indices: inRange,
    });
  });

  if (clusters.length === 0) throw new Error('No usable clusters in the file.');
  return { clusters, warnings };
}

export default parseClusterFile;

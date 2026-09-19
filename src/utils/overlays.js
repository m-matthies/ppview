import { getParticleColors } from '../colors';

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

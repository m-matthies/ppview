import { useCallback, useMemo } from 'react';
import { getParticleColors, lightnessLadder } from '../../colors';

/**
 * What colour each cluster is drawn in.
 *
 * Hue encodes cluster **size**; lightness separates clusters that share one.
 *
 * A cluster's index is an artefact of the order DBSCAN happened to walk the
 * particles — it says nothing about the structure, so colouring by it made two
 * clusters of the same size look unrelated and told you nothing readable off the
 * scene. Ranking the distinct sizes and indexing the palette by that rank means
 * same size always means same colour, and the palette walks in size order. It
 * also matches the histogram, which already treats an exact size as the unit you
 * select by.
 *
 * On its own that made a system of uniformly sized clusters render in a single
 * colour — the very problem per-cluster colours were introduced to fix. So each
 * cluster is also nudged in lightness by its position among the clusters of its
 * size. Hue answers "how big"; the shade says "not the same one".
 */

// Five shades, cycling. A hundred clusters of one size would put a fraction of a
// point between neighbours and look uniform again, and five is already more than
// anyone reads off a scene.
const LIGHTNESS_STEPS = 5;

export default function useClusterColours({ clusters, colorScheme, fileClusters, colorOverrides }) {
  const palette = useMemo(() => getParticleColors(colorScheme, 12), [colorScheme]);

  const sizeRanks = useMemo(() => {
    const sizes = [...new Set(clusters.map(c => c.length))].sort((a, b) => a - b);
    return new Map(sizes.map((size, rank) => [size, rank]));
  }, [clusters]);

  /**
   * The base colour for a size, with no nudge — what the histogram bar for that
   * size is painted in, since a bar stands for the whole group.
   */
  const colorForSize = useCallback(
    (size) => palette[(sizeRanks.get(size) ?? 0) % palette.length],
    [palette, sizeRanks],
  );

  /** Each cluster's position among those of its own size, and how many share it. */
  const sizeGroups = useMemo(() => {
    const counts = new Map();
    clusters.forEach(c => counts.set(c.length, (counts.get(c.length) ?? 0) + 1));
    const seen = new Map();
    return clusters.map(cluster => {
      const ordinal = seen.get(cluster.length) ?? 0;
      seen.set(cluster.length, ordinal + 1);
      return { ordinal, count: counts.get(cluster.length) ?? 1 };
    });
  }, [clusters]);

  /**
   * A cluster's colour: an explicit override, then the file's own colour, then
   * the size ladder.
   *
   * lightnessLadder centres the ladder on the palette colour where there is room
   * and slides it to fit where there is not, so a group of one gets the base
   * colour exactly — matching the histogram bar meant to be its legend — and a
   * base near black or white still yields five distinct shades.
   */
  const clusterColorAt = useCallback((index) => {
    const explicit = colorOverrides[index] ?? fileClusters?.[index]?.color;
    if (explicit) return explicit;
    const { ordinal, count } = sizeGroups[index] ?? { ordinal: 0, count: 1 };
    const rungs = Math.min(count, LIGHTNESS_STEPS);
    const ladder = lightnessLadder(colorForSize(clusters[index]?.length), rungs);
    return ladder[ordinal % rungs];
  }, [colorOverrides, fileClusters, colorForSize, clusters, sizeGroups]);

  return { colorForSize, clusterColorAt };
}

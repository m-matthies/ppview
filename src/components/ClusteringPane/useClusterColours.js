import { useCallback, useMemo } from 'react';
import { getParticleColors } from '../../colors';
import { colourForCluster } from '../../utils/clusterIdentity';

/**
 * What colour each cluster is drawn in.
 *
 * All of the work is in `utils/clusterIdentity.js`, and that is the point: one
 * function, computing from a cluster's membership and nothing else, so the pane,
 * the scene and the time view cannot disagree about what colour a cluster is.
 *
 * Hue used to encode cluster **size**, with lightness separating clusters that
 * shared one. That is a good rule for a single frame and a bad one across a
 * trajectory, because sizes change: measured on two clusters of eight particles,
 * two near-identical reds at one frame and a green and a red a few frames later,
 * the same two clusters throughout. A cluster you cannot recognise from frame to
 * frame cannot be followed, which is what the time view is for.
 */
export default function useClusterColours({ clusters, colorScheme, fileClusters, colorOverrides }) {
  const palette = useMemo(() => getParticleColors(colorScheme, 12), [colorScheme]);

  /**
   * A cluster's colour: an explicit override, then the file's own colour, then
   * its identity.
   *
   * An override wins because it is someone saying what they want this cluster to
   * look like, which no default should overrule.
   */
  const clusterColorAt = useCallback((index) => {
    const explicit = colorOverrides[index] ?? fileClusters?.[index]?.color;
    if (explicit) return explicit;
    const cluster = clusters[index];
    return cluster ? colourForCluster(palette, cluster) : palette[0];
  }, [colorOverrides, fileClusters, clusters, palette]);

  return { clusterColorAt };
}

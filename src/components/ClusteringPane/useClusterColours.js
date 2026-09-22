import { useCallback, useMemo } from 'react';
import { getParticleColors } from '../../colors';
import { anchorRanks, colourForRank } from '../../utils/clusterIdentity';

/**
 * What colour each cluster is drawn in.
 *
 * **Its lowest-numbered particle decides**, via `utils/clusterIdentity.js`. That
 * is a property of the cluster's membership and nothing else: no history, no
 * current frame, no second opinion, so the pane, the scene and the time view all
 * compute the same answer and none of them can disagree.
 *
 * Hue used to encode cluster **size**, with lightness separating clusters that
 * shared one. That is a good rule for a single frame and a bad one across a
 * trajectory, because sizes change: measured on two clusters of eight particles,
 * two near-identical reds at one frame and a green and a red a few frames later,
 * the same two clusters throughout. A cluster you cannot recognise from frame to
 * frame cannot be followed, which is what the time view is for.
 *
 * Patching that with a second source made it worse. Colouring by lineage where
 * one was known and falling back to size rank where it was not meant a cluster
 * changed colour the moment a time view was computed, and again whenever the
 * lookup missed — a cluster the pane drew near-black had a green band in the
 * picture.

 */

export default function useClusterColours({ clusters, colorScheme, fileClusters, colorOverrides }) {
  const palette = useMemo(() => getParticleColors(colorScheme, 12), [colorScheme]);

  /**
   * Colour comes from the cluster's lowest-numbered particle, not its size.
   *
   * Size rank is right for one frame and wrong across a trajectory: sizes
   * change, so a cluster changes colour as it grows and shrinks, and there is
   * then nothing to recognise it by. See `utils/clusterIdentity.js`.
   */
  const ranks = useMemo(() => anchorRanks(clusters), [clusters]);

  /**
   * The base colour for a size, with no nudge — what the histogram bar for that
   * size is painted in, since a bar stands for the whole group.
   */
  /** A cluster's own colour: its anchor's rank, wrapped through the palette. */
  const colorForCluster = useCallback(
    (index) => colourForRank(palette, ranks.get(index) ?? 0),
    [palette, ranks],
  );

  /**
   * A cluster's colour: an explicit override, then the file's own colour, then
   * its anchor rank.
   *
   * Clusters past the end of the palette are separated by lightness instead of
   * hue, so a system with more clusters than colours still tells them apart —
   * `lightnessLadder` slides to fit, so a base near black or white still yields
   * distinct shades rather than collapsing onto the edge.
   */
  const clusterColorAt = useCallback((index) => {
    const explicit = colorOverrides[index] ?? fileClusters?.[index]?.color;
    if (explicit) return explicit;
    return colourForRank(palette, ranks.get(index) ?? 0);
  }, [colorOverrides, fileClusters, ranks, palette]);

  return { colorForCluster, clusterColorAt };
}

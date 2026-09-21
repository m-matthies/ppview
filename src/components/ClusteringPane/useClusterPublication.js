import { useEffect } from 'react';
import { useClusteringStore } from '../../store/clusteringStore';

/**
 * Publishing the pane's decisions to the renderers.
 *
 * The pane thinks in cluster indices; renderers think in particle indices. These
 * three effects are the translation, and they are the pane's entire output — the
 * scene reads nothing else from it.
 *
 * Each one skips a write that would change nothing. Every renderer subscribes to
 * this store, so a write re-renders all five and re-runs their per-instance
 * matrix and colour loops; this component is mounted for every structure,
 * including ones nobody is clustering.
 */
export default function useClusterPublication({
  clusters, selectedClusters, showOnlySelected, hiddenClusters, colorByCluster, clusterColorAt,
}) {
  const highlightClusters = useClusteringStore(state => state.highlightClusters);
  const setHiddenParticles = useClusteringStore(state => state.setHiddenParticles);
  const setClusterCount = useClusteringStore(state => state.setClusterCount);

  // Which particles are highlighted, and in what colour.
  useEffect(() => {
    const highlighted = new Set();
    const colors = new Map();

    if (showOnlySelected && selectedClusters.size > 0) {
      selectedClusters.forEach(clusterIndex => {
        const members = clusters[clusterIndex];
        if (!members) return;
        const color = clusterColorAt(clusterIndex);
        members.forEach(particleIndex => {
          highlighted.add(particleIndex);
          // Tint by cluster only when the View is colouring by *this* cluster
          // set. Under "Particle type" the grouping still selects, hides and
          // scales, but particles keep their type colour.
          if (colorByCluster) colors.set(particleIndex, color);
        });
      });
    }

    const current = useClusteringStore.getState();
    const wouldChangeNothing = current.showOnlyHighlightedClusters === showOnlySelected
      && current.highlightedClusters.size === 0 && highlighted.size === 0
      && current.clusterColors.size === 0 && colors.size === 0;
    if (wouldChangeNothing) return;

    highlightClusters(highlighted, showOnlySelected, colors);
  }, [clusters, selectedClusters, showOnlySelected, highlightClusters, clusterColorAt, colorByCluster]);

  // Which particles are switched off by an eye control.
  useEffect(() => {
    const hidden = new Set();
    hiddenClusters.forEach(clusterIndex => {
      clusters[clusterIndex]?.forEach(particleIndex => hidden.add(particleIndex));
    });
    if (hidden.size === 0 && useClusteringStore.getState().hiddenParticles.size === 0) return;
    setHiddenParticles(hidden);
  }, [hiddenClusters, clusters, setHiddenParticles]);

  // Whether "Computed clusters" is a real choice for the View control. Without
  // this the View only appeared once a cluster *file* had been registered, so a
  // plain DBSCAN run could never be switched to particle-type colours.
  useEffect(() => {
    setClusterCount(clusters.length);
  }, [clusters.length, setClusterCount]);
}

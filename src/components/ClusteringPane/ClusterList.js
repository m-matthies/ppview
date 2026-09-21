import React from 'react';
import { EyeIcon, EyeOffIcon } from '../Icons';

/**
 * One row per cluster: a colour swatch, its size, an eye, and a checkbox.
 *
 * The eye and the checkbox are deliberately separate axes. Selection drives
 * highlighting and, with "show only selected", what else stays on screen; the
 * eye hides one cluster regardless of either — which is why `forceHidden` is
 * checked before the selection branch in getClusterAppearance.
 */
function ClusterList({
  clusters, selectedClusters, hiddenClusters, fileClusters,
  clusterColorAt, onColorChange, onToggleVisible, onToggleSelected,
}) {
  return (
      <div className="cluster-list">
        <div className="cluster-list-header">
          <span>Cluster (Size)</span>
          <span>Show / select</span>
        </div>
        <div className="cluster-items">
          {clusters
            .map((cluster, index) => ({ cluster, originalIndex: index }))
            .sort((a, b) => b.cluster.length - a.cluster.length) // Sort by size (largest first)
            .map(({ cluster, originalIndex }) => (
              <div key={originalIndex} className="cluster-item">
                <input
                  className="cluster-swatch"
                  type="color"
                  value={clusterColorAt(originalIndex)}
                  onChange={(e) => onColorChange(originalIndex, e.target.value)}
                  title="Colour for this cluster"
                  aria-label={`Colour for cluster ${originalIndex + 1}`}
                />
                <span className="cluster-info">
                  {fileClusters?.[originalIndex]?.name ?? `Cluster ${originalIndex + 1}`}
                  {' '}({cluster.length} particles)
                </span>
                <button
                  className={`cluster-visibility ${hiddenClusters.has(originalIndex) ? 'is-hidden' : ''}`}
                  onClick={() => onToggleVisible(originalIndex)}
                  title={hiddenClusters.has(originalIndex) ? 'Show this cluster' : 'Hide this cluster'}
                  aria-pressed={!hiddenClusters.has(originalIndex)}
                  aria-label={`Toggle visibility of ${fileClusters?.[originalIndex]?.name ?? `cluster ${originalIndex + 1}`}`}
                >
                  {hiddenClusters.has(originalIndex) ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                </button>
                <label className="cluster-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedClusters.has(originalIndex)}
                    onChange={() => onToggleSelected(originalIndex)}
                  />
                </label>
              </div>
            ))}
        </div>
      </div>
  );
}

export default React.memo(ClusterList);

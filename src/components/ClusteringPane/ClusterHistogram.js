import React from 'react';

/**
 * Cluster sizes as a bar chart, and the quickest way to select by size.
 *
 * Clicking a bar selects every cluster of exactly that size, which is why the
 * bars are never binned: a bin would have no single size to select. They keep a
 * legible minimum width and the row scrolls instead of compressing.
 *
 * A bar carries a cluster's colour only when it stands for exactly one; the histogram
 * doubles as the legend for the scene. The colour arrives as a custom property
 * rather than an inline background, because an inline background would outrank
 * the class rule that paints a selected bar accent-blue.
 */
function ClusterHistogram({ bins, maxBinCount, clusters, selectedClusters, clusterColorAt, onBarClick }) {
  /**
   * A bar's colour, when it has one.
   *
   * Clusters are coloured by identity, not by size, so a bar standing for five
   * clusters of eight particles has five colours and no single one — painting it
   * any of them would be a legend that lies. Where a bar stands for exactly one
   * cluster it takes that cluster's colour and the legend holds; otherwise it
   * takes a neutral tone and claims nothing.
   *
   * Colouring every bar by size was the last thing in the app still doing so,
   * and it disagreed with the list beside it, the scene and the time view.
   */
  const barColour = (size) => {
    const matching = clusters.reduce(
      (found, cluster, index) => (cluster.length === size ? [...found, index] : found),
      [],
    );
    return matching.length === 1 ? clusterColorAt(matching[0]) : null;
  };

  return (
    <div className="clustering-histogram">
      <h4>Cluster Size Distribution</h4>
      <p className="histogram-hint">
        Click a bar to select every cluster of that size, or Cmd/Ctrl+click to add it to the
        selection. Each bar is labelled with its count above and its size below, and carries a
        cluster&rsquo;s colour where it stands for exactly one.
      </p>
      <div className="histogram-container">
        {bins.length > 0 ? (
          <>
            <div className="histogram-plot">
              <div className="histogram-y-axis">Count</div>
              {/* Bars keep a legible fixed minimum width and this scrolls once
                  there are more distinct sizes than fit. Binning them instead
                  would break the interaction, which selects clusters of one
                  exact size. */}
              <div className="histogram-scroll">
              <div className="histogram-bars">
                {bins.map((bin) => {
                  // Simple linear scaling with minimum height for visibility
                  // Scales against the bar track, which is laid out above the
                  // labels rather than sharing space with them.
                  const linearHeight = maxBinCount > 0 ? (bin.count / maxBinCount) * 100 : 0;
                  const minHeight = 4; // keep a one-count bar visible
                  const finalHeight = Math.max(linearHeight, bin.count > 0 ? minHeight : 0);
                  
                  // Check if any selected clusters have this size
                  const isActive = Array.from(selectedClusters).some(clusterIndex => 
                    clusters[clusterIndex]?.length === bin.size
                  );
                  
                  return (
                    <div
                      key={`size-${bin.size}`}
                      className={`histogram-bar-container ${isActive ? 'is-active' : ''}`}
                      onClick={(e) => onBarClick(bin.size, e)}
                      title={`Select the ${bin.count} cluster${bin.count === 1 ? '' : 's'} of ${bin.size} particles. Cmd/Ctrl+click to add to the selection.`}
                    >
                      <div className="histogram-bar-track">
                        {/* Set as a custom property, not `background`: an
                            inline background would beat the class rule that
                            paints a selected bar blue. */}
                        <div
                          className="histogram-bar"
                          style={{
                            height: `${finalHeight}%`,
                            ...(barColour(bin.size) ? { '--bar-color': barColour(bin.size) } : {}),
                          }}
                        />
                      </div>
                      <div className="histogram-labels">
                        <span className="histogram-label-count">{bin.count}</span>
                        <span className="histogram-label-size">{bin.size}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              </div>
            </div>
            <div className="histogram-axis-labels">
              <span>Cluster Size (particles)</span>
            </div>
          </>
        ) : (
          <div className="histogram-empty">
            <span>No clusters found</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(ClusterHistogram);

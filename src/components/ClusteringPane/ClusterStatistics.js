import React from 'react';

/** Summary figures for the current cluster set. */
function ClusterStatistics({ statistics }) {
  return (
  <div className="clustering-statistics">
    <h4>Statistics</h4>
    <div className="stats-grid">
      <div className="stat-item">
        <span className="stat-label">Total Clusters:</span>
        <span className="stat-value">{statistics.totalClusters}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Clustered Particles:</span>
        <span className="stat-value">{statistics.clusteredParticles}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Noise Particles:</span>
        <span className="stat-value">{statistics.noiseParticles}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Avg Cluster Size:</span>
        <span className="stat-value">{statistics.avgClusterSize.toFixed(1)}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Max Cluster Size:</span>
        <span className="stat-value">{statistics.maxClusterSize}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Min Cluster Size:</span>
        <span className="stat-value">{statistics.minClusterSize}</span>
      </div>
    </div>
  </div>
  );
}

export default React.memo(ClusterStatistics);

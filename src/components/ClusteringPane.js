import React, { useState, useEffect, useMemo } from 'react';
import { useParticleStore } from '../store/particleStore';
import { useClusteringStore } from '../store/clusteringStore';
import DraggablePanel from './DraggablePanel';
import './ClusteringPane.css';

// DBSCAN clustering algorithm implementation
function dbscan(points, epsilon, minPoints) {
  const clusters = [];
  const visited = new Set();
  const clustered = new Set();

  function regionQuery(pointIndex) {
    const neighbors = [];
    const point = points[pointIndex];
    
    for (let i = 0; i < points.length; i++) {
      if (i === pointIndex) continue;
      const neighbor = points[i];
      const distance = Math.sqrt(
        Math.pow(point.x - neighbor.x, 2) +
        Math.pow(point.y - neighbor.y, 2) +
        Math.pow(point.z - neighbor.z, 2)
      );
      
      if (distance <= epsilon) {
        neighbors.push(i);
      }
    }
    
    return neighbors;
  }

  function expandCluster(pointIndex, neighbors, cluster) {
    cluster.push(pointIndex);
    clustered.add(pointIndex);
    
    let i = 0;
    while (i < neighbors.length) {
      const neighborIndex = neighbors[i];
      
      if (!visited.has(neighborIndex)) {
        visited.add(neighborIndex);
        const neighborNeighbors = regionQuery(neighborIndex);
        
        if (neighborNeighbors.length >= minPoints) {
          // Merge neighbors
          for (const newNeighbor of neighborNeighbors) {
            if (!neighbors.includes(newNeighbor)) {
              neighbors.push(newNeighbor);
            }
          }
        }
      }
      
      if (!clustered.has(neighborIndex)) {
        cluster.push(neighborIndex);
        clustered.add(neighborIndex);
      }
      
      i++;
    }
  }

  // Main DBSCAN algorithm
  for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue;
    
    visited.add(i);
    const neighbors = regionQuery(i);
    
    if (neighbors.length < minPoints) {
      // Point is noise
      continue;
    } else {
      // Start a new cluster
      const cluster = [];
      expandCluster(i, neighbors, cluster);
      clusters.push(cluster);
    }
  }

  return clusters;
}

// Generate histogram data - shows how many clusters have each size
function generateHistogram(clusterSizes) {
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

function ClusteringPane() {
  // Get data from Zustand stores
  const positions = useParticleStore(state => state.positions);
  const highlightClusters = useClusteringStore(state => state.highlightClusters);
  const [epsilon, setEpsilon] = useState(2.0);
  const [minPoints, setMinPoints] = useState(3);
  const [selectedClusters, setSelectedClusters] = useState(new Set());
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  // Compute clusters when parameters change
  const clusters = useMemo(() => {
    if (!positions || positions.length === 0) return [];
    
    try {
      return dbscan(positions, epsilon, minPoints);
    } catch (error) {
      console.error('Error computing clusters:', error);
      return [];
    }
  }, [positions, epsilon, minPoints]);

  // Compute statistics
  const statistics = useMemo(() => {
    const clusterSizes = clusters.map(cluster => cluster.length);
    const totalClustered = clusterSizes.reduce((sum, size) => sum + size, 0);
    const noise = positions ? positions.length - totalClustered : 0;
    
    return {
      totalClusters: clusters.length,
      totalParticles: positions ? positions.length : 0,
      clusteredParticles: totalClustered,
      noiseParticles: noise,
      clusterSizes,
      avgClusterSize: clusters.length > 0 ? totalClustered / clusters.length : 0,
      maxClusterSize: clusterSizes.length > 0 ? Math.max(...clusterSizes) : 0,
      minClusterSize: clusterSizes.length > 0 ? Math.min(...clusterSizes) : 0
    };
  }, [clusters, positions]);

  // Generate histogram data
  const histogramData = useMemo(() => {
    const histogram = generateHistogram(statistics.clusterSizes);
    // Sort by cluster size (largest first)
    return histogram.sort((a, b) => b.size - a.size);
  }, [statistics.clusterSizes]);

  // Handle cluster selection
  const handleClusterToggle = (clusterIndex) => {
    const newSelected = new Set(selectedClusters);
    if (newSelected.has(clusterIndex)) {
      newSelected.delete(clusterIndex);
    } else {
      newSelected.add(clusterIndex);
    }
    setSelectedClusters(newSelected);
  };

  // Select all clusters
  const selectAllClusters = () => {
    setSelectedClusters(new Set(clusters.map((_, index) => index)));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedClusters(new Set());
  };
  
  // Handle clicking on histogram bar to select clusters of that size
  const handleHistogramBarClick = (clusterSize, event) => {
    const clustersOfSize = [];
    clusters.forEach((cluster, index) => {
      if (cluster.length === clusterSize) {
        clustersOfSize.push(index);
      }
    });
    
    if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd+click: Add to existing selection
      const newSelected = new Set(selectedClusters);
      clustersOfSize.forEach(idx => newSelected.add(idx));
      setSelectedClusters(newSelected);
    } else {
      // Normal click: Replace selection
      setSelectedClusters(new Set(clustersOfSize));
    }
    
    // Automatically enable "show only selected" mode
    setShowOnlySelected(true);
  };

  // Notify store about highlighted clusters
  useEffect(() => {
    const highlightedParticleIndices = new Set();
    
    if (showOnlySelected && selectedClusters.size > 0) {
      selectedClusters.forEach(clusterIndex => {
        if (clusters[clusterIndex]) {
          clusters[clusterIndex].forEach(particleIndex => {
            highlightedParticleIndices.add(particleIndex);
          });
        }
      });
    }
    
    highlightClusters(highlightedParticleIndices, showOnlySelected);
  }, [clusters, selectedClusters, showOnlySelected, highlightClusters]);
  
  // Early return if no positions loaded
  if (!positions || positions.length === 0) {
    return null;
  }

  if (!isVisible) {
    return (
      <div className="clustering-pane-toggle">
        <button 
          className="toggle-clustering-button"
          onClick={() => setIsVisible(true)}
          title="Show Clustering Panel"
        >
          📊 Clustering
        </button>
      </div>
    );
  }

  return (
    <DraggablePanel initialX={250} initialY={20} className="clustering-pane">
      <div className="clustering-header drag-handle" style={{ cursor: 'grab' }}>
        <h3>Particle Clustering</h3>
        <button 
          className="close-button"
          onClick={() => setIsVisible(false)}
          title="Hide Clustering Panel"
        >
          ✕
        </button>
      </div>

      {/* Clustering Parameters */}
      <div className="clustering-controls">
        <div className="parameter-control">
          <label htmlFor="epsilon-slider">
            Epsilon Distance: {epsilon.toFixed(2)}
          </label>
          <input
            id="epsilon-slider"
            type="range"
            min="0.5"
            max="10.0"
            step="0.1"
            value={epsilon}
            onChange={(e) => setEpsilon(parseFloat(e.target.value))}
            className="parameter-slider"
          />
        </div>

        <div className="parameter-control">
          <label htmlFor="minpoints-slider">
            Min Points: {minPoints}
          </label>
          <input
            id="minpoints-slider"
            type="range"
            min="2"
            max="20"
            step="1"
            value={minPoints}
            onChange={(e) => setMinPoints(parseInt(e.target.value))}
            className="parameter-slider"
          />
        </div>
      </div>

      {/* Statistics */}
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

      {/* Histogram */}
      <div className="clustering-histogram">
        <h4>Cluster Size Distribution</h4>
        <p style={{ fontSize: '11px', color: '#7f8c8d', marginBottom: '8px', marginTop: '-5px' }}>
          Click a bar to select clusters of that size. Cmd/Ctrl+click to add. Top = count, bottom = size (particles).
        </p>
        <div className="histogram-container">
          {histogramData.length > 0 ? (
            <>
              <div style={{ position: 'relative', height: '150px' }}>
                <div className="histogram-y-axis">Count</div>
                <div className="histogram-bars" style={{ height: '100%' }}>
                  {histogramData.map((bin, index) => {
                    const maxCount = Math.max(...histogramData.map(b => b.count));
                    
                    // Simple linear scaling with minimum height for visibility
                    const linearHeight = maxCount > 0 ? (bin.count / maxCount) * 85 : 0; // Use 85% max to leave room for labels
                    const minHeight = 3; // Minimum 3% height for any bar
                    const finalHeight = Math.max(linearHeight, bin.count > 0 ? minHeight : 0);
                    
                    // Check if any selected clusters have this size
                    const isActive = Array.from(selectedClusters).some(clusterIndex => 
                      clusters[clusterIndex]?.length === bin.size
                    );
                    
                    return (
                      <div 
                        key={`size-${bin.size}`} 
                        className="histogram-bar-container"
                        onClick={(e) => handleHistogramBarClick(bin.size, e)}
                        style={{ cursor: 'pointer' }}
                        title={`Click to select ${bin.count} clusters with ${bin.size} particles. Cmd/Ctrl+click to add to selection.`}
                      >
                        <div 
                          className="histogram-bar"
                          style={{ 
                            height: `${finalHeight}%`,
                            background: isActive 
                              ? 'linear-gradient(to top, #e67e22, #f39c12)'
                              : 'linear-gradient(to top, #3498db, #5dade2)',
                            border: isActive ? '2px solid #d35400' : '1px solid #2980b9'
                          }}
                        />
                        <div className="histogram-labels">
                          <span className="histogram-label-count" style={{ fontWeight: isActive ? 'bold' : 'normal' }}>
                            {bin.count}
                          </span>
                          <span className="histogram-label-size" style={{ fontWeight: isActive ? 'bold' : 'normal' }}>
                            {bin.size}
                          </span>
                        </div>
                      </div>
                    );
                  })}
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

      {/* Cluster Selection */}
      <div className="cluster-selection">
        <div className="selection-controls">
          <h4>Cluster Highlighting</h4>
          <div className="selection-buttons">
            <button onClick={selectAllClusters} className="select-button">
              Select All
            </button>
            <button onClick={clearSelection} className="select-button">
              Clear All
            </button>
          </div>
          <label className="highlight-checkbox">
            <input
              type="checkbox"
              checked={showOnlySelected}
              onChange={(e) => setShowOnlySelected(e.target.checked)}
            />
            <span>Show only selected clusters</span>
          </label>
        </div>

        {clusters.length > 0 && (
          <div className="cluster-list">
            <div className="cluster-list-header">
              <span>Cluster (Size)</span>
              <span>Selected</span>
            </div>
            <div className="cluster-items">
              {clusters
                .map((cluster, index) => ({ cluster, originalIndex: index }))
                .sort((a, b) => b.cluster.length - a.cluster.length) // Sort by size (largest first)
                .map(({ cluster, originalIndex }, sortedIndex) => (
                  <div key={originalIndex} className="cluster-item">
                    <span className="cluster-info">
                      Cluster {originalIndex + 1} ({cluster.length} particles)
                    </span>
                    <label className="cluster-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedClusters.has(originalIndex)}
                        onChange={() => handleClusterToggle(originalIndex)}
                      />
                    </label>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </DraggablePanel>
  );
}

export default ClusteringPane;

/**
 * Cluster analysis, kept away from the pane that displays it.
 *
 * Pure functions over `[{x, y, z}]`, so they work for every format — the
 * analysis side was never format-specific, only its rendering was.
 */

// DBSCAN clustering algorithm implementation
export function dbscan(points, epsilon, minPoints) {
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
export function generateHistogram(clusterSizes) {
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

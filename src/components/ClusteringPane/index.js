import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParticleStore } from '../../store/particleStore';
import { useClusteringStore } from '../../store/clusteringStore';
import { useOverlayStore } from '../../store/overlayStore';
import { clusterOverlayFromFile } from '../../utils/overlays';
import { useUIStore } from '../../store/uiStore';
import DraggablePanel from '../DraggablePanel';
import { dbscan, generateHistogram } from '../../utils/clustering';
import { parseClusterFile } from '../../utils/clusterFile';
import { getParticleColors } from '../../colors';
import { CloseIcon, EyeIcon, EyeOffIcon } from '../Icons';
import './ClusteringPane.css';

function ClusteringPane() {
  // Get data from Zustand stores
  const positions = useParticleStore(state => state.positions);
  const highlightClusters = useClusteringStore(state => state.highlightClusters);
  const dimNonSelectedClusters = useClusteringStore(state => state.dimNonSelectedClusters);
  const setDimNonSelectedClusters = useClusteringStore(state => state.setDimNonSelectedClusters);
  // Visibility belongs to the UI store, which is what the control-bar toggle
  // reads. A second local flag here let the two disagree about whether the
  // pane was open.
  const setShowClusteringPane = useUIStore(state => state.setShowClusteringPane);
  const overlays = useOverlayStore(state => state.overlays);
  const activeOverlayId = useOverlayStore(state => state.activeOverlayId);
  const addOverlay = useOverlayStore(state => state.addOverlay);
  // Which clusters this pane works with is a separate question from which
  // overlay paints the scene. Tying them together meant choosing "Particle
  // type" in the View also threw away the cluster grouping, leaving no way to
  // cluster by a file while colouring by particle type.
  const [clusterSourceId, setClusterSourceId] = useState(null);   // null = DBSCAN
  // Only a cluster overlay has clusters to list; a future scalar-property
  // overlay would colour particles without any grouping to show here.
  const clusterOverlays = overlays.filter(o => o.kind === 'clusters');
  const clusterSource = clusterOverlays.find(o => o.id === clusterSourceId) || null;
  const fileClusters = clusterSource?.clusters ?? null;
  const setHiddenParticles = useClusteringStore(state => state.setHiddenParticles);
  const colorScheme = useUIStore(state => state.currentColorScheme);
  const fileInputRef = useRef(null);
  const [fileError, setFileError] = useState(null);
  const [fileWarnings, setFileWarnings] = useState([]);
  // Per-cluster colour overrides, keyed by cluster index in the active list.
  const [colorOverrides, setColorOverrides] = useState({});
  // Cluster indices switched off by the eye control. Separate from selection:
  // hiding a cluster works whether or not "show only selected" is on.
  const [hiddenClusters, setHiddenClusters] = useState(new Set());
  const [epsilon, setEpsilon] = useState(2.0);
  const [minPoints, setMinPoints] = useState(3);
  const [selectedClusters, setSelectedClusters] = useState(new Set());
  const [showOnlySelected, setShowOnlySelected] = useState(false);

  // Compute clusters when parameters change
  const computedClusters = useMemo(() => {
    if (!positions || positions.length === 0) return [];
    
    try {
      return dbscan(positions, epsilon, minPoints);
    } catch (error) {
      console.error('Error computing clusters:', error);
      return [];
    }
  }, [positions, epsilon, minPoints]);

  // A loaded file replaces the computed clusters while it is present, so the
  // rest of the pane does not need to care where the clusters came from.
  const clusters = useMemo(
    () => (fileClusters ? fileClusters.map(c => c.indices) : computedClusters),
    [fileClusters, computedClusters],
  );

  // Every cluster gets its own colour. Highlighting used to paint every cluster
  // in its particles' type colours, which made two adjacent clusters
  // indistinguishable — usually the exact thing you are trying to see.
  const palette = useMemo(() => getParticleColors(colorScheme, 12), [colorScheme]);
  // True when the active view is the very cluster set shown here.
  const colorByCluster = !!clusterSourceId && activeOverlayId === clusterSourceId;

  const clusterColorAt = useCallback((index) => (
    colorOverrides[index]
      ?? fileClusters?.[index]?.color
      ?? palette[index % palette.length]
  ), [colorOverrides, fileClusters, palette]);

  // Selection lives in this component, so a change of active overlay has to be
  // adopted here — including a change *to* none.
  //
  // Switching back to "Particle type" used to leave the previous selection in
  // place. Those indices then addressed the computed clusters instead, so the
  // scene stayed painted in cluster colours and the colour scheme never
  // reappeared, which looked like the view control had simply stopped working.
  useEffect(() => {
    if (activeOverlayId && clusterOverlays.some(o => o.id === activeOverlayId)) {
      setClusterSourceId(activeOverlayId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOverlayId]);

  const adoptedOverlayRef = useRef(undefined);
  useEffect(() => {
    if (adoptedOverlayRef.current === clusterSourceId) return;
    adoptedOverlayRef.current = clusterSourceId;
    setColorOverrides({});

    if (fileClusters) {
      setSelectedClusters(new Set(fileClusters.map((_, i) => i)));
      // `"visible": false` in the file starts that cluster switched off.
      setHiddenClusters(new Set(
        fileClusters.map((c, i) => (c.visible === false ? i : null)).filter(i => i !== null),
      ));
      setShowOnlySelected(true);
    } else {
      setSelectedClusters(new Set());
      setHiddenClusters(new Set());
      setShowOnlySelected(false);
    }
  }, [clusterSourceId, fileClusters]);

  const handleClusterFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';           // allow re-picking the same file
    if (!file) return;
    try {
      const { clusters: loaded, warnings } = parseClusterFile(await file.text(), {
        particleCount: positions?.length ?? 0,
      });
      addOverlay(clusterOverlayFromFile({
        name: file.name.replace(/\.json$/i, ''),
        clusters: loaded,
        colorScheme,
      }));
      setFileError(null);
      setFileWarnings(warnings);
    } catch (error) {
      setFileError(error.message);
      setFileWarnings([]);
    }
  }, [positions, addOverlay, colorScheme]);


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

  // Tallest bar sets the scale. Hoisted out of the render loop, which used to
  // recompute it once per bar.
  const maxBinCount = useMemo(
    () => histogramData.reduce((max, bin) => Math.max(max, bin.count), 0),
    [histogramData],
  );

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
    const colors = new Map();

    if (showOnlySelected && selectedClusters.size > 0) {
      selectedClusters.forEach(clusterIndex => {
        const members = clusters[clusterIndex];
        if (!members) return;
        const color = clusterColorAt(clusterIndex);
        members.forEach(particleIndex => {
          highlightedParticleIndices.add(particleIndex);
          // Only tint by cluster when the view is actually colouring by this
          // cluster set. Under "Particle type" the grouping still selects,
          // hides and scales, but the particles keep their type colour.
          if (colorByCluster) colors.set(particleIndex, color);
        });
      });
    }

    highlightClusters(highlightedParticleIndices, showOnlySelected, colors);
  }, [clusters, selectedClusters, showOnlySelected, highlightClusters, clusterColorAt, colorByCluster]);

  // Translate hidden *clusters* into hidden *particles*, which is what the
  // renderers work in.
  useEffect(() => {
    const hidden = new Set();
    hiddenClusters.forEach(clusterIndex => {
      clusters[clusterIndex]?.forEach(particleIndex => hidden.add(particleIndex));
    });
    setHiddenParticles(hidden);
  }, [hiddenClusters, clusters, setHiddenParticles]);

  const toggleClusterVisible = (clusterIndex) => {
    setHiddenClusters(previous => {
      const next = new Set(previous);
      if (next.has(clusterIndex)) next.delete(clusterIndex);
      else next.add(clusterIndex);
      return next;
    });
  };
  
  // Early return if no positions loaded
  if (!positions || positions.length === 0) {
    return null;
  }

  return (
    <DraggablePanel initialX={250} initialY={20} className="clustering-pane" storageId="clustering">
      <div className="clustering-header drag-handle" tabIndex={0}>
        <h3>Particle Clustering</h3>
        <button
          className="close-button"
          onClick={() => setShowClusteringPane(false)}
          title="Hide Clustering Panel"
          aria-label="Hide clustering panel"
        >
          <CloseIcon size={16} />
        </button>
      </div>

      <div className="clustering-body">

      {/* Clusters computed elsewhere can be loaded instead of running DBSCAN. */}
      <div className="cluster-source">
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleClusterFile}
        />

        <label className="field">
          <span className="field-label">Clusters</span>
          <select
            value={clusterSourceId ?? ''}
            onChange={(e) => setClusterSourceId(e.target.value || null)}
          >
            <option value="">Computed (DBSCAN)</option>
            {clusterOverlays.map(overlay => (
              <option key={overlay.id} value={overlay.id}>{overlay.name}</option>
            ))}
          </select>
        </label>

        <button className="select-button" onClick={() => fileInputRef.current?.click()}>
          Load clusters from file
        </button>

        {/* The grouping above and the colours in the scene are separate
            choices, and that is not obvious, so say it where it matters. */}
        {clusterSource && !colorByCluster && (
          <p className="cluster-source-note">
            Grouping by <strong>{clusterSource.name}</strong>, coloured by particle type.
            Switch the View to <strong>{clusterSource.name}</strong> to colour by cluster.
          </p>
        )}
        {clusterSource && colorByCluster && (
          <p className="cluster-source-note">
            Coloured by cluster. Switch the View to <strong>Particle type</strong> to keep
            this grouping but colour by particle type.
          </p>
        )}

        {fileError && <p className="cluster-source-error">{fileError}</p>}
        {fileWarnings.map((warning, i) => (
          <p className="cluster-source-warning" key={i}>{warning}</p>
        ))}
      </div>

      {/* Clustering Parameters */}
      <div className={`clustering-controls ${fileClusters ? 'is-disabled' : ''}`}>
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
        <p className="histogram-hint">
          Click a bar to select every cluster of that size, or Cmd/Ctrl+click to add it to the
          selection. Each bar is labelled with its count above and its size below.
        </p>
        <div className="histogram-container">
          {histogramData.length > 0 ? (
            <>
              <div className="histogram-plot">
                <div className="histogram-y-axis">Count</div>
                {/* Bars keep a legible fixed minimum width and this scrolls once
                    there are more distinct sizes than fit. Binning them instead
                    would break the interaction, which selects clusters of one
                    exact size. */}
                <div className="histogram-scroll">
                <div className="histogram-bars">
                  {histogramData.map((bin) => {
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
                        onClick={(e) => handleHistogramBarClick(bin.size, e)}
                        title={`Select the ${bin.count} cluster${bin.count === 1 ? '' : 's'} of ${bin.size} particles. Cmd/Ctrl+click to add to the selection.`}
                      >
                        <div className="histogram-bar-track">
                          <div className="histogram-bar" style={{ height: `${finalHeight}%` }} />
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

          {/* Only meaningful once something is being hidden. */}
          {showOnlySelected && (
            <label className="highlight-checkbox indented">
              <input
                type="checkbox"
                checked={dimNonSelectedClusters}
                onChange={(e) => setDimNonSelectedClusters(e.target.checked)}
              />
              <span>
                Keep the rest as faint markers
                <span className="checkbox-hint">
                  Draws one small grey sphere per hidden particle so you keep your bearings.
                </span>
              </span>
            </label>
          )}
        </div>

        {clusters.length > 0 && (
          <div className="cluster-list">
            <div className="cluster-list-header">
              <span>Cluster (Size)</span>
              <span>Show / select</span>
            </div>
            <div className="cluster-items">
              {clusters
                .map((cluster, index) => ({ cluster, originalIndex: index }))
                .sort((a, b) => b.cluster.length - a.cluster.length) // Sort by size (largest first)
                .map(({ cluster, originalIndex }, sortedIndex) => (
                  <div key={originalIndex} className="cluster-item">
                    <input
                      className="cluster-swatch"
                      type="color"
                      value={clusterColorAt(originalIndex)}
                      onChange={(e) => setColorOverrides(previous => ({
                        ...previous, [originalIndex]: e.target.value,
                      }))}
                      title="Colour for this cluster"
                      aria-label={`Colour for cluster ${originalIndex + 1}`}
                    />
                    <span className="cluster-info">
                      {fileClusters?.[originalIndex]?.name ?? `Cluster ${originalIndex + 1}`}
                      {' '}({cluster.length} particles)
                    </span>
                    <button
                      className={`cluster-visibility ${hiddenClusters.has(originalIndex) ? 'is-hidden' : ''}`}
                      onClick={() => toggleClusterVisible(originalIndex)}
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
                        onChange={() => handleClusterToggle(originalIndex)}
                      />
                    </label>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      </div>
    </DraggablePanel>
  );
}

export default ClusteringPane;

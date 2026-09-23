import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParticleStore } from '../../store/particleStore';
import { useClusteringStore, isSceneRestricted } from '../../store/clusteringStore';
import { clearClustering } from '../../store/commands';
import { useOverlayStore, COMPUTED_VIEW } from '../../store/overlayStore';
import { clusterOverlayFromFile } from '../../utils/overlays';
import { useUIStore } from '../../store/uiStore';
import DraggablePanel from '../DraggablePanel';
import { generateHistogram } from '../../utils/clustering';
import { parseClusterFile } from '../../utils/clusterFile';
import ClusterHistogram from './ClusterHistogram';
import ClusterSourceControls from './ClusterSourceControls';
import ClusterStatistics from './ClusterStatistics';
import ClusterParameters from './ClusterParameters';
import ClusterList from './ClusterList';
import useClusterSource from './useClusterSource';
import useClusterColours from './useClusterColours';
import useClusterPublication from './useClusterPublication';
import ClusterKymograph from '../ClusterKymograph';
import useKymograph from '../ClusterKymograph/useKymograph';
import { CloseIcon } from '../Icons';
import './ClusteringPane.css';


function ClusteringPane() {
  // Get data from Zustand stores
  const positions = useParticleStore(state => state.positions);
  const dimNonSelectedClusters = useClusteringStore(state => state.dimNonSelectedClusters);
  const setDimNonSelectedClusters = useClusteringStore(state => state.setDimNonSelectedClusters);
  // Visibility belongs to the UI store, which is what the control-bar toggle
  // reads. A second local flag here let the two disagree about whether the
  // pane was open.
  const setShowClusteringPane = useUIStore(state => state.setShowClusteringPane);
  const showClusteringPane = useUIStore(state => state.showClusteringPane);
  const activeOverlayId = useOverlayStore(state => state.activeOverlayId);
  const addOverlay = useOverlayStore(state => state.addOverlay);
  const setActiveOverlay = useOverlayStore(state => state.setActiveOverlay);
  const colorScheme = useUIStore(state => state.currentColorScheme);
  const fileInputRef = useRef(null);
  const [fileError, setFileError] = useState(null);
  const [fileWarnings, setFileWarnings] = useState([]);
  // Per-cluster colour overrides, keyed by cluster index in the active list.
  const [colorOverrides, setColorOverrides] = useState({});
  // Cluster indices switched off by the eye control. Separate from selection:
  // hiding a cluster works whether or not "show only selected" is on.
  //
  // These three live in the store, not here: the pane unmounts when it is
  // closed, and with the state went the effect that publishes it — so a scene
  // left clustered had nothing listening to the View control, and the only
  // control that could undo it disappeared along with the pane.
  const hiddenClusters = useClusteringStore(state => state.hiddenClusters);
  const setHiddenClusters = useClusteringStore(state => state.setHiddenClusters);
  const selectedClusters = useClusteringStore(state => state.selectedClusters);
  const setSelectedClusters = useClusteringStore(state => state.setSelectedClusters);
  const showOnlySelected = useClusteringStore(state => state.showOnlySelected);
  const setShowOnlySelected = useClusteringStore(state => state.setShowOnlySelected);
  const sceneIsRestricted = useClusteringStore(isSceneRestricted);

  const {
    clusters, clusterSource, clusterSourceId, setClusterSourceId, clusterOverlays,
    fileClusters, epsilon, setEpsilon, epsilonLimit, minPoints, setMinPoints,
    minClusterSize, setMinClusterSize,
  } = useClusterSource();

  // Optional and explicitly asked for: this is DBSCAN once per frame.
  const [showKymograph, setShowKymograph] = useState(false);
  const {
    result: kymograph, running: kymographRunning,
    compute: computeKymograph, cancel: cancelKymograph, clear: clearKymograph,
  } = useKymograph();


  // True when the active view is the very cluster set shown here — including
  // the computed clusters, which are a view in their own right. Treating DBSCAN
  // as "no view" left its clusters with no colours at all.
  const colorByCluster = activeOverlayId === (clusterSourceId ?? COMPUTED_VIEW);
  const groupingName = clusterSource?.name ?? 'Computed clusters';

  const { clusterColorAt } = useClusterColours({
    clusters, colorScheme, fileClusters, colorOverrides,
  });




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
    // Store setters are stable references, so listing them costs nothing; the
    // ref guard above is what actually keeps this from fighting manual changes.
  }, [clusterSourceId, fileClusters, setSelectedClusters, setHiddenClusters, setShowOnlySelected]);

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
  // Every handler that derives a new selection from the old one reads through
  // the store rather than the render closure. The setter takes a value, not an
  // updater, so two clicks landing in the same tick would both start from the
  // same pre-click set and the first would be lost.
  const currentSelection = () => useClusteringStore.getState().selectedClusters;

  const handleClusterToggle = useCallback((clusterIndex) => {
    const newSelected = new Set(currentSelection());
    if (newSelected.has(clusterIndex)) {
      newSelected.delete(clusterIndex);
    } else {
      newSelected.add(clusterIndex);
    }
    setSelectedClusters(newSelected);
  }, [setSelectedClusters]);

  // Select all clusters
  const selectAllClusters = () => {
    setSelectedClusters(new Set(clusters.map((_, index) => index)));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedClusters(new Set());
  };
  
  // Handle clicking on histogram bar to select clusters of that size
  const handleHistogramBarClick = useCallback((clusterSize, event) => {
    const clustersOfSize = [];
    clusters.forEach((cluster, index) => {
      if (cluster.length === clusterSize) {
        clustersOfSize.push(index);
      }
    });
    
    if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd+click: Add to existing selection
      const newSelected = new Set(currentSelection());
      clustersOfSize.forEach(idx => newSelected.add(idx));
      setSelectedClusters(newSelected);
    } else {
      // Normal click: Replace selection
      setSelectedClusters(new Set(clustersOfSize));
    }
    
    // Automatically enable "show only selected" mode
    setShowOnlySelected(true);
  }, [clusters, setSelectedClusters, setShowOnlySelected]);

  // Notify store about highlighted clusters
  useClusterPublication({
    clusters, selectedClusters, showOnlySelected, hiddenClusters,
    colorByCluster, clusterColorAt,
  });

  // Everything the pane can do to the scene, undone in one click.
  //
  // Getting back out used to mean finding four controls across two panels:
  // clear the selection, uncheck "show only selected", un-hide any clusters
  // switched off by their eye, and set the View back. Worse, "Clear All" on its
  // own *emptied* the scene, because showing only the selected clusters when
  // nothing is selected shows nothing — the opposite of what the name promises.
  // Colours need no undoing: with nothing highlighted the pane publishes no
  // colours, so particles fall back to their type colour by themselves.
  const showEverything = clearClustering;

  // Point the View at whatever was just chosen. Otherwise a cluster file left
  // active in the View keeps colouring the scene while the pane groups by
  // something else entirely.
  const chooseClusterSource = useCallback((next) => {
    setClusterSourceId(next);
    setActiveOverlay(next ?? COMPUTED_VIEW);
  }, [setClusterSourceId, setActiveOverlay]);

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

  const setClusterColor = useCallback((index, color) => {
    setColorOverrides(previous => ({ ...previous, [index]: color }));
  }, []);

  // Overrides are keyed by cluster index, and DBSCAN renumbers on every
  // recompute — so a swatch set on cluster 3 would follow the index onto
  // whatever cluster 3 became, painting an unrelated group and silently
  // reverting the one it was chosen for.
  const clusterCountRef = useRef(clusters.length);
  useEffect(() => {
    if (clusterCountRef.current === clusters.length) return;
    clusterCountRef.current = clusters.length;
    setColorOverrides({});
  }, [clusters.length]);

  const toggleClusterVisible = useCallback((clusterIndex) => {
    // Read through the store, not the render closure: the setter takes a value
    // rather than an updater, so two clicks landing in one tick would both start
    // from the same pre-click set and the first would be lost.
    const next = new Set(useClusteringStore.getState().hiddenClusters);
    if (next.has(clusterIndex)) next.delete(clusterIndex);
    else next.add(clusterIndex);
    setHiddenClusters(next);
  }, [setHiddenClusters]);
  
  /**
   * The particles of the selected clusters, which is what the time view greys
   * everything else against.
   *
   * Particle indices rather than cluster indices, because a cluster index means
   * something different in every frame — the time view is drawn per particle for
   * exactly that reason.
   */
  const selectedParticles = useMemo(() => {
    const out = new Set();
    selectedClusters.forEach((clusterIndex) => {
      (clusters[clusterIndex] ?? []).forEach(particle => out.add(particle));
    });
    return out;
  }, [selectedClusters, clusters]);

  const runKymograph = useCallback(() => {
    setShowKymograph(true);
    computeKymograph({ epsilon, minPoints });
  }, [computeKymograph, epsilon, minPoints, setShowKymograph]);

  // The time view outlives the panel deliberately, the same way the clustering
  // itself does: it costs a minute to build, and closing the controls that
  // started it is not a reason to throw it away.
  const timeView = showKymograph ? (
    <ClusterKymograph
      data={kymograph}
      selectedParticles={selectedParticles}
      // The store's Set, whose identity changes only when someone selects
      // something — unlike the particle set, which the pane rebuilds from the
      // current frame's clusters on every frame.
      selectionToken={selectedClusters}
      running={kymographRunning}
      onRecompute={runKymograph}
      onClose={() => { setShowKymograph(false); cancelKymograph(); clearKymograph(); }}
    />
  ) : null;

  // No UI when there is nothing to cluster, or when the panel is closed — but
  // the hooks above still run, which is the point: closing the panel hides the
  // controls, it does not switch the clustering off.
  if (!positions || positions.length === 0 || !showClusteringPane) {
    return timeView;
  }

  return (
    <>
    {timeView}
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

      <ClusterSourceControls
        clusterSourceId={clusterSourceId}
        clusterOverlays={clusterOverlays}
        onSourceChange={chooseClusterSource}
        onLoadFile={openFilePicker}
        fileInputRef={fileInputRef}
        onFileChosen={handleClusterFile}
        fileError={fileError}
        fileWarnings={fileWarnings}
        hasClusters={clusters.length > 0}
        colorByCluster={colorByCluster}
        groupingName={groupingName}
      />

      <ClusterParameters
        epsilon={epsilon}
        onEpsilonChange={setEpsilon}
        epsilonLimit={epsilonLimit}
        minPoints={minPoints}
        onMinPointsChange={setMinPoints}
        minClusterSize={minClusterSize}
        onMinClusterSizeChange={setMinClusterSize}
        disabled={!!fileClusters}
      />

      <ClusterStatistics statistics={statistics} />

      <ClusterHistogram
        bins={histogramData}
        maxBinCount={maxBinCount}
        clusters={clusters}
        selectedClusters={selectedClusters}
        clusterColorAt={clusterColorAt}
        onBarClick={handleHistogramBarClick}
      />

      {/* Cluster Selection */}
      <div className="cluster-selection">
        <div className="selection-controls">
          <h4>Cluster Highlighting</h4>
          <div className="selection-buttons">
            <button onClick={selectAllClusters} className="select-button">
              Select all
            </button>
            {/* Named for what it does. "Clear All" read as "undo all of this"
                and did the reverse. */}
            <button onClick={clearSelection} className="select-button">
              Clear selection
            </button>
            {sceneIsRestricted && (
              <button
                onClick={showEverything}
                className="select-button is-reset"
                title="Stop restricting the scene: clear the selection, show every cluster again"
              >
                Show all particles
              </button>
            )}
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
          <div className="pp-section">
            <button
              className="select-button"
              onClick={runKymograph}
              disabled={kymographRunning}
              title="Cluster every frame and draw the result as time across, particles down"
            >
              {kymographRunning ? 'Building the time view…' : 'Clusters over time'}
            </button>
            {kymographRunning && (
              <button className="select-button" onClick={cancelKymograph}>Stop</button>
            )}
          </div>
        )}

        {clusters.length > 0 && (
          <ClusterList
            clusters={clusters}
            selectedClusters={selectedClusters}
            hiddenClusters={hiddenClusters}
            fileClusters={fileClusters}
            clusterColorAt={clusterColorAt}
            onColorChange={setClusterColor}
            onToggleVisible={toggleClusterVisible}
            onToggleSelected={handleClusterToggle}
          />
        )}
      </div>

      </div>
    </DraggablePanel>
    </>
  );
}

export default ClusteringPane;

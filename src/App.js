import React, { useEffect, useCallback, useMemo, useRef, useState } from "react";
import FileDropZone from "./components/FileDropZone";
import FileDropOverlay from "./components/FileDropOverlay";
import ParticleScene from "./components/ParticleScene";
import PatchLegend from "./components/PatchLegend";
import ParticleLegend from "./components/ParticleLegend";
import SelectedParticlesDisplay from "./components/SelectedParticlesDisplay";
import SceneBackgroundToggle from "./components/SceneBackgroundToggle";
import ClusteringPane from "./components/ClusteringPane";
import ControlBar from "./components/ControlBar";
import LightingControlsModal from "./components/LightingControlsModal";
import { analyzeFiles, categorizeFiles } from "./formats/detection";
import { applyPeriodicWrapping } from "./utils/geometryUtils";
import { captureScreenshot, exportSceneAsGLTF } from "./utils/exportUtils";
import { useParticleStore } from "./store/particleStore";
import { useUIStore } from "./store/uiStore";
import { useClusteringStore } from "./store/clusteringStore";
import { parseClusterFile } from "./utils/clusterFile";
import { useOverlayStore } from "./store/overlayStore";
import { clusterOverlayFromFile } from "./utils/overlays";
import { loadSimulation } from "./loading/loadSimulation";
import { loadFrame } from "./loading/loadFrame";
import { classifyDrop } from "./loading/resolveFiles";
import { createLoadTokens, runLoad } from "./loading/staleness";
import usePlayback from "./hooks/usePlayback";
import useKeyboardShortcuts from "./hooks/useKeyboardShortcuts";
import useIframeBridge from "./hooks/useIframeBridge";
import "./styles.css";

function App() {
  // Zustand stores
  const {
    positions,
    currentBoxSize,
    topData,
    trajFile,
    configIndex,
    currentConfigIndex,
    currentTime,
    totalConfigs,
    setPositions,
    setCurrentBoxSize,
    setTopData,
    setTrajFile,
    setConfigIndex,
    setCurrentConfigIndex,
    setCurrentTime,
    setCurrentEnergy,
    setTotalConfigs,
    setParticleRadius,
    setFormatParticleRadius,
    resetParticleRadius,
    currentEnergy,
    particleRadius,
  } = useParticleStore();

  // The store writers the load pipeline needs, bundled once. Store setters are
  // stable, so this object is too — it can sit in a dependency array without
  // re-creating the callback that holds it.
  const sceneWriters = useMemo(() => ({
    setTopData, setPositions, setCurrentBoxSize, setCurrentTime, setCurrentEnergy,
    setConfigIndex, setTotalConfigs, setTrajFile, setFormatParticleRadius,
  }), [setTopData, setPositions, setCurrentBoxSize, setCurrentTime, setCurrentEnergy,
       setConfigIndex, setTotalConfigs, setTrajFile, setFormatParticleRadius]);

  const {
    showPatchLegend,
    showParticleLegend,
    showSimulationBox,
    showBackdropPlanes,
    showCoordinateAxis,
    showStats,
    isControlsVisible,
    showClusteringPane,
    filesDropped,
    isLoading,
    sceneRef,
    isIframeMode,
    isDragDropEnabled,
    currentColorScheme,
    isPlaying,
    playbackSpeed,
    isSpeedPopupVisible,
    isLightingControlsModalOpen,
    setShowPatchLegend,
    setShowParticleLegend,
    setShowSimulationBox,
    setShowBackdropPlanes,
    setShowCoordinateAxis,
    setShowStats,
    setIsControlsVisible,
    setShowClusteringPane,
    setFilesDropped,
    setIsLoading,
    setPlaybackSpeed,
    setIsSpeedPopupVisible,
    setIsLightingControlsModalOpen,
    sphereSegments,
    setSphereSegments,
  } = useUIStore();

  const highlightedClusters = useClusteringStore(state => state.highlightedClusters);

  // Refs
  // Identifies the most recent load. Anything older that is still awaiting a
  // file read checks this before writing to the store, so dropping a second
  // simulation mid-load cannot be clobbered by the first one finishing late.
  // One source of load tokens for the whole component: beginning a load
  // invalidates any earlier one, and the pipeline stops at its next await.
  const loadTokens = useRef(createLoadTokens());
  // Clusters dropped alongside the simulation. They cannot be applied until the
  // trajectory has produced positions, because parsing validates every index
  // against the particle count, so the text waits here until then.
  const [pendingClusterFiles, setPendingClusterFiles] = useState(null);
  const speedPopupRef = useRef(null);

  // Function to show notification (for iframe mode)
  const notify = useCallback((message) => {
    console.warn('PPView Notification:', message);
    // In iframe mode, we just log notifications since alert() might be blocked
    if (!isIframeMode) {
      alert(message);
    }
  }, [isIframeMode]);

  // Function to trigger scene re-render when needed
  const invalidateScene = useCallback(() => {
    if (sceneRef && sceneRef.invalidate) {
      sceneRef.invalidate();
    }
  }, [sceneRef]);

  // Function to take a screenshot
  const takeScreenshot = useCallback(() => {
    captureScreenshot(sceneRef, currentConfigIndex, 1.0);
  }, [sceneRef, currentConfigIndex]);


  // Turns cluster files into overlays. Shared by the two ways they arrive:
  // dropped with the simulation at startup, or dropped onto a loaded scene.
  const registerClusterOverlays = useCallback(async (clusterFiles, particleCount) => {
    for (const file of clusterFiles) {
      try {
        const { clusters, warnings } = parseClusterFile(await file.text(), { particleCount });
        useOverlayStore.getState().addOverlay(clusterOverlayFromFile({
          name: file.name.replace(/\.json$/i, ''),
          clusters,
          colorScheme: useUIStore.getState().currentColorScheme,
        }));
        warnings.forEach(w => console.warn(`${file.name}:`, w));
      } catch (error) {
        console.error(`Could not use ${file.name}:`, error.message);
        notify(`${file.name} ignored: ${error.message}`);
      }
    }
  }, [notify]);

  const handleFilesReceived = useCallback(async (files) => {
    if (!files || files.length === 0) return;

    // Classify before touching anything: a drop of nothing but overlay files
    // onto a loaded scene adds to it rather than replacing it.
    const categorized = categorizeFiles(await analyzeFiles(files));
    const positionCount = useParticleStore.getState().positions.length;

    if (classifyDrop(categorized, { sceneIsLoaded: positionCount > 0 }) === 'overlays-only') {
      await registerClusterOverlays(categorized.clusterFiles, positionCount);
      useUIStore.getState().setShowClusteringPane(true);
      return;
    }

    const signal = loadTokens.current.begin();
    setFilesDropped(true);

    // Cluster files dropped with the simulation cannot be parsed yet: their
    // indices are validated against a particle count that does not exist until
    // the first frame loads. Hold the files until then.
    setPendingClusterFiles(categorized.clusterFiles.length ? categorized.clusterFiles : null);

    // Loading a second simulation must not inherit the first one's state.
    // Selection and cluster highlights are particle *indices*, so keeping them
    // would highlight unrelated particles in the new structure — or index past
    // its end. Sizes are per-structure for the same reason.
    useUIStore.getState().setSelectedParticles([]);
    useClusteringStore.getState().resetClusters();
    useOverlayStore.getState().clearOverlays();
    resetParticleRadius();
    setTopData(null);
    setPositions([]);
    setTrajFile(null);
    setConfigIndex([]);
    setCurrentConfigIndex(0);
    setTotalConfigs(0);
    setIsLoading(true);

    const outcome = await runLoad(() => loadSimulation({
      files, categorized, signal, scene: sceneWriters,
    }));

    // A superseded load is not a failure: a newer drop owns the scene now, and
    // clearing the spinner or the drop zone here would fight it.
    if (outcome.superseded) return;

    setIsLoading(false);
    if (!outcome.ok) {
      console.error('Could not load the dropped files:', outcome.error ?? outcome.message);
      notify(outcome.message);
      setFilesDropped(false);
    }
  }, [setFilesDropped, setIsLoading, resetParticleRadius, setTopData, setPositions,
      setConfigIndex, setCurrentConfigIndex, setTotalConfigs, setTrajFile,
      registerClusterOverlays, sceneWriters, notify]);

  // Read the current frame whenever the trajectory or the position in it moves.
  //
  // The dependency list is honest now: loadFrame takes everything it needs as
  // arguments, so there is nothing to suppress. It used to call a component-scope
  // async function behind an exhaustive-deps disable.
  useEffect(() => {
    if (!topData || !trajFile || configIndex.length === 0) return;
    loadFrame({
      file: trajFile,
      index: configIndex,
      frameNumber: currentConfigIndex,
      topData,
      scene: sceneWriters,
    }).catch(error => {
      console.error('Could not read that frame:', error);
      notify(error.message);
    });
  }, [topData, trajFile, configIndex, currentConfigIndex, sceneWriters, notify]);





  // Single entry point for every way of changing frame — slider, step buttons,
  // arrow keys — so the clamp and the redraw can never be forgotten by one of
  // them.
  const { goToFrame, stepFrame, togglePlayback, resetTrajectory } = usePlayback({
    totalConfigs, invalidateScene,
  });

  const handleSliderChange = (e) => goToFrame(parseInt(e.target.value, 10));

  // Handle click outside speed popup
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isSpeedPopupVisible && speedPopupRef.current && !speedPopupRef.current.contains(event.target)) {
        setIsSpeedPopupVisible(false);
      }
    };

    if (isSpeedPopupVisible) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSpeedPopupVisible, setIsSpeedPopupVisible]);

  // Function to shift positions along an axis
  const shiftPositions = useCallback(
    (axis, delta) => {
      // Get current positions from store (Zustand doesn't support function updaters)
      const currentPositions = useParticleStore.getState().positions;

      // Safeguard: ensure currentPositions is an array
      if (!Array.isArray(currentPositions)) {
        console.error('shiftPositions: currentPositions is not an array:', currentPositions);
        return;
      }

      const shiftedPositions = currentPositions.map((pos) => {
        const newPos = { ...pos };
        newPos[axis] = pos[axis] + delta;
        return newPos;
      });

      // Apply only periodic wrapping without re-centering
      const adjustedPositions = applyPeriodicWrapping(
        shiftedPositions,
        currentBoxSize,
      );

      setPositions(adjustedPositions);

      // Trigger re-render when translation happens
      setTimeout(invalidateScene, 0);
    },
    [currentBoxSize, invalidateScene, setPositions],
  );

  // Function to export the scene as GLTF
  const exportGLTF = useCallback(() => {
    const particleRadius = useParticleStore.getState().particleRadius;
    exportSceneAsGLTF({
      positions,
      currentBoxSize,
      currentConfigIndex,
      showSimulationBox,
      showBackdropPlanes,
      currentColorScheme,
      topData,
      highlightedClusters,
      sceneRef,
      particleRadius
    });
  }, [positions, currentBoxSize, currentConfigIndex, showSimulationBox, showBackdropPlanes, currentColorScheme, topData, highlightedClusters, sceneRef]);

  // Function to create output files for download
  const makeOutputFiles = useCallback(() => {
    try {
      // Export GLTF
      exportGLTF();

      // Take screenshot
      takeScreenshot();

      console.log('Output files generated successfully');
    } catch (error) {
      console.error('Error generating output files:', error);
    }
  }, [exportGLTF, takeScreenshot]);

  useIframeBridge({ handleFilesReceived, makeOutputFiles, notify });

  // Clusters dropped with the simulation are registered as soon as the first
  // frame has produced positions — any earlier and every index would look
  // out-of-range.
  useEffect(() => {
    if (!pendingClusterFiles || positions.length === 0) return;
    const files = pendingClusterFiles;
    setPendingClusterFiles(null);
    registerClusterOverlays(files, positions.length)
      .then(() => useUIStore.getState().setShowClusteringPane(true));
  }, [pendingClusterFiles, positions.length, registerClusterOverlays]);

  useKeyboardShortcuts({
    togglePlayback, stepFrame, goToFrame, totalConfigs, shiftPositions, takeScreenshot,
  });

  // Particle size is a display choice as much as a data one — a radius read
  // from the input file is often not the one that makes a structure readable.
  const handleRadiusChange = useCallback((value) => {
    const radius = Math.min(Math.max(value, 0.05), 5);
    if (!Number.isFinite(radius)) return;
    setParticleRadius(radius);
    setTimeout(invalidateScene, 0);
  }, [setParticleRadius, invalidateScene]);


  return (
    <div className="App">
      {!filesDropped && (
        <FileDropZone
          onFilesReceived={handleFilesReceived}
          isDragDropEnabled={isDragDropEnabled}
          onDisabledDrop={() => notify("Dragging onto embedded viewer does not allow form completion")}
        />
      )}

      {positions.length > 0 && <ParticleScene />}

      {/* Once a scene is up the initial drop zone is gone, so dragging more
          files anywhere over the window reveals a target for them. */}
      <FileDropOverlay
        onFilesReceived={handleFilesReceived}
        enabled={filesDropped && isDragDropEnabled}
      />

      {positions.length > 0 && !isLoading && !isIframeMode && <SceneBackgroundToggle />}

      {positions.length > 0 && !isLoading && (
        <ControlBar
          isControlsVisible={isControlsVisible} setIsControlsVisible={setIsControlsVisible}
          isPlaying={isPlaying} togglePlayback={togglePlayback}
          resetTrajectory={resetTrajectory} stepFrame={stepFrame}
          currentConfigIndex={currentConfigIndex} totalConfigs={totalConfigs}
          currentTime={currentTime} currentEnergy={currentEnergy}
          playbackSpeed={playbackSpeed} setPlaybackSpeed={setPlaybackSpeed}
          isSpeedPopupVisible={isSpeedPopupVisible} setIsSpeedPopupVisible={setIsSpeedPopupVisible}
          speedPopupRef={speedPopupRef} handleSliderChange={handleSliderChange}
          showSimulationBox={showSimulationBox} setShowSimulationBox={setShowSimulationBox}
          showCoordinateAxis={showCoordinateAxis} setShowCoordinateAxis={setShowCoordinateAxis}
          showBackdropPlanes={showBackdropPlanes} setShowBackdropPlanes={setShowBackdropPlanes}
          showParticleLegend={showParticleLegend} setShowParticleLegend={setShowParticleLegend}
          showPatchLegend={showPatchLegend} setShowPatchLegend={setShowPatchLegend}
          showClusteringPane={showClusteringPane} setShowClusteringPane={setShowClusteringPane}
          showStats={showStats} setShowStats={setShowStats}
          isLightingControlsModalOpen={isLightingControlsModalOpen}
          setIsLightingControlsModalOpen={setIsLightingControlsModalOpen}
          sphereSegments={sphereSegments} setSphereSegments={setSphereSegments}
          particleRadius={particleRadius} handleRadiusChange={handleRadiusChange}
          takeScreenshot={takeScreenshot} exportGLTF={exportGLTF}
        />
      )}

      <SelectedParticlesDisplay />

      {topData && showPatchLegend && !isLoading && <PatchLegend />}
      {topData && showParticleLegend && !isLoading && <ParticleLegend />}
      {/* Mounted whenever there is a structure, not only while the panel is
          open: it owns the clustering applied to the scene, which outlives the
          panel. It renders nothing when closed. */}
      {positions.length > 0 && !isLoading && <ClusteringPane />}

      {isLoading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <p>Reading trajectory</p>
        </div>
      )}

      <LightingControlsModal
        isOpen={isLightingControlsModalOpen}
        onClose={() => setIsLightingControlsModalOpen(false)}
      />
    </div>
  );
}

export default App;

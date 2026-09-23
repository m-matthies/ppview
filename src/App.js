import React, { useEffect, useCallback, useMemo, useRef, useState } from "react";
import FileDropZone from "./components/FileDropZone";
import FileDropOverlay from "./components/FileDropOverlay";
import BusyIndicator from "./components/BusyIndicator";
import FilePicker from "./components/FilePicker";
import ImpostorIndicator from "./components/ImpostorIndicator";
import ParticleScene from "./components/ParticleScene";
import PatchLegend from "./components/PatchLegend";
import ParticleLegend from "./components/ParticleLegend";
import SelectedParticlesDisplay from "./components/SelectedParticlesDisplay";
import SceneBackgroundToggle from "./components/SceneBackgroundToggle";
import ClusteringPane from "./components/ClusteringPane";
import ControlBar from "./components/ControlBar";
import LightingControlsModal from "./components/LightingControlsModal";
import { analyzeFiles, categorizeFiles } from "./formats/detection";
import { useShallow } from "zustand/react/shallow";
import { useParticleStore } from "./store/particleStore";
import { selectParticleCount } from "./store/selectors";
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
import useSceneExport from "./hooks/useSceneExport";
import useParticleShift from "./hooks/useParticleShift";
import useKeyboardShortcuts from "./hooks/useKeyboardShortcuts";
import useIframeBridge from "./hooks/useIframeBridge";
import "./styles.css";
import { resetClusterIdentity } from "./utils/clusterIdentity";
import { loadWasmCore } from "./wasm/wasmCore";

// Start fetching the compiled core immediately: it is 26 KB and the first
// frame cannot be read until a file is dropped, so it is always ready in time.
// Nothing waits on it — every caller falls back to the JavaScript path.
loadWasmCore();

function App() {
  // Subscribed to values, not to stores. A bare useParticleStore() re-rendered
  // this component — and the control bar with it — on any write to the store,
  // including every position array a frame or an axis shift produces.
  //
  // particleCount rather than positions: nothing here reads the array, only
  // whether there is a structure and how big it is.
  const particleCount = useParticleStore(selectParticleCount);
  const { topData, trajFile, configIndex, currentConfigIndex, currentTime,
          totalConfigs, currentEnergy, particleRadius } = useParticleStore(useShallow(state => ({
    topData: state.topData,
    trajFile: state.trajFile,
    configIndex: state.configIndex,
    currentConfigIndex: state.currentConfigIndex,
    currentTime: state.currentTime,
    totalConfigs: state.totalConfigs,
    currentEnergy: state.currentEnergy,
    particleRadius: state.particleRadius,
  })));

  // Setters are stable for the life of the store, so one shallow pick of them
  // never causes a render on its own.
  const { setPositions, setCurrentBoxSize, setTopData, setTrajFile, setConfigIndex,
          setCurrentConfigIndex, setCurrentTime, setCurrentEnergy, setTotalConfigs,
          setParticleRadius, setFormatParticleRadius,
          resetParticleRadius } = useParticleStore(useShallow(state => ({
    setPositions: state.setPositions,
    setCurrentBoxSize: state.setCurrentBoxSize,
    setTopData: state.setTopData,
    setTrajFile: state.setTrajFile,
    setConfigIndex: state.setConfigIndex,
    setCurrentConfigIndex: state.setCurrentConfigIndex,
    setCurrentTime: state.setCurrentTime,
    setCurrentEnergy: state.setCurrentEnergy,
    setTotalConfigs: state.setTotalConfigs,
    setParticleRadius: state.setParticleRadius,
    setFormatParticleRadius: state.setFormatParticleRadius,
    resetParticleRadius: state.resetParticleRadius,
  })));

  // The store writers the load pipeline needs, bundled once. Store setters are
  // stable, so this object is too — it can sit in a dependency array without
  // re-creating the callback that holds it.
  const sceneWriters = useMemo(() => ({
    setTopData, setPositions, setCurrentBoxSize, setCurrentTime, setCurrentEnergy,
    setConfigIndex, setTotalConfigs, setTrajFile, setFormatParticleRadius,
  }), [setTopData, setPositions, setCurrentBoxSize, setCurrentTime, setCurrentEnergy,
       setConfigIndex, setTotalConfigs, setTrajFile, setFormatParticleRadius]);

  // Same again for the UI store: a value at a time, shallow-compared, so an
  // unrelated toggle no longer re-renders the whole application.
  const {
    showPatchLegend, showParticleLegend, showSimulationBox, showBackdropPlanes,
    showCoordinateAxis, showStats, isControlsVisible, showClusteringPane,
    filesDropped, isLoading, busyMessage, sceneRef, isIframeMode,
    isDragDropEnabled, isPlaying, playbackSpeed, isSpeedPopupVisible,
    isLightingControlsModalOpen, setShowPatchLegend, setShowParticleLegend, setShowSimulationBox,
    setShowBackdropPlanes, setShowCoordinateAxis, setShowStats, setIsControlsVisible,
    setShowClusteringPane, setFilesDropped, setIsLoading, setPlaybackSpeed,
    setIsSpeedPopupVisible, setIsLightingControlsModalOpen, sphereSegments, setSphereSegments,
  } = useUIStore(useShallow(state => ({
    showPatchLegend: state.showPatchLegend,
    showParticleLegend: state.showParticleLegend,
    showSimulationBox: state.showSimulationBox,
    showBackdropPlanes: state.showBackdropPlanes,
    showCoordinateAxis: state.showCoordinateAxis,
    showStats: state.showStats,
    isControlsVisible: state.isControlsVisible,
    showClusteringPane: state.showClusteringPane,
    filesDropped: state.filesDropped,
    isLoading: state.isLoading,
    busyMessage: state.busyMessage,
    sceneRef: state.sceneRef,
    isIframeMode: state.isIframeMode,
    isDragDropEnabled: state.isDragDropEnabled,
    isPlaying: state.isPlaying,
    playbackSpeed: state.playbackSpeed,
    isSpeedPopupVisible: state.isSpeedPopupVisible,
    isLightingControlsModalOpen: state.isLightingControlsModalOpen,
    setShowPatchLegend: state.setShowPatchLegend,
    setShowParticleLegend: state.setShowParticleLegend,
    setShowSimulationBox: state.setShowSimulationBox,
    setShowBackdropPlanes: state.setShowBackdropPlanes,
    setShowCoordinateAxis: state.setShowCoordinateAxis,
    setShowStats: state.setShowStats,
    setIsControlsVisible: state.setIsControlsVisible,
    setShowClusteringPane: state.setShowClusteringPane,
    setFilesDropped: state.setFilesDropped,
    setIsLoading: state.setIsLoading,
    setPlaybackSpeed: state.setPlaybackSpeed,
    setIsSpeedPopupVisible: state.setIsSpeedPopupVisible,
    setIsLightingControlsModalOpen: state.setIsLightingControlsModalOpen,
    sphereSegments: state.sphereSegments,
    setSphereSegments: state.setSphereSegments,
  })));


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

  // Everything a previous structure left behind. Selection and cluster
  // highlights are particle *indices*, so keeping them across a load would
  // highlight unrelated particles or index past the end; sizes are
  // per-structure for the same reason.
  const resetScene = useCallback(() => {
    // Cluster colours are registered against particle indices, which mean
    // something different in another structure.
    resetClusterIdentity();
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
  }, [resetParticleRadius, setTopData, setPositions, setTrajFile, setConfigIndex,
      setCurrentConfigIndex, setTotalConfigs]);

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
    resetScene();
    setIsLoading(true);

    const outcome = await runLoad(() => loadSimulation({
      files, categorized, signal, scene: sceneWriters,
      status: useUIStore.getState().setBusyMessage,
    }));

    // A superseded load is not a failure: a newer drop owns the scene now, and
    // clearing the spinner or the drop zone here would fight it. The caption
    // belongs to whichever load is still running, so it is left alone too.
    if (outcome.superseded) return;

    setIsLoading(false);
    useUIStore.getState().setBusyMessage(null);
    if (!outcome.ok) {
      console.error('Could not load the dropped files:', outcome.error ?? outcome.message);
      // Reset again. A load can fail *after* the topology has been parsed and
      // written — a drop with a .top and no trajectory does exactly that — and
      // leaving that behind renders the legends of a structure with no
      // coordinates on top of the drop zone.
      resetScene();
      notify(outcome.message);
      setFilesDropped(false);
    }
  }, [setFilesDropped, setIsLoading, resetScene, registerClusterOverlays,
      sceneWriters, notify]);

  // Read the current frame whenever the trajectory or the position in it moves.
  //
  // Cancelled on cleanup, for the same reason loads carry a staleness token:
  // scrubbing quickly, or playing a long trajectory, leaves several frame reads
  // in flight at once and whichever resolves last would otherwise win — leaving
  // the scene showing a different frame from the one the controls report. Worse,
  // a read still running when a new simulation is dropped would paint the old
  // frame, decorated with the old topology, into the new scene.
  useEffect(() => {
    if (!topData || !trajFile || configIndex.length === 0) return undefined;
    let cancelled = false;
    const guarded = Object.fromEntries(
      Object.entries(sceneWriters).map(([name, write]) => [
        name, (...args) => { if (!cancelled) write(...args); },
      ]),
    );
    loadFrame({
      file: trajFile,
      index: configIndex,
      frameNumber: currentConfigIndex,
      topData,
      scene: guarded,
    }).catch(error => {
      if (cancelled) return;
      console.error('Could not read that frame:', error);
      notify(error.message);
    });
    return () => { cancelled = true; };
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

  const shiftPositions = useParticleShift({ invalidateScene });
  const { takeScreenshot, exportGLTF, makeOutputFiles } = useSceneExport({ sceneRef });

  useIframeBridge({ handleFilesReceived, makeOutputFiles, notify });

  // Clusters dropped with the simulation are registered as soon as the first
  // frame has produced positions — any earlier and every index would look
  // out-of-range.
  useEffect(() => {
    if (!pendingClusterFiles || particleCount === 0) return;
    const files = pendingClusterFiles;
    setPendingClusterFiles(null);
    registerClusterOverlays(files, particleCount)
      .then(() => useUIStore.getState().setShowClusteringPane(true));
  }, [pendingClusterFiles, particleCount, registerClusterOverlays]);

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

      {particleCount > 0 && <ParticleScene />}

      {/* Ctrl/Cmd+O, which the initial drop zone's chooser stopped answering the
          moment it unmounted. */}
      <FilePicker onFilesReceived={handleFilesReceived} enabled={isDragDropEnabled} />

      {/* Once a scene is up the initial drop zone is gone, so dragging more
          files anywhere over the window reveals a target for them. */}
      <FileDropOverlay
        onFilesReceived={handleFilesReceived}
        enabled={filesDropped && isDragDropEnabled}
      />

      {particleCount > 0 && !isLoading && !isIframeMode && (
        <div className="scene-corner">
          {/* Only appears when the scene is drawn as impostors. */}
          <ImpostorIndicator />
          <SceneBackgroundToggle />
        </div>
      )}

      {particleCount > 0 && !isLoading && (
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
      {particleCount > 0 && !isLoading && <ClusteringPane />}

      {isLoading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          {/* Whatever stage the load is at, rather than one fixed line that was
              wrong for most of the time it was showing. */}
          <p>{busyMessage ?? 'Reading the simulation'}</p>
        </div>
      )}

      <BusyIndicator />

      <LightingControlsModal
        isOpen={isLightingControlsModalOpen}
        onClose={() => setIsLightingControlsModalOpen(false)}
      />
    </div>
  );
}

export default App;

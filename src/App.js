import React, { useEffect, useCallback, useRef } from "react";
import * as THREE from "three";
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
import { analyzeFiles, categorizeFiles, parseInputFile } from "./formats/detection";
import { readMGL, readMGLTrajectory, convertMGLToPPViewFormat } from "./utils/mglParser";
import { getParticleType } from "./formats/parsers/particleType";
import { parseTopology } from "./formats/registry";
import { buildTrajIndex, parseConfiguration } from "./utils/trajectoryLoader";
import { applyPeriodicBoundary, applyPeriodicWrapping, computeRotationMatrix } from "./utils/geometryUtils";
import { selectFallbackTrajectoryFile, createFileMap } from "./utils/fileLoader";
import { captureScreenshot, exportSceneAsGLTF } from "./utils/exportUtils";
import { useParticleStore } from "./store/particleStore";
import { useUIStore } from "./store/uiStore";
import { useClusteringStore } from "./store/clusteringStore";
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
    currentEnergy,
    particleRadius,
  } = useParticleStore();

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
    setIsPlaying,
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
  const loadTokenRef = useRef(0);
  const playbackIntervalRef = useRef(null);
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


  const handleFilesReceived = useCallback(async (files) => {
    if (!files || files.length === 0) {
      // No files selected or operation cancelled
      return;
    }

    const loadToken = ++loadTokenRef.current;
    const isStale = () => loadToken !== loadTokenRef.current;

    // Set filesDropped to true to hide the drop zone immediately
    setFilesDropped(true);

    // Loading a second simulation must not inherit the first one's state.
    // Selection and cluster highlights are particle *indices*, so keeping them
    // would highlight unrelated particles in the new structure — or index past
    // its end.
    useUIStore.getState().setSelectedParticles([]);
    useClusteringStore.getState().clearHighlighting();
    setTopData(null);
    setPositions([]);
    setTrajFile(null);
    setConfigIndex([]);
    setCurrentConfigIndex(0);
    setTotalConfigs(0);

    // Set loading state to true before indexing
    setIsLoading(true);

    try {
      // Analyze file types dynamically based on content
      console.log("Analyzing file types...");
      const filesWithTypes = await analyzeFiles(files);
      if (isStale()) return;
      const categorizedFiles = categorizeFiles(filesWithTypes);

      console.log("File analysis results:", categorizedFiles);

      // Process input file if present
      let inputFileParams = {};
      if (categorizedFiles.inputFile) {
        try {
          const inputContent = await categorizedFiles.inputFile.text();
          inputFileParams = parseInputFile(inputContent);
          console.log('Parsed input file parameters:', inputFileParams);

          // Check for PATCHY_radius parameter
          if (inputFileParams.PATCHY_radius !== undefined) {
            const radius = inputFileParams.PATCHY_radius;
            console.log(`Found PATCHY_radius in input file: ${radius}`);
            setParticleRadius(radius);
          }
        } catch (error) {
          console.warn('Error parsing input file:', error);
          // Non-fatal error, continue processing other files
        }
      }

      // Process MGL files first (they don't need topology)
      if (categorizedFiles.mglFile || categorizedFiles.mglTrajectory) {
        try {
          let mglData, ppviewData;

          if (categorizedFiles.mglFile) {
            const mglContent = await categorizedFiles.mglFile.text();
            if (isStale()) return;
            console.log(`Processing MGL file: ${categorizedFiles.mglFile.name}`);

            mglData = readMGL(mglContent);
            ppviewData = convertMGLToPPViewFormat(mglData);

            // Set up data for ppview
            setTopData(ppviewData.topData);
            setPositions(ppviewData.positions);
            setCurrentBoxSize(ppviewData.boxSize);
            setCurrentTime(0);
            setCurrentEnergy([0]);
            setConfigIndex([0]); // Single frame
            setTotalConfigs(1);

            console.log(`Loaded MGL file with ${ppviewData.positions.length} particles`);
          } else {
            const mglTrajectoryContent = await categorizedFiles.mglTrajectory.text();
            if (isStale()) return;
            console.log(`Processing MGL Trajectory file: ${categorizedFiles.mglTrajectory.name}`);

            mglData = readMGLTrajectory(mglTrajectoryContent);
            ppviewData = convertMGLToPPViewFormat(mglData);

            // Set up data for ppview
            setTopData(ppviewData.topData);
            setPositions(ppviewData.positions);
            setCurrentBoxSize(ppviewData.boxSize);
            setCurrentTime(0);
            setCurrentEnergy([0]);

            // Create trajectory index for frame navigation if multiple frames
            if (mglData.frameCount > 1) {
              const fakeIndex = Array.from({ length: mglData.frameCount }, (_, i) => i);
              setConfigIndex(fakeIndex);
              setTotalConfigs(mglData.frameCount);

              // Store trajectory data for frame switching
              setTrajFile({
                ...categorizedFiles.mglTrajectory,
                mglTrajectoryData: mglData
              });
            } else {
              setConfigIndex([0]);
              setTotalConfigs(1);
            }

            console.log(`Loaded MGL trajectory with ${mglData.frameCount} frames and ${mglData.totalParticles} total particles`);
          }

          setIsLoading(false);
          return; // Exit early since MGL is self-contained
        } catch (error) {
          console.error('Error processing MGL file:', error);
          alert('Error processing MGL file. Please check the console for details.');
          setFilesDropped(false);
          setIsLoading(false);
          return;
        }
      }

      // Create file map for compatibility with existing code
      const fileMap = createFileMap(files);

      // Process topology file (only for non-MGL files)
      if (categorizedFiles.topology) {
        const topFile = categorizedFiles.topology.file;
        const topContent = await topFile.text();
        const { data: parsedTopData, format } = await parseTopology(
          topContent,
          fileMap,
          categorizedFiles.topology.format,
          {
            particleFile: inputFileParams.particle_file,
            patchFile: inputFileParams.patchy_file,
          },
        );
        if (isStale()) return;
        setTopData(parsedTopData);
        // Any format-specific store setup lives with the format, not here.
        format?.onLoad?.(parsedTopData, { setParticleRadius });
        console.log(`Loaded ${categorizedFiles.topology.format} topology from ${topFile.name}`);
      } else {
        // Fallback: look for .top extension
        const topFile = files.find((file) => file.name.endsWith(".top"));
        if (topFile) {
          const topContent = await topFile.text();
          const { data: parsedTopData, format } = await parseTopology(topContent, fileMap, null, {
            particleFile: inputFileParams.particle_file,
            patchFile: inputFileParams.patchy_file,
          });
          if (isStale()) return;
          setTopData(parsedTopData);
          format?.onLoad?.(parsedTopData, { setParticleRadius });
          console.log(`Loaded topology from ${topFile.name} (fallback detection)`);
        } else {
          alert("No topology file detected! Please ensure you have a valid topology file.");
          setFilesDropped(false);
          setIsLoading(false);
          return;
        }
      }

      // Process trajectory file
      if (categorizedFiles.trajectory) {
        setTrajFile(categorizedFiles.trajectory);
        console.log(`Detected trajectory file: ${categorizedFiles.trajectory.name}`);
      } else {
        // Fallback: look for common trajectory file patterns with prioritization
        const fallbackTrajectoryFiles = files.filter(
          (file) =>
            file.name.includes("traj") ||
            file.name.includes("conf") ||
            file.name.includes("last") ||
            file.name.includes("init") ||
            file.name.endsWith(".dat")
        );

        if (fallbackTrajectoryFiles.length > 0) {
          // Apply same prioritization logic for fallback files
          const selectedFile = selectFallbackTrajectoryFile(fallbackTrajectoryFiles);
          setTrajFile(selectedFile);
          console.log(`Using trajectory file: ${selectedFile.name} (fallback detection with prioritization)`);
        } else {
          alert("No trajectory file detected! Please ensure you have a valid trajectory file.");
          setFilesDropped(false);
          setIsLoading(false);
          return;
        }
      }

      // Build the trajectory index
      const trajectoryFileToUse = categorizedFiles.trajectory || files.find(
        (file) =>
          file.name.includes("traj") ||
          file.name.includes("conf") ||
          file.name.includes("last") ||
          file.name.endsWith(".dat")
      );

      if (trajectoryFileToUse) {
        const index = await buildTrajIndex(trajectoryFileToUse);
        if (isStale()) return;
        setConfigIndex(index);
        setTotalConfigs(index.length);
      }


      // Report unknown files
      if (categorizedFiles.unknown.length > 0) {
        console.warn("Unknown file types detected:", categorizedFiles.unknown.map(f => f.name));
      }

      // Set loading state to false after indexing
      setIsLoading(false);
    } catch (error) {
      console.error("Error processing files:", error);
      if (isStale()) return;
      alert("Error processing files. Please check the console for details.");
      setFilesDropped(false);
      setIsLoading(false);
    }
  }, [setFilesDropped, setIsLoading, setParticleRadius, setTopData, setPositions,
      setCurrentBoxSize, setCurrentTime, setCurrentEnergy, setConfigIndex,
      setCurrentConfigIndex, setTotalConfigs, setTrajFile]);

  // Load configuration when topData, trajFile, and configIndex are available
  useEffect(() => {
    if (topData && trajFile && configIndex.length > 0) {
      loadConfiguration(trajFile, configIndex, currentConfigIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topData, trajFile, configIndex, currentConfigIndex]);


  const loadConfiguration = async (file, index, configNumber) => {
    if (configNumber < 0 || configNumber >= index.length) {
      alert("Configuration number out of range");
      return false;
    }

    // Ensure topData is available
    if (!topData) {
      alert("Topology data not available.");
      return false;
    }

    // Handle MGL trajectory data
    if (file.mglTrajectoryData) {
      const mglData = file.mglTrajectoryData;
      if (configNumber >= mglData.frameCount) {
        alert("MGL frame number out of range");
        return false;
      }

      const frame = mglData.frames[configNumber];
      const ppviewData = convertMGLToPPViewFormat({ frames: [frame] });

      setPositions(ppviewData.positions);
      setCurrentBoxSize(ppviewData.boxSize);
      setCurrentTime(configNumber); // Use frame index as time
      setCurrentEnergy([0]); // Default energy for MGL
      return true;
    }

    const start = index[configNumber];
    const end =
      configNumber + 1 < index.length ? index[configNumber + 1] : file.size;
    const slice = file.slice(start, end);

    const content = await slice.text();
    const lines = content.split(/\r?\n/);

    const config = parseConfiguration(lines);
    if (config) {
      // Apply periodic boundaries
      const adjustedPositions = applyPeriodicBoundary(
        config.positions,
        config.boxSize,
      );

      // Associate particle types and compute rotation matrices
      const positionsWithTypes = adjustedPositions.map((pos, index) => {
        const { typeIndex, particleType } = getParticleType(
          index,
          topData,
        );

        // Compute rotation matrix from orientation vectors
        const rotationMatrix = computeRotationMatrix(pos, THREE);

        return {
          ...pos,
          typeIndex,
          particleType,
          rotationMatrix,
        };
      });

      setPositions(positionsWithTypes);
      setCurrentBoxSize(config.boxSize);
      setCurrentTime(config.time);
      setCurrentEnergy(config.energy);
      return true;
    } else {
      alert("Failed to parse configuration");
      return false;
    }
  };





  // Single entry point for every way of changing frame — slider, step buttons,
  // arrow keys — so the clamp and the redraw can never be forgotten by one of
  // them.
  const goToFrame = useCallback((index) => {
    const clamped = Math.min(Math.max(index, 0), Math.max(totalConfigs - 1, 0));
    if (clamped === useParticleStore.getState().currentConfigIndex) return;
    setCurrentConfigIndex(clamped);
    setTimeout(invalidateScene, 0);
  }, [totalConfigs, invalidateScene, setCurrentConfigIndex]);

  const handleSliderChange = (e) => goToFrame(parseInt(e.target.value, 10));

  const stepFrame = useCallback((delta) => {
    goToFrame(useParticleStore.getState().currentConfigIndex + delta);
  }, [goToFrame]);

  // Function to toggle trajectory playback
  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      // Stop playback
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
      setIsPlaying(false);
    } else {
      // Start playback
      setIsPlaying(true);
      playbackIntervalRef.current = setInterval(() => {
        const currentIndex = useParticleStore.getState().currentConfigIndex;
        const nextIndex = currentIndex + 1;
        if (nextIndex >= totalConfigs) {
          // Reached the end, stop playback
          if (playbackIntervalRef.current) {
            clearInterval(playbackIntervalRef.current);
            playbackIntervalRef.current = null;
          }
          setIsPlaying(false);
        } else {
          setCurrentConfigIndex(nextIndex);
        }
      }, playbackSpeed);
    }
  }, [isPlaying, playbackSpeed, totalConfigs, setIsPlaying, setCurrentConfigIndex]);

  // Function to reset trajectory to beginning
  const resetTrajectory = useCallback(() => {
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
    setIsPlaying(false);
    setCurrentConfigIndex(0);
  }, [setIsPlaying, setCurrentConfigIndex]);

  // Cleanup playback interval on unmount
  useEffect(() => {
    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
      }
    };
  }, []);

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
      {positions.length > 0 && showClusteringPane && !isLoading && <ClusteringPane />}

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

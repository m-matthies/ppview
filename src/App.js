import React, { useEffect, useCallback, useRef } from "react";
import * as THREE from "three";
import FileDropZone from "./components/FileDropZone";
import ParticleScene from "./components/ParticleScene";
import PatchLegend from "./components/PatchLegend";
import ParticleLegend from "./components/ParticleLegend";
import SelectedParticlesDisplay from "./components/SelectedParticlesDisplay";
import ColorSchemeSelector from "./components/ColorSchemeSelector";
import SceneBackgroundToggle from "./components/SceneBackgroundToggle";
import ClusteringPane from "./components/ClusteringPane";
import LightingControlsModal from "./components/LightingControlsModal";
import { analyzeFiles, categorizeFiles, parseInputFile } from "./utils/fileTypeDetector";
import { readMGL, readMGLTrajectory, convertMGLToPPViewFormat } from "./utils/mglParser";
import { getParticleType } from "./utils/topologyParser";
import { parseTopology } from "./formats/registry";
import { buildTrajIndex, parseConfiguration } from "./utils/trajectoryLoader";
import { applyPeriodicBoundary, applyPeriodicWrapping, computeRotationMatrix } from "./utils/geometryUtils";
import { selectFallbackTrajectoryFile, createFileMap } from "./utils/fileLoader";
import { captureScreenshot, exportSceneAsGLTF } from "./utils/exportUtils";
import { useParticleStore } from "./store/particleStore";
import { useUIStore } from "./store/uiStore";
import { useClusteringStore } from "./store/clusteringStore";
import "./styles.css";
import {
  PlayIcon, PauseIcon, ResetIcon, SpeedIcon, TagIcon, CircleIcon,
  LayersIcon, ChartIcon, CameraIcon, DownloadIcon, BoxIcon, RulerIcon,
  ChevronUpIcon, ChevronDownIcon, CloseIcon, AxisIcon, LightbulbIcon,
  StepBackIcon, StepForwardIcon, ActivityIcon
} from "./components/Icons";

// A toggle states what it controls and whether it is on, for both sighted and
// assistive users — the icon alone carries neither.
const ToggleBtn = ({ checked, onChange, icon, label, shortcut }) => (
  <button
    className={`toggle-btn ${checked ? 'is-active' : ''}`}
    onClick={() => onChange(!checked)}
    title={shortcut ? `${label} (${shortcut})` : label}
    aria-pressed={checked}
    aria-label={label}
  >
    {icon}
  </button>
);

const ToolBtn = ({ onClick, icon, label, active }) => (
  <button
    className={`toggle-btn ${active ? 'is-active' : ''}`}
    onClick={onClick}
    title={label}
    aria-label={label}
  >
    {icon}
  </button>
);

// Trajectory times run to 1e9; full digits are unreadable and shift the row
// width every frame.
const formatTime = (time) => {
  if (typeof time !== 'number' || !Number.isFinite(time)) return String(time ?? '--');
  if (time === 0) return '0';
  return Math.abs(time) >= 1e6 ? time.toExponential(2) : time.toLocaleString();
};

const formatEnergy = (energy) => {
  const value = Array.isArray(energy) ? energy[0] : energy;
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return null;
  return value.toFixed(4);
};


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
    setIsIframeMode,
    setIsDragDropEnabled,
    setIsPlaying,
    setPlaybackSpeed,
    setIsSpeedPopupVisible,
    setIsLightingControlsModalOpen,
    sphereSegments,
    setSphereSegments,
  } = useUIStore();

  const highlightedClusters = useClusteringStore(state => state.highlightedClusters);

  // Refs
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

    // Set filesDropped to true to hide the drop zone immediately
    setFilesDropped(true);

    // Set loading state to true before indexing
    setIsLoading(true);

    try {
      // Analyze file types dynamically based on content
      console.log("Analyzing file types...");
      const filesWithTypes = await analyzeFiles(files);
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
      alert("Error processing files. Please check the console for details.");
      setFilesDropped(false);
      setIsLoading(false);
    }
  }, [setFilesDropped, setIsLoading, setParticleRadius, setTopData, setPositions,
      setCurrentBoxSize, setCurrentTime, setCurrentEnergy, setConfigIndex,
      setTotalConfigs, setTrajFile]);

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

  // Message handler for iframe communication
  const handleMessage = useCallback((data) => {
    console.log('PPView received message:', data);

    if (data.message === 'drop') {
      handleFilesReceived(data.files);
    }
    else if (data.message === 'download') {
      makeOutputFiles();
    }
    else if (data.message === 'remove-event') {
      // Disable drag-drop on the FileDropZone and show notification on drop attempts
      setIsDragDropEnabled(false);
      notify("Dragging onto embedded viewer does not allow form completion");
    }
    else if (data.message === 'iframe_drop') {
      let files = data.files;
      let ext = data.ext;
      let view_settings = data.view_settings;

      if (files.length !== ext.length) {
        notify("Make sure you pass all files with extensions");
        return;
      }

      // Apply view settings if present
      if (view_settings) {
        if ("Box" in view_settings) {
          setShowSimulationBox(view_settings["Box"]);
        }
        if ("BackdropPlanes" in view_settings) {
          setShowBackdropPlanes(view_settings["BackdropPlanes"]);
        }
        if ("CoordinateAxis" in view_settings) {
          setShowCoordinateAxis(view_settings["CoordinateAxis"]);
        }
        if ("PatchLegend" in view_settings) {
          setShowPatchLegend(view_settings["PatchLegend"]);
        }
        if ("ParticleLegend" in view_settings) {
          setShowParticleLegend(view_settings["ParticleLegend"]);
        }
        if ("ClusteringPane" in view_settings) {
          setShowClusteringPane(view_settings["ClusteringPane"]);
        }
        if ("Controls" in view_settings) {
          setIsControlsVisible(view_settings["Controls"]);
        }
      }

      // Set the names and extensions for every passed file
      for (let i = 0; i < files.length; i++) {
        files[i].name = `${i}.${ext[i]}`;
      }

      handleFilesReceived(files);
      return;
    }
    else {
      console.log(data.message, "is not a recognized message");
      return;
    }
  }, [handleFilesReceived, makeOutputFiles, notify, setIsControlsVisible, setIsDragDropEnabled, setShowBackdropPlanes, setShowClusteringPane, setShowCoordinateAxis, setShowParticleLegend, setShowPatchLegend, setShowSimulationBox]);

  // useEffect to detect iframe mode (run only once on mount)
  useEffect(() => {
    // Check if running in iframe
    const isInIframe = window.self !== window.top;
    setIsIframeMode(isInIframe);

    if (isInIframe) {
      console.log('PPView: Running in iframe mode');
      // Hide controls by default in iframe mode
      setIsControlsVisible(false);
    }
  }, [setIsControlsVisible, setIsIframeMode]);

  // useEffect to set up message listener
  useEffect(() => {
    // Set up message listener for iframe communication
    const messageListener = (event) => {
      try {
        handleMessage(event.data);
      } catch (error) {
        console.error('Error handling message:', error);
      }
    };

    window.addEventListener('message', messageListener);

    return () => {
      window.removeEventListener('message', messageListener);
    };
  }, [handleMessage]);

  // useEffect to handle key presses
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Never steal keys from a field the user is typing into — the lighting
      // and clustering panels are full of number inputs.
      const target = event.target;
      if (target instanceof HTMLElement &&
          (target.isContentEditable ||
           ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      try {
        switch (event.key) {
          case " ":
            event.preventDefault();
            togglePlayback();
            break;
          case "ArrowLeft":
            event.preventDefault();
            stepFrame(event.shiftKey ? -10 : -1);
            break;
          case "ArrowRight":
            event.preventDefault();
            stepFrame(event.shiftKey ? 10 : 1);
            break;
          case "Home":
            event.preventDefault();
            goToFrame(0);
            break;
          case "End":
            event.preventDefault();
            goToFrame(totalConfigs - 1);
            break;
          case "q":
            shiftPositions("x", 1);
            break;
          case "a":
            shiftPositions("x", -1);
            break;
          case "w":
            shiftPositions("y", 1);
            break;
          case "s":
            shiftPositions("y", -1);
            break;
          case "e":
            shiftPositions("z", 1);
            break;
          case "d":
            shiftPositions("z", -1);
            break;
          case "p":
          case "P":
            takeScreenshot();
            break;
          default:
            break;
        }
      } catch (error) {
        console.warn('Error in key handler:', error);
        // Don't propagate the error to avoid blocking the application
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      // Cleanup event listener on unmount
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [shiftPositions, takeScreenshot, togglePlayback, stepFrame, goToFrame, totalConfigs]);

  // Particle size is a display choice as much as a data one — a radius read
  // from the input file is often not the one that makes a structure readable.
  const handleRadiusChange = useCallback((value) => {
    const radius = Math.min(Math.max(value, 0.05), 5);
    if (!Number.isFinite(radius)) return;
    setParticleRadius(radius);
    setTimeout(invalidateScene, 0);
  }, [setParticleRadius, invalidateScene]);

  const energyReadout = formatEnergy(currentEnergy);
  const hasTrajectory = totalConfigs > 1;

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

      {positions.length > 0 && !isLoading && !isIframeMode && <SceneBackgroundToggle />}

      {positions.length > 0 && !isLoading && (
        <div className={`controls-wrapper ${isControlsVisible ? 'is-open' : 'is-collapsed'}`}>
          {!isControlsVisible && (
            <button className="show-controls-btn" onClick={() => setIsControlsVisible(true)}>
              <ChevronUpIcon size={16} />
              <span>Controls</span>
            </button>
          )}

          {isControlsVisible && (
            <div className="controls-panel pp-panel">

              {/* Row 1 — transport and readout. What frame am I on, and how do
                  I get to another one. */}
              <div className="transport-row">
                <div className="control-cluster">
                  <button className="icon-btn" onClick={resetTrajectory} title="Back to first frame (Home)" aria-label="Back to first frame">
                    <ResetIcon size={18} />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => stepFrame(-1)}
                    disabled={!hasTrajectory || currentConfigIndex === 0}
                    title="Previous frame (Left arrow, Shift for 10)"
                    aria-label="Previous frame"
                  >
                    <StepBackIcon size={18} />
                  </button>
                  <button
                    className="icon-btn is-primary"
                    onClick={togglePlayback}
                    disabled={!hasTrajectory}
                    title={isPlaying ? "Pause (Space)" : "Play (Space)"}
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => stepFrame(1)}
                    disabled={!hasTrajectory || currentConfigIndex >= totalConfigs - 1}
                    title="Next frame (Right arrow, Shift for 10)"
                    aria-label="Next frame"
                  >
                    <StepForwardIcon size={18} />
                  </button>

                  <div className="speed-control-wrapper">
                    <button
                      className="icon-btn is-wide"
                      onClick={() => setIsSpeedPopupVisible(!isSpeedPopupVisible)}
                      title="Playback speed"
                      aria-expanded={isSpeedPopupVisible}
                    >
                      <SpeedIcon size={16} />
                      <span className="num">{(1000 / playbackSpeed).toFixed(1)}/s</span>
                    </button>
                    {isSpeedPopupVisible && (
                      <div className="popover" ref={speedPopupRef}>
                        <div className="popover-head">
                          <span>Playback speed</span>
                          <button className="icon-button" onClick={() => setIsSpeedPopupVisible(false)} aria-label="Close">
                            <CloseIcon size={14} />
                          </button>
                        </div>
                        <input
                          type="range"
                          min="50" max="2000" step="50"
                          /* Inverted: dragging right should feel faster. */
                          value={2050 - playbackSpeed}
                          onChange={(e) => setPlaybackSpeed(2050 - parseInt(e.target.value, 10))}
                        />
                        <div className="popover-value num">{(1000 / playbackSpeed).toFixed(1)} frames/s</div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="readout">
                  <span className="readout-item">
                    <span className="readout-key">Frame</span>
                    <span className="num readout-val">{currentConfigIndex + 1}<span className="readout-total">/{totalConfigs}</span></span>
                  </span>
                  <span className="readout-item">
                    <span className="readout-key">Time</span>
                    <span className="num readout-val">{formatTime(currentTime)}</span>
                  </span>
                  {energyReadout && (
                    <span className="readout-item">
                      <span className="readout-key">Energy</span>
                      <span className="num readout-val">{energyReadout}</span>
                    </span>
                  )}
                </div>

                <div className="actions-cluster">
                  <button className="action-btn" onClick={takeScreenshot} title="Save a PNG of the current view (P)">
                    <CameraIcon size={15} />
                    <span>Screenshot</span>
                  </button>
                  <button className="action-btn" onClick={exportGLTF} title="Save the scene as a GLTF model">
                    <DownloadIcon size={15} />
                    <span>Export GLTF</span>
                  </button>
                </div>

                <button
                  className="icon-btn is-quiet"
                  onClick={() => setIsControlsVisible(false)}
                  title="Hide controls"
                  aria-label="Hide controls"
                >
                  <ChevronDownIcon size={18} />
                </button>
              </div>

              {/* Row 2 — the scrubber. The control this app exists to offer. */}
              <div className="scrub-row">
                <input
                  type="range"
                  className="scrubber"
                  min="0"
                  max={Math.max(totalConfigs - 1, 0)}
                  value={currentConfigIndex}
                  onChange={handleSliderChange}
                  disabled={!hasTrajectory}
                  aria-label="Trajectory frame"
                  aria-valuetext={`Frame ${currentConfigIndex + 1} of ${totalConfigs}`}
                  style={{ '--progress': `${totalConfigs > 1 ? (currentConfigIndex / (totalConfigs - 1)) * 100 : 0}%` }}
                />
              </div>

              {/* Row 3 — display options, grouped by what they affect rather
                  than by the order they were added. */}
              <div className="options-row">
                <div className="toggle-groups">
                  <div className="toggle-group" role="group" aria-label="Scene">
                    <ToggleBtn checked={showSimulationBox} onChange={setShowSimulationBox} icon={<BoxIcon size={17} />} label="Simulation box" />
                    <ToggleBtn checked={showCoordinateAxis} onChange={setShowCoordinateAxis} icon={<AxisIcon size={17} />} label="Coordinate axes" />
                    <ToggleBtn checked={showBackdropPlanes} onChange={setShowBackdropPlanes} icon={<LayersIcon size={17} />} label="Backdrop planes" />
                  </div>

                  <div className="toggle-group" role="group" aria-label="Legends">
                    <ToggleBtn checked={showParticleLegend} onChange={setShowParticleLegend} icon={<CircleIcon size={17} />} label="Particle legend" />
                    <ToggleBtn checked={showPatchLegend} onChange={setShowPatchLegend} icon={<TagIcon size={17} />} label="Patch legend" />
                  </div>

                  <div className="toggle-group" role="group" aria-label="Tools">
                    <ToggleBtn checked={showClusteringPane} onChange={setShowClusteringPane} icon={<ChartIcon size={17} />} label="Clustering" />
                    <ToolBtn
                      onClick={() => setIsLightingControlsModalOpen(!isLightingControlsModalOpen)}
                      active={isLightingControlsModalOpen}
                      icon={<LightbulbIcon size={17} />}
                      label="Lighting"
                    />
                    <ToggleBtn checked={showStats} onChange={setShowStats} icon={<ActivityIcon size={17} />} label="Frame rate" />
                  </div>
                </div>

                <div className="settings-cluster">
                  <ColorSchemeSelector />

                  <label className="field" title="Geometry resolution for spheres, patch cones and spring cylinders">
                    <span className="field-label">Detail</span>
                    <select value={sphereSegments} onChange={(e) => setSphereSegments(parseInt(e.target.value, 10))}>
                      <option value={8}>Low</option>
                      <option value={16}>Medium</option>
                      <option value={24}>High</option>
                      <option value={32}>Ultra</option>
                    </select>
                  </label>

                  <label className="field" title="Particle radius in simulation units. Scales beads, patches, springs and nucleotides with it.">
                    <span className="field-label"><RulerIcon size={13} /> Radius</span>
                    <input
                      className="num"
                      type="number"
                      min="0.05" max="5" step="0.05"
                      value={particleRadius}
                      onChange={(e) => handleRadiusChange(parseFloat(e.target.value))}
                    />
                  </label>
                </div>

              </div>
            </div>
          )}
        </div>
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

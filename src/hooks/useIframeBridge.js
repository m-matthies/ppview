import { useCallback, useEffect } from 'react';
import { useUIStore } from '../store/uiStore';

/**
 * The postMessage interface PPView exposes when embedded in an iframe.
 *
 * Supported messages: `drop`, `download`, `remove-event`, and `iframe_drop`
 * (which also carries a `view_settings` object). Keeping this out of App keeps
 * the embedding contract in one readable place.
 */
export function useIframeBridge({ handleFilesReceived, makeOutputFiles, notify }) {
  const setIsIframeMode = useUIStore(state => state.setIsIframeMode);
  const setIsControlsVisible = useUIStore(state => state.setIsControlsVisible);
  const setIsDragDropEnabled = useUIStore(state => state.setIsDragDropEnabled);
  const setShowSimulationBox = useUIStore(state => state.setShowSimulationBox);
  const setShowBackdropPlanes = useUIStore(state => state.setShowBackdropPlanes);
  const setShowCoordinateAxis = useUIStore(state => state.setShowCoordinateAxis);
  const setShowPatchLegend = useUIStore(state => state.setShowPatchLegend);
  const setShowParticleLegend = useUIStore(state => state.setShowParticleLegend);
  const setShowClusteringPane = useUIStore(state => state.setShowClusteringPane);

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

}

export default useIframeBridge;

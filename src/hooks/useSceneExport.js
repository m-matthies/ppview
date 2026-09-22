import { useCallback } from 'react';
import { useParticleStore } from '../store/particleStore';
import { useUIStore } from '../store/uiStore';
import { useClusteringStore } from '../store/clusteringStore';
import { captureScreenshot, exportSceneAsGLTF } from '../utils/exportUtils';

/**
 * Getting the scene out: a PNG of what is on screen, or a GLTF of what is in it.
 *
 * Both need a wide slice of the scene's state, which is why this gathers it here
 * rather than making `App` thread a dozen values through. Everything is read
 * through selectors, so the hook re-renders its caller only when something it
 * actually exports changes.
 */
// Long enough for the browser to commit a message and paint it before the work
// that blocks it starts.
const PAINT_DELAY_MS = 32;

export default function useSceneExport({ sceneRef }) {
  const positions = useParticleStore(state => state.positions);
  const currentBoxSize = useParticleStore(state => state.currentBoxSize);
  const currentConfigIndex = useParticleStore(state => state.currentConfigIndex);
  const particleRadius = useParticleStore(state => state.particleRadius);
  const topData = useParticleStore(state => state.topData);
  const showSimulationBox = useUIStore(state => state.showSimulationBox);
  const showBackdropPlanes = useUIStore(state => state.showBackdropPlanes);
  const currentColorScheme = useUIStore(state => state.currentColorScheme);
  const highlightedClusters = useClusteringStore(state => state.highlightedClusters);
  const setBusyMessage = useUIStore(state => state.setBusyMessage);

  const takeScreenshot = useCallback(() => {
    captureScreenshot(sceneRef, currentConfigIndex, 1.0);
  }, [sceneRef, currentConfigIndex]);

  /**
   * Building a GLTF walks every particle and serialises the result, which at a
   * large structure takes long enough to look like the click did nothing. It
   * says so first — and the same way clustering does, by yielding, since the
   * work blocks the thread that would otherwise paint the message.
   */
  const exportGLTF = useCallback(() => {
    setBusyMessage('Building the GLTF export');
    setTimeout(() => {
      try {
        exportSceneAsGLTF({
          positions, currentBoxSize, currentConfigIndex, showSimulationBox,
          showBackdropPlanes, currentColorScheme, topData, highlightedClusters,
          sceneRef, particleRadius,
        });
      } finally {
        setBusyMessage(null);
      }
    }, PAINT_DELAY_MS);
  }, [positions, currentBoxSize, currentConfigIndex, showSimulationBox,
      showBackdropPlanes, currentColorScheme, topData, highlightedClusters,
      sceneRef, particleRadius, setBusyMessage]);

  /** Both at once, for the iframe host's "download" message. */
  const makeOutputFiles = useCallback(() => {
    try {
      exportGLTF();
      takeScreenshot();
    } catch (error) {
      // An embedding page cannot act on this, and a half-finished export is
      // not worth tearing the viewer down for.
      console.error('Could not produce the output files:', error);
    }
  }, [exportGLTF, takeScreenshot]);

  return { takeScreenshot, exportGLTF, makeOutputFiles };
}

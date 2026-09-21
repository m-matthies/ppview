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

  const takeScreenshot = useCallback(() => {
    captureScreenshot(sceneRef, currentConfigIndex, 1.0);
  }, [sceneRef, currentConfigIndex]);

  const exportGLTF = useCallback(() => {
    exportSceneAsGLTF({
      positions, currentBoxSize, currentConfigIndex, showSimulationBox,
      showBackdropPlanes, currentColorScheme, topData, highlightedClusters,
      sceneRef, particleRadius,
    });
  }, [positions, currentBoxSize, currentConfigIndex, showSimulationBox,
      showBackdropPlanes, currentColorScheme, topData, highlightedClusters,
      sceneRef, particleRadius]);

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

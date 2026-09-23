import { useEffect } from 'react';
import { useOverlayStore } from '../store/overlayStore';
import { useParticleStore } from '../store/particleStore';
import { useClusteringStore } from '../store/clusteringStore';
import { observableUpdatesForFrame } from '../utils/observableFrames';

/**
 * Keeps cluster/bond observables pointed at the frame on screen.
 *
 * All three observables hold one entry per printed configuration, so what they
 * say changes with the trajectory. Rather than give the pane, the histogram,
 * the View control and five renderers a time axis each, the overlay's own
 * contents are rewritten here — so every one of them goes on reading an
 * ordinary, frame-independent cluster overlay.
 *
 * Writing an overlay re-renders every renderer, and this runs on each frame of
 * playback, so `observableUpdatesForFrame` returns nothing for an overlay
 * already showing the frame asked for. That also stops the write from feeding
 * itself: the update changes the `overlays` identity and re-runs this effect,
 * which then finds nothing to do.
 */
export default function useObservableFrame() {
  const overlays = useOverlayStore(state => state.overlays);
  // The frame the positions came from, not the frame that was asked for.
  //
  // Reading a frame is asynchronous, so `currentConfigIndex` moves as soon as
  // the scrubber does while `positions` only catches up when the read
  // finishes. Keying on it drew the new frame's bonds against the old frame's
  // coordinates for as long as the read took — cylinders flashing between
  // unrelated particles on every transition. Cluster colours had the same fault
  // and were quieter about it.
  const frameIndex = useParticleStore(state => state.loadedConfigIndex);
  const clusterSourceId = useClusteringStore(state => state.clusterSourceId);

  useEffect(() => {
    const { updates, bonds } = observableUpdatesForFrame(overlays, frameIndex, clusterSourceId);
    const { updateOverlay } = useOverlayStore.getState();
    for (const { id, ...patch } of updates) updateOverlay(id, patch);
    // Identity-guarded in the store: a frame whose bonds are already current
    // must not re-render the scene.
    useParticleStore.getState().setBonds(bonds);
  }, [overlays, frameIndex, clusterSourceId]);
}

import { observableFrameView } from './overlays';

/**
 * What changes about the overlays when the trajectory moves to another frame.
 *
 * A cluster/bond observable holds one entry per printed configuration, so its
 * clusters are a function of the frame on screen. Rather than teach the pane,
 * the histogram, the renderers and the View control about time, the overlay's
 * contents are simply rewritten as the frame changes — at any one instant it is
 * an ordinary cluster overlay, and everything downstream is unchanged.
 *
 * Pure, and separate from the hook that applies it, because the interesting
 * parts are the two guards: not rewriting an overlay that is already showing
 * this frame (every overlay write re-renders all five renderers, and this runs
 * on every frame of playback), and deciding whose bonds get drawn.
 *
 * @param overlays    the registered overlays
 * @param frameIndex  the frame on screen
 * @param sourceId    the clustering pane's cluster source, or null for DBSCAN
 */
export function observableUpdatesForFrame(overlays, frameIndex, sourceId) {
  const updates = [];
  let bonds = null;

  for (const overlay of overlays) {
    if (!overlay.observable) continue;

    if (overlay.frameIndex !== frameIndex) {
      const view = observableFrameView(overlay.observable, frameIndex);
      updates.push({
        id: overlay.id,
        frameIndex,
        clusters: view.clusters,
        colors: view.colors,
      });
    }

    // Bonds are geometry, which is neither a grouping nor a colouring, so they
    // follow the one control that says which observable is being worked with.
    // Drawing every loaded observable at once would stack cylinders in the same
    // places with no way to tell them apart.
    if (overlay.id === sourceId) {
      const frame = overlay.observable.frames[frameIndex];
      bonds = frame && frame.a.length > 0 ? frame : null;
    }
  }

  return { updates, bonds };
}

export default observableUpdatesForFrame;

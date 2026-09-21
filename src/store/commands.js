import { useClusteringStore } from './clusteringStore';
import { useOverlayStore, COMPUTED_VIEW } from './overlayStore';

/**
 * Actions that span more than one store.
 *
 * `clusteringStore` used to import `overlayStore` so that clearing the
 * clustering could also reset the View. It worked, and it was the first
 * cross-store import in the codebase — the next one would either duplicate its
 * logic at two call sites or close a cycle. A store describes its own state;
 * anything that has to coordinate two of them lives here.
 */

/**
 * Return the scene to its unclustered state.
 *
 * Offered in two places — "Clear clustering" beside the View control and "Show
 * all particles" in the pane — because the clustering stays on screen after the
 * panel is closed, so the way out has to be reachable from both.
 */
export function clearClustering() {
  const overlays = useOverlayStore.getState();
  const active = overlays.overlays.find(o => o.id === overlays.activeOverlayId);

  // Point the View away from a cluster overlay too. A cluster file supplies the
  // particles' *base* colour, so clearing the selection alone left every
  // particle still painted by its cluster after a button that says otherwise.
  //
  // COMPUTED_VIEW rather than null: that is what a fresh load and every other
  // reset in overlayStore use, and landing on null left the next selection
  // rendering in particle-type colours for no visible reason.
  //
  // Only for a *cluster* overlay. A scalar-property overlay is a colour view the
  // person chose, not something this button is undoing.
  if (!active || active.kind === 'clusters') {
    overlays.setActiveOverlay(COMPUTED_VIEW);
  }

  useClusteringStore.getState().resetClusterState();
}

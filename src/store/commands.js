import { useClusteringStore } from './clusteringStore';
import { useOverlayStore, COMPUTED_VIEW } from './overlayStore';
import { useParticleStore } from './particleStore';
import { useUIStore } from './uiStore';
import { detectObservable } from '../formats/observables';
import { printEveryFor } from '../formats/observables/config';
import { readObservable } from '../loading/readObservable';

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

/**
 * Move to a frame: the one way to do it.
 *
 * Clamps, and requests the redraw that demand rendering needs — a control that
 * sets `currentConfigIndex` itself skips both, which is why this is the only
 * route. `usePlayback` wraps it for the transport and the keyboard; anything
 * else, like clicking a column of the time view, calls it directly.
 *
 * It lives here because it spans two stores: the frame is the particle store's,
 * the renderer handle is the UI store's. `usePlayback` used to own the clamp and
 * take `invalidateScene` as an argument, which meant any caller outside `App`
 * had to be handed it.
 */
export function goToFrame(index) {
  const particles = useParticleStore.getState();
  const total = particles.totalConfigs;
  const clamped = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
  if (clamped === particles.currentConfigIndex) return;
  particles.setCurrentConfigIndex(clamped);
  // After the store has committed, not during: the frame effect has to run
  // first or there is nothing new to draw.
  setTimeout(() => {
    const sceneRef = useUIStore.getState().sceneRef;
    if (sceneRef?.invalidate) sceneRef.invalidate();
  }, 0);
}

/**
 * Reads a cluster/bond observable against the loaded trajectory.
 *
 * Here rather than in `loading/` because it spans three stores — the frame
 * times and the run's observable definitions are the particle store's, the
 * progress caption is the UI store's — and `loadSimulation` is deliberately
 * free of React. Here rather than in `App` because the clustering pane's own
 * file picker needs exactly the same thing, and the two must not drift about
 * how a file is lined up with the trajectory.
 *
 * Never `file.text()`. These run to gigabytes: the one that prompted the
 * streaming path is 4.79 GB, nearly nine times V8's maximum string length, and
 * holds 21,798 timesteps of which 217 are wanted.
 */
export async function readObservableForScene(file) {
  const { configTimes, observableConfig } = useParticleStore.getState();

  // Enough of the head to name the format; everything else is streamed.
  const head = await file.slice(0, 8192).text();
  const lines = head.split('\n').map(line => line.trim()).filter(Boolean);
  const formatId = detectObservable(lines);
  if (!formatId) throw new Error('not a recognised cluster/bond observable file.');

  try {
    return await readObservable(file, {
      formatId,
      frameTimes: configTimes,
      printEvery: printEveryFor(observableConfig, { fileName: file.name, formatId }),
      onStatus: useUIStore.getState().setBusyMessage,
    });
  } finally {
    useUIStore.getState().setBusyMessage(null);
  }
}

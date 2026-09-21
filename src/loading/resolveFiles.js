import { selectFallbackTrajectoryFile } from '../utils/fileLoader';

/**
 * Deciding which dropped files to actually use.
 *
 * Kept apart from the loading itself because these are pure choices over a list
 * of names, and because the trajectory fallback was previously written out twice
 * in `App.js` with *different* criteria — one list included `init`, the other did
 * not, so the file chosen as the trajectory and the file the index was built
 * from could disagree.
 */

const TRAJECTORY_HINTS = ['traj', 'conf', 'last', 'init'];

const looksLikeTrajectory = (file) => {
  const name = file.name.toLowerCase();
  return TRAJECTORY_HINTS.some(hint => name.includes(hint)) || name.endsWith('.dat');
};

/**
 * What kind of drop this is.
 *
 * A drop carrying no simulation but at least one cluster file, onto a scene that
 * already has particles, adds to that scene instead of replacing it.
 */
export function classifyDrop(categorized, { sceneIsLoaded }) {
  const bringsSimulation = !!(
    categorized.topology || categorized.trajectory
    || categorized.mglFile || categorized.mglTrajectory
  );
  if (!bringsSimulation && categorized.clusterFiles?.length && sceneIsLoaded) {
    return 'overlays-only';
  }
  return 'simulation';
}

/**
 * The topology file to parse: the detected one, else any `.top` in the drop.
 * `format` is null for the fallback, which asks the registry to detect it.
 */
export function pickTopologyFile(categorized, files) {
  if (categorized.topology) {
    return { file: categorized.topology.file, format: categorized.topology.format };
  }
  const fallback = files.find(file => file.name.endsWith('.top'));
  return fallback ? { file: fallback, format: null } : null;
}

/**
 * The trajectory file to read: the detected one, else the best-named candidate.
 *
 * One answer, used both to set the trajectory and to build its index — those
 * were separate expressions before, and could pick different files.
 */
export function pickTrajectoryFile(categorized, files, { exclude = [] } = {}) {
  if (categorized.trajectory) return categorized.trajectory;

  // A name-based fallback will happily claim a file already spoken for:
  // `looksLikeTrajectory` matches "init" anywhere in the name, and the ranking
  // puts "init" above an unhinted .dat — so a drop of `init.top` + `sim.dat`
  // chose the *topology* as its trajectory and indexed frames out of it.
  const taken = new Set(exclude.filter(Boolean));
  const candidates = files.filter(file => !taken.has(file) && looksLikeTrajectory(file));
  return candidates.length ? selectFallbackTrajectoryFile(candidates) : null;
}

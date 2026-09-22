import { parseConfiguration } from '../utils/trajectoryLoader';
import { applyPeriodicBoundary } from '../utils/geometryUtils';
import { getParticleType } from '../formats/parsers/particleType';
import { convertMGLToPPViewFormat } from '../utils/mglParser';
import { LoadError } from './staleness';

/**
 * Reading one frame of a trajectory into the scene.
 *
 * Split out of `App.js` for the same reason as the load pipeline: it is a
 * sequence over files and stores with no React in it, and it was previously a
 * bare async function called from an effect behind an `exhaustive-deps`
 * suppression.
 *
 * It reports failure by throwing `LoadError`; the caller decides whether that
 * deserves an alert, a toast, or a line in the console. `alert()` used to be
 * called from four places in here.
 */

/** MGL frames are already parsed and in memory — no slicing, no re-reading. */
function mglFrame(file, frameNumber, scene) {
  const mgl = file.mglTrajectoryData;
  if (frameNumber >= mgl.frameCount) {
    throw new LoadError(`This trajectory has ${mgl.frameCount} frames; ${frameNumber + 1} was asked for.`);
  }
  const ppview = convertMGLToPPViewFormat({ frames: [mgl.frames[frameNumber]] });
  scene.setPositions(ppview.positions);
  scene.setCurrentBoxSize(ppview.boxSize);
  scene.setCurrentTime(frameNumber);   // MGL frames carry no simulation time
  scene.setCurrentEnergy([0]);
}

/**
 * Attaches each particle's type and orientation to its position.
 *
 * Done here rather than in the renderers because every renderer needs it and
 * the topology is the only place the mapping exists.
 */
function decorate(positions, boxSize, topData) {
  return applyPeriodicBoundary(positions, boxSize).map((position, index) => {
    const { typeIndex, particleType } = getParticleType(index, topData);
    // No rotation matrix. Only patch cones and raspberry beads ever read one,
    // and rotationMatrixOf derives it from the a1/a3 this object already
    // carries — so it is computed by the two layers that use it, for the
    // instances they draw, instead of for every particle of every frame.
    return { ...position, typeIndex, particleType };
  });
}

/**
 * @param file         the trajectory File, or an MGL wrapper carrying its frames
 * @param index        byte offsets of each frame, from buildTrajIndex
 * @param frameNumber  which frame to read
 * @param topData      parsed topology, for particle types
 * @param scene        setPositions, setCurrentBoxSize, setCurrentTime, setCurrentEnergy
 * @throws {LoadError} with a message meant for the person
 */
export async function loadFrame({ file, index, frameNumber, topData, scene }) {
  if (frameNumber < 0 || frameNumber >= index.length) {
    throw new LoadError(`Frame ${frameNumber + 1} is outside this trajectory.`);
  }
  if (!topData) {
    throw new LoadError('No topology loaded, so the frame cannot be interpreted.');
  }

  if (file.mglTrajectoryData) {
    mglFrame(file, frameNumber, scene);
    return;
  }

  // Read only this frame. The index holds byte offsets, so the last frame runs
  // to the end of the file.
  const start = index[frameNumber];
  const end = frameNumber + 1 < index.length ? index[frameNumber + 1] : file.size;
  const content = await file.slice(start, end).text();

  const config = parseConfiguration(content.split(/\r?\n/));
  if (!config) throw new LoadError('That frame could not be read.');

  scene.setPositions(decorate(config.positions, config.boxSize, topData));
  scene.setCurrentBoxSize(config.boxSize);
  scene.setCurrentTime(config.time);
  scene.setCurrentEnergy(config.energy);
}

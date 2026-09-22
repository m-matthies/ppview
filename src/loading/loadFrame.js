import { calcCOMFromBuffer } from '../utils/geometryUtils';
import { parseFrameBuffers, createFrameBuffers } from './parseFrameBuffers';
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
 * Turns the parsed buffers into the particles the scene reads.
 *
 * One pass. Previously this was three: parse the text into objects, wrap those
 * into a second set, then decorate into a third — each allocating a complete
 * copy of the frame. Centring, wrapping and type assignment all happen here
 * while the numbers are already in registers.
 *
 * The objects that come out are still objects, because fourteen modules read
 * `positions[i].x`. Removing them is the next step and needs those callers to
 * move behind an accessor first; this removes the two redundant copies without
 * waiting for that.
 */
function buildParticles(frame, topData) {
  const { count, positions, a1, a3, boxSize, hasOrientation } = frame;
  const com = calcCOMFromBuffer(positions, count, boxSize);
  const [bx, by, bz] = boxSize;
  const tx = bx / 2 - com.x;
  const ty = by / 2 - com.y;
  const tz = bz / 2 - com.z;

  // Real modulus: the built-in % keeps the sign of the dividend, so a particle
  // centring pushed to -1 would stay there instead of wrapping to L-1.
  const wrap = (value, length) => {
    const m = value % length;
    return m < 0 ? m + length : m;
  };

  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const { typeIndex, particleType } = getParticleType(i, topData);
    const particle = {
      x: wrap(positions[o] + tx, bx),
      y: wrap(positions[o + 1] + ty, by),
      z: wrap(positions[o + 2] + tz, bz),
      typeIndex,
      particleType,
    };
    // Only formats that carry orientation pay for the two extra objects; a
    // trajectory of plain spheres does not.
    if (hasOrientation) {
      particle.a1 = { x: a1[o], y: a1[o + 1], z: a1[o + 2] };
      particle.a3 = { x: a3[o], y: a3[o + 1], z: a3[o + 2] };
    }
    out[i] = particle;
  }
  return out;
}

/**
 * @param file         the trajectory File, or an MGL wrapper carrying its frames
 * @param index        byte offsets of each frame, from buildTrajIndex
 * @param frameNumber  which frame to read
 * @param topData      parsed topology, for particle types
 * @param scene        setPositions, setCurrentBoxSize, setCurrentTime, setCurrentEnergy
 * @throws {LoadError} with a message meant for the person
 */
// Reused across frames, so playback allocates no buffers at all after the
// first frame of a trajectory.
const buffers = createFrameBuffers();

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

  const frame = parseFrameBuffers(content, buffers);
  if (!frame || frame.count === 0) throw new LoadError('That frame could not be read.');

  scene.setPositions(buildParticles(frame, topData));
  scene.setCurrentBoxSize(frame.boxSize);
  scene.setCurrentTime(frame.time);
  scene.setCurrentEnergy(frame.energy);
}

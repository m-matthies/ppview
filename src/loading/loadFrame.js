import { calcCOMFromBuffer } from '../utils/geometryUtils';
import { parseFrameBuffers, createFrameBuffers } from './parseFrameBuffers';
import { createFrameCache } from './frameCache';
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
 * Centres the structure on the box and wraps it in, writing over the buffer.
 *
 * In place: this used to produce a second array of objects, and the frame cache
 * needs the wrapped coordinates anyway, so doing it here means a cached frame is
 * ready to use without repeating the arithmetic.
 */
function centreAndWrap(frame) {
  const { count, positions, boxSize } = frame;
  const com = calcCOMFromBuffer(positions, count, boxSize);
  const [bx, by, bz] = boxSize;
  const tx = bx / 2 - com.x;
  const ty = by / 2 - com.y;
  const tz = bz / 2 - com.z;

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    // Real modulus: the built-in % keeps the sign of the dividend, so a
    // particle centring pushed to -1 would stay there rather than wrap to L-1.
    let x = (positions[o] + tx) % bx;
    let y = (positions[o + 1] + ty) % by;
    let z = (positions[o + 2] + tz) % bz;
    positions[o] = x < 0 ? x + bx : x;
    positions[o + 1] = y < 0 ? y + by : y;
    positions[o + 2] = z < 0 ? z + bz : z;
  }
}

/**
 * Turns already-wrapped buffers into the particles the scene reads.
 *
 * The objects that come out are still objects, because fourteen modules read
 * `positions[i].x`. That is 15 ms of the 144 ms a frame costs at 400,000
 * particles, so removing it is worth far less than it looks — the scan is where
 * the time goes.
 */
function buildParticles(frame, topData) {
  const { count, positions, a1, a3, hasOrientation } = frame;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const { typeIndex, particleType } = getParticleType(i, topData);
    const particle = {
      x: positions[o],
      y: positions[o + 1],
      z: positions[o + 2],
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

// Decoded frames, so a second pass over a trajectory does not re-scan it.
const cache = createFrameCache();

/** Everything the scene needs from a frame, cached or freshly parsed. */
function handToScene(frame, topData, scene) {
  scene.setPositions(buildParticles(frame, topData));
  scene.setCurrentBoxSize(frame.boxSize);
  scene.setCurrentTime(frame.time);
  scene.setCurrentEnergy(frame.energy);
}

/** For tests, and for measuring whether the cache is earning its memory. */
export const frameCacheStats = () => cache.stats();

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

  // A frame already decoded is handed straight over: no read, no scan, no
  // centre of mass, no wrap. Playback loops and scrubbing goes back and forth,
  // so this is the common case after the first pass through a trajectory.
  cache.useTrajectory(file);
  const cached = cache.get(frameNumber);
  if (cached) {
    handToScene(cached, topData, scene);
    return;
  }

  // Read only this frame. The index holds byte offsets, so the last frame runs
  // to the end of the file.
  const start = index[frameNumber];
  const end = frameNumber + 1 < index.length ? index[frameNumber + 1] : file.size;
  const content = await file.slice(start, end).text();

  const frame = parseFrameBuffers(content, buffers);
  if (!frame || frame.count === 0) throw new LoadError('That frame could not be read.');
  centreAndWrap(frame);
  cache.put(frameNumber, frame);

  handToScene(frame, topData, scene);
}

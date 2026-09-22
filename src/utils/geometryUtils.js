// Geometry utility functions for periodic boundary conditions and center of mass calculations

// Calculate center of mass taking periodic boundary conditions into account
// Based on: https://doi.org/10.1080/2151237X.2008.10129266
// https://en.wikipedia.org/wiki/Center_of_mass#Systems_with_periodic_boundary_conditions
// Above this many particles the centre of mass is estimated from a sample.
//
// It costs six trig calls per particle — cos and sin per axis — which made it
// 181 ms of the 253 ms spent wrapping a 400,000-particle frame, and would be
// close to half a second at a million. Allocation is not the cost here and
// typed arrays would not touch it; the arithmetic itself is the cost.
//
// But this is a *statistic*, not data: it decides where to centre the view. A
// mean taken over 50,000 particles and one taken over a million agree far more
// closely than the centring needs. Below the threshold every particle is used,
// so small systems are bit-for-bit unchanged.
const COM_SAMPLE_LIMIT = 50_000;

// Calculate center of mass taking periodic boundary conditions into account
// Based on: https://doi.org/10.1080/2151237X.2008.10129266
// https://en.wikipedia.org/wiki/Center_of_mass#Systems_with_periodic_boundary_conditions
export const calcCOM = (positions, boxSize) => {
  const count = positions.length;
  if (count === 0) return { x: 0, y: 0, z: 0 };

  // A stride rather than a random sample: deterministic, so the same frame
  // always centres identically, and cheap to walk. Chosen so the sample is
  // spread over the whole array rather than taken from one end.
  const stride = count > COM_SAMPLE_LIMIT ? Math.ceil(count / COM_SAMPLE_LIMIT) : 1;

  // Each 1D interval is treated as a unit circle whose circumference is the box
  // side, so the mean is well defined across the periodic boundary.
  let xCos = 0, xSin = 0, yCos = 0, ySin = 0, zCos = 0, zSin = 0;
  let sampled = 0;

  const kx = (2 * Math.PI) / boxSize[0];
  const ky = (2 * Math.PI) / boxSize[1];
  const kz = (2 * Math.PI) / boxSize[2];

  for (let i = 0; i < count; i += stride) {
    const p = positions[i];
    const ax = p.x * kx;
    const ay = p.y * ky;
    const az = p.z * kz;
    xCos += Math.cos(ax); xSin += Math.sin(ax);
    yCos += Math.cos(ay); ySin += Math.sin(ay);
    zCos += Math.cos(az); zSin += Math.sin(az);
    sampled++;
  }

  const toCoord = (cos, sin, length) =>
    length / (2 * Math.PI) * (Math.atan2(-sin / sampled, -cos / sampled) + Math.PI);

  return {
    x: toCoord(xCos, xSin, boxSize[0]),
    y: toCoord(yCos, ySin, boxSize[1]),
    z: toCoord(zCos, zSin, boxSize[2]),
  };
};

/**
 * Centres the structure on the box and wraps every particle into it.
 *
 * Rewritten for size. The previous version allocated four objects per particle —
 * a rest-spread to strip x/y/z, a centred copy, a copy inside the wrapper, and a
 * spread to put the fields back — and recomputed two loop-invariant vectors on
 * every call to the inner helper. At 400,000 particles that was 230 ms, the
 * single most expensive stage of loading a frame.
 *
 * One of those vectors was also dead arithmetic: `shift` is
 * `boxSize/2 - centeringGoal`, and `centeringGoal` *is* `boxSize/2`, so the
 * add-then-subtract either side of the modulus always cancelled.
 *
 * The result is the same object shape as before: x, y, z replaced, every other
 * field carried through by reference.
 */
export const applyPeriodicBoundary = (positions, boxSize) => {
  const count = positions.length;
  if (count === 0) return [];

  const com = calcCOM(positions, boxSize);
  const [bx, by, bz] = boxSize;
  // Centre of the box, minus where the structure actually is.
  const tx = bx / 2 - com.x;
  const ty = by / 2 - com.y;
  const tz = bz / 2 - com.z;

  // Real modulus: the built-in % keeps the sign of the dividend, so a particle
  // that centring pushed to -1 would stay at -1 rather than wrapping to L-1.
  const wrap = (value, length) => {
    const m = value % length;
    return m < 0 ? m + length : m;
  };

  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const p = positions[i];
    // One new object per particle, not four. Object.assign copies the remaining
    // fields — a1, a3, and anything the topology attached — by reference, and
    // the explicit coordinates afterwards overwrite the originals.
    out[i] = Object.assign({}, p, {
      x: wrap(p.x + tx, bx),
      y: wrap(p.y + ty, by),
      z: wrap(p.z + tz, bz),
    });
  }
  return out;
};

// Function to apply only periodic wrapping without re-centering
export const applyPeriodicWrapping = (positions, boxSize) => {
  const coordInBox = (coord, boxDim) => {
    // Wrap coordinate to be within [0, boxDim]
    while (coord < 0) coord += boxDim;
    while (coord >= boxDim) coord -= boxDim;
    return coord;
  };

  return positions.map(({ x, y, z, ...rest }) => {
    return {
      x: coordInBox(x, boxSize[0]),
      y: coordInBox(y, boxSize[1]),
      z: coordInBox(z, boxSize[2]),
      ...rest,
    };
  });
};

/**
 * Computes a rotation matrix from orientation vectors a1 and a3
 * @param {Object} pos - Position object with a1 and a3 vectors
 * @returns {Object|null} Rotation matrix with elements array, or null if vectors not present
 */
/**
 * A particle's orientation as the nine elements of a column-major 3x3.
 *
 * Scalar arithmetic, deliberately. The previous version allocated five objects
 * per particle — three `Vector3`s, a `Matrix3`, and a clone of its elements —
 * which made it 120 ms of the 143 ms spent decorating a 400,000-particle frame,
 * the single most expensive thing left in loading one.
 *
 * The result is unchanged: the matrix is just a1, a2 and a3 as columns, so it is
 * written straight out. `THREE` is still accepted so callers need not change,
 * and ignored.
 */
export const computeRotationMatrix = (pos) => {
  const a1 = pos.a1;
  const a3in = pos.a3;
  if (!a1 || !a3in) return null;

  let a1x = a1.x, a1y = a1.y, a1z = a1.z;
  let inv = 1 / Math.hypot(a1x, a1y, a1z);
  a1x *= inv; a1y *= inv; a1z *= inv;

  let a3x = a3in.x, a3y = a3in.y, a3z = a3in.z;
  inv = 1 / Math.hypot(a3x, a3y, a3z);
  a3x *= inv; a3y *= inv; a3z *= inv;

  // a2 = a3 x a1
  let a2x = a3y * a1z - a3z * a1y;
  let a2y = a3z * a1x - a3x * a1z;
  let a2z = a3x * a1y - a3y * a1x;
  inv = 1 / Math.hypot(a2x, a2y, a2z);
  a2x *= inv; a2y *= inv; a2z *= inv;

  // a3 recomputed as a1 x a2, so the frame is orthonormal even when the file's
  // a1 and a3 are not quite perpendicular.
  a3x = a1y * a2z - a1z * a2y;
  a3y = a1z * a2x - a1x * a2z;
  a3z = a1x * a2y - a1y * a2x;
  inv = 1 / Math.hypot(a3x, a3y, a3z);
  a3x *= inv; a3y *= inv; a3z *= inv;

  // Column-major: a1, then a2, then a3.
  return {
    elements: [a1x, a1y, a1z, a2x, a2y, a2z, a3x, a3y, a3z],
  };
};

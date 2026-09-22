import * as THREE from 'three';

/**
 * Scene-space helpers shared by every renderer.
 *
 * The simulation stores positions in box coordinates with the origin at a
 * corner; the scene is centred on the box. Each renderer used to write
 * `particle.x - boxSize[0] / 2` inline, which is five chances to disagree about
 * what "centred" means.
 */

export function centreOnBox(target, particle, boxSize) {
  return target.set(
    particle.x - boxSize[0] / 2,
    particle.y - boxSize[1] / 2,
    particle.z - boxSize[2] / 2,
  );
}

export function centredPosition(particle, boxSize) {
  return centreOnBox(new THREE.Vector3(), particle, boxSize);
}

/**
 * A particle's orientation as a Matrix3, or null when it has none.
 *
 * Derived here, from the orientation vectors the trajectory already carries,
 * rather than materialised for every particle when a frame loads. Only two
 * layers ever ask — patch cones and raspberry beads — and both already run a
 * loop over their own instances, so computing it here costs them nothing extra
 * while taking a whole stage out of loading a frame: 102 ms of the 454 ms at
 * 400,000 particles, spent on particles that in most formats never use it.
 *
 * Writes into `target`, so nothing is allocated per particle.
 */
export function rotationMatrixOf(particle, target) {
  const a1 = particle?.a1;
  const a3 = particle?.a3;
  if (!a1 || !a3) return null;

  let a1x = a1.x, a1y = a1.y, a1z = a1.z;
  let inv = 1 / Math.hypot(a1x, a1y, a1z);
  a1x *= inv; a1y *= inv; a1z *= inv;

  let a3x = a3.x, a3y = a3.y, a3z = a3.z;
  inv = 1 / Math.hypot(a3x, a3y, a3z);
  a3x *= inv; a3y *= inv; a3z *= inv;

  let a2x = a3y * a1z - a3z * a1y;
  let a2y = a3z * a1x - a3x * a1z;
  let a2z = a3x * a1y - a3y * a1x;
  inv = 1 / Math.hypot(a2x, a2y, a2z);
  a2x *= inv; a2y *= inv; a2z *= inv;

  // Recomputed so the frame is orthonormal even where the file's a1 and a3 are
  // not quite perpendicular.
  a3x = a1y * a2z - a1z * a2y;
  a3y = a1z * a2x - a1x * a2z;
  a3z = a1x * a2y - a1y * a2x;
  inv = 1 / Math.hypot(a3x, a3y, a3z);
  a3x *= inv; a3y *= inv; a3z *= inv;

  const m = target || new THREE.Matrix3();
  // Column-major: a1, a2, a3.
  m.elements[0] = a1x; m.elements[1] = a1y; m.elements[2] = a1z;
  m.elements[3] = a2x; m.elements[4] = a2y; m.elements[5] = a2z;
  m.elements[6] = a3x; m.elements[7] = a3y; m.elements[8] = a3z;
  return m;
}

/**
 * True when a bond spans more than half the box, i.e. it wraps a periodic
 * boundary and should not be drawn as a straight line across the whole scene.
 */
export function crossesPeriodicBoundary(distance, boxSize) {
  return distance > Math.min(boxSize[0], boxSize[1], boxSize[2]) / 2;
}

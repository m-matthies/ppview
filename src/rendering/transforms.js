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

/**
 * Scratch vectors for `cylinderBetween`, one set per renderer.
 *
 * Created once and reused across every instance: a layer drawing a hundred
 * thousand bonds would otherwise allocate four vectors per bond per frame.
 */
export function cylinderScratch() {
  return {
    up: new THREE.Vector3(0, 1, 0),
    v1: new THREE.Vector3(),
    v2: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    delta: new THREE.Vector3(),
    start: new THREE.Vector3(),
  };
}

/** Lays a unit cylinder along an existing start point and direction. */
function layCylinder(dummy, scratch, start, direction, length, thickness) {
  if (length < 1e-6) return false;
  scratch.dir.copy(direction).divideScalar(length);
  dummy.position.copy(start).addScaledVector(scratch.dir, length / 2);
  dummy.quaternion.setFromUnitVectors(scratch.up, scratch.dir);
  dummy.scale.set(thickness, length, thickness);
  return true;
}

/** One axis of a separation, brought to its nearest image. */
function minimumImage(delta, length) {
  if (!(length > 0)) return delta;
  return delta - length * Math.round(delta / length);
}

/**
 * Whether a bond crosses a periodic wall, from the particle centres alone.
 *
 * Cheap, and free of the patch lookups and cluster appearance a bond's real
 * endpoints need — so the second instance of the great majority of bonds, which
 * do not wrap, can be dismissed before any of that work is done.
 */
export function wrapsBetween(scratch, posA, posB, boxSize) {
  centreOnBox(scratch.v1, posA, boxSize);
  centreOnBox(scratch.v2, posB, boxSize);
  return minimumImage(scratch.v2.x - scratch.v1.x, boxSize[0]) !== scratch.v2.x - scratch.v1.x
    || minimumImage(scratch.v2.y - scratch.v1.y, boxSize[1]) !== scratch.v2.y - scratch.v1.y
    || minimumImage(scratch.v2.z - scratch.v1.z, boxSize[2]) !== scratch.v2.z - scratch.v1.z;
}

/** The two halves of a bond that crosses a periodic wall. */
export const LEAVING = 0;
export const ARRIVING = 1;

/**
 * Draws a bond under the **minimum image convention**.
 *
 * Particles are wrapped into the box, so two bonded neighbours either side of a
 * wall sit at opposite edges — a hand's breadth apart through the wall, and
 * almost a whole box apart across it. Drawing the straight line between them
 * sweeps the entire scene and reads as a connection that is not there, which is
 * why such bonds were simply hidden. Hiding them is also a lie of a quieter
 * kind: the bond exists, and in a dense system a great many bonds sit on a wall.
 *
 * So it is drawn as the two halves you would actually see: one **leaving** the
 * first particle and passing out through the near wall, and one **arriving** at
 * the second from outside the far wall. Both carry the bond's true length, so
 * the pair reads as one bond seen through the boundary rather than as two short
 * stubs.
 *
 * A bond that does not wrap has nothing to draw for `ARRIVING`, and returns
 * false there — the caller allocates two instances per bond and this collapses
 * the unused one.
 */
export function cylinderBetweenPeriodic(
  dummy, scratch, posA, posB, boxSize, thickness, image,
) {
  centreOnBox(scratch.v1, posA, boxSize);
  centreOnBox(scratch.v2, posB, boxSize);
  return cylinderBetweenImages(dummy, scratch, scratch.v1, scratch.v2, boxSize, thickness, image);
}

/**
 * The same, between two points already in scene space.
 *
 * A bond is drawn patch tip to patch tip where the observable names both
 * patches, and centre to centre where it does not, so the periodic halving has
 * to work on whatever endpoints it is given.
 */
export function cylinderBetweenImages(dummy, scratch, a, b, boxSize, thickness, image) {
  scratch.delta.copy(b).sub(a);

  // Nearest whole number of box lengths subtracted per axis — the same rule the
  // clustering measures distance by, so the two cannot disagree about which
  // particles are neighbours.
  // Written out rather than looped over an axis array: this runs twice per bond
  // per frame, and `['x','y','z']` plus the index lookup allocated four objects
  // each time — in the one function whose scratch exists to avoid exactly that.
  let wraps = false;
  const dx = minimumImage(scratch.delta.x, boxSize[0]);
  const dy = minimumImage(scratch.delta.y, boxSize[1]);
  const dz = minimumImage(scratch.delta.z, boxSize[2]);
  if (dx !== scratch.delta.x || dy !== scratch.delta.y || dz !== scratch.delta.z) wraps = true;
  scratch.delta.set(dx, dy, dz);

  if (image === ARRIVING && !wraps) return false;

  const length = scratch.delta.length();
  // The segment leaving A runs from A; the one arriving at B ends at B, so it
  // starts a bond's length back from it, outside the opposite wall.
  scratch.start.copy(image === LEAVING ? a : b);
  if (image === ARRIVING) scratch.start.sub(scratch.delta);
  return layCylinder(dummy, scratch, scratch.start, scratch.delta, length, thickness);
}

/**
 * Lays a unit cylinder along the line between two particles.
 *
 * Written for `CylinderGeometry(1, 1, 1)`, which stands along +Y: the instance
 * is scaled to `(thickness, distance, thickness)` and rotated onto the
 * separation vector. Both spring bonds and observable bonds are exactly this
 * problem, and having each solve it separately is how `Springs` came to be the
 * one layer that did not follow the per-cluster eye control.
 *
 * Returns false — meaning "do not draw this instance" — for a degenerate pair,
 * and for one that wraps a periodic boundary, which would otherwise be drawn as
 * a straight line clear across the box.
 */
export function cylinderBetween(dummy, scratch, posA, posB, boxSize, thickness) {
  centreOnBox(scratch.v1, posA, boxSize);
  centreOnBox(scratch.v2, posB, boxSize);

  scratch.delta.copy(scratch.v2).sub(scratch.v1);
  const distance = scratch.delta.length();
  if (distance < 1e-6 || crossesPeriodicBoundary(distance, boxSize)) return false;

  return layCylinder(dummy, scratch, scratch.v1, scratch.delta, distance, thickness);
}

/** Scratch for `patchTip`, one set per renderer. */
export function patchScratch() {
  return {
    centre: new THREE.Vector3(),
    tip: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    rot: new THREE.Matrix3(),
  };
}

/**
 * Where a patch sits in scene space, and which way it faces.
 *
 * One definition, because two layers draw the same patch: `Patches` puts a cone
 * tip there, and `Bonds` starts a bond cylinder there. They have to agree
 * exactly — a bond that starts anywhere else reads as not coming out of the
 * patch at all, which is how the two came to look unrelated.
 *
 * **The patch vector's length is normalised away**, so the tip lands at
 * `radius` whatever the file's convention. Patch files in this space hold unit
 * directions in some formats and absolute positions in others — one run's
 * Lorenzo patch files are cube edge-midpoints at length 0.7071 — and nothing in
 * the file says which. Normalising is what keeps the cone on the sphere it is
 * attached to; it does mean a patch stated as a position is drawn nearer the
 * centre than the simulation puts it.
 *
 * Writes `scratch.tip` and `scratch.direction` (outward, unit). Returns false
 * for a degenerate vector, which has no direction to face.
 */
export function patchTip(scratch, particle, patchOffset, boxSize, radius) {
  const length = Math.hypot(patchOffset.x, patchOffset.y, patchOffset.z);
  if (length < 1e-9) return false;

  centreOnBox(scratch.centre, particle, boxSize);
  const rotation = rotationMatrixOf(particle, scratch.rot);

  scratch.direction.set(patchOffset.x, patchOffset.y, patchOffset.z).divideScalar(length);
  if (rotation) scratch.direction.applyMatrix3(rotation);

  scratch.tip.copy(scratch.direction).multiplyScalar(radius).add(scratch.centre);
  return true;
}

/**
 * The patch offset a bond's patch id names, or null.
 *
 * `patchPositions[j]` pairs with `patches[j]` — that pairing is what `Patches`
 * draws by — but the two formats number patches differently. Lorenzo assigns
 * sequential ids per type, so an id *is* its slot; raspberry's `iC` line names
 * global `iP` ids (`iC 2 512 8,9` gives patches `[8, 9]` against two positions),
 * so using the id as an index reads off the end and the bond silently falls
 * back to the particle centre. Looking the id up in `patches` is right for
 * both.
 */
export function patchOffsetFor(particleType, patchId) {
  if (patchId < 0) return null;
  const offsets = particleType?.patchPositions;
  if (!offsets?.length) return null;
  const ids = particleType.patches;
  const slot = Array.isArray(ids) ? ids.indexOf(patchId) : patchId;
  return slot >= 0 ? (offsets[slot] ?? null) : null;
}

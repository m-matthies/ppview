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

/** A particle's orientation as a Matrix3, or null when it has none. */
export function rotationMatrixOf(particle, target) {
  if (!particle?.rotationMatrix) return null;
  const m = target || new THREE.Matrix3();
  return m.fromArray(particle.rotationMatrix.elements);
}

/**
 * True when a bond spans more than half the box, i.e. it wraps a periodic
 * boundary and should not be drawn as a straight line across the whole scene.
 */
export function crossesPeriodicBoundary(distance, boxSize) {
  return distance > Math.min(boxSize[0], boxSize[1], boxSize[2]) / 2;
}

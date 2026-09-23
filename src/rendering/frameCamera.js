import * as THREE from 'three';
import { centredPosition } from './transforms';

/**
 * Where to put the camera so a set of particles fills the view.
 *
 * Separate from the animation that moves it there so the arithmetic can be
 * tested without a renderer, and shared by the two ways of asking: the space
 * key, which frames the current selection, and a double click, which frames the
 * one particle under the pointer. Double click used to place the camera at a
 * fixed offset of five units on +Z — which framed nothing in particular, ignored
 * how big the thing was, and swung the view round to a fixed angle whatever you
 * had been looking from.
 *
 * **The viewing direction is kept.** Framing something should move the camera
 * closer to it, not decide for you which side to look from; losing the angle you
 * had lined up is disorienting, and re-establishing it is manual work.
 */

/** A little air around the selection, so it is not flush against the edges. */
const MARGIN = 1.35;

/**
 * @param particles   the whole `positions` array
 * @param indices     which of them to frame
 * @param boxSize     for centring, as every renderer does
 * @param radius      the drawn radius of a particle, so one particle still fits
 * @param camera      read for its field of view and current direction
 * @param target      what the camera currently looks at
 * @returns {{ position: THREE.Vector3, target: THREE.Vector3 }} or null
 */
export function framingFor({ particles, indices, boxSize, radius, camera, target }) {
  const points = [];
  for (const index of indices) {
    const particle = particles?.[index];
    if (particle) points.push(centredPosition(particle, boxSize));
  }
  if (points.length === 0) return null;

  const centre = new THREE.Vector3();
  for (const point of points) centre.add(point);
  centre.divideScalar(points.length);

  // The radius of a sphere around the selection, never smaller than one
  // particle — framing a single particle on its own centre would otherwise ask
  // for a distance of zero.
  let extent = radius;
  for (const point of points) {
    extent = Math.max(extent, point.distanceTo(centre) + radius);
  }

  // How far back the whole sphere subtends the field of view. The vertical field
  // is the tighter of the two on a landscape canvas, so it is the one to fit.
  const fov = THREE.MathUtils.degToRad(camera?.fov ?? 45);
  const distance = (extent * MARGIN) / Math.sin(fov / 2);

  // Keep the direction the camera is already looking from.
  const direction = new THREE.Vector3().subVectors(camera.position, target);
  if (direction.lengthSq() < 1e-12) direction.set(0, 0, 1);
  direction.normalize();

  return {
    position: centre.clone().addScaledVector(direction, distance),
    target: centre,
  };
}

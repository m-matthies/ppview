import * as THREE from 'three';
import { framingFor } from './frameCamera';

const camera = (position) => {
  const c = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  c.position.copy(position);
  return c;
};

const call = (indices, particles, from = new THREE.Vector3(0, 0, 100)) => framingFor({
  particles,
  indices,
  boxSize: [0, 0, 0],
  radius: 0.5,
  camera: camera(from),
  target: new THREE.Vector3(0, 0, 0),
});

describe('framingFor', () => {
  const two = [{ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }];

  test('looks at the middle of the selection', () => {
    const { target } = call([0, 1], two);
    expect(target.x).toBeCloseTo(0);
    expect(target.y).toBeCloseTo(0);
  });

  test('keeps the direction the camera was already looking from', () => {
    const from = new THREE.Vector3(0, 50, 50);
    const { position, target } = call([0, 1], two, from);
    const was = from.clone().sub(new THREE.Vector3()).normalize();
    const now = position.clone().sub(target).normalize();
    expect(now.dot(was)).toBeCloseTo(1, 5);
  });

  test('stands further back for a wider selection', () => {
    const near = call([0], two).position.distanceTo(call([0], two).target);
    const far = call([0, 1], two).position.distanceTo(call([0, 1], two).target);
    expect(far).toBeGreaterThan(near);
  });

  // A single particle framed on its own centre would ask for a distance of
  // zero, which puts the camera inside it.
  test('a single particle still gets a sensible distance', () => {
    const { position, target } = call([0], two);
    expect(position.distanceTo(target)).toBeGreaterThan(1);
  });

  test('fits the selection in the field of view', () => {
    const { position, target } = call([0, 1], two);
    const distance = position.distanceTo(target);
    const half = THREE.MathUtils.degToRad(45) / 2;
    // Everything selected is inside the cone the camera can see.
    const extent = 10 + 0.5;
    expect(Math.sin(half) * distance).toBeGreaterThan(extent);
  });

  test('ignores indices that name no particle', () => {
    expect(call([0, 99], two).target.x).toBeCloseTo(-10);
  });

  test('nothing to frame is nothing to do', () => {
    expect(call([], two)).toBeNull();
    expect(call([5], two)).toBeNull();
  });
});

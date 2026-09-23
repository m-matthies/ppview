import * as THREE from 'three';
import {
  cylinderScratch, cylinderBetween, cylinderBetweenPeriodic, LEAVING, ARRIVING,
} from './transforms';

const BOX = [30, 30, 30];
const at = (x, y, z) => ({ x, y, z });

/** The cylinder's two ends, recovered from the instance the call wrote. */
const endsOf = (dummy) => {
  const half = new THREE.Vector3(0, dummy.scale.y / 2, 0).applyQuaternion(dummy.quaternion);
  return {
    start: dummy.position.clone().sub(half),
    end: dummy.position.clone().add(half),
    length: dummy.scale.y,
  };
};

const draw = (a, b, image) => {
  const dummy = new THREE.Object3D();
  const drawn = cylinderBetweenPeriodic(dummy, cylinderScratch(), a, b, BOX, 0.1, image);
  return drawn ? endsOf(dummy) : null;
};

describe('a bond that does not cross a wall', () => {
  test('is one cylinder between the two particles', () => {
    const leaving = draw(at(10, 15, 15), at(13, 15, 15), LEAVING);
    expect(leaving.length).toBeCloseTo(3);
    // Scene space is the box centred on the origin.
    expect(leaving.start.x).toBeCloseTo(-5);
    expect(leaving.end.x).toBeCloseTo(-2);
  });

  test('and needs no second cylinder', () => {
    expect(draw(at(10, 15, 15), at(13, 15, 15), ARRIVING)).toBeNull();
  });
});

describe('a bond between minimum images', () => {
  // x = 1 and x = 29 in a box of 30 are two apart through the wall, not 28
  // apart across the box.
  const a = at(1, 15, 15);
  const b = at(29, 15, 15);

  test('is drawn at its true length, not the length across the box', () => {
    expect(draw(a, b, LEAVING).length).toBeCloseTo(2);
    expect(draw(a, b, ARRIVING).length).toBeCloseTo(2);
  });

  test('the first cylinder leaves the particle it starts from', () => {
    const { start, end } = draw(a, b, LEAVING);
    expect(start.x).toBeCloseTo(-14);        // particle a, centred
    expect(end.x).toBeCloseTo(-16);          // out through the near wall
  });

  test('the second arrives at the other particle from outside the far wall', () => {
    const { start, end } = draw(a, b, ARRIVING);
    expect(start.x).toBeCloseTo(16);         // outside the far wall
    expect(end.x).toBeCloseTo(14);           // particle b, centred
  });

  test('neither cylinder crosses the middle of the box', () => {
    // The whole point: a bond drawn straight from a to b would sweep the entire
    // box and read as a connection that is not there.
    for (const image of [LEAVING, ARRIVING]) {
      const { start, end } = draw(a, b, image);
      expect(Math.abs(start.x - end.x)).toBeLessThan(BOX[0] / 2);
    }
  });

  test('it wraps on whichever axes need it', () => {
    const { length } = draw(at(1, 1, 15), at(29, 29, 15), LEAVING);
    expect(length).toBeCloseTo(Math.hypot(2, 2));
  });
});

describe('without a periodic box', () => {
  test('nothing wraps', () => {
    const dummy = new THREE.Object3D();
    const second = cylinderBetweenPeriodic(
      dummy, cylinderScratch(), at(1, 0, 0), at(29, 0, 0), [0, 0, 0], 0.1, ARRIVING,
    );
    expect(second).toBe(false);
  });
});

describe('degenerate bonds', () => {
  test('two particles in the same place draw nothing', () => {
    expect(draw(at(5, 5, 5), at(5, 5, 5), LEAVING)).toBeNull();
  });
});

describe('cylinderBetween, which springs still use', () => {
  test('still hides a bond that wraps rather than drawing it across the box', () => {
    const dummy = new THREE.Object3D();
    expect(cylinderBetween(dummy, cylinderScratch(), at(1, 15, 15), at(29, 15, 15), BOX, 0.1))
      .toBe(false);
  });
});

describe('patchTip — where a patch sits, for whoever is drawing it', () => {
  const { patchScratch, patchTip } = require('./transforms');
  // No orientation vectors, so the particle frame is the identity.
  const plain = (x, y, z) => ({ x, y, z });

  test('places the tip a radius out along the patch direction', () => {
    const scratch = patchScratch();
    const ok = patchTip(scratch, plain(15, 15, 15), { x: 0, y: 0, z: 0.7071 }, BOX, 0.5);
    expect(ok).toBe(true);
    // Centre of the box is the origin in scene space.
    expect(scratch.tip.x).toBeCloseTo(0);
    expect(scratch.tip.z).toBeCloseTo(0.5);
  });

  test('the patch vector length is normalised away, as Patches draws it', () => {
    // Two patch vectors of different length but the same direction land in the
    // same place — which is what keeps a bond meeting the cone that is drawn.
    const a = patchScratch();
    const b = patchScratch();
    patchTip(a, plain(15, 15, 15), { x: 0, y: 0, z: 0.7071 }, BOX, 0.5);
    patchTip(b, plain(15, 15, 15), { x: 0, y: 0, z: 3 }, BOX, 0.5);
    expect(a.tip.z).toBeCloseTo(b.tip.z);
  });

  test('follows the particle orientation', () => {
    const scratch = patchScratch();
    // a1 along +Y, a3 along +Z  =>  a2 = a3 x a1 = +X... the patch's local +X
    // therefore lands on a1.
    const turned = { x: 15, y: 15, z: 15, a1: { x: 0, y: 1, z: 0 }, a3: { x: 0, y: 0, z: 1 } };
    patchTip(scratch, turned, { x: 1, y: 0, z: 0 }, BOX, 0.5);
    expect(scratch.tip.y).toBeCloseTo(0.5);
    expect(scratch.tip.x).toBeCloseTo(0);
  });

  test('a degenerate patch vector is refused rather than drawn at the centre', () => {
    const scratch = patchScratch();
    expect(patchTip(scratch, plain(15, 15, 15), { x: 0, y: 0, z: 0 }, BOX, 0.5)).toBe(false);
  });

  test('reports the outward direction, which the cone is aimed along', () => {
    const scratch = patchScratch();
    patchTip(scratch, plain(15, 15, 15), { x: 0, y: 0, z: 2 }, BOX, 0.5);
    expect(scratch.direction.z).toBeCloseTo(1);
    expect(scratch.direction.length()).toBeCloseTo(1);
  });
});

describe('patchOffsetFor — which entry a bond\'s patch id names', () => {
  const { patchOffsetFor } = require('./transforms');
  const offsets = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];

  test('Lorenzo numbers patches sequentially, so the id is the slot', () => {
    const type = { patchPositions: offsets, patches: [0, 1, 2] };
    expect(patchOffsetFor(type, 2)).toBe(offsets[2]);
  });

  test('raspberry carries the global iP id, which is not the slot', () => {
    // `iC 2 512 8,9` gives patches [8, 9] against patchPositions [0, 1].
    const type = { patchPositions: offsets.slice(0, 2), patches: [8, 9] };
    expect(patchOffsetFor(type, 9)).toBe(offsets[1]);
    // Used as an index, 9 would run off the end and the bond would fall back to
    // the particle centre with nothing said about it.
    expect(patchOffsetFor(type, 8)).toBe(offsets[0]);
  });

  test('an id that names nothing yields nothing, rather than a wrong patch', () => {
    const type = { patchPositions: offsets.slice(0, 2), patches: [8, 9] };
    expect(patchOffsetFor(type, 3)).toBeNull();
  });

  test('a particle with no patch data at all yields nothing', () => {
    expect(patchOffsetFor(undefined, 0)).toBeNull();
    expect(patchOffsetFor({ patchPositions: [] }, 0)).toBeNull();
  });

  test('no patch named at all yields nothing', () => {
    // PLClusterTopology states no patch ids; -1 says so.
    expect(patchOffsetFor({ patchPositions: offsets, patches: [0, 1, 2] }, -1)).toBeNull();
  });
});

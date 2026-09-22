import { applyPeriodicBoundary, applyPeriodicWrapping, computeRotationMatrix, calcCOM } from './geometryUtils';
import * as THREE from 'three';

const BOX = [10, 10, 10];
const at = (x, y, z, rest = {}) => ({ x, y, z, ...rest });

describe('applyPeriodicBoundary', () => {
  it('centres the structure on the box', () => {
    // Two particles at 1 and 3 have their centre of mass at 2; centring puts
    // that at the box centre, 5.
    const out = applyPeriodicBoundary([at(1, 5, 5), at(3, 5, 5)], BOX);
    expect(out.map(p => p.x)).toEqual([4, 6]);
  });

  it('leaves an already-centred structure where it is', () => {
    const out = applyPeriodicBoundary([at(4, 5, 5), at(6, 5, 5)], BOX);
    expect(out.map(p => p.x)).toEqual([4, 6]);
  });

  it('wraps a coordinate that centring pushes outside the box', () => {
    const out = applyPeriodicBoundary([at(0, 5, 5), at(0, 5, 5), at(9, 5, 5)], BOX);
    out.forEach(p => {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(BOX[0]);
    });
  });

  it('keeps every field the particle arrived with', () => {
    // Orientation vectors and anything the topology attached have to survive:
    // the renderers read them straight off the same object.
    const a1 = { x: 1, y: 0, z: 0 };
    const a3 = { x: 0, y: 0, z: 1 };
    const [out] = applyPeriodicBoundary([at(5, 5, 5, { a1, a3, typeIndex: 2 })], BOX);
    expect(out.a1).toBe(a1);
    expect(out.a3).toBe(a3);
    expect(out.typeIndex).toBe(2);
  });

  it('handles a non-cubic box per axis', () => {
    const out = applyPeriodicBoundary([at(1, 1, 1), at(3, 7, 19)], [10, 20, 40]);
    out.forEach(p => {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(20);
      expect(p.z).toBeLessThan(40);
    });
  });

  it('returns an empty list unchanged', () => {
    expect(applyPeriodicBoundary([], BOX)).toEqual([]);
  });

  it('centres a single particle on the box', () => {
    const [out] = applyPeriodicBoundary([at(1, 2, 3)], BOX);
    expect([out.x, out.y, out.z]).toEqual([5, 5, 5]);
  });
});

describe('applyPeriodicWrapping', () => {
  it('wraps coordinates into the box without re-centring', () => {
    // The axis-shift shortcuts rely on this: re-centring would undo the shift
    // the person just asked for.
    const out = applyPeriodicWrapping([at(12, -1, 5)], BOX);
    expect(out[0].x).toBeCloseTo(2);
    expect(out[0].y).toBeCloseTo(9);
    expect(out[0].z).toBeCloseTo(5);
  });

  it('keeps other fields', () => {
    const [out] = applyPeriodicWrapping([at(1, 1, 1, { typeIndex: 7 })], BOX);
    expect(out.typeIndex).toBe(7);
  });
});

describe('computeRotationMatrix', () => {
  it('builds a Matrix3 from the orientation vectors', () => {
    // A 3x3: orientation only, no translation — the renderers apply position
    // separately.
    const m = computeRotationMatrix(
      { x: 0, y: 0, z: 0, a1: { x: 1, y: 0, z: 0 }, a3: { x: 0, y: 0, z: 1 } }, THREE);
    expect(m.elements).toHaveLength(9);
    expect([...m.elements]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('returns null for a particle with no orientation', () => {
    // MGL and plain xyz trajectories carry none; rotationMatrixOf treats null as
    // "draw unrotated" rather than substituting an identity nobody asked for.
    expect(computeRotationMatrix({ x: 0, y: 0, z: 0 }, THREE)).toBeNull();
  });
});

describe('calcCOM sampling', () => {
  // Above 50,000 particles the centre of mass is estimated from a stride sample,
  // because six trig calls per particle was the single most expensive thing
  // about loading a frame. These check the trade is sound.
  const BIG = [200, 200, 200];

  const cloud = (n, shape) => Array.from({ length: n }, (_, i) => shape(i, n));

  const error = (a, b) =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));

  const exact = (positions) => {
    // The pre-sampling definition, kept here as the reference to compare with.
    let xc = 0, xs = 0, yc = 0, ys = 0, zc = 0, zs = 0;
    const k = BIG.map(l => (2 * Math.PI) / l);
    positions.forEach(p => {
      xc += Math.cos(p.x * k[0]); xs += Math.sin(p.x * k[0]);
      yc += Math.cos(p.y * k[1]); ys += Math.sin(p.y * k[1]);
      zc += Math.cos(p.z * k[2]); zs += Math.sin(p.z * k[2]);
    });
    const n = positions.length;
    const to = (c, s, l) => l / (2 * Math.PI) * (Math.atan2(-s / n, -c / n) + Math.PI);
    return { x: to(xc, xs, BIG[0]), y: to(yc, ys, BIG[1]), z: to(zc, zs, BIG[2]) };
  };

  it('is exact below the sampling threshold', () => {
    const small = cloud(1000, (i) => ({ x: (i * 7) % 200, y: (i * 13) % 200, z: (i * 29) % 200 }));
    expect(error(calcCOM(small, BIG), exact(small))).toBeLessThan(1e-9);
  });

  it('disagrees on a cloud filling the whole box — where the statistic is undefined', () => {
    // Not a sampling failure. A circular mean is the angle of the summed unit
    // vectors, and for points spread evenly around the circle that sum is
    // almost zero: its angle is then decided by noise, and the full computation
    // is every bit as arbitrary as a sampled one.
    let seed = 42;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const uniform = cloud(300_000, () => ({ x: rnd() * 200, y: rnd() * 200, z: rnd() * 200 }));

    // The resultant length, which is what says whether the mean means anything:
    // 1 for a tight clump, 0 for a uniform spread.
    const resultant = (positions) => {
      const k = (2 * Math.PI) / BIG[0];
      let c = 0, sn = 0;
      positions.forEach(p => { c += Math.cos(p.x * k); sn += Math.sin(p.x * k); });
      return Math.hypot(c, sn) / positions.length;
    };
    expect(resultant(uniform)).toBeLessThan(0.01);      // undefined in practice

    const blob = cloud(300_000, () => ({ x: 60 + rnd() * 20, y: 0, z: 0 }));
    expect(resultant(blob)).toBeGreaterThan(0.9);       // well defined
  });

  it('stays accurate for a clumped structure, not just a uniform one', () => {
    // A uniform cloud is the easy case — its circular mean is ill-conditioned
    // but any sample agrees. A dense blob is what real structures look like.
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const blob = cloud(300_000, () => ({
      x: 60 + rnd() * 20, y: 120 + rnd() * 20, z: 30 + rnd() * 20,
    }));
    expect(error(calcCOM(blob, BIG), exact(blob))).toBeLessThan(0.5);
  });

  it('survives a lattice, where a stride could alias with the structure', () => {
    // The risk of stride sampling: a periodic structure whose period shares a
    // factor with the stride would be sampled unrepresentatively.
    const side = 68;                       // 68^3 = 314,432 particles
    const lattice = [];
    for (let i = 0; i < side; i++)
      for (let j = 0; j < side; j++)
        for (let k = 0; k < side; k++)
          lattice.push({ x: i * 2.9, y: j * 2.9, z: k * 2.9 });
    expect(error(calcCOM(lattice, BIG), exact(lattice))).toBeLessThan(1);
  });

  it('handles an empty frame', () => {
    expect(calcCOM([], BIG)).toEqual({ x: 0, y: 0, z: 0 });
  });
});

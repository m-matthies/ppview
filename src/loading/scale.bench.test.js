/**
 * How the per-frame JavaScript path scales with particle count.
 *
 * Run: CI=true npx react-scripts test --testPathPattern=scale.bench
 *
 * The browser profile that led to skipping phase 5 was taken at 8,000
 * particles, where the rasteriser swamps everything and the JS is under 1%.
 * Real systems reach into the millions, so this measures the JS alone — parse
 * plus decorate, the work every frame does before anything is drawn — across
 * two orders of magnitude, in Node, where nothing else competes for the thread.
 */
import { loadFrame } from './loadFrame';
import { parseConfiguration } from '../utils/trajectoryLoader';
import { applyPeriodicBoundary, computeRotationMatrix } from '../utils/geometryUtils';
import { getParticleType } from '../formats/parsers/particleType';
import * as THREE from 'three';

const SIZES = [10_000, 100_000, 400_000];

const frameText = (n) => {
  const rows = new Array(n + 3);
  rows[0] = 't = 0';
  rows[1] = 'b = 500 500 500';
  rows[2] = 'E = 0 0 0';
  for (let i = 0; i < n; i++) {
    const v = (i % 500) + 0.5;
    rows[i + 3] = `${v} ${v} ${v} 1 0 0 0 0 1`;
  }
  return rows.join('\n');
};

const noopScene = {
  setPositions: () => {},
  setCurrentBoxSize: () => {},
  setCurrentTime: () => {},
  setCurrentEnergy: () => {},
};

// Opt-in: this takes minutes at the larger sizes and has no assertions worth
// running on every commit. BENCH=1 npx react-scripts test --testPathPattern=scale
const bench = process.env.BENCH ? describe : describe.skip;

bench('per-frame JS cost by particle count', () => {
  jest.setTimeout(600_000);

  it('reports the scaling curve', async () => {
    const results = [];
    for (const n of SIZES) {
      const text = frameText(n);
      const file = { size: text.length, slice: () => ({ text: async () => text }) };
      const topData = { totalParticles: n, particleTypes: [{ typeIndex: 0 }] };

      // One warm-up, then three timed runs; report the median.
      await loadFrame({ file, index: [0], frameNumber: 0, topData, scene: noopScene });
      const samples = [];
      for (let r = 0; r < 3; r++) {
        if (global.gc) global.gc();
        const before = process.memoryUsage().heapUsed;
        const t0 = process.hrtime.bigint();
        await loadFrame({ file, index: [0], frameNumber: 0, topData, scene: noopScene });
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        samples.push({ ms, heapMb: (process.memoryUsage().heapUsed - before) / 1e6 });
      }
      samples.sort((a, b) => a.ms - b.ms);
      const median = samples[1];
      results.push({ n, ms: median.ms, heapMb: median.heapMb });
    }

    console.log('\n  particles     ms/frame    ms per 100k    heap delta');
    for (const r of results) {
      console.log(
        `  ${String(r.n).padStart(9)}  ${r.ms.toFixed(0).padStart(9)}` +
        `  ${(r.ms / (r.n / 100_000)).toFixed(0).padStart(13)}` +
        `  ${r.heapMb.toFixed(0).padStart(11)} MB`,
      );
    }
    // 60 fps is 16ms. Anything past a second per frame is not playback.
    expect(results.length).toBe(SIZES.length);
  });

  it('measures the per-instance write loop the renderers run every frame', () => {
    // InstancedLayer composes a Matrix4 per particle per frame and writes 16
    // floats into instanceMatrix. That is JavaScript we control, and it runs
    // after the load path — so it adds to the per-frame budget rather than
    // overlapping with it.
    const n = 1_000_000;
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.5, 16, 16), new THREE.MeshStandardMaterial(), n);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color('#ff0000');

    const time = (fn) => { fn(); const t0 = process.hrtime.bigint(); fn();
                           return Number(process.hrtime.bigint() - t0) / 1e6; };

    const matrixMs = time(() => {
      for (let i = 0; i < n; i++) {
        dummy.position.set(i % 100, (i / 100) % 100, i % 37);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
    });
    const colorMs = time(() => {
      for (let i = 0; i < n; i++) mesh.setColorAt(i, color);
    });

    // What the GPU is asked to draw, at the default detail.
    const trisPerSphere = 16 * 16 * 2;
    console.log(`\n  at ${n.toLocaleString()} particles, per frame:`);
    console.log(`  ${matrixMs.toFixed(0).padStart(6)} ms  compose + setMatrixAt`);
    console.log(`  ${colorMs.toFixed(0).padStart(6)} ms  setColorAt`);
    console.log(`  ${((trisPerSphere * n) / 1e6).toFixed(0).padStart(6)} M   triangles submitted (sphere, 16 segments)`);
    expect(matrixMs).toBeGreaterThan(0);
  });

  it('splits that cost between parsing and decorating', () => {
    // Which half dominates decides what to change: parsing straight into a
    // typed array, or not building one object per particle per frame.
    const n = 400_000;
    const lines = frameText(n).split('\n');
    const topData = { totalParticles: n, particleTypes: [{ typeIndex: 0 }] };

    const time = (label, fn) => {
      fn();                                   // warm up
      const t0 = process.hrtime.bigint();
      const value = fn();
      return { label, ms: Number(process.hrtime.bigint() - t0) / 1e6, value };
    };

    const split = time('split lines', () => frameText(n).split('\n'));
    const parsed = time('parseConfiguration', () => parseConfiguration(lines));
    const config = parsed.value;
    const wrapped = time('applyPeriodicBoundary',
      () => applyPeriodicBoundary(config.positions, config.boxSize));
    const positions = wrapped.value;
    const decorated = time('decorate (types + rotation)', () => positions.map((position, index) => {
      const { typeIndex, particleType } = getParticleType(index, topData);
      return { ...position, typeIndex, particleType,
               rotationMatrix: computeRotationMatrix(position, THREE) };
    }));

    console.log(`\n  at ${n.toLocaleString()} particles:`);
    for (const stage of [split, parsed, wrapped, decorated]) {
      console.log(`  ${stage.ms.toFixed(0).padStart(6)} ms  ${stage.label}`);
    }
    expect(decorated.value).toHaveLength(n);
  });
});

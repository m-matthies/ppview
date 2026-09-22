import { parseFrameBuffers, createFrameBuffers } from './parseFrameBuffers';
import { parseConfiguration } from '../utils/trajectoryLoader';

const frame = (n) => {
  const rows = ['t = 1500', 'b = 500 500 500', 'E = 1 2 3'];
  for (let i = 0; i < n; i++) {
    const v = (i % 500) + 0.25;
    rows.push(`${v} ${v + 1} ${v + 2} 1 0 0 0 0 1`);
  }
  return rows.join('\n');
};

describe('parseFrameBuffers', () => {
  it('agrees with parseConfiguration on the header and every coordinate', () => {
    const text = frame(500);
    const buffers = createFrameBuffers();
    const fast = parseFrameBuffers(text, buffers);
    const slow = parseConfiguration(text.split('\n'));

    expect(fast.count).toBe(slow.positions.length);
    expect(fast.time).toBe(slow.time);
    expect(fast.boxSize).toEqual(slow.boxSize);
    expect(fast.energy).toEqual(slow.energy);
    for (let i = 0; i < fast.count; i++) {
      expect(fast.positions[i * 3]).toBeCloseTo(slow.positions[i].x, 3);
      expect(fast.positions[i * 3 + 1]).toBeCloseTo(slow.positions[i].y, 3);
      expect(fast.positions[i * 3 + 2]).toBeCloseTo(slow.positions[i].z, 3);
      expect(fast.a1[i * 3]).toBeCloseTo(slow.positions[i].a1.x, 3);
      expect(fast.a3[i * 3 + 2]).toBeCloseTo(slow.positions[i].a3.z, 3);
    }
  });

  it('reads negative, exponent and bare-dot numbers', () => {
    const text = ['t = 0', 'b = 10 10 10', 'E = 0 0 0', '-1.5 2e2 .25 1 0 0 0 0 1'].join('\n');
    const out = parseFrameBuffers(text, createFrameBuffers());
    expect(out.positions[0]).toBeCloseTo(-1.5, 5);
    expect(out.positions[1]).toBeCloseTo(200, 5);
    expect(out.positions[2]).toBeCloseTo(0.25, 5);
  });

  it('handles rows without orientation', () => {
    const text = ['t = 0', 'b = 10 10 10', 'E = 0 0 0', '1 2 3', '4 5 6'].join('\n');
    const out = parseFrameBuffers(text, createFrameBuffers());
    expect(out.count).toBe(2);
    expect(out.hasOrientation).toBe(false);
  });

  it('reuses its buffers between frames', () => {
    const buffers = createFrameBuffers();
    const first = parseFrameBuffers(frame(100), buffers);
    const positions = first.positions;
    const second = parseFrameBuffers(frame(100), buffers);
    expect(second.positions).toBe(positions);
  });

  it('is faster than the four-pass path', () => {
    const n = 400_000;
    const text = frame(n);
    const lines = text.split('\n');
    const buffers = createFrameBuffers();

    const time = (fn) => { fn(); const samples = [];
      for (let r = 0; r < 3; r++) { const t = process.hrtime.bigint(); fn();
        samples.push(Number(process.hrtime.bigint() - t) / 1e6); }
      samples.sort((a, b) => a - b); return samples[1]; };

    const oldMs = time(() => parseConfiguration(lines));
    const splitMs = time(() => text.split('\n'));
    const newMs = time(() => parseFrameBuffers(text, buffers));
    console.log(`\n  at ${n.toLocaleString()} particles:`);
    console.log(`  ${(splitMs + oldMs).toFixed(0).padStart(6)} ms  split + parseConfiguration`);
    console.log(`  ${newMs.toFixed(0).padStart(6)} ms  parseFrameBuffers`);
    expect(newMs).toBeLessThan(splitMs + oldMs);
  });
});

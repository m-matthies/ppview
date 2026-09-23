import { parseFrame, dbscan, wasmReady, __setCore } from './wasmCore';
import { createFrameBuffers } from '../loading/frameBuffers';

// The core is instantiated once for every test file by `setupTests.js`, from
// the same .wasm the browser fetches — so passing here is passing there.

const frame = (rows) => new TextEncoder().encode([
  't = 1500',
  'b = 60 60 60',
  'E = -1.5 -0.5 -1',
  ...rows,
].join('\n') + '\n');

const read = (rows) => parseFrame(frame(rows), createFrameBuffers());

describe('parsing a frame', () => {
  test('reads the header', () => {
    const out = read(['1 2 3 1 0 0 0 0 1 0 0 0 0 0 0']);
    expect(out.time).toBeCloseTo(1500);
    expect(Array.from(out.boxSize)).toEqual([60, 60, 60]);
    expect(Array.from(out.energy)).toEqual([-1.5, -0.5, -1]);
  });

  test('reads positions and orientation', () => {
    const out = read([
      '1.5 2.25 3.125 1 0 0 0 0 1 0 0 0 0 0 0',
      '-4.5 -0.25 60.5 0 1 0 0 0 1 0 0 0 0 0 0',
    ]);
    expect(out.count).toBe(2);
    expect(out.hasOrientation).toBe(true);
    expect(Array.from(out.positions.slice(0, 6)))
      .toEqual([1.5, 2.25, 3.125, -4.5, -0.25, 60.5]);
    expect(Array.from(out.a1.slice(0, 6))).toEqual([1, 0, 0, 0, 1, 0]);
    expect(Array.from(out.a3.slice(0, 6))).toEqual([0, 0, 1, 0, 0, 1]);
  });

  test('a format carrying no orientation says so', () => {
    const out = read(['1.5 2.25 3.125', '4 5 6']);
    expect(out.count).toBe(2);
    expect(out.hasOrientation).toBe(false);
    expect(Array.from(out.positions.slice(0, 6))).toEqual([1.5, 2.25, 3.125, 4, 5, 6]);
  });

  // The trap the scanner is written around: a number must never be read across
  // a line break, or a row of three columns consumes the first value of the next
  // and the frame comes out with half the particles it should.
  test('a short row does not eat the next one', () => {
    const out = read(['1 2 3', '4 5 6', '7 8 9']);
    expect(out.count).toBe(3);
    expect(Array.from(out.positions.slice(0, 9))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('signs and exponents', () => {
    const out = read(['-1.5e2 2.25E-1 +3 1 0 0 0 0 1 0 0 0 0 0 0']);
    expect(out.positions[0]).toBeCloseTo(-150, 3);
    expect(out.positions[1]).toBeCloseTo(0.225, 4);
    expect(out.positions[2]).toBeCloseTo(3, 4);
  });

  test('a large frame, every coordinate', () => {
    const rows = Array.from({ length: 2000 }, (_, i) =>
      `${(i * 0.017).toFixed(6)} ${(i * 0.031).toFixed(6)} ${(i * 0.043).toFixed(6)} 1 0 0 0 0 1 0 0 0 0 0 0`);
    const out = read(rows);
    expect(out.count).toBe(2000);
    for (let i = 0; i < 2000; i++) {
      expect(out.positions[i * 3]).toBeCloseTo(i * 0.017, 3);
      expect(out.positions[i * 3 + 2]).toBeCloseTo(i * 0.043, 3);
    }
  });

  test('the buffers are reused, so a smaller frame does not reallocate', () => {
    const buffers = createFrameBuffers();
    const big = parseFrame(frame(Array.from({ length: 50 }, () => '1 2 3')), buffers);
    const positions = big.positions;
    const small = parseFrame(frame(['9 8 7']), buffers);
    expect(small.positions).toBe(positions);
    expect(small.count).toBe(1);
  });
});

describe('clustering through the core', () => {
  test('finds separated groups and calls the rest noise', () => {
    const points = [
      { x: 0, y: 0, z: 0 }, { x: 0.3, y: 0, z: 0 }, { x: 0, y: 0.3, z: 0 },
      { x: 20, y: 20, z: 20 }, { x: 20.3, y: 20, z: 20 }, { x: 20, y: 20.3, z: 20 },
      { x: 40, y: 0, z: 0 },
    ];
    const clusters = dbscan(points, 1.0, 3, [60, 60, 60]);
    expect(clusters.map(c => c.length)).toEqual([3, 3]);
    expect(clusters[0]).toEqual([0, 1, 2]);
    expect(clusters[1]).toEqual([3, 4, 5]);
  });

  test('no points is no clusters, not a crash', () => {
    expect(dbscan([], 1, 3, [10, 10, 10])).toEqual([]);
  });
});

describe('without the core there is nothing to fall back to', () => {
  afterEach(() => {
    // Put it back for the rest of the file; setupTests runs once per file.
    // eslint-disable-next-line global-require
    const fs = require('fs');
    // eslint-disable-next-line global-require
    const path = require('path');
    const bytes = fs.readFileSync(path.join(__dirname, '../../public/wasm/ppview_core.wasm'));
    return WebAssembly.instantiate(bytes, {}).then(({ instance }) => __setCore(instance.exports));
  });

  test('it says so plainly rather than failing somewhere further in', () => {
    __setCore(null);
    expect(wasmReady()).toBe(false);
    expect(() => dbscan([{ x: 0, y: 0, z: 0 }], 1, 1, null))
      .toThrow(/WebAssembly core did not load/);
  });
});

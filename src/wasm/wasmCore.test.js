import fs from 'fs';
import path from 'path';
import { __setCore, wasmDbscan, wasmParseFrame, wasmReady } from './wasmCore';
import { dbscan } from '../utils/clustering';
import { parseFrameBuffers, createFrameBuffers } from '../loading/parseFrameBuffers';

// Instantiated straight from the file rather than over fetch: this is the same
// module the browser loads, so agreeing here is agreeing there.
const wasmPath = path.join(__dirname, '../../public/wasm/ppview_core.wasm');
let exports_ = null;

beforeAll(async () => {
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  exports_ = instance.exports;
});

beforeEach(() => __setCore(exports_));
afterEach(() => __setCore(null));

const frameText = (rows) => [
  't = 1500',
  'b = 60 60 60',
  'E = -1.5 -0.5 -1',
  ...rows,
].join('\n') + '\n';

const randomPoints = (seed, count, box) => {
  let s = seed;
  const next = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  return Array.from({ length: count }, () => ({
    x: next() * box, y: next() * box, z: next() * box,
  }));
};

describe('the compiled core', () => {
  test('is only used when it has loaded', () => {
    expect(wasmReady()).toBe(true);
    __setCore(null);
    expect(wasmReady()).toBe(false);
    expect(wasmDbscan([{ x: 0, y: 0, z: 0 }], 1, 1, null)).toBeNull();
  });
});

describe('parsing agrees with the JavaScript parser', () => {
  const cases = [
    ['positions and orientation', [
      '1.5 2.25 3.125 1 0 0 0 0 1 0 0 0 0 0 0',
      '-4.5 -0.25 60.5 0 1 0 0 0 1 0 0 0 0 0 0',
    ]],
    ['positions only, as MGL-style rows have', ['1.5 2.25 3.125', '4 5 6']],
    ['negative and exponent forms', ['-1.5e2 2.25E-1 +3 1 0 0 0 0 1 0 0 0 0 0 0']],
    ['a short row, which must not eat the next one', ['1 2 3', '4 5 6', '7 8 9']],
  ];

  test.each(cases)('%s', (_label, rows) => {
    const text = frameText(rows);
    const fromJs = parseFrameBuffers(text, createFrameBuffers());
    const fromWasm = wasmParseFrame(new TextEncoder().encode(text), createFrameBuffers());

    expect(fromWasm.count).toBe(fromJs.count);
    expect(fromWasm.time).toBeCloseTo(fromJs.time, 3);
    expect(Array.from(fromWasm.boxSize)).toEqual(Array.from(fromJs.boxSize));
    expect(Array.from(fromWasm.energy)).toEqual(Array.from(fromJs.energy));
    expect(fromWasm.hasOrientation).toBe(fromJs.hasOrientation);

    const values = fromJs.count * 3;
    for (let i = 0; i < values; i++) {
      expect(fromWasm.positions[i]).toBeCloseTo(fromJs.positions[i], 3);
      if (fromJs.hasOrientation) {
        expect(fromWasm.a1[i]).toBeCloseTo(fromJs.a1[i], 3);
        expect(fromWasm.a3[i]).toBeCloseTo(fromJs.a3[i], 3);
      }
    }
  });

  test('a large frame, coordinate by coordinate', () => {
    const rows = Array.from({ length: 2000 }, (_, i) =>
      `${(i * 0.017).toFixed(6)} ${(i * 0.031).toFixed(6)} ${(i * 0.043).toFixed(6)} 1 0 0 0 0 1 0 0 0 0 0 0`);
    const text = frameText(rows);
    const fromJs = parseFrameBuffers(text, createFrameBuffers());
    const fromWasm = wasmParseFrame(new TextEncoder().encode(text), createFrameBuffers());
    expect(fromWasm.count).toBe(2000);
    for (let i = 0; i < 6000; i++) {
      expect(fromWasm.positions[i]).toBeCloseTo(fromJs.positions[i], 3);
    }
  });
});

describe('clustering agrees with the JavaScript implementation', () => {
  const sorted = (clusters) => clusters
    .map(c => [...c].sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0]);

  // Cluster *order* matters as much as membership: the pane selects by index.
  const jsOnly = (points, epsilon, minPoints, box) => {
    __setCore(null);
    try { return dbscan(points, epsilon, minPoints, box); } finally { __setCore(exports_); }
  };

  test.each([
    ['dense, periodic', 400, 12, 1.5, 3, [12, 12, 12]],
    ['sparse, periodic', 400, 40, 2.0, 3, [40, 40, 40]],
    ['a box only a few cells across', 200, 6, 2.0, 4, [6, 6, 6]],
    ['no box at all', 250, 20, 2.0, 3, null],
    ['a high neighbour count', 400, 15, 2.0, 8, [15, 15, 15]],
    ['everything noise', 100, 100, 0.5, 5, [100, 100, 100]],
  ])('agrees on %s', (_label, count, box, epsilon, minPoints, boxSize) => {
    const points = randomPoints(count * 13 + 5, count, box);
    const fromJs = jsOnly(points, epsilon, minPoints, boxSize);
    const fromWasm = wasmDbscan(points, epsilon, minPoints, boxSize);
    expect(sorted(fromWasm)).toEqual(sorted(fromJs));
    // And in the same order, since a cluster's index is what gets selected.
    expect(fromWasm.map(c => c.length)).toEqual(fromJs.map(c => c.length));
  });
});

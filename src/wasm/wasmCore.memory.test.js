import fs from 'fs';
import path from 'path';
import { parseFrame, dbscan, scanObservable, __setCore, OBS_STEP_HEADERS } from './wasmCore';
import { createFrameBuffers } from '../loading/frameBuffers';

/**
 * The core keeps its results in statics that JS reads back as views. Replacing
 * one has to *drop* what was there: `ptr::write` overwrites without dropping,
 * so every call leaked the previous result's buffers.
 *
 * It surfaced as playback dying after a few thousand frames with "Start offset
 * -2147186048 is outside the bounds of the buffer" — a wasm i32 pointer past
 * 2^31 coming back negative once linear memory passed 2 GB. Measured before the
 * fix: 1.2 MB leaked per frame, 2 GB after about 1,750 frames.
 *
 * Its own instance, not the shared one, so the measurement is not disturbed by
 * whatever other suites have parsed.
 */
const freshCore = async () => {
  const wasm = path.join(__dirname, '../../public/wasm/ppview_core.wasm');
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasm), {});
  return instance.exports;
};

const megabytes = (core) => core.memory.buffer.byteLength / 1e6;

const frameOf = (count) => new TextEncoder().encode([
  't = 0', 'b = 60 60 60', 'E = 0 0 0',
  ...Array.from({ length: count }, (_, i) =>
    `${i % 60} ${(i * 7) % 60} ${(i * 13) % 60} 1 0 0 0 0 1 0 0 0 0 0 0`),
].join('\n') + '\n');

let shared;
beforeAll(async () => { shared = await freshCore(); });
// Every other suite runs against the core setupTests injected; put it back.
afterEach(async () => __setCore(shared));

/** Memory after `warm` calls, and after `total`. It must not keep climbing. */
const growth = async (run) => {
  const core = await freshCore();
  __setCore(core);
  for (let i = 0; i < 20; i++) await run(i);     // eslint-disable-line no-await-in-loop
  const warm = megabytes(core);
  for (let i = 0; i < 200; i++) await run(i);    // eslint-disable-line no-await-in-loop
  return { warm, after: megabytes(core) };
};

test('parsing frames does not leak the previous frame', async () => {
  const buffers = createFrameBuffers();
  const bytes = frameOf(2000);
  const { warm, after } = await growth(() => parseFrame(bytes, buffers));
  expect(after).toBeLessThanOrEqual(warm);
}, 60000);

test('clustering does not leak the previous labels', async () => {
  const points = Array.from({ length: 2000 }, (_, i) => ({
    x: (i % 20) * 1.5, y: ((i / 20) | 0) * 1.5, z: 0,
  }));
  const { warm, after } = await growth(() => dbscan(points, 2, 3, [60, 60, 60]));
  expect(after).toBeLessThanOrEqual(warm);
}, 60000);

test('indexing an observable does not leak the previous index', async () => {
  const text = Array.from({ length: 400 }, (_, i) =>
    `# step ${i * 100} N 2\n1\n2\n1\n1`).join('\n');
  const chunks = () => (async function* stream() {
    yield new TextEncoder().encode(text);
  })();
  const { warm, after } = await growth(() => scanObservable(chunks(), OBS_STEP_HEADERS));
  expect(after).toBeLessThanOrEqual(warm);
}, 60000);

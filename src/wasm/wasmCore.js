/**
 * The Rust core: frame parsing and DBSCAN.
 *
 * There is one implementation of each, and it is this one. There used to be two
 * — a JavaScript version alongside, kept as a fallback and as the reference —
 * and carrying both was not worth it: every change had to be made twice, in two
 * languages, and kept in step by a test suite comparing them. The Rust is four
 * times faster on a frame and twenty on clustering, so the JavaScript was never
 * going to be the one that ran.
 *
 * What is lost is the graceful degradation. A browser without WebAssembly, or a
 * blocked request, now means the viewer cannot read a trajectory — so the load
 * path waits for the module and says so plainly if it never arrives, rather than
 * failing somewhere further in.
 *
 * **No wasm-bindgen.** Everything crossing the boundary is a block of bytes
 * going in or a block of f32/i32 coming out, so the generated glue would buy
 * nothing and cost a bundler integration that Create React App cannot be given
 * without ejecting. The module is fetched and instantiated directly.
 */

let core = null;
let loading = null;

/** Memory grows, which replaces the buffer — never hold a view across a call. */
const view = (Type, ptr, length) => new Type(core.memory.buffer, ptr, length);

/**
 * Where the module is served from.
 *
 * `PUBLIC_URL` is the homepage path in a build and empty in development, where
 * the dev server still serves the app under that path — so the two disagree and
 * only one of them is right at a time. Both are tried, nearest first.
 */
const candidateUrls = () => {
  const configured = process.env.PUBLIC_URL ?? '';
  return [...new Set([
    new URL('wasm/ppview_core.wasm', window.location.href).href,
    `${configured}/wasm/ppview_core.wasm`,
    '/wasm/ppview_core.wasm',
  ])];
};

async function instantiate() {
  let lastError = null;
  for (const url of candidateUrls()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}`);
      // instantiateStreaming needs the right content type, which not every
      // static host sets; the ArrayBuffer path works regardless and this
      // module is 26 KB.
      // eslint-disable-next-line no-await-in-loop
      const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
      return instance.exports;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('no candidate URL worked');
}

/**
 * Loads the module, once. Resolves to false rather than throwing: a viewer that
 * refuses to start because an optimisation is unavailable is worse than a slow
 * one.
 */
export function loadWasmCore() {
  if (loading) return loading;
  loading = (async () => {
    if (typeof WebAssembly === 'undefined' || typeof fetch === 'undefined') return false;
    try {
      core = await instantiate();
      // Which path is running, for anyone diagnosing a slow session — the
      // difference is 4x on a frame and 20x on clustering, so "is the compiled
      // core loaded" is the first question worth answering.
      window.__ppviewCore = 'wasm';
      return true;
    } catch (error) {
      window.__ppviewCore = 'js';
      console.warn('WebAssembly core unavailable, using the JavaScript path:', error.message);
      core = null;
      return false;
    }
  })();
  return loading;
}

export const wasmReady = () => core !== null;

/**
 * The core, or a plain explanation of why there is nothing to run.
 *
 * Callers reach this only after `loadWasmCore` has resolved, so in practice it
 * throws when the module genuinely could not be fetched or compiled.
 */
function requireCore() {
  if (!core) {
    throw new Error(
      'The WebAssembly core did not load, so trajectories cannot be read. '
      + 'Check that /wasm/ppview_core.wasm is being served.',
    );
  }
  return core;
}

/** Tests instantiate the module from disk and inject it; see `setupTests.js`. */
export const __setCore = (next) => {
  core = next;
  loading = Promise.resolve(next !== null);
};

/**
 * Reads a frame from raw bytes.
 *
 * Bytes, not a string: the file is read as an ArrayBuffer and handed over as it
 * came off disk, so nothing is decoded on the way — which turns out to be nearly
 * free anyway, since V8 keeps an ASCII string one byte per character. The win is
 * in the scan.
 */
export function parseFrame(bytes, buffers) {
  core = requireCore();
  const ptr = core.alloc(bytes.length);
  try {
    view(Uint8Array, ptr, bytes.length).set(bytes);
    const count = core.parse_frame(ptr, bytes.length);
    if (count === 0) return null;      // an empty or unreadable frame

    const meta = view(Float32Array, core.frame_meta(), 9);
    const hasOrientation = meta[8] === 1;
    const values = count * 3;

    // The same reusable buffers the JavaScript parser fills, so the frame this
    // returns is indistinguishable from its output and the cache can store it
    // the same way.
    buffers.ensure(count);
    buffers.positions.set(view(Float32Array, core.frame_positions(), values));
    if (hasOrientation) {
      buffers.a1.set(view(Float32Array, core.frame_a1(), values));
      buffers.a3.set(view(Float32Array, core.frame_a3(), values));
    }

    return {
      count,
      time: meta[1],
      boxSize: [meta[2], meta[3], meta[4]],
      energy: [meta[5], meta[6], meta[7]],
      hasOrientation,
      positions: buffers.positions,
      a1: buffers.a1,
      a3: buffers.a3,
    };
  } finally {
    core.dealloc(ptr, bytes.length);
  }
}

/**
 * DBSCAN over `[{x, y, z}]`, returning clusters as arrays of particle indices.
 *
 * The Rust side returns one label per particle and the clusters are rebuilt
 * here: cluster order is the order they were created, which is what the pane
 * selects by, and membership within a cluster comes out ascending. Nothing reads
 * that order — it is the set that matters.
 */
export function dbscan(points, epsilon, minPoints, boxSize) {
  if (points.length === 0) return [];
  core = requireCore();
  const count = points.length;
  const ptr = core.alloc_f32(count * 3);
  try {
    const flat = view(Float32Array, ptr, count * 3);
    for (let i = 0; i < count; i++) {
      flat[i * 3] = points[i].x;
      flat[i * 3 + 1] = points[i].y;
      flat[i * 3 + 2] = points[i].z;
    }
    const [lx = 0, ly = 0, lz = 0] = boxSize || [];
    const clusterCount = core.dbscan(ptr, count, epsilon, minPoints, lx, ly, lz);

    const labels = view(Int32Array, core.cluster_labels(), count);
    const clusters = Array.from({ length: clusterCount }, () => []);
    for (let i = 0; i < count; i++) {
      if (labels[i] >= 0) clusters[labels[i]].push(i);
    }
    return clusters;
  } finally {
    core.dealloc_f32(ptr, count * 3);
  }
}

/** Block starts are lines beginning with `#`, and that line states the step. */
export const OBS_STEP_HEADERS = 0;
/** Every line is one timestep, and no step number is written anywhere. */
export const OBS_LINE_PER_STEP = 1;

/** How much is copied into the module at a time. */
const SCAN_CHUNK = 1 << 22;   // 4 MB

/**
 * Indexes a cluster/bond observable: where each timestep starts, and which step
 * it is.
 *
 * The file that prompted this is 4.79 GB — 8.9x V8's maximum string length, so
 * `file.text()` cannot read it at any amount of RAM — and holds 21,798
 * timesteps of which a trajectory of 217 frames needs 217. So nothing is parsed
 * here: this pass only finds the blocks, and JS then slices out the handful it
 * wants and runs the ordinary parser on each. Same division as the trajectory,
 * which is indexed once and then read a frame at a time.
 *
 * Measured over that file: **1.9s at 2.5 GB/s**, against 3.4s for the same scan
 * written as a byte loop in JavaScript and 10.2s for the decode-and-split the
 * trajectory index uses. Worth compiling for the same reason frame parsing is —
 * it is a flat loop over bytes, and there are five thousand million of them.
 *
 * Offsets come back as `f64`, not `i32`: this file is past 2^32 bytes, and a
 * 32-bit offset wraps a third of the way in.
 *
 * @param chunks  async iterable of Uint8Array, e.g. a File's stream reader
 */
export async function scanObservable(chunks, format, { onProgress } = {}) {
  core = requireCore();
  core.obs_scan_begin(format);
  const ptr = core.alloc(SCAN_CHUNK);
  let done = 0;
  try {
    for await (const chunk of chunks) {
      // The scanner is streaming, so a chunk larger than the scratch buffer is
      // simply fed in pieces — no seam handling needed on this side.
      for (let at = 0; at < chunk.length; at += SCAN_CHUNK) {
        const piece = chunk.subarray(at, Math.min(at + SCAN_CHUNK, chunk.length));
        view(Uint8Array, ptr, piece.length).set(piece);
        core.obs_scan_feed(ptr, piece.length);
      }
      done += chunk.length;
      if (onProgress) onProgress(done, null);
    }
    const count = core.obs_scan_end();
    // Copied out, not viewed: the views are over the module's memory, which the
    // next allocation may replace.
    return {
      offsets: Float64Array.from(view(Float64Array, core.obs_scan_offsets(), count)),
      steps: Float64Array.from(view(Float64Array, core.obs_scan_steps(), count)),
      size: core.obs_scan_size(),
    };
  } finally {
    core.dealloc(ptr, SCAN_CHUNK);
    core.obs_scan_free();
  }
}

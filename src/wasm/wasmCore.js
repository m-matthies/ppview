/**
 * The Rust core, and the decision about whether to use it.
 *
 * Two things crossed the boundary worth compiling: reading a frame out of the
 * trajectory text, and DBSCAN. Both are flat loops over numbers, which is what
 * WebAssembly is good at and what JavaScript's number representation makes
 * awkward.
 *
 * **No wasm-bindgen.** Everything passed here is a block of bytes going in or a
 * block of f32/i32 coming out, so the generated glue would buy nothing and cost
 * a bundler integration — and Create React App cannot be given a webpack config
 * without ejecting. The module is fetched and instantiated directly instead.
 *
 * **The JavaScript implementations stay, and stay tested.** This loads
 * asynchronously and can fail: an old browser, a blocked fetch, a jsdom test
 * with no `fetch` at all. Every entry point here falls back, and `wasmCore.test.js`
 * checks the two agree rather than assuming it.
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

/** For tests, which need to run both paths deliberately. */
export const __setCore = (next) => { core = next; };

/**
 * Reads a frame from raw bytes.
 *
 * Bytes, not a string: the file is read as an ArrayBuffer and handed over as it
 * came off disk, so nothing is decoded on the way. Returns null when the module
 * is not loaded, so the caller can take the JavaScript path.
 */
export function wasmParseFrame(bytes, buffers) {
  if (!core) return null;
  const ptr = core.alloc(bytes.length);
  try {
    view(Uint8Array, ptr, bytes.length).set(bytes);
    const count = core.parse_frame(ptr, bytes.length);
    if (count === 0) return null;

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
 * selects by, and membership order within a cluster is ascending. Nothing reads
 * that order — it is the set that matters — and ascending is the one order two
 * implementations can agree on without carrying it across the boundary.
 */
export function wasmDbscan(points, epsilon, minPoints, boxSize) {
  if (!core || points.length === 0) return null;
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

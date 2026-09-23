# ppview-core

Frame parsing and DBSCAN, compiled to WebAssembly.

```sh
npm run build:wasm      # from the repository root
```

That writes `public/wasm/ppview_core.wasm`, which **is committed** — the same
way `build/` is. A checkout without a Rust toolchain still runs: the JavaScript
implementations in `src/utils/clustering.js` and `src/loading/parseFrameBuffers.js`
are kept, and `src/wasm/wasmCore.js` falls back to them when the module does not
load. Rebuild and commit the `.wasm` whenever this crate changes.

Measured against those implementations, on the same inputs:

| | JavaScript | Rust |
|---|---|---|
| parse a 400,000-particle frame | 160 ms | 37 ms |
| DBSCAN, 10,000 particles | 252 ms | 14 ms |
| DBSCAN, 20,000 particles | 981 ms | 44 ms |
| DBSCAN, 50,000 particles | 6,230 ms | 274 ms |

`src/wasm/wasmCore.test.js` instantiates this exact file and checks that the two
agree — coordinate by coordinate for parsing, and for clustering both the
membership and the *order* of the clusters, since a cluster's index is what the
pane selects by.

No `wasm-bindgen`: everything crossing the boundary is a block of bytes in or a
block of `f32`/`i32` out, so the generated glue would buy nothing and cost a
bundler integration that Create React App cannot be given without ejecting.

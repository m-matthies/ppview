# PPView - Claude Code Guide

PPView is a React-based 3D visualization tool for oxDNA molecular dynamics simulations and patchy particle systems.

## Tech Stack

- **React 18.3.1** (Create React App)
- **Three.js 0.168.0** + **React Three Fiber 8.17.7** + **@react-three/drei 9.113.0**
- **Zustand** for state management (3 stores)
- Deployed to GitHub Pages at `https://m-matthies.github.io/ppview`

## Development Commands

```bash
npm start                        # Dev server at http://localhost:3000
npm test                         # Jest tests in watch mode
npm run build                    # Production build
npm run deploy                   # Deploy to GitHub Pages
npm run fixtures                 # Regenerate visual-test fixtures
npm run test:visual              # Visual regression vs baseline
npm run test:visual -- --update  # Re-record the baseline
npm run test:visual -- --only=oxdna
```

## Architecture

### State Management (Zustand)
- `src/store/particleStore.js` — particle/trajectory data (`positions`, `topData`, `trajFile`, `configIndex`, `particleRadius`, etc.)
- `src/store/uiStore.js` — UI state (legends, toggles, playback, selection, color scheme, iframe mode, lighting)
- `src/store/clusteringStore.js` — clustering highlights (`highlightedClusters` Set, `showOnlyHighlightedClusters`)

Components read from stores directly — **no prop drilling**.

### Source layout
```
src/
  components/<Name>/index.js   one folder per component, with its .css and .test.js
  rendering/                   InstancedLayer, pickingService, transforms
  formats/
    registry.js                every supported format in one table
    parsers/                   one module per topology format
    detection/                 signatures.js (pure predicates) + orchestration
  hooks/                       useKeyboardShortcuts, useIframeBridge
  store/                       three Zustand stores
  styles/                      tokens.css plus one file per UI concern
  utils/                       clustering, geometry, export, trajectory, MGL
```
`styles.css` is now only a manifest of `@import`s; `tokens.css` must come first.

### Key Components
- `App.js` — file loading, trajectory nav, GLTF export, iframe message handling
- `ParticleScene.js` — Three.js scene (lighting, controls, 3D rendering, Springs)
- `Particles.js` — instanced mesh rendering; consolidates all raycasting for click/selection including repulsion site beads (registration pattern)
- `Patches.js` — instanced cone geometry patches; size proportional to `particleRadius` from store
- `RepulsionSites.js` — instanced bead rendering for raspberry particles; inner sphere hidden, only outer beads rendered and selectable; registers mesh + metadata with `Particles.js` via `onRegister` callback
- `Springs.js` — instanced cylinder rendering for SRS spring bonds; hides springs longer than half box size (periodic boundary filter); uses zero-scale matrix for all skipped instances to avoid ghost artifacts
- `OxDNANucleotides.js` — four instanced meshes (backbone sphere, nucleoside ellipsoid, connector cylinder, backbone connector cylinder); raycasts backbone mesh for click/double-click selection; separate lightweight selection effect updates only backbone sphere colors
- `ClusteringPane.js` — DBSCAN clustering UI with histogram; visibility comes from `uiStore.showClusteringPane` (no local flag — a second one desynced from the toolbar toggle). The body is one scroll region (`.clustering-body`); scrolling each section separately clipped the last row of whichever ran long. Histogram bars hold a minimum width and the row scrolls horizontally rather than compressing — binning would break the click interaction, which selects clusters of one exact size
- `ColorSchemeSelector.js` — 6 color schemes, persisted to `localStorage`; menu opens upward because the control bar is pinned to the bottom of the viewport
- `DraggablePanel.js` — clamps to the viewport on drag and on resize (a panel can never be stranded off-screen), persists position per `storageId` in `localStorage`, supports touch and arrow-key nudging
- `utils/fileTypeDetector.js` — content-based file format detection

### File Format Support

| Format | Files | Detection |
|--------|-------|-----------|
| oxDNA nucleotide | `.top` | 2-token header + 2nd line has nucleotide letter (A/T/G/C/U) as token[1] |
| Lorenzo topology | `.top` | `<count> <type_count>` 2-token header |
| Flavio topology | `*particles*.txt` + `*.patch.txt` | companion files (name-flexible) |
| Raspberry topology | `.top` | `iP`/`iR`/`iC` keywords in file |
| SRS Springs topology | `.psp` | 4-integer header + `iS` keyword in file |
| MGL (self-contained) | `.mgl` | `@` separator + optional `.Box:` header |
| Trajectory | `.dat`, `.traj`, `.conf` | content keywords |
| MGL Trajectory | `.mgl` with `.Box:` | multi-frame `.Box:` headers |
| Clusters | `.json` | `clusters` array, or entries with `particles`/`indices`/`ids` |

File type priority: `traj > last > init > conf`

Detection order in `analyzeTopologyFile`: SRS Springs → (2-token header check) → Raspberry → **oxDNA nucleotide** → Flavio → Lorenzo. Format extraction uses `type.split('-').slice(1).join('_')` so `topology-oxdna_nucleotide` → format `oxdna_nucleotide`.

### oxDNA Nucleotide Format (standard `.top`)
```
<N> <nStrands>
<strandId> <base> <n3> <n5>   # one line per nucleotide; n3/n5 index = -1 at chain ends
```
- Parsed by `parseOxDNANucleotideTopology` in `topologyParser.js`
- Returns `nucleotides: [{index, strandId, base, n3, n5}]` and `format: 'oxdna_nucleotide'`
- `particleTypeMapping` assigns one `typeIndex` per strand (for color cycling)
- `ParticleScene` checks `topData?.nucleotides?.length` and renders `OxDNANucleotides` instead of `Particles`

#### OxDNANucleotides geometry (matches oxdna-viewer)
All positions computed from trajectory `a1`/`a3` vectors:
- `a2 = (a3 × a1).normalize()`
- **Backbone**: `bb = p + (−0.34·a1 + 0.3408·a2)`, sphere r=0.2
- **Nucleoside**: `ns = p + 0.34·a1`, sphere r=0.3 scaled `[0.7, 0.3, 0.7]`, rotated Y→a3
- **Connector** (ns↔bb): center=`(bb+ns)/2`, Y→`(bb−ns)`, height=0.8147053, cylinder r=0.1
- **Backbone connector** (bb→n3 bb): center=`(bb+bbN3)/2`, Y→`(bbN3−bb)`, height=`|bbN3−bb|`, tapered cylinder r=0.1→0.02; hidden if length ≥ 0.9×any box dimension
- Strand colors capped at 4 (`% Math.min(4, strandColors.length)`)
- Base colors: A=`0x4747B8`, G=`0xFFFF33`, C=`0x8CFF8C`, T/U=`0xFF3333`
- Uses `setColorAt` (THREE.js native, r130+) — no custom shader needed

#### Selection in OxDNANucleotides
- Click handler on backbone `InstancedMesh` via `gl.domElement` native listener
- `instanceId` from raycast = nucleotide index into `positions` store
- Ctrl/Cmd+click for multi-selection; miss clears selection
- Separate lightweight `useEffect` (depends on `selectedParticles`) updates only backbone sphere colors: selected → yellow, others → strand color
- Double-click calls `onParticleDoubleClick` for camera zoom animation

### Raspberry Format (self-contained `.top`)
```
<N> <type_count>
# comments ignored
iP <id> <strength> <color> <x,y,z> <a1x,a1y,a1z>   # patch definition
iR <x,y,z> <radius>                                  # repulsion site (IDs by order)
iC <type_id> <count> <patch_ids> <repulsion_ids>     # particle type; -1 in either list means "none"
```
- Uses standard oxDNA trajectory (`.dat`) alongside
- Parsed by `parseRaspberryTopology` in `topologyParser.js`
- Inner sphere (center particle) scaled to zero — invisible
- Outer beads rendered as `RepulsionSites` instanced spheres (yellow when selected)
- **Each particle type uses only the `iR` sites named in the last field of its `iC` line**, indexed by the order the `iR` lines appear. Types can therefore have different bead counts (e.g. `iC 0 128 0,1,2,3 0` → one bead; `iC 2 512 8,9 1,2,3` → three beads). Out-of-range ids are dropped; `-1` means no beads (the plain sphere renders instead); an entirely absent field falls back to the full `iR` set
- All raycasting for bead selection is handled by `Particles.js` via `registerRepulsionMesh` callback

#### Selection architecture for raspberry particles
`RepulsionSites` registers `{mesh, numBeads, globalIndices, particlePositionsRef}` with `Particles.js` via `onRegister(typeIndex, data)`. The unified click handler in `Particles.js` first checks the main `InstancedMesh` (skipping particles that `hasRepulsionSites=true`), then iterates `repulsionMeshDataRef.current` to check bead meshes. This avoids the race condition of two separate native DOM click listeners.

`particlePositionsRef` is a React ref (not a value): it is initialized once on registration and kept up-to-date by the transform effect each frame without triggering a re-registration. `Particles.js` reads `data.particlePositionsRef.current[localIndex]` at double-click time.

### SRS Springs Format (Bullview `.psp`)
```
<numParticles> <numStrands> <maxSpringsPerParticle> <repeatedPatchesPerParticle>
# iP = iP, id, color, strength, x y z
iP <id> <color> <strength> <x> <y> <z>
# iS = iS, id, k, r0, x y z
iS <id> <k> <r0> <x> <y> <z>
# Body: particleType strand radius mass numPatches [patchId...] [neighborIdx springIdx]...
<particleType> <strand> <radius> <mass> <numPatches> [patchIds...] [neighborIdx springIdx]...
```
- Parsed by `parseSRSSpringsTopology` in `topologyParser.js`
- `strand` field → `typeIndex` (mapped via `strandToTypeIndex`)
- Returns `particleTypeMapping` (per-particle patch assignments), `particleTypes` (per-strand summary), `springConnections` (deduplicated by `min(p1,p2)-max(p1,p2)` key), and `srsParticleRadius`
- `App.js` sets `particleRadius` from `srsParticleRadius` after parsing
- Springs rendered by `Springs.js` as gray cylinders; springs longer than `min(box)/2` are hidden
- Patches assigned per-particle from body line; `particlesByType` uses first particle's type as representative per strand

### Flavio Companion File Lookup (`parseFlavioTopology`)
`parseFlavioTopology(content, fileMap, options)` resolves the particles and patches files with a multi-step fallback:

**Particles file** (in priority order):
1. `options.particleFile` — exact name from `particle_file` field in a loaded oxDNA input file
2. `"particles.txt"` — hardcoded fallback
3. Any file in `fileMap` whose name matches `/particles.*\.txt$/i` (e.g. `CRYSTAL.particles (1).txt`)

**Patches file** (in priority order):
1. `options.patchFile` — exact name from `patchy_file` field in a loaded oxDNA input file
2. `"patches.txt"` — hardcoded fallback
3. Any file in `fileMap` whose name ends with `.patch.txt` (e.g. `sat3.patch.txt`)

`options` is populated in `App.js` from a parsed oxDNA input file (`particle_file` / `patchy_file` keys). If no input file is present, `options` is `{}` and the fallbacks apply. `parseTopFile` accepts a 4th `options` argument and forwards it to `parseFlavioTopology`.

**`PATCHY_radius` from input file**: parsed in `App.js` before topology loading and applied via `setParticleRadius`. For Flavio format, `srsParticleRadius` is never set, so the input-file value is preserved.

### Patch Rendering (`Patches.js`)
- Cone tip placed at particle surface, base flares **outward** (away from center)
- Cone geometry translated so tip = origin; rotated so +Y aligns with inward direction
- `coneRadius = particleRadius * 0.4`, `coneHeight = particleRadius * 0.8` — proportional, format-agnostic
- Scale factor: **always** `particleRadius / patchVectorLength` — normalises the patch direction vector to exactly `particleRadius` length, placing the tip on the sphere surface. Works for all formats: unit vectors (Lorenzo, ~1.0), sub-unit Flavio positions (~0.47), and larger absolute-position values. Degenerate vectors (< 1e-9) are skipped.
- `particleRadius` is in dependency arrays of both `useEffect` and `useMemo`
- Patches render as a single `InstancedMesh`

### Springs Rendering (`Springs.js`)
- Unit `CylinderGeometry(1,1,1,8)` scaled per instance: `scale = (springRadius, distance, springRadius)` where `springRadius = particleRadius * 0.15`
- Cylinder oriented with `setFromUnitVectors(up, dir)` between particle positions
- All skipped instances (degenerate, out-of-range, or too-long) get explicit `makeScale(0,0,0)` matrix to prevent ghost cylinders at origin and stale matrices during translation

## Rendering architecture

Renderers used to be independent: each drew its own instanced meshes, attached
its own canvas listeners, and opted into whichever cross-cutting features its
author needed. The result was a ragged feature matrix — oxDNA nucleotides could
not be cluster-highlighted, springs ignored selection *and* clustering, and
`Patches` never requested a redraw at all. Those are now structural
impossibilities rather than things to remember.

### `src/rendering/InstancedLayer.js`
One `InstancedMesh` and all the bookkeeping around it. A renderer supplies a
`write(i, dummy, setColor)` callback that fills one instance and returns `false`
to hide it; the layer owns matrix writes, `needsUpdate`, zero-scaling hidden
instances, and the `invalidate()` that demand-mode rendering requires.

Two traps are encoded here so no renderer can hit them again:
- **Never guard on `instanceColor` being null.** Changing `geometry` changes the
  mesh's `args`, so r3f rebuilds it, and a fresh `InstancedMesh` always starts
  with `instanceColor === null`. `setColorAt` allocates it. Bailing out instead
  leaves instances rendering as bare white material — which twice shipped as
  "particles turn white", once for spheres and once for raspberry beads.
- **Always `invalidate()`.** `frameloop="demand"` means buffer updates are
  invisible until something requests a frame.

`geometry` is part of the layer's dependency list, so a geometry change
repopulates both matrices *and* colours.

### `src/rendering/pickingService.js`
One raycaster and one pair of canvas listeners for the whole scene, provided by
`PickingProvider` in `ParticleScene`. Layers call `useRegisterPickable(id, {
meshRef, resolveIndex })`; `resolveIndex` maps an instanceId to a particle index
and returns `null` for instances the layer is not currently drawing, so a hidden
particle cannot swallow a click. Which mesh wins is decided by ray distance
rather than by which component attached its listener first.

Selection and camera framing live in `ParticleScene`, not in renderers. Framing
needs only an index — the position comes from the store — which removed the
per-layer position bookkeeping the old code carried.

### `src/formats/registry.js`
Every supported topology format in one table: `id`, `parse`, `matches` (which
recognises already-parsed topology so `rendererFor` can pick a renderer),
`renderer`, and an optional `onLoad` for format-specific store setup. This
replaced an if-chain in `parseTopFile` (now deleted) and an `isOxDNA` boolean in
`ParticleScene`.

### Adding a format
Add a parser, then one entry in `FORMATS`, then detection in
`utils/fileTypeDetector.js`. Do not add branches to `ParticleScene` or `App.js`.

## UI architecture

### Defaults (`uiStore.js`)
The scene background starts **light** (`LIGHT_BACKGROUND`), and the entry screen and loading
cover follow it via the `--light-*` tokens (the floating panels stay dark glass). `showBackdropPlanes` and
`showCoordinateAxis` start **on**; the simulation box, legends, clustering pane and FPS overlay
start off.

### Lighting is built for a data viewer, not a render (`lighting.js`)
Particle, patch and base colours carry meaning, so the rig reports them faithfully rather than
flattering them:

- **Every light is neutral white.** A warm fill or cool rim shifts every colour in the scene and
  makes two particle types read as more alike, or less alike, than they are. Depth comes from
  occlusion and key-light direction, never from colour temperature. Do not reintroduce a tint.
- **Tone mapping is `THREE.NeutralToneMapping`** (Khronos PBR Neutral) at exposure 1.0. It leaves
  midtone hue and saturation alone and only compresses highlights. ACES Filmic — the usual
  default, and what this used before — desaturates as it rolls off, quietly misreporting colour.
- Presets are named for what they are *for* (Depth, Publication, Studio, Relief, Flat), not for
  photographic moods. `Depth` is the default and is listed first — the chip row renders in key
  order. `Flat` is the only one with occlusion off.
- **Background is deliberately not part of a preset.** A preset is the light rig; the background
  is a separate viewing choice, and folding it in would mean the preset chip lied every time the
  background was toggled. It lives in `uiStore.sceneBackground` with its own storage key.
- Light/dark state is **derived** from the background colour's luminance (`isDarkBackground`),
  not tracked by a second boolean — so a colour picked from the panel's colour well still shows
  the right icon in the corner toggle.
- Storage keys are versioned (`..._v2`). The v1 rig used tinted lights and a dark scene, so a
  saved blob would otherwise keep overriding the new defaults.

Backdrop planes and the simulation box derive their colour from the background, and the
coordinate axes swap to brightened variants on a dark background (the documented dark oxDNA
triad is near-invisible there). The planes are matte and partly transparent on purpose: a lit
surface can never reach the brightness of a light background, and an opaque glossy one reads as
a slab of material competing with the particles.

### Design tokens (`src/styles/tokens.css`)
Every panel color, radius, space and font comes from a token. Components must not
re-declare `rgba(20,20,20,0.85)` and friends. Key conventions:

- `--accent` (blue) means **one** thing: a control is on, or it is the playhead. Never decoration.
- `.num` (monospace + `tabular-nums`) on every numeric readout, so scrubbing never reflows a row.
- `.pp-panel` is the shared floating-panel shell; `src/styles/panels.css` holds the shared
  header/body/section/control-row chrome for the floating tool panels.

### Control bar (`App.js`)
Three rows: transport + readout, the scrubber, then display options. Toggles are grouped by
what they affect (Scene · Legends · Tools), separated by hairlines rather than by spacing.

Keyboard: `Space` play/pause, `←`/`→` step frame (`Shift` for 10), `Home`/`End` jump to ends,
`P` screenshot, `Q/A W/S E/D` shift on X/Y/Z. The handler ignores events whose target is an
`input`, `textarea`, `select` or contenteditable, so typing in a panel does not move particles.

All frame changes go through `goToFrame()` — it clamps and triggers the redraw. Do not call
`setCurrentConfigIndex` directly from a new control.

## Wiring rules (things that have silently broken before)

**Every store value that a control writes must have a consumer.** Lighting, the simulation-box
flag and the FPS overlay all previously had UI that wrote state nothing read. When adding a
setting, verify the consumer end-to-end in the running app, not just that the control moves.

- **Lighting**: `ParticleScene.js#SceneLighting` drives *all* lights, `<Environment>` and SSAO
  from `uiStore.lightingSettings`. Hardcoding any value there silently disconnects the matching
  control in `LightingControlsModal`. Because `frameloop="demand"`, `SceneLighting` calls
  `invalidate()` whenever settings change, or sliders appear to do nothing.
- **`getLightingSettings()`** merges the stored blob over the default preset, so a setting added
  after that blob was written still has a value (a missing intensity reads as an unlit scene).
- **`<Stats />` only takes a class if you pass one** (`className="r3f-stats"`), otherwise the
  `.r3f-stats` CSS rule matches nothing.

### Never bail out when `instanceColor` is null
Changing `geometry` changes an `<instancedMesh>`'s `args`, so r3f **rebuilds the mesh** — and a
fresh `InstancedMesh` has `instanceColor === null`. `Particles.js` used to guard its colour
effects with `if (!mesh.instanceColor) return`, which meant every Detail change left the
particles the bare material white until some later event happened to re-run the effect (rotating
the camera looked like it "fixed" it). `setColorAt` allocates the buffer on first call and three
recompiles the material when the attribute appears, so there is nothing to guard against. Guard
only the write-back: `if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true`.

The same applies to the length check that was there: `instanceColor.count` is the instance
*capacity*, not the number of particles being drawn, so comparing it against a smaller loop
bound also bailed for no reason.

### Detail and radius must reach every renderer
`sphereSegments` and `particleRadius` are scene-wide, so a renderer that hardcodes its own
resolution or size silently opts out of the control:

- `sphereSegments` drives particle spheres, patch cones (`Patches.js`), spring cylinders
  (`Springs.js`), repulsion beads and all four nucleotide meshes.
- `particleRadius` drives particle spheres, patch cone size and spring thickness directly.
  Renderers with intrinsic geometry scale by `particleRadius / DEFAULT_PARTICLE_RADIUS`
  (exported from `particleStore.js`): raspberry beads scale both bead radius and offset, so the
  particle resizes without losing the shape the topology describes; oxDNA nucleotides scale only
  *thicknesses* — the 0.34 / 0.3408 offsets are the oxDNA geometry itself and moving them would
  misreport where a nucleotide sits.

Every one of these effects must also call `invalidate()` — see demand rendering above.

### Ambient occlusion leaves the renderer dirty (`ParticleScene.js`)
`postprocessing`'s `EffectComposer.setRenderer()` sets `renderer.autoClear = false` and never
restores it. r3f shares one renderer across the canvas, so once occlusion has been enabled even
once that flag stays false permanently. While the composer is mounted this is harmless — it
clears its own passes — but the moment occlusion is switched off (the **Minimal** preset) the
composer unmounts, r3f goes back to calling `gl.render()` itself, and with `autoClear` false
nothing clears the canvas: each frame composites onto the last and orbiting smears.

`SceneContent` therefore restores `gl.autoClear = true` whenever `ssaoEnabled` is false. Any
future effect added to the composer inherits the same hazard.

### The per-frame clear (`ParticleScene.js`)
`preserveDrawingBuffer: true` is needed so `captureScreenshot` can read the canvas back after
the frame, but it also stops the browser from ever implicitly clearing the drawing buffer. Any
frame whose renderer does not write every pixel then leaves the previous frame showing through —
this is the smearing seen while orbiting, and a post-processing pass covering a different pixel
area than the canvas (SSAO at a non-1 device pixel ratio) is enough to cause it.

`SceneContent` therefore binds the default framebuffer and clears it before every frame. The
**negative** priority matters twice: r3f sorts subscribers ascending so it runs before the frame
is drawn, and r3f only hands rendering over to a subscriber whose priority is `> 0`, so it does
not disable r3f's own render. Do not change that priority to 0 or above. `setRenderTarget(null)`
first is deliberate — a stale render target left bound would otherwise swallow the clear.

## oxDNA Specifics

- Trajectory positions have `{x, y, z, a1: {x,y,z}, a3: {x,y,z}}` — orientation vectors come from `parseConfiguration` in `trajectoryLoader.js`
- Standard oxDNA topology (nucleotide format) triggers `OxDNANucleotides` rendering; patchy-particle topologies (Lorenzo/Flavio/Raspberry/SRS) use `Particles` rendering
- Patches for patchy particles are in local coordinates, transformed by particle rotation matrix
- Periodic boundary conditions with automatic CoM centering
- Patches rendered as outward-pointing cones (tip on surface, base outside)

## Visual regression tests (`visual-tests/`)

Headless Chrome drives the real app over CDP: 6 fixtures (one per format, each
laid out as 5 DBSCAN-separable blobs) x 5 scenarios (load, detail/radius,
clustering, selection, appearance). It records pixel-bucket counts rather than
image hashes, so it tolerates antialiasing jitter but moves decisively when
geometry appears, vanishes, resizes or loses its colour.

- `edges` counts horizontal gradient: colour buckets cannot see white geometry
  against a light background, which is exactly how the invisible-bead bug hid.
- The `selection` scenario enlarges particles first. Only some elements are
  clickable — an oxDNA backbone sphere is r=0.2 in a 60-unit box, roughly 4px —
  so at default size it would measure marksmanship, not correctness. It also
  settles after each click, because React commits selection asynchronously.
- Stop any dev server on the port first; the runner refuses to run against one it
  did not start, since that may be a different build.
- **It runs serially, and should stay that way.** Parallel tabs look like an easy
  win — scenarios are independent and the suite looks like it is mostly waiting —
  but every worker shares one software rasteriser. Three workers took the same
  244s as one while stalling four scenarios past the CDP timeout on every run.
  Serial finishes all 30 in ~260s with no failures. `--workers=N` is still there
  for a machine with a real GPU.
- `settle()` must not await `requestAnimationFrame`: it never fires in a
  background tab, which is a trap if anyone re-enables workers.

## Performance Patterns

- **Instanced rendering**: `THREE.InstancedMesh` for particles, patches, repulsion site beads, springs, and all four nucleotide mesh types
- **Zero-scale hidden instances**: skipped instances use `makeScale(0,0,0)` matrix instead of `continue` to avoid ghost geometry
- **Demand rendering**: `frameloop="demand"` on Canvas. Components that update Three.js buffers (`Particles.js`, `OxDNANucleotides.js`) must call `invalidate()` from `useThree()` at the end of their position effects — otherwise the canvas does not redraw after trajectory frame changes.
- **Memoized clustering**: only recomputes when epsilon/minPoints change

### In-place GPU buffer updates (no VRAM leak)
`mesh.instanceColor = new THREE.InstancedBufferAttribute(...)` replaces the JS object but never frees the old WebGL buffer (`gl.deleteBuffer` is never called, since `WebGLAttributes` uses a WeakMap keyed by the JS object). Over thousands of trajectory frames this grows GPU memory unboundedly.

**Always use `mesh.setColorAt(i, color)` instead.** This auto-initialises `instanceColor` on first call (one allocation) and writes into the existing `Float32Array` on all subsequent calls. After updating all instances, set `mesh.instanceColor.needsUpdate = true`.

### SceneContent render isolation (`ParticleScene.js`)
`SceneContent` is wrapped in `React.memo`. `ParticleScene` does **not** subscribe to `positions` — only to `currentBoxSize` and `topData`. Particle/nucleotide components subscribe to `positions` directly from the Zustand store.

This means a trajectory frame update only re-renders `Particles.js` (or `OxDNANucleotides.js`) and their children — **not** the lights, OrbitControls, simulation box, backdrop planes, or SSAO. Before this pattern, every frame change caused the entire Canvas subtree to reconcile.

### Stable `currentBoxSize` identity (`particleStore.js`)
`setCurrentBoxSize` is a no-op when the new values are identical to the current ones (numeric comparison, not reference). `parseConfiguration` creates a new array on every frame; without this guard, `currentBoxSize` would be a new reference every frame, causing `ParticleScene` (and `SceneContent` via props) to re-render even for constant-box trajectories.

### Stable `typeColor` prop (`Particles.js`)
`stableTypeColors` is a `useMemo` array of `THREE.Color` objects indexed by type, recomputed only when `particleColors` changes (i.e. on color-scheme change). The render body uses `stableTypeColors[typeIndex % length]` instead of `new THREE.Color(hex)`. This keeps `typeColor` prop reference-stable across frames, so `RepulsionSites`' and `Patches`' color effects only fire when the color actually changes.

### Object reuse in hot effects
- `RepulsionSites` transform effect: single `localPos = new THREE.Vector3()` and `rotMat = new THREE.Matrix3()` created once per effect call, reused across all particle/bead iterations via `.set()` / `.fromArray()`.
- `buildTrajIndex`: uses `line.length + 1` (ASCII trajectory files) instead of `new TextEncoder().encode(line + "\n").length` — eliminates one `TextEncoder` allocation per line.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `←` / `→` | Step one frame (`Shift` for 10) |
| `Home` / `End` | First / last frame |
| `P` | Screenshot |
| `Q/A` | Shift particles on X-axis |
| `W/S` | Shift particles on Y-axis |
| `E/D` | Shift particles on Z-axis |

Ignored while a form field has focus.

## Loading a second simulation

`FileDropZone` unmounts once the first files land, so `FileDropOverlay` takes
over: it listens on the window and reveals a drop target only while files are
actually being dragged, which keeps it out of the way of the scene. It is
enabled whenever `filesDropped && isDragDropEnabled`, so it is active during a
load too, and disabled in iframe mode along with the rest of drag-and-drop.

Two things a second load has to get right:

- **Per-scene state is reset first.** `selectedParticles` and
  `highlightedClusters` are particle *indices*; carrying them into a different
  structure highlights unrelated particles or indexes past the end.
- **`loadTokenRef` guards against a stale load finishing last.** Dropping a
  second simulation while the first is still reading would otherwise let the
  slower one overwrite the newer scene. Every `await` in `handleFilesReceived`
  that precedes a store write is followed by an `isStale()` check — add one to
  any new await in that path.

## Iframe Embedding

PPView detects iframe mode (`window.self !== window.top`) and hides controls. Supports `postMessage` interface:

- `drop` — load `File[]`
- `download` — trigger screenshot + GLTF export
- `remove-event` — disable drag-drop
- `iframe_drop` — load files with `view_settings` object (`Box`, `Controls`, `PatchLegend`, `ParticleLegend`, `ClusteringPane`, etc.)

## Adding Features

**New file format**: add the parser in `topologyParser.js`, one entry in
`src/formats/registry.js`, detection in `utils/fileTypeDetector.js`
(`analyzeTopologyFile` — note the detection order above) and the `categorizeFiles`
switch. Format-specific store setup goes in the entry's `onLoad`, not in `App.js`.

**New visual element**: render an `InstancedLayer` with a `write` callback. Call
`useRegisterPickable` if it should be clickable, and run its colour and scale
through `getClusterAppearance` so selection and clustering apply to it without
extra wiring.

**New analysis feature**: create component in `src/components/`, add state to appropriate store, integrate with `ParticleScene`, add to GLTF export if needed.

**New color scheme**: add entry to `src/colors.js#colorSchemes` with `{ name, colors: ['#hex', ...] }`.

## Color Assignment

```
particle color = scheme.colors[typeIndex % scheme.colors.length]
patch color    = scheme.colors[patchID   % scheme.colors.length]
```

Stored in `localStorage` under key `ppview_color_scheme`.

## Cluster Visualization States

| State | Color | Scale |
|-------|-------|-------|
| Normal | type-based | 1.0× |
| Highlighted cluster | type-based | 1.3× |
| Not in a selected cluster | — | 0 (hidden) |
| Selected particle | yellow | — |

*Show only selected clusters* hides the rest outright (zero scale, the pattern used everywhere
else in this codebase) — which is what the control's name promises.

A second checkbox, **Keep the rest as faint markers** (`clusteringStore.dimNonSelectedClusters`,
off by default), brings them back as one small grey sphere each at `CLUSTER_DIMMED_SCALE`. It is
only offered while *Show only selected clusters* is on, since it means nothing otherwise. Dense
systems cluster into a single blob — the example raspberry file is 768 particles in a 15.7 box
and DBSCAN returns exactly one cluster — so hiding everything leaves an empty scene, and the
markers are how you keep your bearings.

**A dimmed raspberry particle is drawn by its centre sphere, not its beads.** `Particles.js`
normally scales that sphere to zero for raspberry types and lets `RepulsionSites` do the drawing;
the dimmed marker is the one exception, because one sphere at the particle's centre reads far
better than a swarm of shrunken beads. `RepulsionSites` collapses its beads whenever the particle
is `hidden` *or* `dimmed` so the two never draw at once.

### Cluster colours
Each cluster gets its own colour, cycling the active scheme's palette, and each
row in the pane has a swatch that overrides it. Highlighting previously kept
every particle's *type* colour, which made two adjacent clusters
indistinguishable — usually the exact thing you are trying to see.

The colours reach the renderers as `clusteringStore.clusterColors`, a
`Map<particleIndex, '#rrggbb'>`. Per particle rather than per cluster because
that is how renderers consume it: each walks its instances and needs a colour
for a given particle without knowing which cluster it came from.
`clusterColorFor()` caches the hex→`THREE.Color` conversion, since these are
written per instance per update.

### Clusters from a file
Clusters computed elsewhere can be used instead of running DBSCAN
(`utils/clusterFile.js`), either from the pane's **Load clusters from file**
button or by dropping the `.json` alongside the simulation at startup.

The co-drop path has one ordering constraint: parsing validates every index
against the particle count, which does not exist until the first frame has
loaded. `App` therefore holds the file's *text* in `pendingClusterText` and
applies it in an effect once `positions.length > 0` — applying it earlier would
make every index look out of range. It then opens the clustering pane, so the
colours do not appear with no visible explanation.

Selection lives in `ClusteringPane`'s local state, so it adopts clusters set
from outside via an effect keyed on the `fileClusters` identity. Keying on
identity rather than a boolean matters: re-selecting on every render would fight
manual changes.

Detection is by content (`isClusterFile`), not the `.json` extension alone, so
an unrelated JSON file dropped with a simulation is not mistaken for clustering. While a file is loaded the DBSCAN controls are
disabled, because they cannot change clusters that came from a file.

```json
{ "clusters": [ { "name": "Core", "color": "#e7298a", "particles": [0, 1, 2] } ] }
```

A bare array works too, and the particle list may be `particles`, `indices` or
`ids` — analysis scripts in this space spell it all three ways. `color` is
optional and falls back to the palette. A malformed entry is skipped with a
warning rather than failing the whole file, but a cluster with any *invalid*
index is rejected outright: silently dropping one would misreport its membership.
Indices past the end of the current system are reported, since that usually
means the file belongs to a different trajectory.

**`utils/clusterAppearance.js` is the single source of these rules.** Three renderers draw parts
of the same patchy particle — the sphere (`Particles.js`), the raspberry repulsion beads
(`RepulsionSites.js`) and the patch cones (`Patches.js`) — and each used to decide appearance for
itself, so raspberry particles ignored clustering entirely and patches were removed by a separate
filter rather than following their particle. All three now call `getClusterAppearance`, which returns a colour and a scale **factor**
to apply on top of whatever base size the renderer already uses. Returning a factor is what lets
a sphere radius, a bead offset and a cone share one rule.

- Raspberry beads scale offset and radius together, so a highlighted particle grows as a whole
  and a hidden one collapses to nothing, instead of its beads drifting apart.
- Patches pass `allowSelectionColor: false`: a patch's colour encodes its patch ID, so it keeps
  that colour when the particle is selected, while still following the scale factor — so they
  grow with a highlighted particle and vanish with a hidden one.
- `Patches` receives `globalIndices` to look up cluster membership. It previously matched
  particles by comparing floating-point coordinates with `positions.findIndex`, once per
  particle.

Note: `ClusteringPane` only populates `highlightedClusters` while *Show only selected clusters*
is on, so the 1.3× highlight state never appears on its own — selecting a cluster with that box
unchecked currently has no visual effect.

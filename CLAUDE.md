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
| MGL (self-contained) | `.mgl` | `@` separator, **no** `.Box:` header |
| Trajectory | `.dat`, `.traj`, `.conf` | content keywords |
| MGL Trajectory | `.mgl` with `.Box:` | **any** `.Box:` header, even one |
| Clusters | `.json` | `clusters` array, or entries with `particles`/`indices`/`ids` |
| Cluster/bond observable | `.txt`, `.dat` | `n -> (…)` arrows, a `# step n N n` header, or `((i p), (j p))` tuples |
| Observables definition | `.json` | JSON with `cols` or `print_every`, and no particle list |

File type priority: `traj > last > init > conf`

The two MGL predicates are mutually exclusive by construction: `isMGLFile`
returns false as soon as a `.Box:`/`.Vol:` header appears, and
`isMGLTrajectoryFile` requires one. `detectFileType` tests the trajectory first,
so an overlap makes `isMGLFile` unreachable — which it was, until
`isMGLTrajectoryFile` stopped also matching `hasMGLContent && count >= 0` (true
for any count). A single header is enough; a one-frame trajectory is still a
trajectory.

Cluster/bond observables are tested **before** trajectories: they arrive as
`.txt` or `.dat`, and the trajectory fallback claims any `.dat` by name.

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

### Impostors are per renderer, not per app (`src/rendering/impostors.js`)
Each mesh opts in separately, and three shapes are involved:

| mesh | representation | radius comes from |
|---|---|---|
| `Particles` spheres | sphere impostor | `uParticleRadius`, geometry was `SphereGeometry(particleRadius)` |
| `RepulsionSites` beads | sphere impostor | the **instance scale**; the multiplier is 1 |
| `OxDNANucleotides` backbone | sphere impostor | `0.2 * radiusScale` |
| `OxDNANucleotides` nucleoside | **ellipsoid** impostor | `0.3 * radiusScale`, scale/rotation from the instance matrix |
| patch cones, springs, nucleotide cylinders | real geometry | — |

**The threshold counts what is drawn, not what is loaded.** `RepulsionSites`
passes `totalBeads`, because a raspberry particle is several beads: a system well
under 50,000 by particles can be well over it by spheres. Counting particles left
the format that draws the most geometry per particle as the last to get impostors.

**A nucleoside is an ellipsoid, so it needs a different shader.** The sphere
impostor reads its answer off the quad, because a sphere's silhouette is always a
circle. An ellipsoid's depends on its orientation, so
`makeEllipsoidImpostorMaterial` intersects the view ray with the quadric instead:
`mat3(modelViewMatrix * instanceMatrix) * uRadius` maps a unit sphere onto the
ellipsoid in view space, and inverting it turns ray-ellipsoid intersection back
into a quadratic. This matters because a nucleotide draws four meshes and at 16
segments the two spheres are 1024 of its ~1150 triangles — impostoring only the
backbone would leave half the cost behind.

**The proxy is a solid, not a billboard, and that is what the occlusion pass
sees.** `EffectComposer` runs with `enableNormalPass`, and that pass draws every
object with an override material — so the billboarding, which lived in the
patched vertex shader, did not happen there. Impostor quads were rendered flat
and unbillboarded, edge-on from most angles and all but absent from the normal
buffer, and SSAO reading normals that are not there speckled every impostor
surface (measured: `edges` 2164 against 1614 for the same structure as real
geometry).

Removing the `gl_FragDepth` write was tried first and changed nothing (2101), which
is what ruled the depth out and pointed at the normals. Drawing an icosahedron
where the shape actually is fixed it: 1575, against 1614 for real geometry — the
impostor is now marginally *smoother*, because it is analytically round where the
real sphere is faceted.

### Occlusion is scaled by zoom (`ParticleScene.js#AdaptiveSSAO`)
Screen-space occlusion is not scale-invariant. Its kernel is a fraction of the
*screen*, so moving the camera closer leaves it covering the same slice of screen
but a much smaller slice of the structure: it stops averaging over a couple of
dozen particles and starts resolving the gaps between four or five. Crevices
deepen and evenly lit surfaces grow dark patches that say nothing about the
structure and everything about where the camera is. Measured on a 2744-particle
lattice, occlusion in a fixed central window grew **12.6x** over a 2.5x zoom.

**`SSAOEffect.radius` looks like the fix and is inert here.** It is documented as
the occlusion sampling radius, so holding it constant in world terms should make
the effect scale-invariant. Forcing it across its whole useful range, 0.05 to 0.9,
moves the measured occlusion from 12.67 to 12.60 — nothing, at either framing.
Whatever that setting reaches, it is not the image, and it is also a `#define`, so
driving it recompiles the shader. `intensity` is a uniform and demonstrably does
reach the image, so the compensation goes there.

**The exponent is measured, not derived.** Occlusion grows about as the cube of
the linear zoom, so strength is reduced by the cube of the distance ratio,
calibrated against the first frame's distance. That flattens the same sweep to
1.01 / 1.20 / 1.28 / 0.72. It is a fit to one dense scene rather than a law, which
is why `SSAO_ZOOM_EXPONENT` is a named constant.

Reduce only, never boost: zooming out fades occlusion too, but compensating that
way would push the effect past the strength the preset asks for.

**The visual suite cannot see any of this.** Its fixtures are 40 well-separated
particles, where moving the occlusion slider from 0 to 30 changes mean luminance
by 0.25 of a point — there is nothing to occlude. The measurements above came from
a throwaway 14x14x14 lattice at 1.05 spacing in a 30 box; regenerate one to check
this again.

### Instance matrices and the cached bounding sphere
`InstancedLayer` sets `mesh.boundingSphere = null` after every matrix write.
THREE's `InstancedMesh.raycast` tests the ray against `boundingSphere` first and
computes it **only when it is null** — once, and then never again. Every write
moves instances, so without this the picker keeps testing against wherever the
geometry was the first time anyone clicked: click a particle, enlarge the
particles, and clicking selects nothing.

Raspberry beads show it first because their *offsets* scale with the radius, so
enlarging particles moves every bead outside the stale sphere, while plain
spheres — whose centres do not move — carry on working.

Nulled rather than recomputed: `computeBoundingSphere` walks every instance, which
is not something to do per frame at a million particles. This defers it to the
next raycast, where it costs one pass per click.

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

### Particle size comes from the files (`particleStore.js`)
`particleRadius` is the current size; `baseParticleRadius` is the size the loaded
files established — `PATCHY_radius` from an oxDNA input file, or the radius an SRS
topology carries. `setFormatParticleRadius` sets both, `setParticleRadius` only
the first (that is the control), and `resetParticleRadius` returns both to the
default so a new structure cannot inherit the last one's baseline.

Renderers with intrinsic geometry (oxDNA nucleotides, raspberry beads) scale by
`particleRadius / baseParticleRadius`, so the ratio is exactly **1** at load and
every size is the one the files specify, while the radius control still moves
them together with the plain spheres. Scaling by `DEFAULT_PARTICLE_RADIUS`
instead double-counted the file's own radius: a `PATCHY_radius` of 2.5 blew beads
and nucleotides up five-fold before anyone touched a control.

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

The camera does **not** coast: `OrbitControls` has `enableDamping={false}`.
Damping keeps applying the last rotation for a few frames after release, so the
view overshoots where it was let go — in a viewer whose job is reading positions
off a structure, lining up a projection becomes a series of corrections rather
than one movement. Under `frameloop="demand"` each coasting frame is also a full
redraw, which at a million particles is a real cost for decoration.

Keyboard: `Space` play/pause, `←`/`→` step frame (`Shift` for 10), `Home`/`End` jump to ends,
`P` screenshot, `Q/A W/S E/D` shift on X/Y/Z. The handler ignores events whose target is an
`input`, `textarea`, `select` or contenteditable, so typing in a panel does not move particles.

All frame changes go through `goToFrame()` in `store/commands.js` — it clamps and triggers the
redraw. Do not call `setCurrentConfigIndex` directly from a new control. It lives in `commands`
rather than `usePlayback` because it spans two stores (the frame is the particle store's, the
renderer handle the UI store's), and a caller outside `App` — the time view's click-to-seek —
cannot reach that hook's arguments.

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

Headless Chrome drives the real app over CDP: 7 fixtures (one per format, each
laid out as 5 DBSCAN-separable blobs, plus the impostor path as a `?impostors=1`
override) x 8 scenarios (load, playback, detail/radius, clustering,
clusterControls, selection, appearance, overlays). It records pixel-bucket counts
rather than image hashes, so it tolerates antialiasing jitter but moves decisively
when geometry appears, vanishes, resizes or loses its colour.

**Not every scenario runs against every fixture** — `SCENARIO_FORMATS` in
`scenarios.js` says which, and is the suite's coverage argument in one table.
34 jobs, ~230s; the full cross-product would be 90.

Three of the nine fixtures exist only to exercise a shader: `impostor`,
`impostor-oxdna` and `impostor-raspberry` load ordinary files with `?impostors=1`,
because the threshold is 50,000 particles and every fixture here is 40 — without
them the impostor shaders would have no coverage at all, and a shader that fails
to compile draws nothing while an ellipsoid solved wrongly still draws something.
They run the scenarios where the *representation* is the subject (load, detail,
selection) and stay out of clustering, where hiding and highlighting happen in the
write callback both representations share.

A page load costs **2.6s before any scenario begins** — Chrome building a
software WebGL context and the app drawing its first frame. Serving the
production build instead of the dev server does not improve it at all (measured:
46.9s vs 47.8s for seven scenarios), so the only way to make the suite cheaper is
to stop paying for the same coverage twice. The per-format claim worth paying for
is that **scene-wide controls reach every renderer**; formats sharing a renderer
set cannot make it twice. `flavio` draws exactly what `lorenzo` draws and `mgl` a
subset of it, so they earn their place by *loading* — a parser and a detection
path each — and run the scenarios where that is the subject. A scenario missing
from the table aborts the run rather than quietly fanning out to all seven.

- `edges` counts horizontal gradient: colour buckets cannot see white geometry
  against a light background, which is exactly how the invisible-bead bug hid.
- `tintR/G/B` are channel means over the *coloured* pixels only — what colour the
  geometry is, as opposed to how much of it there is. Pixel counts cannot tell
  magenta from green, so a regression that dropped cluster colours entirely read
  as no change at all.
- `cx`/`cy` are the centroid of the coloured pixels, in thousandths of the frame.
  Every other measurement is a bucket count, and **a count is blind to a rigid
  translation** — a blob that slides keeps its pixel count, its edge count and its
  colour exactly. Without a centroid, a frame step that advanced the counter while
  drawing the same coordinates read as no change at all.
- **Fixtures drift differently depending on whether the format re-centres.** The
  oxDNA-style fixtures re-centre each frame on its centre of mass, which subtracts
  a uniform drift straight back out, so only the first blob of five drifts. MGL
  frames are *not* re-centred, so there a uniform drift is the one that moves the
  structure across the screen. Getting this backwards produced a `playback`
  failure against a perfectly working app.
- The `playback` scenario is what covers the frame cache: it asserts that a
  revisited frame renders **identically** to the parsed one, which is the one way
  a cache can be wrong that nothing else would notice.
- **Anything that changes the scene must wait for the change, not just for the
  canvas to hold still.** `settle()` samples a lead-in delay then three identical
  frames, but a heavy scene under a software rasteriser can still commit slower
  than that — which recorded a light frame as `darkBackground` in one baseline
  run and a hidden cluster as `clusterRestored` in another, both passing the very
  next run. Steps with a known outcome assert it with `waitFor` instead. A
  baseline recorded mid-transition is worse than a slow suite.
- `dropFiles` waits for actual geometry, not just `.controls-panel`: the canvas
  can be mounted and still showing bare background, and settle() calls that
  stable.
- The `selection` scenario enlarges particles and hides the coordinate axes and
  backdrop planes first. Only some elements are clickable — an oxDNA backbone
  sphere is r=0.2 in a 60-unit box, roughly 4px — and the axes are saturated and
  thick enough to look like solid geometry to a pixel scan while not being
  pickable at all.
- **It asserts; it does not count.** It used to sweep a grid and record how many
  clicks selected something, waiting 10ms after each for React to commit — which
  is not enough, so it recorded `hits: 0`. The baseline held 0 too, so the suite
  reported "no visual change" for eight commits while the only picking coverage
  in it was dead. Counting is what allowed that.
- `pickTargets()` (in the prelude) returns points that sit solidly inside drawn
  geometry: a ray through an antialiased silhouette pixel misses the sphere
  behind it, which makes working picking look broken. Callers try candidates in
  turn, because a lit pixel may belong to something drawn but deliberately not
  pickable (a patch cone, a spring); a real regression fails every candidate.
- That scenario records no pixel signature. Which particle a sweep lands on
  varies between runs and a selected particle is yellow, so any measurement there
  drifts — its assertions are its output.
- **A full `--update` replaces the baseline; `--only --update` merges.** Merging
  on a full run leaves behind jobs that no longer exist — when the scenario table
  shrank, 24 stale entries stayed and every run afterwards reported them as
  `→ undefined`. Worse, a scenario quietly dropped from the table would keep its
  baseline entry and look like it was still being checked.
- **A poisoned renderer is retried in a fresh tab.** Long runs degrade: a page
  reaches a state where the software rasteriser draws nothing, and since a worker
  reuses its tab, the failure cascades — one run lost 14 of 26 scenarios from
  `srs/detail` onwards while every one of them passed alone. `run.js` matches
  "never drew any geometry", discards the tab and retries the job once in a new
  one, so an environment fault is not reported as fourteen regressions.
- `pickTargets()` returns points **spread across the frame**, with a minimum
  separation. Scanning row by row and taking the first twelve lit pixels returned
  twelve *adjacent* pixels of one particle, so a caller "trying each candidate in
  turn" retried the same object twelve times — and when that object was
  unpickable the scenario reported picking as broken.
- Stop any dev server on the port first; the runner refuses to run against one it
  did not start, since that may be a different build.
- **It runs serially, and should stay that way.** Parallel tabs look like an easy
  win — scenarios are independent and the suite looks like it is mostly waiting —
  but every worker shares one software rasteriser. Three workers took the same
  244s as one while stalling four scenarios past the CDP timeout on every run.
  Serial finishes the suite with no failures. `--workers=N` is still there for a
  machine with a real GPU.
- `settle()` must not await `requestAnimationFrame`: it never fires in a
  background tab, which is a trap if anyone re-enables workers.

## The compiled core (`wasm/`, `src/wasm/wasmCore.js`)

Frame parsing, DBSCAN and the cluster/bond observable index are built from Rust
to WebAssembly and are the **default path**. All three are flat loops over bytes
or numbers, which is what WebAssembly is good at:

| | JavaScript | Rust |
|---|---|---|
| parse a 400,000-particle frame | 160 ms | **37 ms** |
| index a 4.79 GB observable | 3,400 ms | **1,900 ms** |
| DBSCAN, 10,000 particles | 252 ms | **14 ms** |
| DBSCAN, 20,000 particles | 981 ms | **44 ms** |
| DBSCAN, 50,000 particles | 6,230 ms | **274 ms** |

Against the *original* clustering — before the grid — 20,000 particles went from
59.8s to 44 ms.

**There is one implementation of each, and it is this one.** There used to be a
JavaScript version alongside, kept as a fallback and as the reference; carrying
both was not worth it — the same algorithms in two languages, kept in step by a
suite that compared them, when one was always the one that ran. What is lost is
graceful degradation: a browser without WebAssembly, or a blocked request, now
means the viewer cannot read a trajectory, so `loadFrame` waits for the module
and says so plainly rather than failing further in.

`src/setupTests.js` instantiates the `.wasm` from disk and injects it, because
jsdom has no `fetch` — so a test of parsing or clustering is a test of the module
the browser runs, not of a stand-in.

**No `wasm-bindgen`.** Everything crossing the boundary is a block of bytes in or
a block of `f32`/`i32` out, so the generated glue would buy nothing and cost a
bundler integration that Create React App cannot be given without ejecting.

`npm run build` and `npm start` rebuild it first (`prebuild`/`prestart`), so it
cannot drift from the crate. `public/wasm/ppview_core.wasm` is **committed**, the
same way `build/` is — the tests read it from there, and it is what gets
deployed. A Rust toolchain is now a requirement for building, not an optional
extra.
`window.__ppviewCore` reports which path is live, and the `load` scenario asserts
it is `wasm` — silence when the module fails to load would mean never noticing.

One measurement worth keeping: the UTF-8 to JS string decode costs **2 ms** of a
21.6 MB frame, not the large share expected, because V8 keeps an ASCII string one
byte per character. Parsing raw bytes in JavaScript was only ~11% faster. The win
is in the scan, which is why it is worth compiling and why byte-level JavaScript
was not.

## Performance Patterns

- **Instanced rendering**: `THREE.InstancedMesh` for particles, patches, repulsion site beads, springs, and all four nucleotide mesh types
- **Zero-scale hidden instances**: skipped instances use `makeScale(0,0,0)` matrix instead of `continue` to avoid ghost geometry
- **Demand rendering**: `frameloop="demand"` on Canvas. Components that update Three.js buffers (`Particles.js`, `OxDNANucleotides.js`) must call `invalidate()` from `useThree()` at the end of their position effects — otherwise the canvas does not redraw after trajectory frame changes.
- **Memoized clustering**: only recomputes when epsilon/minPoints change

### Frames are cached, because scanning the text is the floor (`loading/frameCache.js`)
Reading a frame at 400,000 particles costs 144 ms, of which **117 ms is the text
scan** and only 19 ms is building the particle objects. Three attempts to make the
scanner faster each moved it by less than the measurement noise — 12.9 MB of
characters and 3.6 million numbers per frame is close to the floor.

So the way to play a large trajectory is not to scan faster but to scan once.
`createFrameCache` keeps decoded frames, and `loadFrame` consults it *before* any
file read: a hit skips the read, the scan, the centre of mass and the wrap
(183 ms → 47 ms on revisit). Playback loops, scrubbing goes back and forth and
comparisons flip between two frames, so a hit is the common case after the first
pass.

Two things it must keep doing:
- **Store copies.** `parseFrameBuffers` reuses its `Float32Array`s between frames,
  so keeping a reference would make every cached frame quietly become the most
  recent one.
- **Budget by bytes, not frames.** A frame is 36 bytes per particle — 3.6 MB at a
  hundred thousand, 36 MB at a million — so a frame count is either useless for
  small systems or ruinous for large ones.

`useTrajectory(file)` drops everything when the file changes; frame indices mean
something different in another trajectory.

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
| `Space` | Frame the selected particles, or play / pause when nothing is selected |
| `←` / `→` | Step one frame (`Shift` for 10) |
| `Home` / `End` | First / last frame |
| `Ctrl`/`Cmd`+`O` | Open files (works before *and* after a scene is loaded) |
| `P` | Screenshot |
| `Q/A` | Shift particles on X-axis |
| `W/S` | Shift particles on Y-axis |
| `E/D` | Shift particles on Z-axis |

Ignored while a form field has focus.

**`Space` does two things, and which one is never ambiguous.** With particles
selected it frames them; with nothing selected it plays. Both are the obvious
thing to want from that key, and clearing the selection — a click on empty space
— hands it back to playback, which is also always reachable from the transport
buttons and the arrow keys.

Framing keeps the direction you were looking from (`rendering/frameCamera.js`):
it computes a sphere around the selection and stands far enough back for the
field of view to hold it. A double click frames the one particle under the
pointer through the same path. That path used to place the camera five units
along +Z from the particle, which framed nothing in particular — it ignored how
big the thing was and swung the view to a fixed angle whatever you had lined up.

`Ctrl`/`Cmd`+`O` lives in `FilePicker`, not `useKeyboardShortcuts` — that hook
returns early on any modifier, and rightly so. `FileDropZone` has a chooser
behind its click target but unmounts as soon as the first files land, so once a
simulation was open the only way to load another was to drag it in. Worse, the
browser's own `Ctrl`+`O` would then open a file *over the page* and discard the
session, which is why the handler calls `preventDefault` even when it does
nothing else. `FilePicker` is always mounted, so the shortcut behaves the same
before and after a load, and is disabled in iframe mode with the rest of
drag-and-drop.

## Long operations say what they are doing (`uiStore.busyMessage`)

Several things here block the main thread long enough to look like a crash.
DBSCAN is the worst: **2.4s at 4,000 particles, 15s at 10,000, 60s at 20,000**.

**Announcing it means yielding first.** Nothing is painted between a state change
and the work it triggers, so a message set immediately before a blocking call can
never appear. Clustering therefore moved out of a `useMemo` and into an effect
that sets the caption, waits `PAINT_DELAY_MS` (32), and only then computes. The
delay is a timeout rather than `requestAnimationFrame`, which never fires in a
background tab — clustering that silently stopped happening when the tab was
hidden would be a far worse bug than the one this fixes. `exportGLTF` does the
same.

Because clustering is now asynchronous, anything asserting on cluster output has
to wait for it; `ClusteringPane.test.js` uses `waitFor`.

Who writes it:
- the load pipeline, through `loadSimulation`'s `status` callback — reading the
  input file, parsing the topology, indexing the trajectory. The full-screen
  loading cover shows this as its caption instead of the one fixed line
  ("Reading trajectory") that was wrong for most of the time it was up.
- `useClusterSource`, above `ANNOUNCE_CLUSTERING_ABOVE` (2,000) particles. Below
  that DBSCAN finishes inside a frame or two and a flashing message is noise.
- `useSceneExport.exportGLTF`.

`BusyIndicator` renders it as a small panel while a scene is up, rather than the
full-screen cover: hiding the structure someone is working on to tell them it is
being worked on is worse than saying nothing. It sits above the floating panels
(z-index 1500) because it reports on work those panels started, and it carries **no
spinner** — the main thread is blocked, so anything animated would freeze
mid-turn and look more broken than a static mark does.

## Clusters over time (`utils/kymograph.js`, `components/ClusterKymograph/`)

Time across, each cluster a band whose **height is how many particles it holds**.
A band that thickens is a cluster growing, two bands becoming one is a merge, and
a band that ends is a cluster dissolving. Opened from the clustering pane, which
computes it.

**It was a kymograph first — one row per particle — and that was the wrong
picture**, for three reasons worth keeping written down because they are not
obvious until you try it:

- rows fall below a pixel on any real structure, so the thing meant to show
  evolution becomes a smear;
- rows have to be grouped by *some* frame's clustering, so every particle that
  later leaves is stranded in the wrong group and the bands decay into noise
  exactly as the trajectory gets interesting;
- it shows membership but never shows a **merge** or a **split**, which are the
  two events anyone watching clusters over time is watching for.

Bands fix all three: height is a count, so nothing goes sub-pixel however many
particles there are; a cluster is one continuous shape however much its
membership churns; and a merge is two bands becoming one. Individual particles
are not lost — the ones selected in the scene are drawn as a white line through
the bands they belong to, so following one as it changes cluster is a line
crossing from band to band, with a gap where it belonged to no cluster.

### Identity is the whole problem
DBSCAN renumbers from scratch every frame, so "the same cluster as last frame" is
not something the algorithm says. `assignLineages` says it, by matching clusters
on the particles they share; contested lineages go to the larger overlap and the
loser starts a new one, which is what makes a split read correctly. Everything
else is built on that: the colour, the bands, the particle traces.

### Colour comes from the lineage, everywhere, once a time view exists
This is the one place the app does not colour a cluster by its size. Size is
right for a single frame and wrong across a trajectory: sizes change, so the
cluster you picked is a different colour two frames later — in the pane and in
the scene both. Measured on two clusters of eight: two near-identical reds at one
frame, a green and a red at another, the *same clusters* throughout. Nothing then
connects a band to a selection, which is why tracking one was impossible.

So `lineageColourer` supplies the colour while a time view exists, through the
pane's `effectiveColorAt` — the list swatches, the particles in the scene and the
bands all agree, and none of them change as the trajectory plays. An explicit
swatch override still wins.

### Following a cluster shows the fate of its particles, not its size
Selecting a cluster switches the picture to its **cohort**: the particles it held
at that moment, followed individually, and grouped at every later frame by which
cluster each of them is in *now*. The total height is then fixed — it is the
cohort — and what moves is how it is divided. Staying together is one solid
block; dispersing fans out into the colours of wherever the particles went, with
grey for the ones in no cluster at all.

This is a different question from the band, and the band cannot answer it: **a
cluster can hold a steady forty particles all run and have exchanged every one of
them**, and its band would not flinch.

The cohort is **latched at the frame it was picked in**, read through a ref, or
scrubbing would redefine who the cohort is — making it agree with whatever is on
screen and answer nothing. Same reason the emphasis is latched: the pane selects
by cluster *index*, so re-resolving as the frame changes walks the highlight onto
whichever cluster now holds that index. The pane's selection seeds it, resolved
through the column of the frame on screen since that is the frame the pane's
clusters describe.

Ctrl/Cmd-click a band to follow it, again to stop. A lineage is stable, so this
holds whatever the pane does afterwards.

### Cost
DBSCAN once per frame, so a run costing 2.4s at one frame costs two minutes over
fifty. Optional and explicitly asked for; reports progress through `busyMessage`,
yields between frames so that message repaints and a stop is noticed, and reuses
`loadFrame` with a capture bag in place of the scene's setters — inheriting the
MGL branch, the centring, the wrap and the frame cache without moving the view
anyone is looking at.

The `migrate` fixture exists for this: two blobs of eight and one particle that
walks between them, both clusters the same size throughout. Every other fixture
is static, so none of them can show a cluster changing — and same-size clusters
are exactly the case size-colouring cannot distinguish.

## The corner reports viewing state (`.scene-corner`)

The top-right corner holds what the scene *is*, not what to do with it: the
background toggle, and `ImpostorIndicator` when spheres are being drawn as
impostors. It is a flex row so adding an item does not mean hardcoding the width
of its neighbour.

**The renderers report; the indicator does not guess.** Each layer decides on its
own count — `Particles` on the particle count, `RepulsionSites` on the *bead*
count, several per particle — so a system under the threshold by particles can be
over it by spheres. Deriving the badge from the particle count alone would be
wrong for exactly the format that draws the most geometry. Layers write into
`uiStore.impostorLayers` from an effect and clear it on unmount;
`usesImpostors(state)` is the one shared derivation.

Shown only while impostors are on. An indicator always present but usually
meaningless is decoration, and the tooltip carries what a badge cannot —
including `?impostors=0` to force real geometry.

## Overlays (`store/overlayStore.js`, `utils/overlays.js`)

An overlay is a named, per-particle source of colour. The default view colours
by particle type from the active colour scheme; an overlay replaces that **base**
colour for the particles it covers. Cluster membership is the first kind; the
model is deliberately a plain `Map<particleIndex, '#rrggbb'>` rather than
anything cluster-shaped, so per-particle scalar properties can be added without
reworking it.

- Several overlays can be registered at once. Exactly one is active, or none.
- The **View** control in the control bar switches between them, and only
  appears once at least one is registered.
- A newly dropped overlay becomes active immediately — dropping a file and
  seeing nothing change would read as the drop having failed.
- Overlays are keyed by particle index, so loading a new simulation clears them.

Overlay colour is the *base* colour, so cluster selection, highlighting and
per-cluster visibility still apply on top of it.

The colour-scheme dropdown is hidden while an overlay is active: it describes
the default view only, so under an overlay it would control nothing visible.

`ClusteringPane` resets its selection whenever the active overlay changes,
**including to none**. Without that, returning to "Particle type" left the
previous selection in place; those indices then addressed the computed clusters
instead, so the scene stayed painted in cluster colours and the scheme never
reappeared — which looked like the view control had stopped working.

### Cluster/bond observables (`src/formats/observables/`)

oxDNA's patchy-particle contrib plugins each ship a cluster or bond observable,
and **the three share no output format whatsoever** — one line per step, a
configuration-style block, and a bare tuple list. Each gets its own parser; they
converge in `bondFrames.js`, which is the app's equivalent of the single
`dict[timestep -> graph(s)]` shape pypatchy normalises them to.

| Observable | Plugin | Paired format | Shape |
|---|---|---|---|
| `PLClusterTopology` | romano | flavio / josh_flavio / subhajit | one line per step: a count, then `( members ) [ adjacency ]` per cluster |
| `PatchyBonds` | rovigatti | lorenzo | `# step n N n` then **two lines per particle**: per-patch counts, then a flat index list |
| `RaspberryPatchyBonds` | evans | raspberry | one line per step of `((i p), (j p))` tuples |

An observable only works with the plugin it is compiled into, so a system
produces exactly one of the three; detection has nothing to disambiguate.

**`PLClusterTopology`'s member list holds particle *types*, not indices.** The
observable's `show_types` setting defaults to true, and nothing in the file says
which it was — a file of forty particles of types 0 and 1 looks exactly like one
recording particles 0 and 1. The `[ adjacency ]` block is always raw indices
whatever that setting is, so clusters are read from there and only there, as
pypatchy does. The cost is that a cluster member with no bonds of its own is
invisible; it is also, by this observable's own definition, in no bond.

**`PatchyBonds` hides its per-patch partition in a separate line**, and a
particle bonded to nothing writes a **blank** one. Filtering empty lines — which
every other reader here does — shifts every particle after it by one, so counts
get read from an index line and the rest of the block is silently wrong. Lines
are taken exactly two per particle. Indices are 1-indexed (`bonded_id + 1`).

**Both directions of a bond are merged, and that is not just deduplication.**
Two of the three formats report a bond once from each participating particle,
and each report knows only its own end's patch — merging is the only way both
patch ids become known. `dedupeBonds` takes directed half-bonds and normalises
on `min`/`max`, so the two directions land on the same key.

#### They are streamed, and they are matched on the step number

Both of these replaced an earlier design, and the file that replaced it is worth
naming: a 4.79 GB `clusters.txt` from a 4,800-particle run.

**They cannot be read with `file.text()`.** That materialises the whole file as
one JS string, and V8's maximum string length is 536,870,888 characters — the
file above is **8.9x** that, so it fails at any amount of RAM, and
`split('\n')` would then want an array of 209 million strings. They are
streamed instead: `obs_scan_*` in the Rust core walks the bytes and records
where each timestep starts, parsing nothing.

| scanning that file | |
|---|---|
| decode + split + `startsWith`, as `buildTrajIndex` does | 10.2s (472 MB/s) |
| a byte loop in JavaScript with `indexOf` | 3.4s (1,430 MB/s) |
| **the Rust core** | **1.9s (2,501 MB/s)** |

Offsets cross the boundary as `f64`, not `i32`. That file is past 2^32 bytes, so
a 32-bit offset wraps a third of the way in and every block after that point is
read from the wrong place.

**The counts do not match, and they are not supposed to.** This was positional
at first — entry *i* for frame *i*, refusing any mismatch — on the reasoning
that one run writes both files. Real output says otherwise, because an
observable prints far more often than configurations do:

| | interval | count |
|---|---|---|
| `clusters.txt` | `print_every: 1e5` (observables.json) | **21,798** timesteps |
| `trajectory.dat` | `print_conf_interval = 1e7` (input) | **217** frames |

A hundred blocks per frame. Positional would have paired the observable's step
1e5 with the trajectory's t = 2e7 and been wrong about every frame, silently —
and strict positional refused the file outright. `alignment.js` matches on the
**step number** instead, three ways, most reliable first: the step the file
states (`PatchyBonds` writes one on every block); failing that `print_every`
from `observables.json` or the input's own `data_output_N` blocks, so block *i*
is taken to be step *i x print_every*; failing that, position.

This is why `buildTrajIndex` now returns `{ offsets, times }`. It always read
the `t =` header and threw the number away.

**Only the matched blocks are ever parsed** — 217 of 21,798, about 47 MB — and
each only once however many frames point at it. They are sliced out and handed
to the ordinary format parser unchanged, which is why the three parsers know
nothing about streaming, alignment or size. Same division as the trajectory: one
index pass, then a frame at a time.

**A frame with no block of its own is drawn without clusters or bonds.**
Carrying the previous block forward would report a bonding the file does not
claim for that time; refusing the whole file would throw away every frame that
does match, and a partly-covered run — an observable started late, a job cut
short — is ordinary.

Measured end to end on that run: **11.1s** from drop to scene, for 5.08 GB
across 24 files, and the clusters it reports (240 at t=1e7, 581 at t=2.17e9)
match an independent pass over the raw file exactly.

**Colours are decided once, over the whole file** (`colourFrames`). The
`clusterIdentity` register is stateful and order-dependent, so computing them
live as frames arrive would give a cluster a different colour depending on which
direction you scrubbed from. It gets its own register, not the pane's, for the
same reason the time view does.

#### How a per-frame source reaches a frame-independent app

An observable registers as an **ordinary `kind: 'clusters'` overlay** whose
`clusters` and `colors` are rewritten as the trajectory moves
(`hooks/useObservableFrame`, `utils/observableFrames.js`). At any instant it is
indistinguishable from a loaded `clusters.json`, so the pane, `useClusterSource`,
`useClusterColours`, `useClusterPublication`, the list, the histogram and all
five renderers needed no changes — none of them has a time axis.

Two guards matter. An overlay already showing the frame asked for is not
rewritten: every overlay write re-renders all five renderers, this runs on each
frame of playback, and the write feeds itself — the update changes the `overlays`
identity and re-runs the effect, which then finds nothing to do. And the pane
adopts a per-frame source the way it adopts DBSCAN, not the way it adopts a file:
selecting everything and hiding the rest would hide every unbonded particle, and
the selection is cluster *indices*, which go stale the moment the frame moves.

#### Bonds are drawn from the pane's cluster source
`components/Bonds` draws `particleStore.bonds` as grey instanced cylinders, the
same geometry problem `Springs` solves — both now go through
`cylinderBetween` in `rendering/transforms.js`. Grey rather than coloured by
patch, because a bond has *two* patch ids and the particles it joins already
carry the meaningful colour.

Which observable's bonds appear follows `clusteringStore.clusterSourceId` — one
rule, and it is the selector that already says which cluster set is being worked
with. That is why `clusterSourceId` lives in the store rather than in
`useClusterSource`: the renderer cannot reach a hook's `useState`. Drawing every
loaded observable at once would stack cylinders in the same places with nothing
to tell them apart.

`uiStore.showBonds` toggles them, and the control only appears while there are
bonds. **`clearClustering` deliberately leaves them alone**: bonds are geometry
the file states, not a restriction anyone applied, and they have their own
toggle.

#### The time view is free here
`useKymograph` normally runs DBSCAN once per frame — the two-minutes-over-fifty
cost documented below. An observable already holds one grouping per frame, so
that path skips `loadFrame` and `dbscan` entirely and reads
`observable.frames[i].clusters`. Watching clusters merge and split over time is
what these observables are *for*, so this is the case worth being fast.

### Additive drops
`handleFilesReceived` classifies the drop **before** touching any state: a drop
carrying no topology, trajectory or MGL file, but at least one cluster file or
cluster/bond observable, onto an already-loaded scene registers overlays and
returns without resetting anything. Anything else replaces the scene as before.

### Grouping and colouring are separate choices
The pane's **Clusters** selector picks which cluster set to work with — computed
(DBSCAN) or any registered cluster overlay — and the control bar's **View** picks
what colours the scene. They are deliberately independent:

| Clusters | View | Result |
|----------|------|--------|
| a file   | that file      | grouped and coloured by cluster |
| a file   | Particle type  | grouped by cluster, coloured by particle type |
| DBSCAN   | Particle type  | the plain default |

Tying them together meant choosing "Particle type" also threw away the grouping,
so there was no way to cluster by a file while colouring by particle type.

The computed clusters are a **view in their own right** (`COMPUTED_VIEW`), which
is also the default. They have no colour map — the pane paints its own clusters —
but naming them means "what is colouring the scene" always has an answer.
Treating DBSCAN as "no view" instead left its clusters with no colours at all,
while a loaded cluster file carried on tinting them.

Changing the **Clusters** selector points the View at whatever was chosen, so a
cluster file left active cannot keep colouring a different grouping. The View can
still be changed afterwards — that is how you group by one thing and colour by
another.

**The View control appears as soon as there is a cluster set, computed or from a
file.** It used to be gated on `overlays.length > 0`, so a plain DBSCAN run —
the commonest case by far — could never be switched to particle-type colours,
which is the one combination this split exists to offer. `clusteringStore.clusterCount`
carries that signal to the control bar; it outlives the pane deliberately, because
closing the pane leaves the clustering applied to the scene and the control that
explains it has to stay. The pane's explanatory note is likewise no longer gated
on a loaded file: "Grouping by Computed clusters, coloured by particle type".

The pane publishes cluster colours **only** when the active view is the very
cluster set it is showing (`colorByCluster`). Otherwise it publishes the
highlighted and hidden sets alone, so selection, hiding and the 1.3x highlight
still work while particles keep their type colour. The pane explains which mode
it is in, because two dropdowns in different panels interacting is not
self-evident.

Dropping a cluster file still "just works": the new overlay becomes both the
active view and the pane's cluster source.

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

**New cluster/bond observable**: add a parser in `src/formats/observables/`
converging on `bondFrames.js`, then one entry in that directory's `index.js`
table. The entry states how the streaming scanner finds one timestep (`scan`)
and what a blank line means for that format (`blanks`) — the scanner reports
every line and the format decides, because the three disagree. Detection,
categorisation, alignment and the drop paths all read that table.

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

## DBSCAN (`utils/clustering.js`)

Textbook DBSCAN (Ester et al. 1996) over periodic distances. Pinned by
`clustering.test.js`, which is the coverage for all of this — the visual suite's
fixtures cluster identically under every variant tried, so it cannot see changes
here.

**Periodic distances.** `dbscan(points, epsilon, minPoints, boxSize)` measures
separation under the **minimum image convention**: each axis difference has the
nearest whole number of box lengths subtracted. Without it a cluster straddling a
box wall reads as two clusters a whole box apart — the one thing periodic
boundaries exist to prevent. `ClusteringPane` passes `currentBoxSize`, which is
identity-stable, so this does not re-run DBSCAN on every trajectory frame.

`Math.round`, not one wrap: oxDNA trajectories are **not** wrapped into the box,
so a coordinate difference can legitimately span several box lengths. Omitting
`boxSize` (or passing zeros) falls back to plain Euclidean distance, which is
what a non-periodic system wants.

**`epsilon` is capped at `maxMinimumImageRadius(boxSize)`** — half the shortest
box dimension. Past that the nearest image stops being unique: a particle comes
back into range as its own neighbour from the other side and pairs are counted
through two images at once, which invents clusters rather than merely blurring
them. Every MD code caps its interaction cutoff the same way. The epsilon slider
also stops there, and says so when the box is what limits it.

**The region query uses a uniform grid, not a scan of every point.** A neighbour
has to be within epsilon and cells are epsilon across, so only the 27 cells
around a point can hold one. Same results — `clustering.test.js` compares against
a brute-force DBSCAN on random structures rather than trusting the reasoning —
and the difference is not small:

| particles | before | after |
|---|---|---|
| 1,000 | 147 ms | 7 ms |
| 4,000 | 2.4 s | 46 ms |
| 10,000 | 14.8 s | 241 ms |
| 20,000 | 59.8 s | 947 ms |

The grid is stored as counts turned into offsets and one flat index array, the
way a sparse matrix is: a million particles would otherwise mean a million small
arrays, and the allocation costs more than the search saves. Cells wrap when the
box is periodic, and the per-axis neighbour list is deduplicated because a box
only two or three cells across would otherwise visit a cell twice and count its
points twice. A zero span — a flat structure, or a box carrying a zero dimension
— gets one cell on that axis rather than a division by zero.

**Neighbours needed and cluster size are different questions.** `minPoints` is a
density: raising it stops particles being core points, so a cluster held together
through a thin waist comes apart. That is textbook DBSCAN and it is *not* what
someone means by "only show me clusters of at least N". `withinSizeRange` filters
**after** clustering, as a separate control, so moving it can only ever remove
whole clusters, never break one. Both behaviours are pinned by a dumbbell fixture
in `clustering.test.js`.

**It applies to every cluster source, not only DBSCAN.** It was a DBSCAN-only
control at first, disabled along with epsilon and "neighbours needed" whenever a
file supplied the clusters — which left it greyed out for the case with the most
to filter. A cluster/bond observable states hundreds of clusters per frame (581
at the last frame of the run it was built for, most of them pairs), and the band
is what makes that legible: a lower bound of 6 leaves 115. It filters a finished
clustering, so it means the same thing whoever produced it. Only the two DBSCAN
knobs are disabled for a file source, which is what `parameter-group.is-disabled`
now wraps.

`useClusterSource` filters the source's entries and the plain index arrays
**together**. `clusterColorAt` reads `fileClusters[i].color` and `ClusterList`
its name and visibility, so filtering one list and not the other shifts every
entry after the first removal onto a neighbour's colour.

**The slider's ceiling comes from the whole observable, not the frame on
screen.** The ceiling positions the upper thumb, so reading it off the current
frame would move the thumb as the trajectory plays — and a band set at one frame
would quietly mean something else at the next.

It is a **band**, with both ends, not a floor: "everything above N" is only half
of what gets asked — isolating the mid-sized clusters, or looking at just the
stragglers, needs an upper end too. `RangeSlider` is two overlaid
`<input type="range">`s, since there is no two-thumb input; both stay real
inputs so they keep their keyboard behaviour, and the thumbs stop at each other
rather than swapping. The upper bound sitting at the largest cluster means "no
upper bound", so it keeps working as clusters grow. The list, the histogram and
the statistics all read the filtered set, so they cannot disagree about what is
being shown.

**Core, border and noise are the textbook definitions.** `minPoints` **counts the
point itself**, so `minPoints: 3` means three particles within epsilon including
this one. The control is labelled **Neighbours needed**, not "Min Points", because
it is a *density* and not a minimum cluster size — and reads as the latter.
Raising it dissolves clusters holding far more particles than the number, which is
correct and surprising enough that the pane says so: a loose ring of twelve where
each particle sees only two others disappears at four, while a tight group of
twelve survives to twelve. Pinned by `clustering.test.js`. A point with at least `minPoints` neighbours is *core* and extends its
cluster; a point within epsilon of a core point but not core itself is a *border*
point, which joins that cluster but does **not** extend it — that is what stops
two dense groups linked by a thin trail of stragglers from being reported as one.
A point rejected as noise early can still be adopted later as a border point.

This changed in the commit that added periodic distances: the previous
implementation excluded the point itself from the count, so `minPoints: 3`
behaved like a textbook 4.

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

### Per-cluster visibility
Each row in the pane has an eye control that hides that cluster, and
`clusters.json` can start one hidden with `"visible": false`.

This is deliberately a separate axis from selection. Selection drives
highlighting and, with *show only selected*, what else stays on screen; the eye
hides one cluster regardless of either. `forceHidden` is therefore checked
*first* in `getClusterAppearance`, before the selection branch — otherwise
hiding a selected cluster would appear to do nothing.

The pane thinks in cluster indices; renderers think in particle indices. An
effect translates `hiddenClusters` into `clusteringStore.hiddenParticles`, which
is what the renderers read.

### Cluster colours
**A cluster keeps the colour slot most of its particles already had**
(`utils/clusterIdentity.js`). Identity by *overlap*: it survives growth,
shrinkage, exchange, DBSCAN's renumbering and the loss of any one member.

Two things about how it is called matter as much as the rule:

- **Slots are recycled.** They used to come from a counter that only went up,
  and over a trajectory clusters form and dissolve constantly — it climbed past
  the twelve-colour palette, and the lightness variants cycle every five, so
  after about sixty distinct clusters the colours repeated exactly. That is
  colours breaking part-way through playing a trajectory. The lowest free slot is
  allocated instead, which bounds them by how many clusters are on screen at
  once.
- **Each sequence of frames gets its own register** (`createIdentity`). The pane
  follows the frames someone scrubs through; the time view walks the whole
  trajectory in one go. Sharing one register meant computing a picture ran every
  frame through the pane's state and left it at the last, so the scene changed
  colour the moment the picture finished.

**Claiming is order-dependent, so it happens once per frame for every cluster at
once** — `assignSlots(clusters)`, read by the colour function rather than called
from it. Registering as a side effect of asking for a colour made the claim order
the *render* order: the histogram renders before the list and asks only about
sizes held by exactly one cluster, so it claimed a scattered subset first and the
list took what was left.

Five things were tried before it and all five moved:

| tried | moved when |
|---|---|
| size rank | a cluster grew or shrank |
| cluster index | every frame — DBSCAN renumbers |
| lineage, falling back to size rank | a time view was computed, or a lookup missed |
| rank over the current clusters' anchors | any other cluster appeared or vanished |
| the lowest-numbered member itself | that particular particle left |
| overlap, with slots from a counter | the counter ran past the palette mid-trajectory |
| overlap, with one shared register | a time view was computed |

The last is not hypothetical: in the `migrate` fixture the particle that changes
cluster *is* the lowest-numbered one, so the cluster it left changed colour at
that frame.

One imprecision remains, left deliberately: when a cluster **splits**, both
halves carry the same history and so keep the colour. Telling them apart would
mean deciding which half is the real continuation, and the time view already
shows a split for what it is.

`colourForSlot` always returns `#rrggbb`, including for the first palette-worth
of clusters. The golden-angle generator produces `hsl(...)` and a swatch is an
`<input type="color">`, which accepts nothing else — returning the raw entry left
every swatch black on any browser whose sanitiser is not Chrome's, which is also
why the visual suite could not see it.

**The histogram was the last thing still coloured by size**, which meant its bars
disagreed with the swatches beside them, with the scene and with the time view —
the inconsistency that made the colours look arbitrary. A bar now carries a
cluster's colour only where it stands for **exactly one**; where it covers
several it takes a neutral tone and claims nothing, because five clusters of
eight particles have five colours and no single one.

The bar colour arrives as a `--bar-color` custom property rather than an inline
`background`, because an inline background would outrank the class rule that
paints a *selected* bar accent-blue.

**Lightness separates clusters past the end of the palette.** With twelve
colours and more clusters than that, the slot wraps; each wrap shifts the
lightness so the thirteenth cluster is not indistinguishable from the first.
`colourForSlot` is the single function that does this, used by the pane and by
the time view. Steps that cycle, not a range spread across the group: a
hundred clusters of one size would put a fraction of a point between neighbours
and look uniform again. The steps are centred on however many shades the group
actually uses, so a lone cluster gets the base colour exactly — otherwise it
rendered a step darker than the histogram bar that is meant to be its legend.

`lightnessLadder` in `colors.js` does the work. It reads both palette spellings —
`#rrggbb` from the static schemes and `hsl(h,s%,l%)` from the golden-angle
generator — and always returns hex, because an `<input type="color">` accepts
nothing else.

**It slides the ladder to fit, and never clamps a rung onto the edge.** Clamping
each shade into a fixed band instead collapses them: a pastel base at lightness
86.5 sent three of five shades to the same value, and a black palette entry sent
all five to one grey — switching the feature off for precisely the schemes that
needed it. The bounds also stretch to include the colour's own lightness, so a
group of one returns the palette entry untouched; anything else made a lone
cluster disagree with the histogram bar that is meant to be its legend.

The visual suite cannot see any of this — it only ever exercises the default
golden-angle palette, whose lightness of 65 sits clear of both ends. `colors.test.js`
sweeps every scheme and every entry instead, which is the test that catches it.

One consequence remains inherent: colours are relative to the sizes present, so
changing epsilon can reshuffle them.

A per-cluster swatch in each row still overrides the colour, and a `color` in a
cluster file still wins over both. Highlighting previously kept every particle's
*type* colour, which made two adjacent clusters indistinguishable — usually the
exact thing you are trying to see.

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
an unrelated JSON file dropped with a simulation is not mistaken for clustering. While a file is loaded the two DBSCAN controls
are disabled, because they cannot change clusters that came from a file — but
the size band stays live, since it filters whatever clustering is in front of
it.

```json
{ "clusters": [
  { "name": "Core", "color": "#e7298a", "visible": true, "particles": [0, 1, 2] }
] }
```

A bare array works too, and the particle list may be `particles`, `indices` or
`ids` — analysis scripts in this space spell it all three ways. `color` is
optional and falls back to the palette. `visible` is optional and defaults to
true: only an explicit `false` starts a cluster switched off, so a file that
omits the field behaves exactly as before. A malformed entry is skipped with a
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

### Clustering is gated, because the pane is always mounted
`computedClusters` runs DBSCAN only when something uses the result:
`!fileClusters && (showClusteringPane || sceneIsRestricted || selectedClusters.size > 0)`.
`positions` gets a fresh identity on every trajectory frame, and the component is
now mounted for every structure, so an ungated memo ran an O(n^2) clustering once
per frame for every user — including everyone who never opens the panel. When the
gate is closed the memo returns the shared `NO_CLUSTERS` constant, so every memo
and effect below it keeps a stable identity too.

This is also what keeps the **View** control honest: `clusterCount` follows
`clusters.length`, so the control appears when someone actually clusters rather
than on every load — where it would have read "Computed clusters" beside a colour
scheme picker that was in fact driving the colours.

Both publish effects bail when they would write nothing new. Every renderer
subscribes to `clusteringStore` without a selector, so a write re-renders all five
and re-runs their per-instance colour effects.

### The pane's state lives in the store, and the pane outlives its panel
`selectedClusters`, `showOnlySelected` and `hiddenClusters` are in
`clusteringStore`, not in `ClusteringPane`'s `useState`, and `App` mounts the
component whenever there is a structure rather than only while the panel is open
(it renders `null` when closed).

Both halves matter. Closing the panel used to unmount the component, which
destroyed that state **and** the effect that publishes it — so a scene left
clustered had nothing listening: switching the View did nothing at all, and the
only control that could undo the clustering vanished with the panel. Closing the
panel hides the controls; it does not switch the clustering off, so the thing
that owns the clustering has to stay alive.

### Getting back out
`isSceneRestricted(state)` — exported from `clusteringStore`, one definition
shared by both buttons so they cannot disagree — is true when `showOnlySelected`
is on or any cluster is hidden. Selection alone does not count: with
*show only selected* off it changes nothing on screen, and offering to undo an
invisible state is noise.

**`clearClustering()`** is offered in two places while that holds: **"Clear
clustering"** beside the View control, and **"Show all particles"** in the pane.
The control-bar one is the important one — the clustering stays on screen after
the panel is closed, so the way out has to be reachable from there too.

It also points the View back at particle type. A cluster file supplies the
particles' *base* colour, so clearing the selection alone left every particle
still painted by its cluster after a button that said otherwise.

### Invariants in the visual suite must throw, not return 0/1
`run.js` reports a numeric diff only when it moves by more than `ABSOLUTE_SLACK`
(6), so a flag flipping 1 to 0 is swallowed whole: a boolean "measurement" is
decoration. Scenarios use `assert(condition, message)` from the prelude, which
throws and is recorded as a scenario failure. Verified by deliberately failing
one and confirming the run reports it. Before it, leaving a clustered view meant finding four controls across two
panels — and the button then named *Clear All* **emptied** the scene rather than
restoring it, because showing only the selected clusters when nothing is selected
shows nothing. It is now *Clear selection*, which is what it does. Colours need no
undoing: with nothing highlighted the pane publishes no colours and particles fall
back to their type colour on their own.

A selected particle keeps its cluster's highlight scale. Dropping it from 1.3x to
1.0x moved the geometry out from under the cursor, so a second modifier click on
the same pixel hit whatever was behind it and **added** that instead of
deselecting.

Note: `ClusteringPane` only populates `highlightedClusters` while *Show only selected clusters*
is on, so the 1.3× highlight state never appears on its own — selecting a cluster with that box
unchecked currently has no visual effect. Left as-is deliberately: making selection always
highlight would add another piece of state with no obvious way to switch off, which is the
problem "Show all particles" was added to solve.

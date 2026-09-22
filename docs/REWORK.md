# PPView rework

A deep review of the codebase and a phased plan to act on it. Written 2026-09-21
against `3820af1`.

This is not a bug list. Every finding here is structural: a place where the shape
of the code makes a class of bug likely, or makes it hard to notice one has
happened. Where a specific bug is cited it is as evidence, not as the thing to
fix.

---

## Findings

### 1. `App.js` is the application, not a component

732 lines. `handleFilesReceived` alone runs 150–395 — **245 lines** — with a
14-entry dependency array, and inlines the entire load pipeline: classify the
drop, parse the oxDNA input file, branch for MGL, parse topology, index the
trajectory, load the first frame, apply cluster files that had to wait for a
particle count. Staleness is handled by an `isStale()` closure whose checks are
placed by hand after each `await`; adding an `await` without one silently
reintroduces the "slow load overwrites the newer scene" bug.

`loadConfiguration` is a bare async function called from an effect behind an
`eslint-disable-next-line react-hooks/exhaustive-deps`.

There are **14 `getState()` calls** in this file. Each is an imperative read that
exists because the reactive path was inconvenient, and each is invisible to
React's dependency tracking.

### 2. Subscription granularity is half-fixed

The five renderers now take `clusteringStore` field by field. They all still do:

```js
const { selectedParticles, sphereSegments } = useUIStore();
```

and `App.js:56,93` subscribes to **both entire stores**. `positions` gets a new
array identity every trajectory frame, so a 732-line component re-renders on
every frame of playback and takes `ControlBar` (320 lines) with it. The
`SceneContent` memo and the identity-stable `currentBoxSize` guard exist
precisely to prevent this one level further down.

### 3. Stores import each other

`clusteringStore` imports `overlayStore` so that `clearClustering` can also reset
the View. It is correct, and it is the first cross-store import in the codebase.
There is no home for an action that legitimately spans stores, so the next one
will either duplicate the logic at two call sites or close the cycle.

### 4. `ClusteringPane` is 718 lines — 389 logic, 329 markup

It owns DBSCAN orchestration and the gate deciding whether to run it, cluster
source selection, cluster file loading, the colour ladder, histogram computation
*and* its rendering, selection and per-cluster visibility, and three effects that
publish to the store. Nearly every clustering defect found recently lived in this
file. That is what a file with seven responsibilities does.

### 5. Testing is inverted

| | LOC |
|---|---|
| source | 8,835 |
| tests | 455 |

Of 22 pure modules under `utils/` and `formats/`, **two** have tests.
`clusterAppearance.js` — the single source of truth for every renderer's colour
and scale — has none, despite being changed three times in one session.
`clusterFile.js`, `overlays.js`, `trajectoryLoader.js`, `mglParser.js` (535
lines), `exportUtils.js` (477) and every parser but raspberry are untested.

Verification leans instead on a 260-second browser suite. That suite recorded
`hits: 0` for the `selection` scenario across **eight commits** while its
baseline also held `0`, so every run reported "no visual change" with its only
picking coverage dead. A safety net that can fail silently is worse than none,
because it is trusted.

### 6. The renderers duplicate a fixed preamble

`Particles`, `Patches`, `Springs`, `RepulsionSites` and `OxDNANucleotides` each
subscribe to three or four stores and assemble the same inputs for
`getClusterAppearance`. Nothing keeps them in step; they have already drifted
once, when raspberry particles ignored clustering entirely.

### 7. `positions` is a new array of new objects every frame

This single fact is behind several observed symptoms: DBSCAN re-running per
frame, `App` re-rendering per frame, and identity-keyed memos being worthless
during playback. Consumers have no way to ask "is this the same frame?" except by
comparing array identity, which is always false.

---

## Plan

Six phases. Each is independently shippable, independently verifiable, and
ordered so that the safety net exists before anything moves.

### Phase 0 — Build the net
*No behaviour change.*

Unit-test the pure core, prioritising modules that **encode rules** over modules
that are merely large: `clusterAppearance`, `clusterFile`, `overlays`,
`detection/signatures`, the six parsers, `trajectoryLoader`.

Add a canary to the visual harness that fails loudly if the suite stops
exercising what it claims to.

*Done when:* every rule module has tests; the unit suite runs in under 10s.

**Status: done** (`45184bc`..). 161 tests across 10 suites, 1,221 lines, running
in ~1.1s. Covered: `clusterAppearance`, `clusterFile`, `overlays`,
`detection/signatures`, `trajectoryLoader`, `parsers/oxdnaNucleotide`, on top of
the existing `clustering`, `colors` and `raspberry` suites.

Two defects fell out of writing them:

- `clusterFile` used `Number()` on each index, which maps `null`, `false`, `""`
  and `[]` to **0** — a hole in a particle list silently became "particle 0 is in
  this cluster", the exact misreporting the whole-entry rejection exists to
  prevent. It now type-checks before converting, and still accepts the numeric
  strings some analysis scripts emit.
- `CLAUDE.md` described MGL trajectory detection as needing "multi-frame `.Box:`
  headers". One header is enough; `isMGLFile` returns false as soon as a header
  appears, so exactly one of the two predicates claims each file.

The canary: `assert()` counts itself, every scenario reports `__assertions`, and
the runner compares that **exactly** — no tolerance, because a drop from five to
zero is smaller than `ABSOLUTE_SLACK` and would otherwise be swallowed, which is
how the dead selection test hid. Verified by silently disabling one assertion and
confirming the run fails with `6 → 5 (assertions ran)`. `--update` now also
refuses to write a baseline from a run with errors, which had twice frozen a
wrong frame in.

**Review of Phase 0 found eight more, all fixed in the follow-up commit.** Three
were real product bugs the new tests were shaped to catch but did not:

- `buildTrajIndex` split on `/\r?\n/` while advancing `offset += line.length + 1`.
  The split consumes the `\r`, so **every frame of a CRLF trajectory was indexed
  short by one byte per preceding line** — `file.slice()` then landed mid-line and
  `parseConfiguration` read a body row as a header. Every fixture in the new
  suite was joined with `\n`, so the test named "finds the byte offset of every
  frame" passed while the only real way to break it went untested.
- `isMGLTrajectoryFile` ended with `|| (hasMGLContent && boxOrVolCount >= 0)`,
  whose right operand is true for any count, so it claimed headerless MGL files
  too. `detectFileType` tests it first, which made **`isMGLFile` unreachable**.
  The two predicates are now mutually exclusive.
- `parseOxDNANucleotideTopology` skipped malformed body lines while deriving
  `index` from the line number, leaving a hole. `OxDNANucleotides` reads
  `nucleotides[i]` positionally with `i` as the trajectory row, so **every
  nucleotide after a malformed line took another particle's base colour and
  backbone bond**. It now emits a placeholder per line, keeping position and
  trajectory index equal.

And four in the Phase 0 work itself: the canary was inert for the `overlays`
scenario (eight boolean readouts that `ABSOLUTE_SLACK` swallows — now
assertions), `--update` gated on scraped console text rather than genuine
scenario failures (one unrelated warning would have blocked the whole baseline,
with no `--force`), the `clusterFile` string branch narrowed to `/^\d+$/` and so
rejected the `"12.0"` and `"1e3"` that numpy round-trips emit, and `CLAUDE.md`
was never actually corrected despite the commit message saying it was wrong.

No scenario now records a small-integer measurement that the tolerance could
swallow: `clustering` asserts 11 times, `selection` 6, `overlays` 8. The three
that still assert nothing record only pixel counts, which move by hundreds.

### Phase 1 — Extract the load pipeline

New `src/loading/`: `classifyDrop`, `loadSimulation`, `loadFrame`. The staleness
token becomes an explicit argument rather than a closure, so a missing check is a
type-level omission rather than an invisible one. `App.js` keeps UI composition
and playback.

*Done when:* `App.js` is under 250 lines and contains no `getState()`.

**Status: partly done.** `App.js` is **424 lines** (was 732) with **10**
`getState()` calls (was 14). The pipeline is out: `src/loading/` holds
`staleness`, `resolveFiles`, `loadSimulation` and `loadFrame`, and playback moved
to `hooks/usePlayback`. 47 new tests cover them, all without a browser.

The target is not met. What remains in `App.js` is export (`exportGLTF`,
`makeOutputFiles`, `takeScreenshot`), the particle-shift keyboard handler, the
iframe wiring and the JSX — another two hooks' worth. Splitting those is
Phase 1b rather than something to pretend is done.

Three things the extraction turned up:

- **The trajectory file was resolved twice with different criteria.** The list
  used to *set* the trajectory included `init`; the list used to *build its
  index* did not. The two could pick different files, so the indexed frames and
  the file being read need not have matched. `pickTrajectoryFile` is now the only
  answer, used for both.
- **Staleness is no longer something to remember.** It was an `isStale()` closure
  with six hand-placed checks, where adding an `await` without one silently
  reintroduced "a slow load overwrites the newer scene". `step()` performs the
  await *and* the check, so nothing going through it can forget.
- **`loadFrame` no longer calls `alert()`.** It throws `LoadError`, and the
  caller decides how to show it. `alert()` was called from four places inside
  what is now a pure function.

The remaining `getState()` calls are not all bad. The two in `usePlayback` are
deliberate: subscribing to `currentConfigIndex` there would rebuild the callbacks
every frame and leave the playback interval looping on a stale index.

**Phase 1b: done.** `App.js` is **379 lines** with **8** `getState()` calls.
Export moved to `hooks/useSceneExport`, the particle shift to
`hooks/useParticleShift`, and the scene reset became one `resetScene` callback
instead of ten inline store writes.

Review of phase 1 found five more, all fixed:

- **The frame-loading effect was the one async path still unguarded** — the very
  failure the phase claimed to eliminate. Scrubbing quickly leaves several frame
  reads in flight and the last to resolve wins, so the scene could show a
  different frame from the one the controls report; worse, a read still running
  when a new simulation is dropped painted the old frame, decorated with the old
  topology, into the new scene. The effect now cancels on cleanup, through
  writers that no-op once superseded.
- **The playback interval captured `totalConfigs`.** Loading a shorter trajectory
  mid-playback left it running past the new end, and every tick raised a modal
  alert for a frame that does not exist. The interval lives in an effect now, so
  it is rebuilt when anything it depends on changes — which also fixes the speed
  control doing nothing until the next pause.
- **A load that failed after the topology parsed left the store dirty**, so the
  legends of a structure with no coordinates rendered over the drop zone.
- **The trajectory fallback could claim the topology file.** `looksLikeTrajectory`
  matches "init" anywhere in a name and ranks it above an unhinted `.dat`, so
  `init.top` + `sim.dat` selected the *topology* as the trajectory. Unifying the
  two resolutions in phase 1 had made this consistently wrong where it was
  previously inconsistently wrong.

### Phase 2 — Fix state ownership

Per-store `selectors.js`. A lint rule banning bare `useXStore()`. Narrow `App`'s
subscriptions so it stops re-rendering every frame. Add `src/store/commands.js`
for actions that span stores, and remove the `clusteringStore → overlayStore`
import.

*Done when:* no component subscribes to a whole store; no store imports another.

**Status: done.** No bare `useXStore()` remains anywhere in `src`, and an ESLint
rule (`no-restricted-syntax` on a zero-argument `useXStore()` call) now rejects
one — verified by reintroducing a bare subscription and watching it fail, rather
than trusting a rule that matched nothing.

`App` no longer subscribes to `positions` at all. It only ever read
`positions.length`, so it takes `selectParticleCount`: dragging particles along
an axis rewrites every position and no longer re-renders the application. The two
whole-store destructurings became `useShallow` picks — 32 UI fields and 20
particle fields — so an unrelated toggle no longer re-renders `App` and the
control bar with it.

`clusteringStore` no longer imports `overlayStore`. The combined action moved to
`store/commands.js`, which is where anything coordinating two stores belongs; the
store keeps `resetClusterState`, which is its own half, and `clearHighlighting` —
byte-identical to it, and one drift away from disagreeing — is gone.

The independence is asserted by reading the two files and checking their import
statements. The first version of that test imported the module and inspected
`Object.keys(source)`, which lists *exports*: it passed just as happily with the
cross-store import present. It now fails when the import is re-added, which was
checked rather than assumed.

### Phase 3 — Split `ClusteringPane`

Hooks: `useClusterSource`, `useClusterColours`, `useClusterPublication`.
Presentational: `ClusterHistogram`, `ClusterList`, `ClusterSourceControls`. The
pane becomes composition.

*Done when:* no file in the folder exceeds 200 lines.

**Status: partly done.** The 718-line file is now nine, and every extracted one
is small:

| file | lines |
|---|---|
| `ClusterStatistics` | 38 |
| `ClusterParameters` | 50 |
| `ClusterList` | 63 |
| `useClusterPublication` | 68 |
| `ClusterSourceControls` | 72 |
| `useClusterColours` | 76 |
| `ClusterHistogram` | 89 |
| `useClusterSource` | 118 |
| `index` | **392** |

`index.js` is the composition root and still misses the 200-line target. What
remains is the selection-controls markup, the statistics computation, and the
handlers wiring the pieces together — one more component's worth. It is no longer
a file with seven responsibilities, which was the point, but the number is not
met and should not be reported as though it were.

The split is behaviour-preserving: 224 tests and the full visual suite unchanged
after each extraction, which is how a refactor of this size stays honest.

Review of phase 3 found five, all fixed. Two were carried-over bugs the
extraction had made easier to see:

- **Changing epsilon could empty the scene and hide the way out.** Selection is a
  set of cluster *indices*, and DBSCAN renumbers on every recompute. Selecting
  clusters 7-9 of ten and widening epsilon to three left three indices naming
  nothing: an empty highlighted set was published with "show only selected" still
  on, so every particle was hidden — and `isSceneRestricted` compares
  `selectedClusters.size < clusterCount`, which `3 < 3` fails, so the "Show all
  particles" button was not rendered either. Stale indices are pruned when the
  cluster set changes.
- **Colour overrides followed an index onto a different cluster.** They are keyed
  by cluster index and survived a recompute, so a swatch set on cluster 3 painted
  whatever cluster 3 became. They reset when the cluster count changes.

And three of quality: three `React.memo` wrappers could never skip a render
because `index.js` handed them freshly-created function props each time; two
comments were left describing declarations that had moved to another file; and
the line-count table above misreported one file.

### Phase 4 — One shared renderer hook

`useClusterVisuals()` returns the memoised inputs every renderer feeds to
`getClusterAppearance`, so the duplicated preamble disappears and drift becomes
structurally impossible.

*Done when:* the five renderers share one subscription path.

**Status: done.** `rendering/useClusterVisuals` owns the five store fields and
the seven arguments every layer was assembling for `getClusterAppearance`.
No renderer calls that rule directly any more; each asks
`appearanceOf(index, { baseColor, allowSelectionColor })`.

Unifying them exposed a third drift, after the two the hook's own comment
records: **`Springs` never passed `forceHidden`**, so hiding a cluster by its eye
control left that cluster's springs hanging in the scene. It was the one layer
that had never been wired to the per-cluster visibility control. Fixing it is the
only behavioural change in this phase — 12 measurements in `srs/overlays`, the
one fixture with springs, and `srs/load` unchanged, so springs still draw
normally.

Selection membership also moved from `selectedParticles.includes(i)` — a linear
scan run once per particle, inside a loop over every particle — to a `Set` built
once.

### Phase 5 — The per-frame pipeline at scale
*Re-specified after measuring. The first version of this phase was written
against the wrong problem size and was nearly skipped on that basis.*

**Systems reach into the millions of particles.** The original profile was taken
at 8,000, where the software rasteriser accounts for 93% of the time and all
application JavaScript is under 1% — and on that evidence this phase was marked
"measured, and skipped". That conclusion was an artefact of benchmarking two
orders of magnitude below the real workload. It is recorded here rather than
quietly corrected, because the reasoning error is the more useful lesson: a
profile answers only the question its inputs pose.

Measured in Node, with nothing competing for the thread
(`BENCH=1 npx react-scripts test --testPathPattern=scale.bench`):

| particles | ms/frame | ms per 100k |
|---|---|---|
| 10,000 | 14 | 144 |
| 100,000 | 146 | 146 |
| 400,000 | 600 | 150 |

Linear at ~148 ms per 100k, so **one million particles is ~1.5 seconds of
JavaScript per frame** before anything is drawn, with roughly a gigabyte
allocated and discarded each time. That is not slow playback; it is not playback.

The cost is not where the phase originally assumed. At 400,000 particles:

| stage | ms | what it allocates |
|---|---|---|
| split lines | 64 | 400k strings |
| `parseConfiguration` | 162 | 400k objects, each with nested `a1`/`a3` |
| `applyPeriodicBoundary` | **237** | another 400k objects |
| `decorate` | 168 | another 400k, plus a matrix each |

Four full passes over every particle, each allocating a complete copy of the
frame. The single largest stage is `applyPeriodicBoundary`, which the original
phase did not mention at all.

**The renderer is a second, independent wall.** Measured at one million
particles:

| per frame | cost |
|---|---|
| compose + `setMatrixAt` for every instance | 12 ms |
| `setColorAt` for every instance | 3 ms |
| triangles submitted, sphere at 16 segments | **512 million** |

The per-instance JavaScript loop is not the problem — 15 ms at a million
particles is affordable. The triangle count is: a high-end GPU sustains tens of
millions of triangles per frame, so 512 million is one to two orders of magnitude
over budget, on whatever hardware the viewer happens to run on.

This matters because the two walls block different things. **Orbiting a static
frame never touches the load path** — it is pure redraw, so movability at a
million particles depends only on the triangle count. Playback needs both fixed.

**Target: one million particles, playable and movable.** That needs two tracks.

**Track A — the data path** (this phase), in order of value:

1. **Parse into typed arrays.** One `Float32Array(3n)` for positions and one for
   each orientation vector, filled in a single pass, instead of `n` objects with
   nested objects inside them. Removes stages 1 and 2 as separate passes.
2. **Wrap in place.** `applyPeriodicBoundary` reads and rewrites a whole array to
   change a few coordinates; it can operate on the typed array without producing
   a second copy.
3. **Stop materialising per-particle derived data.** `typeIndex`, `particleType`
   and `rotationMatrix` are recomputed and re-allocated every frame although
   type assignment is fixed by the topology and the rotation is derivable on
   demand. Renderers can read them from flat arrays or compute them in the write
   loop they already run.
4. **A frame identity.** Once positions are a typed array, consumers need a
   monotonic `frameId` to key memos on, because the buffer is reused and its
   identity no longer changes.

**Accessor first, representation second.** Every renderer, the picking service,
the clustering and the exporters read `positions[i].x` today. Introduce the
accessor that hides the representation, migrate callers behind it while the
underlying array is unchanged, and only then swap the storage. That keeps each
step verifiable by the existing suite instead of producing one large change that
either works or does not.

**Track B is built and measured.** `rendering/impostorSpheres.js` patches a
`MeshStandardMaterial` into a camera-facing quad with the sphere solved in the
fragment shader — a normal from the quad coordinates, a depth from the sphere's
surface. Patched rather than written from scratch so the lighting rig, tone
mapping and shadows keep working; a bespoke material would quietly opt out of all
of it.

Measured on a software rasteriser, which has no GPU at all:

| | spheres | impostors |
|---|---|---|
| redraw at 30,000 particles | 5,309 ms | **852 ms** |
| redraw at 120,000 particles | never drew within 15 s | **2,926 ms** |

Three things the build turned up that the design had not:

- **The radius never reached the shader.** The sphere path takes its size from
  `SphereGeometry(particleRadius)`; the quad is a unit carrier, so an impostor
  was always `scale/2` across and silently ignored the radius control. It was
  invisible only because the default radius is 0.5, which made the two agree by
  coincidence. It is a uniform now, updated without recompiling the shader.
- **Picking did not follow.** The ray met a flat plane that only *looks*
  camera-facing, because the billboarding happens in the shader. `applyImpostorRaycast`
  intersects the same analytic sphere the fragment shader carves out, so what is
  clicked is what is seen. The visual suite caught this, which is the whole
  reason the impostor path was given a fixture.
- **Three's shader chunks are a contract.** The first version failed to compile
  on three counts: `nonPerturbedNormal` must be declared, `geometryNormal` must
  *not* be, and `projectionMatrix` is a vertex-stage uniform, so depth is
  reconstructed from two terms carried across as varyings.

Coverage: the fixtures are 40 particles and the threshold is 50,000, so
`?impostors=1` forces the path on and the suite runs a seventh format through it.
The two paths agree to within two pixels and half a tint unit on identical input.

**Track B — the original sketch, for the record.** A sphere at 16 segments is 512 triangles; a
camera-facing quad with the sphere solved analytically in the fragment shader is
two. That is the 256x reduction the triangle budget needs, and it also removes
the matrix entirely — an impostor needs a position and a radius, three floats and
one, not sixteen. Instance data drops from 64 MB of matrices to 12 MB of
positions, which is also 64 MB less uploaded whenever a frame changes.

Picking has to follow: the ray currently intersects real sphere geometry, and
against impostors it must intersect the analytic sphere instead. The picking
service already owns that in one place, which is why it can change without
touching five renderers.

Springs, patches and nucleotides are unaffected: they do not occur at these
counts.

**Progress on Track A.** The first measurement of the four stages was too coarse
to act on: a single timed sample per stage, so a major GC landing inside one run
moved a stage by 30% and made a change look like a regression. The benchmark
takes medians now.

With that fixed, the stage breakdown pointed somewhere the phase had not
considered. `applyPeriodicBoundary` was the largest stage at 253 ms, and
**`calcCOM` was 181 ms of it** — six trig calls per particle, cos and sin per
axis. Allocation was not its cost, and typed arrays would not have touched it: a
first attempt that cut four allocations per particle down to one moved the number
not at all.

The centre of mass is a *statistic* — it decides where to centre the view — so it
is now estimated from a stride sample above 50,000 particles, and computed
exactly below that, leaving small systems bit-for-bit unchanged.

| | before | after |
|---|---|---|
| `calcCOM` at 400k | 181 ms | **18 ms** |
| `applyPeriodicBoundary` at 400k | 253 ms | **99 ms** |
| whole frame | 148 ms per 100k | **114 ms per 100k** |

Writing the accuracy test for that turned up something worth knowing
independently: **a structure filling its periodic box has no meaningful centre of
mass at all.** A circular mean is the angle of the summed unit vectors, and for
points spread evenly around the circle that sum is near zero, so its angle is
decided by noise — the full computation is as arbitrary as a sampled one. The
test asserts the resultant length directly rather than comparing two arbitrary
answers. Sampling agrees closely wherever the statistic is defined: a clumped
structure to within 0.5 box units, a 314,432-particle lattice to within 1.

Remaining at 400k: parsing 157 ms, `decorate` 136 ms, the wrap loop 81 ms,
splitting lines 68 ms. Those are the allocation-bound stages the typed-array work
targets.

**Done when:** one million particles both plays and orbits — the load path a
fraction of its current 1.5 s, and the frame drawing in single-digit millions of
triangles rather than 512 million — measured by the same benchmark, with the
visual suite unchanged at the sizes it covers.

### Phase 6 — Rebalance verification

Move UI-wiring checks into jsdom tests, which are fast and deterministic. Keep
the browser suite for genuinely visual behaviour.

*Done when:* browser suite under 120s, unit suite under 10s.

---

## What this plan deliberately does not do

- **No rewrite.** Every phase is a refactor with tests either side.
- **No new abstraction without two callers.** The shared renderer hook in Phase 4
  is justified by five existing duplicates; nothing here is built for a caller
  that does not exist yet.
- **No performance work on faith.** Phase 5 is gated on a profile.

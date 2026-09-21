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
| `ClusterList` | 63 |
| `useClusterPublication` | 68 |
| `ClusterParameters` | 71 |
| `ClusterSourceControls` | 72 |
| `useClusterColours` | 76 |
| `ClusterHistogram` | 89 |
| `useClusterSource` | 91 |
| `index.js` | **385** |

`index.js` is the composition root and still misses the 200-line target. What
remains is the selection-controls markup, the statistics computation, and the
handlers wiring the pieces together — one more component's worth. It is no longer
a file with seven responsibilities, which was the point, but the number is not
met and should not be reported as though it were.

The split is behaviour-preserving: 224 tests and the full visual suite unchanged
after each extraction, which is how a refactor of this size stays honest.

### Phase 4 — One shared renderer hook

`useClusterVisuals()` returns the memoised inputs every renderer feeds to
`getClusterAppearance`, so the duplicated preamble disappears and drift becomes
structurally impossible.

*Done when:* the five renderers share one subscription path.

### Phase 5 — Stable frame identity
*The one with real risk. Do it last, and only if measurement justifies it.*

Give each frame a monotonic `frameId` so consumers key off a number rather than
array identity. Optionally move positions to a `Float32Array` behind an accessor.

*Done when:* a profile shows the win. **If no profile shows a win, skip this
phase** — it is speculative until measured.

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

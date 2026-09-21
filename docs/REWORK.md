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

### Phase 1 — Extract the load pipeline

New `src/loading/`: `classifyDrop`, `loadSimulation`, `loadFrame`. The staleness
token becomes an explicit argument rather than a closure, so a missing check is a
type-level omission rather than an invisible one. `App.js` keeps UI composition
and playback.

*Done when:* `App.js` is under 250 lines and contains no `getState()`.

### Phase 2 — Fix state ownership

Per-store `selectors.js`. A lint rule banning bare `useXStore()`. Narrow `App`'s
subscriptions so it stops re-rendering every frame. Add `src/store/commands.js`
for actions that span stores, and remove the `clusteringStore → overlayStore`
import.

*Done when:* no component subscribes to a whole store; no store imports another.

### Phase 3 — Split `ClusteringPane`

Hooks: `useClusterSource`, `useClusterColours`, `useClusterPublication`.
Presentational: `ClusterHistogram`, `ClusterList`, `ClusterSourceControls`. The
pane becomes composition.

*Done when:* no file in the folder exceeds 200 lines.

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

/**
 * Named selectors, so components subscribe to values rather than to stores.
 *
 * A bare `useParticleStore()` re-renders its component on *any* write to that
 * store. `App` did exactly that for two stores at once, so every trajectory
 * frame re-rendered a 700-line component and the control bar with it — which is
 * what the `SceneContent` memo and the identity-stable `currentBoxSize` guard
 * exist to prevent one level further down.
 *
 * Selectors defined here rather than inline because an inline arrow that builds
 * an object is a new reference every render, which defeats the comparison it is
 * meant to feed. Use `useShallow` for the grouped ones.
 */

/**
 * How many particles are loaded — not the array.
 *
 * `App` only ever asks whether there is a structure and how big it is. Taking
 * the count means dragging particles along an axis, which rewrites every
 * position, no longer re-renders the whole application.
 */
export const selectParticleCount = (state) => state.positions.length;

/**
 * Guards a load against being overtaken by a newer one.
 *
 * Dropping a second simulation while the first is still reading used to let the
 * slower one finish last and overwrite the newer scene. The fix was an
 * `isStale()` closure with checks placed by hand after each `await` — six of
 * them, and adding a seventh `await` without one silently reintroduced the bug.
 *
 * Here the check is part of awaiting: `step()` performs the await and then
 * throws `StaleLoad` if a newer load has started. Nothing that goes through
 * `step` can forget, and `runLoad` swallows `StaleLoad` so a superseded load
 * simply stops without touching the store or reporting an error.
 */

export class StaleLoad extends Error {
  constructor() {
    super('load superseded by a newer one');
    this.name = 'StaleLoad';
  }
}

/**
 * A monotonic source of load tokens. The newest token is the only live one.
 */
export function createLoadTokens() {
  let latest = 0;
  return {
    /** Start a load and get its signal. Immediately invalidates any earlier one. */
    begin() {
      const mine = ++latest;
      return { stale: () => mine !== latest };
    },
  };
}

/** Await `work`, then abort if a newer load has begun. */
export async function step(signal, work) {
  const value = await work;
  if (signal.stale()) throw new StaleLoad();
  return value;
}

/** Abort here if a newer load has begun. For checks between awaits. */
export function checkpoint(signal) {
  if (signal.stale()) throw new StaleLoad();
}

/**
 * Runs a load, reporting only outcomes the caller can act on.
 *
 * Returns `{ ok: true }`, `{ ok: false, message }` for something worth telling
 * the user, or `{ ok: false, superseded: true }` when a newer load took over —
 * which is not a failure and must not raise an alert or reset the UI.
 */
export async function runLoad(work) {
  try {
    await work();
    return { ok: true };
  } catch (error) {
    if (error instanceof StaleLoad) return { ok: false, superseded: true };
    return { ok: false, message: error.message, error };
  }
}

/** A failure with a message meant for the person, not the console. */
export class LoadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LoadError';
  }
}

/**
 * A trajectory frame, behind an accessor.
 *
 * Positions are an array of `{x, y, z, a1, a3, typeIndex, particleType,
 * rotationMatrix}` objects today — one per particle, rebuilt from scratch every
 * frame. At a million particles that is about 1.5 seconds of parsing, wrapping
 * and allocating before anything is drawn, and roughly a gigabyte of garbage per
 * frame. The representation has to become typed arrays.
 *
 * Fourteen modules read `positions[i].x` directly, so swapping the storage under
 * them in one change would be one large edit that either works or does not. This
 * accessor goes in first, callers move behind it while the underlying array is
 * untouched, and only then does the storage change. Each step stays verifiable
 * by the suite that already exists.
 *
 * `frameId` exists for the step after that: once positions live in a reused
 * buffer, array identity stops changing and `useMemo` on `positions` silently
 * stops invalidating. Consumers key on the number instead.
 */

let nextFrameId = 1;

/**
 * Wraps the current array-of-objects representation.
 *
 * Deliberately not a class with getters per field: at a million particles the
 * megamorphic property access that produces is itself a cost. The shape here is
 * a small object of functions, so the typed-array version can be swapped in
 * without callers noticing.
 */
export function frameFromObjects(positions, { frameId = nextFrameId++ } = {}) {
  return {
    frameId,
    count: positions.length,

    /** Position of one particle, written into `target` to avoid allocating. */
    positionOf(index, target) {
      const p = positions[index];
      return target.set(p.x, p.y, p.z);
    },

    /** The orientation vectors, or null for formats that carry none. */
    a1Of: (index) => positions[index]?.a1 ?? null,
    a3Of: (index) => positions[index]?.a3 ?? null,

    typeIndexOf: (index) => positions[index]?.typeIndex ?? 0,
    particleTypeOf: (index) => positions[index]?.particleType,
    rotationOf: (index) => positions[index]?.rotationMatrix ?? null,

    /**
     * The underlying array.
     *
     * An escape hatch for callers not yet migrated — exporters, the MGL path,
     * clustering. Every use is a caller that still assumes the representation,
     * so this is also the migration's to-do list.
     */
    raw: () => positions,
  };
}

/** A fresh id, for a frame built without going through `frameFromObjects`. */
export const nextId = () => nextFrameId++;

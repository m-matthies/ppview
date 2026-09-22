/**
 * Decoded frames, kept so playing a trajectory twice does not parse it twice.
 *
 * Reading a frame is dominated by the text scan — 121 ms of the 144 ms it takes
 * at 400,000 particles — and that is close to its floor: 12.9 MB of characters
 * and 3.6 million numbers per frame. Three separate attempts to make the scanner
 * faster moved it by less than the measurement noise.
 *
 * So the way to play a large trajectory is not to scan faster but to scan once.
 * Playback loops, scrubbing goes back and forth, and a comparison flips between
 * two frames — all of which revisit frames that were parsed moments ago. A hit
 * here skips the scan, the centre of mass and the wrap, leaving only the work of
 * handing particles to the scene.
 *
 * Bounded by bytes rather than by frame count, because a frame is 36 bytes per
 * particle: 3.6 MB at a hundred thousand and 36 MB at a million. Counting frames
 * would mean a budget that is either useless for small systems or ruinous for
 * large ones.
 */

/** Positions, and the two orientation vectors when the format carries them. */
const bytesOf = (entry) =>
  entry.positions.byteLength + (entry.a1?.byteLength ?? 0) + (entry.a3?.byteLength ?? 0);

export const DEFAULT_BUDGET_BYTES = 512 * 1024 * 1024;

export function createFrameCache({ budgetBytes = DEFAULT_BUDGET_BYTES } = {}) {
  // A Map iterates in insertion order, which is what makes least-recently-used
  // eviction a delete-and-reinsert rather than a separate ordering structure.
  let entries = new Map();
  let bytes = 0;
  let owner = null;
  let hits = 0;
  let misses = 0;

  const evictUntilItFits = () => {
    for (const key of entries.keys()) {
      if (bytes <= budgetBytes) return;
      bytes -= bytesOf(entries.get(key));
      entries.delete(key);
    }
  };

  return {
    /**
     * Frames belong to one trajectory. Loading another invalidates every one of
     * them — the indices mean something different now, and keeping them would
     * show the old structure's coordinates in the new scene.
     */
    useTrajectory(file) {
      if (owner === file) return;
      owner = file;
      entries = new Map();
      bytes = 0;
    },

    get(frameNumber) {
      const entry = entries.get(frameNumber);
      if (!entry) { misses++; return null; }
      // Reinsert, so the most recently used frame is last and therefore the
      // last to be evicted.
      entries.delete(frameNumber);
      entries.set(frameNumber, entry);
      hits++;
      return entry;
    },

    /** Stores copies: the parser's buffers are reused by the next frame. */
    put(frameNumber, frame) {
      const entry = {
        count: frame.count,
        time: frame.time,
        boxSize: frame.boxSize,
        energy: frame.energy,
        hasOrientation: frame.hasOrientation,
        positions: frame.positions.slice(0, frame.count * 3),
        a1: frame.hasOrientation ? frame.a1.slice(0, frame.count * 3) : null,
        a3: frame.hasOrientation ? frame.a3.slice(0, frame.count * 3) : null,
      };
      const size = bytesOf(entry);
      // A single frame larger than the whole budget is not worth evicting
      // everything else for, and would be evicted again immediately.
      if (size > budgetBytes) return;

      if (entries.has(frameNumber)) bytes -= bytesOf(entries.get(frameNumber));
      entries.set(frameNumber, entry);
      bytes += size;
      evictUntilItFits();
    },

    /** For tests and for anyone wondering whether it is doing anything. */
    stats: () => ({ frames: entries.size, bytes, hits, misses }),
  };
}

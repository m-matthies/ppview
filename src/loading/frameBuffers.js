/**
 * The typed arrays a frame is read into, reused between frames.
 *
 * Playback would otherwise allocate three arrays per frame and leave the
 * collector to clean up after it — at a million particles that is 36 MB a frame.
 * They only ever grow, so a trajectory settles on one set after its first frame.
 */
export function createFrameBuffers() {
  let capacity = 0;
  let positions = new Float32Array(0);
  let a1 = new Float32Array(0);
  let a3 = new Float32Array(0);
  return {
    ensure(count) {
      if (count <= capacity) return;
      capacity = count;
      positions = new Float32Array(count * 3);
      a1 = new Float32Array(count * 3);
      a3 = new Float32Array(count * 3);
    },
    get positions() { return positions; },
    get a1() { return a1; },
    get a3() { return a3; },
  };
}

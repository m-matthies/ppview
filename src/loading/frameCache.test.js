import { createFrameCache } from './frameCache';

const frameOf = (count, { time = 0, orientation = true } = {}) => ({
  count,
  time,
  boxSize: [10, 10, 10],
  energy: [0, 0, 0],
  hasOrientation: orientation,
  positions: new Float32Array(count * 3).fill(1),
  a1: new Float32Array(count * 3).fill(2),
  a3: new Float32Array(count * 3).fill(3),
});

const fileA = { name: 'a.dat' };
const fileB = { name: 'b.dat' };

describe('frameCache', () => {
  it('returns a frame it has seen, and null for one it has not', () => {
    const cache = createFrameCache();
    cache.useTrajectory(fileA);
    expect(cache.get(0)).toBeNull();
    cache.put(0, frameOf(10, { time: 500 }));
    expect(cache.get(0).time).toBe(500);
  });

  it('copies the buffers, because the parser reuses its own', () => {
    // The whole point of the reusable buffers is that the next frame overwrites
    // them. Storing a reference would mean every cached frame quietly became
    // the most recent one.
    const cache = createFrameCache();
    cache.useTrajectory(fileA);
    const frame = frameOf(10);
    cache.put(0, frame);
    frame.positions.fill(99);
    expect(cache.get(0).positions[0]).toBe(1);
  });

  it('drops everything when the trajectory changes', () => {
    // Frame indices mean something different in another file; serving them
    // would show the old structure's coordinates in the new scene.
    const cache = createFrameCache();
    cache.useTrajectory(fileA);
    cache.put(0, frameOf(10));
    cache.useTrajectory(fileB);
    expect(cache.get(0)).toBeNull();
    expect(cache.stats().bytes).toBe(0);
  });

  it('keeps serving the same trajectory across repeated calls', () => {
    const cache = createFrameCache();
    cache.useTrajectory(fileA);
    cache.put(3, frameOf(10));
    cache.useTrajectory(fileA);
    expect(cache.get(3)).not.toBeNull();
  });

  it('stays inside its byte budget', () => {
    // 10 particles is 120 bytes of positions plus 240 of orientation: 360 each.
    const cache = createFrameCache({ budgetBytes: 1000 });
    cache.useTrajectory(fileA);
    for (let i = 0; i < 10; i++) cache.put(i, frameOf(10));
    expect(cache.stats().bytes).toBeLessThanOrEqual(1000);
    expect(cache.stats().frames).toBeLessThanOrEqual(3);
  });

  it('evicts the least recently used frame, not the oldest stored', () => {
    const cache = createFrameCache({ budgetBytes: 1100 });   // room for three
    cache.useTrajectory(fileA);
    cache.put(0, frameOf(10));
    cache.put(1, frameOf(10));
    cache.put(2, frameOf(10));
    cache.get(0);                     // frame 0 is now the most recently used
    cache.put(3, frameOf(10));        // something has to go

    expect(cache.get(0)).not.toBeNull();   // kept: recently used
    expect(cache.get(1)).toBeNull();       // evicted: least recently used
  });

  it('refuses a frame larger than the whole budget rather than emptying itself', () => {
    const cache = createFrameCache({ budgetBytes: 1000 });
    cache.useTrajectory(fileA);
    cache.put(0, frameOf(10));
    cache.put(1, frameOf(10_000));         // far past the budget
    expect(cache.get(1)).toBeNull();
    expect(cache.get(0)).not.toBeNull();   // the small frame survived
  });

  it('stores no orientation for formats that carry none', () => {
    const cache = createFrameCache();
    cache.useTrajectory(fileA);
    cache.put(0, frameOf(100, { orientation: false }));
    const entry = cache.get(0);
    expect(entry.a1).toBeNull();
    // Positions only: 100 particles x 3 floats x 4 bytes.
    expect(cache.stats().bytes).toBe(1200);
  });

  it('replaces a frame without double-counting its bytes', () => {
    const cache = createFrameCache();
    cache.useTrajectory(fileA);
    cache.put(0, frameOf(10));
    const afterFirst = cache.stats().bytes;
    cache.put(0, frameOf(10));
    expect(cache.stats().bytes).toBe(afterFirst);
    expect(cache.stats().frames).toBe(1);
  });

  it('counts hits and misses, so the cache can be shown to be working', () => {
    const cache = createFrameCache();
    cache.useTrajectory(fileA);
    cache.get(0);
    cache.put(0, frameOf(10));
    cache.get(0);
    cache.get(0);
    expect(cache.stats()).toMatchObject({ hits: 2, misses: 1 });
  });
});

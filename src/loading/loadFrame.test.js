import { loadFrame } from './loadFrame';
import { LoadError } from './staleness';

const sceneOf = () => {
  const calls = {};
  const record = (key) => (value) => { calls[key] = value; };
  return {
    calls,
    setPositions: record('positions'),
    setCurrentBoxSize: record('boxSize'),
    setCurrentTime: record('time'),
    setCurrentEnergy: record('energy'),
  };
};

// Two frames of two particles, so byte offsets actually matter.
const FRAMES = [
  't = 0', 'b = 60 60 60', 'E = 1 2 3', '1 2 3 1 0 0 0 0 1', '4 5 6 1 0 0 0 0 1',
  't = 500', 'b = 60 60 60', 'E = 4 5 6', '7 8 9 1 0 0 0 0 1', '1 1 1 1 0 0 0 0 1',
].join('\n');

const secondFrameAt = FRAMES.indexOf('t = 500');

const trajectoryFile = (text = FRAMES) => ({
  size: text.length,
  // The frame is read as bytes now, the way it comes off disk — the compiled
  // core is handed the buffer rather than a decoded string.
  slice: (start, end) => ({
    text: async () => text.slice(start, end),
    arrayBuffer: async () => new TextEncoder().encode(text.slice(start, end)).buffer,
  }),
});

// Two particle types, so getParticleType has something to map onto.
const TOP_DATA = { totalParticles: 2, particleTypes: [{ typeIndex: 0 }] };

describe('loadFrame', () => {
  it('reads only the requested frame', async () => {
    // The index holds byte offsets; slicing the wrong range silently yields
    // another frame's coordinates, which is what a CRLF off-by-one produced.
    const scene = sceneOf();
    await loadFrame({
      file: trajectoryFile(),
      index: [0, secondFrameAt],
      frameNumber: 1,
      topData: TOP_DATA,
      scene,
    });
    expect(scene.calls.time).toBe(500);
    expect(scene.calls.energy).toEqual([4, 5, 6]);
    expect(scene.calls.positions).toHaveLength(2);
  });

  it('reads the first frame without running into the second', async () => {
    const scene = sceneOf();
    await loadFrame({
      file: trajectoryFile(),
      index: [0, secondFrameAt],
      frameNumber: 0,
      topData: TOP_DATA,
      scene,
    });
    expect(scene.calls.time).toBe(0);
    expect(scene.calls.positions).toHaveLength(2);
  });

  it('runs the last frame to the end of the file', async () => {
    const scene = sceneOf();
    await loadFrame({
      file: trajectoryFile(),
      index: [0, secondFrameAt],
      frameNumber: 1,
      topData: TOP_DATA,
      scene,
    });
    expect(scene.calls.positions).toHaveLength(2);
  });

  it('attaches a type to every particle, and keeps the orientation vectors', async () => {
    // Type comes from the topology, which is the only place the mapping exists.
    //
    // Orientation is deliberately *not* turned into a matrix here. Only patch
    // cones and raspberry beads read one, and rotationMatrixOf derives it from
    // these vectors — building one per particle per frame cost 102 ms of the
    // 454 ms spent loading a 400,000-particle frame, almost all of it for
    // particles that never used it.
    const scene = sceneOf();
    await loadFrame({
      file: trajectoryFile(), index: [0, secondFrameAt], frameNumber: 0,
      topData: TOP_DATA, scene,
    });
    scene.calls.positions.forEach(p => {
      expect(p).toHaveProperty('typeIndex');
      expect(p.a1).toBeDefined();
      expect(p.a3).toBeDefined();
      expect(p.rotationMatrix).toBeUndefined();
    });
  });

  it.each([-1, 2, 99])('refuses frame index %p in words the person can read', async (n) => {
    await expect(loadFrame({
      file: trajectoryFile(), index: [0, secondFrameAt], frameNumber: n,
      topData: TOP_DATA, scene: sceneOf(),
    })).rejects.toThrow(LoadError);
  });

  it('refuses to interpret a frame with no topology', async () => {
    await expect(loadFrame({
      file: trajectoryFile(), index: [0], frameNumber: 0,
      topData: null, scene: sceneOf(),
    })).rejects.toThrow(/No topology loaded/);
  });

  it('serves an MGL frame from memory rather than slicing', async () => {
    const scene = sceneOf();
    // The shape convertMGLToPPViewFormat actually reads: a position object, an
    // {r,g,b} colour used as the type key, and a patches array.
    const particle = (x, colour) => ({
      position: { x, y: x, z: x },
      color: colour,
      type: 'C',
      patches: [],
      properties: {},
      radius: 0.5,
    });
    const mgl = {
      mglTrajectoryData: {
        frameCount: 2,
        frames: [
          { box: [10, 10, 10], particles: [particle(1, { r: 0, g: 0, b: 255 })] },
          { box: [10, 10, 10], particles: [particle(2, { r: 255, g: 0, b: 0 })] },
        ],
      },
    };
    await loadFrame({ file: mgl, index: [0, 1], frameNumber: 1, topData: TOP_DATA, scene });
    // MGL frames carry no simulation time, so the frame number stands in.
    expect(scene.calls.time).toBe(1);
    expect(scene.calls.energy).toEqual([0]);
  });

  it('reports an MGL frame past the end', async () => {
    const mgl = { mglTrajectoryData: { frameCount: 1, frames: [{ box: [1, 1, 1], particles: [] }] } };
    // Rejected on the frame count before the parser is ever reached.
    await expect(loadFrame({
      file: mgl, index: [0, 1], frameNumber: 1, topData: TOP_DATA, scene: sceneOf(),
    })).rejects.toThrow(/1 frames/);
  });
});

describe('the frame the scene is showing', () => {
  it('is recorded beside the positions, not after them', async () => {
    // Bonds, cluster colours and the pane's caption all key off this. Written
    // in a later microtask it lagged the positions by a commit, so the new
    // frame's bonds were drawn against the old frame's coordinates.
    const order = [];
    const scene = {
      ...sceneOf(),
      setPositions: () => order.push('positions'),
      setLoadedConfigIndex: (n) => order.push(`frame:${n}`),
    };
    await loadFrame({
      file: trajectoryFile(), index: [0, secondFrameAt], frameNumber: 1,
      topData: TOP_DATA, scene,
    });
    expect(order).toEqual(['positions', 'frame:1']);
  });

  it('is left alone by a bag that does not ask for it', async () => {
    // The time view captures frames without moving the scene.
    await expect(loadFrame({
      file: trajectoryFile(), index: [0, secondFrameAt], frameNumber: 0,
      topData: TOP_DATA, scene: sceneOf(),
    })).resolves.toBeUndefined();
  });
});

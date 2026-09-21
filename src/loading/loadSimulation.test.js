import { loadSimulation } from './loadSimulation';
import { createLoadTokens, runLoad, StaleLoad } from './staleness';

// The pipeline uses two things from a File: text() for parsing, and stream()
// for building the trajectory index without reading it all into memory.
const fileOf = (name, text) => ({
  name,
  text: async () => text,
  stream: () => new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  }),
});

const sceneOf = () => {
  const calls = {};
  const record = (key) => (...args) => { calls[key] = args.length > 1 ? args : args[0]; };
  return {
    calls,
    setTopData: record('topData'),
    setPositions: record('positions'),
    setCurrentBoxSize: record('boxSize'),
    setCurrentTime: record('time'),
    setCurrentEnergy: record('energy'),
    setConfigIndex: record('configIndex'),
    setTotalConfigs: record('totalConfigs'),
    setTrajFile: record('trajFile'),
    setFormatParticleRadius: record('formatRadius'),
  };
};

// Raspberry, because it is the one self-contained topology: Lorenzo and Flavio
// need companion files, which would make these tests about the file map rather
// than about the pipeline.
const TOPOLOGY = fileOf('system.top', [
  '40 2',
  'iP 0 1.0 0 0.0,0.0,1.0 0.0,0.0,1.0',
  'iR 0.0,0.0,1.0 0.3',
  'iC 0 40 0 0',
].join('\n'));
const TRAJECTORY_TEXT = [
  't = 0', 'b = 60 60 60', 'E = 0 0 0',
  ...Array.from({ length: 40 }, () => '1 2 3 1 0 0 0 0 1'),
].join('\n');
const TRAJECTORY = fileOf('run.dat', TRAJECTORY_TEXT);

describe('loadSimulation', () => {
  it('loads a topology and indexes its trajectory', async () => {
    const scene = sceneOf();
    const files = [TOPOLOGY, TRAJECTORY];
    const outcome = await runLoad(() => loadSimulation({
      files,
      categorized: { topology: { file: TOPOLOGY, format: 'raspberry' }, trajectory: TRAJECTORY },
      signal: createLoadTokens().begin(),
      scene,
    }));
    expect(outcome.ok).toBe(true);
    expect(scene.calls.topData).toBeTruthy();
    expect(scene.calls.trajFile).toBe(TRAJECTORY);
    expect(scene.calls.configIndex).toEqual([0]);
    expect(scene.calls.totalConfigs).toBe(1);
  });

  it('reads PATCHY_radius from an input file as the format radius', async () => {
    // Not setParticleRadius: the value has to become the baseline that intrinsic
    // geometry is measured against, or beads and nucleotides are scaled twice.
    const scene = sceneOf();
    await runLoad(() => loadSimulation({
      files: [TOPOLOGY, TRAJECTORY],
      categorized: {
        inputFile: fileOf('input', 'T = 0.1\nPATCHY_radius = 2.5\n'),
        topology: { file: TOPOLOGY, format: 'raspberry' },
        trajectory: TRAJECTORY,
      },
      signal: createLoadTokens().begin(),
      scene,
    }));
    expect(scene.calls.formatRadius).toBe(2.5);
  });

  it('carries on when the input file cannot be read', async () => {
    const scene = sceneOf();
    const broken = { name: 'input', text: async () => { throw new Error('unreadable'); } };
    const outcome = await runLoad(() => loadSimulation({
      files: [TOPOLOGY, TRAJECTORY],
      categorized: {
        inputFile: broken,
        topology: { file: TOPOLOGY, format: 'raspberry' },
        trajectory: TRAJECTORY,
      },
      signal: createLoadTokens().begin(),
      scene,
    }));
    expect(outcome.ok).toBe(true);
    expect(scene.calls.topData).toBeTruthy();
  });

  it('asks for a topology in words the person can act on', async () => {
    const outcome = await runLoad(() => loadSimulation({
      files: [TRAJECTORY],
      categorized: { trajectory: TRAJECTORY },
      signal: createLoadTokens().begin(),
      scene: sceneOf(),
    }));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/No topology file detected/);
  });

  it('asks for a trajectory the same way', async () => {
    const outcome = await runLoad(() => loadSimulation({
      files: [TOPOLOGY],
      categorized: { topology: { file: TOPOLOGY, format: 'raspberry' } },
      signal: createLoadTokens().begin(),
      scene: sceneOf(),
    }));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/No trajectory file detected/);
  });

  it('stops without writing anything more once a newer load begins', async () => {
    // The bug this replaces: a slow load finishing last and overwriting the
    // scene a newer drop already claimed.
    const tokens = createLoadTokens();
    const signal = tokens.begin();
    const scene = sceneOf();
    const slowTopology = {
      ...fileOf('system.top', ''),
      text: async () => {
        tokens.begin();              // a second drop lands while we are reading
        return '40 2\niC 0 40 -1 -1';
      },
    };
    const outcome = await runLoad(() => loadSimulation({
      files: [slowTopology, TRAJECTORY],
      categorized: { topology: { file: slowTopology, format: 'raspberry' }, trajectory: TRAJECTORY },
      signal,
      scene,
    }));
    expect(outcome.superseded).toBe(true);
    expect(scene.calls.topData).toBeUndefined();
    expect(scene.calls.trajFile).toBeUndefined();
  });

  it('does not index the topology file as a trajectory', async () => {
    // init.top ranks above an unhinted .dat in the name-based fallback, so
    // without an exclusion the topology was chosen as the trajectory.
    const topology = { ...fileOf('init.top', '40 2\niC 0 40 -1 -1') };
    const data = fileOf('sim.dat', TRAJECTORY_TEXT);
    const scene = sceneOf();
    const outcome = await runLoad(() => loadSimulation({
      files: [topology, data],
      categorized: { topology: { file: topology, format: 'raspberry' } },
      signal: createLoadTokens().begin(),
      scene,
    }));
    expect(outcome.ok).toBe(true);
    expect(scene.calls.trajFile).toBe(data);
  });

  it('propagates StaleLoad rather than reporting it as a failure', async () => {
    const tokens = createLoadTokens();
    const signal = tokens.begin();
    tokens.begin();
    await expect(loadSimulation({
      files: [TOPOLOGY, TRAJECTORY],
      categorized: {
        inputFile: fileOf('input', 'T = 0.1'),
        topology: { file: TOPOLOGY, format: 'raspberry' },
        trajectory: TRAJECTORY,
      },
      signal,
      scene: sceneOf(),
    })).rejects.toThrow(StaleLoad);
  });
});

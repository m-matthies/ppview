import { classifyDrop, pickTopologyFile, pickTrajectoryFile } from './resolveFiles';

const named = (name) => ({ name });

describe('classifyDrop', () => {
  it('adds to the scene when only cluster files land on a loaded one', () => {
    const drop = { clusterFiles: [named('clusters.json')] };
    expect(classifyDrop(drop, { sceneIsLoaded: true })).toBe('overlays-only');
  });

  it('replaces the scene when cluster files arrive with a simulation', () => {
    const drop = { topology: {}, clusterFiles: [named('clusters.json')] };
    expect(classifyDrop(drop, { sceneIsLoaded: true })).toBe('simulation');
  });

  it('replaces the scene when cluster files arrive with nothing loaded', () => {
    // There is nothing to overlay onto yet, so this has to take the load path,
    // which holds the file until a particle count exists to validate against.
    const drop = { clusterFiles: [named('clusters.json')] };
    expect(classifyDrop(drop, { sceneIsLoaded: false })).toBe('simulation');
  });

  it.each(['topology', 'trajectory', 'mglFile', 'mglTrajectory'])(
    'treats a drop carrying %s as a simulation', (key) => {
      expect(classifyDrop({ [key]: {}, clusterFiles: [] }, { sceneIsLoaded: true }))
        .toBe('simulation');
    });

  it('handles a drop with no cluster files at all', () => {
    expect(classifyDrop({}, { sceneIsLoaded: true })).toBe('simulation');
  });
});

describe('pickTopologyFile', () => {
  it('prefers the detected topology and keeps its format', () => {
    const detected = { file: named('system.top'), format: 'raspberry' };
    expect(pickTopologyFile({ topology: detected }, []))
      .toEqual({ file: detected.file, format: 'raspberry' });
  });

  it('falls back to any .top file, leaving the format to be detected', () => {
    const files = [named('notes.txt'), named('system.top')];
    expect(pickTopologyFile({}, files)).toEqual({ file: files[1], format: null });
  });

  it('returns null when there is nothing to parse', () => {
    expect(pickTopologyFile({}, [named('trajectory.dat')])).toBeNull();
  });
});

describe('pickTrajectoryFile', () => {
  it('prefers the detected trajectory', () => {
    const detected = named('run.dat');
    expect(pickTrajectoryFile({ trajectory: detected }, [])).toBe(detected);
  });

  it.each(['run.traj', 'last_conf.dat', 'init.dat', 'output.conf'])(
    'recognises %s as a fallback candidate', (name) => {
      expect(pickTrajectoryFile({}, [named(name)])).toEqual(named(name));
    });

  it('includes init-named files, which one of the two old copies did not', () => {
    // App.js resolved the trajectory twice with different criteria: the list
    // used to *set* the trajectory included "init", the one used to build its
    // index did not — so the two could disagree about which file to read.
    const files = [named('init.dat')];
    expect(pickTrajectoryFile({}, files)).toEqual(named('init.dat'));
  });

  it('prioritises traj over last over init over conf', () => {
    const files = [named('a.conf'), named('b_init.dat'), named('c_last.dat'), named('d_traj.dat')];
    expect(pickTrajectoryFile({}, files).name).toBe('d_traj.dat');
  });

  it('will not claim a file already spoken for', () => {
    // looksLikeTrajectory matches "init" anywhere in a name and the ranking puts
    // it above an unhinted .dat, so `init.top` + `sim.dat` used to select the
    // *topology* as the trajectory and index frames out of it.
    const topology = named('init.top');
    const data = named('sim.dat');
    expect(pickTrajectoryFile({}, [topology, data]).name).toBe('init.top');
    expect(pickTrajectoryFile({}, [topology, data], { exclude: [topology] }).name)
      .toBe('sim.dat');
  });

  it('ignores undefined entries in the exclusion list', () => {
    // categorized.inputFile is often absent; that must not exclude everything.
    const data = named('run.dat');
    expect(pickTrajectoryFile({}, [data], { exclude: [undefined, null] })).toBe(data);
  });

  it('returns null when nothing looks like a trajectory', () => {
    expect(pickTrajectoryFile({}, [named('system.top'), named('readme.md')])).toBeNull();
  });
});

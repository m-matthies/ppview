import {
  analyzeTopologyFile,
  isTrajectoryFile,
  isInputFile,
  isPatchFile,
  isMGLFile,
  isMGLTrajectoryFile,
  isClusterFile,
} from './signatures';

const lines = (text) => text.trim().split('\n');

// Smallest file of each format that still carries its distinguishing marks.
// Detection order matters here — several of these would match more than one
// predicate, and which one wins is the contract.
const SRS = lines(`
40 5 2 1
iP 0 0 1.0 0.0 0.0 1.0
iS 0 10.0 1.0 0.0 0.0 1.0
0 0 0.5 1.0 1 0
`);

const RASPBERRY = lines(`
40 2
iP 0 1.0 0 0.0,0.0,1.0 0.0,0.0,1.0
iR 0.0,0.0,1.0 0.3
iC 0 40 0 0
`);

const OXDNA = lines(`
40 5
1 A -1 1
1 G 0 2
`);

const FLAVIO = lines(`
4 2
0 1 0 1
`);

const LORENZO = lines(`
40 2
20 3 patchesA.dat
20 4 patchesB.dat
`);

describe('analyzeTopologyFile', () => {
  it.each([
    ['SRS springs', SRS, 'topology-srs_springs'],
    ['raspberry', RASPBERRY, 'topology-raspberry'],
    ['oxDNA nucleotide', OXDNA, 'topology-oxdna_nucleotide'],
    ['Flavio', FLAVIO, 'topology-flavio'],
    ['Lorenzo', LORENZO, 'topology-lorenzo'],
  ])('recognises %s', (_name, content, expected) => {
    expect(analyzeTopologyFile(content)).toBe(expected);
  });

  it('checks SRS before the two-token header rule', () => {
    // An SRS header has four tokens, so the header check below would reject it
    // outright. Order is the only thing keeping .psp files working.
    expect(analyzeTopologyFile(SRS)).toBe('topology-srs_springs');
  });

  it('needs an iS line to call something SRS, not just a 4-integer header', () => {
    const noSprings = lines(`
40 5 2 1
iP 0 0 1.0 0.0 0.0 1.0
`);
    expect(analyzeTopologyFile(noSprings)).toBeNull();
  });

  it('ignores comment lines when finding the SRS header', () => {
    const commented = ['# a comment', ...SRS];
    expect(analyzeTopologyFile(commented)).toBe('topology-srs_springs');
  });

  it('checks raspberry before oxDNA, since both carry a two-token header', () => {
    expect(analyzeTopologyFile(RASPBERRY)).toBe('topology-raspberry');
  });

  it.each(['A', 'T', 'G', 'C', 'U', 'a', 't', 'g', 'c', 'u'])(
    'accepts %s as a nucleotide letter', (base) => {
      expect(analyzeTopologyFile(lines(`40 5\n1 ${base} -1 1`))).toBe('topology-oxdna_nucleotide');
    });

  it('does not mistake a four-token Lorenzo line for a nucleotide', () => {
    // The second token has to be a single base letter, not any word.
    expect(analyzeTopologyFile(lines('40 2\n20 3 patches.dat extra')))
      .toBe('topology-lorenzo');
  });

  it.each([
    ['too few lines', ['40 2']],
    ['a non-numeric header', lines('not a header\n1 A -1 1')],
    ['a three-token header', lines('40 2 9\n1 A -1 1')],
    ['a zero particle count', lines('0 2\n1 A -1 1')],
    ['a zero type count', lines('40 0\n1 A -1 1')],
  ])('returns null for %s', (_name, content) => {
    expect(analyzeTopologyFile(content)).toBeNull();
  });
});

describe('isClusterFile', () => {
  const body = '{"clusters":[{"particles":[0,1]}]}';

  it('accepts a .json file with a particle list', () => {
    expect(isClusterFile([body], 'clusters.json')).toBe(true);
  });

  it('accepts a bare array even without the .json extension', () => {
    expect(isClusterFile(['[{"particles":[0]}]'], 'clusters')).toBe(true);
  });

  it('rejects JSON with no particle list', () => {
    expect(isClusterFile(['{"clusters":[]}'], 'clusters.json')).toBe(false);
  });

  it('rejects a non-JSON file whatever it is called', () => {
    // An oxDNA input file dropped alongside a simulation must not be mistaken
    // for clustering.
    expect(isClusterFile(['T = 0.1', 'steps = 1000'], 'input')).toBe(false);
  });

  it.each(['particles', 'indices', 'ids'])('accepts the list spelled "%s"', (key) => {
    expect(isClusterFile([`{"clusters":[{"${key}":[0]}]}`], 'c.json')).toBe(true);
  });
});

describe('the other signatures', () => {
  it('recognises a trajectory by its header keywords', () => {
    const traj = lines(`
t = 0
b = 60 60 60
E = 0 0 0
1.0 2.0 3.0 1 0 0 0 0 1
`);
    expect(isTrajectoryFile(traj)).toBe(true);
    expect(isTrajectoryFile(OXDNA)).toBe(false);
  });

  it('recognises an oxDNA input file', () => {
    const input = lines(`
T = 0.1
steps = 1000000
topology = system.top
`);
    expect(isInputFile(input, 'input')).toBe(true);
  });

  it('recognises a self-contained MGL file by its @ separator', () => {
    // No .Box: header: this is the standalone form.
    expect(isMGLFile(lines('15.3 15.5 15.6 @ 0.5 C[blue]'))).toBe(true);
  });

  it('lets exactly one predicate claim a headerless MGL file', () => {
    // isMGLTrajectoryFile used to end with `|| (hasMGLContent && count >= 0)`,
    // whose right operand is true for any count — so both predicates claimed a
    // headerless file, and since detectFileType tests the trajectory first,
    // isMGLFile was unreachable and every .mgl loaded as a trajectory.
    const headerless = lines('15.3 15.5 15.6 @ 0.5 C[blue]');
    expect(isMGLFile(headerless)).toBe(true);
    expect(isMGLTrajectoryFile(headerless)).toBe(false);
  });

  it('hands any MGL file carrying a .Box: header to the trajectory path', () => {
    // isMGLFile deliberately returns false once a header appears, so exactly one
    // of the two claims each file. A *single* header is enough — the file is a
    // one-frame trajectory, not a self-contained MGL. (CLAUDE.md describes this
    // as "multi-frame .Box: headers", which overstates the requirement.)
    const withBox = lines(`
.Box:60.0,60.0,60.0
15.3 15.5 15.6 @ 0.5 C[blue]
`);
    expect(isMGLFile(withBox)).toBe(false);
    expect(isMGLTrajectoryFile(withBox)).toBe(true);
  });

  it('recognises a patch file as lines of three numbers', () => {
    expect(isPatchFile(lines(`
0.0 0.0 1.0
0.0 1.0 0.0
1.0 0.0 0.0
`))).toBe(true);
    expect(isPatchFile(lines('patch_0_position = 0.0,0.0,1.0'))).toBe(false);
  });
});

import { parseObservablesConfig, printEveryFor, isObservablesConfig } from './config';

// The real file from the run that prompted all of this.
const MENGER = JSON.stringify({
  output: {
    print_every: '1e5',
    name: 'clusters.txt',
    cols: [{ type: 'PatchyBonds', show_types: '1' }],
  },
});

describe('isObservablesConfig', () => {
  test('recognises an oxDNA observables file', () => {
    expect(isObservablesConfig(MENGER)).toBe(true);
  });

  test('does not claim a clusters file', () => {
    expect(isObservablesConfig('{"clusters":[{"particles":[0,1]}]}')).toBe(false);
  });

  test('does not claim something that is not JSON', () => {
    expect(isObservablesConfig('40 2\niP 0 1.0 0 0,0,0.5 0,0,1')).toBe(false);
  });
});

describe('parseObservablesConfig', () => {
  test('reads the interval, the file it writes and what it writes', () => {
    expect(parseObservablesConfig(MENGER)).toEqual([
      { name: 'clusters.txt', printEvery: 1e5, types: ['PatchyBonds'] },
    ]);
  });

  test('accepts several outputs', () => {
    const text = JSON.stringify({
      output_1: { print_every: '1000', name: 'a.txt', cols: [{ type: 'PLClusterTopology' }] },
      output_2: { print_every: '2000', name: 'b.txt', cols: [{ type: 'PatchyBonds' }] },
    });
    expect(parseObservablesConfig(text).map(o => o.name)).toEqual(['a.txt', 'b.txt']);
  });

  test('a malformed file yields nothing rather than throwing', () => {
    expect(parseObservablesConfig('not json')).toEqual([]);
  });
});

describe('printEveryFor', () => {
  const outputs = parseObservablesConfig(MENGER);

  test('matches the output that writes this file by name', () => {
    expect(printEveryFor(outputs, { fileName: 'clusters.txt', formatId: 'patchy_bonds' })).toBe(1e5);
  });

  test('falls back to the output that writes this kind of observable', () => {
    // The file may have been renamed since the run, or dropped from a copy.
    expect(printEveryFor(outputs, { fileName: 'renamed.txt', formatId: 'patchy_bonds' })).toBe(1e5);
  });

  test('does not offer an interval from an unrelated observable', () => {
    expect(printEveryFor(outputs, { fileName: 'x.txt', formatId: 'pl_cluster_topology' })).toBe(0);
  });

  test('no config at all means no interval', () => {
    expect(printEveryFor([], { fileName: 'clusters.txt', formatId: 'patchy_bonds' })).toBe(0);
  });
});

describe('an interval written in the input file instead', () => {
  test('reads a data_output block', () => {
    // oxDNA allows observables inline in the input file as well as in a
    // separate JSON one.
    const input = [
      'T = 0.1',
      'data_output_1 = {',
      '  name = bonds.txt',
      '  print_every = 5000',
      '  col_1 = { type = PatchyBonds }',
      '}',
    ].join('\n');
    const outputs = parseObservablesConfig(input);
    expect(printEveryFor(outputs, { fileName: 'bonds.txt', formatId: 'patchy_bonds' })).toBe(5000);
  });
});

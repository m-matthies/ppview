import { detectObservable } from './index';

const PL = '2 ( 0 0 1 ) [0 -> (1 2), 1 -> (0), 2 -> (0)] ( 1 1 ) [3 -> (4), 4 -> (3)]';
const PATCHY = '# step 100 N 2\n1\n2\n1\n1';
const RASPBERRY = '((0 1), (2, 0))';

const lines = text => text.split('\n').map(l => l.trim()).filter(l => l !== '');

describe('detectObservable', () => {
  test('recognises PLClusterTopology by its adjacency arrows', () => {
    expect(detectObservable(lines(PL))).toBe('pl_cluster_topology');
  });

  test('recognises PatchyBonds by its step header', () => {
    expect(detectObservable(lines(PATCHY))).toBe('patchy_bonds');
  });

  test('recognises RaspberryPatchyBonds by its bond tuples', () => {
    expect(detectObservable(lines(RASPBERRY))).toBe('raspberry_patchy_bonds');
  });

  test('does not claim an oxDNA trajectory', () => {
    expect(detectObservable(lines('t = 0\nb = 20 20 20\nE = 0 0 0\n1 2 3 1 0 0 0 0 1 0 0 0 0 0 0'))).toBeNull();
  });

  test('does not claim a patchy topology', () => {
    expect(detectObservable(lines('40 2\niP 0 1.0 0 0,0,0.5 0,0,1\niC 0 40 0 0'))).toBeNull();
  });

  test('does not claim a cluster JSON file', () => {
    expect(detectObservable(lines('{ "clusters": [ { "particles": [0, 1, 2] } ] }'))).toBeNull();
  });
});

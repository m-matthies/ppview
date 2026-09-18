import { parseRaspberryTopology } from '../topologyParser';

const TOP = `768 3
# Patch types
iP 0 1.0 0 0,0,0.5 0,0,1
iP 4 1.0 1 0,0,0.5 0,0,1
iP 8 1.0 2 0,0,-0.5 0,0,-1
iP 9 1.0 3 0,0,0.5 0,0,1

# Repulsion points
iR 0,0,0 0.5
iR 0,0,-0.25 0.25
iR 0,0,0 0.25
iR 0,0,0.25 0.25

# Particle Types
iC 0 128 0 0
iC 1 128 4 0
iC 2 512 8,9 1,2,3
`;

test('each particle type uses only the repulsion sites listed on its iC line', () => {
  const { particleTypes } = parseRaspberryTopology(TOP);
  expect(particleTypes.map(t => t.repulsionSiteData.length)).toEqual([1, 1, 3]);

  // type 0 and 1 -> iR index 0 (radius 0.5 at origin)
  for (const t of [particleTypes[0], particleTypes[1]]) {
    expect(t.repulsionSiteData[0]).toEqual({ position: { x: 0, y: 0, z: 0 }, radius: 0.5 });
  }
  // type 2 -> iR indices 1,2,3
  expect(particleTypes[2].repulsionSiteData.map(s => s.position.z)).toEqual([-0.25, 0, 0.25]);
  expect(particleTypes[2].repulsionSiteData.every(s => s.radius === 0.25)).toBe(true);
});

test('missing repulsion field falls back to all iR sites', () => {
  const { particleTypes } = parseRaspberryTopology(`4 1
iR 0,0,0 0.5
iR 0,0,1 0.25
iC 0 4 -1
`);
  expect(particleTypes[0].repulsionSiteData.length).toBe(2);
  expect(particleTypes[0].patchPositions.length).toBe(0);
});

test('-1 repulsion field means no repulsion sites', () => {
  const { particleTypes } = parseRaspberryTopology(`4 1
iP 0 1.0 0 0,0,0.5 0,0,1
iR 0,0,0 0.5
iC 0 4 0 -1
`);
  expect(particleTypes[0].repulsionSiteData.length).toBe(0);
});

test('out-of-range repulsion ids are dropped', () => {
  const { particleTypes } = parseRaspberryTopology(`4 1
iR 0,0,0 0.5
iC 0 4 -1 0,7
`);
  expect(particleTypes[0].repulsionSiteData.length).toBe(1);
});

/**
 * Generates a deterministic fixture per supported file format.
 *
 * Every fixture lays particles out as five well-separated blobs so DBSCAN at the
 * pane's default epsilon finds exactly five clusters. That makes the clustering
 * scenarios comparable across formats: the same interaction should produce the
 * same qualitative change no matter which renderer draws it.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

// Small deterministic PRNG — Math.random would make fixtures non-reproducible.
let seed = 20240918;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const BOX = 60;
const CENTERS = [[15, 15, 15], [45, 15, 15], [15, 45, 15], [45, 45, 15], [30, 30, 45]];
const PER_CLUSTER = 8;

function blobPositions() {
  const out = [];
  for (const c of CENTERS) {
    for (let i = 0; i < PER_CLUSTER; i++) {
      out.push([
        c[0] + (rnd() - 0.5) * 2,
        c[1] + (rnd() - 0.5) * 2,
        c[2] + (rnd() - 0.5) * 2,
      ]);
    }
  }
  return out;
}

// An oxDNA trajectory line: position, a1, a3, velocity, angular velocity.
const confLine = ([x, y, z]) =>
  `${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)} 1 0 0 0 0 1 0 0 0 0 0 0`;

/**
 * Three frames, not one.
 *
 * Every trajectory fixture used to hold a single configuration, so no frame was
 * ever revisited and the suite could not see the frame cache at all — a cached
 * frame that rendered differently from a parsed one would have gone unnoticed.
 * The later frames are the same blobs nudged along one axis, so stepping is
 * visible in the pixels while DBSCAN still finds the same five clusters.
 */
const FRAMES = 3;

function writeConf(name, positions) {
  const lines = [];
  for (let frame = 0; frame < FRAMES; frame++) {
    lines.push(`t = ${frame * 1000}`, `b = ${BOX} ${BOX} ${BOX}`, `E = -1 -1 0`);
    // Only the first blob moves. Displacing every particle by the same amount
    // moves the centre of mass by the same amount, and the loader centres on
    // it — so a uniform drift is subtracted out and every frame renders
    // identically, which is exactly what the first attempt at this produced.
    const drift = frame * 4;
    positions.forEach(([x, y, z], i) =>
      lines.push(confLine(i < PER_CLUSTER ? [x + drift, y, z] : [x, y, z])));
  }
  fs.writeFileSync(path.join(OUT, name), lines.join('\n') + '\n');
}

const pos = blobPositions();
const N = pos.length;

// ---------------------------------------------------------------- MGL
{
  // Three frames, like the oxDNA fixtures: an MGL file with more than one
  // `.Box:` header is a trajectory, and that path — frames held in memory
  // rather than sliced out of a file — had no multi-frame coverage at all.
  const lines = [];
  for (let frame = 0; frame < FRAMES; frame++) {
    lines.push(`.Box:${BOX.toFixed(6)},${BOX.toFixed(6)},${BOX.toFixed(6)}`);
    // Every particle drifts here, which is the opposite of what the oxDNA
    // fixtures above do — and for the same reason. Those frames are re-centred
    // on the box, so a uniform drift is subtracted straight back out; these are
    // not, so a uniform drift is the one thing that moves the whole structure
    // across the screen. Drifting a single blob instead moved eight particles
    // of forty a couple of pixels in a view zoomed out to a 60-unit box, which
    // is below what any pixel measurement can honestly call a change.
    const drift = frame * 10;
    pos.forEach(([x, y, z], i) => {
      const colour = ['blue', 'red', 'green'][i % 3];
      // Two axes, so the movement shows in both screen directions.
      lines.push(`${(x + drift).toFixed(6)} ${(y + drift).toFixed(6)} ${z.toFixed(6)} @ 0.500000 C[${colour}]`);
    });
  }
  fs.writeFileSync(path.join(OUT, 'mgl.mgl'), lines.join('\n') + '\n');
}

// ---------------------------------------------------------- Raspberry
{
  const top = [
    `${N} 2`,
    '# Patch types',
    'iP 0 1.0 0 0,0,0.5 0,0,1',
    'iP 1 1.0 1 0,0,-0.5 0,0,-1',
    '# Repulsion points',
    'iR 0,0,0 0.45',
    'iR 0,0,-0.4 0.3',
    'iR 0,0,0.4 0.3',
    '# Particle types — one single-bead type, one three-bead type',
    `iC 0 ${N / 2} 0 0`,
    `iC 1 ${N / 2} 1 0,1,2`,
  ];
  fs.writeFileSync(path.join(OUT, 'raspberry.top'), top.join('\n') + '\n');
  writeConf('raspberry.dat', pos);
}

// --------------------------------------------------- oxDNA nucleotide
{
  // Five strands of eight nucleotides, matching the blob layout.
  const top = [`${N} ${CENTERS.length}`];
  const bases = ['A', 'T', 'G', 'C'];
  for (let i = 0; i < N; i++) {
    const strand = Math.floor(i / PER_CLUSTER) + 1;
    const withinStrand = i % PER_CLUSTER;
    const n3 = withinStrand === 0 ? -1 : i - 1;
    const n5 = withinStrand === PER_CLUSTER - 1 ? -1 : i + 1;
    top.push(`${strand} ${bases[i % 4]} ${n3} ${n5}`);
  }
  fs.writeFileSync(path.join(OUT, 'oxdna.top'), top.join('\n') + '\n');
  writeConf('oxdna.dat', pos);
}

// ------------------------------------------------------- SRS springs
{
  // Header: numParticles numStrands maxSpringsPerParticle repeatedPatchesPerParticle
  const lines = [
    `${N} ${CENTERS.length} 2 1`,
    '# iP = iP, id, color, strength, x y z',
    'iP 0 0 1.0 0 0 0.5',
    'iP 1 1 1.0 0 0 -0.5',
    '# iS = iS, id, k, r0, x y z',
    'iS 0 1.0 1.2 0 0 0',
  ];
  for (let i = 0; i < N; i++) {
    const strand = Math.floor(i / PER_CLUSTER);
    const withinStrand = i % PER_CLUSTER;
    // Spring to the next particle in the same blob, so springs stay short.
    const neighbour = withinStrand === PER_CLUSTER - 1 ? -1 : i + 1;
    const springs = neighbour >= 0 ? ` ${neighbour} 0` : '';
    // particleType strand radius mass numPatches [patchIds] [neighbourIdx springIdx]
    lines.push(`${i % 2} ${strand} 0.5 1.0 1 ${i % 2}${springs}`);
  }
  fs.writeFileSync(path.join(OUT, 'srs.psp'), lines.join('\n') + '\n');
  writeConf('srs.dat', pos);
}

// ----------------------------------------------------------- Lorenzo
{
  // Header `N typeCount`, then one line per type: count patchCount patches file
  const half = N / 2;
  const top = [
    `${N} 2`,
    `${half} 2 0,1 patchesA.dat`,
    `${N - half} 2 0,1 patchesB.dat`,
  ];
  fs.writeFileSync(path.join(OUT, 'lorenzo.top'), top.join('\n') + '\n');
  // Patch spec files are plain "x y z" lines, one per patch.
  fs.writeFileSync(path.join(OUT, 'patchesA.dat'), '0 0 0.5\n0 0 -0.5\n');
  fs.writeFileSync(path.join(OUT, 'patchesB.dat'), '0.5 0 0\n-0.5 0 0\n');
  writeConf('lorenzo.dat', pos);
}

// ------------------------------------------------------------ Flavio
{
  // `.top` is a 2-token header plus an all-integer type list.
  const types = [];
  for (let i = 0; i < N; i++) types.push(i % 2);
  fs.writeFileSync(
    path.join(OUT, 'flavio.top'),
    `${N} 2\n${types.join(' ')}\n`,
  );

  const particles = [];
  for (let t = 0; t < 2; t++) {
    particles.push(`particle_${t} = {`);
    particles.push(`  type = ${t}`);
    particles.push(`  patches = ${t === 0 ? '0,1' : '2,3'}`);
    particles.push('}');
  }
  fs.writeFileSync(path.join(OUT, 'particles.txt'), particles.join('\n') + '\n');

  const patchSpecs = [
    [0, '0,0,0.5'], [1, '0,0,-0.5'], [2, '0.5,0,0'], [3, '-0.5,0,0'],
  ];
  const patches = [];
  for (const [id, position] of patchSpecs) {
    patches.push(`patch_${id} = {`);
    patches.push(`  id = ${id}`);
    patches.push(`  color = ${id}`);
    patches.push(`  strength = 1.0`);
    patches.push(`  position = ${position}`);
    patches.push(`  a1 = ${position}`);
    patches.push(`  a2 = 0,1,0`);
    patches.push('}');
  }
  fs.writeFileSync(path.join(OUT, 'patches.txt'), patches.join('\n') + '\n');
  writeConf('flavio.dat', pos);
}

console.log(`fixtures written to ${OUT} (${N} particles, ${CENTERS.length} blobs)`);

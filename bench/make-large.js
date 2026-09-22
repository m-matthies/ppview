#!/usr/bin/env node
/**
 * A trajectory big enough for playback cost to be measurable.
 *
 * The visual fixtures are 40 particles across 5 blobs, chosen so DBSCAN finds a
 * predictable number of clusters. That is the wrong shape for a profile: at 40
 * particles every per-frame cost disappears into noise, and any conclusion drawn
 * from it would be about the harness rather than the app.
 */
const fs = require('fs');
const path = require('path');

const PARTICLES = Number(process.env.BENCH_PARTICLES || 8000);
const FRAMES = Number(process.env.BENCH_FRAMES || 60);
const BOX = 200;
const OUT = path.join(__dirname, 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

// Lorenzo topology: one type, so the renderer path is the plain instanced sphere.
fs.writeFileSync(path.join(OUT, 'large.top'),
  `${PARTICLES} 1\n${PARTICLES} 0 patches.dat\n`);
fs.writeFileSync(path.join(OUT, 'patches.dat'), '0.0 0.0 1.0\n');

const lines = [];
for (let f = 0; f < FRAMES; f++) {
  lines.push(`t = ${f * 1000}`, `b = ${BOX} ${BOX} ${BOX}`, 'E = 0 0 0');
  for (let i = 0; i < PARTICLES; i++) {
    // Drift a little each frame so every frame really is different data.
    const x = (rnd() * BOX).toFixed(4);
    const y = (rnd() * BOX).toFixed(4);
    const z = (rnd() * BOX).toFixed(4);
    lines.push(`${x} ${y} ${z} 1 0 0 0 0 1`);
  }
}
fs.writeFileSync(path.join(OUT, 'large.dat'), lines.join('\n') + '\n');
console.log(`${PARTICLES} particles x ${FRAMES} frames -> bench/fixtures/large.dat`);

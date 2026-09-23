import { dedupeBonds, connectedComponents, makeFrame, NO_PATCH } from './bondFrames';

/**
 * `PatchyBonds` — the rovigatti plugin's observable, paired with the `lorenzo`
 * patchy format.
 *
 * A Configuration-style observable: a full block per timestep rather than one
 * line.
 *
 *     # step <step> N <n_particles>
 *     <c1> <c2> ... <cP>          per-patch bond counts for particle 0
 *     <idx idx idx ...>           every bonded index for particle 0, 1-indexed
 *     ...                         two more lines per particle
 *
 * Two things about this format bite:
 *
 * **The second line has no per-patch delimiter.** Which index belongs to which
 * patch is recoverable only by consuming the first line's counts as a running
 * partition over it — counts `2 0 1` mean the first two indices are patch 0's,
 * patch 1 has none, and the next is patch 2's.
 *
 * **A particle bonded to nothing writes a blank line**, and that line still
 * counts. Filtering empty lines — which every other reader in this codebase
 * does — shifts every particle after it by one, so counts get read from an
 * index line and the whole rest of the block is silently wrong. Lines are
 * therefore taken exactly two per particle, blank or not.
 *
 * Indices are 1-indexed: oxDNA writes `bonded_id + 1`.
 */

const HEADER = /^#\s*step\s+(\d+)\s+N\s+(\d+)/;

const numbers = (line) => {
  const trimmed = line.trim();
  if (trimmed === '') return [];
  return trimmed.split(/\s+/).map(Number);
};

function parseParticle(countsLine, indexLine, particle, warnings, step) {
  const counts = numbers(countsLine);
  const bonded = numbers(indexLine);

  const expected = counts.reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
  if (expected !== bonded.length) {
    // Partitioning anyway would assign the wrong patch to every bond after the
    // discrepancy, so this particle's bonds are dropped and said out loud.
    warnings.push(
      `Step ${step}, particle ${particle}: the patch counts add up to ${expected} `
      + `but ${bonded.length} bonded index/indices are listed; its bonds were skipped.`,
    );
    return [];
  }

  const halfBonds = [];
  let cursor = 0;
  for (let patch = 0; patch < counts.length; patch++) {
    for (let n = 0; n < counts[patch]; n++) {
      const raw = bonded[cursor++];
      // 1-indexed in the file. A 0 would mean "particle -1", which is not a
      // particle, so it is dropped rather than wrapped to the last one.
      if (!Number.isInteger(raw) || raw < 1) continue;
      halfBonds.push({ from: particle, fromPatch: patch, to: raw - 1, toPatch: NO_PATCH });
    }
  }
  return halfBonds;
}

export function parsePatchyBonds(text) {
  // Not filtered: a blank line is a particle with no bonds, and dropping it
  // shifts every particle after it.
  const lines = text.split('\n');
  const frames = [];
  const steps = [];
  const warnings = [];

  let i = 0;
  while (i < lines.length) {
    const header = HEADER.exec(lines[i].trim());
    if (!header) { i++; continue; }

    const step = Number(header[1]);
    const particleCount = Number(header[2]);
    i++;

    if (i + particleCount * 2 > lines.length) {
      warnings.push(
        `Step ${step} is incomplete: ${particleCount} particles need `
        + `${particleCount * 2} lines and only ${lines.length - i} remain; it was skipped.`,
      );
      break;
    }

    const halfBonds = [];
    for (let particle = 0; particle < particleCount; particle++) {
      halfBonds.push(...parseParticle(lines[i], lines[i + 1], particle, warnings, step));
      i += 2;
    }

    const bonds = dedupeBonds(halfBonds);
    // This observable states bonds per particle and never groups them, so
    // clusters are the graph's connected components — the same step pypatchy
    // leaves to whatever consumes its MultiDiGraph.
    frames.push(makeFrame(bonds, connectedComponents(bonds)));
    steps.push(step);
  }

  if (frames.length === 0) {
    throw new Error('No timesteps could be read; this does not look like PatchyBonds output.');
  }
  return { format: 'patchy_bonds', frames, steps, warnings };
}

export default parsePatchyBonds;

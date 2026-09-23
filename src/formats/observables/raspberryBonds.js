import { dedupeBonds, connectedComponents, makeFrame } from './bondFrames';

/**
 * `RaspberryPatchyBonds` — the evans plugin's observable, paired with the
 * `raspberry` patchy format.
 *
 * The simplest of the three and the least like the others: one line per
 * timestep, every unique bond as a tuple.
 *
 *     ((i patch_i), (j patch_j)) ((k patch_k), (l patch_l)) ...
 *
 * The C++ deduplicates through a `std::set`, so each bond appears once even
 * though it is discovered from both particles — which means, unlike the other
 * two formats, one tuple states *both* patch ids. There is no torsion data
 * here; the raspberry format has no torsional patches.
 *
 * No headers, no per-particle structure and no grouping: this observable does
 * not compute cluster membership at all, so the connected components are found
 * on this side. pypatchy does the same with `nx.weakly_connected_components`.
 *
 * Two details this parser is deliberately lenient about:
 *
 * **The separator.** pypatchy's regex reads the first pair space-separated and
 * the second comma-separated (`\(\((\d+) (\d+)\), \((\d+), (\d+)\)\)`). That
 * asymmetry is peculiar enough that betting the parser on it is a poor trade,
 * so either separator is accepted in either position.
 *
 * **A blank line is a timestep** — a step in which nothing was bonded — and
 * dropping it would slide every later frame one step earlier. Blank lines at
 * the *end* of the file are the file's own trailing newlines and are not
 * frames; there is no way to tell those apart from bondless final steps, and
 * a stray newline is by far the likelier of the two.
 */

const BOND = /\(\s*\(\s*(\d+)\s*[,\s]\s*(\d+)\s*\)\s*,\s*\(\s*(\d+)\s*[,\s]\s*(\d+)\s*\)\s*\)/g;

function parseLine(line) {
  const halfBonds = [];
  let match;
  BOND.lastIndex = 0;
  while ((match = BOND.exec(line)) !== null) {
    halfBonds.push({
      from: Number(match[1]),
      fromPatch: Number(match[2]),
      to: Number(match[3]),
      toPatch: Number(match[4]),
    });
  }
  return halfBonds;
}

export function parseRaspberryBonds(text) {
  const lines = text.split('\n');
  // Only the trailing ones: an interior blank line is a step with no bonds.
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

  const frames = [];
  const warnings = [];
  let parsedAny = false;

  lines.forEach((raw, position) => {
    const line = raw.trim();
    const halfBonds = line === '' ? [] : parseLine(line);
    if (line !== '') {
      if (halfBonds.length === 0) {
        warnings.push(`Line ${position + 1} holds no readable bond tuples; recorded as a step with no bonds.`);
      } else {
        parsedAny = true;
      }
    }
    const bonds = dedupeBonds(halfBonds);
    frames.push(makeFrame(bonds, connectedComponents(bonds)));
  });

  // A file of blank lines parses into frames without a single bond in it, which
  // is not the same as a file of the right kind that happens to be quiet.
  if (!parsedAny) {
    throw new Error('No timesteps could be read; this does not look like RaspberryPatchyBonds output.');
  }
  return { format: 'raspberry_patchy_bonds', frames, steps: null, warnings };
}

export default parseRaspberryBonds;

import { parsePLClusterTopology } from './plClusterTopology';
import { parsePatchyBonds } from './patchyBonds';
import { parseRaspberryBonds } from './raspberryBonds';

/**
 * Every cluster/bond observable in one table.
 *
 * These are the outputs of oxDNA's patchy-particle contrib plugins — one
 * observable per plugin, and they share no text format whatsoever, so each gets
 * its own parser. `bondFrames.js` is where they converge.
 *
 * An observable only works with the plugin it is compiled into, so a system
 * will normally produce exactly one of these three; detection has no ambiguity
 * to resolve between them.
 */

/** `12 -> (3 4)`: the adjacency arrow, which nothing else in this app writes. */
const PL_MARK = /^\d[\s\S]*\d+\s*->\s*\(/;
/** The Configuration-style block header. */
const PATCHY_MARK = /^#\s*step\s+\d+\s+N\s+\d+/;
/** `((i p), (j, p))`, tolerant of either separator. */
const RASPBERRY_MARK = /\(\s*\(\s*\d+\s*[,\s]\s*\d+\s*\)\s*,\s*\(\s*\d+\s*[,\s]\s*\d+\s*\)\s*\)/;

/**
 * How the streaming scanner finds one timestep, and what a blank line means.
 *
 * These are strings rather than the scanner's own numbers so that the format
 * table does not have to import the WebAssembly boundary; `readObservable`
 * translates. `blanks` is how a blank *line* is treated, and the three formats
 * genuinely differ: `PatchyBonds` delimits blocks with `#` so a blank line is
 * part of a block, `RaspberryPatchyBonds` writes one for a step in which
 * nothing was bonded, and `PLClusterTopology` writes the cluster count on every
 * step so a blank line there is not a timestep at all.
 */
export const SCAN_STEP_HEADERS = 'step-headers';
export const SCAN_LINE_PER_STEP = 'line-per-step';
export const SCAN_LINE_NONBLANK = 'line-per-step-nonblank';

export const OBSERVABLES = [
  {
    id: 'pl_cluster_topology',
    label: 'PLClusterTopology',
    plugin: 'romano',
    matches: (lines) => lines.some(line => PL_MARK.test(line)),
    parse: parsePLClusterTopology,
    // Every step states its cluster count, so a blank line is not a timestep.
    scan: SCAN_LINE_NONBLANK,
    blanks: 'keep',
  },
  {
    id: 'patchy_bonds',
    label: 'PatchyBonds',
    plugin: 'rovigatti',
    matches: (lines) => lines.some(line => PATCHY_MARK.test(line)),
    parse: parsePatchyBonds,
    scan: SCAN_STEP_HEADERS,
    blanks: 'keep',
  },
  {
    id: 'raspberry_patchy_bonds',
    label: 'RaspberryPatchyBonds',
    plugin: 'evans',
    matches: (lines) => lines.some(line => RASPBERRY_MARK.test(line)),
    parse: parseRaspberryBonds,
    scan: SCAN_LINE_PER_STEP,
    // A blank line is a step with no bonds; only the file's own trailing
    // newlines are not timesteps.
    blanks: 'trailing',
  },
];

/** Which observable this file is, from the head of it, or null. */
export function detectObservable(lines) {
  return OBSERVABLES.find(observable => observable.matches(lines))?.id ?? null;
}

export const observableById = (id) => OBSERVABLES.find(o => o.id === id) ?? null;

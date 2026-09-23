import { OBSERVABLES } from './index';

/**
 * Where an observable's print interval comes from.
 *
 * `PLClusterTopology` and `RaspberryPatchyBonds` write no step numbers at all,
 * so on their own they cannot be lined up with a trajectory that prints on a
 * different interval — which is the normal case. The run states both numbers
 * though: `print_conf_interval` in the oxDNA input, and `print_every` beside
 * the observable's own definition. Both files are ordinarily dropped along with
 * the data, so the answer is usually right there.
 *
 * oxDNA accepts the definition in two places — a separate JSON file named by
 * `observables_file`, or `data_output_N = { ... }` blocks inline in the input —
 * and both are read here.
 */

/** `1e5` is as ordinary as `100000` in these files. */
const toInterval = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const KNOWN_TYPES = OBSERVABLES.map(o => o.label.toLowerCase());

export function isObservablesConfig(text) {
  const head = text.slice(0, 8192);
  if (!/^\s*\{/.test(head)) return false;
  // A clusters file is also JSON; what distinguishes an observables file is
  // that it describes *outputs*, not particle groupings.
  if (/"(particles|indices|ids)"\s*:\s*\[/.test(head)) return false;
  return /"cols"\s*:/.test(head) || /"print_every"\s*:/.test(head);
}

function fromJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  // oxDNA names the blocks `output`, `output_1`, ... so every object-valued key
  // carrying a `cols` list is one.
  return Object.values(parsed)
    .filter(value => value && typeof value === 'object' && Array.isArray(value.cols))
    .map(value => ({
      name: typeof value.name === 'string' ? value.name : '',
      printEvery: toInterval(value.print_every),
      types: value.cols
        .map(col => (col && typeof col.type === 'string' ? col.type : null))
        .filter(Boolean),
    }));
}

/** `data_output_1 = { name = ... print_every = ... col_1 = { type = ... } }` */
function fromInputBlocks(text) {
  const outputs = [];
  const blocks = text.matchAll(/data_output_\d+\s*=\s*\{([\s\S]*?)\n\s*\}/g);
  for (const [, body] of blocks) {
    const capture = (pattern) => body.match(pattern)?.[1] ?? '';
    outputs.push({
      name: capture(/\bname\s*=\s*(\S+)/),
      printEvery: toInterval(capture(/\bprint_every\s*=\s*(\S+)/)),
      types: [...body.matchAll(/\btype\s*=\s*(\w+)/g)].map(m => m[1]),
    });
  }
  return outputs;
}

/** @returns {Array<{name: string, printEvery: number, types: string[]}>} */
export function parseObservablesConfig(text) {
  return fromJson(text) ?? fromInputBlocks(text);
}

/**
 * The interval the given file is written at, or 0 if nothing says.
 *
 * Matched on the file's name first, because that is what the config actually
 * states. A name match can fail for ordinary reasons — the file renamed since
 * the run, or copied out of its directory — so the observable's *type* is the
 * fallback. Type is not used as the primary key because one run can write two
 * observables of the same kind at different intervals.
 */
export function printEveryFor(outputs, { fileName, formatId }) {
  const label = OBSERVABLES.find(o => o.id === formatId)?.label.toLowerCase();
  const writesThisKind = (output) => output.types
    .some(type => type.toLowerCase() === label);

  const byName = outputs.find(output => output.name && output.name === fileName);
  if (byName && byName.printEvery > 0) return byName.printEvery;

  const byType = outputs.find(output => writesThisKind(output) && output.printEvery > 0);
  return byType ? byType.printEvery : 0;
}

export { KNOWN_TYPES };

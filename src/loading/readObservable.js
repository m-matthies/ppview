import {
  observableById, SCAN_STEP_HEADERS,
} from '../formats/observables';
import { alignBlocks } from '../formats/observables/alignment';
import { makeFrame } from '../formats/observables/bondFrames';
import { scanObservable, OBS_STEP_HEADERS, OBS_LINE_PER_STEP } from '../wasm/wasmCore';

/**
 * Reads a cluster/bond observable against a loaded trajectory.
 *
 * These files are far larger than the clusters they contribute. The one that
 * prompted this holds 21,798 timesteps in 4.79 GB, against a trajectory of 217
 * frames — so it is 8.9x past V8's maximum string length, and 99% of it is not
 * wanted anyway.
 *
 * So it is read the way the trajectory is: an index pass that parses nothing,
 * then one block at a time. The index pass is compiled (1.9s at 2.5 GB/s over
 * that file); the blocks that survive alignment are sliced out and handed to
 * the ordinary format parser, unchanged — which is why the three parsers know
 * nothing about any of this.
 */

/** A line of one or two bytes is blank: "\n", or "\r\n". */
const isBlankLine = (offsets, i, size) =>
  (i + 1 < offsets.length ? offsets[i + 1] : size) - offsets[i] <= 2;

/**
 * Which of the scanner's line starts are actually timesteps.
 *
 * The scanner is deliberately dumb — it reports every line — because what a
 * blank line means is the format's rule, not the scanner's, and the three
 * formats disagree about it.
 */
function timestepBlocks(entry, index) {
  const all = Array.from(index.offsets, (offset, i) => i);
  if (entry.blanks === 'keep') return all;

  if (entry.blanks === 'skip') {
    return all.filter(i => !isBlankLine(index.offsets, i, index.size));
  }

  // 'trailing': an interior blank line is a step in which nothing was bonded,
  // but the file's own trailing newlines are not timesteps — and nothing
  // distinguishes them, so the likelier reading wins.
  let end = all.length;
  while (end > 0 && isBlankLine(index.offsets, end - 1, index.size)) end--;
  return all.slice(0, end);
}

export async function readObservable(file, {
  formatId, frameTimes, printEvery = 0, onStatus,
}) {
  const entry = observableById(formatId);
  if (!entry) throw new Error(`Unknown observable format "${formatId}".`);

  const total = file.size ?? 0;
  const index = await scanObservable(
    file.stream(),
    entry.scan === SCAN_STEP_HEADERS ? OBS_STEP_HEADERS : OBS_LINE_PER_STEP,
    {
      onProgress: (done) => {
        if (!onStatus) return;
        const share = total ? ` — ${Math.round((done / total) * 100)}%` : '';
        onStatus(`Indexing ${entry.label}${share}`);
      },
    },
  );

  // The scanner reports lines; the format decides which are timesteps.
  const blocks = timestepBlocks(entry, index);
  const blockSteps = blocks.map(i => index.steps[i]);

  const { blockForFrame, matched, method, needed } = alignBlocks({
    frameTimes, blockSteps, printEvery,
  });

  // Only the matched blocks are ever read, and each only once however many
  // frames point at it.
  const warnings = [];
  const parsedBlocks = new Map();
  for (let n = 0; n < needed.length; n++) {
    const block = needed[n];
    const line = blocks[block];
    const start = index.offsets[line];
    const end = line + 1 < index.offsets.length ? index.offsets[line + 1] : index.size;
    if (onStatus) onStatus(`Reading ${entry.label} — timestep ${n + 1} of ${needed.length}`);

    // eslint-disable-next-line no-await-in-loop
    const text = await file.slice(start, end).text();
    if (text.trim() === '') {
      // A step in which nothing was bonded. The parsers reject a file with no
      // readable timestep in it, and rightly — but one empty block is not that.
      parsedBlocks.set(block, makeFrame([], []));
      continue;
    }
    try {
      const { frames, warnings: blockWarnings } = entry.parse(text);
      parsedBlocks.set(block, frames[0] ?? makeFrame([], []));
      blockWarnings.forEach(w => warnings.push(w));
    } catch (error) {
      // One unreadable block is not a reason to lose the rest of the file.
      warnings.push(`Timestep ${n + 1} could not be read (${error.message}); it is shown empty.`);
      parsedBlocks.set(block, makeFrame([], []));
    }
  }

  const frames = Array.from(blockForFrame, (block) => (
    block === -1 ? makeFrame([], []) : parsedBlocks.get(block)
  ));

  return {
    format: entry.id,
    frames,
    steps: Array.from(blockForFrame, (block) => (block === -1 ? -1 : blockSteps[block])),
    warnings,
    matched,
    method,
    timesteps: blocks.length,
  };
}

export default readObservable;

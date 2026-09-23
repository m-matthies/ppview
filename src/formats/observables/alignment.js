/**
 * Which timestep of an observable describes which frame of the trajectory.
 *
 * This was positional at first — entry *i* for frame *i* — on the reasoning
 * that both files are written by the same run. Real output says otherwise: an
 * observable normally prints far more often than configurations do. The file
 * that settled it holds 21,798 timesteps at `print_every = 1e5` against a
 * trajectory of 217 frames at `print_conf_interval = 1e7`, a hundred blocks per
 * frame. Positional would have paired the observable's step 1e5 with the
 * trajectory's t = 2e7 and been wrong about every frame, silently.
 *
 * So they are matched on the step number, in one of three ways, most reliable
 * first:
 *
 * - **By the step the file states.** `PatchyBonds` writes `# step n` on every
 *   block, so a frame's `t` is looked up directly. Exact, and no assumption.
 * - **By the print interval.** `PLClusterTopology` and `RaspberryPatchyBonds`
 *   state no step at all, but `observables.json` states `print_every` — so
 *   block *i* can be taken to be step *i x print_every* and matched as above.
 * - **By position**, when neither is available: entry *i* for frame *i*, and a
 *   count that does not match is refused rather than guessed at.
 *
 * A frame with no block of its own gets none, and is drawn without clusters or
 * bonds. Carrying the previous block forward would report a bonding the file
 * does not claim for that time, which is the quiet misreport this exists to
 * prevent; refusing the whole file would throw away every frame that does
 * match, and a partly-covered run — an observable started late, or a job cut
 * short — is ordinary.
 */

const NONE = -1;

/** Blocks in file order, no repeats: what actually has to be read and parsed. */
function neededBlocks(blockForFrame) {
  const seen = new Set();
  for (const block of blockForFrame) {
    if (block !== NONE) seen.add(block);
  }
  return [...seen].sort((a, b) => a - b);
}

function matchOnSteps(frameTimes, stepOfBlock) {
  const blockOfStep = new Map();
  stepOfBlock.forEach((step, index) => {
    // First block wins a repeated step: a run restarted from a checkpoint can
    // write the same step twice, and the earlier one is the complete record.
    if (step >= 0 && !blockOfStep.has(step)) blockOfStep.set(step, index);
  });

  const blockForFrame = new Int32Array(frameTimes.length).fill(NONE);
  let matched = 0;
  frameTimes.forEach((time, frame) => {
    const block = blockOfStep.get(time);
    if (block !== undefined) {
      blockForFrame[frame] = block;
      matched++;
    }
  });
  return { blockForFrame, matched };
}

export function alignBlocks({ frameTimes, blockSteps, printEvery = 0 }) {
  const times = Array.from(frameTimes);
  const steps = Array.from(blockSteps);

  // The format stated its steps.
  if (steps.some(step => step >= 0)) {
    const { blockForFrame, matched } = matchOnSteps(times, steps);
    return { blockForFrame, matched, method: 'step', needed: neededBlocks(blockForFrame) };
  }

  // No steps, but the run's print interval is known.
  //
  // Whether the first block is step 0 or step `printEvery` is not stated
  // anywhere — it depends on whether the observable printed at the start of the
  // run — so both are tried and whichever explains more frames is taken. A
  // wrong guess here would shift every frame by one block.
  if (printEvery > 0) {
    // Compared on the frames each origin can *possibly* match, not on the raw
    // count. A trajectory that starts at t = 0 — the usual case — hands origin 0
    // one extra match that origin `printEvery` cannot have, so comparing totals
    // always chose origin 0 and the alternative could never win. That is the
    // "shift every frame by one block" this is here to avoid.
    let best = null;
    for (const origin of [0, printEvery]) {
      const reachable = times.filter(t => t >= origin).length;
      const synthetic = steps.map((_, i) => origin + i * printEvery);
      const attempt = matchOnSteps(times, synthetic);
      const score = reachable > 0 ? attempt.matched / reachable : 0;
      if (!best || score > best.score) best = { ...attempt, score };
    }
    if (best && best.matched > 0) {
      return { ...best, method: 'interval', needed: neededBlocks(best.blockForFrame) };
    }
    // An interval that explains nothing is more likely to be the wrong number
    // than a reason to refuse the file, so fall through to position.
  }

  // Nothing to match on. One block per frame, and a mismatch is refused: there
  // is no information anywhere that would say how they line up, so any pairing
  // would be a guess applied to every frame.
  if (steps.length !== times.length) {
    throw new Error(
      `it holds ${steps.length} timesteps but this trajectory has ${times.length} frames.`,
    );
  }
  const blockForFrame = Int32Array.from(times, (_, i) => i);
  return {
    blockForFrame,
    matched: times.length,
    method: 'positional',
    needed: neededBlocks(blockForFrame),
  };
}

export default alignBlocks;

import { dedupeBonds, makeFrame, NO_PATCH } from './bondFrames';

/**
 * `PLClusterTopology` — the romano plugin's observable, paired with the
 * `flavio` / `josh_flavio` / `subhajit` patchy formats.
 *
 * One line per printed configuration. Two particles are grouped whenever their
 * pairwise patchy interaction energy is negative; the C++ side builds the
 * clusters with union-find and writes a directed adjacency list beside each:
 *
 *     <count> ( m1 m2 ... ) [i -> (n1 n2), j -> (n3)] ( ... ) [ ... ]
 *
 * **The `( members )` list holds particle *types* by default.** The observable's
 * `show_types` setting defaults to true, so those numbers are types rather than
 * indices, and nothing in the file says which — a file recording forty
 * particles of types 0 and 1 looks exactly like one recording particles 0 and 1.
 * The `[ adjacency ]` block is always raw indices whatever that setting is, so
 * clusters are read from there and only there. pypatchy does the same, and for
 * the same reason.
 *
 * What that costs: a particle in a cluster with no bonds of its own appears in
 * the member list and nowhere in the adjacency, so it is invisible here. It is
 * also, by this observable's own definition, in no bond — so treating it as
 * unclustered is defensible rather than merely convenient.
 */

// One `[...]` block is one cluster. Non-greedy: a line holds several.
const CLUSTER_CHUNK = /\[[^\]]*\]/g;
// `12 -> (3 4 5)`, the one place real particle indices appear.
const ADJACENCY = /(\d+)\s*->\s*\(([^)]*)\)/g;

function parseLine(line) {
  const halfBonds = [];
  const clusters = [];

  const chunks = line.match(CLUSTER_CHUNK) ?? [];
  for (const chunk of chunks) {
    const members = new Set();
    let match;
    ADJACENCY.lastIndex = 0;
    while ((match = ADJACENCY.exec(chunk)) !== null) {
      const source = Number(match[1]);
      members.add(source);
      for (const token of match[2].trim().split(/\s+/)) {
        if (token === '') continue;
        const neighbour = Number(token);
        if (!Number.isInteger(neighbour)) continue;
        members.add(neighbour);
        halfBonds.push({ from: source, fromPatch: NO_PATCH, to: neighbour, toPatch: NO_PATCH });
      }
    }
    // A cluster whose every member is unbonded has an empty bracket, and there
    // is nothing recoverable in it.
    if (members.size > 0) clusters.push([...members].sort((x, y) => x - y));
  }

  return { clusters, bonds: dedupeBonds(halfBonds), declared: Number.parseInt(line, 10) };
}

export function parsePLClusterTopology(text) {
  const frames = [];
  const warnings = [];

  text.split('\n').forEach((raw, position) => {
    const line = raw.trim();
    if (line === '') return;
    // Every line of this format opens with the cluster count, so anything else
    // is not a timestep — and quietly skipping it would report a file of the
    // wrong kind as simply having fewer frames.
    if (!/^\d+/.test(line)) {
      warnings.push(`Line ${position + 1} does not start with a cluster count; skipped.`);
      return;
    }

    const { clusters, bonds, declared } = parseLine(line);
    if (Number.isInteger(declared) && declared !== clusters.length) {
      // Not an error: a cluster with no bonds is counted by the C++ and cannot
      // be recovered from the adjacency. Worth saying, because it is the
      // visible symptom of the show_types trade-off above.
      warnings.push(
        `Step ${frames.length + 1}: the file declares ${declared} cluster(s) but `
        + `${clusters.length} could be read from the bond lists.`,
      );
    }
    frames.push(makeFrame(bonds, clusters));
  });

  if (frames.length === 0) {
    throw new Error('No timesteps could be read; this does not look like PLClusterTopology output.');
  }
  return { format: 'pl_cluster_topology', frames, steps: null, warnings };
}

export default parsePLClusterTopology;

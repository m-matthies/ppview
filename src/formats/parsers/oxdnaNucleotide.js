export const parseOxDNANucleotideTopology = (content) => {
  const lines = content.trim().split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'));

  const headerTokens = lines[0].split(/\s+/).map(Number);
  const totalParticles = headerTokens[0];

  const nucleotides = [];
  const strandParticles = new Map();

  for (let i = 1; i < lines.length; i++) {
    const tokens = lines[i].split(/\s+/);
    const idx = i - 1;

    // Never skip a body line. OxDNANucleotides reads nucleotides[i] positionally
    // with i as the trajectory row, so dropping one shifts every nucleotide
    // after it onto the wrong particle — wrong base colour, wrong backbone bond,
    // silently. A malformed line yields a placeholder that renders in the
    // default colour with no bonds, and everything after it stays aligned.
    if (tokens.length < 4) {
      console.warn(`Topology line ${i + 1} is malformed; nucleotide ${idx} left unbonded.`);
      nucleotides.push({ index: idx, strandId: -1, base: '?', n3: -1, n5: -1 });
      if (!strandParticles.has(-1)) strandParticles.set(-1, []);
      strandParticles.get(-1).push(idx);
      continue;
    }

    const strandId = parseInt(tokens[0]);
    const base = tokens[1].toUpperCase();
    const n3 = parseInt(tokens[2]); // index of 3' neighbor (-1 = chain end)
    const n5 = parseInt(tokens[3]); // index of 5' neighbor (-1 = chain end)

    nucleotides.push({ index: idx, strandId, base, n3, n5 });

    if (!strandParticles.has(strandId)) strandParticles.set(strandId, []);
    strandParticles.get(strandId).push(idx);
  }

  const strandIds = [...strandParticles.keys()].sort((a, b) => a - b);
  const strandToTypeIndex = new Map(strandIds.map((s, i) => [s, i]));

  const particleTypes = strandIds.map(strandId => ({
    typeIndex: strandToTypeIndex.get(strandId),
    count: strandParticles.get(strandId).length,
    patches: [],
    patchPositions: [],
  }));

  const particleTypeMapping = nucleotides.map(n => {
    const typeIndex = strandToTypeIndex.get(n.strandId);
    return { typeIndex, particleType: particleTypes[typeIndex] };
  });

  console.log(`oxDNA nucleotide topology: ${totalParticles} nucleotides, ${strandIds.length} strands`);

  return {
    totalParticles,
    typeCount: strandIds.length,
    particleTypes,
    particleTypeMapping,
    nucleotides,
    format: 'oxdna_nucleotide',
  };
};

// Main function to parse the .top file (supports both Lorenzo's and Flavio's formats)
// Function to get particle type based on index

export const parseSRSSpringsTopology = (content) => {
  const lines = content.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'));

  // Header: numParticles numStrands maxSpringsPerParticle repeatedPatchesPerParticle
  const headerTokens = lines[0].split(/\s+/).map(Number);
  const totalParticles = headerTokens[0];

  const patchDefs = new Map(); // patchId → {id, color, strength, position}
  const springDefs = new Map(); // springId → {id, k, r0, position}
  const particleList = [];     // per-particle parsed data

  for (let i = 1; i < lines.length; i++) {
    const tokens = lines[i].split(/\s+/);
    const kw = tokens[0];

    if (kw === 'iP') {
      // iP patchId color strength x y z
      const id = parseInt(tokens[1]);
      const color = parseFloat(tokens[2]);
      const strength = parseFloat(tokens[3]);
      patchDefs.set(id, {
        id, color, strength,
        position: { x: parseFloat(tokens[4]), y: parseFloat(tokens[5]), z: parseFloat(tokens[6]) }
      });
    } else if (kw === 'iS') {
      // iS springId k r0 x y z
      const id = parseInt(tokens[1]);
      springDefs.set(id, {
        id,
        k: parseFloat(tokens[2]),
        r0: parseFloat(tokens[3]),
        position: { x: parseFloat(tokens[4]), y: parseFloat(tokens[5]), z: parseFloat(tokens[6]) }
      });
    } else if (tokens.length >= 5) {
      // Body: particleType strand radius mass numPatches [patchId...] [neighborIdx springIdx]...
      const particleType = parseInt(tokens[0]);
      const strand = parseInt(tokens[1]);
      const radius = parseFloat(tokens[2]);
      const mass = parseFloat(tokens[3]);
      const numPatches = parseInt(tokens[4]);

      const patchIds = [];
      for (let j = 0; j < numPatches; j++) {
        patchIds.push(parseInt(tokens[5 + j]));
      }

      const springConnections = [];
      for (let j = 5 + numPatches; j + 1 < tokens.length; j += 2) {
        springConnections.push({
          neighborIdx: parseInt(tokens[j]),
          springId: parseInt(tokens[j + 1])
        });
      }

      particleList.push({ particleType, strand, radius, mass, patchIds, springConnections });
    }
  }

  // Deduplicate spring connections: keep only one entry per unique particle pair
  const seen = new Set();
  const globalSpringConnections = [];
  for (let i = 0; i < particleList.length; i++) {
    for (const { neighborIdx, springId } of particleList[i].springConnections) {
      const key = `${Math.min(i, neighborIdx)}-${Math.max(i, neighborIdx)}`;
      if (!seen.has(key)) {
        seen.add(key);
        globalSpringConnections.push({ p1: i, p2: neighborIdx, springId });
      }
    }
  }

  // Map strand values → typeIndex (0, 1, 2 ...)
  const strandValues = [...new Set(particleList.map(p => p.strand))].sort((a, b) => a - b);
  const strandToTypeIndex = new Map(strandValues.map((s, i) => [s, i]));

  // Per-particle type mapping (for getParticleType to work correctly)
  const particleTypeMapping = particleList.map(p => {
    const typeIndex = strandToTypeIndex.get(p.strand);
    const patchPositions = p.patchIds
      .map(id => {
        const patch = patchDefs.get(id);
        if (!patch) return null;
        return { x: patch.position.x, y: patch.position.y, z: patch.position.z, patchId: id, color: patch.color };
      })
      .filter(Boolean);

    return {
      typeIndex,
      particleType: { typeIndex, count: 1, patches: p.patchIds, patchPositions }
    };
  });

  // Per-strand summary (for legend / coloring)
  const particleTypes = strandValues.map(strand => {
    const typeIndex = strandToTypeIndex.get(strand);
    const particlesOfStrand = particleList.filter(p => p.strand === strand);
    const allPatchIds = [...new Set(particlesOfStrand.flatMap(p => p.patchIds))];
    const patchPositions = allPatchIds.map(id => {
      const patch = patchDefs.get(id);
      if (!patch) return null;
      return { x: patch.position.x, y: patch.position.y, z: patch.position.z, patchId: id, color: patch.color };
    }).filter(Boolean);

    return { typeIndex, count: particlesOfStrand.length, patches: allPatchIds, patchPositions };
  });

  const representativeRadius = particleList.length > 0 ? particleList[0].radius : 0.5;

  console.log(`SRS Springs topology: ${totalParticles} particles, ${strandValues.length} strands, ` +
    `${globalSpringConnections.length} spring bonds, ${patchDefs.size} patch types`);

  return {
    totalParticles,
    typeCount: strandValues.length,
    particleTypes,
    particleTypeMapping,
    springConnections: globalSpringConnections,
    srsParticleRadius: representativeRadius,
  };
};

// Function to parse standard oxDNA nucleotide topology
// Header: N nStrands
// Body: strandId base n3 n5  (one line per nucleotide)

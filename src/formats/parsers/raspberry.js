export const parseRaspberryTopology = (content) => {
  // Filter out empty lines and comments, keep header + iP/iR/iC lines
  const lines = content.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'));

  // Header: <totalParticles> <typeCount>
  const headerTokens = lines[0].split(/\s+/).map(Number);
  const totalParticles = headerTokens[0];
  const typeCount = headerTokens[1];

  const patchDefs = new Map(); // patchId -> {id, strength, color, position, a1}
  const repulsionSites = [];   // ordered array of {position, radius}
  const corpuscles = [];       // [{typeId, count, patchIds, repulsionIds}]

  for (let i = 1; i < lines.length; i++) {
    const tokens = lines[i].split(/\s+/);
    const keyword = tokens[0];

    if (keyword === 'iP') {
      // iP <id> <strength> <color> <x,y,z> <a1x,a1y,a1z>
      const id = parseInt(tokens[1]);
      const strength = parseFloat(tokens[2]);
      const color = parseFloat(tokens[3]);
      const [px, py, pz] = tokens[4].split(',').map(Number);
      const [a1x, a1y, a1z] = tokens[5].split(',').map(Number);
      patchDefs.set(id, {
        id,
        strength,
        color,
        position: { x: px, y: py, z: pz },
        a1: { x: a1x, y: a1y, z: a1z }
      });
    } else if (keyword === 'iR') {
      // iR <x,y,z> <radius>  (IDs derived from order)
      const [rx, ry, rz] = tokens[1].split(',').map(Number);
      const radius = parseFloat(tokens[2]);
      repulsionSites.push({ position: { x: rx, y: ry, z: rz }, radius });
    } else if (keyword === 'iC') {
      // iC <type_id> <count> <patch_ids> <repulsion_site_ids>
      const typeId = parseInt(tokens[1]);
      const count = parseInt(tokens[2]);
      // A single -1 means "no patches" for this particle type
      const patchIds = (tokens[3] === '-1') ? [] : (tokens[3] ? tokens[3].split(',').map(Number) : []);
      // A single -1 (or a missing field) means "no repulsion sites listed" for
      // this particle type; null signals "fall back to the full iR set".
      const repulsionIds = (tokens[4] === undefined)
        ? null
        : (tokens[4] === '-1' ? [] : tokens[4].split(',').map(Number));
      corpuscles.push({ typeId, count, patchIds, repulsionIds });
    }
  }

  const particleTypes = corpuscles.map(({ typeId, count, patchIds, repulsionIds }) => {
    const patchPositions = patchIds
      .map(id => {
        const patch = patchDefs.get(id);
        if (!patch) return null;
        return {
          x: patch.position.x,
          y: patch.position.y,
          z: patch.position.z,
          patchId: id,
          color: patch.color,
          a1: patch.a1
        };
      })
      .filter(Boolean);

    // Each particle type uses only the repulsion sites named in the last field
    // of its iC line (iR sites are indexed by the order they appear in the file).
    // If the field is absent entirely, fall back to the full iR set.
    const repulsionSiteData = (repulsionIds === null)
      ? repulsionSites.slice()
      : repulsionIds
          .map(id => repulsionSites[id])
          .filter(Boolean);

    return {
      typeIndex: typeId,
      count,
      patches: patchIds,
      patchPositions,
      repulsionSiteData,
    };
  });

  console.log(`Raspberry topology: ${totalParticles} particles, ${typeCount} types, ` +
    `${patchDefs.size} patch defs, ${repulsionSites.length} repulsion sites`);

  return { totalParticles, typeCount, particleTypes };
};

// Function to parse SRS Springs topology format (Bullview .psp)
// Format: 4-token header, iP patch defs, iS spring defs, then body lines per particle

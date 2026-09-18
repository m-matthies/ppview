import * as THREE from "three";

// Helper functions for Flavio format parsing (following initSpecies pattern)
const getScalar = (name, s) => {
  const m = s.match(new RegExp(`${name}=(-?\\d+)`));
  if (m) {
    return parseFloat(m[1]);
  }
  return false;
};

const getArray = (name, s) => {
  const m = s.match(new RegExp(`${name}=([\\,\\d\\.\\-\\+]+)`));
  if (m) {
    return m[1].split(',').map((v) => parseFloat(v));
  }
  return false;
};

// Function to parse particle.txt (following initSpecies logic)
export const parseParticleTxt = (content) => {
  // Remove whitespace following initSpecies pattern
  const particlesStr = content.replaceAll(' ', '');
  const particles = [];
  let currentParticle = null;

  for (const line of particlesStr.split('\n')) {
    const particleID = line.match(/particle_(\d+)/);
    if (particleID) {
      if (currentParticle) {
        particles.push(currentParticle);
      }
      currentParticle = { 'id': parseInt(particleID[1]) };
    }

    const type = getScalar('type', line);
    if (type !== false) {
      currentParticle['type'] = type;
    }

    const patches = getArray('patches', line);
    if (patches !== false) {
      currentParticle['patches'] = patches;
    }
  }

  if (currentParticle) {
    particles.push(currentParticle);
  }

  return particles;
};

// Function to parse patches.txt (following initSpecies logic)
export const parsePatchesTxt = (content) => {
  // Remove whitespace following initSpecies pattern
  const patchesStr = content.replaceAll(' ', '');
  const patches = new Map();
  let currentId;

  for (const line of patchesStr.split('\n')) {
    const patchID = line.match(/patch_(\d+)/);
    if (patchID) {
      currentId = parseInt(patchID[1]);
      patches.set(currentId, {});
    }

    const color = getScalar('color', line);
    if (color !== false) {
      patches.get(currentId)['color'] = color;
    }

    // Handle position, a1, and a2 arrays
    for (const k of ['position', 'a1', 'a2']) {
      const a = getArray(k, line);
      if (a) {
        // Convert to THREE.Vector3 following initSpecies pattern
        const v = new THREE.Vector3().fromArray(a);
        patches.get(currentId)[k] = v;
      }
    }
  }

  // Convert Map to object for compatibility with existing code
  const patchesData = {};
  patches.forEach((patch, id) => {
    patchesData[id] = {
      id: id,
      color: patch.color || 0,
      position: patch.position ? {
        x: patch.position.x,
        y: patch.position.y,
        z: patch.position.z
      } : null,
      a1: patch.a1 ? {
        x: patch.a1.x,
        y: patch.a1.y,
        z: patch.a1.z
      } : null,
      a2: patch.a2 ? {
        x: patch.a2.x,
        y: patch.a2.y,
        z: patch.a2.z
      } : null
    };
  });

  return patchesData;
};

// Function to parse Lorenzo's topology (following initLoroSpecies logic)
export const parseLorenzoTopology = async (lines, fileMap) => {
  const headerTokens = lines[0].trim().split(/\s+/).map(Number);
  const totalParticles = headerTokens[0];
  const typeCount = headerTokens[1];

  // Create particles array with types following initLoroSpecies pattern
  const particles = [];
  const patchSpecs = [];

  // Parse topology lines to build particle type assignments
  for (let i = 1; i <= typeCount; i++) {
    const line = lines[i];
    const tokens = line.trim().split(/\s+/);
    const count = Number(tokens[0]);
    // const patchCount = Number(tokens[1]); // Unused
    // const patches = tokens[2] ? tokens[2].split(",").map(Number) : []; // Unused
    const fileName = tokens[3] ? tokens[3].trim() : "";

    // Create particles for this type following initLoroSpecies pattern
    for (let j = 0; j < count; j++) {
      particles.push({
        type: (i - 1).toString(), // Convert to string to match initLoroSpecies
        patchSpec: fileName || '' // Store patchSpec (filename) for each particle
      });
    }

    // Store patchSpec for this type
    patchSpecs[i - 1] = fileName || '';
  }

  // Following initLoroSpecies: const types = this.particles.map(p=>parseInt(p.type))
  const types = particles.map(p => parseInt(p.type));

  // Following initLoroSpecies: count instances of each type
  const instanceCounts = [];
  types.forEach((s, i) => {
    if (instanceCounts[s] === undefined) {
      instanceCounts[s] = 1;
    } else {
      instanceCounts[s]++;
    }
  });

  // Create patchStrMap equivalent by loading patch files
  const patchStrMap = new Map();

  // Load all unique patch files
  const uniquePatchSpecs = [...new Set(patchSpecs)].filter(spec => spec && spec.trim() !== '');

  for (const patchSpec of uniquePatchSpecs) {
    if (fileMap.has(patchSpec)) {
      try {
        const patchFile = fileMap.get(patchSpec);
        const patchContent = await patchFile.text();
        patchStrMap.set(patchSpec, patchContent.trim());
      } catch (error) {
        console.warn(`Error reading patch file '${patchSpec}':`, error);
        patchStrMap.set(patchSpec, '');
      }
    } else {
      console.warn(`Patch file '${patchSpec}' not found`);
      patchStrMap.set(patchSpec, '');
    }
  }

  // Following initLoroSpecies: create species array
  const particleTypes = [...new Set(types)].map(s => {
    const patchSpec = patchSpecs[s];
    let patchPositions = [];
    let patches = [];

    if (patchSpec && patchStrMap.has(patchSpec)) {
      const patchStrs = patchStrMap.get(patchSpec);
      if (patchStrs && patchStrs.trim() !== '') {
        // Following initLoroSpecies: parse patch strings
        const patchLines = patchStrs.split('\n').filter(line => line.trim() !== '');
        patchPositions = patchLines.map((vs, index) => {
          const coords = vs.trim().split(/ +/g).map(v => parseFloat(v));
          if (coords.length >= 3 && !coords.some(isNaN)) {
            const pos = new THREE.Vector3().fromArray(coords);
            return {
              x: pos.x,
              y: pos.y,
              z: pos.z,
              // Following initLoroSpecies: a1 and a2 are normalized position vectors
              a1: {
                x: pos.clone().normalize().x,
                y: pos.clone().normalize().y,
                z: pos.clone().normalize().z
              },
              a2: {
                x: pos.clone().normalize().x,
                y: pos.clone().normalize().y,
                z: pos.clone().normalize().z
              },
              patchId: index // Assign sequential patch IDs
            };
          }
          return null;
        }).filter(Boolean);

        // Create patches array with sequential IDs
        patches = patchPositions.map((_, index) => index);
      }
    }

    return {
      typeIndex: s,
      count: instanceCounts[s] || 0,
      patches: patches,
      patchPositions: patchPositions
    };
  });

  return { totalParticles, typeCount, particleTypes };
};

// Function to parse Flavio's topology
// options.particleFile / options.patchFile: filename hints from an oxDNA input file
export const parseFlavioTopology = async (content, fileMap, options = {}) => {
  const lines = content.trim().split("\n");
  const headerTokens = lines[0].trim().split(/\s+/).map(Number);
  const totalParticles = headerTokens[0];
  const typeCount = headerTokens[1];

  // Second line contains particle types per particle
  const typeLine = lines[1].trim();
  const particleTypesList = typeLine.split(/\s+/).map(Number);

  // Build particle types and counts
  const particleTypes = [];
  const typeCounts = {};

  particleTypesList.forEach((typeIndex) => {
    if (!typeCounts[typeIndex]) {
      typeCounts[typeIndex] = 0;
    }
    typeCounts[typeIndex]++;
  });

  let particlesData = null;
  let patchesData = null;

  // Check for particles file — prefer name from input file, then "particles.txt",
  // then any file whose name contains "particles" and ends with ".txt"
  const particleFileName = options.particleFile || "particles.txt";
  let particleTxtFile = fileMap.get(particleFileName) ?? fileMap.get("particles.txt");
  if (!particleTxtFile) {
    for (const [fileName, file] of fileMap.entries()) {
      if (/particles.*\.txt$/i.test(fileName)) {
        particleTxtFile = file;
        console.log(`Using ${fileName} as particles file for Flavio format`);
        break;
      }
    }
  }
  if (particleTxtFile) {
    const particleTxtContent = await particleTxtFile.text();
    particlesData = parseParticleTxt(particleTxtContent);
  } else {
    console.warn(`${particleFileName} (particles file) is missing for Flavio format.`);
    // Proceed without particlesData
  }

  // Check for patches file — prefer name from input file, then "patches.txt", then any *.patch.txt
  let patchesTxtFile = (options.patchFile ? fileMap.get(options.patchFile) : null)
    ?? fileMap.get("patches.txt");

  // If still not found, look for any .patch.txt file
  if (!patchesTxtFile) {
    for (const [fileName, file] of fileMap.entries()) {
      if (fileName.toLowerCase().endsWith('.patch.txt')) {
        patchesTxtFile = file;
        console.log(`Using ${fileName} as patches file for Flavio format`);
        break;
      }
    }
  }

  if (patchesTxtFile) {
    const patchesTxtContent = await patchesTxtFile.text();
    patchesData = parsePatchesTxt(patchesTxtContent);
  } else {
    console.warn("patches.txt or .patch.txt file is missing for Flavio format.");
    // Proceed without patchesData
  }

  // Build particle types array (following initSpecies pattern)
  // Sort the type keys to ensure consistent ordering regardless of input order
  Object.keys(typeCounts).sort((a, b) => Number(a) - Number(b)).forEach((typeIndex) => {
    const count = typeCounts[typeIndex];
    let patches = [];
    let patchPositions = [];

    if (particlesData && patchesData) {
      const particlesOfType = particlesData.filter(
        (p) => p.type === Number(typeIndex),
      );

      // Get unique patch IDs for this particle type
      const uniquePatchIds = new Set();
      particlesOfType.forEach((p) => {
        if (p.patches && Array.isArray(p.patches)) {
          p.patches.forEach(patchId => uniquePatchIds.add(patchId));
        }
      });

      // Map patch IDs to patch objects following initSpecies pattern
      patches = Array.from(uniquePatchIds);

      // Create patch positions array with the patch data
      // Following initSpecies logic: particle['patches'] = particle['patches'].map(id=>patches.get(id))
      patchPositions = patches
        .map((patchId) => {
          const patchData = patchesData[patchId];
          if (patchData && patchData.position) {
            return {
              x: patchData.position.x,
              y: patchData.position.y,
              z: patchData.position.z,
              // Include additional patch data for compatibility
              patchId: patchId,
              color: patchData.color,
              a1: patchData.a1,
              a2: patchData.a2
            };
          }
          return null;
        })
        .filter(Boolean);

      console.log(`Type ${typeIndex}: Found ${patches.length} unique patches, ${patchPositions.length} valid positions`);
    }

    const particleType = {
      count,
      typeIndex: Number(typeIndex),
      patches: patches || [], // Ensure patches is always an array
      patchPositions: patchPositions || [], // Ensure patchPositions is always an array
    };

    console.log(`Particle type ${typeIndex} summary:`, {
      count: particleType.count,
      typeIndex: particleType.typeIndex,
      patchCount: particleType.patches.length,
      patchPositionCount: particleType.patchPositions.length,
      patches: particleType.patches.slice(0, 3), // Show first 3 patch IDs
      firstPatchPosition: particleType.patchPositions[0]
    });

    particleTypes.push(particleType);
  });

  // For Flavio format, we need to create a mapping from particle index to type
  // because particles are not grouped by type like in Lorenzo format
  const particleTypeMapping = particleTypesList.map(typeIndex => {
    // Find the particle type object for this type index
    const particleType = particleTypes.find(pt => pt.typeIndex === typeIndex);
    return {
      typeIndex,
      particleType: particleType || particleTypes[0] // fallback to first type if not found
    };
  });

  return {
    totalParticles,
    typeCount,
    particleTypes,
    particleTypeMapping // Add this for Flavio format
  };
};

// Function to parse Raspberry topology format
// All patch/repulsion/type info is self-contained in a single .top file
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
    if (tokens.length < 4) continue;

    const strandId = parseInt(tokens[0]);
    const base = tokens[1].toUpperCase();
    const n3 = parseInt(tokens[2]); // index of 3' neighbor (-1 = chain end)
    const n5 = parseInt(tokens[3]); // index of 5' neighbor (-1 = chain end)
    const idx = i - 1;

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
export const parseTopFile = async (content, fileMap, detectedFormat = null, options = {}) => {
  const lines = content.trim().split("\n");

  // Use detected format if provided, otherwise fall back to original detection logic
  if (detectedFormat === 'raspberry') {
    return parseRaspberryTopology(content);
  }

  if (detectedFormat === 'srs_springs') {
    return parseSRSSpringsTopology(content);
  }

  if (detectedFormat === 'oxdna_nucleotide') {
    return parseOxDNANucleotideTopology(content);
  }

  let isFlavioFormat;
  if (detectedFormat) {
    isFlavioFormat = detectedFormat === 'flavio';
    console.log(`Using detected topology format: ${detectedFormat}`);
  } else {
    // Original detection logic as fallback
    isFlavioFormat = !lines[1].includes(".");
    console.log(`Using fallback topology format detection: ${isFlavioFormat ? 'flavio' : 'lorenzo'}`);
  }

  if (isFlavioFormat) {
    // Parse Flavio's topology
    return await parseFlavioTopology(content, fileMap, options);
  } else {
    // Parse Lorenzo's topology
    return await parseLorenzoTopology(lines, fileMap);
  }
};

// Function to get particle type based on index
export const getParticleType = (particleIndex, topologyData) => {
  // Check if this is Flavio format (has particleTypeMapping)
  if (topologyData.particleTypeMapping) {
    // Flavio format: direct particle index to type mapping
    if (particleIndex < topologyData.particleTypeMapping.length) {
      return topologyData.particleTypeMapping[particleIndex];
    } else {
      // Fallback to first type if index is out of range
      const firstType = topologyData.particleTypes[0];
      return {
        typeIndex: firstType.typeIndex,
        particleType: firstType,
      };
    }
  } else {
    // Lorenzo format: use cumulative counts
    const particleTypes = topologyData.particleTypes;
    let cumulativeCount = 0;
    for (let i = 0; i < particleTypes.length; i++) {
      cumulativeCount += particleTypes[i].count;
      if (particleIndex < cumulativeCount) {
        return {
          typeIndex: particleTypes[i].typeIndex, // Use the assigned typeIndex
          particleType: particleTypes[i],
        };
      }
    }

    // Default to the last type if not found
    const lastType = particleTypes[particleTypes.length - 1];
    return {
      typeIndex: lastType.typeIndex,
      particleType: lastType,
    };
  }
};

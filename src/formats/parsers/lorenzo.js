import * as THREE from 'three';

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

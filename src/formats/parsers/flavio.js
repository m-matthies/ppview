import { parseParticleTxt, parsePatchesTxt } from './shared';

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

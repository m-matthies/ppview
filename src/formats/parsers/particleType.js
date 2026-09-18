/**
 * Maps a particle index to its type entry. Each format stores that mapping
 * differently, so the lookup has to know about all of them.
 */
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

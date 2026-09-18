import { create } from 'zustand';

// The radius every other size in the scene is expressed relative to. Renderers
// with their own intrinsic geometry (oxDNA nucleotides, raspberry beads) scale
// by particleRadius / this, so the control moves them together with the plain
// particle spheres instead of leaving them fixed.
export const DEFAULT_PARTICLE_RADIUS = 0.5;

export const useParticleStore = create((set, get) => ({
  // Particle and trajectory data
  positions: [],
  currentBoxSize: [34.199520111084, 34.199520111084, 34.199520111084],
  topData: null,
  trajFile: null,
  configIndex: [],
  currentConfigIndex: 0,
  currentTime: 0,
  currentEnergy: [],
  totalConfigs: 0,
  particleRadius: DEFAULT_PARTICLE_RADIUS,
  
  // Actions
  setPositions: (positions) => {
    // Validate that positions is an array
    if (!Array.isArray(positions)) {
      console.error('setPositions called with non-array value:', positions);
      console.trace('Stack trace:');
      set({ positions: [] });
    } else {
      set({ positions });
    }
  },
  setCurrentBoxSize: (boxSize) => {
    // Only update when values actually change — prevents new array reference every frame
    // for constant-box trajectories, which would trigger cascading re-renders.
    const current = get().currentBoxSize;
    if (Array.isArray(current) && current.length === boxSize.length &&
        current[0] === boxSize[0] && current[1] === boxSize[1] && current[2] === boxSize[2]) return;
    set({ currentBoxSize: boxSize });
  },
  setTopData: (topData) => set({ topData }),
  setTrajFile: (trajFile) => set({ trajFile }),
  setConfigIndex: (index) => set({ configIndex: index }),
  setCurrentConfigIndex: (index) => set({ currentConfigIndex: index }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setCurrentEnergy: (energy) => set({ currentEnergy: energy }),
  setTotalConfigs: (total) => set({ totalConfigs: total }),
  setParticleRadius: (radius) => set({ particleRadius: radius }),
  
  // Computed values
  getUniqueParticleTypes: () => {
    const { positions } = get();
    if (!Array.isArray(positions)) {
      console.warn('positions is not an array:', positions);
      return new Set();
    }
    return new Set(positions.map(pos => pos.typeIndex).filter(type => type !== undefined));
  },
}));

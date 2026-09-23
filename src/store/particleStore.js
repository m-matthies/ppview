import { create } from 'zustand';

// The radius used when nothing in the loaded files says otherwise.
export const DEFAULT_PARTICLE_RADIUS = 0.5;

export const useParticleStore = create((set, get) => ({
  // Particle and trajectory data
  positions: [],
  // The bonds of the frame on screen, from a cluster/bond observable, or null.
  // Per-frame data like the positions themselves, which is why it lives here
  // rather than with the clustering: it is what the file says is joined to
  // what at this instant, not a decision anyone made about the scene.
  bonds: null,
  currentBoxSize: [34.199520111084, 34.199520111084, 34.199520111084],
  topData: null,
  trajFile: null,
  configIndex: [],
  // The simulation step each frame was printed at, from its `t =` header.
  // Kept because a cluster/bond observable prints on its own interval, so
  // lining one up with the trajectory means matching step numbers.
  configTimes: [],
  // The run's observable definitions, from observables.json or the input's own
  // data_output blocks. Held because an observable that writes no step numbers
  // can only be lined up with the trajectory through its print_every.
  observableConfig: [],
  currentConfigIndex: 0,
  /**
   * The frame the positions in the store actually came from.
   *
   * `currentConfigIndex` is the frame that was *asked* for; reading it is
   * asynchronous, so between the two the store holds one frame's positions and
   * another frame's index. Anything drawn per particle has to follow this one,
   * or it is drawn against coordinates it does not describe.
   */
  loadedConfigIndex: 0,
  currentTime: 0,
  currentEnergy: [],
  totalConfigs: 0,
  particleRadius: DEFAULT_PARTICLE_RADIUS,
  // The radius the loaded files themselves established — PATCHY_radius from an
  // oxDNA input file, or the radius an SRS topology carries.
  //
  // Renderers with intrinsic geometry (oxDNA nucleotides, raspberry beads) scale
  // by particleRadius / this, so at load the ratio is exactly 1 and every size
  // is the one the files specify, while dragging the radius control still moves
  // them together with the plain spheres. Scaling by DEFAULT_PARTICLE_RADIUS
  // instead double-counted the file's own radius: a PATCHY_radius of 2.5 blew
  // beads and nucleotides up five-fold before anyone touched a control.
  baseParticleRadius: DEFAULT_PARTICLE_RADIUS,
  
  // Actions
  setBonds: (bonds) => set(state => (state.bonds === bonds ? state : { bonds })),

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
  setConfigTimes: (times) => set({ configTimes: times }),
  setObservableConfig: (outputs) => set({ observableConfig: outputs }),
  setCurrentConfigIndex: (index) => set({ currentConfigIndex: index }),
  setLoadedConfigIndex: (index) => set(state =>
    (state.loadedConfigIndex === index ? state : { loadedConfigIndex: index })),
  setCurrentTime: (time) => set({ currentTime: time }),
  setCurrentEnergy: (energy) => set({ currentEnergy: energy }),
  setTotalConfigs: (total) => set({ totalConfigs: total }),
  setParticleRadius: (radius) => set({ particleRadius: radius }),

  // A radius that came from the files, not from the control: it becomes both the
  // current radius and the baseline intrinsic geometry is measured against.
  setFormatParticleRadius: (radius) => set({
    particleRadius: radius,
    baseParticleRadius: radius,
  }),

  // A new simulation must not inherit the last one's baseline.
  resetParticleRadius: () => set({
    particleRadius: DEFAULT_PARTICLE_RADIUS,
    baseParticleRadius: DEFAULT_PARTICLE_RADIUS,
  }),
  
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

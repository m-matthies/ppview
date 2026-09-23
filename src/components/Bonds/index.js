import React, { useMemo } from "react";
import * as THREE from "three";
import { useParticleStore } from "../../store/particleStore";
import { useUIStore } from "../../store/uiStore";
import InstancedLayer from "../../rendering/InstancedLayer";
import { cylinderBetween, cylinderScratch } from "../../rendering/transforms";
import useClusterVisuals from "../../rendering/useClusterVisuals";

/**
 * Bonds read from a cluster/bond observable, as instanced cylinders.
 *
 * Unlike `Springs`, whose connections are fixed by the topology, these change
 * every frame: two particles are bonded at one timestep and not at the next,
 * which is the whole point of the observable. `hooks/useObservableFrame` keeps
 * `particleStore.bonds` pointed at the frame on screen; this draws whatever is
 * there.
 *
 * Grey rather than coloured by patch. A bond has *two* patch ids, one at each
 * end, so there is no single colour that would be honest — and the particles it
 * joins are already carrying the scene's meaningful colour, whether that is
 * particle type or cluster membership.
 */
function Bonds() {
  const positions = useParticleStore(state => state.positions);
  const bonds = useParticleStore(state => state.bonds);
  const boxSize = useParticleStore(state => state.currentBoxSize);
  const particleRadius = useParticleStore(state => state.particleRadius);
  const sphereSegments = useUIStore(state => state.sphereSegments);
  const showBonds = useUIStore(state => state.showBonds);
  const appearanceOf = useClusterVisuals();

  const count = bonds?.a.length ?? 0;

  // Slightly thinner than a spring: a bonded patchy system is a far denser
  // graph than a spring network, and at the spring's thickness the cylinders
  // close up into a solid mass.
  const bondRadius = particleRadius * 0.12;

  const geometry = useMemo(
    () => new THREE.CylinderGeometry(1, 1, 1, sphereSegments),
    [sphereSegments],
  );
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#9a9a9a",
    metalness: 0.2,
    roughness: 0.6,
  }), []);

  const scratch = useMemo(cylinderScratch, []);

  // A bond follows the cluster state of the particles it joins, and is drawn
  // only while both are: a bond left hanging after its particles were hidden is
  // the bug `Springs` shipped with twice.
  const write = useMemo(() => (i, dummy) => {
    const p1 = bonds.a[i];
    const p2 = bonds.b[i];
    // An observable that names more particles than the structure has is caught
    // when the file loads, but a frame can still be read before the positions
    // for it have arrived.
    if (p1 >= positions.length || p2 >= positions.length) return false;

    const a = appearanceOf(p1, { allowSelectionColor: false });
    const b = appearanceOf(p2, { allowSelectionColor: false });
    if (a.hidden || b.hidden) return false;

    const thickness = bondRadius * Math.min(a.scaleFactor, b.scaleFactor);
    return cylinderBetween(
      dummy, scratch, positions[p1], positions[p2], boxSize, thickness,
    );
  }, [bonds, positions, boxSize, bondRadius, scratch, appearanceOf]);

  if (!showBonds || count === 0) return null;

  return (
    <InstancedLayer
      geometry={geometry}
      material={material}
      count={count}
      write={write}
      deps={[write]}
    />
  );
}

export default Bonds;

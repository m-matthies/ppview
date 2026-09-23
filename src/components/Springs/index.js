import React, { useMemo } from "react";
import * as THREE from "three";
import { useParticleStore } from "../../store/particleStore";
import { useUIStore } from "../../store/uiStore";
import InstancedLayer from "../../rendering/InstancedLayer";
import { cylinderBetween, cylinderScratch } from "../../rendering/transforms";
import useClusterVisuals from "../../rendering/useClusterVisuals";

// Renders spring bonds between connected particles as instanced cylinders.
// Spring connection topology comes from topData.springConnections, which is
// static per file load. Cylinder positions update with each trajectory frame.
function Springs() {
  const positions = useParticleStore(state => state.positions);
  const boxSize = useParticleStore(state => state.currentBoxSize);
  const particleRadius = useParticleStore(state => state.particleRadius);
  const topData = useParticleStore(state => state.topData);
  const sphereSegments = useUIStore(state => state.sphereSegments);
  const appearanceOf = useClusterVisuals();

  const springConnections = topData?.springConnections;
  const count = springConnections?.length ?? 0;

  // Cylinder radius: 15% of particle radius
  const springRadius = particleRadius * 0.15;

  // Unit cylinder along Y axis, height=1 (scaled per instance)
  const geometry = useMemo(
    () => new THREE.CylinderGeometry(1, 1, 1, sphereSegments),
    [sphereSegments],
  );
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#888888",
    metalness: 0.2,
    roughness: 0.6,
  }), []);

  // Reused across instances rather than allocated per spring.
  const scratch = useMemo(cylinderScratch, []);

  // A spring follows the cluster state of the particles it joins: it is drawn
  // only when both ends are. Springs once ignored clustering entirely and hung
  // in space after their particles were hidden; until this moved to the shared
  // hook they were also the one layer that never asked about the per-cluster eye
  // control, so hiding a cluster left its springs behind.

  const write = useMemo(() => (i, dummy) => {
    const { p1, p2 } = springConnections[i];
    if (p1 >= positions.length || p2 >= positions.length) return false;

    const a = appearanceOf(p1, { allowSelectionColor: false });
    const b = appearanceOf(p2, { allowSelectionColor: false });
    if (a.hidden || b.hidden) return false;

    // A dimmed spring thins with its particles rather than disappearing.
    const thickness = springRadius * Math.min(a.scaleFactor, b.scaleFactor);
    // Returns false for a degenerate spring, and for one that wraps a periodic
    // boundary — which would be drawn straight across the whole box.
    return cylinderBetween(
      dummy, scratch, positions[p1], positions[p2], boxSize, thickness,
    );
  }, [springConnections, positions, boxSize, springRadius, scratch, appearanceOf]);

  if (!springConnections || count === 0) return null;

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

export default Springs;

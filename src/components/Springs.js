import React, { useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useParticleStore } from "../store/particleStore";
import { useUIStore } from "../store/uiStore";
import { useThree } from "@react-three/fiber";

// Renders spring bonds between connected particles as instanced cylinders.
// Spring connection topology comes from topData.springConnections, which is
// static per file load. Cylinder positions update with each trajectory frame.
function Springs() {
  const positions = useParticleStore(state => state.positions);
  const boxSize = useParticleStore(state => state.currentBoxSize);
  const particleRadius = useParticleStore(state => state.particleRadius);
  const topData = useParticleStore(state => state.topData);
  const sphereSegments = useUIStore(state => state.sphereSegments);
  const { invalidate } = useThree();
  const meshRef = useRef();

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

  useEffect(() => {
    if (!meshRef.current || !springConnections || springConnections.length === 0) return;
    if (!positions || positions.length === 0) return;

    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    const halfBox = Math.min(boxSize[0], boxSize[1], boxSize[2]) / 2;

    for (let i = 0; i < springConnections.length; i++) {
      const { p1, p2 } = springConnections[i];

      if (p1 >= positions.length || p2 >= positions.length) {
        mesh.setMatrixAt(i, zeroScale);
        continue;
      }

      const pos1 = positions[p1];
      const pos2 = positions[p2];

      const v1 = new THREE.Vector3(
        pos1.x - boxSize[0] / 2,
        pos1.y - boxSize[1] / 2,
        pos1.z - boxSize[2] / 2,
      );
      const v2 = new THREE.Vector3(
        pos2.x - boxSize[0] / 2,
        pos2.y - boxSize[1] / 2,
        pos2.z - boxSize[2] / 2,
      );

      const dir = v2.clone().sub(v1);
      const distance = dir.length();

      // Hide degenerate or cross-boundary springs
      if (distance < 1e-6 || distance > halfBox) {
        mesh.setMatrixAt(i, zeroScale);
        continue;
      }

      dir.normalize();
      dummy.position.copy(v1).addScaledVector(dir, distance / 2);
      dummy.quaternion.setFromUnitVectors(up, dir);
      dummy.scale.set(springRadius, distance, springRadius);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    invalidate(); // frameloop="demand": tell R3F the canvas needs a redraw
  }, [positions, boxSize, springConnections, springRadius, geometry, invalidate]);

  if (!springConnections || count === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[geometry, material, count]} castShadow receiveShadow />
  );
}

export default Springs;

import React, { useRef, useEffect, useMemo } from "react";
import * as THREE from 'three';
import { useUIStore } from "../store/uiStore";

// Renders repulsion site beads for raspberry particles.
// Click/double-click handling is delegated to Particles.js via onRegister —
// this component just manages transforms and colors.
function RepulsionSites({ particles, repulsionSiteData, boxSize, particleScale = 1.0, typeColor, globalIndices, typeIndex, onRegister }) {
  const meshRef = useRef();
  const particlePositionsRef = useRef([]); // stable ref — updated every frame without re-registering
  const { selectedParticles, sphereSegments } = useUIStore();

  const geometry = useMemo(() => new THREE.SphereGeometry(1, sphereSegments, sphereSegments), [sphereSegments]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    metalness: 0.1,
    roughness: 0.7,
  }), []);

  const hasValidData = particles?.length > 0 && repulsionSiteData?.length > 0;
  const numBeads = repulsionSiteData?.length ?? 0;
  const totalBeads = hasValidData ? particles.length * numBeads : 0;

  // Register mesh + metadata with parent for centralized raycasting.
  // Pass particlePositionsRef so Particles.js always reads the latest positions
  // without causing a re-registration on every trajectory frame.
  useEffect(() => {
    if (onRegister && meshRef.current && hasValidData) {
      onRegister(typeIndex, { mesh: meshRef.current, numBeads, globalIndices, particlePositionsRef });
    }
    return () => {
      if (onRegister) onRegister(typeIndex, null);
    };
  }, [onRegister, typeIndex, hasValidData, numBeads, globalIndices]);

  // Set bead transforms (positions + scales).
  // Reuses localPos/rotMat objects across iterations to reduce GC pressure.
  useEffect(() => {
    if (!meshRef.current || !hasValidData) return;

    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    const localPos = new THREE.Vector3(); // reused across inner loop
    const rotMat = new THREE.Matrix3();   // reused across particles
    const positions = [];
    let index = 0;

    for (let i = 0; i < particles.length; i++) {
      const particle = particles[i];
      const px = particle.x - boxSize[0] / 2;
      const py = particle.y - boxSize[1] / 2;
      const pz = particle.z - boxSize[2] / 2;
      positions.push(new THREE.Vector3(px, py, pz));

      const hasRotation = !!particle.rotationMatrix;
      if (hasRotation) rotMat.fromArray(particle.rotationMatrix.elements);

      for (let j = 0; j < repulsionSiteData.length; j++) {
        const site = repulsionSiteData[j];
        localPos.set(
          site.position.x * particleScale,
          site.position.y * particleScale,
          site.position.z * particleScale,
        );
        if (hasRotation) localPos.applyMatrix3(rotMat);

        dummy.position.set(localPos.x + px, localPos.y + py, localPos.z + pz);
        dummy.scale.setScalar(site.radius * particleScale);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        index++;
      }
    }

    particlePositionsRef.current = positions;
    mesh.instanceMatrix.needsUpdate = true;
  }, [particles, repulsionSiteData, particleScale, hasValidData, boxSize, geometry]);

  // Update bead colors: yellow for selected particles, typeColor otherwise.
  // Uses setColorAt to update the buffer in-place — avoids allocating a new
  // InstancedBufferAttribute (and leaking the old GPU buffer) on every frame.
  useEffect(() => {
    if (!meshRef.current || !hasValidData) return;

    const mesh = meshRef.current;
    const yellowColor = new THREE.Color("yellow");

    for (let i = 0; i < particles.length; i++) {
      const globalIndex = globalIndices ? globalIndices[i] : i;
      const isSelected = Array.isArray(selectedParticles) && selectedParticles.includes(globalIndex);
      const color = isSelected ? yellowColor : typeColor;

      if (color) {
        for (let j = 0; j < numBeads; j++) {
          mesh.setColorAt(i * numBeads + j, color);
        }
      }
    }

    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [particles, typeColor, selectedParticles, globalIndices, hasValidData, numBeads]);

  if (!hasValidData) return null;

  return (
    <instancedMesh ref={meshRef} args={[geometry, material, totalBeads]} castShadow receiveShadow />
  );
}

export default RepulsionSites;

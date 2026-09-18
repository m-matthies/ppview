import React, { useRef, useEffect, useMemo } from "react";
import * as THREE from 'three';
import { useUIStore } from "../store/uiStore";
import { useParticleStore, DEFAULT_PARTICLE_RADIUS } from "../store/particleStore";
import { useClusteringStore } from "../store/clusteringStore";
import { getClusterAppearance } from "../utils/clusterAppearance";
import { useThree } from "@react-three/fiber";

// Renders repulsion site beads for raspberry particles.
// Click/double-click handling is delegated to Particles.js via onRegister —
// this component just manages transforms and colors.
function RepulsionSites({ particles, repulsionSiteData, boxSize, particleScale = 1.0, typeColor, globalIndices, typeIndex, onRegister }) {
  const meshRef = useRef();
  const particlePositionsRef = useRef([]); // stable ref — updated every frame without re-registering
  const { selectedParticles, sphereSegments } = useUIStore();
  const { invalidate } = useThree();
  const particleRadius = useParticleStore(state => state.particleRadius);
  // Bead sizes and offsets come from the topology. Scaling both by the same
  // factor resizes the whole raspberry particle while preserving the shape the
  // file describes.
  const radiusScale = particleRadius / DEFAULT_PARTICLE_RADIUS;

  const geometry = useMemo(() => new THREE.SphereGeometry(1, sphereSegments, sphereSegments), [sphereSegments]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    metalness: 0.1,
    roughness: 0.7,
  }), []);

  const hasValidData = particles?.length > 0 && repulsionSiteData?.length > 0;
  const numBeads = repulsionSiteData?.length ?? 0;
  const totalBeads = hasValidData ? particles.length * numBeads : 0;

  const { highlightedClusters, showOnlyHighlightedClusters, dimNonSelectedClusters } = useClusteringStore();

  // Cluster appearance per particle, resolved once and reused by both the
  // transform and the colour effect so the two can never disagree. Raspberry
  // particles are drawn entirely as beads, so without this they were the one
  // patchy format that ignored cluster highlighting completely.
  const appearance = useMemo(() => {
    if (!hasValidData) return [];
    return particles.map((_, i) => {
      const globalIndex = globalIndices ? globalIndices[i] : i;
      const isInHighlightedCluster = highlightedClusters.has(globalIndex);
      return getClusterAppearance({
        isSelected: Array.isArray(selectedParticles) && selectedParticles.includes(globalIndex),
        isInHighlightedCluster,
        shouldShow: !showOnlyHighlightedClusters || isInHighlightedCluster,
        hasHighlightedClusters: highlightedClusters.size > 0,
        showOnlyHighlightedClusters,
        dimNonSelectedClusters,
        baseColor: typeColor,
      });
    });
  }, [particles, globalIndices, selectedParticles, highlightedClusters,
      showOnlyHighlightedClusters, dimNonSelectedClusters, typeColor, hasValidData]);

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

      // Scale bead offsets and radii together so a highlighted particle grows
      // as a whole and a hidden one collapses to nothing, exactly like a plain
      // sphere does, instead of its beads drifting apart or lingering as
      // shrunken specks.
      // Beads collapse both when the particle is hidden and when it is dimmed:
      // in the dimmed case the centre sphere in Particles.js draws the marker
      // instead, so drawing shrunken beads too would double up.
      const entry = appearance[i];
      const clusterScale = (entry?.hidden || entry?.dimmed) ? 0 : (entry?.scaleFactor ?? 1);
      const siteScale = particleScale * radiusScale * clusterScale;

      for (let j = 0; j < repulsionSiteData.length; j++) {
        const site = repulsionSiteData[j];
        localPos.set(
          site.position.x * siteScale,
          site.position.y * siteScale,
          site.position.z * siteScale,
        );
        if (hasRotation) localPos.applyMatrix3(rotMat);

        dummy.position.set(localPos.x + px, localPos.y + py, localPos.z + pz);
        dummy.scale.setScalar(site.radius * siteScale);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        index++;
      }
    }

    particlePositionsRef.current = positions;
    mesh.instanceMatrix.needsUpdate = true;
    invalidate(); // frameloop="demand": tell R3F the canvas needs a redraw
  }, [particles, repulsionSiteData, particleScale, radiusScale, appearance, hasValidData, boxSize, geometry, invalidate]);

  // Bead colours follow the shared cluster rule: yellow when selected, type
  // colour otherwise. Hidden particles carry zero scale, so their colour is
  // moot.
  // Uses setColorAt to update the buffer in-place — avoids allocating a new
  // InstancedBufferAttribute (and leaking the old GPU buffer) on every frame.
  useEffect(() => {
    if (!meshRef.current || !hasValidData) return;

    const mesh = meshRef.current;

    for (let i = 0; i < particles.length; i++) {
      const color = appearance[i]?.color;
      if (!color) continue;
      for (let j = 0; j < numBeads; j++) {
        mesh.setColorAt(i * numBeads + j, color);
      }
    }

    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate(); // frameloop="demand": tell R3F the canvas needs a redraw
    // `geometry` matters here even though this effect never reads it: changing it
    // makes r3f rebuild the InstancedMesh, and a fresh mesh has instanceColor
    // === null. Without this dep the beads keep the bare white material.
  }, [particles, appearance, hasValidData, numBeads, geometry, invalidate]);

  if (!hasValidData) return null;

  return (
    <instancedMesh ref={meshRef} args={[geometry, material, totalBeads]} castShadow receiveShadow />
  );
}

export default RepulsionSites;

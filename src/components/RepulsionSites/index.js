import React, { useMemo, useRef, useCallback, useEffect } from "react";
import * as THREE from 'three';
import { useUIStore } from "../../store/uiStore";
import { useParticleStore } from "../../store/particleStore";
import InstancedLayer from "../../rendering/InstancedLayer";
import { useRegisterPickable } from "../../rendering/pickingService";
import { centreOnBox, rotationMatrixOf } from "../../rendering/transforms";
import useClusterVisuals from "../../rendering/useClusterVisuals";
import {
  impostorGeometry, makeImpostorMaterial, shouldUseImpostors, impostorOverride, applyImpostorRaycast,
} from "../../rendering/impostors";

/**
 * Repulsion-site beads for raspberry particles.
 *
 * Each particle is drawn as several beads rather than one sphere, so this layer
 * holds `numBeads` instances per particle and maps them back to a particle index
 * for picking.
 */
function RepulsionSites({ particles, repulsionSiteData, boxSize, particleScale = 1.0, typeColor, globalIndices, typeIndex }) {
  const meshRef = useRef();
  // One value at a time. A bare useUIStore() re-renders this layer on any
  // write to that store — a legend toggle, a lighting slider — and each
  // re-render re-runs the per-instance matrix and colour loops below.
  const appearanceOf = useClusterVisuals();
  const sphereSegments = useUIStore(state => state.sphereSegments);
  const particleRadius = useParticleStore(state => state.particleRadius);

  // Bead sizes and offsets come from the topology. Scaling both by the same
  // factor resizes the whole raspberry particle while preserving the shape the
  // file describes.
  // Relative to the radius the files established, so this is 1 at load and
  // the geometry is the size the topology describes.
  const baseParticleRadius = useParticleStore(state => state.baseParticleRadius);
  const radiusScale = particleRadius / (baseParticleRadius || 1);

  const hasValidData = particles?.length > 0 && repulsionSiteData?.length > 0;
  const numBeads = repulsionSiteData?.length ?? 0;
  const totalBeads = hasValidData ? particles.length * numBeads : 0;

  // On the bead count, not the particle count, because beads are what is drawn:
  // a raspberry particle is several of them, so a system well under the
  // threshold by particles can be well over it by spheres. Counting particles
  // here meant the one format that draws the most geometry per particle was the
  // last to get impostors.
  const useImpostors = useMemo(
    () => shouldUseImpostors(totalBeads, impostorOverride()), [totalBeads],
  );

  const geometry = useMemo(
    () => (useImpostors
      ? impostorGeometry()
      : new THREE.SphereGeometry(1, sphereSegments, sphereSegments)),
    [useImpostors, sphereSegments],
  );
  const material = useMemo(
    // The bead radius is written into the instance scale — the sphere geometry
    // here is a unit sphere — so the shader's radius multiplier is 1.
    () => (useImpostors
      ? makeImpostorMaterial({ metalness: 0.1, roughness: 0.7, particleRadius: 1 })
      : new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.7 })),
    [useImpostors],
  );

  // The ray has to meet the sphere the shader draws, not the quad it draws on.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !useImpostors) return undefined;
    const previous = mesh.raycast;
    applyImpostorRaycast(mesh, () => 1);
    return () => { mesh.raycast = previous; };
  }, [useImpostors, geometry, totalBeads]);

  // Cluster appearance per particle, resolved once and shared by every bead of
  // that particle. Raspberry is drawn entirely as beads, so without this it was
  // the one patchy format that ignored cluster highlighting completely.
  const appearance = useMemo(() => {
    if (!hasValidData) return [];
    return particles.map((_, i) => {
      const globalIndex = globalIndices ? globalIndices[i] : i;
      return appearanceOf(globalIndex, { baseColor: typeColor });
    });
  }, [particles, globalIndices, appearanceOf, typeColor, hasValidData]);

  const scratch = useMemo(() => ({
    centre: new THREE.Vector3(),
    local: new THREE.Vector3(),
    rot: new THREE.Matrix3(),
  }), []);

  const write = useMemo(() => (index, dummy, setColor) => {
    const i = Math.floor(index / numBeads);
    const j = index % numBeads;
    const particle = particles[i];
    const site = repulsionSiteData[j];
    if (!particle || !site) return false;

    const entry = appearance[i];
    // Beads collapse both when the particle is hidden and when it is dimmed: in
    // the dimmed case the centre sphere in Particles.js draws the marker
    // instead, so drawing shrunken beads too would double up.
    if (entry?.hidden || entry?.dimmed) return false;

    const clusterScale = entry?.scaleFactor ?? 1;
    const siteScale = particleScale * radiusScale * clusterScale;

    centreOnBox(scratch.centre, particle, boxSize);
    scratch.local.set(
      site.position.x * siteScale,
      site.position.y * siteScale,
      site.position.z * siteScale,
    );
    const rotation = rotationMatrixOf(particle, scratch.rot);
    if (rotation) scratch.local.applyMatrix3(rotation);

    dummy.position.copy(scratch.local).add(scratch.centre);
    dummy.scale.setScalar(site.radius * siteScale);
    setColor(entry?.color ?? typeColor);
    return true;
  }, [particles, repulsionSiteData, numBeads, appearance, particleScale,
      radiusScale, boxSize, typeColor, scratch]);

  // Every bead of a particle resolves to that particle.
  const resolveIndex = useCallback((instanceId) => {
    const i = Math.floor(instanceId / numBeads);
    if (appearance[i]?.hidden || appearance[i]?.dimmed) return null;
    return globalIndices ? globalIndices[i] : i;
  }, [numBeads, globalIndices, appearance]);

  useRegisterPickable(`beads-${typeIndex}`, { meshRef, resolveIndex, enabled: hasValidData });

  if (!hasValidData) return null;

  return (
    <InstancedLayer
      ref={meshRef}
      geometry={geometry}
      material={material}
      count={totalBeads}
      write={write}
      deps={[write]}
    />
  );
}

export default RepulsionSites;

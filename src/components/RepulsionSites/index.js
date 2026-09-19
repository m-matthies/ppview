import React, { useMemo, useRef, useCallback } from "react";
import * as THREE from 'three';
import { useUIStore } from "../../store/uiStore";
import { useParticleStore, DEFAULT_PARTICLE_RADIUS } from "../../store/particleStore";
import { useClusteringStore } from "../../store/clusteringStore";
import { useOverlayStore } from "../../store/overlayStore";
import { overlayColorFor } from "../../utils/overlays";
import InstancedLayer from "../../rendering/InstancedLayer";
import { useRegisterPickable } from "../../rendering/pickingService";
import { centreOnBox, rotationMatrixOf } from "../../rendering/transforms";
import { getClusterAppearance, clusterColorFor } from "../../utils/clusterAppearance";

/**
 * Repulsion-site beads for raspberry particles.
 *
 * Each particle is drawn as several beads rather than one sphere, so this layer
 * holds `numBeads` instances per particle and maps them back to a particle index
 * for picking.
 */
function RepulsionSites({ particles, repulsionSiteData, boxSize, particleScale = 1.0, typeColor, globalIndices, typeIndex }) {
  const meshRef = useRef();
  const { selectedParticles, sphereSegments } = useUIStore();
  const particleRadius = useParticleStore(state => state.particleRadius);
  const { highlightedClusters, showOnlyHighlightedClusters, dimNonSelectedClusters, clusterColors, hiddenParticles } = useClusteringStore();
  // An active overlay replaces the base colour for the particles it covers.
  const overlayColors = useOverlayStore(state =>
    state.overlays.find(o => o.id === state.activeOverlayId)?.colors ?? null);

  // Bead sizes and offsets come from the topology. Scaling both by the same
  // factor resizes the whole raspberry particle while preserving the shape the
  // file describes.
  const radiusScale = particleRadius / DEFAULT_PARTICLE_RADIUS;

  const geometry = useMemo(
    () => new THREE.SphereGeometry(1, sphereSegments, sphereSegments),
    [sphereSegments],
  );
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    metalness: 0.1,
    roughness: 0.7,
  }), []);

  const hasValidData = particles?.length > 0 && repulsionSiteData?.length > 0;
  const numBeads = repulsionSiteData?.length ?? 0;
  const totalBeads = hasValidData ? particles.length * numBeads : 0;

  // Cluster appearance per particle, resolved once and shared by every bead of
  // that particle. Raspberry is drawn entirely as beads, so without this it was
  // the one patchy format that ignored cluster highlighting completely.
  const appearance = useMemo(() => {
    if (!hasValidData) return [];
    return particles.map((_, i) => {
      const globalIndex = globalIndices ? globalIndices[i] : i;
      const isInHighlightedCluster = highlightedClusters.has(globalIndex);
      return getClusterAppearance({
        forceHidden: hiddenParticles.has(globalIndex),
        isSelected: Array.isArray(selectedParticles) && selectedParticles.includes(globalIndex),
        isInHighlightedCluster,
        shouldShow: !showOnlyHighlightedClusters || isInHighlightedCluster,
        hasHighlightedClusters: highlightedClusters.size > 0,
        showOnlyHighlightedClusters,
        dimNonSelectedClusters,
        baseColor: overlayColorFor(overlayColors, globalIndex, THREE) ?? typeColor,
        clusterColor: clusterColorFor(clusterColors, globalIndex, THREE),
      });
    });
  }, [particles, globalIndices, selectedParticles, highlightedClusters,
      showOnlyHighlightedClusters, dimNonSelectedClusters, clusterColors, hiddenParticles, overlayColors,
      typeColor, hasValidData]);

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

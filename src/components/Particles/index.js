import React, { useMemo, useRef, useCallback } from "react";
import * as THREE from "three";
import RepulsionSites from "../RepulsionSites";
import Patches from "../Patches";
import { getParticleColors } from "../../colors";
import { useParticleStore } from "../../store/particleStore";
import { useUIStore } from "../../store/uiStore";
import { useClusteringStore } from "../../store/clusteringStore";
import { useOverlayStore } from "../../store/overlayStore";
import { overlayColorFor } from "../../utils/overlays";
import { getClusterAppearance, clusterColorFor } from "../../utils/clusterAppearance";
import InstancedLayer from "../../rendering/InstancedLayer";
import { useRegisterPickable } from "../../rendering/pickingService";
import { centreOnBox } from "../../rendering/transforms";

/**
 * Patchy-particle rendering: one sphere per particle, plus per-type repulsion
 * beads and patch cones.
 *
 * Picking is not handled here any more. Each layer registers its mesh with the
 * scene-level picking service, which owns the single raycaster and the canvas
 * listeners.
 */
function Particles() {
  const positions = useParticleStore(state => state.positions);
  const boxSize = useParticleStore(state => state.currentBoxSize);
  const particleRadius = useParticleStore(state => state.particleRadius);
  const { selectedParticles, sphereSegments } = useUIStore();
  const colorScheme = useUIStore(state => state.currentColorScheme);
  const showPatches = useUIStore(state => state.showPatchLegend);
  const { highlightedClusters, showOnlyHighlightedClusters, dimNonSelectedClusters, clusterColors, hiddenParticles } = useClusteringStore();
  // An active overlay replaces the base colour for the particles it covers.
  const overlayColors = useOverlayStore(state =>
    state.overlays.find(o => o.id === state.activeOverlayId)?.colors ?? null);
  const meshRef = useRef();

  const count = positions?.length ?? 0;

  const geometry = useMemo(
    () => new THREE.SphereGeometry(particleRadius, sphereSegments, sphereSegments),
    [particleRadius, sphereSegments],
  );

  const material = useMemo(() => new THREE.MeshStandardMaterial({
    metalness: 0.1,
    roughness: 0.7,
    envMapIntensity: 1.0,
    emissive: 0x000000,
    emissiveIntensity: 0.05,
  }), []);

  const particleTypeCount = useMemo(() => {
    if (!positions?.length) return 0;
    return new Set(positions.map(p => p.typeIndex).filter(t => t !== undefined)).size;
  }, [positions]);

  const particleColors = useMemo(
    () => getParticleColors(colorScheme, particleTypeCount),
    [colorScheme, particleTypeCount],
  );

  // Pre-built THREE.Color objects indexed by type, so neither the render body
  // nor the per-instance write allocates a Color. Keeping these reference-stable
  // also stops RepulsionSites/Patches re-running their colour effects.
  const stableTypeColors = useMemo(
    () => particleColors.map(hex => new THREE.Color(hex)),
    [particleColors],
  );

  const particleData = useMemo(() => {
    if (!Array.isArray(positions) || positions.length === 0) return [];
    return positions.map((pos) => ({
      typeColor: pos.mglColor
        ? new THREE.Color(pos.mglColor.r, pos.mglColor.g, pos.mglColor.b)
        : stableTypeColors[pos.typeIndex % Math.max(stableTypeColors.length, 1)],
      baseScale: pos.particleType?.particleScale ?? 1.0,
      hasRepulsionSites: !!(pos.particleType?.repulsionSiteData?.length),
    }));
  }, [positions, stableTypeColors]);

  const scratch = useMemo(() => ({ position: new THREE.Vector3() }), []);

  const write = useMemo(() => (i, dummy, setColor) => {
    const data = particleData[i];
    const pos = positions[i];
    if (!data || !pos) return false;

    const isInHighlightedCluster = highlightedClusters.has(i);
    const { color, scaleFactor, dimmed } = getClusterAppearance({
      forceHidden: hiddenParticles.has(i),
      isSelected: Array.isArray(selectedParticles) && selectedParticles.includes(i),
      isInHighlightedCluster,
      shouldShow: !showOnlyHighlightedClusters || isInHighlightedCluster,
      hasHighlightedClusters: highlightedClusters.size > 0,
      showOnlyHighlightedClusters,
      dimNonSelectedClusters,
      baseColor: overlayColorFor(overlayColors, i, THREE) ?? data.typeColor,
      clusterColor: clusterColorFor(clusterColors, i, THREE),
    });

    // A raspberry particle is drawn by its beads, so its centre sphere is
    // hidden. The one exception is the dimmed marker: one small sphere at the
    // centre reads far better than a swarm of shrunken beads, so the centre
    // sphere takes that over and RepulsionSites stands down.
    const scale = data.hasRepulsionSites
      ? (dimmed ? data.baseScale * scaleFactor : 0)
      : data.baseScale * scaleFactor;
    if (scale <= 0) return false;

    centreOnBox(scratch.position, pos, boxSize);
    dummy.position.copy(scratch.position);
    dummy.scale.setScalar(scale);
    setColor(color);
    return true;
  }, [particleData, positions, boxSize, selectedParticles, highlightedClusters,
      showOnlyHighlightedClusters, dimNonSelectedClusters, clusterColors, hiddenParticles, overlayColors, scratch]);

  // The sphere mesh is clickable except where a raspberry particle's hidden
  // centre sits — those clicks belong to the beads.
  const resolveIndex = useCallback((instanceId) => {
    const data = particleData[instanceId];
    if (!data || data.hasRepulsionSites) return null;
    return instanceId;
  }, [particleData]);

  useRegisterPickable('particles', { meshRef, resolveIndex });

  // Group particles by type, tracking global indices so child layers can look
  // up cluster and selection state without searching.
  const particlesByType = useMemo(() => {
    const map = new Map();
    if (!positions?.length) return map;
    positions.forEach((pos, globalIndex) => {
      const typeIndex = pos.typeIndex;
      if (!map.has(typeIndex)) {
        map.set(typeIndex, { particleType: pos.particleType, particles: [], globalIndices: [] });
      }
      map.get(typeIndex).particles.push(pos);
      map.get(typeIndex).globalIndices.push(globalIndex);
    });
    return map;
  }, [positions]);

  if (!positions || positions.length === 0) return null;

  return (
    <>
      <InstancedLayer
        ref={meshRef}
        geometry={geometry}
        material={material}
        count={count}
        write={write}
        deps={[write]}
      />

      {Array.from(particlesByType.values()).map(({ particleType, particles, globalIndices }, idx) => {
        if (!particleType?.repulsionSiteData?.length) return null;
        return (
          <RepulsionSites
            key={`repulsion-${particleType.typeIndex}-${idx}`}
            particles={particles}
            repulsionSiteData={particleType.repulsionSiteData}
            boxSize={boxSize}
            particleScale={particleType.particleScale ?? 1.0}
            typeColor={stableTypeColors[particleType.typeIndex % stableTypeColors.length]}
            globalIndices={globalIndices}
            typeIndex={particleType.typeIndex}
          />
        );
      })}

      {showPatches && Array.from(particlesByType.values()).map(({ particleType, particles, globalIndices }, idx) => {
        const valid = particleType?.patchPositions?.length > 0 &&
          particleType.patches?.length > 0 &&
          particleType.patches.length === particleType.patchPositions.length;
        if (!valid) return null;
        return (
          <Patches
            key={`patches-${particleType.typeIndex}-${idx}`}
            particles={particles}
            globalIndices={globalIndices}
            patchPositions={particleType.patchPositions}
            patchIDs={particleType.patches}
            boxSize={boxSize}
            colorScheme={colorScheme}
          />
        );
      })}
    </>
  );
}

export default Particles;

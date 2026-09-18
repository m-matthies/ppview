import React, { useMemo } from "react";
import * as THREE from 'three';
import { getColorForPatchID } from '../../utils/colorUtils';
import { useParticleStore } from '../../store/particleStore';
import { useUIStore } from '../../store/uiStore';
import { useClusteringStore } from '../../store/clusteringStore';
import InstancedLayer from '../../rendering/InstancedLayer';
import { centreOnBox, rotationMatrixOf } from '../../rendering/transforms';
import { getClusterAppearance } from '../../utils/clusterAppearance';

/**
 * Patch cones, one instance per (particle, patch) pair.
 *
 * The cone's tip sits on the particle surface and its base flares outward. The
 * geometry is translated so the tip is at the origin, which makes the instance
 * transform a plain "put the tip here, point it inward".
 */
function Patches({ particles, globalIndices, patchPositions, patchIDs, boxSize, colorScheme = null }) {
  const particleRadius = useParticleStore(state => state.particleRadius);
  const coneSegments = useUIStore(state => state.sphereSegments);
  const { highlightedClusters, showOnlyHighlightedClusters, dimNonSelectedClusters } = useClusteringStore();

  // Patch cone dimensions — scaled proportionally to particle radius so patches
  // stay visually consistent across formats with different particle sizes.
  // default particleRadius=0.5 gives the original coneRadius=0.2, coneHeight=0.4.
  const coneRadius = particleRadius * 0.4;
  const coneHeight = particleRadius * 0.8;

  const geometry = useMemo(() => {
    const cone = new THREE.ConeGeometry(coneRadius, coneHeight, coneSegments);
    // Tip at the origin, so the instance position places the tip directly.
    cone.translate(0, -coneHeight / 2, 0);
    return cone;
  }, [coneRadius, coneHeight, coneSegments]);

  // Native instance colours (three r130+). This used to inject a custom shader
  // and rebuild a Float32Array attribute on every update, which leaked the old
  // GPU buffer each time.
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: 'white',
    metalness: 0.3,
    roughness: 0.7,
    side: THREE.DoubleSide,
  }), []);

  const hasValidPatchData = particles && patchPositions && patchIDs &&
    particles.length > 0 && patchPositions.length > 0 &&
    patchIDs.length > 0 && patchPositions.length === patchIDs.length;

  const patchesPerParticle = hasValidPatchData ? patchPositions.length : 0;
  const totalPatches = hasValidPatchData ? particles.length * patchesPerParticle : 0;

  // Patches follow their particle's cluster state. `allowSelectionColor` is off
  // because a patch's colour encodes its patch ID — turning it yellow on
  // selection would discard that. The scale factor still applies, so patches
  // grow with a highlighted particle and vanish with a hidden one.
  const appearance = useMemo(() => {
    if (!hasValidPatchData) return [];
    return particles.map((_, i) => {
      const globalIndex = globalIndices ? globalIndices[i] : i;
      const isInHighlightedCluster = highlightedClusters.has(globalIndex);
      return getClusterAppearance({
        isInHighlightedCluster,
        shouldShow: !showOnlyHighlightedClusters || isInHighlightedCluster,
        hasHighlightedClusters: highlightedClusters.size > 0,
        showOnlyHighlightedClusters,
        dimNonSelectedClusters,
        baseColor: null, // resolved per patch below
        allowSelectionColor: false,
      });
    });
  }, [particles, globalIndices, highlightedClusters, showOnlyHighlightedClusters, dimNonSelectedClusters, hasValidPatchData]);

  // Patch colours are per patch ID and change only with the colour scheme.
  const patchColors = useMemo(
    () => patchIDs?.map(id => getColorForPatchID(id, colorScheme)) ?? [],
    [patchIDs, colorScheme],
  );

  const scratch = useMemo(() => ({
    particlePosition: new THREE.Vector3(),
    local: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    inward: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
    rot: new THREE.Matrix3(),
  }), []);

  const write = useMemo(() => (index, dummy, setColor) => {
    const i = Math.floor(index / patchesPerParticle);
    const j = index % patchesPerParticle;
    const particle = particles[i];
    const patchOffset = patchPositions[j];
    if (!particle || !patchOffset || patchIDs[j] == null) return false;

    const entry = appearance[i];
    if (entry?.hidden) return false;
    const clusterScale = entry?.scaleFactor ?? 1;

    // Always normalise to the particle surface so the patch tip sits at
    // radius=particleRadius regardless of whether the input vector is
    // unit-length, sub-unit (Flavio ~0.5) or larger (Lorenzo/SRS > 1).
    const length = Math.hypot(patchOffset.x, patchOffset.y, patchOffset.z);
    if (length < 1e-9) return false; // degenerate

    centreOnBox(scratch.particlePosition, particle, boxSize);
    const rotation = rotationMatrixOf(particle, scratch.rot);

    const surfaceScale = (particleRadius * clusterScale) / length;
    scratch.local.set(patchOffset.x, patchOffset.y, patchOffset.z).multiplyScalar(surfaceScale);
    scratch.direction.set(patchOffset.x, patchOffset.y, patchOffset.z).normalize();
    if (rotation) {
      scratch.local.applyMatrix3(rotation);
      scratch.direction.applyMatrix3(rotation);
    }

    dummy.position.copy(scratch.local).add(scratch.particlePosition);
    // The cone points +Y by default; aim it inward, at the particle centre.
    scratch.inward.copy(scratch.direction).negate();
    dummy.quaternion.setFromUnitVectors(scratch.up, scratch.inward);
    dummy.scale.setScalar(clusterScale);

    setColor(entry?.color ?? patchColors[j]);
    return true;
  }, [particles, patchPositions, patchIDs, patchesPerParticle, appearance, patchColors,
      boxSize, particleRadius, scratch]);

  if (!hasValidPatchData) return null;

  return (
    <InstancedLayer
      geometry={geometry}
      material={material}
      count={totalPatches}
      write={write}
      deps={[write]}
    />
  );
}

export default Patches;

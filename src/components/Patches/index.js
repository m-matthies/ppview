import React, { useMemo } from "react";
import * as THREE from 'three';
import { getColorForPatchID } from '../../utils/colorUtils';
import { useParticleStore } from '../../store/particleStore';
import { useUIStore } from '../../store/uiStore';
import InstancedLayer from '../../rendering/InstancedLayer';
import { patchTip, patchScratch } from '../../rendering/transforms';
import useClusterVisuals from '../../rendering/useClusterVisuals';

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
  const appearanceOf = useClusterVisuals();

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
    // baseColor is resolved per patch below: a patch's colour encodes its ID,
    // not its particle's type.
    return particles.map((_, i) =>
      appearanceOf(globalIndices ? globalIndices[i] : i, { allowSelectionColor: false }));
  }, [particles, globalIndices, hasValidPatchData, appearanceOf]);

  // Patch colours are per patch ID and change only with the colour scheme.
  const patchColors = useMemo(
    () => patchIDs?.map(id => getColorForPatchID(id, colorScheme)) ?? [],
    [patchIDs, colorScheme],
  );

  const scratch = useMemo(() => ({
    ...patchScratch(),
    inward: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
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

    // Shared with Bonds, which starts a bond cylinder at this exact point —
    // the two must not drift, or bonds stop appearing to leave their patches.
    if (!patchTip(scratch, particle, patchOffset, boxSize, particleRadius * clusterScale)) {
      return false;   // degenerate patch vector: no direction to face
    }

    dummy.position.copy(scratch.tip);
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

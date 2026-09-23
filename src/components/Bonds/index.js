import React, { useMemo } from "react";
import * as THREE from "three";
import { useParticleStore } from "../../store/particleStore";
import { useUIStore } from "../../store/uiStore";
import InstancedLayer from "../../rendering/InstancedLayer";
import {
  cylinderBetweenImages, cylinderScratch, patchTip, patchScratch, patchOffsetFor,
  centreOnBox, wrapsBetween, LEAVING, ARRIVING,
} from "../../rendering/transforms";
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
  const centreToCentre = useUIStore(state => state.bondsCentreToCentre);
  const appearanceOf = useClusterVisuals();

  const bondCount = bonds?.a.length ?? 0;
  // Two instances per bond. A bond between minimum images — two particles either
  // side of a periodic wall — is drawn as the two halves you would actually see,
  // one leaving through the near wall and one arriving from outside the far one.
  // The second instance of a bond that does not wrap is collapsed by the layer.
  const count = bondCount * 2;

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
  // One per end: patchTip writes into its own scratch, so computing the second
  // would otherwise overwrite the first.
  const endA = useMemo(patchScratch, []);
  const endB = useMemo(patchScratch, []);

  /**
   * Where a bond's end sits: the patch it names, or the particle centre.
   *
   * A patchy bond is between two *patches*, not two centres, and both
   * `PatchyBonds` and `RaspberryPatchyBonds` say which. Drawn centre to centre
   * the cylinder runs inside both spheres and emerges nowhere near the cones —
   * verified against one run, where the two patches a bond names sit 0.083
   * apart while their particles are 1.077 apart. `PLClusterTopology` states no
   * patch ids, so those fall back to the centres.
   */
  const endpoint = useMemo(() => (out, particle, patch, radius) => {
    if (!centreToCentre) {
      const offset = patchOffsetFor(particle.particleType, patch);
      if (offset && patchTip(out, particle, offset, boxSize, radius)) return out.tip;
    }
    return centreOnBox(out.centre, particle, boxSize);
  }, [boxSize, centreToCentre]);

  // A bond follows the cluster state of the particles it joins, and is drawn
  // only while both are: a bond left hanging after its particles were hidden is
  // the bug `Springs` shipped with twice.
  const write = useMemo(() => (i, dummy) => {
    const bond = i < bondCount ? i : i - bondCount;
    const image = i < bondCount ? LEAVING : ARRIVING;
    const p1 = bonds.a[bond];
    const p2 = bonds.b[bond];
    // An observable that names more particles than the structure has is caught
    // when the file loads, but a frame can still be read before the positions
    // for it have arrived.
    if (p1 >= positions.length || p2 >= positions.length) return false;

    // Almost no bonds sit on a wall, so the second instance of almost every one
    // is unused. Deciding that from the centres alone — no patch lookup, no
    // cluster appearance — keeps that work off the instances that are discarded.
    if (image === ARRIVING && !wrapsBetween(scratch, positions[p1], positions[p2], boxSize)) {
      return false;
    }

    const a = appearanceOf(p1, { allowSelectionColor: false });
    const b = appearanceOf(p2, { allowSelectionColor: false });
    if (a.hidden || b.hidden) return false;

    const thickness = bondRadius * Math.min(a.scaleFactor, b.scaleFactor);
    // Each end uses its own particle's scale, so the bond still meets the cone
    // when one of the two is highlighted and the other is not.
    const from = endpoint(endA, positions[p1], bonds.patchA[bond], particleRadius * a.scaleFactor);
    const to = endpoint(endB, positions[p2], bonds.patchB[bond], particleRadius * b.scaleFactor);
    // Returns false for a degenerate bond, and for the second half of one that
    // does not cross a wall.
    return cylinderBetweenImages(dummy, scratch, from, to, boxSize, thickness, image);
  }, [bonds, bondCount, positions, boxSize, bondRadius, particleRadius, scratch,
      endpoint, endA, endB, appearanceOf]);

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

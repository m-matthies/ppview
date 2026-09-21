import React, { useMemo } from "react";
import * as THREE from "three";
import { useParticleStore } from "../../store/particleStore";
import { useUIStore } from "../../store/uiStore";
import { useClusteringStore } from "../../store/clusteringStore";
import InstancedLayer from "../../rendering/InstancedLayer";
import { centreOnBox, crossesPeriodicBoundary } from "../../rendering/transforms";
import { getClusterAppearance } from "../../utils/clusterAppearance";

// Renders spring bonds between connected particles as instanced cylinders.
// Spring connection topology comes from topData.springConnections, which is
// static per file load. Cylinder positions update with each trajectory frame.
function Springs() {
  const positions = useParticleStore(state => state.positions);
  const boxSize = useParticleStore(state => state.currentBoxSize);
  const particleRadius = useParticleStore(state => state.particleRadius);
  const topData = useParticleStore(state => state.topData);
  const sphereSegments = useUIStore(state => state.sphereSegments);
  // Subscribed field by field. A bare useClusteringStore() re-renders this
  // layer on *any* write to that store — including the pane's own controls,
  // which now live there — and each re-render re-runs the per-instance matrix
  // and colour loops below.
  const highlightedClusters = useClusteringStore(state => state.highlightedClusters);
  const showOnlyHighlightedClusters = useClusteringStore(state => state.showOnlyHighlightedClusters);
  const dimNonSelectedClusters = useClusteringStore(state => state.dimNonSelectedClusters);

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
  const scratch = useMemo(() => ({
    up: new THREE.Vector3(0, 1, 0),
    v1: new THREE.Vector3(),
    v2: new THREE.Vector3(),
    dir: new THREE.Vector3(),
  }), []);

  // A spring follows the cluster state of the particles it joins: it is drawn
  // only when both ends are. Previously springs ignored clustering entirely and
  // hung in space after their particles were hidden.
  const appearanceOf = useMemo(() => (index) => getClusterAppearance({
    isInHighlightedCluster: highlightedClusters.has(index),
    shouldShow: !showOnlyHighlightedClusters || highlightedClusters.has(index),
    hasHighlightedClusters: highlightedClusters.size > 0,
    showOnlyHighlightedClusters,
    dimNonSelectedClusters,
    baseColor: null,
    allowSelectionColor: false,
  }), [highlightedClusters, showOnlyHighlightedClusters, dimNonSelectedClusters]);

  const write = useMemo(() => (i, dummy) => {
    const { p1, p2 } = springConnections[i];
    if (p1 >= positions.length || p2 >= positions.length) return false;

    const a = appearanceOf(p1);
    const b = appearanceOf(p2);
    if (a.hidden || b.hidden) return false;

    const pos1 = positions[p1];
    const pos2 = positions[p2];
    centreOnBox(scratch.v1, pos1, boxSize);
    centreOnBox(scratch.v2, pos2, boxSize);

    scratch.dir.copy(scratch.v2).sub(scratch.v1);
    const distance = scratch.dir.length();

    // Hide degenerate springs, and those that wrap a periodic boundary — those
    // would otherwise be drawn straight across the whole box.
    if (distance < 1e-6 || crossesPeriodicBoundary(distance, boxSize)) return false;

    scratch.dir.normalize();
    // A dimmed spring thins with its particles rather than disappearing.
    const thickness = springRadius * Math.min(a.scaleFactor, b.scaleFactor);
    dummy.position.copy(scratch.v1).addScaledVector(scratch.dir, distance / 2);
    dummy.quaternion.setFromUnitVectors(scratch.up, scratch.dir);
    dummy.scale.set(thickness, distance, thickness);
    return true;
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

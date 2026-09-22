// src/components/OxDNANucleotides.js
//
// Renders oxDNA nucleotides using the same visual representation as oxdna-viewer:
//   - backbone sphere (r=0.2), colored by strand, selectable
//   - nucleoside ellipsoid (r=0.3, scaled [0.7,0.3,0.7]), colored by base type
//   - ns↔bb connector cylinder (r=0.1), colored by strand
//   - bb→bb3' backbone connector (tapered r=0.1 to r=0.02), colored by strand

import React, { useRef, useMemo, useCallback, useEffect } from "react";
import * as THREE from "three";
import { useParticleStore } from "../../store/particleStore";
import { useUIStore } from "../../store/uiStore";
import { getParticleColors } from "../../colors";
import InstancedLayer from "../../rendering/InstancedLayer";
import { useRegisterPickable } from "../../rendering/pickingService";
import { centreOnBox } from "../../rendering/transforms";
import useClusterVisuals from "../../rendering/useClusterVisuals";
import {
  impostorGeometry, makeImpostorMaterial, makeEllipsoidImpostorMaterial,
  shouldUseImpostors, impostorOverride, applyImpostorRaycast,
} from "../../rendering/impostors";

// Base-type colors matching oxdna-viewer nucleosideColors
const BASE_COLORS = {
  A: new THREE.Color(0x4747B8), // Royal Blue
  G: new THREE.Color(0xFFFF33), // Yellow
  C: new THREE.Color(0x8CFF8C), // Green
  T: new THREE.Color(0xFF3333), // Red
  U: new THREE.Color(0xFF3333), // Red (RNA uracil)
};
const DEFAULT_BASE_COLOR = new THREE.Color(0x888888);

// Distance between backbone bead and nucleoside center for DNA
const DNA_BBNS_DIST = 0.8147053;

const UP_Y = new THREE.Vector3(0, 1, 0);

function OxDNANucleotides() {
  const positions = useParticleStore(state => state.positions);
  const boxSize = useParticleStore(state => state.currentBoxSize);
  const topData = useParticleStore(state => state.topData);
  const particleRadius = useParticleStore(state => state.particleRadius);
  const currentColorScheme = useUIStore(state => state.currentColorScheme);
  // One value at a time. A bare useUIStore() re-renders this layer on any
  // write to that store — a legend toggle, a lighting slider — and each
  // re-render re-runs the per-instance matrix and colour loops below.
  const sphereSegments = useUIStore(state => state.sphereSegments);
  const appearanceOf = useClusterVisuals();

  const bbRef = useRef();
  const nsRef = useRef();
  const conRef = useRef();
  const bbconRef = useRef();

  const nucleotides = topData?.nucleotides;
  const count = nucleotides?.length ?? 0;

  // Radii scale with the particle-radius control so it moves nucleotides along
  // with every other sphere in the app. Only thicknesses scale — the 0.34 /
  // 0.3408 offsets that place backbone and nucleoside are the oxDNA geometry
  // itself, so scaling those would misreport where the nucleotide sits.
  // Relative to the radius the files established, so this is 1 at load and
  // the geometry is the size the topology describes.
  const baseParticleRadius = useParticleStore(state => state.baseParticleRadius);
  const radiusScale = particleRadius / (baseParticleRadius || 1);

  // A nucleotide draws four meshes, and at 16 segments the two spheres are 1024
  // of its ~1150 triangles — so oxDNA, the format most likely to actually reach a
  // million particles, was the one impostors did nothing for. The backbone is a
  // plain sphere; the nucleoside is a rotated ellipsoid and needs the quadric
  // shader. The two cylinders stay real geometry: they are ~130 triangles
  // between them, and a cylinder impostor is a different shape problem.
  const useImpostors = useMemo(
    () => shouldUseImpostors(count, impostorOverride()), [count],
  );

  const bbGeo = useMemo(
    () => (useImpostors
      ? impostorGeometry(0.2 * radiusScale)
      : new THREE.SphereGeometry(0.2 * radiusScale, sphereSegments, sphereSegments)),
    [useImpostors, sphereSegments, radiusScale],
  );
  const nsGeo = useMemo(
    () => (useImpostors
      ? impostorGeometry(0.3 * radiusScale)
      : new THREE.SphereGeometry(0.3 * radiusScale, sphereSegments, sphereSegments)),
    [useImpostors, sphereSegments, radiusScale],
  );
  const conGeo = useMemo(
    () => new THREE.CylinderGeometry(0.1 * radiusScale, 0.1 * radiusScale, 1, sphereSegments),
    [sphereSegments, radiusScale],
  );
  const bbconGeo = useMemo(
    () => new THREE.CylinderGeometry(0.1 * radiusScale, 0.02 * radiusScale, 1, sphereSegments),
    [sphereSegments, radiusScale],
  );

  const materialParameters = useMemo(() => ({ metalness: 0.1, roughness: 0.6 }), []);

  // The cylinders always use the plain material; only the two spheres change
  // representation.
  const material = useMemo(
    () => new THREE.MeshStandardMaterial(materialParameters), [materialParameters],
  );

  // Radii feed uniforms rather than geometry in the impostor path, so they are
  // deliberately absent from these dependency lists: changing the radius control
  // must not rebuild a material and force a shader recompile.
  const bbMaterial = useMemo(
    () => (useImpostors
      ? makeImpostorMaterial({ ...materialParameters, particleRadius: 0.2 * radiusScale })
      : material),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [useImpostors, materialParameters, material],
  );
  const nsMaterial = useMemo(
    () => (useImpostors
      // The instance matrix carries the [0.7, 0.3, 0.7] scale and the rotation
      // onto a3; the uniform is the radius the sphere geometry used to bake in.
      ? makeEllipsoidImpostorMaterial({ ...materialParameters, radius: 0.3 * radiusScale })
      : material),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [useImpostors, materialParameters, material],
  );

  useEffect(() => {
    if (bbMaterial.userData.particleRadius) bbMaterial.userData.particleRadius.value = 0.2 * radiusScale;
    if (nsMaterial.userData.particleRadius) nsMaterial.userData.particleRadius.value = 0.3 * radiusScale;
  }, [bbMaterial, nsMaterial, radiusScale]);

  const strandColors = useMemo(() => {
    const palette = getParticleColors(currentColorScheme);
    // oxdna-viewer cycles strand colours through the first four entries.
    const cap = Math.min(4, palette.length);
    return palette.slice(0, cap).map(hex => new THREE.Color(hex));
  }, [currentColorScheme]);

  // Backbone positions are needed twice — for the backbone sphere and for the
  // connector to the 3' neighbour — so they are computed once per frame rather
  // than recomputed inside each layer's write callback.
  const backbones = useMemo(() => {
    if (!positions?.length || !count) return null;
    const out = new Array(count).fill(null);
    const p = new THREE.Vector3();
    const a1 = new THREE.Vector3();
    const a3 = new THREE.Vector3();
    const a2 = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const pos = positions[i];
      if (!pos?.a1 || !pos?.a3) continue;
      centreOnBox(p, pos, boxSize);
      a1.set(pos.a1.x, pos.a1.y, pos.a1.z);
      a3.set(pos.a3.x, pos.a3.y, pos.a3.z);
      // a2 = (a3 × a1).normalize()
      a2.crossVectors(a3, a1).normalize();
      // DNA backbone: p + (-0.34*a1 + 0.3408*a2)
      out[i] = p.clone().addScaledVector(a1, -0.34).addScaledVector(a2, 0.3408);
    }
    return out;
  }, [positions, count, boxSize]);

  // Nucleotides now honour cluster highlighting. They previously ignored it
  // entirely — the one rendering path that did — because the feature was wired
  // per renderer instead of shared.
  const appearance = useMemo(() => {
    if (!count) return [];
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
      const strandColor = strandColors[(positions?.[i]?.typeIndex ?? 0) % Math.max(strandColors.length, 1)];
      out[i] = appearanceOf(i, { baseColor: strandColor });
    }
    return out;
  }, [count, positions, appearanceOf, strandColors]);

  const scratch = useMemo(() => ({
    p: new THREE.Vector3(),
    a1: new THREE.Vector3(),
    a3: new THREE.Vector3(),
    ns: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    centre: new THREE.Vector3(),
  }), []);

  const ready = !!(backbones && positions?.length >= count && count > 0);

  // --- Backbone sphere: strand coloured, and what picking hits ---------------
  const writeBackbone = useMemo(() => (i, dummy, setColor) => {
    const bb = backbones?.[i];
    const entry = appearance[i];
    if (!bb || entry?.hidden) return false;
    dummy.position.copy(bb);
    dummy.scale.setScalar(entry?.scaleFactor ?? 1);
    setColor(entry?.color);
    return true;
  }, [backbones, appearance]);

  // --- Nucleoside ellipsoid: base coloured, long axis along a3 ---------------
  const writeNucleoside = useMemo(() => (i, dummy, setColor) => {
    const pos = positions?.[i];
    const entry = appearance[i];
    if (!pos?.a1 || !pos?.a3 || entry?.hidden) return false;

    centreOnBox(scratch.p, pos, boxSize);
    scratch.a1.set(pos.a1.x, pos.a1.y, pos.a1.z);
    scratch.a3.set(pos.a3.x, pos.a3.y, pos.a3.z).normalize();
    scratch.ns.copy(scratch.p).addScaledVector(scratch.a1, 0.34);

    const s = entry?.scaleFactor ?? 1;
    dummy.position.copy(scratch.ns);
    dummy.quaternion.setFromUnitVectors(UP_Y, scratch.a3);
    dummy.scale.set(0.7 * s, 0.3 * s, 0.7 * s);
    // A dimmed nucleotide takes the shared grey; otherwise the base colour,
    // which is the whole point of this element.
    setColor(entry?.dimmed ? entry.color : (BASE_COLORS[nucleotides[i].base] ?? DEFAULT_BASE_COLOR));
    return true;
  }, [positions, boxSize, appearance, nucleotides, scratch]);

  // --- ns↔bb connector ------------------------------------------------------
  const writeConnector = useMemo(() => (i, dummy, setColor) => {
    const pos = positions?.[i];
    const bb = backbones?.[i];
    const entry = appearance[i];
    if (!pos?.a1 || !bb || entry?.hidden) return false;

    centreOnBox(scratch.p, pos, boxSize);
    scratch.a1.set(pos.a1.x, pos.a1.y, pos.a1.z);
    scratch.ns.copy(scratch.p).addScaledVector(scratch.a1, 0.34);

    scratch.dir.copy(bb).sub(scratch.ns).normalize();
    scratch.centre.copy(bb).add(scratch.ns).multiplyScalar(0.5);

    const s = entry?.scaleFactor ?? 1;
    dummy.position.copy(scratch.centre);
    dummy.quaternion.setFromUnitVectors(UP_Y, scratch.dir);
    dummy.scale.set(s, DNA_BBNS_DIST, s);
    setColor(entry?.color);
    return true;
  }, [positions, backbones, boxSize, appearance, scratch]);

  // --- Backbone connector to the 3' neighbour -------------------------------
  const writeBackboneConnector = useMemo(() => (i, dummy, setColor) => {
    const bb = backbones?.[i];
    const entry = appearance[i];
    const n3 = nucleotides?.[i]?.n3;
    if (!bb || entry?.hidden || n3 == null || n3 < 0 || n3 >= count) return false;

    const bbN3 = backbones[n3];
    if (!bbN3) return false;
    // Both ends must be drawn, or the bond dangles into hidden space.
    if (appearance[n3]?.hidden) return false;

    const length = bb.distanceTo(bbN3);
    // A bond spanning most of the box has wrapped a periodic boundary.
    if (length < 1e-6
      || length >= boxSize[0] * 0.9
      || length >= boxSize[1] * 0.9
      || length >= boxSize[2] * 0.9) return false;

    scratch.centre.copy(bb).add(bbN3).multiplyScalar(0.5);
    scratch.dir.copy(bbN3).sub(bb).normalize();

    const s = Math.min(entry?.scaleFactor ?? 1, appearance[n3]?.scaleFactor ?? 1);
    dummy.position.copy(scratch.centre);
    dummy.quaternion.setFromUnitVectors(UP_Y, scratch.dir);
    dummy.scale.set(s, length, s);
    setColor(entry?.color);
    return true;
  }, [backbones, appearance, nucleotides, count, boxSize, scratch]);

  const resolveIndex = useCallback((instanceId) => {
    if (instanceId < 0 || instanceId >= count) return null;
    return appearance[instanceId]?.hidden ? null : instanceId;
  }, [count, appearance]);

  useRegisterPickable('nucleotides', { meshRef: bbRef, resolveIndex, enabled: ready });

  // Picking hits the backbone, so it is the one mesh whose ray has to meet the
  // sphere the shader draws rather than the quad it draws on. Read through a ref
  // so changing the radius does not re-register the raycast.
  const bbRadiusRef = useRef(0.2 * radiusScale);
  bbRadiusRef.current = 0.2 * radiusScale;
  useEffect(() => {
    const mesh = bbRef.current;
    if (!mesh || !useImpostors) return undefined;
    const previous = mesh.raycast;
    applyImpostorRaycast(mesh, () => bbRadiusRef.current);
    return () => { mesh.raycast = previous; };
  }, [useImpostors, bbGeo, count]);

  if (!ready) return null;

  return (
    <>
      <InstancedLayer ref={bbRef} geometry={bbGeo} material={bbMaterial} count={count}
        write={writeBackbone} deps={[writeBackbone]} />
      <InstancedLayer ref={nsRef} geometry={nsGeo} material={nsMaterial} count={count}
        write={writeNucleoside} deps={[writeNucleoside]} />
      <InstancedLayer ref={conRef} geometry={conGeo} material={material} count={count}
        write={writeConnector} deps={[writeConnector]} />
      <InstancedLayer ref={bbconRef} geometry={bbconGeo} material={material} count={count}
        write={writeBackboneConnector} deps={[writeBackboneConnector]} />
    </>
  );
}

export default OxDNANucleotides;

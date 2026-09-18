// src/components/OxDNANucleotides.js
//
// Renders oxDNA nucleotides using the same visual representation as oxdna-viewer:
//   - backbone sphere (r=0.2), colored by strand, selectable
//   - nucleoside ellipsoid (r=0.3, scaled [0.7,0.3,0.7]), colored by base type
//   - ns↔bb connector cylinder (r=0.1), colored by strand
//   - bb→bb3' backbone connector (tapered r=0.1 to r=0.02), colored by strand

import React, { useRef, useEffect, useMemo, useCallback } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useParticleStore } from "../store/particleStore";
import { useUIStore } from "../store/uiStore";
import { getParticleColors } from "../colors";

// Base-type colors matching oxdna-viewer nucleosideColors
const BASE_COLORS = {
  A: new THREE.Color(0x4747B8), // Royal Blue
  G: new THREE.Color(0xFFFF33), // Yellow
  C: new THREE.Color(0x8CFF8C), // Green
  T: new THREE.Color(0xFF3333), // Red
  U: new THREE.Color(0xFF3333), // Red (RNA uracil)
};
const DEFAULT_BASE_COLOR = new THREE.Color(0x888888);
const SELECTED_COLOR = new THREE.Color("yellow");

// Distance between backbone bead and nucleoside center for DNA
const DNA_BBNS_DIST = 0.8147053;

function OxDNANucleotides({ onParticleDoubleClick }) {
  const positions = useParticleStore(state => state.positions);
  const boxSize = useParticleStore(state => state.currentBoxSize);
  const topData = useParticleStore(state => state.topData);
  const currentColorScheme = useUIStore(state => state.currentColorScheme);
  const { selectedParticles, setSelectedParticles, sphereSegments } = useUIStore();

  const { gl, camera, invalidate } = useThree();

  const bbRef = useRef();
  const nsRef = useRef();
  const conRef = useRef();
  const bbconRef = useRef();

  const nucleotides = topData?.nucleotides;
  const count = nucleotides?.length ?? 0;

  // Geometries — unit cylinder (height=1) is scaled per instance
  const bbGeo = useMemo(() => new THREE.SphereGeometry(0.2, sphereSegments, sphereSegments), [sphereSegments]);
  const nsGeo = useMemo(() => new THREE.SphereGeometry(0.3, sphereSegments, sphereSegments), [sphereSegments]);
  const conGeo = useMemo(() => new THREE.CylinderGeometry(0.1, 0.1, 1, 8), []);
  const bbconGeo = useMemo(() => new THREE.CylinderGeometry(0.1, 0.02, 1, 8), []); // tapered

  const material = useMemo(() => new THREE.MeshStandardMaterial({
    metalness: 0.1,
    roughness: 0.6,
  }), []);

  // Helper: normalized mouse coords relative to canvas
  const getNormalizedMouseCoords = useCallback((event) => {
    if (!gl?.domElement) return null;
    const canvas = gl.domElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || x > rect.width || y < 0 || y > rect.height) return null;
    return new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
  }, [gl]);

  // Click: select backbone sphere by instanceId
  const handleClick = useCallback((event) => {
    if (!bbRef.current || !camera) return;
    const pointer = getNormalizedMouseCoords(event);
    if (!pointer) return;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);

    const intersects = raycaster.intersectObject(bbRef.current);
    if (intersects.length > 0) {
      const idx = intersects[0].instanceId;
      if (idx >= 0 && idx < count) {
        if (event.ctrlKey || event.metaKey) {
          const current = Array.isArray(selectedParticles) ? selectedParticles : [];
          if (current.includes(idx)) {
            setSelectedParticles(current.filter(id => id !== idx));
          } else {
            setSelectedParticles([...current, idx]);
          }
        } else {
          setSelectedParticles([idx]);
        }
        return;
      }
    }

    // Miss — clear selection (non-ctrl only)
    if (!event.ctrlKey && !event.metaKey) {
      setSelectedParticles([]);
    }
  }, [camera, count, getNormalizedMouseCoords, selectedParticles, setSelectedParticles]);

  // Double-click: animate camera to backbone position
  const handleDoubleClick = useCallback((event) => {
    if (!bbRef.current || !camera || !onParticleDoubleClick) return;
    const pointer = getNormalizedMouseCoords(event);
    if (!pointer) return;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);

    const intersects = raycaster.intersectObject(bbRef.current);
    if (intersects.length > 0) {
      const idx = intersects[0].instanceId;
      if (idx >= 0 && idx < count && positions?.[idx]) {
        const pos = positions[idx];
        onParticleDoubleClick(new THREE.Vector3(
          pos.x - boxSize[0] / 2,
          pos.y - boxSize[1] / 2,
          pos.z - boxSize[2] / 2,
        ));
      }
    }
  }, [camera, count, positions, boxSize, onParticleDoubleClick, getNormalizedMouseCoords]);

  // Register/unregister click listeners
  useEffect(() => {
    gl.domElement.addEventListener("click", handleClick);
    gl.domElement.addEventListener("dblclick", handleDoubleClick);
    return () => {
      gl.domElement.removeEventListener("click", handleClick);
      gl.domElement.removeEventListener("dblclick", handleDoubleClick);
    };
  }, [gl, handleClick, handleDoubleClick]);

  // --- Main effect: geometry + base colors ---
  useEffect(() => {
    if (!bbRef.current || !nsRef.current || !conRef.current || !bbconRef.current) return;
    if (!positions || positions.length === 0 || !nucleotides || count === 0) return;
    if (positions.length < count) return;

    const bbMesh = bbRef.current;
    const nsMesh = nsRef.current;
    const conMesh = conRef.current;
    const bbconMesh = bbconRef.current;

    const strandColors = getParticleColors(currentColorScheme);
    const upY = new THREE.Vector3(0, 1, 0);
    const dummy = new THREE.Object3D();
    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

    // --- Pass 1: pre-compute all backbone positions (needed for bbcon segments) ---
    const bbPositions = new Array(count).fill(null);
    for (let i = 0; i < count; i++) {
      const pos = positions[i];
      if (!pos || !pos.a1 || !pos.a3) continue;

      const p = new THREE.Vector3(
        pos.x - boxSize[0] / 2,
        pos.y - boxSize[1] / 2,
        pos.z - boxSize[2] / 2,
      );
      const a1 = new THREE.Vector3(pos.a1.x, pos.a1.y, pos.a1.z);
      const a3 = new THREE.Vector3(pos.a3.x, pos.a3.y, pos.a3.z);
      // a2 = -(a1 × a3).normalize() = (a3 × a1).normalize()
      const a2 = new THREE.Vector3().crossVectors(a3, a1).normalize();
      // DNA backbone: p + (-0.34*a1 + 0.3408*a2)
      bbPositions[i] = p.clone().addScaledVector(a1, -0.34).addScaledVector(a2, 0.3408);
    }

    // --- Pass 2: fill instance matrices and colors ---
    for (let i = 0; i < count; i++) {
      const nuc = nucleotides[i];
      const pos = positions[i];

      if (!pos || !pos.a1 || !pos.a3 || !bbPositions[i]) {
        bbMesh.setMatrixAt(i, zeroMatrix);
        nsMesh.setMatrixAt(i, zeroMatrix);
        conMesh.setMatrixAt(i, zeroMatrix);
        bbconMesh.setMatrixAt(i, zeroMatrix);
        continue;
      }

      const p = new THREE.Vector3(
        pos.x - boxSize[0] / 2,
        pos.y - boxSize[1] / 2,
        pos.z - boxSize[2] / 2,
      );
      const a1 = new THREE.Vector3(pos.a1.x, pos.a1.y, pos.a1.z);
      const a3 = new THREE.Vector3(pos.a3.x, pos.a3.y, pos.a3.z).normalize();
      const bb = bbPositions[i];
      const ns = p.clone().addScaledVector(a1, 0.34);

      const strandColor = new THREE.Color(
        strandColors[(pos.typeIndex ?? 0) % Math.min(4, strandColors.length)]
      );
      const baseColor = BASE_COLORS[nuc.base] ?? DEFAULT_BASE_COLOR;

      // --- Backbone sphere ---
      dummy.position.copy(bb);
      dummy.quaternion.identity();
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bbMesh.setMatrixAt(i, dummy.matrix);
      bbMesh.setColorAt(i, strandColor);

      // --- Nucleoside ellipsoid: Y-axis → a3, scaled [0.7, 0.3, 0.7] ---
      const nsRotation = new THREE.Quaternion().setFromUnitVectors(upY, a3);
      dummy.position.copy(ns);
      dummy.quaternion.copy(nsRotation);
      dummy.scale.set(0.7, 0.3, 0.7);
      dummy.updateMatrix();
      nsMesh.setMatrixAt(i, dummy.matrix);
      nsMesh.setColorAt(i, baseColor);

      // --- ns↔bb connector cylinder: Y-axis → (bb-ns), height = DNA_BBNS_DIST ---
      const conDir = bb.clone().sub(ns).normalize();
      const conCenter = bb.clone().add(ns).multiplyScalar(0.5);
      const conRotation = new THREE.Quaternion().setFromUnitVectors(upY, conDir);
      dummy.position.copy(conCenter);
      dummy.quaternion.copy(conRotation);
      dummy.scale.set(1, DNA_BBNS_DIST, 1);
      dummy.updateMatrix();
      conMesh.setMatrixAt(i, dummy.matrix);
      conMesh.setColorAt(i, strandColor);

      // --- Backbone connector: bb → n3-neighbor bb ---
      const n3Idx = nuc.n3;
      if (n3Idx >= 0 && n3Idx < count && bbPositions[n3Idx]) {
        const bbN3 = bbPositions[n3Idx];
        const spLen = bb.distanceTo(bbN3);
        const hidden = spLen >= boxSize[0] * 0.9
          || spLen >= boxSize[1] * 0.9
          || spLen >= boxSize[2] * 0.9;

        if (hidden || spLen < 1e-6) {
          bbconMesh.setMatrixAt(i, zeroMatrix);
        } else {
          const spCenter = bb.clone().add(bbN3).multiplyScalar(0.5);
          const spDir = bbN3.clone().sub(bb).normalize();
          const spRotation = new THREE.Quaternion().setFromUnitVectors(upY, spDir);
          dummy.position.copy(spCenter);
          dummy.quaternion.copy(spRotation);
          dummy.scale.set(1, spLen, 1);
          dummy.updateMatrix();
          bbconMesh.setMatrixAt(i, dummy.matrix);
          bbconMesh.setColorAt(i, strandColor);
        }
      } else {
        bbconMesh.setMatrixAt(i, zeroMatrix);
      }
    }

    bbMesh.instanceMatrix.needsUpdate = true;
    nsMesh.instanceMatrix.needsUpdate = true;
    conMesh.instanceMatrix.needsUpdate = true;
    bbconMesh.instanceMatrix.needsUpdate = true;

    if (bbMesh.instanceColor) bbMesh.instanceColor.needsUpdate = true;
    if (nsMesh.instanceColor) nsMesh.instanceColor.needsUpdate = true;
    if (conMesh.instanceColor) conMesh.instanceColor.needsUpdate = true;
    if (bbconMesh.instanceColor) bbconMesh.instanceColor.needsUpdate = true;
    invalidate(); // frameloop="demand": tell R3F the canvas needs a redraw
  }, [positions, boxSize, nucleotides, count, currentColorScheme, invalidate, bbGeo, nsGeo]);

  // --- Selection effect: update backbone sphere colors only ---
  useEffect(() => {
    if (!bbRef.current || !positions || !nucleotides || count === 0) return;
    const mesh = bbRef.current;
    if (!mesh.instanceColor) return; // main effect hasn't run yet

    const strandColors = getParticleColors(currentColorScheme);

    for (let i = 0; i < count; i++) {
      const pos = positions[i];
      if (!pos) continue;
      const isSelected = Array.isArray(selectedParticles) && selectedParticles.includes(i);
      if (isSelected) {
        mesh.setColorAt(i, SELECTED_COLOR);
      } else {
        mesh.setColorAt(i, new THREE.Color(
          strandColors[(pos.typeIndex ?? 0) % Math.min(4, strandColors.length)]
        ));
      }
    }
    mesh.instanceColor.needsUpdate = true;
  }, [selectedParticles, positions, nucleotides, count, currentColorScheme]);

  if (!nucleotides || count === 0) return null;

  return (
    <>
      <instancedMesh ref={bbRef} args={[bbGeo, material, count]} castShadow receiveShadow />
      <instancedMesh ref={nsRef} args={[nsGeo, material, count]} castShadow receiveShadow />
      <instancedMesh ref={conRef} args={[conGeo, material, count]} castShadow receiveShadow />
      <instancedMesh ref={bbconRef} args={[bbconGeo, material, count]} castShadow receiveShadow />
    </>
  );
}

export default OxDNANucleotides;

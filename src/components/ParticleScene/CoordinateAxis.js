import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';

// Coordinate Axis component using ArrowHelper - positioned at box corner
export function CoordinateAxis({ boxSize, isDark }) {
  const groupRef = useRef();

  useEffect(() => {
    if (!groupRef.current) return;

    // Clear existing arrows
    while (groupRef.current.children.length > 0) {
      groupRef.current.remove(groupRef.current.children[0]);
    }

    // Arrow length scaled based on box size
    const arrowLength = Math.min(...boxSize) * 0.15; // 15% of smallest box dimension
    const arrowHeadLength = arrowLength * 0.2;
    const arrowHeadWidth = arrowLength * 0.1;

    // Position at the bottom-left-back corner of the box
    const origin = new THREE.Vector3(
      -boxSize[0] / 2,  // Left edge
      -boxSize[1] / 2,  // Bottom edge  
      -boxSize[2] / 2   // Back edge
    );

    // The dark triad matches the oxDNA reference and is the default, since the
    // scene is light. On a dark background those values are almost invisible, so
    // swap in brightened equivalents rather than leave the axes unreadable.
    const axes = isDark
      ? [
        { dir: new THREE.Vector3(1, 0, 0), color: 0xff6b6b, name: 'x-axis' },
        { dir: new THREE.Vector3(0, 1, 0), color: 0x51cf66, name: 'y-axis' },
        { dir: new THREE.Vector3(0, 0, 1), color: 0x6ea8ff, name: 'z-axis' },
      ]
      : [
        { dir: new THREE.Vector3(1, 0, 0), color: 0x800000, name: 'x-axis' },
        { dir: new THREE.Vector3(0, 1, 0), color: 0x008000, name: 'y-axis' },
        { dir: new THREE.Vector3(0, 0, 1), color: 0x000080, name: 'z-axis' },
      ];

    for (const axis of axes) {
      const arrow = new THREE.ArrowHelper(
        axis.dir,
        origin,
        arrowLength,
        axis.color,
        arrowHeadLength,
        arrowHeadWidth
      );
      arrow.name = axis.name;
      groupRef.current.add(arrow);
    }
  }, [boxSize, isDark]);

  return <group ref={groupRef} />;
}

export default CoordinateAxis;

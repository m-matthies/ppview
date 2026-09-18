import React, { useRef, useEffect, useMemo, useCallback } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { getParticleColors } from "../colors";
import { useParticleStore } from "../store/particleStore";
import { useUIStore } from "../store/uiStore";
import { useClusteringStore } from "../store/clusteringStore";
import Patches from "./Patches";
import RepulsionSites from "./RepulsionSites";

function Particles({
  onParticleDoubleClick,
}) {
  // Get data from Zustand stores
  const positions = useParticleStore(state => state.positions);
  const boxSize = useParticleStore(state => state.currentBoxSize);
  const particleRadius = useParticleStore(state => state.particleRadius);
  const { selectedParticles, setSelectedParticles, isPathtracerEnabled, sphereSegments } = useUIStore();
  const colorScheme = useUIStore(state => state.currentColorScheme);
  const showPatches = useUIStore(state => state.showPatchLegend);
  const { highlightedClusters, showOnlyHighlightedClusters } = useClusteringStore();
  const meshRef = useRef();
  const repulsionMeshDataRef = useRef(new Map()); // typeIndex → {mesh, numBeads, globalIndices, particlePositions}
  const count = Math.max(1, positions?.length || 0); // Ensure minimum count of 1
  const { gl, camera, invalidate } = useThree(); // For raycasting + demand-mode invalidation

  // Stable callback for RepulsionSites to register/unregister their mesh + metadata
  const registerRepulsionMesh = useCallback((typeIndex, data) => {
    if (data) {
      repulsionMeshDataRef.current.set(typeIndex, data);
    } else {
      repulsionMeshDataRef.current.delete(typeIndex);
    }
  }, []);

  // Create geometry — rebuilt when particleRadius or sphereSegments changes
  const geometry = useMemo(() => {
    return new THREE.SphereGeometry(particleRadius, sphereSegments, sphereSegments);
  }, [particleRadius, sphereSegments]);
  
  // Use MeshPhysicalMaterial for better path tracing results
  const material = useMemo(
    () => {
      if (isPathtracerEnabled) {
        return new THREE.MeshPhysicalMaterial({
          metalness: 0.2,
          roughness: 0.6,
          clearcoat: 0.3,
          clearcoatRoughness: 0.2,
          reflectivity: 0.5,
          envMapIntensity: 1.5,
        });
      } else {
        return new THREE.MeshStandardMaterial({
          metalness: 0.1,
          roughness: 0.7,
          envMapIntensity: 1.0,
          emissive: 0x000000,
          emissiveIntensity: 0.05,
        });
      }
    },
    [isPathtracerEnabled],
  );

  // Get current particle colors based on the selected scheme
  // Calculate the number of unique particle types for dynamic color generation
  const particleTypeCount = useMemo(() => {
    if (!positions || !Array.isArray(positions) || positions.length === 0) return 0;
    const uniqueTypes = new Set(positions.map(pos => pos.typeIndex).filter(type => type !== undefined));
    return uniqueTypes.size;
  }, [positions]);

  const particleColors = useMemo(() =>
    getParticleColors(colorScheme, particleTypeCount),
    [colorScheme, particleTypeCount]
  );

  // Pre-build THREE.Color objects indexed by typeIndex so the render body never
  // allocates `new THREE.Color(...)` on every frame, which would change the
  // typeColor prop reference and trigger unnecessary effects in RepulsionSites/Patches.
  const stableTypeColors = useMemo(() =>
    particleColors.map(hex => new THREE.Color(hex)),
    [particleColors]
  );

  // Memoize particle data to avoid recalculation
  const particleData = useMemo(() => {
    if (!positions || !Array.isArray(positions) || positions.length === 0) return [];

    return positions.map((pos, i) => {
      const isInHighlightedCluster = highlightedClusters.has(i);
      const shouldShow = !showOnlyHighlightedClusters || isInHighlightedCluster;

      // Use MGL color if available, otherwise fall back to ppview color scheme
      let particleColor;
      if (pos.mglColor) {
        // Use the original MGL color
        particleColor = new THREE.Color(pos.mglColor.r, pos.mglColor.g, pos.mglColor.b);
      } else {
        // Fall back to ppview color scheme
        particleColor = new THREE.Color(particleColors[pos.typeIndex % particleColors.length]);
      }

      return {
        position: {
          x: pos.x - boxSize[0] / 2,
          y: pos.y - boxSize[1] / 2,
          z: pos.z - boxSize[2] / 2,
        },
        colorIndex: pos.typeIndex % particleColors.length,
        typeColor: particleColor,
        isInHighlightedCluster,
        shouldShow,
        hasMGLColor: !!pos.mglColor,
        baseScale: pos.particleType?.particleScale ?? 1.0,
        hasRepulsionSites: !!(pos.particleType?.repulsionSiteData?.length)
      };
    });
  }, [positions, boxSize, particleColors, highlightedClusters, showOnlyHighlightedClusters]);

  // Update colors when color scheme changes
  useEffect(() => {
    if (meshRef.current && particleData.length > 0) {
      const mesh = meshRef.current;

      // Ensure we don't exceed the actual instance count
      const instanceCount = Math.min(mesh.count, particleData.length);

      // Safety check: ensure instanceColor exists and has the right length
      if (!mesh.instanceColor || mesh.instanceColor.count !== instanceCount) {
        console.warn('Instance color buffer mismatch in color scheme update, skipping');
        return;
      }

      // Update instance colors with new color scheme
      for (let i = 0; i < instanceCount; i++) {
        const data = particleData[i];
        if (!data || !data.typeColor) continue; // Skip if data is undefined or incomplete

        if (!Array.isArray(selectedParticles) || !selectedParticles.includes(i)) {
          try {
            mesh.setColorAt(i, data.typeColor);
          } catch (error) {
            console.warn(`Error updating color for particle ${i}:`, error);
          }
        }
      }

      mesh.instanceColor.needsUpdate = true;
    }
  }, [particleData, selectedParticles]);

  // Set positions and colors for instanced particles.
  // Uses setColorAt to update instanceColor in-place — avoids allocating a new
  // InstancedBufferAttribute (and leaking the old GPU buffer) on every frame.
  useEffect(() => {
    if (meshRef.current && particleData.length > 0) {
      const mesh = meshRef.current;
      const dummy = new THREE.Object3D();
      const instanceCount = mesh.count;

      for (let i = 0; i < instanceCount; i++) {
        if (i < particleData.length) {
          const data = particleData[i];
          if (data && data.position) {
            try {
              dummy.position.set(
                data.position.x,
                data.position.y,
                data.position.z,
              );
              dummy.scale.setScalar(data.hasRepulsionSites ? 0 : data.baseScale);
              dummy.updateMatrix();
              mesh.setMatrixAt(i, dummy.matrix);

              if (data.typeColor) {
                mesh.setColorAt(i, data.typeColor);
              }
            } catch (error) {
              console.warn(`Error setting particle ${i} position:`, error);
            }
          }
        }
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      invalidate(); // frameloop="demand": tell R3F the canvas needs a redraw
    }
  }, [particleData, invalidate, geometry]);

  // Helper function to get normalized mouse coordinates relative to canvas
  const getNormalizedMouseCoords = useCallback((event) => {
    if (!gl?.domElement) return null;

    const canvas = gl.domElement;
    const rect = canvas.getBoundingClientRect();

    // Check if canvas has valid dimensions
    if (rect.width <= 0 || rect.height <= 0) {
      console.warn('Canvas has invalid dimensions for mouse coordinate calculation');
      return null;
    }

    // Calculate mouse position relative to canvas
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Check if click is within canvas bounds
    if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
      return null; // Click is outside canvas
    }

    // Convert to normalized device coordinates (-1 to +1)
    const pointer = new THREE.Vector2();
    pointer.x = (x / rect.width) * 2 - 1;
    pointer.y = -(y / rect.height) * 2 + 1;

    return pointer;
  }, [gl]);

  // Memoize event handlers to prevent unnecessary re-creation
  const handleClick = useCallback((event) => {
    // Disable selection during pathtracing to avoid interrupting rendering
    if (isPathtracerEnabled) return;
    if (!meshRef.current || !camera) return;

    const pointer = getNormalizedMouseCoords(event);
    if (!pointer) return;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);

    try {
      // Check main particle mesh (skip hidden raspberry particles)
      const intersects = raycaster.intersectObject(meshRef.current);
      if (intersects.length > 0) {
        const instanceId = intersects[0].instanceId;
        if (instanceId >= 0 && instanceId < particleData.length && !particleData[instanceId].hasRepulsionSites) {
          if (event.ctrlKey || event.metaKey) {
            const current = Array.isArray(selectedParticles) ? selectedParticles : [];
            if (current.includes(instanceId)) {
              setSelectedParticles(current.filter((id) => id !== instanceId));
            } else {
              setSelectedParticles([...current, instanceId]);
            }
          } else {
            setSelectedParticles([instanceId]);
          }
          return;
        }
      }

      // Check repulsion site beads (raspberry particles)
      for (const data of repulsionMeshDataRef.current.values()) {
        const beadIntersects = raycaster.intersectObject(data.mesh);
        if (beadIntersects.length > 0) {
          const localIndex = Math.floor(beadIntersects[0].instanceId / data.numBeads);
          const globalIndex = data.globalIndices[localIndex];
          if (event.ctrlKey || event.metaKey) {
            const current = Array.isArray(selectedParticles) ? selectedParticles : [];
            if (current.includes(globalIndex)) {
              setSelectedParticles(current.filter((id) => id !== globalIndex));
            } else {
              setSelectedParticles([...current, globalIndex]);
            }
          } else {
            setSelectedParticles([globalIndex]);
          }
          return;
        }
      }

      // Nothing hit — clear selection (non-ctrl click only)
      if (!event.ctrlKey && !event.metaKey) {
        setSelectedParticles([]);
      }
    } catch (error) {
      console.warn('Error during particle selection:', error);
    }
  }, [camera, setSelectedParticles, getNormalizedMouseCoords, particleData, selectedParticles, isPathtracerEnabled]);

  const handleDoubleClick = useCallback((event) => {
    // Disable double-click navigation during pathtracing to avoid interrupting rendering
    if (isPathtracerEnabled) return;
    if (!meshRef.current || !camera) return;

    const pointer = getNormalizedMouseCoords(event);
    if (!pointer) return;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);

    try {
      // Check main particle mesh
      const intersects = raycaster.intersectObject(meshRef.current);
      if (intersects.length > 0) {
        const instanceId = intersects[0].instanceId;
        if (instanceId >= 0 && instanceId < particleData.length && !particleData[instanceId].hasRepulsionSites) {
          const particlePosition = particleData[instanceId]?.position;
          if (particlePosition && onParticleDoubleClick) {
            onParticleDoubleClick(new THREE.Vector3(particlePosition.x, particlePosition.y, particlePosition.z));
          }
          return;
        }
      }

      // Check repulsion site beads
      for (const data of repulsionMeshDataRef.current.values()) {
        const beadIntersects = raycaster.intersectObject(data.mesh);
        if (beadIntersects.length > 0) {
          const localIndex = Math.floor(beadIntersects[0].instanceId / data.numBeads);
          const position = data.particlePositionsRef.current[localIndex];
          if (position && onParticleDoubleClick) {
            onParticleDoubleClick(position.clone());
          }
          return;
        }
      }
    } catch (error) {
      console.warn('Error during particle double-click:', error);
    }
  }, [camera, particleData, onParticleDoubleClick, getNormalizedMouseCoords, selectedParticles, isPathtracerEnabled]);

  // Raycaster for detecting clicks and double-clicks
  useEffect(() => {
    gl.domElement.addEventListener("click", handleClick);
    gl.domElement.addEventListener("dblclick", handleDoubleClick);
    return () => {
      gl.domElement.removeEventListener("click", handleClick);
      gl.domElement.removeEventListener("dblclick", handleDoubleClick);
    };
  }, [gl, handleClick, handleDoubleClick]);

  // Apply selection effect and cluster highlighting to particles (optimized)
  useEffect(() => {
    if (meshRef.current && particleData.length > 0) {
      const mesh = meshRef.current;
      const yellowColor = new THREE.Color("yellow");
      const dimmedColor = new THREE.Color(0.3, 0.3, 0.3); // Dimmed color for non-highlighted particles
      const dummy = new THREE.Object3D();

      // Ensure we don't exceed the actual instance count
      const instanceCount = Math.min(mesh.count, particleData.length);

      // Safety check: ensure instanceColor exists and has the right length
      if (!mesh.instanceColor || mesh.instanceColor.count !== instanceCount) {
        console.warn('Instance color buffer mismatch, skipping update');
        return;
      }

      for (let i = 0; i < instanceCount; i++) {
        const data = particleData[i];
        if (!data || !data.position) continue; // Skip if data is undefined or incomplete

        let color;
        let scale = data.hasRepulsionSites ? 0 : data.baseScale;

        // Determine color based on selection and cluster highlighting
        if (Array.isArray(selectedParticles) && selectedParticles.includes(i)) {
          color = yellowColor; // Selected particles are yellow
        } else if (data.isInHighlightedCluster && highlightedClusters.size > 0) {
          color = data.typeColor; // Keep original particle color for highlighted clusters
          if (!data.hasRepulsionSites) scale = data.baseScale * 1.3;
        } else if (showOnlyHighlightedClusters && !data.shouldShow) {
          color = dimmedColor; // Dimmed particles when showing only clusters
          if (!data.hasRepulsionSites) scale = data.baseScale * 0.3;
        } else {
          color = data.typeColor; // Normal particle color
        }

        // Safely set color and matrix
        try {
          mesh.setColorAt(i, color);

          // Update scale for cluster highlighting
          dummy.position.set(
            data.position.x,
            data.position.y,
            data.position.z
          );
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        } catch (error) {
          console.warn(`Error setting particle ${i} properties:`, error);
        }
      }

      mesh.instanceColor.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [selectedParticles, particleData, highlightedClusters, showOnlyHighlightedClusters, geometry]);

  // Group particles by type (tracking global indices for repulsion site selection)
  const particlesByType = useMemo(() => {
    const map = new Map();
    if (positions && positions.length > 0) {
      positions.forEach((pos, globalIndex) => {
        const typeIndex = pos.typeIndex;
        if (!map.has(typeIndex)) {
          map.set(typeIndex, { particleType: pos.particleType, particles: [], globalIndices: [] });
        }
        map.get(typeIndex).particles.push(pos);
        map.get(typeIndex).globalIndices.push(globalIndex);
      });
    }
    return map;
  }, [positions]);

  // Early return if no positions (after all hooks)
  if (!positions || positions.length === 0) {
    return null;
  }

  return (
    <>
      {/* Path tracer uses individual meshes instead of InstancedMesh */}
      {isPathtracerEnabled ? (
        <>
          {particleData.map((data, i) => {
            if (!data || !data.position) return null;

            // Raspberry particles render via RepulsionSites beads instead
            if (data.hasRepulsionSites) return null;

            // Hide noise particles (particles not in any cluster) when pathtracing
            // If clustering is active (highlightedClusters has any clusters) and particle is not in a cluster, hide it
            if (highlightedClusters.size > 0 && !data.isInHighlightedCluster) {
              return null;
            }
            
            // Hide particles when "show only selected" is active and particle shouldn't be shown
            if (showOnlyHighlightedClusters && !data.shouldShow) {
              return null;
            }
            
            const color = (Array.isArray(selectedParticles) && selectedParticles.includes(i))
              ? new THREE.Color("yellow")
              : data.typeColor;

            const scale = data.baseScale * ((data.isInHighlightedCluster && highlightedClusters.size > 0)
              ? 1.3
              : 1.0);
            
            return (
              <mesh
                key={i}
                position={[data.position.x, data.position.y, data.position.z]}
                scale={[scale, scale, scale]}
                castShadow
                receiveShadow
                geometry={geometry}
              >
                <meshStandardMaterial
                  color={color}
                  metalness={0.1}
                  roughness={0.8}
                  emissive={color}
                  emissiveIntensity={0.3}
                />
              </mesh>
            );
          })}
        </>
      ) : (
        <instancedMesh ref={meshRef} args={[geometry, material, count]} castShadow receiveShadow>
          {/* This instancedMesh renders the particles */}
        </instancedMesh>
      )}

      {Array.from(particlesByType.values()).map(
        ({ particleType, particles, globalIndices }, idx) => {
          if (!particleType?.repulsionSiteData?.length) return null;
          const typeColor = stableTypeColors[particleType.typeIndex % stableTypeColors.length];
          return (
            <RepulsionSites
              key={`repulsion-${particleType.typeIndex}-${idx}`}
              particles={particles}
              repulsionSiteData={particleType.repulsionSiteData}
              boxSize={boxSize}
              particleScale={particleType.particleScale ?? 1.0}
              typeColor={typeColor}
              globalIndices={globalIndices}
              typeIndex={particleType.typeIndex}
              onRegister={registerRepulsionMesh}
            />
          );
        }
      )}

      {showPatches && Array.from(particlesByType.values()).map(
        ({ particleType, particles }, idx) => {
          // Check if this particle type has valid patch data
          if (
            particleType &&
            particleType.patchPositions &&
            particleType.patchPositions.length > 0 &&
            particleType.patches &&
            particleType.patches.length > 0 &&
            particleType.patches.length === particleType.patchPositions.length
          ) {
            // Filter particles based on cluster visibility
            let filteredParticles = particles;
            if (showOnlyHighlightedClusters) {
              if (highlightedClusters.size > 0) {
                // Only show patches for particles that are in highlighted clusters
                filteredParticles = particles.filter((particle, index) => {
                  // Find the global index of this particle
                  const globalIndex = positions.findIndex(p =>
                    p.x === particle.x && p.y === particle.y && p.z === particle.z
                  );
                  return highlightedClusters.has(globalIndex);
                });
              } else {
                // If "show only selected" is enabled but no clusters are selected, show no patches
                filteredParticles = [];
              }
            }

            // Only render patches if there are visible particles
            if (filteredParticles.length > 0) {
              return (
                <Patches
                  key={`patches-${particleType.typeIndex}-${idx}`}
                  particles={filteredParticles}
                  patchPositions={particleType.patchPositions}
                  patchIDs={particleType.patches}
                  boxSize={boxSize}
                  colorScheme={colorScheme}
                  isPathtracerEnabled={isPathtracerEnabled}
                />
              );
            }
          }
          return null;
        },
      )}
    </>
  );
}

export default Particles;

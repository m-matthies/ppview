import React, { useRef, useEffect } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei/core/OrbitControls";
import { Stats } from "@react-three/drei/core/Stats";
import { Environment } from "@react-three/drei/core/Environment";
import Particles from "./Particles";
import Springs from "./Springs";
import OxDNANucleotides from "./OxDNANucleotides";
import { Pathtracer } from "@react-three/gpu-pathtracer";
import { EffectComposer, SSAO } from "@react-three/postprocessing";
import * as THREE from "three";
import { useParticleStore } from "../store/particleStore";
import { useUIStore } from "../store/uiStore";

// Coordinate Axis component using ArrowHelper - positioned at box corner
function CoordinateAxis({ boxSize }) {
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

    // Create X-axis arrow (Dark Red - matching oxDNA reference 0x800000)
    const xDirection = new THREE.Vector3(1, 0, 0);
    const xArrow = new THREE.ArrowHelper(
      xDirection,
      origin,
      arrowLength,
      0x800000, // Dark Red
      arrowHeadLength,
      arrowHeadWidth
    );
    xArrow.name = 'x-axis';
    groupRef.current.add(xArrow);

    // Create Y-axis arrow (Dark Green - matching oxDNA reference 0x008000)
    const yDirection = new THREE.Vector3(0, 1, 0);
    const yArrow = new THREE.ArrowHelper(
      yDirection,
      origin,
      arrowLength,
      0x008000, // Dark Green
      arrowHeadLength,
      arrowHeadWidth
    );
    yArrow.name = 'y-axis';
    groupRef.current.add(yArrow);

    // Create Z-axis arrow (Dark Blue - matching oxDNA reference 0x000080)
    const zDirection = new THREE.Vector3(0, 0, 1);
    const zArrow = new THREE.ArrowHelper(
      zDirection,
      origin,
      arrowLength,
      0x000080, // Dark Blue
      arrowHeadLength,
      arrowHeadWidth
    );
    zArrow.name = 'z-axis';
    groupRef.current.add(zArrow);

  }, [boxSize]); // Update when boxSize changes

  return <group ref={groupRef} />;
}

const ParticleScene = () => {
  // Only subscribe to what ParticleScene itself renders.
  // Particles/OxDNANucleotides/Patches all read positions from the store directly,
  // so subscribing here would cause the entire Canvas subtree (lights, simulation box,
  // orbit controls, SSAO) to re-render on every trajectory frame — unnecessary.
  const currentBoxSize = useParticleStore(state => state.currentBoxSize);
  const topData = useParticleStore(state => state.topData);

  const {
    setSceneRef,
    showSimulationBox,
    showBackdropPlanes,
    showCoordinateAxis,
    isPathtracerEnabled,
    pathtracerConfig,
  } = useUIStore();

  return (
    <Canvas
      shadows // Enable shadows for the scene
      camera={{ position: [100, 0, 0], fov: 45 }}
      frameloop={isPathtracerEnabled ? "always" : "demand"} // Always render when pathtracing
      dpr={[1, 2]} // Adaptive pixel ratio for performance
      gl={{
        preserveDrawingBuffer: true, // Enable screenshot capability
        outputColorSpace: THREE.SRGBColorSpace, // Ensure correct color space for screenshots
        toneMapping: THREE.ACESFilmicToneMapping, // Better color reproduction
        toneMappingExposure: 0.7 // Balanced for shadows visibility
      }}
    >
      {isPathtracerEnabled ? (
        <Pathtracer
          key={`${showSimulationBox}-${showBackdropPlanes}-${showCoordinateAxis}`}
          enabled={true}
          samples={pathtracerConfig.samples}
          minSamples={pathtracerConfig.minSamples}
          bounces={pathtracerConfig.bounces}
          tiles={pathtracerConfig.tiles}
          resolutionScale={pathtracerConfig.resolutionScale}
        >
          <SceneContent
            boxSize={currentBoxSize}
            onSceneReady={setSceneRef}
            showSimulationBox={showSimulationBox}
            showBackdropPlanes={showBackdropPlanes}
            showCoordinateAxis={showCoordinateAxis}
            isPathtracerEnabled={isPathtracerEnabled}
            isOxDNA={!!(topData?.nucleotides?.length)}
          />
        </Pathtracer>
      ) : (
        <SceneContent
          boxSize={currentBoxSize}
          onSceneReady={setSceneRef}
          showSimulationBox={showSimulationBox}
          showBackdropPlanes={showBackdropPlanes}
          showCoordinateAxis={showCoordinateAxis}
          isPathtracerEnabled={isPathtracerEnabled}
          isOxDNA={!!(topData?.nucleotides?.length)}
        />
      )}
    </Canvas>
  );
};

// React.memo: SceneContent only re-renders when its own props change.
// Particles/OxDNANucleotides/Patches subscribe to Zustand directly,
// so trajectory frame updates don't propagate up to lights, controls, and scene geometry.
const SceneContent = React.memo(function SceneContent({
  boxSize,
  onSceneReady,
  showSimulationBox,
  showBackdropPlanes,
  showCoordinateAxis,
  isPathtracerEnabled,
  isOxDNA,
}) {
  const controlsRef = useRef();
  const { scene, camera, invalidate, gl } = useThree();
  const isAnimating = useRef(false);

  // Provide complete scene data to parent component
  useEffect(() => {
    if (onSceneReady && scene && camera && gl) {
      onSceneReady({ scene, camera, gl, invalidate });
    }
  }, [onSceneReady, scene, camera, gl, invalidate]);

  // Function to handle double-click on a particle
  const handleParticleDoubleClick = (particlePosition) => {
    // Animate camera position towards the particle
    const duration = 1; // Duration in seconds
    const startTime = performance.now();
    const startPosition = camera.position.clone();
    const targetPosition = particlePosition
      .clone()
      .add(new THREE.Vector3(0, 0, 5)); // Adjust the offset as needed

    isAnimating.current = true;

    const animate = (time) => {
      const elapsed = (time - startTime) / 1000;
      const t = Math.min(elapsed / duration, 1);

      camera.position.lerpVectors(startPosition, targetPosition, t);
      controlsRef.current.target.lerpVectors(
        controlsRef.current.target,
        particlePosition,
        t,
      );
      controlsRef.current.update();
      invalidate(); // Request a render

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        isAnimating.current = false;
      }
    };

    requestAnimationFrame(animate);
  };

  // Handle controls changes to trigger re-render
  useFrame(() => {
    if (controlsRef.current && (controlsRef.current.enabled && !isAnimating.current)) {
      // Only invalidate if controls have actually changed
      const controls = controlsRef.current;
      if (controls._hasChanged) {
        invalidate();
        controls._hasChanged = false;
      }
    }
  });

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        onChange={() => invalidate()} // Trigger re-render on camera changes
        enableDamping={true}
        dampingFactor={0.05}
        makeDefault={isPathtracerEnabled} // Required for pathtracer
      />
      {/* ========== PHYSICALLY BASED LIGHTING SETUP ========== */}

      {/* Environment map for realistic reflections and ambient lighting */}
      <Environment
        preset="studio" // Professional studio lighting preset
        background={false} // Don't replace the background
        environmentIntensity={0.3} // More subtle environment reflections
      />

      {/* Hemisphere light for natural sky/ground illumination */}
      <hemisphereLight
        skyColor="#87CEEB" // Sky blue
        groundColor="#2C2C2C" // Dark ground
        intensity={0.25}
        position={[0, 10, 0]}
      />

      {/* Low ambient light for base illumination */}
      <ambientLight intensity={0.3} color="#ffffff" />

      {/* Strong key light - primary illumination with high quality shadows */}
      <directionalLight
        position={[20, 25, 15]}
        intensity={1.2}
        color="#ffffff"
        castShadow={true}
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-near={0.1}
        shadow-camera-far={500}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
        shadow-bias={-0.00005}
        shadow-normalBias={0.02}
      />

      {/* Secondary fill light - warmer tone for depth */}
      <directionalLight
        position={[-15, 10, -10]}
        intensity={0.4}
        color="#fff8e6"
        castShadow={false}
      />

      {/* Rim light for edge definition - cooler tone */}
      <directionalLight
        position={[-8, 5, -12]}
        intensity={0.3}
        color="#e6f3ff"
        castShadow={false}
      />

      {/* Bottom fill to prevent complete darkness in shadows */}
      <directionalLight
        position={[0, -10, 0]}
        intensity={0.15}
        color="#f0f0f0"
        castShadow={false}
      />

      {/* Render the simulation box conditionally */}
      {showSimulationBox && (
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={boxSize} />
          <meshBasicMaterial color="gray" wireframe />
        </mesh>
      )}

      {/* Render backdrop planes conditionally */}
      {showBackdropPlanes && (
        <>
          {/* XY plane at z=0 (back) */}
          <mesh position={[0, 0, -boxSize[2] / 2]} rotation={[0, 0, 0]}>
            <planeGeometry args={[boxSize[0], boxSize[1]]} />
            <meshStandardMaterial
              color="#808080"
              transparent
              opacity={0.7}
              side={THREE.DoubleSide}
              depthWrite={false}
              metalness={0.2}
              roughness={0.1}
              envMapIntensity={1.0}
            />
          </mesh>

          {/* XZ plane at y=0 (bottom) */}
          <mesh position={[0, -boxSize[1] / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[boxSize[0], boxSize[2]]} />
            <meshStandardMaterial
              color="#808080"
              transparent
              opacity={0.7}
              side={THREE.DoubleSide}
              depthWrite={false}
              metalness={0.2}
              roughness={0.1}
              envMapIntensity={1.0}
            />
          </mesh>

          {/* YZ plane at x=0 (left) */}
          <mesh position={[-boxSize[0] / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[boxSize[2], boxSize[1]]} />
            <meshStandardMaterial
              color="#808080"
              transparent
              opacity={0.7}
              side={THREE.DoubleSide}
              depthWrite={false}
              metalness={0.2}
              roughness={0.1}
              envMapIntensity={1.0}
            />
          </mesh>
        </>
      )}

      {/* Render coordinate axes conditionally */}
      {showCoordinateAxis && (
        <CoordinateAxis boxSize={boxSize} />
      )}

      {isOxDNA ? (
        <OxDNANucleotides onParticleDoubleClick={handleParticleDoubleClick} />
      ) : (
        <Particles onParticleDoubleClick={handleParticleDoubleClick} />
      )}
      <Springs />

      {/* Add subtle SSAO for gentle ambient occlusion (disabled when pathtracing) */}
      {!isPathtracerEnabled && (
        <EffectComposer enableNormalPass>
          <SSAO
            samples={31}
            radius={0.3}
            intensity={12}
            luminanceInfluence={0.6}
            color="#000000"
          />
        </EffectComposer>
      )}

      {/* Add Stats component for performance monitoring */}
      <Stats />
    </>
  );
});

export default ParticleScene;

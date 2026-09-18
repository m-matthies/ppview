import React, { useRef, useEffect, useMemo, useCallback } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei/core/OrbitControls";
import { Stats } from "@react-three/drei/core/Stats";
import { Environment } from "@react-three/drei/core/Environment";
import Springs from "./Springs";
import { rendererFor } from "../formats/registry";
import { EffectComposer, SSAO } from "@react-three/postprocessing";
import * as THREE from "three";
import { useParticleStore } from "../store/particleStore";
import { useUIStore } from "../store/uiStore";
import { isDarkBackground } from "../lighting";
import { PickingProvider, applySelection } from "../rendering/pickingService";
import { centredPosition } from "../rendering/transforms";

// Coordinate Axis component using ArrowHelper - positioned at box corner
function CoordinateAxis({ boxSize, isDark }) {
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

// ============================================================================
// Scene lighting — driven entirely by lightingSettings in the UI store.
// Every value here must come from `s`; hardcoding one silently disconnects
// the corresponding control in LightingControlsModal.
// ============================================================================
function SceneLighting({ s }) {
  const { invalidate } = useThree();

  // frameloop is "demand", so a settings change must explicitly request a
  // redraw or the sliders appear to do nothing.
  useEffect(() => {
    invalidate();
  }, [s, invalidate]);

  return (
    <>
      {/* Environment map for realistic reflections and ambient lighting */}
      <Environment
        preset="studio"
        background={false}
        environmentIntensity={s.environmentIntensity}
      />

      {/* Hemisphere light for natural sky/ground illumination */}
      <hemisphereLight
        skyColor={s.hemisphereSkyColor}
        groundColor={s.hemisphereGroundColor}
        intensity={s.hemisphereIntensity}
        position={[0, 10, 0]}
      />

      {/* Base ambient fill */}
      <ambientLight intensity={s.ambientIntensity} color="#ffffff" />

      {/* Key light — the only shadow caster */}
      <directionalLight
        position={s.keyLightPosition}
        intensity={s.keyLightIntensity}
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

      {/* Fill light. Neutral, like every other light here: a warm fill would
          shift every particle colour in the scene, and those colours are data. */}
      <directionalLight
        position={s.fillLightPosition}
        intensity={s.fillLightIntensity}
        color="#ffffff"
        castShadow={false}
      />

      {/* Rim light for edge definition */}
      <directionalLight
        position={s.rimLightPosition}
        intensity={s.rimLightIntensity}
        color="#ffffff"
        castShadow={false}
      />

      {/* Bottom fill — keeps shadow interiors from going fully black */}
      <directionalLight
        position={[0, -10, 0]}
        intensity={s.bottomFillIntensity}
        color="#ffffff"
        castShadow={false}
      />
    </>
  );
}

const ParticleScene = () => {
  // Only subscribe to what ParticleScene itself renders.
  // Particles/OxDNANucleotides/Patches all read positions from the store directly,
  // so subscribing here would cause the entire Canvas subtree (lights, simulation box,
  // orbit controls, SSAO) to re-render on every trajectory frame — unnecessary.
  const currentBoxSize = useParticleStore(state => state.currentBoxSize);
  const topData = useParticleStore(state => state.topData);

  const setSceneRef = useUIStore(state => state.setSceneRef);
  const showSimulationBox = useUIStore(state => state.showSimulationBox);
  const showBackdropPlanes = useUIStore(state => state.showBackdropPlanes);
  const showCoordinateAxis = useUIStore(state => state.showCoordinateAxis);
  const showStats = useUIStore(state => state.showStats);
  const lightingSettings = useUIStore(state => state.lightingSettings);
  const sceneBackground = useUIStore(state => state.sceneBackground);

  return (
    <Canvas
      shadows // Enable shadows for the scene
      camera={{ position: [100, 0, 0], fov: 45 }}
      frameloop="demand"
      dpr={[1, 2]} // Adaptive pixel ratio for performance
      gl={{
        preserveDrawingBuffer: true, // Enable screenshot capability
        outputColorSpace: THREE.SRGBColorSpace, // Ensure correct color space for screenshots
        // Khronos PBR Neutral: leaves midtone hue and saturation alone and only
        // compresses highlights. ACES Filmic, the usual default, desaturates as
        // it rolls off — which quietly misreports colours that encode particle
        // type, patch ID or base.
        toneMapping: THREE.NeutralToneMapping,
        toneMappingExposure: 1.0
      }}
    >
      <SceneContent
        boxSize={currentBoxSize}
        onSceneReady={setSceneRef}
        showSimulationBox={showSimulationBox}
        showBackdropPlanes={showBackdropPlanes}
        showCoordinateAxis={showCoordinateAxis}
        showStats={showStats}
        lightingSettings={lightingSettings}
        sceneBackground={sceneBackground}
        topData={topData}
      />
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
  showStats,
  lightingSettings,
  sceneBackground,
  topData,
}) {
  const controlsRef = useRef();
  const { scene, camera, invalidate, gl } = useThree();
  const ssaoEnabled = lightingSettings.ssaoEnabled;
  const setSelectedParticles = useUIStore(state => state.setSelectedParticles);
  // Which renderer draws this topology is the format registry's decision.
  const Renderer = useMemo(() => rendererFor(topData), [topData]);
  const isDark = isDarkBackground(sceneBackground);

  // The scene owns its background so it lands in screenshots and is independent
  // of the page behind the canvas.
  useEffect(() => {
    scene.background = new THREE.Color(sceneBackground);
    invalidate();
  }, [scene, sceneBackground, invalidate]);

  // Backdrop planes and the simulation box are staging, not data, so they are
  // derived from the background: far enough off it to read as surfaces that
  // catch shadow, close enough not to become a second background colour.
  const { backdropColor, boxColor } = useMemo(() => {
    const base = new THREE.Color(sceneBackground);
    const away = new THREE.Color(isDark ? '#ffffff' : '#000000');
    // The planes are lit, so shading pulls them well below their base colour.
    // Bias the base towards white first so the shaded result lands just off the
    // background instead of reading as a grey slab dropped into the scene.
    return {
      backdropColor: base.clone().lerp(new THREE.Color('#ffffff'), isDark ? 0.06 : 0.55).getStyle(),
      boxColor: base.clone().lerp(away, 0.45).getStyle(),
    };
  }, [sceneBackground, isDark]);

  // Provide complete scene data to parent component
  useEffect(() => {
    if (onSceneReady && scene && camera && gl) {
      onSceneReady({ scene, camera, gl, invalidate });
    }
  }, [onSceneReady, scene, camera, gl, invalidate]);

  // Backdrop planes share one material description; keeping it in a single
  // memo avoids three near-identical prop lists drifting apart.
  // Matte, not glossy. These planes exist to catch shadow and give the
  // structure something to sit against; a reflective surface competes with the
  // particles and reads as a slab of material in its own right.
  const backdropMaterial = useMemo(() => ({
    color: backdropColor,
    transparent: true,
    // Partly transparent so the shaded plane blends back towards the
    // background. A lit surface can never reach the brightness of a light
    // background on its own, and an opaque one reads as a slab.
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
    metalness: 0.0,
    roughness: 0.95,
    envMapIntensity: 0.4,
  }), [backdropColor]);

  const handlePick = useCallback((index, event) => {
    const current = useUIStore.getState().selectedParticles;
    const next = applySelection(current, index, event);
    // Re-selecting the same single particle is a no-op; skip the store write so
    // it does not re-run every layer's effects.
    if (current?.length === next.length && next.every((v, i) => current[i] === v)) return;
    setSelectedParticles(next);
  }, [setSelectedParticles]);

  const handleMiss = useCallback(() => {
    // Only publish a change when there is something to clear. Pushing a fresh
    // empty array on every click into empty space re-rendered every layer in
    // the scene for nothing.
    if (useUIStore.getState().selectedParticles?.length) setSelectedParticles([]);
  }, [setSelectedParticles]);

  // Framing a particle only needs its index: the position comes from the store,
  // which removes the per-layer position bookkeeping the old code carried.
  const handleFocus = useCallback((index) => {
    const { positions, currentBoxSize } = useParticleStore.getState();
    const particle = positions?.[index];
    if (!particle) return;
    animateCameraTo(centredPosition(particle, currentBoxSize));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animateCameraTo = (particlePosition) => {
    // Animate camera position towards the particle
    const duration = 1; // Duration in seconds
    const startTime = performance.now();
    const startPosition = camera.position.clone();
    const targetPosition = particlePosition
      .clone()
      .add(new THREE.Vector3(0, 0, 5)); // Adjust the offset as needed

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
      }
    };

    requestAnimationFrame(animate);
  };

  // postprocessing's EffectComposer does `renderer.autoClear = false` when it
  // takes ownership of the renderer (EffectComposer.setRenderer) and never puts
  // it back. r3f shares one renderer across the whole canvas, so once ambient
  // occlusion has been enabled even once, that flag stays false for good.
  //
  // While the composer is mounted this is harmless — it clears its own passes.
  // The moment occlusion is switched off (the Minimal preset) the composer
  // unmounts, r3f goes back to calling gl.render() itself, and with autoClear
  // still false nothing clears the canvas: every frame composites onto the last
  // one and orbiting smears. So restore it whenever the composer is not there.
  useEffect(() => {
    if (!ssaoEnabled) {
      gl.autoClear = true;
      invalidate();
    }
  }, [ssaoEnabled, gl, invalidate]);

  // Belt and braces for the same class of bug. `preserveDrawingBuffer: true` is
  // required so captureScreenshot can read the canvas back after the frame, but
  // it also stops the browser ever implicitly clearing the buffer, so any frame
  // that does not write every pixel leaves the previous one showing through.
  // Binding the default framebuffer first matters: a stale render target left
  // bound would otherwise swallow the clear.
  //
  // A negative priority runs this before the frame is drawn. r3f only hands
  // rendering over to a subscriber whose priority is > 0, so this does not
  // disable its own render — do not change it to 0 or above.
  useFrame(({ gl: renderer }) => {
    renderer.setRenderTarget(null);
    renderer.clear();
  }, -1);

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        onChange={() => invalidate()} // Trigger re-render on camera changes
        enableDamping={true}
        dampingFactor={0.05}
      />

      <SceneLighting s={lightingSettings} />

      {/* Render the simulation box conditionally */}
      {showSimulationBox && (
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={boxSize} />
          <meshBasicMaterial color={boxColor} wireframe />
        </mesh>
      )}

      {/* Render backdrop planes conditionally */}
      {showBackdropPlanes && (
        <>
          {/* XY plane at z=0 (back) */}
          <mesh position={[0, 0, -boxSize[2] / 2]} rotation={[0, 0, 0]}>
            <planeGeometry args={[boxSize[0], boxSize[1]]} />
            <meshStandardMaterial {...backdropMaterial} />
          </mesh>

          {/* XZ plane at y=0 (bottom) */}
          <mesh position={[0, -boxSize[1] / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[boxSize[0], boxSize[2]]} />
            <meshStandardMaterial {...backdropMaterial} />
          </mesh>

          {/* YZ plane at x=0 (left) */}
          <mesh position={[-boxSize[0] / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[boxSize[2], boxSize[1]]} />
            <meshStandardMaterial {...backdropMaterial} />
          </mesh>
        </>
      )}

      {/* Render coordinate axes conditionally */}
      {showCoordinateAxis && (
        <CoordinateAxis boxSize={boxSize} isDark={isDark} />
      )}

      {/* One picking service for the whole scene: both rendering paths register
          their meshes, so which one wins a click is decided by the ray rather
          than by which component attached its listener first. */}
      <PickingProvider onPick={handlePick} onFocus={handleFocus} onMiss={handleMiss}>
        <Renderer />
        <Springs />
      </PickingProvider>

      {/* Screen-space ambient occlusion */}
      {ssaoEnabled && (
        <EffectComposer enableNormalPass>
          <SSAO
            samples={31}
            radius={0.3}
            intensity={lightingSettings.ssaoIntensity}
            luminanceInfluence={0.6}
            color="#000000"
          />
        </EffectComposer>
      )}

      {showStats && <Stats className="r3f-stats" />}
    </>
  );
});

// ParticleScene takes no props, so memoising it means an App re-render (the
// sample readout ticking, a legend toggling) cannot reach the Canvas at all.
export default React.memo(ParticleScene);

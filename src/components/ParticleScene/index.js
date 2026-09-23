import React, { useRef, useEffect, useMemo, useCallback } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei/core/OrbitControls";
import { Stats } from "@react-three/drei/core/Stats";
import Springs from "../Springs";
import Bonds from "../Bonds";
import { rendererFor } from "../../formats/registry";
import { EffectComposer, SSAO } from "@react-three/postprocessing";
import * as THREE from "three";
import { useParticleStore } from "../../store/particleStore";
import { useUIStore } from "../../store/uiStore";
import CoordinateAxis from "./CoordinateAxis";
import SceneLighting from "./SceneLighting";
import { isDarkBackground } from "../../lighting";
import { PickingProvider, applySelection } from "../../rendering/pickingService";
import { framingFor } from "../../rendering/frameCamera";

/**
 * Occlusion that does not deepen as you zoom in.
 *
 * Screen-space occlusion is not scale-invariant. Its kernel is a fraction of the
 * screen, so moving the camera closer leaves it covering the same slice of screen
 * but a much smaller slice of the structure: it stops averaging over a couple of
 * dozen particles and starts resolving the gaps between four or five. Crevices
 * deepen, and a surface that was evenly lit at the default framing grows dark
 * patches that say nothing about the structure and everything about where the
 * camera happens to be. Measured on a 2744-particle lattice, the occlusion in a
 * fixed central window grew **12.6x** over a 2.5x zoom.
 *
 * The principled fix would be a kernel of constant *world* size, and
 * `SSAOEffect` appears to offer exactly that in `radius`. It does not work here:
 * forcing the radius across its whole useful range, 0.05 to 0.9, moves the
 * measured occlusion from 12.67 to 12.60 — nothing, at either framing. Whatever
 * that setting reaches, it is not the image. So this compensates with
 * `intensity`, which demonstrably does.
 *
 * The exponent is measured, not derived. Occlusion here grows about as the cube
 * of the linear zoom, so the strength is reduced by the cube of the distance
 * ratio; that flattens the same sweep from 12.6x to about 1.4x. It is a fit to
 * one dense scene rather than a law, which is why it is a named constant.
 *
 * Reduce only, never boost: zooming out fades occlusion too, but compensating
 * that way would push the effect past the strength the preset asks for, and
 * "stronger than you configured because you zoomed out" is its own surprise.
 */
const SSAO_ZOOM_EXPONENT = 3;
// Scale-invariance means the *visible* occlusion is unchanged, so a small
// multiplier is not occlusion switched off — it is the same darkening seen from
// closer up. The floor only stops it collapsing entirely at extreme zoom.
const SSAO_MIN_SCALE = 0.03;

function AdaptiveSSAO({ intensity, controlsRef }) {
  const effectRef = useRef();
  const { camera, invalidate } = useThree();
  // The distance this is calibrated against: the first one seen, so it follows
  // however the scene happens to be framed rather than assuming a constant.
  const referenceRef = useRef(null);
  const appliedRef = useRef(null);

  useFrame(() => {
    const effect = effectRef.current;
    if (!effect) return;
    const target = controlsRef.current?.target;
    const distance = target ? camera.position.distanceTo(target) : camera.position.length();
    if (!Number.isFinite(distance) || distance <= 0) return;
    if (referenceRef.current === null) referenceRef.current = distance;

    const ratio = distance / referenceRef.current;
    const scale = Math.min(1, Math.max(SSAO_MIN_SCALE, ratio ** SSAO_ZOOM_EXPONENT));
    const wanted = intensity * scale;
    // Only when it actually moves: invalidating unconditionally from inside
    // useFrame would spin the demand loop forever.
    if (appliedRef.current === null || Math.abs(appliedRef.current - wanted) > 1e-3) {
      appliedRef.current = wanted;
      effect.intensity = wanted;
      invalidate();
    }
  });

  return (
    <SSAO
      ref={effectRef}
      samples={31}
      radius={0.3}
      intensity={intensity}
      luminanceInfluence={0.6}
      color="#000000"
    />
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

  /**
   * Brings a set of particles into view, keeping the direction you were looking
   * from.
   *
   * One index or a hundred: the space key frames the whole selection and a
   * double click frames the particle under the pointer, and both are the same
   * question. It used to place the camera five units along +Z from the particle,
   * which framed nothing in particular — it ignored how big the thing was and
   * swung the view to a fixed angle whatever you had lined up.
   */
  const focusOn = useCallback((indices) => {
    const { positions, currentBoxSize, particleRadius } = useParticleStore.getState();
    const controls = controlsRef.current;
    if (!controls) return;

    const framing = framingFor({
      particles: positions,
      indices,
      boxSize: currentBoxSize,
      radius: particleRadius,
      camera,
      target: controls.target,
    });
    if (!framing) return;

    const duration = 0.45;
    const startTime = performance.now();
    const startPosition = camera.position.clone();
    const startTarget = controls.target.clone();

    const animate = (time) => {
      const t = Math.min((time - startTime) / 1000 / duration, 1);
      // Eased, because a linear move reads as a jolt at both ends.
      const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
      camera.position.lerpVectors(startPosition, framing.position, eased);
      controls.target.lerpVectors(startTarget, framing.target, eased);
      controls.update();
      invalidate();
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [camera, invalidate]);

  // Provide complete scene data to parent component
  useEffect(() => {
    if (onSceneReady && scene && camera && gl) {
      // focusOn travels with the rest: the keyboard handler lives in App and
      // this is the channel App already has into the scene.
      onSceneReady({ scene, camera, gl, invalidate, focusOn });
    }
  }, [onSceneReady, scene, camera, gl, invalidate, focusOn]);

  /** A double click frames the one particle under the pointer. */
  const handleFocus = useCallback((index) => focusOn([index]), [focusOn]);

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
      {/*
        No damping: the camera stops when the pointer does.

        Damping keeps applying the last rotation for a few frames after release,
        so the view coasts past where it was let go. In a viewer whose job is
        reading positions off a structure, that overshoot means lining a
        projection up is a series of corrections rather than one movement — and
        under `frameloop="demand"` each coasting frame is a redraw of the whole
        scene, which at a million particles is a real cost for an effect that is
        only decoration.
      */}
      <OrbitControls
        ref={controlsRef}
        onChange={() => invalidate()} // Trigger re-render on camera changes
        enableDamping={false}
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
        {/* Bonds from a cluster/bond observable, which change every frame —
            unlike springs, whose connections the topology fixes. */}
        <Bonds />
      </PickingProvider>

      {/* Screen-space ambient occlusion */}
      {ssaoEnabled && (
        <EffectComposer enableNormalPass>
          <AdaptiveSSAO
            intensity={lightingSettings.ssaoIntensity}
            controlsRef={controlsRef}
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

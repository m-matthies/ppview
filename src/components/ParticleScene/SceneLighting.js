import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei/core/Environment';

// ============================================================================
// Scene lighting — driven entirely by lightingSettings in the UI store.
// Every value here must come from `s`; hardcoding one silently disconnects
// the corresponding control in LightingControlsModal.
// ============================================================================
export function SceneLighting({ s }) {
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

export default SceneLighting;

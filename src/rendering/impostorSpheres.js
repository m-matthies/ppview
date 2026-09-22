import * as THREE from 'three';

/**
 * Spheres drawn as two triangles each instead of five hundred.
 *
 * A `SphereGeometry` at 16 segments is 512 triangles. At a million particles
 * that is 512 million triangles submitted per frame, one to two orders of
 * magnitude past what any GPU sustains — which is what stops a large structure
 * being orbited at all, independently of how fast the data path is.
 *
 * An impostor is a camera-facing quad with the sphere solved in the fragment
 * shader: two triangles, and a normal and depth computed per pixel so it shades
 * and intersects like real geometry. Two million triangles instead of 512
 * million, and the instance data is a position and a radius rather than a
 * sixteen-float matrix.
 *
 * Built by patching `MeshStandardMaterial` rather than writing a shader from
 * scratch, so the scene's lighting rig, tone mapping and shadows keep working —
 * this viewer's lights are deliberately neutral and its tone mapping chosen to
 * report colour faithfully, and a bespoke material would quietly opt out of all
 * of it.
 */

/**
 * The quad every impostor instance draws. Two triangles, four vertices.
 *
 * A unit plane: the vertex shader replaces its projection entirely, so the
 * geometry is only a carrier for four corners. Size comes from the instance
 * scale and the radius uniform.
 */
export const impostorGeometry = () => new THREE.PlaneGeometry(1, 1);

/**
 * Makes an impostor mesh pickable as the sphere it draws, not the quad it is.
 *
 * The ray would otherwise intersect a flat plane that only *looks* camera-facing
 * because the shader billboards it — so clicks missed, or landed on whichever
 * quad happened to face the camera. Testing the analytic sphere per instance is
 * a handful of milliseconds for a click even at a million particles, and it is
 * the same sphere the fragment shader carves out, so what is clicked is exactly
 * what is seen.
 */
export function applyImpostorRaycast(mesh, getRadius) {
  const instanceMatrix = new THREE.Matrix4();
  const centre = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  const hit = new THREE.Vector3();

  mesh.raycast = function raycastImpostors(raycaster, intersects) {
    const radius = getRadius();
    for (let i = 0; i < this.count; i++) {
      this.getMatrixAt(i, instanceMatrix);
      const scale = Math.hypot(
        instanceMatrix.elements[0], instanceMatrix.elements[1], instanceMatrix.elements[2]);
      if (scale <= 0) continue;               // a hidden instance is zero-scaled
      centre.setFromMatrixPosition(instanceMatrix).applyMatrix4(this.matrixWorld);
      sphere.set(centre, scale * radius);
      if (!raycaster.ray.intersectSphere(sphere, hit)) continue;
      intersects.push({
        distance: raycaster.ray.origin.distanceTo(hit),
        point: hit.clone(),
        instanceId: i,
        object: this,
      });
    }
    intersects.sort((a, b) => a.distance - b.distance);
  };
}

/**
 * Patches a standard material into an impostor sphere shader.
 *
 * The instance matrix is read for its translation (the centre) and its scale
 * (the radius), so `InstancedLayer` writes exactly what it already writes and
 * nothing upstream has to know which representation is in use.
 */
export function makeImpostorMaterial({ particleRadius = 0.5, ...parameters } = {}) {
  const material = new THREE.MeshStandardMaterial(parameters);
  // The sphere path gets its size from SphereGeometry(particleRadius); the quad
  // is a unit carrier, so the radius has to reach the shader some other way.
  // Without this an impostor was always scale/2 across and silently ignored the
  // radius control — invisible only because the default radius happens to be
  // 0.5, which made the two agree by coincidence.
  const radiusUniform = { value: particleRadius };
  material.userData.particleRadius = radiusUniform;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uParticleRadius = radiusUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        varying vec2 vQuad;
        varying vec3 vCentreView;
        varying float vRadius;
        // The two projection terms the fragment shader needs for depth.
        // projectionMatrix is a vertex-stage uniform in three, so it cannot be
        // read from the fragment shader — these carry what is needed instead.
        varying float vProjZZ;
        varying float vProjWZ;
        uniform float uParticleRadius;
      `)
      // Replace the usual object-space vertex with a view-space billboard: the
      // quad always faces the camera, so the impostor is correct from every
      // angle without the geometry ever being rebuilt.
      .replace('#include <project_vertex>', `
        vec4 centreObject = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        // Uniform scale, which is what InstancedLayer writes.
        float radius = length(instanceMatrix[0].xyz) * uParticleRadius;

        vec4 centreView = modelViewMatrix * centreObject;
        vQuad = position.xy * 2.0;          // PlaneGeometry spans -0.5..0.5
        vCentreView = centreView.xyz;
        vRadius = radius;
        vProjZZ = projectionMatrix[2][2];
        vProjWZ = projectionMatrix[3][2];

        // Offset in view space, so the quad is always square-on to the camera.
        vec4 mvPosition = centreView;
        mvPosition.xy += position.xy * 2.0 * radius;
        gl_Position = projectionMatrix * mvPosition;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        varying vec2 vQuad;
        varying vec3 vCentreView;
        varying float vRadius;
        varying float vProjZZ;
        varying float vProjWZ;
      `)
      // Carve the sphere out of the quad, and give three the normal it expects
      // in view space so every light in the rig behaves as it would on real
      // geometry.
      .replace('#include <normal_fragment_begin>', `
        float quadR2 = dot(vQuad, vQuad);
        if (quadR2 > 1.0) discard;          // outside the circle: not this sphere
        float quadZ = sqrt(1.0 - quadR2);

        vec3 normal = normalize(vec3(vQuad, quadZ));
        // three derives geometry roughness from this, and declares
        // geometryNormal itself further down — declaring it here is a
        // redefinition, declaring nonPerturbedNormal is required.
        vec3 nonPerturbedNormal = normal;
      `)
      // Depth from the sphere's surface, not the quad's plane, so impostors
      // intersect each other and the box the way spheres do.
      .replace('#include <dithering_fragment>', `
        #include <dithering_fragment>
        // Perspective depth from the sphere's surface. clip.z is
        // P[2][2]*z + P[3][2] and clip.w is -z, so the two carried terms are
        // enough without the whole matrix.
        float surfaceZ = vCentreView.z + quadZ * vRadius;
        gl_FragDepth = (((vProjZZ * surfaceZ + vProjWZ) / -surfaceZ) + 1.0) * 0.5;
      `);
  };

  // Two materials with the same patch still compile separately unless they
  // share a cache key.
  material.customProgramCacheKey = () => 'impostor-sphere-v1';
  return material;
}

/**
 * Above this many particles, impostors are worth their extra per-pixel cost.
 *
 * Below it the triangle count is not a problem and real geometry is simpler:
 * it needs no depth write, so it keeps early-z, and it is what every existing
 * baseline was recorded against.
 */
export const IMPOSTOR_THRESHOLD = 50_000;

/**
 * An explicit choice, from `?impostors=1` or `?impostors=0`.
 *
 * Read from the URL rather than added to the settings panel: it exists so the
 * visual suite can exercise impostors on fixtures far below the threshold — they
 * would otherwise have no coverage at all — and so a slow machine can be told to
 * use them early, or a suspicious rendering told to stop.
 */
export function impostorOverride(search = typeof window !== 'undefined' ? window.location.search : '') {
  const value = new URLSearchParams(search).get('impostors');
  if (value === null) return undefined;
  return value !== '0' && value !== 'false';
}

/** Whether a structure of this size should be drawn as impostors. */
export const shouldUseImpostors = (count, override) =>
  override !== undefined ? override : count >= IMPOSTOR_THRESHOLD;

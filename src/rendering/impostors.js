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
 * The proxy solid every impostor instance draws: an icosahedron, 20 triangles.
 *
 * It was a billboarded quad — two triangles, with the vertex shader replacing
 * the projection entirely. That is the cheapest possible carrier and it broke
 * ambient occlusion, because **the billboarding lived in a shader the occlusion
 * pass does not use**. `EffectComposer` runs with `enableNormalPass`, and that
 * pass draws every object with an override material, so impostor quads were
 * rendered flat and unbillboarded — edge-on to the camera from most angles, and
 * therefore all but absent from the normal buffer. SSAO reading normals that are
 * not there is what produced the speckle across every impostor surface.
 *
 * A proxy solid renders sensibly under *any* shader: the occlusion pass sees a
 * coarse sphere with roughly the right normals and depth, while the fragment
 * shader still carves the exact surface. 20 triangles instead of 2 is a real
 * cost, but set against the 512 of a real sphere it is still a 25x reduction —
 * 20 million triangles at a million particles rather than 512 million.
 *
 * Scaled to *enclose* the shape rather than inscribe it: an icosahedron's
 * inradius is 0.7947 of its circumradius, so the proxy has to be 1/0.7947 times
 * the radius or the silhouette gets clipped into a polygon.
 */
const ENCLOSING = 1 / 0.79465;

export const impostorGeometry = (radius = 1) =>
  new THREE.IcosahedronGeometry(radius * ENCLOSING, 0);

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
 * Patches a standard material into a ray-traced sphere or ellipsoid.
 *
 * One shader for both. The instance matrix decides the shape: it already carries
 * rotation times scale, so the 3x3 of `modelViewMatrix * instanceMatrix` times
 * the radius uniform is exactly the map from a unit sphere onto whatever this
 * instance draws. Inverting it turns ray-shape intersection into ray-unit-sphere
 * intersection, which is a quadratic. A sphere is the case where that map happens
 * to be uniform.
 *
 * It used to read the surface off a billboarded quad, which is cheaper — a
 * sphere's silhouette is always a circle, so the quad's own coordinates are the
 * answer. That is why this now ray-traces instead: a nucleoside is an ellipsoid,
 * whose silhouette depends on its orientation, and a billboard is invisible to
 * the occlusion pass. See `impostorGeometry`.
 *
 * **The radius lives in the geometry, not only in the uniform.** The occlusion
 * pass draws the proxy with its own shader and never sees `uRadius`, so a proxy
 * sized only by the uniform would be the wrong size there. Callers build the
 * geometry at the base radius and let the instance matrix carry any extra scale;
 * both passes then agree.
 */
export function makeImpostorMaterial({ particleRadius = 0.5, radius, ...parameters } = {}) {
  const material = new THREE.MeshStandardMaterial(parameters);
  const radiusUniform = { value: radius ?? particleRadius };
  material.userData.particleRadius = radiusUniform;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRadius = radiusUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 vCentreView;
        varying vec3 vPosView;
        varying mat3 vToLocal;      // view-space offset -> unit-sphere space
        varying mat3 vToView;       // and back again
        // projectionMatrix is a vertex-stage uniform in three, so the fragment
        // shader cannot read it. These carry the two terms depth needs.
        varying float vProjZZ;
        varying float vProjWZ;
        uniform float uRadius;
      `)
      .replace('#include <project_vertex>', `
        mat3 toView = mat3(modelViewMatrix) * mat3(instanceMatrix) * uRadius;
        vToView = toView;
        vToLocal = inverse(toView);

        vec4 centreView = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vCentreView = centreView.xyz;
        vProjZZ = projectionMatrix[2][2];
        vProjWZ = projectionMatrix[3][2];

        // The proxy is drawn where it actually is — no billboarding, so the
        // occlusion pass sees the same solid this shader carves the shape out of.
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vPosView = mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 vCentreView;
        varying vec3 vPosView;
        varying mat3 vToLocal;
        varying mat3 vToView;
        varying float vProjZZ;
        varying float vProjWZ;
        float gSurfaceZ;
      `)
      // Carve the shape out of the proxy, and give three the view-space normal
      // it expects so every light in the rig behaves as it would on real
      // geometry.
      .replace('#include <normal_fragment_begin>', `
        // The camera sits at the origin in view space, so the ray through this
        // fragment is simply its own position.
        vec3 rayDir = normalize(vPosView);
        vec3 originLocal = vToLocal * -vCentreView;
        vec3 dirLocal = vToLocal * rayDir;

        float a = dot(dirLocal, dirLocal);
        float b = 2.0 * dot(originLocal, dirLocal);
        float c = dot(originLocal, originLocal) - 1.0;
        float disc = b * b - 4.0 * a * c;
        if (disc < 0.0) discard;             // the ray passes outside this shape
        float t = (-b - sqrt(disc)) / (2.0 * a);
        vec3 hitLocal = originLocal + t * dirLocal;

        gSurfaceZ = (vCentreView + vToView * hitLocal).z;

        // A unit sphere's normal is its own surface point; carrying it back
        // through the inverse-transpose is what keeps it perpendicular to the
        // ellipsoid rather than to the sphere it came from. For a sphere this
        // reduces to the surface point itself.
        vec3 normal = normalize(transpose(vToLocal) * hitLocal);
        // three derives geometry roughness from this, and declares
        // geometryNormal itself further down — declaring it here is a
        // redefinition, declaring nonPerturbedNormal is required.
        vec3 nonPerturbedNormal = normal;
      `)
      // Depth from the carved surface, not the proxy's, so impostors intersect
      // each other and the box the way real geometry does.
      .replace('#include <dithering_fragment>', `
        #include <dithering_fragment>
        // clip.z is P[2][2]*z + P[3][2] and clip.w is -z, so the two carried
        // terms are enough without the whole matrix.
        gl_FragDepth = (((vProjZZ * gSurfaceZ + vProjWZ) / -gSurfaceZ) + 1.0) * 0.5;
      `);
  };

  // Two materials with the same patch still compile separately unless they
  // share a cache key.
  material.customProgramCacheKey = () => 'impostor-quadric-v1';
  return material;
}

/**
 * A nucleoside is an ellipsoid, but the shader above already handles it — the
 * instance matrix says which shape this is. Kept as its own name because that is
 * what the call site means.
 */
export const makeEllipsoidImpostorMaterial = makeImpostorMaterial;

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

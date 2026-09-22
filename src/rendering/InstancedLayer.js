import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';

/**
 * One InstancedMesh, and the bookkeeping every renderer was repeating.
 *
 * Before this, each renderer hand-rolled the same loop: build a dummy Object3D,
 * write matrices, set needsUpdate, and (if its author remembered) call
 * invalidate. They did not all remember — Patches never requested a redraw at
 * all, and two of them bailed out when instanceColor was null, which is the
 * state of every freshly rebuilt mesh.
 *
 * The layer takes a `write` callback that fills one instance and returns false
 * to hide it, and owns everything around it.
 */

// A hidden instance is collapsed rather than skipped: leaving a stale matrix in
// place leaves ghost geometry behind. This is the codebase-wide convention.
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export function useInstancedLayer({
  meshRef,
  count,
  // (i, dummy, setColor) => boolean — false hides instance i
  write,
  // Anything the write callback closes over. Treated as an effect dependency.
  deps,
  enabled = true,
}) {
  const { invalidate } = useThree();
  // Reused across every instance of every pass; allocating per instance was
  // measurable on large trajectories.
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const scratchColor = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !enabled || count <= 0) return;

    let currentIndex = 0;
    let wroteAnyColor = false;
    const setColor = (color) => {
      if (!color) return;
      // setColorAt allocates instanceColor on first call. Never guard against
      // it being null — a rebuilt mesh always starts that way, and bailing out
      // leaves the instances rendering as bare white material.
      mesh.setColorAt(currentIndex, color.isColor ? color : scratchColor.set(color));
      wroteAnyColor = true;
    };

    for (let i = 0; i < count; i++) {
      currentIndex = i;
      dummy.position.set(0, 0, 0);
      dummy.quaternion.identity();
      dummy.scale.set(1, 1, 1);

      const visible = write(i, dummy, setColor);
      if (visible === false) {
        mesh.setMatrixAt(i, ZERO);
        continue;
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    // Drop the cached bounds so the next raycast recomputes them.
    //
    // THREE's InstancedMesh.raycast tests the ray against `boundingSphere`
    // first, and computes it only when it is null — once, and then never again.
    // Every write here moves instances, so without this the picker keeps
    // testing against wherever the geometry was the first time anyone clicked.
    // Raspberry beads made it visible: their offsets scale with the particle
    // radius, so enlarging particles moved every bead outside the stale sphere
    // and clicking stopped selecting anything at all, while plain spheres —
    // whose centres do not move — carried on working.
    //
    // Nulled rather than recomputed: computeBoundingSphere walks every
    // instance, which is not something to do per frame at a million particles.
    // This defers it to the next raycast, where it happens once per click.
    mesh.boundingSphere = null;
    if (wroteAnyColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // frameloop is "demand": without this the buffers are updated but nothing
    // redraws until some unrelated event happens to request a frame.
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshRef, count, enabled, invalidate, dummy, scratchColor, ...(deps || [])]);
}

/**
 * The component form. `geometry` is intentionally part of `args`: changing it
 * makes r3f rebuild the mesh, and the layer's effect re-runs because geometry is
 * in its dependency list, repopulating both matrices and colours.
 */
const InstancedLayer = React.forwardRef(function InstancedLayer(
  { geometry, material, count, write, deps, enabled = true, castShadow = true, receiveShadow = true },
  forwardedRef,
) {
  const localRef = useRef();
  const meshRef = forwardedRef || localRef;

  useInstancedLayer({
    meshRef,
    count,
    write,
    enabled,
    deps: [geometry, material, ...(deps || [])],
  });

  if (count <= 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
});

export default InstancedLayer;

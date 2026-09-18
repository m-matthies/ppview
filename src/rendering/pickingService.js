import { useEffect, useMemo, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';

/**
 * One raycaster and one pair of DOM listeners for the whole scene.
 *
 * Renderers used to each attach their own click/dblclick handlers to the canvas
 * and build their own raycaster, which made hit precedence a matter of listener
 * registration order — two handlers could both claim the same click. Layers now
 * register their mesh and a mapping from instanceId to particle index, and this
 * service resolves a click once, against whichever registered mesh the ray hits
 * first.
 */

// Reused across picks. A Raycaster per click is pure garbage.
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function normalizedPointer(domElement, event) {
  const rect = domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || x > rect.width || y < 0 || y > rect.height) return null;
  pointer.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
  return pointer;
}

/**
 * @param onPick    (particleIndex, event) => void — a plain or modified click
 * @param onFocus   (particleIndex) => void — double click, for camera framing
 * @param onMiss    () => void — click that hit nothing registered
 */
export function usePickingService({ onPick, onFocus, onMiss }) {
  const { gl, camera } = useThree();
  // Registration order is irrelevant: the ray decides. Sorted by distance below.
  const targets = useRef(new Map());

  const register = useCallback((id, entry) => {
    if (entry) targets.current.set(id, entry);
    else targets.current.delete(id);
  }, []);

  const resolve = useCallback((event) => {
    if (!camera || !gl?.domElement) return null;
    const p = normalizedPointer(gl.domElement, event);
    if (!p) return null;
    raycaster.setFromCamera(p, camera);

    let best = null;
    for (const entry of targets.current.values()) {
      const mesh = entry.meshRef?.current;
      if (!mesh) continue;
      const hits = raycaster.intersectObject(mesh);
      for (const hit of hits) {
        if (hit.instanceId == null) continue;
        const particleIndex = entry.resolveIndex(hit.instanceId);
        // A layer returns null for instances it is not currently drawing —
        // a zero-scaled hidden particle must not swallow the click.
        if (particleIndex == null) continue;
        if (!best || hit.distance < best.distance) {
          best = { distance: hit.distance, particleIndex };
        }
        break; // hits are already sorted per-object
      }
    }
    return best;
  }, [camera, gl]);

  useEffect(() => {
    const el = gl?.domElement;
    if (!el) return;

    const handleClick = (event) => {
      const hit = resolve(event);
      if (hit) onPick?.(hit.particleIndex, event);
      else onMiss?.();
    };
    const handleDoubleClick = (event) => {
      const hit = resolve(event);
      if (hit) onFocus?.(hit.particleIndex);
    };

    el.addEventListener('click', handleClick);
    el.addEventListener('dblclick', handleDoubleClick);
    return () => {
      el.removeEventListener('click', handleClick);
      el.removeEventListener('dblclick', handleDoubleClick);
    };
  }, [gl, resolve, onPick, onFocus, onMiss]);

  return useMemo(() => ({ register }), [register]);
}

/** Standard multi-select semantics, shared so every layer behaves the same. */
export function applySelection(current, index, event) {
  const list = Array.isArray(current) ? current : [];
  if (!(event.ctrlKey || event.metaKey)) return [index];
  return list.includes(index) ? list.filter(i => i !== index) : [...list, index];
}

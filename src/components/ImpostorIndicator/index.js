import React from 'react';
import { useUIStore, usesImpostors } from '../../store/uiStore';
import { ImpostorIcon } from '../Icons';
import './ImpostorIndicator.css';

/**
 * Says when the scene is drawn as impostors rather than as real geometry.
 *
 * Past fifty thousand particles a sphere stops being five hundred triangles and
 * becomes twenty, with the surface solved per pixel in the fragment shader. That
 * switch happens on its own, from the particle count, and it changes what the
 * picture *is* — so in a viewer whose job is reporting a structure faithfully,
 * it should not be silent.
 *
 * Shown only while impostors are on. An indicator that is always present but
 * usually means nothing is decoration, and the corner is the one place in this
 * UI reserved for viewing state. The tooltip carries the detail, including the
 * escape hatch, because a badge cannot.
 */
function ImpostorIndicator() {
  const active = useUIStore(usesImpostors);
  if (!active) return null;

  return (
    <span
      className="impostor-indicator"
      role="img"
      title={'Spheres are drawn as impostors: two triangles each with the surface '
        + 'solved per pixel, which is what keeps a very large structure movable. '
        + 'Shapes and depth are exact. Add ?impostors=0 to the URL to force real geometry.'}
      aria-label="Scene is rendered with impostor spheres"
      data-testid="impostor-indicator"
    >
      <ImpostorIcon size={16} />
    </span>
  );
}

export default ImpostorIndicator;

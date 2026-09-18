import React from 'react';
import { useUIStore } from '../store/uiStore';
import { isDarkBackground } from '../lighting';
import { SunIcon, MoonIcon } from './Icons';

/**
 * Switches the 3D background between the light and dark stock colours.
 *
 * Which state we are in is read back from the background colour itself rather
 * than tracked separately, so a colour picked from the lighting panel's colour
 * well still shows the right icon here.
 */
function SceneBackgroundToggle() {
  const sceneBackground = useUIStore(state => state.sceneBackground);
  const toggleSceneBackground = useUIStore(state => state.toggleSceneBackground);

  const isDark = isDarkBackground(sceneBackground);
  const label = isDark ? 'Switch to a light background' : 'Switch to a dark background';

  return (
    <button
      className="scene-bg-toggle"
      onClick={toggleSceneBackground}
      title={label}
      aria-label={label}
    >
      {isDark ? <SunIcon size={17} /> : <MoonIcon size={17} />}
    </button>
  );
}

export default SceneBackgroundToggle;

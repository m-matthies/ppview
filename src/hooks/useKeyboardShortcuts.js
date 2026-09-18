import { useEffect } from 'react';

const TYPING_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];

/**
 * Global keyboard shortcuts for playback and particle nudging.
 *
 * Keys are ignored while a form field has focus — the lighting and clustering
 * panels are full of number inputs, and W/S/A/D would otherwise move the
 * structure while you typed into them.
 */
export function useKeyboardShortcuts({
  togglePlayback,
  stepFrame,
  goToFrame,
  totalConfigs,
  shiftPositions,
  takeScreenshot,
}) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      if (target instanceof HTMLElement &&
          (target.isContentEditable || TYPING_TAGS.includes(target.tagName))) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const actions = {
        ' ': () => togglePlayback(),
        ArrowLeft: () => stepFrame(event.shiftKey ? -10 : -1),
        ArrowRight: () => stepFrame(event.shiftKey ? 10 : 1),
        Home: () => goToFrame(0),
        End: () => goToFrame(totalConfigs - 1),
      };
      // Axis nudges: Q/A on x, W/S on y, E/D on z.
      const nudges = {
        q: ['x', 1], a: ['x', -1],
        w: ['y', 1], s: ['y', -1],
        e: ['z', 1], d: ['z', -1],
      };

      try {
        if (actions[event.key]) {
          event.preventDefault();
          actions[event.key]();
        } else if (nudges[event.key]) {
          shiftPositions(...nudges[event.key]);
        } else if (event.key === 'p' || event.key === 'P') {
          takeScreenshot();
        }
      } catch (error) {
        // Never let a shortcut break the app.
        console.warn('Error in key handler:', error);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayback, stepFrame, goToFrame, totalConfigs, shiftPositions, takeScreenshot]);
}

export default useKeyboardShortcuts;

import { useCallback, useEffect, useRef } from 'react';
import { useParticleStore } from '../store/particleStore';
import { useUIStore } from '../store/uiStore';
import { goToFrame as goToFrameCommand } from '../store/commands';

/**
 * Moving through a trajectory: one frame at a time, or played.
 *
 * All frame changes go through `goToFrame`, which clamps and requests the
 * redraw that demand rendering needs. A control that sets `currentConfigIndex`
 * directly skips both.
 *
 * Reads the current frame through `getState()` rather than subscribing to it.
 * That is deliberate here and nowhere else: subscribing would rebuild these
 * callbacks on every frame, and the playback interval would capture a stale
 * index in its closure and loop on one frame forever.
 */
export default function usePlayback({ totalConfigs, invalidateScene }) {
  const setCurrentConfigIndex = useParticleStore(state => state.setCurrentConfigIndex);
  const isPlaying = useUIStore(state => state.isPlaying);
  const setIsPlaying = useUIStore(state => state.setIsPlaying);
  const playbackSpeed = useUIStore(state => state.playbackSpeed);
  const timer = useRef(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setIsPlaying(false);
  }, [setIsPlaying]);

  // Delegated, so the clamp and the redraw have one definition. Callers outside
  // App — the time view's click-to-seek — cannot reach this hook's arguments.
  const goToFrame = useCallback((index) => goToFrameCommand(index), []);

  const stepFrame = useCallback((delta) => {
    goToFrame(useParticleStore.getState().currentConfigIndex + delta);
  }, [goToFrame]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) stop();
    else setIsPlaying(true);
  }, [isPlaying, stop, setIsPlaying]);

  const resetTrajectory = useCallback(() => {
    stop();
    setCurrentConfigIndex(0);
  }, [stop, setCurrentConfigIndex]);

  /**
   * The interval lives in an effect rather than in togglePlayback, so that it is
   * rebuilt whenever anything it depends on changes.
   *
   * Two bugs came from owning it imperatively. It captured `totalConfigs` at the
   * moment play was pressed, so loading a shorter trajectory mid-playback left
   * it running past the new end — every tick then asked for a frame that does
   * not exist, and each raised a modal alert. And changing the speed while
   * playing did nothing until the next pause, because the live interval was
   * never recreated.
   */
  useEffect(() => {
    if (!isPlaying) return undefined;
    const id = setInterval(() => {
      const next = useParticleStore.getState().currentConfigIndex + 1;
      if (next >= totalConfigs) stop();   // stop at the end, do not wrap
      else goToFrame(next);               // through goToFrame, so it clamps and redraws
    }, playbackSpeed);
    timer.current = id;
    return () => {
      clearInterval(id);
      if (timer.current === id) timer.current = null;
    };
  }, [isPlaying, playbackSpeed, totalConfigs, goToFrame, stop]);

  // Playing past the end of a newly loaded, shorter trajectory is not something
  // the person asked for: stop rather than clamp silently.
  useEffect(() => {
    if (isPlaying && useParticleStore.getState().currentConfigIndex >= totalConfigs) stop();
  }, [totalConfigs, isPlaying, stop]);

  return { goToFrame, stepFrame, togglePlayback, resetTrajectory, isPlaying };
}

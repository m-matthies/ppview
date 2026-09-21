import { useCallback, useEffect, useRef } from 'react';
import { useParticleStore } from '../store/particleStore';
import { useUIStore } from '../store/uiStore';

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

  const goToFrame = useCallback((index) => {
    const clamped = Math.min(Math.max(index, 0), Math.max(totalConfigs - 1, 0));
    if (clamped === useParticleStore.getState().currentConfigIndex) return;
    setCurrentConfigIndex(clamped);
    // After the store has committed, not during: the frame effect has to run
    // first or there is nothing new to draw.
    setTimeout(invalidateScene, 0);
  }, [totalConfigs, invalidateScene, setCurrentConfigIndex]);

  const stepFrame = useCallback((delta) => {
    goToFrame(useParticleStore.getState().currentConfigIndex + delta);
  }, [goToFrame]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      stop();
      return;
    }
    setIsPlaying(true);
    timer.current = setInterval(() => {
      const next = useParticleStore.getState().currentConfigIndex + 1;
      if (next >= totalConfigs) stop();          // stop at the end, do not wrap
      else setCurrentConfigIndex(next);
    }, playbackSpeed);
  }, [isPlaying, playbackSpeed, totalConfigs, setIsPlaying, setCurrentConfigIndex, stop]);

  const resetTrajectory = useCallback(() => {
    stop();
    setCurrentConfigIndex(0);
  }, [stop, setCurrentConfigIndex]);

  // A running interval outlives the component unless it is cleared.
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  return { goToFrame, stepFrame, togglePlayback, resetTrajectory, isPlaying };
}

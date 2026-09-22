import { useCallback, useRef, useState } from 'react';
import { useParticleStore } from '../../store/particleStore';
import { useUIStore } from '../../store/uiStore';
import { loadFrame } from '../../loading/loadFrame';
import { dbscan } from '../../utils/clustering';
import { pickIndices, assignLineages, orderRows, MAX_ROWS, MAX_COLS } from '../../utils/kymograph';

/**
 * Walks the trajectory, clusters every frame it samples, and hands back the
 * picture's data.
 *
 * Frames come from `loadFrame` with a capture bag in place of the scene's
 * setters, so this inherits everything that path already does — the MGL branch,
 * the centre-of-mass centring, the wrap, and above all the frame cache, which
 * is what makes a second pass over the same trajectory cheap.
 *
 * It is explicitly asked for, never automatic: this is DBSCAN once per frame, so
 * a run that takes 2.4s to cluster at one frame takes two minutes over fifty.
 * It reports progress and can be stopped.
 */
export default function useKymograph() {
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  const cancel = useCallback(() => { cancelRef.current = true; }, []);
  const clear = useCallback(() => setResult(null), []);

  const compute = useCallback(async ({ epsilon, minPoints }) => {
    const {
      trajFile, configIndex, topData, currentBoxSize, positions, currentConfigIndex,
    } = useParticleStore.getState();
    const setBusyMessage = useUIStore.getState().setBusyMessage;

    const particleCount = positions?.length ?? 0;
    if (!particleCount) return;

    // A single-frame structure has no time axis to plot. Say so rather than
    // drawing a one-pixel-wide picture.
    const frameCount = configIndex?.length ?? 0;
    if (!trajFile || frameCount < 2) {
      setResult({ error: 'This structure has only one frame, so there is nothing to show over time.' });
      return;
    }

    cancelRef.current = false;
    setRunning(true);
    setResult(null);

    const frames = pickIndices(frameCount, MAX_COLS);
    const columns = [];
    // Ordering is fixed by one frame — the one on screen — so bands do not
    // reshuffle from column to column. Reordering per frame would make every
    // cluster look like it was constantly falling apart.
    let rows = null;
    // Which column the ordering came from: the panel needs it to turn the
    // pane's selected clusters into the lineages they are.
    let referenceColumn = 0;
    // Cluster identity, carried forward: DBSCAN renumbers every frame, so the
    // colours only mean anything if each cluster is matched to the one it came
    // from.
    let previous = null;
    let nextLineage = 1;

    try {
      for (let i = 0; i < frames.length; i++) {
        if (cancelRef.current) { setResult(null); return; }
        setBusyMessage(`Clustering frame ${i + 1} of ${frames.length} for the time view`);

        let captured = null;
        let box = currentBoxSize;
        // eslint-disable-next-line no-await-in-loop
        await loadFrame({
          file: trajFile,
          index: configIndex,
          frameNumber: frames[i],
          topData,
          // Capture instead of writing to the scene: this must not move the
          // view someone is looking at.
          scene: {
            setPositions: (p) => { captured = p; },
            setCurrentBoxSize: (b) => { box = b; },
            setCurrentTime: () => {},
            setCurrentEnergy: () => {},
          },
        });
        if (!captured?.length) continue;

        const clusters = dbscan(captured, epsilon, minPoints, box);
        const tracked = assignLineages(clusters, particleCount, previous, nextLineage);
        previous = tracked.lineageOf;
        nextLineage = tracked.nextLineage;
        columns.push(tracked.lineageOf);
        if (frames[i] === currentConfigIndex || rows === null) {
          rows = orderRows(tracked.lineageOf, particleCount);
          referenceColumn = columns.length - 1;
        }

        // Yield, so the progress message repaints and a cancel is noticed. The
        // clustering itself blocks, so without this the whole run is one freeze
        // with a message that never changes.
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (cancelRef.current) { setResult(null); return; }
      setResult({
        columns,
        frames,
        rows: pickIndices(rows.length, MAX_ROWS).map(i => rows[i]),
        referenceColumn,
        particleCount,
        error: null,
      });
    } catch (error) {
      console.error('Could not build the time view:', error);
      setResult({ error: 'Could not read every frame, so the time view is incomplete.' });
    } finally {
      setRunning(false);
      setBusyMessage(null);
    }
  }, []);

  return { result, running, compute, cancel, clear };
}

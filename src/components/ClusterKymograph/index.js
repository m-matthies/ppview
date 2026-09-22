import React, { useEffect, useMemo, useRef, useState } from 'react';
import DraggablePanel from '../DraggablePanel';
import { useParticleStore } from '../../store/particleStore';
import { goToFrame } from '../../store/commands';
import { useUIStore } from '../../store/uiStore';
import { getParticleColors } from '../../colors';
import { paintKymograph, lineageSlots, NOISE } from '../../utils/kymograph';
import { CloseIcon } from '../Icons';
import './ClusterKymograph.css';

/**
 * The clustering over time: one column per frame, one row per particle.
 *
 * Opened from the clustering pane, which computes it — the parameters are the
 * pane's, and so is the selection it responds to. A cluster reads as a
 * horizontal band, so persistence, growth and breakup are visible at a glance in
 * a way no single frame can show.
 *
 * Drawn to a canvas rather than to elements: even a modest run is hundreds of
 * columns by a thousand rows, and that many DOM nodes is not a picture, it is a
 * hang.
 */
function ClusterKymograph({ data, selectedParticles, onClose, onRecompute, running }) {
  const canvasRef = useRef(null);
  const colorScheme = useUIStore(state => state.currentColorScheme);
  const currentConfigIndex = useParticleStore(state => state.currentConfigIndex);

  const palette = useMemo(() => getParticleColors(colorScheme, 12), [colorScheme]);
  const [hover, setHover] = useState(null);

  // Which palette entry each lineage was painted with, so the readout's swatch
  // is the colour actually on screen rather than a second guess at it.
  const slots = useMemo(
    () => (data?.columns ? lineageSlots(data.columns) : null),
    [data],
  );

  /** Which column holds the frame on screen. */
  const currentColumn = useMemo(() => {
    if (!data?.frames?.length) return null;
    const nearest = data.frames.findIndex(f => f >= currentConfigIndex);
    return nearest === -1 ? data.frames.length - 1 : nearest;
  }, [data, currentConfigIndex]);

  /**
   * The lineages the pane has selected.
   *
   * Looked up in the column of the frame **on screen**, because that is the
   * frame the pane's clusters describe. Using the column the row order came from
   * instead was wrong as soon as anything moved: scrubbing to a frame where a
   * particle had changed cluster made the pane's one cluster resolve to two
   * lineages, and the picture stopped greying anything at all.
   *
   * Repaints whenever the pane's selection changes, which is the whole of
   * "responsive to the cluster pane".
   */
  const emphasis = useMemo(() => {
    if (!data?.columns?.length || !selectedParticles?.size) return null;
    const column = data.columns[currentColumn ?? 0] ?? data.columns[0];
    const lineages = new Set();
    selectedParticles.forEach((particle) => {
      const lineage = column[particle];
      if (lineage !== undefined && lineage !== NOISE) lineages.add(lineage);
    });
    return lineages.size > 0 ? lineages : null;
  }, [data, selectedParticles, currentColumn]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data?.columns?.length) return;
    const { data: pixels, width, height } = paintKymograph({
      columns: data.columns, rows: data.rows, palette, emphasis,
    });
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  }, [data, palette, emphasis]);

  // Where the frame on screen sits in the picture, as a percentage so it stays
  // put when the canvas is stretched to the panel's width.
  const playhead = useMemo(() => {
    if (currentColumn === null || !data?.frames?.length) return null;
    return (100 * (currentColumn + 0.5)) / data.frames.length;
  }, [data, currentColumn]);

  /** Which cell the pointer is over: a particle, a frame, and its cluster. */
  const readAt = (event) => {
    if (!data?.frames?.length) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const column = Math.min(data.frames.length - 1, Math.max(0,
      Math.floor(((event.clientX - rect.left) / rect.width) * data.frames.length)));
    const row = Math.min(data.rows.length - 1, Math.max(0,
      Math.floor(((event.clientY - rect.top) / rect.height) * data.rows.length)));
    const particle = data.rows[row];
    const lineage = data.columns[column][particle] ?? NOISE;
    return {
      particle,
      frame: data.frames[column],
      lineage,
      color: lineage === NOISE ? null : palette[(slots.get(lineage) ?? 0) % palette.length],
    };
  };

  /** Clicking the picture goes to that frame, which is the obvious thing to want. */
  const goToColumn = (event) => {
    if (!data?.frames?.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    const column = Math.min(data.frames.length - 1,
      Math.max(0, Math.floor(fraction * data.frames.length)));
    // The shared command, not setCurrentConfigIndex: it clamps and asks for the
    // redraw that demand rendering needs.
    goToFrame(data.frames[column]);
  };

  return (
    <DraggablePanel
      // Clear of the clustering pane where there is room, and inside the window
      // where there is not. A fixed x put an 860px panel half off a 1440px
      // screen, and the clamp let it: it only promises a reachable corner.
      initialX={Math.max(20, Math.min(600, window.innerWidth - 840))}
      initialY={80}
      className="kymograph-panel"
      storageId="cluster-kymograph"
    >
      <header className="panel-header drag-handle" tabIndex={0}>
        <h2 className="panel-title">Clusters over time</h2>
        <div className="panel-header-actions">
          <button className="icon-button" onClick={onClose} title="Close the time view">
            <CloseIcon size={16} />
          </button>
        </div>
      </header>

      <div className="panel-body">
        <div className="panel-section kymograph-body">
          {data?.error && <p className="kymograph-note">{data.error}</p>}

          {!data?.error && data?.columns?.length > 0 && (
            <>
              <div
                className="kymograph-plot"
                onClick={goToColumn}
                onMouseMove={(e) => setHover(readAt(e))}
                onMouseLeave={() => setHover(null)}
                role="presentation"
              >
                <canvas ref={canvasRef} className="kymograph-canvas" />
                {playhead !== null && (
                  <span className="kymograph-playhead" style={{ left: `${playhead}%` }} />
                )}
              </div>
              <div className="kymograph-readout">
                {hover ? (
                  <>
                    <span className="num">particle {hover.particle}</span>
                    <span className="num">frame {hover.frame}</span>
                    <span>
                      {hover.lineage === NOISE ? 'not in a cluster' : (
                        <>
                          <span className="kymograph-swatch" style={{ background: hover.color }} />
                          cluster {hover.lineage}
                        </>
                      )}
                    </span>
                  </>
                ) : (
                  <span>Point at the picture to read off a particle and its cluster.</span>
                )}
              </div>

              <div className="kymograph-axis">
                <span className="num">frame {data.frames[0]}</span>
                <span>{data.rows.length.toLocaleString()} of {data.particleCount.toLocaleString()} particles</span>
                <span className="num">{data.frames[data.frames.length - 1]}</span>
              </div>
              <p className="kymograph-note">
                Each row is a particle, each column a frame, and the colour is
                which cluster it was in — clusters are matched between frames by
                the particles they share, so a row changing colour is a particle
                changing cluster. Rows are grouped by the frame that was on
                screen, and the picture can be dragged taller from its bottom edge.
                {emphasis
                  ? ' The selected clusters are in colour wherever they go, so a particle'
                    + ' changes shade at the frame it joins or leaves one.'
                  : ' Select clusters in the clustering pane to pick them out here.'}
              </p>
            </>
          )}

          <button className="select-button" onClick={onRecompute} disabled={running}>
            {running ? 'Working…' : 'Recompute with the current settings'}
          </button>
        </div>
      </div>
    </DraggablePanel>
  );
}

export default ClusterKymograph;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DraggablePanel from '../DraggablePanel';
import { useParticleStore } from '../../store/particleStore';
import { useUIStore } from '../../store/uiStore';
import { goToFrame } from '../../store/commands';
import { getParticleColors } from '../../colors';
import {
  lineageRanks, NOISE, bandOrder, stackFrames, particleTrace, columnForFrame,
  cohortOf, cohortFrames,
} from '../../utils/kymograph';
import { colourForRank } from '../../utils/clusterIdentity';
import { CloseIcon } from '../Icons';
import './ClusterKymograph.css';

/**
 * How the clustering changes over the trajectory: time across, clusters as
 * bands whose height is how many particles they hold.
 *
 * This was a kymograph first — one row per particle — and that is the obvious
 * reading of "clusters over time" and the wrong one. Rows fall below a pixel as
 * soon as a structure is large; rows are grouped by one frame's clustering, so
 * every particle that later leaves is stranded in the wrong group and the bands
 * decay into noise exactly as the trajectory gets interesting; and it shows
 * membership but never shows a merge or a split, which are the two events anyone
 * watching clusters over time is watching for.
 *
 * Bands fix all three. Height is a count, so nothing goes sub-pixel however many
 * particles there are. A cluster is one continuous shape however much its
 * membership churns. And a merge is two bands becoming one.
 *
 * Individual particles are not lost in the change: the ones selected in the
 * scene are drawn as a line through the bands they belong to, so following one
 * as it moves between clusters is a line crossing from one band to another.
 */
function ClusterKymograph({
  data, selectedParticles, selectionToken, onClose, onRecompute, running,
}) {
  const canvasRef = useRef(null);
  const plotRef = useRef(null);
  const colorScheme = useUIStore(state => state.currentColorScheme);
  const currentConfigIndex = useParticleStore(state => state.currentConfigIndex);
  const trackedParticles = useUIStore(state => state.selectedParticles);

  const palette = useMemo(() => getParticleColors(colorScheme, 12), [colorScheme]);
  const [hover, setHover] = useState(null);
  // Redrawn when the plot is resized: the canvas is sized to its box, so a drag
  // of the resize handle has to repaint rather than stretch what is there.
  const [plotSize, setPlotSize] = useState(0);

  const stack = useMemo(() => {
    if (!data?.columns?.length) return null;
    const order = bandOrder(data.columns);
    return { order, frames: stackFrames(data.columns, order, data.particleCount) };
  }, [data]);

  // The same rule the pane colours by, so a band and the cluster it stands for
  // are the same colour — one function, not two sources with a fallback between
  // them, which is what let a cluster the pane drew near-black have a green band.
  const ranks = useMemo(
    () => (data?.columns ? lineageRanks(data.columns) : null),
    [data],
  );
  const colourOf = useCallback(
    (lineage) => colourForRank(palette, ranks?.get(lineage) ?? 0),
    [palette, ranks],
  );

  const currentColumn = useMemo(
    () => (data?.frames?.length ? columnForFrame(data, currentConfigIndex) : null),
    [data, currentConfigIndex],
  );

  /**
   * Which clusters are being followed.
   *
   * Pinned by clicking a band, which is the gesture that makes tracking work at
   * all: a lineage is stable, so pinning one follows that cluster and nothing
   * else, whatever the pane does afterwards. Falling back to the pane's
   * selection keeps the two panels connected when nothing is pinned.
   */
  const [pinned, setPinned] = useState(null);
  const [paneEmphasis, setPaneEmphasis] = useState(null);
  const columnRef = useRef(0);
  columnRef.current = currentColumn ?? 0;

  useEffect(() => {
    if (!data?.columns?.length || !selectedParticles?.size) {
      setPaneEmphasis(null);
      return;
    }
    // Resolved through the frame on screen, because that is the frame the pane's
    // clusters describe — and then held. The pane selects by cluster *index* and
    // DBSCAN renumbers every frame, so re-resolving as the frame changes walks
    // the highlight onto whichever cluster now holds that index.
    const column = data.columns[columnRef.current] ?? data.columns[0];
    const lineages = new Set();
    selectedParticles.forEach((particle) => {
      const lineage = column[particle];
      if (lineage !== undefined && lineage !== NOISE) lineages.add(lineage);
    });
    setPaneEmphasis(lineages.size > 0 ? lineages : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionToken, data]);

  const emphasis = pinned ?? paneEmphasis;

  /**
   * Following a cluster shows the fate of the particles that made it up.
   *
   * Not its size over time, which is a different question and a misleading
   * answer to this one: a cluster can hold a steady forty particles all run and
   * have exchanged every one of them, and its band would not flinch. So the
   * cohort is fixed at the frame it was selected in, and every later frame
   * divides it by where those particles are *now* — staying together is one
   * solid block, dispersing fans out into the colours of wherever they went.
   */
  const [cohort, setCohort] = useState(null);
  useEffect(() => {
    if (!emphasis || !data?.columns?.length || !stack) { setCohort(null); return; }
    // Fixed at the frame it was selected in, read through a ref so that scrubbing
    // does not quietly redefine who the cohort is — which would make it agree
    // with whatever is on screen and answer nothing.
    const column = data.columns[columnRef.current] ?? data.columns[0];
    const members = cohortOf(column, emphasis);
    setCohort(members.length === 0
      ? null
      : { members, frames: cohortFrames(data.columns, members, stack.order) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emphasis, data, stack]);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setPlotSize(plot.clientHeight));
    observer.observe(plot);
    return () => observer.disconnect();
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stack || !data?.columns?.length) return;
    const box = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(box.width * dpr));
    const height = Math.max(1, Math.round(box.height * dpr));
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1d1e25';
    ctx.fillRect(0, 0, width, height);
    const columnWidth = width / data.columns.length;

    // The cohort when a cluster is being followed, every cluster otherwise.
    const frames = cohort ? cohort.frames : stack.frames;
    for (let frame = 0; frame < frames.length; frame++) {
      const x = frame * columnWidth;
      for (const [lineage, span] of frames[frame]) {
        // In the cohort view nothing is muted — every band is somewhere the
        // followed particles actually went, and greying those would hide the
        // answer. Noise takes the flat tone: it is not a cluster.
        const muted = cohort
          ? lineage === NOISE
          : (emphasis !== null && !emphasis.has(lineage));
        // A flat desaturated tone rather than a translucent wash: over a dark
        // panel, alpha leaves a muddy tint that still reads as a colour.
        ctx.fillStyle = muted ? '#3f4149' : colourOf(lineage);
        const top = Math.round(span.start * height);
        const bottom = Math.round(span.end * height);
        ctx.fillRect(Math.floor(x), top, Math.ceil(columnWidth) + 1, Math.max(1, bottom - top));
      }
    }

    // Followed particles last, so a trace is never hidden by a band. A gap in a
    // line is a frame where that particle belonged to no cluster at all, which
    // is worth seeing rather than interpolating over.
    ctx.lineWidth = Math.max(1.5, 1.5 * dpr);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff';
    for (const particle of trackedParticles ?? []) {
      const trace = particleTrace(data.columns, frames, particle);
      ctx.beginPath();
      let drawing = false;
      trace.forEach((y, frame) => {
        if (y === null) { drawing = false; return; }
        const px = frame * columnWidth + columnWidth / 2;
        const py = y * height;
        if (drawing) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        drawing = true;
      });
      ctx.stroke();
    }
  }, [data, stack, cohort, emphasis, colourOf, trackedParticles, plotSize]);

  const playhead = useMemo(() => {
    if (currentColumn === null || !data?.frames?.length) return null;
    return (100 * (currentColumn + 0.5)) / data.frames.length;
  }, [data, currentColumn]);

  /** The band under the pointer: a frame, a cluster and how big it was. */
  const readAt = (event) => {
    if (!data?.frames?.length || !stack) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const frame = Math.min(data.frames.length - 1, Math.max(0,
      Math.floor(((event.clientX - rect.left) / rect.width) * data.frames.length)));
    const y = (event.clientY - rect.top) / rect.height;
    const frames = cohort ? cohort.frames : stack.frames;
    for (const [lineage, span] of frames[frame]) {
      if (y >= span.start && y <= span.end) {
        return { frame: data.frames[frame], lineage, size: span.size, colour: colourOf(lineage) };
      }
    }
    return { frame: data.frames[frame], lineage: NOISE, size: 0, colour: null };
  };

  /**
   * A plain click goes to that frame; a modifier click follows that cluster.
   *
   * The same modifier the scene uses to add to a selection, so the gesture means
   * the same in both places. Clicking away from any band clears the pinning.
   */
  const onPlotClick = (event) => {
    const cell = readAt(event);
    if (!cell) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      if (cell.lineage === NOISE) { setPinned(null); return; }
      setPinned((current) => {
        const next = new Set(current ?? []);
        if (next.has(cell.lineage)) next.delete(cell.lineage);
        else next.add(cell.lineage);
        return next.size > 0 ? next : null;
      });
      return;
    }
    goToFrame(cell.frame);
  };

  // What the full height stands for: the cohort when one is being followed,
  // otherwise every particle in the structure.
  const yMax = cohort ? cohort.members.length : (data?.particleCount ?? 0);

  /** Three ticks is enough to read a scale and few enough to stay legible. */
  const yTicks = useMemo(() => {
    if (!yMax) return [];
    return [yMax, Math.round(yMax / 2), 0]
      .filter((v, i, all) => all.indexOf(v) === i);
  }, [yMax]);

  const xTicks = useMemo(() => {
    if (!data?.frames?.length) return [];
    const { frames } = data;
    const picks = [0, Math.floor((frames.length - 1) / 2), frames.length - 1];
    return picks.filter((v, i, all) => all.indexOf(v) === i).map(i => frames[i]);
  }, [data]);

  return (
    <DraggablePanel
      // Clear of the clustering pane where there is room, and inside the window
      // where there is not: DraggablePanel's clamp only promises a reachable
      // corner, so a panel that does not fit is one with its text cut off.
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

          {/*
            Nothing selected, nothing to draw. Showing every cluster invited the
            picture to be read as the whole system's history, which it is not —
            it is one cluster's, and which one has to be chosen first.
          */}
          {!data?.error && data?.columns?.length > 0 && !cohort && (
            <p className="kymograph-note kymograph-empty">
              Select a cluster in the clustering pane to follow it here — the
              picture then shows what became of the particles that made it up.
            </p>
          )}

          {!data?.error && data?.columns?.length > 0 && cohort && (
            <>
              <div className="kymograph-chart">
                <span className="kymograph-axis-title kymograph-axis-y">Particles</span>
                <div className="kymograph-ticks kymograph-ticks-y">
                  {yTicks.map(value => (
                    <span className="num" key={value}>{value}</span>
                  ))}
                </div>
                <div
                className="kymograph-plot"
                ref={plotRef}
                onClick={onPlotClick}
                onMouseMove={(e) => setHover(readAt(e))}
                onMouseLeave={() => setHover(null)}
                role="presentation"
              >
                <canvas ref={canvasRef} className="kymograph-canvas" />
                {playhead !== null && (
                  <span className="kymograph-playhead" style={{ left: `${playhead}%` }} />
                )}
                </div>
                <div className="kymograph-ticks kymograph-ticks-x">
                  {xTicks.map(frame => (
                    <span className="num" key={frame}>{frame}</span>
                  ))}
                </div>
                <span className="kymograph-axis-title kymograph-axis-x">Frame</span>
              </div>

              <div className="kymograph-readout">
                {hover && hover.lineage !== NOISE ? (
                  <>
                    <span>
                      <span className="kymograph-swatch" style={{ background: hover.colour }} />
                      cluster {hover.lineage}
                    </span>
                    <span className="num">
                      {hover.size} {cohort ? 'of the followed particles' : 'particles'}
                    </span>
                    <span className="num">frame {hover.frame}</span>
                  </>
                ) : hover && cohort ? (
                  <span className="num">
                    {hover.size} of the followed particles are in no cluster at frame {hover.frame}
                  </span>
                ) : (
                  <span>
                    {cohort
                      ? `Following ${cohort.members.length} particles. Each band is where some of them are now.`
                      : 'Point at a band to read off a cluster, or follow one to see where its particles go.'}
                  </span>
                )}
              </div>

              <p className="kymograph-note">
                {cohort ? (
                  <>
                    Following the {cohort.members.length} particles that made up
                    the selected cluster. The height is fixed — it is those
                    particles — and each band is how many of them are in a given
                    cluster at that frame, in that cluster&rsquo;s colour, with grey
                    for the ones in no cluster. Staying together is one solid
                    block; splitting apart fans out.
                  </>
                ) : (
                  <>
                    Each band is one cluster and its height is how many particles
                    it holds, so a band that thickens is a cluster growing and two
                    bands becoming one is a merge. Clusters are matched between
                    frames by the particles they share, and keep their colour —
                    the same colour the pane and the scene give them.
                  </>
                )}
              </p>
              <p className="kymograph-note">
                Click to go to a frame, or hold Ctrl/Cmd on a band to follow that
                cluster{cohort ? ' — again to stop' : ''}. Particles selected in
                the scene are drawn as a white line through the bands they belong
                to.
              </p>

              <button className="select-button" onClick={onRecompute} disabled={running}>
                {running ? 'Working…' : 'Recompute with the current settings'}
              </button>
            </>
          )}

          {!data && (
            <button className="select-button" onClick={onRecompute} disabled={running}>
              {running ? 'Working…' : 'Recompute with the current settings'}
            </button>
          )}
        </div>
      </div>
    </DraggablePanel>
  );
}

export default ClusterKymograph;

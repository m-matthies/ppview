import React from 'react';
import ColorSchemeSelector from '../ColorSchemeSelector';
import {
  PlayIcon, PauseIcon, ResetIcon, SpeedIcon, TagIcon, CircleIcon,
  LayersIcon, ChartIcon, CameraIcon, DownloadIcon, BoxIcon, RulerIcon,
  ChevronUpIcon, ChevronDownIcon, CloseIcon, AxisIcon, LightbulbIcon,
  StepBackIcon, StepForwardIcon, ActivityIcon,
} from '../Icons';

/**
 * The floating control bar: transport and readout, the scrubber, then display
 * options grouped by what they affect.
 *
 * Purely presentational — every piece of state and every handler arrives as a
 * prop, which is what lets App stay a coordinator rather than a 1000-line file.
 */

// A toggle states what it controls and whether it is on, for both sighted and
// assistive users — the icon alone carries neither.
const ToggleBtn = ({ checked, onChange, icon, label, shortcut }) => (
  <button
    className={`toggle-btn ${checked ? 'is-active' : ''}`}
    onClick={() => onChange(!checked)}
    title={shortcut ? `${label} (${shortcut})` : label}
    aria-pressed={checked}
    aria-label={label}
  >
    {icon}
  </button>
);

const ToolBtn = ({ onClick, icon, label, active }) => (
  <button
    className={`toggle-btn ${active ? 'is-active' : ''}`}
    onClick={onClick}
    title={label}
    aria-label={label}
  >
    {icon}
  </button>
);

// Trajectory times run to 1e9; full digits are unreadable and shift the row
// width every frame.
const formatTime = (time) => {
  if (typeof time !== 'number' || !Number.isFinite(time)) return String(time ?? '--');
  if (time === 0) return '0';
  return Math.abs(time) >= 1e6 ? time.toExponential(2) : time.toLocaleString();
};

const formatEnergy = (energy) => {
  const value = Array.isArray(energy) ? energy[0] : energy;
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return null;
  return value.toFixed(4);
};

function ControlBar(props) {
  const {
    isControlsVisible, setIsControlsVisible,
    isPlaying, togglePlayback, resetTrajectory, stepFrame,
    currentConfigIndex, totalConfigs, currentTime, currentEnergy,
    playbackSpeed, setPlaybackSpeed, isSpeedPopupVisible, setIsSpeedPopupVisible, speedPopupRef,
    handleSliderChange,
    showSimulationBox, setShowSimulationBox,
    showCoordinateAxis, setShowCoordinateAxis,
    showBackdropPlanes, setShowBackdropPlanes,
    showParticleLegend, setShowParticleLegend,
    showPatchLegend, setShowPatchLegend,
    showClusteringPane, setShowClusteringPane,
    showStats, setShowStats,
    isLightingControlsModalOpen, setIsLightingControlsModalOpen,
    sphereSegments, setSphereSegments,
    particleRadius, handleRadiusChange,
    takeScreenshot, exportGLTF,
  } = props;

  const energyReadout = formatEnergy(currentEnergy);
  const hasTrajectory = totalConfigs > 1;

  return (
    <div className={`controls-wrapper ${isControlsVisible ? 'is-open' : 'is-collapsed'}`}>
      {!isControlsVisible && (
        <button className="show-controls-btn" onClick={() => setIsControlsVisible(true)}>
          <ChevronUpIcon size={16} />
          <span>Controls</span>
        </button>
      )}

      {isControlsVisible && (
        <div className="controls-panel pp-panel">

          {/* Row 1 — transport and readout. What frame am I on, and how do
              I get to another one. */}
          <div className="transport-row">
            <div className="control-cluster">
              <button className="icon-btn" onClick={resetTrajectory} title="Back to first frame (Home)" aria-label="Back to first frame">
                <ResetIcon size={18} />
              </button>
              <button
                className="icon-btn"
                onClick={() => stepFrame(-1)}
                disabled={!hasTrajectory || currentConfigIndex === 0}
                title="Previous frame (Left arrow, Shift for 10)"
                aria-label="Previous frame"
              >
                <StepBackIcon size={18} />
              </button>
              <button
                className="icon-btn is-primary"
                onClick={togglePlayback}
                disabled={!hasTrajectory}
                title={isPlaying ? "Pause (Space)" : "Play (Space)"}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
              </button>
              <button
                className="icon-btn"
                onClick={() => stepFrame(1)}
                disabled={!hasTrajectory || currentConfigIndex >= totalConfigs - 1}
                title="Next frame (Right arrow, Shift for 10)"
                aria-label="Next frame"
              >
                <StepForwardIcon size={18} />
              </button>

              <div className="speed-control-wrapper">
                <button
                  className="icon-btn is-wide"
                  onClick={() => setIsSpeedPopupVisible(!isSpeedPopupVisible)}
                  title="Playback speed"
                  aria-expanded={isSpeedPopupVisible}
                >
                  <SpeedIcon size={16} />
                  <span className="num">{(1000 / playbackSpeed).toFixed(1)}/s</span>
                </button>
                {isSpeedPopupVisible && (
                  <div className="popover" ref={speedPopupRef}>
                    <div className="popover-head">
                      <span>Playback speed</span>
                      <button className="icon-button" onClick={() => setIsSpeedPopupVisible(false)} aria-label="Close">
                        <CloseIcon size={14} />
                      </button>
                    </div>
                    <input
                      type="range"
                      min="50" max="2000" step="50"
                      /* Inverted: dragging right should feel faster. */
                      value={2050 - playbackSpeed}
                      onChange={(e) => setPlaybackSpeed(2050 - parseInt(e.target.value, 10))}
                    />
                    <div className="popover-value num">{(1000 / playbackSpeed).toFixed(1)} frames/s</div>
                  </div>
                )}
              </div>
            </div>

            <div className="readout">
              <span className="readout-item">
                <span className="readout-key">Frame</span>
                <span className="num readout-val">{currentConfigIndex + 1}<span className="readout-total">/{totalConfigs}</span></span>
              </span>
              <span className="readout-item">
                <span className="readout-key">Time</span>
                <span className="num readout-val">{formatTime(currentTime)}</span>
              </span>
              {energyReadout && (
                <span className="readout-item">
                  <span className="readout-key">Energy</span>
                  <span className="num readout-val">{energyReadout}</span>
                </span>
              )}
            </div>

            <div className="actions-cluster">
              <button className="action-btn" onClick={takeScreenshot} title="Save a PNG of the current view (P)">
                <CameraIcon size={15} />
                <span>Screenshot</span>
              </button>
              <button className="action-btn" onClick={exportGLTF} title="Save the scene as a GLTF model">
                <DownloadIcon size={15} />
                <span>Export GLTF</span>
              </button>
            </div>

            <button
              className="icon-btn is-quiet"
              onClick={() => setIsControlsVisible(false)}
              title="Hide controls"
              aria-label="Hide controls"
            >
              <ChevronDownIcon size={18} />
            </button>
          </div>

          {/* Row 2 — the scrubber. The control this app exists to offer. */}
          <div className="scrub-row">
            <input
              type="range"
              className="scrubber"
              min="0"
              max={Math.max(totalConfigs - 1, 0)}
              value={currentConfigIndex}
              onChange={handleSliderChange}
              disabled={!hasTrajectory}
              aria-label="Trajectory frame"
              aria-valuetext={`Frame ${currentConfigIndex + 1} of ${totalConfigs}`}
              style={{ '--progress': `${totalConfigs > 1 ? (currentConfigIndex / (totalConfigs - 1)) * 100 : 0}%` }}
            />
          </div>

          {/* Row 3 — display options, grouped by what they affect rather
              than by the order they were added. */}
          <div className="options-row">
            <div className="toggle-groups">
              <div className="toggle-group" role="group" aria-label="Scene">
                <ToggleBtn checked={showSimulationBox} onChange={setShowSimulationBox} icon={<BoxIcon size={17} />} label="Simulation box" />
                <ToggleBtn checked={showCoordinateAxis} onChange={setShowCoordinateAxis} icon={<AxisIcon size={17} />} label="Coordinate axes" />
                <ToggleBtn checked={showBackdropPlanes} onChange={setShowBackdropPlanes} icon={<LayersIcon size={17} />} label="Backdrop planes" />
              </div>

              <div className="toggle-group" role="group" aria-label="Legends">
                <ToggleBtn checked={showParticleLegend} onChange={setShowParticleLegend} icon={<CircleIcon size={17} />} label="Particle legend" />
                <ToggleBtn checked={showPatchLegend} onChange={setShowPatchLegend} icon={<TagIcon size={17} />} label="Patch legend" />
              </div>

              <div className="toggle-group" role="group" aria-label="Tools">
                <ToggleBtn checked={showClusteringPane} onChange={setShowClusteringPane} icon={<ChartIcon size={17} />} label="Clustering" />
                <ToolBtn
                  onClick={() => setIsLightingControlsModalOpen(!isLightingControlsModalOpen)}
                  active={isLightingControlsModalOpen}
                  icon={<LightbulbIcon size={17} />}
                  label="Lighting"
                />
                <ToggleBtn checked={showStats} onChange={setShowStats} icon={<ActivityIcon size={17} />} label="Frame rate" />
              </div>
            </div>

            <div className="settings-cluster">
              <ColorSchemeSelector />

              <label className="field" title="Geometry resolution for spheres, patch cones and spring cylinders">
                <span className="field-label">Detail</span>
                <select value={sphereSegments} onChange={(e) => setSphereSegments(parseInt(e.target.value, 10))}>
                  <option value={8}>Low</option>
                  <option value={16}>Medium</option>
                  <option value={24}>High</option>
                  <option value={32}>Ultra</option>
                </select>
              </label>

              <label className="field" title="Particle radius in simulation units. Scales beads, patches, springs and nucleotides with it.">
                <span className="field-label"><RulerIcon size={13} /> Radius</span>
                <input
                  className="num"
                  type="number"
                  min="0.05" max="5" step="0.05"
                  value={particleRadius}
                  onChange={(e) => handleRadiusChange(parseFloat(e.target.value))}
                />
              </label>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

export default ControlBar;

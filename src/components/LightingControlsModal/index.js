import React, { useState, useEffect, useCallback } from 'react';
import { CloseIcon, ResetIcon } from '../Icons';
import { useUIStore } from '../../store/uiStore';
import {
  lightingPresets,
  saveLightingPreset,
  isDarkBackground,
  LIGHT_BACKGROUND,
  DARK_BACKGROUND,
} from '../../lighting';
import DraggablePanel from '../DraggablePanel';
import './LightingControlsModal.css';

// One row: label, slider, live value. The value is monospaced and fixed-width
// so dragging a slider never reflows the row.
function Slider({ label, value, min, max, step, decimals = 2, onChange }) {
  return (
    <label className="ctl-row">
      <span className="ctl-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="ctl-value num">{Number(value).toFixed(decimals)}</span>
    </label>
  );
}

function VectorInput({ label, value, onChange }) {
  return (
    <div className="ctl-vector">
      <span className="ctl-label">{label}</span>
      <div className="ctl-axes">
        {['x', 'y', 'z'].map((axis, index) => (
          <label key={axis} className="ctl-axis">
            <span className="ctl-axis-name">{axis}</span>
            <input
              className="num"
              type="number"
              step="1"
              value={value[index]}
              onChange={(e) => {
                const next = [...value];
                next[index] = parseFloat(e.target.value) || 0;
                onChange(next);
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

// Each directional light is the same three controls, so describe them once.
// All three are neutral white: a tinted light would shift every particle colour
// in the scene, and those colours carry meaning.
const DIRECTIONAL_LIGHTS = [
  { key: 'keyLight', title: 'Key light', hint: 'Main source, and the only one that casts shadows.', max: 3, step: 0.1, decimals: 1 },
  { key: 'fillLight', title: 'Fill light', hint: 'Opens up the side the key light leaves dark.', max: 2, step: 0.1, decimals: 1 },
  { key: 'rimLight', title: 'Rim light', hint: 'Separates the structure from the background behind it.', max: 1, step: 0.05, decimals: 2 },
];

function LightingControlsModal({ isOpen, onClose }) {
  const {
    currentLightingPreset,
    setCurrentLightingPreset,
    lightingSettings,
    setLightingSettings,
    resetLighting,
    sceneBackground,
    setSceneBackground,
  } = useUIStore();

  const [settings, setSettings] = useState(lightingSettings);

  useEffect(() => {
    if (isOpen) setSettings(lightingSettings);
  }, [isOpen, lightingSettings]);

  const applyPreset = useCallback((presetName) => {
    const preset = lightingPresets[presetName];
    setCurrentLightingPreset(presetName);
    setLightingSettings(preset);
    setSettings(preset);
    saveLightingPreset(presetName);
  }, [setCurrentLightingPreset, setLightingSettings]);

  const change = useCallback((key, value) => {
    setSettings((previous) => {
      const next = { ...previous, [key]: value };
      setLightingSettings(next);
      return next;
    });
    // Editing a value means the scene no longer matches any named preset.
    setCurrentLightingPreset('custom');
  }, [setCurrentLightingPreset, setLightingSettings]);

  if (!isOpen) return null;

  const isCustom = currentLightingPreset === 'custom';

  return (
    <DraggablePanel initialX={20} initialY={20} className="pp-panel lighting-panel" storageId="lighting">
      <header className="panel-header drag-handle" tabIndex={0}>
        <h2 className="panel-title">Lighting</h2>
        <div className="panel-header-actions">
          <button
            className="icon-button"
            onClick={resetLighting}
            title="Reset lighting to the default preset"
          >
            <ResetIcon size={15} />
          </button>
          <button className="icon-button" onClick={onClose} title="Close lighting">
            <CloseIcon size={16} />
          </button>
        </div>
      </header>

      <div className="panel-body">
        <section className="panel-section">
          <div className="preset-row">
            {Object.entries(lightingPresets).map(([key, preset]) => (
              <button
                key={key}
                className={`preset-chip ${currentLightingPreset === key ? 'is-active' : ''}`}
                onClick={() => applyPreset(key)}
                title={preset.description}
              >
                {preset.name}
              </button>
            ))}
            {isCustom && <span className="preset-chip is-custom">Custom</span>}
          </div>
        </section>

        {/* Background sits above the light rig because it is the choice people
            change most, and it is not part of a preset. */}
        <section className="panel-section">
          <h3 className="pp-heading">Background</h3>
          <div className="bg-row">
            <div className="bg-choices">
              <button
                className={`bg-swatch ${!isDarkBackground(sceneBackground) ? 'is-active' : ''}`}
                style={{ background: LIGHT_BACKGROUND }}
                onClick={() => setSceneBackground(LIGHT_BACKGROUND)}
                title="Light background"
                aria-label="Light background"
              />
              <button
                className={`bg-swatch ${isDarkBackground(sceneBackground) ? 'is-active' : ''}`}
                style={{ background: DARK_BACKGROUND }}
                onClick={() => setSceneBackground(DARK_BACKGROUND)}
                title="Dark background"
                aria-label="Dark background"
              />
            </div>
            <label className="bg-custom">
              <span className="ctl-label">Custom</span>
              <input
                type="color"
                value={sceneBackground}
                onChange={(e) => setSceneBackground(e.target.value)}
                title="Pick a background color"
              />
            </label>
          </div>
        </section>

        <section className="panel-section">
          <h3 className="pp-heading">Ambient</h3>
          <Slider label="Ambient" value={settings.ambientIntensity} min={0} max={1} step={0.05}
            onChange={(v) => change('ambientIntensity', v)} />
          <Slider label="Hemisphere" value={settings.hemisphereIntensity} min={0} max={1} step={0.05}
            onChange={(v) => change('hemisphereIntensity', v)} />
          <div className="ctl-row ctl-colors">
            <span className="ctl-label">Sky / ground</span>
            <div className="swatch-pair">
              <input type="color" value={settings.hemisphereSkyColor}
                onChange={(e) => change('hemisphereSkyColor', e.target.value)} title="Sky color" />
              <input type="color" value={settings.hemisphereGroundColor}
                onChange={(e) => change('hemisphereGroundColor', e.target.value)} title="Ground color" />
            </div>
          </div>
        </section>

        {DIRECTIONAL_LIGHTS.map((light) => (
          <section className="panel-section" key={light.key}>
            <h3 className="pp-heading">{light.title}</h3>
            <p className="section-hint">{light.hint}</p>
            <Slider
              label="Intensity"
              value={settings[`${light.key}Intensity`]}
              min={0}
              max={light.max}
              step={light.step}
              decimals={light.decimals}
              onChange={(v) => change(`${light.key}Intensity`, v)}
            />
            <VectorInput
              label="Position"
              value={settings[`${light.key}Position`]}
              onChange={(v) => change(`${light.key}Position`, v)}
            />
          </section>
        ))}

        <section className="panel-section">
          <h3 className="pp-heading">Shadow fill</h3>
          <p className="section-hint">Lifts shadow interiors from below so dense structures stay readable.</p>
          <Slider label="Bottom fill" value={settings.bottomFillIntensity} min={0} max={1} step={0.05}
            onChange={(v) => change('bottomFillIntensity', v)} />
        </section>

        <section className="panel-section">
          <h3 className="pp-heading">Environment and occlusion</h3>
          <Slider label="Environment" value={settings.environmentIntensity} min={0} max={1} step={0.05}
            onChange={(v) => change('environmentIntensity', v)} />

          <label className="ctl-check">
            <input
              type="checkbox"
              checked={settings.ssaoEnabled}
              onChange={(e) => change('ssaoEnabled', e.target.checked)}
            />
            <span>Ambient occlusion</span>
          </label>

          {settings.ssaoEnabled && (
            <Slider label="Occlusion strength" value={settings.ssaoIntensity} min={0} max={30} step={1}
              decimals={0} onChange={(v) => change('ssaoIntensity', v)} />
          )}
        </section>
      </div>
    </DraggablePanel>
  );
}

export default LightingControlsModal;

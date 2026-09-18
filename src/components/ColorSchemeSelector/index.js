import React, { useState, useRef, useEffect } from 'react';
import { colorSchemes, saveColorScheme, getParticleColors } from '../../colors';
import { useParticleStore } from '../../store/particleStore';
import { useUIStore } from '../../store/uiStore';
import './ColorSchemeSelector.css';

function ColorPreview({ schemeName, count }) {
  // Always draw five swatches. With one particle type a single dot reads as a
  // rendering fault rather than a palette, and the preview is about the scheme.
  const colors = getParticleColors(schemeName, Math.max(count, 5));
  return (
    <span className="color-preview">
      {colors.slice(0, 5).map((color, index) => (
        <span key={index} className="color-dot" style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

function ColorSchemeSelector() {
  const getUniqueParticleTypes = useParticleStore(state => state.getUniqueParticleTypes);
  const { currentColorScheme, setCurrentColorScheme } = useUIStore();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);

  const particleTypeCount = getUniqueParticleTypes().size || 10;

  // Close on an outside click or Escape, like every other menu on the page.
  useEffect(() => {
    if (!isOpen) return;
    const handlePointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setIsOpen(false);
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const choose = (schemeName) => {
    setCurrentColorScheme(schemeName);
    saveColorScheme(schemeName);
    setIsOpen(false);
  };

  return (
    <div className="color-scheme-selector" ref={rootRef}>
      <span className="field-label">Color</span>
      <button
        className="scheme-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title="Particle color scheme"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <ColorPreview schemeName={currentColorScheme} count={particleTypeCount} />
        <span className="scheme-name">{colorSchemes[currentColorScheme]?.name || 'Unknown'}</span>
      </button>

      {isOpen && (
        /* Opens upward: this control lives in a bar pinned to the bottom of
           the viewport, so a downward menu would be off-screen. */
        <div className="scheme-menu" role="listbox">
          {Object.entries(colorSchemes).map(([key, scheme]) => (
            <button
              key={key}
              className={`scheme-option ${currentColorScheme === key ? 'is-selected' : ''}`}
              onClick={() => choose(key)}
              role="option"
              aria-selected={currentColorScheme === key}
            >
              <ColorPreview schemeName={key} count={particleTypeCount} />
              <span className="scheme-name">{scheme.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ColorSchemeSelector;

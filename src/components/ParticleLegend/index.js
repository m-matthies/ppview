import React from 'react';
import { getParticleColors } from '../../colors';
import { useParticleStore } from '../../store/particleStore';
import { useUIStore } from '../../store/uiStore';

function ParticleLegend() {
  const topData = useParticleStore(state => state.topData);
  const currentColorScheme = useUIStore(state => state.currentColorScheme);
  
  if (!topData || !topData.particleTypes) return null;
  
  const particleTypes = topData.particleTypes;
  const particleColors = getParticleColors(currentColorScheme);
  
  return (
    <div className="particle-legend">
      <h3>Particle Color Legend</h3>
      <ul>
        {particleTypes.map((type, index) => {
          // Use MGL color if available, otherwise fall back to ppview color scheme
          let displayColor;
          let colorSource = '';
          
          if (type.mglColor) {
            // Convert MGL color to CSS format
            const r = Math.round(type.mglColor.r * 255);
            const g = Math.round(type.mglColor.g * 255);
            const b = Math.round(type.mglColor.b * 255);
            displayColor = `rgb(${r}, ${g}, ${b})`;
            colorSource = ' (MGL)';
          } else {
            // Use ppview color scheme
            displayColor = particleColors[type.typeIndex % particleColors.length];
            colorSource = ' (ppview)';
          }
          
          return (
            <li key={index}>
              <span
                className="color-box"
                style={{
                  backgroundColor: displayColor,
                }}
              ></span>
              Particle Type {type.typeIndex}{colorSource}
              {type.count && ` (${type.count} particles)`}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default ParticleLegend;
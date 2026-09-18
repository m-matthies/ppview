import React from "react";
import { useParticleStore } from "../store/particleStore";
import { useUIStore } from "../store/uiStore";
import DraggablePanel from "./DraggablePanel";
import { CloseIcon } from "./Icons";

function SelectedParticlesDisplay() {
  const positions = useParticleStore(state => state.positions);
  const topData = useParticleStore(state => state.topData);
  const selectedParticles = useUIStore(state => state.selectedParticles);
  const setSelectedParticles = useUIStore(state => state.setSelectedParticles);
  
  if (!selectedParticles || !Array.isArray(selectedParticles) || selectedParticles.length === 0) return null;
  // Helper function to get particle information
  const getParticleInfo = (particleIndex) => {
    if (!positions || !positions[particleIndex] || !topData) {
      return null;
    }

    const particle = positions[particleIndex];
    const particleType = particle.particleType;
    
    return {
      index: particleIndex,
      position: {
        x: particle.x?.toFixed(3) || 'N/A',
        y: particle.y?.toFixed(3) || 'N/A',
        z: particle.z?.toFixed(3) || 'N/A'
      },
      typeIndex: particle.typeIndex,
      typeInfo: particleType ? {
        count: particleType.count,
        patchCount: particleType.patches?.length || 0,
        patches: particleType.patches || [],
        patchPositions: particleType.patchPositions || []
      } : null,
      orientation: particle.a1 && particle.a3 ? {
        a1: {
          x: particle.a1.x?.toFixed(3) || 'N/A',
          y: particle.a1.y?.toFixed(3) || 'N/A',
          z: particle.a1.z?.toFixed(3) || 'N/A'
        },
        a3: {
          x: particle.a3.x?.toFixed(3) || 'N/A',
          y: particle.a3.y?.toFixed(3) || 'N/A',
          z: particle.a3.z?.toFixed(3) || 'N/A'
        }
      } : null,
      hasMGLColor: particle.hasMGLColor || false,
      mglColor: particle.mglColor ? {
        r: (particle.mglColor.r * 255).toFixed(0),
        g: (particle.mglColor.g * 255).toFixed(0),
        b: (particle.mglColor.b * 255).toFixed(0)
      } : null
    };
  };

  return (
    <DraggablePanel initialX={20} initialY={100} className="selected-particles-display" storageId="selection">
      <h3 className="drag-handle" tabIndex={0}>
        <span>Selected particles ({selectedParticles.length})</span>
        <button
          className="icon-button"
          onClick={() => setSelectedParticles([])}
          title="Clear selection"
          aria-label="Clear selection"
        >
          <CloseIcon size={15} />
        </button>
      </h3>
      <div className="selected-particles-list">
        {selectedParticles.map((particleIndex) => {
          const info = getParticleInfo(particleIndex);
          
          if (!info) {
            return (
              <div key={particleIndex} className="particle-info-card">
                <div className="particle-header">
                  <strong>Particle {particleIndex}</strong>
                  <span className="error">Information not available</span>
                </div>
              </div>
            );
          }

          return (
            <div key={particleIndex} className="particle-info-card">
              <div className="particle-header">
                <strong>Particle {info.index}</strong>
                <span className="particle-type">Type {info.typeIndex}</span>
              </div>
              
              <div className="particle-details">
                <div className="info-section">
                  <h4>Position</h4>
                  <div className="coordinate-info">
                    <span>x: {info.position.x}</span>
                    <span>y: {info.position.y}</span>
                    <span>z: {info.position.z}</span>
                  </div>
                </div>
                
                {info.orientation && (
                  <div className="info-section">
                    <h4>Orientation</h4>
                    <div className="orientation-info">
                      <div className="vector-info">
                        <strong>a1:</strong> ({info.orientation.a1.x}, {info.orientation.a1.y}, {info.orientation.a1.z})
                      </div>
                      <div className="vector-info">
                        <strong>a3:</strong> ({info.orientation.a3.x}, {info.orientation.a3.y}, {info.orientation.a3.z})
                      </div>
                    </div>
                  </div>
                )}
                
                {info.typeInfo && (
                  <div className="info-section">
                    <h4>Type Information</h4>
                    <div className="type-info">
                      <div className="type-stat">
                        <strong>Total particles of this type:</strong> {info.typeInfo.count}
                      </div>
                      <div className="type-stat">
                        <strong>Number of patches:</strong> {info.typeInfo.patchCount}
                      </div>
                      
                      {info.typeInfo.patchCount > 0 && (
                        <div className="patch-details">
                          <h5>Patch Information</h5>
                          <div className="patch-list">
                            {info.typeInfo.patches.map((patchId, index) => {
                              const patchPos = info.typeInfo.patchPositions[index];
                              return (
                                <div key={`${patchId}-${index}`} className="patch-item">
                                  <div className="patch-header">
                                    <strong>Patch {patchId}</strong>
                                  </div>
                                  {patchPos && (
                                    <div className="patch-position">
                                      <span>Position: ({patchPos.x?.toFixed(3) || 'N/A'}, {patchPos.y?.toFixed(3) || 'N/A'}, {patchPos.z?.toFixed(3) || 'N/A'})</span>
                                      {patchPos.color !== undefined && (
                                        <span>Color: {patchPos.color}</span>
                                      )}
                                      {patchPos.a1 && (
                                        <span>a1: ({patchPos.a1.x?.toFixed(3)}, {patchPos.a1.y?.toFixed(3)}, {patchPos.a1.z?.toFixed(3)})</span>
                                      )}
                                      {patchPos.a2 && (
                                        <span>a2: ({patchPos.a2.x?.toFixed(3)}, {patchPos.a2.y?.toFixed(3)}, {patchPos.a2.z?.toFixed(3)})</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {info.hasMGLColor && info.mglColor && (
                  <div className="info-section">
                    <h4>MGL Color</h4>
                    <div className="mgl-color-info">
                      <div className="color-preview" style={{
                        backgroundColor: `rgb(${info.mglColor.r}, ${info.mglColor.g}, ${info.mglColor.b})`,
                        width: '20px',
                        height: '20px',
                        border: '1px solid #ccc',
                        display: 'inline-block',
                        marginRight: '8px'
                      }}></div>
                      <span>RGB({info.mglColor.r}, {info.mglColor.g}, {info.mglColor.b})</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </DraggablePanel>
  );
}

export default SelectedParticlesDisplay;

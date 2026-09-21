import React from 'react';

/**
 * The two DBSCAN knobs, disabled while a file supplies the clusters — they
 * cannot change clusters that came from somewhere else.
 *
 * Epsilon stops at half the shortest box dimension: past that the minimum image
 * convention stops being meaningful, because a particle comes back into range as
 * its own neighbour from the other side.
 */
function ClusterParameters({ epsilon, onEpsilonChange, epsilonLimit, minPoints, onMinPointsChange, disabled }) {
  return (
  <div className={`clustering-controls ${disabled ? 'is-disabled' : ''}`}>
    <div className="parameter-control">
      <label htmlFor="epsilon-slider">
        Epsilon Distance: {Math.min(epsilon, epsilonLimit).toFixed(2)}
        {epsilonLimit < 10 && <span className="checkbox-hint"> · max {epsilonLimit.toFixed(1)} (half box)</span>}
      </label>
      <input
        id="epsilon-slider"
        type="range"
        min="0.5"
        max={Math.min(10, epsilonLimit)}
        step="0.1"
        value={epsilon}
        onChange={(e) => onEpsilonChange(parseFloat(e.target.value))}
        className="parameter-slider"
      />
    </div>

    <div className="parameter-control">
      <label htmlFor="minpoints-slider">
        Min Points: {minPoints}
      </label>
      <input
        id="minpoints-slider"
        type="range"
        min="2"
        max="20"
        step="1"
        value={minPoints}
        onChange={(e) => onMinPointsChange(parseInt(e.target.value, 10))}
        className="parameter-slider"
      />
    </div>
  </div>
  );
}

export default React.memo(ClusterParameters);

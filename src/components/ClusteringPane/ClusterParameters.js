import React from 'react';

/**
 * The two DBSCAN knobs, disabled while a file supplies the clusters — they
 * cannot change clusters that came from somewhere else.
 *
 * Epsilon stops at half the shortest box dimension: past that the minimum image
 * convention stops being meaningful, because a particle comes back into range as
 * its own neighbour from the other side.
 */
function ClusterParameters({
  epsilon, onEpsilonChange, epsilonLimit, minPoints, onMinPointsChange,
  minClusterSize, onMinClusterSizeChange, disabled,
}) {
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
        Neighbours needed: {minPoints}
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
      {/*
        Named for what it does, because "Min Points" reads as a minimum cluster
        size and is not one: it is how many particles have to be within epsilon
        of a particle for it to count as dense. A loose group of twelve where
        each particle sees only two others disappears at three neighbours; a
        tight group of twelve survives to twelve. Raising this dissolving a
        cluster far larger than the number is correct, and surprising enough to
        be worth saying on screen.
      */}
      <span className="checkbox-hint">
        How many particles must lie within the epsilon distance of a particle —
        counting itself — for it to be dense enough to build a cluster around.
        This is a density, not a minimum cluster size: raising it can pull a
        cluster apart at a thin waist. To hide small clusters without
        disturbing the others, use the size below.
      </span>
    </div>

    <div className="parameter-control">
      <label htmlFor="minsize-slider">
        Smallest cluster to keep: {minClusterSize === 1 ? 'all' : minClusterSize}
      </label>
      <input
        id="minsize-slider"
        type="range"
        min="1"
        max="50"
        step="1"
        value={minClusterSize}
        onChange={(e) => onMinClusterSizeChange(parseInt(e.target.value, 10))}
        className="parameter-slider"
      />
      {/*
        The question people reach for "neighbours needed" to ask, and it is a
        different one: that is a density threshold, so raising it stops
        particles being core points and a cluster held together through a thin
        waist comes apart. Reported as DBSCAN failing, and it is not — but
        nothing in the controls said the two were different questions. This one
        runs after the clustering, so it can only ever remove whole clusters.
      */}
      <span className="checkbox-hint">
        Clusters smaller than this are discarded. Applied after the clustering,
        so raising it never breaks a cluster apart — it only stops small ones
        being shown.
      </span>
    </div>
  </div>
  );
}

export default React.memo(ClusterParameters);

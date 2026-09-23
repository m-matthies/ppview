import React from 'react';
import RangeSlider from './RangeSlider';

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
  minClusterSize, maxClusterSize, largestCluster, onClusterSizeRangeChange, disabled,
}) {
  // The upper bound is open until someone moves it, so it is shown at the
  // largest cluster there is rather than at Infinity.
  const ceiling = Math.max(1, largestCluster);
  const high = Number.isFinite(maxClusterSize) ? Math.min(maxClusterSize, ceiling) : ceiling;
  const low = Math.min(minClusterSize, high);
  const keepsEverything = low <= 1 && high >= ceiling;
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
        Cluster sizes kept: {keepsEverything ? 'all' : `${low} to ${high}`}
      </label>
      <RangeSlider
        id="minsize-slider"
        min={1}
        max={ceiling}
        low={low}
        high={high}
        disabled={disabled}
        onChange={(nextLow, nextHigh) =>
          // An upper bound sitting at the largest cluster means "no upper
          // bound", so it keeps working as clusters grow.
          onClusterSizeRangeChange(nextLow, nextHigh >= ceiling ? Infinity : nextHigh)}
      />
      {/*
        A band, not a floor. "Everything above N" is only half of what gets
        asked — isolating the mid-sized clusters, or looking at just the
        stragglers, needs an upper end too.

        And this is the question people reach for "neighbours needed" to ask,
        which is a different one: that is a density threshold, so raising it
        stops particles being core points and a cluster held together through a
        thin waist comes apart. This runs after the clustering, so it can only
        ever remove whole clusters.
      */}
      <span className="checkbox-hint">
        Only clusters in this size range are shown. Applied after the clustering,
        so moving either end never breaks a cluster apart — it only changes which
        ones are listed, counted and drawn.
      </span>
    </div>
  </div>
  );
}

export default React.memo(ClusterParameters);

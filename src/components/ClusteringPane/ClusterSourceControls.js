import React from 'react';

/**
 * Choosing which cluster set the pane works with, and loading one from a file.
 *
 * The **Clusters** selector and the control bar's **View** are deliberately
 * independent: one picks what to group by, the other what colours the scene.
 * Tying them together meant choosing "Particle type" also threw away the
 * grouping, so there was no way to cluster by a file while colouring by type.
 * Two dropdowns in different panels interacting is not self-evident, which is
 * what the note below is for.
 */
function ClusterSourceControls({
  clusterSourceId, clusterOverlays, onSourceChange, onLoadFile,
  fileInputRef, onFileChosen, fileError, fileWarnings,
  hasClusters, colorByCluster, groupingName,
  observableLabel, observableFrame, observableFrames,
}) {
  // Clusters computed elsewhere can be loaded instead of running DBSCAN.
  return (
  <div className="cluster-source">
    <input
      ref={fileInputRef}
      type="file"
      accept=".json,.txt,.dat,.out,application/json,text/plain"
      style={{ display: 'none' }}
      onChange={onFileChosen}
    />

    <label className="field">
      <span className="field-label">Clusters</span>
      <select
        value={clusterSourceId ?? ''}
        onChange={(e) => onSourceChange(e.target.value || null)}
      >
        <option value="">Computed (DBSCAN)</option>
        {clusterOverlays.map(overlay => (
          <option key={overlay.id} value={overlay.id}>{overlay.name}</option>
        ))}
      </select>
    </label>

    {/* Either a clusters.json or the output of one of the patchy cluster/bond
        observables; which it is comes from the content, not the extension. */}
    <button className="select-button" onClick={onLoadFile}>
      Load clusters or bonds from file
    </button>

    {/* An observable's clusters are a property of the frame on screen, not of
        the file as a whole, and nothing else in the pane says so. */}
    {observableLabel && (
      <p className="cluster-source-note">
        <strong>{observableLabel}</strong>: clusters and bonds for frame{' '}
        <span className="num">{observableFrame + 1}</span> of{' '}
        <span className="num">{observableFrames}</span>. They change as the
        trajectory plays.
      </p>
    )}

    {/* The grouping above and the colours in the scene are separate
        choices, and that is not obvious, so say it where it matters. */}
    {/* The computed clusters are a grouping like any other, so they get the
        same explanation. Gating this on a loaded file meant the commonest
        case — a plain DBSCAN run — was the one left unexplained. */}
    {hasClusters && !colorByCluster && (
      <p className="cluster-source-note">
        Grouping by <strong>{groupingName}</strong>, coloured by particle type.
        Switch the View to <strong>{groupingName}</strong> to colour by cluster.
      </p>
    )}
    {hasClusters && colorByCluster && (
      <p className="cluster-source-note">
        Coloured by cluster. Switch the View to <strong>Particle type</strong> to keep
        this grouping but colour by particle type.
      </p>
    )}

    {fileError && <p className="cluster-source-error">{fileError}</p>}
    {fileWarnings.map((warning, i) => (
      <p className="cluster-source-warning" key={i}>{warning}</p>
    ))}
  </div>
  );
}

export default React.memo(ClusterSourceControls);

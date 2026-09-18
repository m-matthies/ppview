import React, { useEffect, useRef, useState } from 'react';
import './FileDropOverlay.css';

/**
 * Lets you drop another simulation onto an already-loaded scene.
 *
 * The initial FileDropZone unmounts once the first files land, so without this
 * there was no way to open a second file short of reloading the page. This
 * listens on the window and only reveals itself while files are actually being
 * dragged, so it never sits in front of the scene.
 */
function FileDropOverlay({ onFilesReceived, enabled = true }) {
  const [isDragging, setIsDragging] = useState(false);
  // dragenter/dragleave fire for every element the pointer crosses, so a plain
  // boolean flickers. Counting entries against leaves is the usual remedy.
  const depth = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;

    // Ignore drags of selected text or page elements; only files matter here.
    const carriesFiles = (event) =>
      Array.from(event.dataTransfer?.types || []).includes('Files');

    const onDragEnter = (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setIsDragging(true);
    };

    const onDragOver = (event) => {
      if (!carriesFiles(event)) return;
      // Without this the browser refuses the drop and opens the file instead.
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };

    const onDragLeave = (event) => {
      if (!carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setIsDragging(false);
    };

    const onDrop = (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setIsDragging(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) onFilesReceived(files);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [enabled, onFilesReceived]);

  if (!enabled || !isDragging) return null;

  return (
    <div className="drop-overlay" aria-live="polite">
      <div className="drop-overlay-frame">
        <p className="drop-overlay-title">Drop to replace the scene</p>
        <p className="drop-overlay-sub">
          The current simulation is unloaded and these files are read instead.
        </p>
      </div>
    </div>
  );
}

export default FileDropOverlay;

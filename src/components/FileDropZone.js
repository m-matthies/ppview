import React, { useRef, useState } from 'react';

// Naming the formats up front answers the question a new user actually has:
// will this viewer read the files I already have?
const FORMATS = [
  'oxDNA nucleotide', 'Lorenzo', 'Flavio', 'Raspberry', 'SRS springs', 'MGL',
];

function FileDropZone({ onFilesReceived, isDragDropEnabled = true, onDisabledDrop }) {
  const inputRef = useRef();
  const [isOver, setIsOver] = useState(false);

  const refuse = () => {
    if (onDisabledDrop) onDisabledDrop();
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsOver(false);

    if (!isDragDropEnabled) {
      refuse();
      return;
    }

    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFilesReceived(files);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    if (isDragDropEnabled) setIsOver(true);
  };

  const handleFileSelect = (event) => {
    if (!isDragDropEnabled) return;
    const files = Array.from(event.target.files);
    if (files.length > 0) onFilesReceived(files);
  };

  const handleClick = () => {
    if (!isDragDropEnabled) {
      refuse();
      return;
    }
    inputRef.current.click();
  };

  return (
    <div
      className={`dropzone ${isOver ? 'is-over' : ''} ${!isDragDropEnabled ? 'dropzone-disabled' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsOver(false)}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        multiple
        onChange={handleFileSelect}
        disabled={!isDragDropEnabled}
      />

      <div className="dropzone-frame">
        {isDragDropEnabled ? (
          <>
            <h1 className="dropzone-title">Drop a simulation to view it</h1>
            <p className="dropzone-sub">
              Drag a topology and its trajectory here, or click to choose files.
              Drop the input file too and PPView will pick up the particle radius
              and companion filenames from it.
            </p>
            <div className="dropzone-formats">
              {FORMATS.map((format) => (
                <span className="dropzone-format" key={format}>{format}</span>
              ))}
            </div>
          </>
        ) : (
          <>
            <h1 className="dropzone-title">Viewer is embedded</h1>
            <p className="dropzone-sub">
              This copy of PPView loads files from the page that embeds it. Use that
              page's upload control instead.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default FileDropZone;

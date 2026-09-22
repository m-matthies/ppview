import React, { useCallback, useEffect, useRef } from 'react';

/**
 * Ctrl/Cmd+O opens a file chooser, whether or not a scene is already up.
 *
 * `FileDropZone` has a chooser behind its click target, but it unmounts as soon
 * as the first files land — so once a simulation was open the only way to load
 * another was to drag it in, and the shortcut everyone reaches for did nothing.
 * Worse than nothing, in fact: the browser's own Ctrl+O would have opened a file
 * *over the page*, discarding the session.
 *
 * Always mounted, so the shortcut behaves the same before and after a load.
 */
function FilePicker({ onFilesReceived, enabled = true }) {
  const inputRef = useRef(null);

  const open = useCallback(() => {
    // Clearing first: choosing the same files twice in a row fires no change
    // event otherwise, so a second attempt at the same drop looks ignored.
    if (!inputRef.current) return;
    inputRef.current.value = '';
    inputRef.current.click();
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (event) => {
      if (event.key !== 'o' && event.key !== 'O') return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      // Typing an O into a panel field is not a request to open files.
      const target = event.target;
      if (target instanceof HTMLElement
        && (target.isContentEditable
          || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      // The browser would otherwise open a file over the page.
      event.preventDefault();
      open();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, open]);

  const onChange = (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length) onFilesReceived(files);
  };

  return (
    <input
      ref={inputRef}
      type="file"
      multiple
      // Reachable by the shortcut, and by nothing else: it is not a control.
      style={{ display: 'none' }}
      onChange={onChange}
      disabled={!enabled}
      data-testid="file-picker"
    />
  );
}

export default FilePicker;

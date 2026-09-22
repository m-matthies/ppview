import React from 'react';
import { useUIStore } from '../../store/uiStore';
import './BusyIndicator.css';

/**
 * Says what the app is doing while it is too busy to redraw.
 *
 * Some operations here block the main thread for a long time — DBSCAN is
 * O(n^2), and at twenty thousand particles it takes a minute — and a frozen
 * window with no explanation reads as a crash. This is the explanation.
 *
 * Deliberately a small panel rather than the full-screen cover used while a
 * scene is loading: this runs on a scene that is already up, and hiding the
 * structure someone is working on to tell them it is being worked on is worse
 * than saying nothing.
 *
 * It cannot animate while the work runs — that is the whole problem — so it
 * carries no spinner. A spinner frozen mid-rotation looks more broken than
 * plain text does.
 */
function BusyIndicator() {
  const busyMessage = useUIStore(state => state.busyMessage);
  const isLoading = useUIStore(state => state.isLoading);

  // While a scene is loading the full-screen cover is already showing this
  // message, and two copies of it is one too many.
  if (!busyMessage || isLoading) return null;

  return (
    <div className="busy-indicator pp-panel" role="status" aria-live="polite">
      <span className="busy-dot" />
      <span className="busy-text">{busyMessage}</span>
    </div>
  );
}

export default BusyIndicator;

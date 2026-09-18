import React, { useState, useRef, useEffect, useCallback } from 'react';

const STORAGE_PREFIX = 'ppview_panel_pos_';
// Always leave this much of a panel reachable, so one can never be dragged
// past an edge and stranded.
const MIN_VISIBLE = 64;

function clampToViewport(x, y, el) {
  const width = el?.offsetWidth ?? 0;
  return {
    x: Math.min(Math.max(x, MIN_VISIBLE - width), window.innerWidth - MIN_VISIBLE),
    y: Math.min(Math.max(y, 0), window.innerHeight - MIN_VISIBLE),
  };
}

function readStoredPosition(id) {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed;
  } catch (error) {
    console.warn('Failed to read panel position:', error);
  }
  return null;
}

function DraggablePanel({ children, initialX = 20, initialY = 20, className = '', storageId }) {
  const [position, setPosition] = useState(
    () => readStoredPosition(storageId) ?? { x: initialX, y: initialY }
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef(null);

  const commit = useCallback((next) => {
    setPosition(next);
    if (!storageId) return;
    try {
      localStorage.setItem(STORAGE_PREFIX + storageId, JSON.stringify(next));
    } catch (error) {
      console.warn('Failed to save panel position:', error);
    }
  }, [storageId]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e) => {
      const point = e.touches ? e.touches[0] : e;
      setPosition(clampToViewport(
        point.clientX - dragOffset.current.x,
        point.clientY - dragOffset.current.y,
        panelRef.current
      ));
    };

    const handleUp = () => {
      setIsDragging(false);
      setPosition((current) => {
        const clamped = clampToViewport(current.x, current.y, panelRef.current);
        if (storageId) {
          try {
            localStorage.setItem(STORAGE_PREFIX + storageId, JSON.stringify(clamped));
          } catch (error) {
            console.warn('Failed to save panel position:', error);
          }
        }
        return clamped;
      });
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleUp);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
    };
  }, [isDragging, storageId]);

  // A window that shrinks below a panel's stored position would otherwise
  // leave it off-screen with no way back.
  useEffect(() => {
    const handleResize = () => {
      setPosition((current) => clampToViewport(current.x, current.y, panelRef.current));
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const startDrag = (e) => {
    if (!e.target.closest('.drag-handle')) return;
    // Don't hijack buttons that happen to sit inside the header.
    if (e.target.closest('button, input, select')) return;

    const rect = panelRef.current.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    dragOffset.current = {
      x: point.clientX - rect.left,
      y: point.clientY - rect.top,
    };
    setIsDragging(true);
  };

  // Keyboard nudging keeps panels movable without a pointer.
  const handleKeyDown = (e) => {
    if (!e.target.closest('.drag-handle')) return;
    const step = e.shiftKey ? 24 : 6;
    const deltas = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0],
      ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const delta = deltas[e.key];
    if (!delta) return;
    e.preventDefault();
    commit(clampToViewport(position.x + delta[0], position.y + delta[1], panelRef.current));
  };

  return (
    <div
      ref={panelRef}
      className={`${className} ${isDragging ? 'is-dragging' : ''}`}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onMouseDown={startDrag}
      onTouchStart={startDrag}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}

export default DraggablePanel;

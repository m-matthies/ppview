import React, { useCallback } from 'react';

/**
 * Two bounds on one track.
 *
 * There is no such input element, so this is the usual arrangement: two ranges
 * stacked, with the track drawn underneath and only the thumbs taking the
 * pointer. Both remain real `<input type="range">`s, so they keep their keyboard
 * behaviour — arrows, Home and End on whichever has focus.
 *
 * The thumbs cannot cross. Dragging one past the other pushes the value to meet
 * it rather than swapping them, because a range that silently turned inside out
 * under the pointer would be worse than one that stops.
 */
function RangeSlider({ id, min, max, low, high, onChange, disabled }) {
  const span = Math.max(1, max - min);
  const percent = (value) => ((value - min) / span) * 100;

  const changeLow = useCallback((event) => {
    const next = Math.min(parseInt(event.target.value, 10), high);
    onChange(next, high);
  }, [high, onChange]);

  const changeHigh = useCallback((event) => {
    const next = Math.max(parseInt(event.target.value, 10), low);
    onChange(low, next);
  }, [low, onChange]);

  return (
    <div className="range-slider">
      <div className="range-slider-track">
        <div
          className="range-slider-fill"
          style={{ left: `${percent(low)}%`, right: `${100 - percent(high)}%` }}
        />
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step="1"
        value={low}
        disabled={disabled}
        onChange={changeLow}
        aria-label="Smallest cluster to keep"
      />
      <input
        type="range"
        min={min}
        max={max}
        step="1"
        value={high}
        disabled={disabled}
        onChange={changeHigh}
        aria-label="Largest cluster to keep"
      />
    </div>
  );
}

export default React.memo(RangeSlider);

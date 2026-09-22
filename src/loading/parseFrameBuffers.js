/**
 * Reads one trajectory frame straight into typed arrays.
 *
 * The existing path takes four passes over every particle, each allocating a
 * complete copy of the frame: split the text into `n` strings, parse those into
 * `n` objects with two nested objects inside each, wrap into `n` more objects,
 * then decorate into `n` more. At 400,000 particles that is ~460 ms and
 * something close to a gigabyte of garbage per frame at a million.
 *
 * This walks the text once and writes numbers into buffers that are reused
 * between frames. No substrings, no per-particle objects, nothing for the
 * collector to do afterwards.
 *
 * The number scanner is written out rather than using `parseFloat`, because
 * `parseFloat` needs a string and getting one means `slice`, which is an
 * allocation per field — nine per particle, which is the cost being removed.
 */

const SPACE = 32;
const TAB = 9;
const NEWLINE = 10;
const RETURN = 13;
const MINUS = 45;
const PLUS = 43;
const DOT = 46;
const ZERO = 48;
const NINE = 57;
const LOWER_E = 101;
const UPPER_E = 69;

const isSpace = (c) => c === SPACE || c === TAB;
const isDigit = (c) => c >= ZERO && c <= NINE;

// Powers of ten for the fractional part. Indexed by digit count, so a number
// needs one division rather than a multiply per digit. Trajectories do not carry
// more precision than a double holds, so the table stops where that does.
const POW10 = [1];
for (let i = 1; i <= 18; i++) POW10[i] = POW10[i - 1] * 10;

/**
 * Reusable buffers, so playback does not allocate three arrays per frame.
 *
 * Grown when a larger structure arrives and never shrunk: a trajectory does not
 * change particle count between frames, so this settles after the first one.
 */
export function createFrameBuffers() {
  let capacity = 0;
  let positions = new Float32Array(0);
  let a1 = new Float32Array(0);
  let a3 = new Float32Array(0);
  return {
    ensure(count) {
      if (count <= capacity) return;
      capacity = count;
      positions = new Float32Array(count * 3);
      a1 = new Float32Array(count * 3);
      a3 = new Float32Array(count * 3);
    },
    get positions() { return positions; },
    get a1() { return a1; },
    get a3() { return a3; },
  };
}

/**
 * @param text     the frame, from `t = …` to the last particle
 * @param buffers  from `createFrameBuffers`, reused across frames
 * @returns {{count, time, boxSize, energy, positions, a1, a3, hasOrientation}}
 */
export function parseFrameBuffers(text, buffers) {
  const length = text.length;

  // Reads one number starting at `i`, leaving `i` just past it. Returns NaN
  // when there is no number here, which is how the row loop detects the end.
  let cursor = 0;
  const readNumber = () => {
    // Spaces and tabs only. A number must never be read across a newline, or a
    // row of three columns would silently consume the first value of the next
    // row and the frame would come out with half the particles it should.
    while (cursor < length && isSpace(text.charCodeAt(cursor))) cursor++;
    if (cursor >= length) return NaN;
    const here = text.charCodeAt(cursor);
    if (here === NEWLINE || here === RETURN) return NaN;   // end of this row

    const start = cursor;
    let c = text.charCodeAt(cursor);
    if (c === MINUS || c === PLUS) { cursor++; c = text.charCodeAt(cursor); }
    if (!isDigit(c) && c !== DOT) { cursor = start; return NaN; }

    let value = 0;
    let seenDigit = false;
    let code;
    while (cursor < length && (code = text.charCodeAt(cursor)) >= ZERO && code <= NINE) {
      value = value * 10 + (code - ZERO);
      cursor++;
      seenDigit = true;
    }
    if (cursor < length && text.charCodeAt(cursor) === DOT) {
      cursor++;
      // The fraction accumulates as an integer and is divided once, rather than
      // multiplying a running scale by 0.1 per digit. One division per number
      // instead of one multiply per digit, and it avoids the drift that
      // repeatedly multiplying by an inexact 0.1 introduces.
      let fraction = 0;
      let digits = 0;
      while (cursor < length && (code = text.charCodeAt(cursor)) >= ZERO && code <= NINE) {
        fraction = fraction * 10 + (code - ZERO);
        digits++;
        cursor++;
        seenDigit = true;
      }
      if (digits > 0) value += fraction / (POW10[digits] ?? Math.pow(10, digits));
    }
    if (!seenDigit) { cursor = start; return NaN; }

    if (cursor < length) {
      const e = text.charCodeAt(cursor);
      if (e === LOWER_E || e === UPPER_E) {
        cursor++;
        let expSign = 1;
        const s = text.charCodeAt(cursor);
        if (s === MINUS) { expSign = -1; cursor++; }
        else if (s === PLUS) cursor++;
        let exponent = 0;
        while (cursor < length && isDigit(text.charCodeAt(cursor))) {
          exponent = exponent * 10 + (text.charCodeAt(cursor) - ZERO);
          cursor++;
        }
        value *= Math.pow(10, expSign * exponent);
      }
    }

    const negative = text.charCodeAt(start) === MINUS;
    return negative ? -value : value;
  };

  /** Skips to just past the next newline. */
  const skipLine = () => {
    while (cursor < length && text.charCodeAt(cursor) !== NEWLINE) cursor++;
    cursor++;
  };

  // Header: "t = <time>", "b = <x> <y> <z>", "E = <a> <b> <c>". Each value is
  // read by scanning past the label to the first number on the line.
  const afterLabel = () => {
    while (cursor < length && text.charCodeAt(cursor) !== NEWLINE) {
      const c = text.charCodeAt(cursor);
      if (isDigit(c) || c === MINUS || c === PLUS || c === DOT) return;
      cursor++;
    }
  };

  afterLabel();
  const time = readNumber();
  skipLine();

  afterLabel();
  const boxSize = [readNumber(), readNumber(), readNumber()];
  skipLine();

  afterLabel();
  const energy = [readNumber(), readNumber(), readNumber()];
  skipLine();

  // Count the remaining rows before filling, so the buffers are sized once.
  // Cheaper than growing them, and a frame is read many times over a session.
  const bodyStart = cursor;
  let count = 0;
  for (let p = bodyStart; p < length; p++) {
    if (text.charCodeAt(p) === NEWLINE) count++;
  }
  // A final row with no trailing newline still counts.
  if (length > bodyStart && text.charCodeAt(length - 1) !== NEWLINE) count++;

  buffers.ensure(count);
  const { positions, a1, a3 } = buffers;

  let written = 0;
  let hasOrientation = false;
  cursor = bodyStart;
  while (cursor < length && written < count) {
    // Step over blank lines and line endings between rows, since readNumber
    // deliberately will not.
    while (cursor < length) {
      const c = text.charCodeAt(cursor);
      if (c === NEWLINE || c === RETURN || isSpace(c)) cursor++;
      else break;
    }
    if (cursor >= length) break;

    const x = readNumber();
    if (Number.isNaN(x)) break;                 // trailing junk
    const y = readNumber();
    const z = readNumber();

    const o = written * 3;
    positions[o] = x; positions[o + 1] = y; positions[o + 2] = z;

    const a1x = readNumber();
    if (Number.isNaN(a1x)) {
      // A row of three: no orientation, which MGL and plain xyz produce.
      a1[o] = 1; a1[o + 1] = 0; a1[o + 2] = 0;
      a3[o] = 0; a3[o + 1] = 0; a3[o + 2] = 1;
    } else {
      hasOrientation = true;
      a1[o] = a1x; a1[o + 1] = readNumber(); a1[o + 2] = readNumber();
      a3[o] = readNumber(); a3[o + 1] = readNumber(); a3[o + 2] = readNumber();
    }
    written++;
    skipLine();
  }

  return {
    count: written,
    time,
    boxSize,
    energy,
    positions,
    a1,
    a3,
    hasOrientation,
  };
}

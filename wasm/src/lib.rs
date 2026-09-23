//! Frame parsing and DBSCAN for PPView, compiled to WebAssembly.
//!
//! Deliberately without `wasm-bindgen`. Everything crossing the boundary here is
//! either a block of bytes going in or a block of `f32`/`i32` coming out, and
//! for that the raw module is simpler than the generated glue: no JS shim to
//! ship, nothing for the bundler to resolve, and the browser can instantiate it
//! straight from a `fetch`. Create React App cannot be given a webpack config
//! without ejecting, so avoiding the bundler entirely is worth something.
//!
//! The JS implementations stay, and are still the reference: both are covered by
//! the same tests, and `wasmCore.js` falls back to them when the module fails to
//! load — in jsdom, for instance, where there is no `fetch`.

use std::mem;

/// Replaces a `static mut`, **dropping what was there**.
///
/// `ptr::write` overwrites without dropping, which leaks whatever the static
/// was holding. Every result here is a `Vec`, and every one of them was leaked
/// on each call: 1.2 MB per frame parsed, so playback passed 2 GB of linear
/// memory after about 1,750 frames. Past that, `alloc` returns an `i32`
/// pointer with the top bit set, JS reads it as negative, and building a view
/// over it fails with "Start offset -2147186048 is outside the bounds of the
/// buffer" — a long way from anything that mentions memory.
///
/// A raw pointer rather than a reference because taking a reference to a
/// `static mut` is what the 2024 lint objects to; `ptr::replace` reads the old
/// value out so it can be dropped normally.
unsafe fn replace_static<T>(slot: *mut T, value: T) {
    drop(std::ptr::replace(slot, value));
}

// ---------------------------------------------------------------- memory
//
// JS allocates a buffer here, writes the frame into it, and hands back the
// pointer. One copy, of bytes it already has.

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    mem::forget(buffer);
    ptr
}

/// Floats need four-byte alignment, which a byte buffer does not promise.
#[no_mangle]
pub extern "C" fn alloc_f32(count: usize) -> *mut f32 {
    let mut buffer: Vec<f32> = Vec::with_capacity(count);
    let ptr = buffer.as_mut_ptr();
    mem::forget(buffer);
    ptr
}

#[no_mangle]
pub extern "C" fn dealloc_f32(ptr: *mut f32, count: usize) {
    if !ptr.is_null() && count > 0 {
        unsafe { drop(Vec::from_raw_parts(ptr, 0, count)) }
    }
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() && len > 0 {
        unsafe { drop(Vec::from_raw_parts(ptr, 0, len)) }
    }
}

// ---------------------------------------------------------------- parsing

/// Everything one frame yields, kept on this side so JS reads it as typed
/// arrays over the module's memory rather than receiving a copy.
struct Frame {
    positions: Vec<f32>,
    a1: Vec<f32>,
    a3: Vec<f32>,
    meta: Vec<f32>, // count, time, bx, by, bz, e0, e1, e2, has_orientation
}

static mut FRAME: Option<Frame> = None;

/// Single-threaded by construction — this is a wasm module with no threads — so
/// a `static mut` is sound here. Reached through a raw pointer because taking a
/// reference to one is the thing the 2024 lint objects to.
fn frame() -> Option<&'static Frame> {
    unsafe { (*std::ptr::addr_of!(FRAME)).as_ref() }
}

#[inline]
fn is_space(b: u8) -> bool {
    b == b' ' || b == b'\t'
}

/// Reads one number, stopping at a line break.
///
/// A number must never be read across a newline, or a row of three columns
/// silently consumes the first value of the next row and the frame comes out
/// with half the particles it should — the same trap the JS scanner documents.
fn read_number(bytes: &[u8], cursor: &mut usize) -> Option<f32> {
    let len = bytes.len();
    while *cursor < len && is_space(bytes[*cursor]) {
        *cursor += 1;
    }
    if *cursor >= len || bytes[*cursor] == b'\n' || bytes[*cursor] == b'\r' {
        return None;
    }

    let mut sign = 1.0f64;
    match bytes[*cursor] {
        b'-' => {
            sign = -1.0;
            *cursor += 1;
        }
        b'+' => *cursor += 1,
        _ => {}
    }

    let start = *cursor;
    let mut value = 0.0f64;
    while *cursor < len && bytes[*cursor].is_ascii_digit() {
        value = value * 10.0 + f64::from(bytes[*cursor] - b'0');
        *cursor += 1;
    }
    if *cursor < len && bytes[*cursor] == b'.' {
        *cursor += 1;
        let mut scale = 0.1f64;
        while *cursor < len && bytes[*cursor].is_ascii_digit() {
            value += f64::from(bytes[*cursor] - b'0') * scale;
            scale *= 0.1;
            *cursor += 1;
        }
    }
    if *cursor == start {
        return None;
    }

    if *cursor < len && (bytes[*cursor] == b'e' || bytes[*cursor] == b'E') {
        *cursor += 1;
        let mut exp_sign = 1i32;
        if *cursor < len && (bytes[*cursor] == b'-' || bytes[*cursor] == b'+') {
            if bytes[*cursor] == b'-' {
                exp_sign = -1;
            }
            *cursor += 1;
        }
        let mut exponent = 0i32;
        while *cursor < len && bytes[*cursor].is_ascii_digit() {
            exponent = exponent * 10 + i32::from(bytes[*cursor] - b'0');
            *cursor += 1;
        }
        value *= 10f64.powi(exp_sign * exponent);
    }

    Some((sign * value) as f32)
}

fn skip_line(bytes: &[u8], cursor: &mut usize) {
    let len = bytes.len();
    while *cursor < len && bytes[*cursor] != b'\n' {
        *cursor += 1;
    }
    if *cursor < len {
        *cursor += 1;
    }
}

/// Reads the numbers out of a header line such as `b = 60 60 60`.
fn read_header(bytes: &[u8], cursor: &mut usize, out: &mut [f32]) {
    let len = bytes.len();
    // Past the '=' if there is one on this line.
    let line_start = *cursor;
    let mut scan = *cursor;
    while scan < len && bytes[scan] != b'\n' {
        if bytes[scan] == b'=' {
            *cursor = scan + 1;
            break;
        }
        scan += 1;
    }
    if *cursor == line_start && scan < len && bytes[scan] == b'\n' {
        *cursor = scan;
    }
    for slot in out.iter_mut() {
        match read_number(bytes, cursor) {
            Some(value) => *slot = value,
            None => break,
        }
    }
    skip_line(bytes, cursor);
}

/// Parses a frame that JS has written at `ptr`. Returns the particle count.
#[no_mangle]
pub extern "C" fn parse_frame(ptr: *const u8, len: usize) -> usize {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let mut cursor = 0usize;

    let mut time = [0.0f32; 1];
    let mut boxes = [0.0f32; 3];
    let mut energy = [0.0f32; 3];
    read_header(bytes, &mut cursor, &mut time);
    read_header(bytes, &mut cursor, &mut boxes);
    read_header(bytes, &mut cursor, &mut energy);

    // Roughly one row per 40 bytes; a wrong guess only costs a regrow.
    let guess = len / 40 + 1;
    let mut positions = Vec::with_capacity(guess * 3);
    let mut a1 = Vec::with_capacity(guess * 3);
    let mut a3 = Vec::with_capacity(guess * 3);
    let mut count = 0usize;
    let mut has_orientation = true;

    while cursor < len {
        let x = match read_number(bytes, &mut cursor) {
            Some(v) => v,
            None => {
                skip_line(bytes, &mut cursor);
                continue;
            }
        };
        let (y, z) = match (
            read_number(bytes, &mut cursor),
            read_number(bytes, &mut cursor),
        ) {
            (Some(y), Some(z)) => (y, z),
            _ => {
                skip_line(bytes, &mut cursor);
                continue;
            }
        };
        positions.push(x);
        positions.push(y);
        positions.push(z);

        let mut orientation = [0.0f32; 6];
        let mut read = 0;
        for slot in orientation.iter_mut() {
            match read_number(bytes, &mut cursor) {
                Some(value) => {
                    *slot = value;
                    read += 1;
                }
                None => break,
            }
        }
        if read < 6 {
            has_orientation = false;
            orientation = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0];
        }
        a1.extend_from_slice(&orientation[0..3]);
        a3.extend_from_slice(&orientation[3..6]);

        skip_line(bytes, &mut cursor);
        count += 1;
    }

    let meta = vec![
        count as f32,
        time[0],
        boxes[0],
        boxes[1],
        boxes[2],
        energy[0],
        energy[1],
        energy[2],
        if has_orientation { 1.0 } else { 0.0 },
    ];

    unsafe {
        replace_static(
            std::ptr::addr_of_mut!(FRAME),
            Some(Frame { positions, a1, a3, meta }),
        );
    }
    count
}

#[no_mangle]
pub extern "C" fn frame_positions() -> *const f32 {
    frame().map_or(std::ptr::null(), |f| f.positions.as_ptr())
}

#[no_mangle]
pub extern "C" fn frame_a1() -> *const f32 {
    frame().map_or(std::ptr::null(), |f| f.a1.as_ptr())
}

#[no_mangle]
pub extern "C" fn frame_a3() -> *const f32 {
    frame().map_or(std::ptr::null(), |f| f.a3.as_ptr())
}

#[no_mangle]
pub extern "C" fn frame_meta() -> *const f32 {
    frame().map_or(std::ptr::null(), |f| f.meta.as_ptr())
}

// ---------------------------------------------------------------- dbscan
//
// A port of `utils/clustering.js`, kept deliberately line-for-line: the same
// grid, the same minimum-image distance, the same core/border/noise rules and
// above all the same *order*, since a cluster's index is what the pane selects
// by. `wasmCore.test.js` compares the two on random structures rather than
// trusting that.

static mut LABELS: Vec<i32> = Vec::new();

fn labels() -> &'static [i32] {
    unsafe { &*std::ptr::addr_of!(LABELS) }
}

#[inline]
fn minimum_image(delta: f32, length: f32) -> f32 {
    if length > 0.0 {
        delta - length * (delta / length).round()
    } else {
        delta
    }
}

struct Grid {
    counts: Vec<i32>,
    ordered: Vec<i32>,
    cell_of: Vec<i32>,
    n: [i32; 3],
    periodic: bool,
}

impl Grid {
    fn build(points: &[f32], count: usize, radius: f32, boxes: [f32; 3]) -> Grid {
        let periodic = boxes[0] > 0.0 && boxes[1] > 0.0 && boxes[2] > 0.0;
        let mut origin = [0.0f32; 3];
        let mut span = boxes;
        if !periodic {
            let mut lo = [f32::INFINITY; 3];
            let mut hi = [f32::NEG_INFINITY; 3];
            for i in 0..count {
                for axis in 0..3 {
                    let v = points[i * 3 + axis];
                    if v < lo[axis] {
                        lo[axis] = v;
                    }
                    if v > hi[axis] {
                        hi[axis] = v;
                    }
                }
            }
            for axis in 0..3 {
                origin[axis] = lo[axis];
                span[axis] = hi[axis] - lo[axis];
            }
        }

        let mut n = [1i32; 3];
        for axis in 0..3 {
            n[axis] = if span[axis] > 0.0 {
                ((span[axis] / radius).floor() as i32).max(1)
            } else {
                1
            };
        }

        let cell_along = |value: f32, axis: usize| -> i32 {
            if !(span[axis] > 0.0) || n[axis] == 1 {
                return 0;
            }
            let mut t = value - origin[axis];
            if periodic {
                t -= span[axis] * (t / span[axis]).floor();
            }
            let index = ((t / span[axis]) * n[axis] as f32).floor() as i32;
            index.clamp(0, n[axis] - 1)
        };

        let cells = (n[0] * n[1] * n[2]) as usize;
        let mut cell_of = vec![0i32; count];
        let mut counts = vec![0i32; cells + 1];
        for i in 0..count {
            let cell = cell_along(points[i * 3], 0)
                + n[0] * (cell_along(points[i * 3 + 1], 1) + n[1] * cell_along(points[i * 3 + 2], 2));
            cell_of[i] = cell;
            counts[cell as usize + 1] += 1;
        }
        for c in 0..cells {
            counts[c + 1] += counts[c];
        }
        let mut ordered = vec![0i32; count];
        let mut cursor: Vec<i32> = counts[..cells].to_vec();
        for i in 0..count {
            let c = cell_of[i] as usize;
            ordered[cursor[c] as usize] = i as i32;
            cursor[c] += 1;
        }

        Grid { counts, ordered, cell_of, n, periodic }
    }

    /// The distinct cell coordinates adjacent to one, along a single axis.
    fn adjacent(&self, c: i32, axis: usize, out: &mut [i32; 3]) -> usize {
        let n = self.n[axis];
        let mut len = 0usize;
        for d in -1..=1 {
            let mut k = c + d;
            if self.periodic {
                k = ((k % n) + n) % n;
            } else if k < 0 || k >= n {
                continue;
            }
            if !out[..len].contains(&k) {
                out[len] = k;
                len += 1;
            }
        }
        len
    }

    fn near(&self, index: usize, mut visit: impl FnMut(usize)) {
        let cell = self.cell_of[index];
        let cx = cell % self.n[0];
        let cy = (cell / self.n[0]) % self.n[1];
        let cz = cell / (self.n[0] * self.n[1]);
        let (mut xs, mut ys, mut zs) = ([0i32; 3], [0i32; 3], [0i32; 3]);
        let nx = self.adjacent(cx, 0, &mut xs);
        let ny = self.adjacent(cy, 1, &mut ys);
        let nz = self.adjacent(cz, 2, &mut zs);
        for &z in &zs[..nz] {
            for &y in &ys[..ny] {
                for &x in &xs[..nx] {
                    let c = (x + self.n[0] * (y + self.n[1] * z)) as usize;
                    let from = self.counts[c] as usize;
                    let to = self.counts[c + 1] as usize;
                    for k in from..to {
                        visit(self.ordered[k] as usize);
                    }
                }
            }
        }
    }
}

/// Clusters `count` particles given as flat xyz. Returns the number of clusters;
/// the per-particle labels are read through `cluster_labels` (-1 is noise).
#[no_mangle]
pub extern "C" fn dbscan(
    ptr: *const f32,
    count: usize,
    epsilon: f32,
    min_points: usize,
    bx: f32,
    by: f32,
    bz: f32,
) -> usize {
    let points = unsafe { std::slice::from_raw_parts(ptr, count * 3) };
    let boxes = [bx, by, bz];

    // Half the shortest box dimension: past it the nearest image stops being
    // unique and pairs get counted through two images at once.
    let mut limit = f32::INFINITY;
    for &length in boxes.iter() {
        if length > 0.0 && length / 2.0 < limit {
            limit = length / 2.0;
        }
    }
    let radius = epsilon.min(limit);
    let radius_sq = radius * radius;

    let grid = Grid::build(points, count, radius, boxes);
    let mut neighbours: Vec<usize> = Vec::with_capacity(64);

    let region_query = |index: usize, out: &mut Vec<usize>| {
        out.clear();
        let px = points[index * 3];
        let py = points[index * 3 + 1];
        let pz = points[index * 3 + 2];
        grid.near(index, |i| {
            let dx = minimum_image(px - points[i * 3], boxes[0]);
            let dy = minimum_image(py - points[i * 3 + 1], boxes[1]);
            let dz = minimum_image(pz - points[i * 3 + 2], boxes[2]);
            if dx * dx + dy * dy + dz * dz <= radius_sq {
                out.push(i);
            }
        });
    };

    let mut label = vec![-1i32; count];
    let mut visited = vec![false; count];
    let mut assigned = vec![false; count];
    let mut clusters = 0usize;

    let mut queue: Vec<usize> = Vec::new();
    let mut queued = vec![false; count];
    let mut expansion: Vec<usize> = Vec::with_capacity(64);

    for seed in 0..count {
        if visited[seed] {
            continue;
        }
        visited[seed] = true;
        region_query(seed, &mut neighbours);
        if neighbours.len() < min_points {
            continue; // noise for now: it can still be adopted as a border point
        }

        let cluster = clusters as i32;
        clusters += 1;
        label[seed] = cluster;
        assigned[seed] = true;

        queue.clear();
        for &n in neighbours.iter() {
            if !queued[n] {
                queued[n] = true;
                queue.push(n);
            }
        }

        let mut k = 0usize;
        while k < queue.len() {
            let index = queue[k];
            k += 1;
            if !visited[index] {
                visited[index] = true;
                region_query(index, &mut expansion);
                // Only core points extend the cluster; a border point joins and
                // stops, which is what keeps two dense groups linked by a thin
                // trail from being reported as one.
                if expansion.len() >= min_points {
                    for &candidate in expansion.iter() {
                        if !queued[candidate] {
                            queued[candidate] = true;
                            queue.push(candidate);
                        }
                    }
                }
            }
            if !assigned[index] {
                label[index] = cluster;
                assigned[index] = true;
            }
        }
        for &n in queue.iter() {
            queued[n] = false;
        }
    }

    unsafe {
        replace_static(std::ptr::addr_of_mut!(LABELS), label);
    }
    clusters
}

#[no_mangle]
pub extern "C" fn cluster_labels() -> *const i32 {
    labels().as_ptr()
}

// ------------------------------------------------- cluster/bond observables
//
// Finding the timestep blocks in a cluster/bond observable, over a file far too
// large to hold. The one that prompted this is 4.79 GB — 8.9x V8's maximum
// string length, so `file.text()` cannot read it at any amount of RAM — and
// holds 21,798 timesteps against a trajectory of 217 frames.
//
// Only the blocks whose step matches a trajectory frame are ever parsed, so
// this pass does not parse anything: it records where each block starts and,
// where the format states one, which step it is. JS then slices out the
// handful it wants and runs the ordinary parser on each. That is the same
// division the trajectory uses — an index pass, then one block at a time — and
// it means the three format parsers stay exactly as they are.
//
// Offsets are `f64`, not `i32`. This file is past 2^32 bytes, so a 32-bit
// offset wraps a third of the way in and every block after that point is read
// from the wrong place.

/// A block starts at a line beginning with `#`, and that line states the step.
const OBS_STEP_HEADERS: i32 = 0;
/// Every line is a block, and no step is stated.
const OBS_LINE_PER_STEP: i32 = 1;
/// Every line with something on it; blank ones are not timesteps.
///
/// Decided here rather than from the byte span of a line, because "a line of
/// two bytes or fewer is blank" cannot tell `\r\n` from `0\n` — and `0` is
/// exactly what PLClusterTopology writes for a step with no clusters, so that
/// step was dropped and every later one read from the wrong place.
const OBS_LINE_PER_STEP_NONBLANK: i32 = 2;

struct ObsScan {
    format: i32,
    at_line_start: bool,
    offset: f64,
    /// Collecting a header line that may span a chunk boundary.
    reading_header: bool,
    header: Vec<u8>,
    /// A line whose first chunk held only spaces, still to be judged.
    pending_line: Option<f64>,
    starts: Vec<f64>,
    steps: Vec<f64>,
}

static mut OBS: Option<ObsScan> = None;

fn obs() -> Option<&'static ObsScan> {
    unsafe { (*std::ptr::addr_of!(OBS)).as_ref() }
}

fn obs_mut() -> Option<&'static mut ObsScan> {
    unsafe { (*std::ptr::addr_of_mut!(OBS)).as_mut() }
}

/// Reads the step out of `# step 2179700000 N 4800`.
///
/// `f64` rather than an integer because these run to 2.18e9, past `i32`, and
/// because that is what crosses the boundary anyway.
fn read_step(header: &[u8]) -> f64 {
    let mut i = 0usize;
    // Past "# step", or whatever precedes the first digit run.
    while i < header.len() && !header[i].is_ascii_digit() {
        i += 1;
    }
    if i >= header.len() {
        return -1.0;
    }
    let mut value = 0.0f64;
    while i < header.len() && header[i].is_ascii_digit() {
        value = value * 10.0 + f64::from(header[i] - b'0');
        i += 1;
    }
    value
}

#[no_mangle]
pub extern "C" fn obs_scan_begin(format: i32) {
    unsafe {
        replace_static(
            std::ptr::addr_of_mut!(OBS),
            Some(ObsScan {
                format,
                at_line_start: true,
                offset: 0.0,
                reading_header: false,
                header: Vec::new(),
                pending_line: None,
                starts: Vec::new(),
                steps: Vec::new(),
            }),
        );
    }
}

/// Feeds one chunk.
///
/// Chunks may split a line anywhere, and the first one that did left every step
/// after it unread — so both the header and the "is this line blank" decision
/// are carried across the seam rather than made per chunk.
#[no_mangle]
pub extern "C" fn obs_scan_feed(ptr: *const u8, len: usize) {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let scan = match obs_mut() {
        Some(s) => s,
        None => return,
    };

    /// How far to the first non-space on this line, and whether the line ended.
    fn scan_line(bytes: &[u8], from: usize) -> (bool, bool) {
        let mut j = from;
        while j < bytes.len() && bytes[j] != b'\n' {
            if !bytes[j].is_ascii_whitespace() {
                return (true, false); // something on the line
            }
            j += 1;
        }
        (false, j < bytes.len()) // nothing on it; did it end in this chunk?
    }

    let mut i = 0usize;
    while i < len {
        if scan.reading_header {
            // Gather to the end of the line, then read the step off it.
            let from = i;
            while i < len && bytes[i] != b'\n' {
                i += 1;
            }
            scan.header.extend_from_slice(&bytes[from..i]);
            if i < len {
                let step = read_step(&scan.header);
                scan.steps.push(step);
                scan.header.clear();
                scan.reading_header = false;
                scan.at_line_start = true;
                i += 1;
            }
            continue;
        }

        // A line whose opening chunk held only spaces, still to be judged.
        if let Some(here) = scan.pending_line {
            let (has_content, ended) = scan_line(bytes, i);
            if has_content {
                scan.starts.push(here);
                scan.steps.push(-1.0);
                scan.pending_line = None;
            } else if ended {
                scan.pending_line = None; // blank after all: not a timestep
            } else {
                i = len; // still undecided
                continue;
            }
            scan.at_line_start = false;
        }

        if scan.at_line_start {
            let here = scan.offset + i as f64;
            if scan.format == OBS_STEP_HEADERS {
                if bytes[i] == b'#' {
                    scan.starts.push(here);
                    scan.reading_header = true;
                    continue;
                }
            } else if scan.format == OBS_LINE_PER_STEP {
                // Every line is one timestep, blank ones included: in
                // RaspberryPatchyBonds a step in which nothing was bonded is an
                // empty line, and dropping it slides every later frame one step
                // earlier.
                scan.starts.push(here);
                scan.steps.push(-1.0);
            } else if scan.format == OBS_LINE_PER_STEP_NONBLANK {
                let (has_content, ended) = scan_line(bytes, i);
                if has_content {
                    scan.starts.push(here);
                    scan.steps.push(-1.0);
                } else if !ended {
                    // Ran out of chunk with only spaces: decide next time.
                    scan.pending_line = Some(here);
                }
            }
            scan.at_line_start = false;
        }

        // Jump to the next line rather than stepping a byte at a time.
        match bytes[i..].iter().position(|&b| b == b'\n') {
            Some(rel) => {
                i += rel + 1;
                scan.at_line_start = true;
            }
            None => i = len,
        }
    }

    scan.offset += len as f64;
}

/// Closes the scan and returns how many blocks were found.
#[no_mangle]
pub extern "C" fn obs_scan_end() -> usize {
    let scan = match obs_mut() {
        Some(s) => s,
        None => return 0,
    };
    // A file whose last line has no newline still ends a header.
    if scan.reading_header {
        let step = read_step(&scan.header);
        scan.steps.push(step);
        scan.header.clear();
        scan.reading_header = false;
    }
    scan.starts.len()
}

/// Total bytes seen, which is where the last block ends.
#[no_mangle]
pub extern "C" fn obs_scan_size() -> f64 {
    obs().map_or(0.0, |s| s.offset)
}

#[no_mangle]
pub extern "C" fn obs_scan_offsets() -> *const f64 {
    obs().map_or(std::ptr::null(), |s| s.starts.as_ptr())
}

#[no_mangle]
pub extern "C" fn obs_scan_steps() -> *const f64 {
    obs().map_or(std::ptr::null(), |s| s.steps.as_ptr())
}

/// Releases the index. It is one f64 pair per timestep — small for the file
/// that prompted this (21,798 blocks, 350 KB) but there is no reason to hold it
/// once JS has copied it out.
#[no_mangle]
pub extern "C" fn obs_scan_free() {
    unsafe {
        replace_static(std::ptr::addr_of_mut!(OBS), None);
    }
}

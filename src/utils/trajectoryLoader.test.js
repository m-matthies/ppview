import { parseConfiguration, buildTrajIndex } from './trajectoryLoader';

const frame = (time, box, rows) => [
  `t = ${time}`,
  `b = ${box}`,
  'E = 0 0 0',
  ...rows,
];

describe('parseConfiguration', () => {
  it('reads the header', () => {
    const out = parseConfiguration(frame(1500, '60 60 60', ['1 2 3 1 0 0 0 0 1']));
    expect(out.time).toBe(1500);
    expect(out.boxSize).toEqual([60, 60, 60]);
    expect(out.energy).toEqual([0, 0, 0]);
  });

  it('reads position and both orientation vectors', () => {
    // a1 and a3 are what every oxDNA nucleotide position is derived from, so a
    // silent mis-slice here would move all four meshes at once.
    const out = parseConfiguration(frame(0, '60 60 60', [
      '1.5 2.5 3.5  0 1 0  0 0 1',
    ]));
    expect(out.positions).toHaveLength(1);
    expect(out.positions[0]).toEqual({
      x: 1.5, y: 2.5, z: 3.5,
      a1: { x: 0, y: 1, z: 0 },
      a3: { x: 0, y: 0, z: 1 },
    });
  });

  it('accepts a row with no orientation data', () => {
    const out = parseConfiguration(frame(0, '60 60 60', ['1 2 3']));
    expect(out.positions[0]).toEqual({ x: 1, y: 2, z: 3 });
    expect(out.positions[0].a1).toBeUndefined();
  });

  it('skips blank lines rather than emitting NaN particles', () => {
    const out = parseConfiguration(frame(0, '60 60 60', [
      '1 2 3 1 0 0 0 0 1',
      '',
      '4 5 6 1 0 0 0 0 1',
      '   ',
    ]));
    expect(out.positions).toHaveLength(2);
  });

  it('keeps unwrapped coordinates as written', () => {
    // oxDNA does not wrap its output. Clamping here would quietly relocate
    // particles and break the minimum-image distances clustering relies on.
    const out = parseConfiguration(frame(0, '20 20 20', ['-5 25 100 1 0 0 0 0 1']));
    expect(out.positions[0]).toMatchObject({ x: -5, y: 25, z: 100 });
  });

  it('reads a non-cubic box', () => {
    const out = parseConfiguration(frame(0, '10 20 30', ['1 2 3']));
    expect(out.boxSize).toEqual([10, 20, 30]);
  });

  it('handles a frame with no particles', () => {
    const out = parseConfiguration(frame(0, '60 60 60', []));
    expect(out.positions).toEqual([]);
  });
});

describe('buildTrajIndex', () => {
  // A minimal stand-in for the File API: the function only uses .stream().
  const fileOf = (text) => ({
    stream: () => new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
  });

  const twoFrames = [
    ...frame(0, '60 60 60', ['1 2 3', '4 5 6']),
    ...frame(100, '60 60 60', ['7 8 9', '1 1 1']),
  ].join('\n');

  it('finds the byte offset of every frame', async () => {
    const { offsets } = await buildTrajIndex(fileOf(twoFrames));
    expect(offsets).toHaveLength(2);
    expect(offsets[0]).toBe(0);
    // Offsets are byte positions, so slicing from one must land on its header.
    expect(twoFrames.slice(offsets[1]).startsWith('t = 100')).toBe(true);
  });

  it('records the step each frame was printed at', async () => {
    // A cluster/bond observable prints on its own interval, so lining one up
    // with the trajectory means matching step numbers — which were previously
    // read off the header line and thrown away.
    const { times } = await buildTrajIndex(fileOf(twoFrames));
    expect(times).toEqual([0, 100]);
  });

  it('reads a step written in exponential notation', async () => {
    const { times } = await buildTrajIndex(fileOf('t = 1e7\nb = 1 1 1\nE = 0 0 0'));
    expect(times).toEqual([1e7]);
  });

  it('gives a frame with an unreadable step a time of NaN, not zero', async () => {
    // Zero is a real step, and a frame silently claiming it would be matched
    // against the observable's first block.
    const { times } = await buildTrajIndex(fileOf('t =\nb = 1 1 1\nE = 0 0 0'));
    expect(times[0]).toBeNaN();
  });

  it('finds a frame header on the final line with no trailing newline', async () => {
    const { offsets } = await buildTrajIndex(fileOf('t = 0\nb = 1 1 1\nE = 0 0 0\nt = 1'));
    expect(offsets).toHaveLength(2);
  });

  it('gives correct byte offsets for a CRLF trajectory', async () => {
    // Splitting on /\r?\n/ consumed the carriage return while the offset still
    // counted one byte per line, so each frame was indexed a byte short per
    // preceding line — file.slice() then landed mid-line and parseConfiguration
    // read a body row where it expected a header.
    const crlf = twoFrames.replace(/\n/g, '\r\n');
    const { offsets } = await buildTrajIndex(fileOf(crlf));
    expect(offsets).toHaveLength(2);
    expect(crlf.slice(offsets[0]).startsWith('t = 0')).toBe(true);
    expect(crlf.slice(offsets[1]).startsWith('t = 100')).toBe(true);
  });

  it('returns nothing for a file with no frames', async () => {
    expect((await buildTrajIndex(fileOf('no markers here\nnor here'))).offsets).toEqual([]);
  });

  it('handles an empty file', async () => {
    expect(await buildTrajIndex(fileOf(''))).toEqual({ offsets: [], times: [] });
  });

  it('survives a frame header split across chunk boundaries', async () => {
    // The reader hands back arbitrary chunks; partialLine carry-over is what
    // keeps a header spanning two of them from being missed.
    const text = twoFrames;
    const split = Math.floor(text.indexOf('t = 100') + 2);
    const chunked = {
      stream: () => new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(text.slice(0, split)));
          controller.enqueue(enc.encode(text.slice(split)));
          controller.close();
        },
      }),
    };
    expect((await buildTrajIndex(chunked)).offsets).toHaveLength(2);
  });
});

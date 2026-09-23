// Trajectory loading and parsing utilities

/**
 * Indexes a trajectory: where each frame starts, and which step it is.
 *
 * The step used to be read and discarded. It is kept now because a cluster/bond
 * observable prints on its own interval — commonly a hundred times more often
 * than configurations are written — so lining the two up means matching step
 * numbers, and nothing else in either file says how they correspond.
 *
 * @returns {{ offsets: number[], times: number[] }}
 */
export const buildTrajIndex = async (file) => {
  const decoder = new TextDecoder("utf-8");
  const reader = file.stream().getReader();
  let result;
  let offset = 0;
  const offsets = [];
  const times = [];
  let partialLine = "";
  const decoderOptions = { stream: true };

  // `t = 1e7` is as ordinary as `t = 10000000`, so this parses rather than
  // reading digits. An unreadable step becomes NaN and never matches anything —
  // deliberately, since 0 is a real step and a frame falsely claiming it would
  // be matched against an observable's first block.
  const readTime = (line) => Number.parseFloat(line.slice(line.indexOf("=") + 1).trim());

  while (!(result = await reader.read()).done) {
    const chunk = result.value;
    const textChunk = decoder.decode(chunk, decoderOptions);
    // Split on "\n" only, keeping any "\r" on the end of each piece. Splitting
    // on /\r?\n/ consumed the carriage return while the offset below still
    // added one byte per line, so every frame in a CRLF trajectory was indexed
    // one byte short per preceding line — enough that file.slice() landed
    // mid-line and parseConfiguration read a body row as a header.
    const lines = (partialLine + textChunk).split("\n");
    partialLine = lines.pop(); // Save the last line in case it's incomplete

    for (const line of lines) {
      if (line.startsWith("t =")) {
        offsets.push(offset);
        times.push(readTime(line));
      }
      offset += line.length + 1; // ASCII: 1 byte per char, including any \r, + 1 for \n
    }
  }

  // Handle the last partial line
  if (partialLine.startsWith("t =")) {
    offsets.push(offset);
    times.push(readTime(partialLine));
  }

  return { offsets, times };
};

// Function to parse a configuration from lines
export const parseConfiguration = (lines) => {
  let i = 0;
  const timeLine = lines[i++].trim();
  const time = parseFloat(timeLine.split("=")[1].trim());

  const bLine = lines[i++].trim();
  const bTokens = bLine.split("=");
  const boxSize = bTokens[1].trim().split(/\s+/).map(Number);

  const eLine = lines[i++].trim();
  const energyTokens = eLine.split("=");
  const energy = energyTokens[1].trim().split(/\s+/).map(Number);

  const positions = [];
  while (i < lines.length) {
    const line = lines[i++].trim();
    if (line === "") continue;
    const tokens = line.split(/\s+/).map(Number);

    // Updated to parse the additional columns
    if (tokens.length >= 9) {
      const [x, y, z, a1x, a1y, a1z, a3x, a3y, a3z] = tokens;
      positions.push({
        x,
        y,
        z,
        a1: { x: a1x, y: a1y, z: a1z },
        a3: { x: a3x, y: a3y, z: a3z },
      });
    } else if (tokens.length >= 3) {
      // Handle case where orientation data is missing
      const [x, y, z] = tokens;
      positions.push({ x, y, z });
    }
  }

  return {
    time,
    boxSize,
    energy,
    positions,
  };
};

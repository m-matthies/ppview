import { detectObservable } from '../observables';
import { isObservablesConfig } from '../observables/config';

/**
 * Content signatures for every supported file type.
 *
 * These are pure predicates over the first lines of a file — no I/O, no
 * orchestration — which keeps the tricky part (telling six similar plain-text
 * formats apart) readable and testable on its own.
 *
 * Order matters in analyzeTopologyFile: SRS springs, then the 2-token header
 * check, then Raspberry, oxDNA nucleotide, Flavio, Lorenzo.
 */

export function isTrajectoryFile(lines) {
  // Trajectory files start with "t = <number>" followed by "b = <box dimensions>" and "E = <energy>"
  if (lines.length < 3) return false;

  const timePattern = /^t\s*=\s*[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/;
  const boxPattern = /^b\s*=\s*[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?\s+[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?\s+[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/;
  const energyPattern = /^E\s*=\s*/;

  // Check if first line is time, second is box dimensions, third is energy
  if (timePattern.test(lines[0]) && boxPattern.test(lines[1]) && energyPattern.test(lines[2])) {
    // Additional check: look for particle position data (should have 9+ numeric columns)
    for (let i = 3; i < Math.min(lines.length, 10); i++) {
      const tokens = lines[i].split(/\s+/);
      if (tokens.length >= 9 && tokens.every(token => !isNaN(parseFloat(token)))) {
        return true;
      }
    }
  }

  // Alternative check: look for multiple "t =" entries (multi-configuration trajectory)
  let timeEntries = 0;
  for (let i = 0; i < Math.min(lines.length, 100); i++) {
    if (timePattern.test(lines[i])) {
      timeEntries++;
      if (timeEntries >= 2) return true;
    }
  }

  return false;
}

/**
 * Analyzes topology file structure to determine type (Lorenzo vs Flavio format)
 * @param {string[]} lines - Lines from the file
 * @returns {string|null} - 'topology-lorenzo' or 'topology-flavio' or null
 */
export function analyzeTopologyFile(lines) {
  if (lines.length < 2) return null;

  // Check for SRS Springs format (Bullview .psp):
  // - First non-comment line has exactly 4 integer tokens
  // - File contains at least one 'iS ' line (spring definition)
  const nonCommentLines = lines.filter(l => !l.startsWith('#'));
  if (nonCommentLines.length >= 1) {
    const firstTokens = nonCommentLines[0].split(/\s+/);
    if (firstTokens.length === 4 && firstTokens.every(t => !isNaN(parseInt(t)))) {
      if (lines.some(l => /^iS\s/.test(l))) {
        return 'topology-srs_springs';
      }
    }
  }

  // Check first line: should be two numbers (particle count and type count)
  const headerTokens = lines[0].split(/\s+/);
  if (headerTokens.length !== 2 || headerTokens.some(token => isNaN(parseInt(token)))) {
    return null;
  }

  const totalParticles = parseInt(headerTokens[0]);
  const typeCount = parseInt(headerTokens[1]);

  if (totalParticles <= 0 || typeCount <= 0) return null;

  // Check for Raspberry format: lines with iP, iR, or iC keywords after header
  if (lines.slice(1).some(line => /^i[PRC]\s/.test(line))) {
    return 'topology-raspberry';
  }

  // Check second line to distinguish formats
  const secondLineTokens = lines[1].split(/\s+/);

  // oxDNA nucleotide topology: body lines have format "strandId base n3 n5"
  // where the second token is a single nucleotide letter (A/T/G/C/U)
  if (secondLineTokens.length === 4 && /^[ATGCUatgcu]$/.test(secondLineTokens[1])) {
    return 'topology-oxdna_nucleotide';
  }

  // Flavio format: second line contains particle types (all integers)
  if (secondLineTokens.length === totalParticles && 
      secondLineTokens.every(token => !isNaN(parseInt(token)) && !token.includes('.'))) {
    return 'topology-flavio';
  }

  // Lorenzo format: subsequent lines describe particle types
  // Format: count patchCount patches filename
  if (secondLineTokens.length >= 2) {
    const count = parseInt(secondLineTokens[0]);
    const patchCount = parseInt(secondLineTokens[1]);
    
    if (!isNaN(count) && !isNaN(patchCount) && count > 0 && patchCount >= 0) {
      return 'topology-lorenzo';
    }
  }

  return null;
}

/**
 * Analyzes particle information files (particles.txt, patches.txt)
 * @param {string[]} lines - Lines from the file
 * @param {string} filename - The filename for additional context
 * @returns {string|null}
 */
export function analyzeParticleFile(lines, filename) {
  // Check for particles.txt format
  if (hasParticleFormat(lines)) {
    return 'particles-info';
  }

  // Check for patches.txt format
  if (hasPatchesFormat(lines)) {
    return 'patches-info';
  }

  // Fallback to filename-based detection for these specific files
  // Only accept exact filenames (case-insensitive)
  const lowerFilename = filename.toLowerCase();
  if (lowerFilename === 'particles.txt') {
    return 'particles-info';
  }
  if (lowerFilename === 'patches.txt' || lowerFilename.endsWith('.patch.txt')) {
    return 'patches-info';
  }

  return null;
}

/**
 * Checks if the content matches particles.txt format
 * @param {string[]} lines - Lines from the file
 * @returns {boolean}
 */
export function hasParticleFormat(lines) {
  // Look for particle_X entries and type/patches definitions
  let hasParticleEntry = false;
  let hasTypeEntry = false;

  for (const line of lines.slice(0, 20)) { // Check first 20 lines
    if (/^particle_\d+/.test(line)) {
      hasParticleEntry = true;
    }
    if (/^type\s*=/.test(line)) {
      hasTypeEntry = true;
    }
  }

  return hasParticleEntry && hasTypeEntry;
}

/**
 * Checks if the content matches patches.txt format
 * @param {string[]} lines - Lines from the file
 * @returns {boolean}
 */
export function hasPatchesFormat(lines) {
  // Look for patch_X entries and position/orientation definitions
  let hasPatchEntry = false;
  let hasIdEntry = false;
  let hasPositionEntry = false;
  let hasColorEntry = false;
  let hasStrengthEntry = false;
  let hasA1Entry = false;
  let hasA2Entry = false;

  for (const line of lines.slice(0, 30)) { // Check first 30 lines to find extended format
    if (/^patch_\d+/.test(line)) {
      hasPatchEntry = true;
    }
    if (/^id\s*=/.test(line)) {
      hasIdEntry = true;
    }
    if (/^position\s*=/.test(line)) {
      hasPositionEntry = true;
    }
    if (/^color\s*=/.test(line)) {
      hasColorEntry = true;
    }
    if (/^strength\s*=/.test(line)) {
      hasStrengthEntry = true;
    }
    if (/^a1\s*=/.test(line)) {
      hasA1Entry = true;
    }
    if (/^a2\s*=/.test(line)) {
      hasA2Entry = true;
    }
  }

  // Standard flavio format: patch_X blocks with id and position
  const isStandardFlavio = hasPatchEntry && hasIdEntry && hasPositionEntry;
  
  // Extended flavio format: patch_X blocks with additional fields like color, strength, a1, a2
  const isExtendedFlavio = hasPatchEntry && hasIdEntry && (hasColorEntry || hasStrengthEntry || hasA1Entry || hasA2Entry);
  
  return isStandardFlavio || isExtendedFlavio;
}

/**
 * Checks if the file contains patch position data (for Lorenzo format)
 * @param {string[]} lines - Lines from the file
 * @returns {boolean}
 */
export function isPatchFile(lines) {
  // Patch files should contain lines with 3 numeric values (x, y, z coordinates)
  let numericLineCount = 0;
  
  for (const line of lines.slice(0, 10)) { // Check first 10 lines
    const tokens = line.split(/\s+/);
    if (tokens.length === 3 && tokens.every(token => !isNaN(parseFloat(token)))) {
      numericLineCount++;
    }
  }

  // If most lines are 3D coordinates, it's likely a patch file
  return numericLineCount >= Math.min(3, lines.length * 0.7);
}

/**
 * Checks if the file is an input file (contains simulation parameters)
 * @param {string[]} lines - Lines from the file
 * @param {string} filename - The filename for additional context
 * @returns {boolean}
 */
export function isInputFile(lines, filename) {
  // Check filename first - must contain 'input' (case insensitive)
  if (!filename.toLowerCase().includes('input')) {
    return false;
  }
  
  // Look for common input file patterns
  let hasKeyValuePairs = false;
  let hasSimulationParams = false;
  
  for (const line of lines.slice(0, 50)) { // Check first 50 lines
    // Look for key = value patterns
    if (/^\w+\s*=\s*.+/.test(line)) {
      hasKeyValuePairs = true;
    }
    // Look for common simulation parameters
    if (/(steps|temperature|density|box|particle|interaction|backend|topology|trajectory|conf_file|lastconf_file|trajectory_file)/i.test(line)) {
      hasSimulationParams = true;
    }
  }
  
  return hasKeyValuePairs && hasSimulationParams;
}

/**
 * Parses an input file and extracts simulation parameters
 * @param {string} content - The full content of the input file
 * @returns {Object} - Parsed parameters
 */

export function isMGLFile(lines) {
  if (lines.length < 1) return false;

  // Look for MGL format indicators:
  // 1. Lines with '@' separator (x y z @ radius C[color] ...)
  // 2. Color specifications with C[color] format
  // 3. Type indicators: C, D, M, I, E after color
  
  let mglLineCount = 0;
  let hasValidMGLContent = false;
  let boxCount = 0;

  for (const line of lines.slice(0, 20)) {
    // Count .Box: or .Vol: headers
    if (line.startsWith('.Box:') || line.startsWith('.Vol:')) {
      boxCount++;
      hasValidMGLContent = true;
      continue;
    }
    
    // Check for MGL particle format: x y z @ radius C[color] [type-specific data]
    if (line.includes('@')) {
      const parts = line.split('@');
      if (parts.length === 2) {
        // Check position part (should be 3 numbers)
        const posTokens = parts[0].trim().split(/\s+/);
        if (posTokens.length === 3 && posTokens.every(token => !isNaN(parseFloat(token)))) {
          // Check radius/color part
          const radiusColorPart = parts[1].trim().split(/\s+/);
          if (radiusColorPart.length >= 2 && !isNaN(parseFloat(radiusColorPart[0]))) {
            // Look for C[color] format or type indicators (C, D, M, I, E)
            if (radiusColorPart.some(token => 
              token.startsWith('C[') || 
              ['C', 'D', 'M', 'I', 'E'].includes(token)
            )) {
              mglLineCount++;
              hasValidMGLContent = true;
            }
          }
        }
      }
    }
  }

  // If we have .Box: or .Vol: headers, this should be treated as a trajectory
  // Return false here so it gets caught by isMGLTrajectoryFile
  if (boxCount > 0) {
    return false;
  }

  // Only return true for pure MGL content without .Box: or .Vol: headers
  return hasValidMGLContent && mglLineCount >= 1;
}

/**
 * Detects MGL trajectory files (multiple concatenated MGL files)
 * @param {string[]} lines - Lines from the file
 * @returns {boolean}
 */
export function isMGLTrajectoryFile(lines) {
  if (lines.length < 1) return false;

  // Look for trajectory-specific patterns:
  // 1. .Box: or .Vol: headers (even just one makes it a trajectory)
  // 2. MGL particle content with '@' format
  
  let boxOrVolCount = 0;
  let hasMGLContent = false;

  for (let i = 0; i < Math.min(lines.length, 100); i++) {
    const line = lines[i];
    
    // Check for box/volume headers
    if (/^\.Box:|^\.Vol:/.test(line)) {
      boxOrVolCount++;
    }
    
    // Check for MGL particle content with '@' separator
    if (line.includes('@')) {
      const parts = line.split('@');
      if (parts.length === 2) {
        const posTokens = parts[0].trim().split(/\s+/);
        if (posTokens.length === 3 && posTokens.every(token => !isNaN(parseFloat(token)))) {
          const radiusColorPart = parts[1].trim().split(/\s+/);
          if (radiusColorPart.length >= 2 && !isNaN(parseFloat(radiusColorPart[0]))) {
            // Look for C[color] format or type indicators
            if (radiusColorPart.some(token => 
              token.startsWith('C[') || 
              ['C', 'D', 'M', 'I', 'E'].includes(token)
            )) {
              hasMGLContent = true;
            }
          }
        }
      }
    }
  }

  // A .Box:/.Vol: header is what makes this a trajectory — even a single one,
  // since a one-frame trajectory is still a trajectory.
  //
  // The second half of this used to read `(hasMGLContent && boxOrVolCount >= 0)`,
  // where the right operand is true for any count, so a headerless MGL file
  // matched here too. detectFileType checks this predicate first, which made
  // isMGLFile unreachable and classified every .mgl file as a trajectory.
  // Exactly one of the two must claim a file.
  //
  // Both conditions, not just the header: a file that merely opens with a
  // ".Box:" line but carries no MGL particles is not a trajectory either.
  return boxOrVolCount >= 1 && hasMGLContent;
}

/**
 * A clusters file: JSON holding an array of clusters, each naming the particles
 * that belong to it.
 *
 * Detected from content rather than the .json extension alone, so an unrelated
 * JSON file dropped alongside a simulation is not mistaken for clustering.
 * Only the head of the file is available here, so this looks for the shape
 * rather than parsing — a large clusters file will be truncated mid-array.
 */
export function isClusterFile(lines, filename) {
  const head = lines.join('\n');
  if (!/\.json$/i.test(filename) && !/^\s*[[{]/.test(head)) return false;
  const mentionsParticles = /"(particles|indices|ids)"\s*:\s*\[/.test(head);
  const looksLikeClusters = /"clusters"\s*:\s*\[/.test(head) || /^\s*\[/.test(head);
  return mentionsParticles && (looksLikeClusters || /\.json$/i.test(filename));
}

/**
 * Output from one of the patchy-particle cluster/bond observables.
 *
 * These arrive beside a simulation as `.txt` or `.dat`, so they have to be told
 * apart by content — and `.dat` in particular is what the trajectory fallback
 * claims by name, so `detectFileType` asks this before it asks about
 * trajectories.
 *
 * The signatures themselves live with the parsers, in
 * `src/formats/observables`, so a fourth observable is one entry in one table.
 */
export function isObservableFile(lines) {
  return detectObservable(lines) !== null;
}

/**
 * oxDNA's observables definition file, named by `observables_file` in the input.
 *
 * Worth recognising for one reason: it states `print_every`, which is the only
 * way to line up an observable that writes no step numbers with a trajectory
 * printed on a different interval.
 */
export function isObservablesConfigFile(lines) {
  return isObservablesConfig(lines.join('\n'));
}

/**
 * Reads the head of a file and names its type.
 */
import {
  isTrajectoryFile,
  analyzeTopologyFile,
  analyzeParticleFile,
  isPatchFile,
  isInputFile,
  isMGLFile,
  isMGLTrajectoryFile,
  isClusterFile,
} from './signatures';

export async function detectFileType(file) {
  try {
    // Read the first few KB of the file to analyze structure
    const chunkSize = Math.min(file.size, 8192); // Read first 8KB
    const chunk = file.slice(0, chunkSize);
    const text = await chunk.text();
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length === 0) {
      return 'unknown';
    }

    // Clusters first: it is JSON, so none of the plain-text signatures below
    // could claim it, but checking early keeps the intent obvious.
    if (isClusterFile(lines, file.name)) {
      return 'clusters';
    }

    // Check for trajectory file pattern
    if (isTrajectoryFile(lines)) {
      return 'trajectory';
    }

    // Check for topology file patterns
    const topologyType = analyzeTopologyFile(lines);
    if (topologyType) {
      return topologyType;
    }

    // Check for particle information files
    const particleFileType = analyzeParticleFile(lines, file.name);
    if (particleFileType) {
      return particleFileType;
    }

    // Check for MGL trajectory files first (more specific)
    if (isMGLTrajectoryFile(lines)) {
      return 'mgl-trajectory';
    }

    // Check for MGL files
    if (isMGLFile(lines)) {
      return 'mgl';
    }

  // Check for patch files
  if (isPatchFile(lines)) {
    return 'patch';
  }

  // Check for input files
  if (isInputFile(lines, file.name)) {
    return 'input';
  }

  return 'unknown';
  } catch (error) {
    console.warn(`Error detecting file type for ${file.name}:`, error);
    return 'unknown';
  }
}

/**
 * Detects trajectory files by looking for the characteristic format
 * @param {string[]} lines - Lines from the file
 * @returns {boolean}
 */

export async function analyzeFiles(files) {
  const results = [];
  
  for (const file of files) {
    const type = await detectFileType(file);
    results.push({ file, type });
    console.log(`Detected file type for ${file.name}: ${type}`);
  }
  
  return results;
}

/**
 * Detects single MGL files by looking for characteristic MGL format
 * @param {string[]} lines - Lines from the file
 * @returns {boolean}
 */

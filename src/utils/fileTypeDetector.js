/**
 * File Type Detector - Identifies file types based on content analysis
 * rather than just file extensions
 */

/**
 * Analyzes file content to determine its type
 * @param {File} file - The file to analyze
 * @returns {Promise<string>} - The detected file type
 */
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
function isTrajectoryFile(lines) {
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
function analyzeTopologyFile(lines) {
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
function analyzeParticleFile(lines, filename) {
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
function hasParticleFormat(lines) {
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
function hasPatchesFormat(lines) {
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
function isPatchFile(lines) {
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
function isInputFile(lines, filename) {
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
export function parseInputFile(content) {
  const params = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    // Parse key = value pairs
    const match = trimmed.match(/^(\w+)\s*=\s*(.+)/);
    if (match) {
      const key = match[1];
      const value = match[2].trim();
      
      // Try to parse numeric values
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        params[key] = numValue;
      } else {
        params[key] = value;
      }
    }
  }
  
  return params;
}

/**
 * Categorizes files based on detected types for easier processing
 * @param {Array} filesWithTypes - Array of {file, type} objects
 * @returns {Object} - Categorized files
 */
export function categorizeFiles(filesWithTypes) {
  const categorized = {
    topology: null,
    trajectory: null,
    particlesInfo: null,
    patchesInfo: null,
    patchFiles: [],
    mglFile: null,
    mglTrajectory: null,
    inputFile: null,
    unknown: []
  };

  // Collect all trajectory files for prioritization
  const trajectoryFiles = [];

  filesWithTypes.forEach(({file, type}) => {
    switch (type) {
      case 'topology-lorenzo':
      case 'topology-flavio':
      case 'topology-raspberry':
      case 'topology-srs_springs':
      case 'topology-oxdna_nucleotide':
        categorized.topology = {file, format: type.split('-').slice(1).join('_')};
        break;
      case 'trajectory':
        trajectoryFiles.push(file);
        break;
      case 'particles-info':
        categorized.particlesInfo = file;
        break;
      case 'patches-info':
        categorized.patchesInfo = file;
        break;
      case 'patch':
        categorized.patchFiles.push(file);
        break;
      case 'mgl':
        categorized.mglFile = file;
        break;
      case 'mgl-trajectory':
        categorized.mglTrajectory = file;
        break;
      case 'input':
        categorized.inputFile = file;
        break;
      default:
        categorized.unknown.push(file);
    }
  });

  // Apply trajectory file prioritization: trajectory > last > init
  if (trajectoryFiles.length > 0) {
    categorized.trajectory = selectBestTrajectoryFile(trajectoryFiles);
  }

  return categorized;
}

/**
 * Selects the best trajectory file when multiple are available
 * Priority: trajectory > last > init > others
 * @param {File[]} trajectoryFiles - Array of trajectory files
 * @returns {File} - The selected trajectory file
 */
function selectBestTrajectoryFile(trajectoryFiles) {
  if (trajectoryFiles.length === 1) {
    return trajectoryFiles[0];
  }

  console.log(`Found ${trajectoryFiles.length} trajectory files, applying prioritization...`);
  
  // Define priority keywords in order of preference
  const priorityKeywords = [
    { keywords: ['traj'], priority: 1, name: 'trajectory' },
    { keywords: ['last'], priority: 2, name: 'last configuration' },
    { keywords: ['init'], priority: 3, name: 'initial configuration' }
  ];

  // Score each file based on filename
  const scoredFiles = trajectoryFiles.map(file => {
    const fileName = file.name.toLowerCase();
    let priority = 999; // Default low priority
    let matchedType = 'other';
    
    // Check for priority keywords
    for (const { keywords, priority: keywordPriority, name } of priorityKeywords) {
      if (keywords.some(keyword => fileName.includes(keyword))) {
        priority = keywordPriority;
        matchedType = name;
        break;
      }
    }
    
    return {
      file,
      priority,
      matchedType,
      fileName
    };
  });

  // Sort by priority (lower number = higher priority)
  scoredFiles.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // If same priority, prefer alphabetically first
    return a.fileName.localeCompare(b.fileName);
  });

  const selectedFile = scoredFiles[0];
  console.log(`Selected trajectory file: ${selectedFile.fileName} (type: ${selectedFile.matchedType})`);
  
  // Log the prioritization results
  console.log('Trajectory file prioritization:');
  scoredFiles.forEach((scored, index) => {
    const status = index === 0 ? '✓ SELECTED' : '  skipped';
    console.log(`  ${status}: ${scored.fileName} (${scored.matchedType}, priority: ${scored.priority})`);
  });

  return selectedFile.file;
}

/**
 * Analyzes all files and returns their detected types
 * @param {File[]} files - Array of files to analyze
 * @returns {Promise<Array>} - Array of {file, type} objects
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
function isMGLFile(lines) {
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
function isMGLTrajectoryFile(lines) {
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

  // Consider it MGL trajectory if:
  // - Has any .Box: or .Vol: headers (even one header makes it a trajectory)
  // - OR has valid MGL content with potential for multiple frames
  return boxOrVolCount >= 1 || (hasMGLContent && boxOrVolCount >= 0);
}

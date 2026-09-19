/**
 * Sorts analysed files into the roles the app loads them into.
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
    clusterFiles: [],
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
      case 'clusters':
        categorized.clusterFiles.push(file);
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

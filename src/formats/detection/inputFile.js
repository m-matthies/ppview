/**
 * oxDNA input files: plain `key = value` simulation parameters.
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

/**
 * MGL Parser - Handles parsing of MGL format files
 * Supports both single MGL files and MGL trajectory files
 */

// Scaling factor for MGL geometry
const MGL_SCALE = 1.0;

// Color mapping for MGL color names
const MGL_COLORS = {
  'red': { r: 1.0, g: 0.0, b: 0.0 },
  'green': { r: 0.0, g: 1.0, b: 0.0 },
  'blue': { r: 0.0, g: 0.0, b: 1.0 },
  'yellow': { r: 1.0, g: 1.0, b: 0.0 },
  'cyan': { r: 0.0, g: 1.0, b: 1.0 },
  'magenta': { r: 1.0, g: 0.0, b: 1.0 },
  'violet': { r: 0.5, g: 0.0, b: 1.0 },
  'orange': { r: 1.0, g: 0.5, b: 0.0 },
  'white': { r: 1.0, g: 1.0, b: 1.0 },
  'black': { r: 0.0, g: 0.0, b: 0.0 },
  'grey': { r: 0.5, g: 0.5, b: 0.5 },
  'gray': { r: 0.5, g: 0.5, b: 0.5 },
  'pink': { r: 1.0, g: 0.75, b: 0.8 },
  'brown': { r: 0.6, g: 0.3, b: 0.1 },
  'purple': { r: 0.5, g: 0.0, b: 0.5 }
};

/**
 * Parses MGL color from string format
 * @param {string} colorStr - Color string (e.g., "C[blue]", "C[#aaaaaa]", "C[0,1,0,1]", or direct color names)
 * @returns {object} - Color object with r, g, b, opacity
 */
function materialFromMGLColor(colorStr) {
  if (!colorStr) return { r: 0.5, g: 0.5, b: 0.5, opacity: 1.0 };
  
  // Handle C[...] format
  const colorMatch = colorStr.match(/C\[([^\]]+)\]/);
  if (colorMatch) {
    const colorContent = colorMatch[1];
    
    // Check for hexadecimal color (e.g., #aaaaaa)
    if (colorContent.startsWith('#')) {
      const hex = colorContent.substring(1);
      if (hex.length === 6) {
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        return { r, g, b, opacity: 1.0 };
      }
    }
    
    // Check for RGBA format (e.g., 0,1,0,1)
    if (colorContent.includes(',')) {
      const rgbaTokens = colorContent.split(',').map(s => parseFloat(s.trim()));
      if (rgbaTokens.length >= 3 && rgbaTokens.every(v => !isNaN(v))) {
        const r = Math.max(0, Math.min(1, rgbaTokens[0]));
        const g = Math.max(0, Math.min(1, rgbaTokens[1]));
        const b = Math.max(0, Math.min(1, rgbaTokens[2]));
        const opacity = rgbaTokens.length >= 4 ? Math.max(0, Math.min(1, rgbaTokens[3])) : 1.0;
        return { r, g, b, opacity };
      }
    }
    
    // Check for named color
    const colorName = colorContent.toLowerCase();
    if (MGL_COLORS[colorName]) {
      return { ...MGL_COLORS[colorName], opacity: 1.0 };
    }
  }
  
  // Handle direct color name (without C[...])
  const directColor = colorStr.toLowerCase();
  if (MGL_COLORS[directColor]) {
    return { ...MGL_COLORS[directColor], opacity: 1.0 };
  }
  
  // Handle space-separated RGB/RGBA values
  const tokens = colorStr.split(/\s+/);
  if (tokens.length >= 3) {
    const r = parseFloat(tokens[0]);
    const g = parseFloat(tokens[1]);
    const b = parseFloat(tokens[2]);
    const opacity = tokens.length >= 4 ? parseFloat(tokens[3]) : 1.0;
    
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      return {
        r: Math.max(0, Math.min(1, r)),
        g: Math.max(0, Math.min(1, g)),
        b: Math.max(0, Math.min(1, b)),
        opacity: Math.max(0, Math.min(1, opacity))
      };
    }
  }
  
  // Default color if parsing fails
  return { r: 0.5, g: 0.5, b: 0.5, opacity: 1.0 };
}

/**
 * Parses a single MGL file
 * @param {string} content - File content
 * @returns {object} - Parsed MGL data with particles and metadata
 */
export function readMGL(content) {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#'));
  const particles = [];
  let boundingBox = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity }
  };
  
  lines.forEach(line => {
    // Parse .Box: or .Vol: header for box dimensions
    if (line.startsWith('.Box:')) {
      const boxDataStr = line.substring(5).trim();
      const tokens = boxDataStr.split(',');
      if (tokens.length === 3) {
        const dims = tokens.map(t => parseFloat(t.trim())).filter(n => !isNaN(n));
        if (dims.length === 3) {
          boundingBox = {
            min: { x: 0, y: 0, z: 0 },
            max: { x: dims[0], y: dims[1], z: dims[2] }
          };
        }
      }
      return;
    }
    
    if (line.startsWith('.Vol:')) {
      const volumeStr = line.substring(5).trim();
      const volume = parseFloat(volumeStr);
      if (!isNaN(volume)) {
        const side = Math.cbrt(volume);
        boundingBox = {
          min: { x: 0, y: 0, z: 0 },
          max: { x: side, y: side, z: side }
        };
      }
      return;
    }
    
    const shapes = parseMGLLine(line);
    if (shapes) {
      // Handle grouped shapes (separated by G)
      shapes.forEach(particle => {
        particles.push(particle);
        updateBoundingBox(boundingBox, particle.position);
      });
    }
  });

  return {
    particles,
    boundingBox,
    frameCount: 1
  };
}

/**
 * Parses MGL trajectory file (multiple concatenated MGL files)
 * @param {string} content - File content
 * @returns {object} - Parsed trajectory data with frames
 */
export function readMGLTrajectory(content) {
  const lines = content.trim().split('\n');
  const frames = [];
  let currentFrame = null;
  let boundingBox = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity }
  };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines and comments
    if (line === '' || line.startsWith('#')) continue;
    
    // Check for frame headers (.Box: or .Vol:)
    if (line.startsWith('.Box:') || line.startsWith('.Vol:')) {
      // Save previous frame if exists
      if (currentFrame) {
        frames.push(currentFrame);
      }
      
      // Start new frame
      currentFrame = {
        header: line,
        boxDimensions: null,
        particles: [],
        frameIndex: frames.length
      };
      
      // Parse box dimensions from header
      if (line.startsWith('.Box:')) {
        const boxDataStr = line.substring(5).trim();
        const tokens = boxDataStr.split(',');
        if (tokens.length === 3) {
          const dims = tokens.map(t => parseFloat(t.trim())).filter(n => !isNaN(n));
          if (dims.length === 3) {
            currentFrame.boxDimensions = dims;
          }
        }
      } else if (line.startsWith('.Vol:')) {
        const volumeStr = line.substring(5).trim();
        const volume = parseFloat(volumeStr);
        if (!isNaN(volume)) {
          const side = Math.cbrt(volume);
          currentFrame.boxDimensions = [side, side, side];
        }
      }
      continue;
    }
    
    // If no frame started yet, create a default one
    if (!currentFrame) {
      currentFrame = {
        header: 'Frame 0',
        boxDimensions: [34.199520111084, 34.199520111084, 34.199520111084], // Default box size
        particles: [],
        frameIndex: 0
      };
    }
    
    // Parse particle data
    if (line.length > 0) {
      const shapes = parseMGLLine(line);
      if (shapes) {
        // Handle grouped shapes (separated by G)
        for (const particle of shapes) {
          // Add frame-specific metadata
          particle.frameIndex = currentFrame.frameIndex;
          currentFrame.particles.push(particle);

          // Update global bounding box
          updateBoundingBox(boundingBox, particle.position);
        }
      }
    }
  }
  
  // Add the last frame
  if (currentFrame) {
    frames.push(currentFrame);
  }
  
  return {
    frames,
    boundingBox,
    frameCount: frames.length,
    totalParticles: frames.reduce((sum, frame) => sum + frame.particles.length, 0)
  };
}

/**
 * Parses a single MGL line with new MGL format
 * Format: x y z @ radius C[color] [type-specific data]
 * Supports groups separated by 'G'
 * @param {string} line - MGL line string
 * @returns {Array|null} - Array of parsed particle objects or null if invalid
 */
function parseMGLLine(line) {
  if (!line || line.trim() === '') return null;
  
  // Split by 'G' to handle grouped shapes
  const shapes = line.split(' G ').map(s => s.trim());
  const particles = [];
  
  for (const shapeStr of shapes) {
    const particle = parseSingleMGLShape(shapeStr);
    if (particle) {
      particles.push(particle);
    }
  }
  
  return particles.length > 0 ? particles : null;
}

/**
 * Parses a single MGL shape according to the new specification
 * @param {string} shapeStr - Single shape string
 * @returns {object|null} - Parsed particle object or null if invalid
 */
function parseSingleMGLShape(shapeStr) {
  if (!shapeStr || shapeStr.trim() === '') return null;
  
  // Split by '@' to separate position from radius/color/type-specific data
  const parts = shapeStr.split('@');
  if (parts.length !== 2) return null;
  
  // Parse position (x y z)
  const positionPart = parts[0].trim().split(/\s+/);
  if (positionPart.length !== 3) return null;
  
  const x = parseFloat(positionPart[0]);
  const y = parseFloat(positionPart[1]);
  const z = parseFloat(positionPart[2]);
  
  if (isNaN(x) || isNaN(y) || isNaN(z)) return null;
  
  // Parse radius, color, and type-specific data
  const tokens = parts[1].trim().split(/\s+/);
  if (tokens.length < 2) return null;
  
  const radius = parseFloat(tokens[0]);
  if (isNaN(radius)) return null;
  
  const colorToken = tokens[1];
  const color = materialFromMGLColor(colorToken);
  
  // Base particle object
  const particle = {
    type: 'sphere', // Default type
    position: { x, y, z },
    radius,
    color,
    patches: [],
    properties: {}
  };
  
  // Check for type-specific indicators and parse accordingly
  let i = 2;
  while (i < tokens.length) {
    const token = tokens[i];
    
    if (token === 'C') {
      // Cylinder: C ax ay az
      particle.type = 'cylinder';
      if (i + 3 < tokens.length) {
        const ax = parseFloat(tokens[i + 1]);
        const ay = parseFloat(tokens[i + 2]);
        const az = parseFloat(tokens[i + 3]);
        if (!isNaN(ax) && !isNaN(ay) && !isNaN(az)) {
          particle.axis = { x: ax, y: ay, z: az };
          particle.length = Math.sqrt(ax*ax + ay*ay + az*az);
        }
        i += 4;
      } else {
        i++;
      }
    } else if (token === 'D') {
      // Dipolar sphere: D dx dy dz C[arrow_color]
      particle.type = 'dipolar';
      if (i + 3 < tokens.length) {
        const dx = parseFloat(tokens[i + 1]);
        const dy = parseFloat(tokens[i + 2]);
        const dz = parseFloat(tokens[i + 3]);
        if (!isNaN(dx) && !isNaN(dy) && !isNaN(dz)) {
          particle.dipole = { x: dx, y: dy, z: dz };
        }
        i += 4;
        // Parse arrow color if present
        if (i < tokens.length && tokens[i].startsWith('C[')) {
          particle.arrowColor = materialFromMGLColor(tokens[i]);
          i++;
        }
      } else {
        i++;
      }
    } else if (token === 'M') {
      // Patchy particle: M p1x p1y p1z p1w C[p1color] p2x p2y p2z p2w C[p2color] ...
      particle.type = 'patchy';
      i++;
      while (i + 4 < tokens.length) {
        const px = parseFloat(tokens[i]);
        const py = parseFloat(tokens[i + 1]);
        const pz = parseFloat(tokens[i + 2]);
        const pw = parseFloat(tokens[i + 3]);
        const patchColorToken = tokens[i + 4];
        
        if (!isNaN(px) && !isNaN(py) && !isNaN(pz) && !isNaN(pw) && patchColorToken && patchColorToken.startsWith('C[')) {
          const patch = {
            position: { x: px, y: py, z: pz },
            halfWidth: pw, // in radians
            color: materialFromMGLColor(patchColorToken),
            patchId: particle.patches.length
          };
          particle.patches.push(patch);
          i += 5;
        } else {
          break;
        }
      }
    } else if (token === 'I') {
      // Icosahedron: I x1 x2 x3 z1 z2 z3
      particle.type = 'icosahedron';
      if (i + 6 < tokens.length) {
        const x1 = parseFloat(tokens[i + 1]);
        const x2 = parseFloat(tokens[i + 2]);
        const x3 = parseFloat(tokens[i + 3]);
        const z1 = parseFloat(tokens[i + 4]);
        const z2 = parseFloat(tokens[i + 5]);
        const z3 = parseFloat(tokens[i + 6]);
        
        if ([x1, x2, x3, z1, z2, z3].every(v => !isNaN(v))) {
          particle.xAxis = { x: x1, y: x2, z: x3 };
          particle.zAxis = { x: z1, y: z2, z: z3 };
        }
        i += 7;
      } else {
        i++;
      }
    } else if (token === 'E') {
      // Ellipsoid: E sa1 sa2 sa3 a11 a12 a13 a21 a22 a23
      particle.type = 'ellipsoid';
      if (i + 9 < tokens.length) {
        const sa1 = parseFloat(tokens[i + 1]);
        const sa2 = parseFloat(tokens[i + 2]);
        const sa3 = parseFloat(tokens[i + 3]);
        const a11 = parseFloat(tokens[i + 4]);
        const a12 = parseFloat(tokens[i + 5]);
        const a13 = parseFloat(tokens[i + 6]);
        const a21 = parseFloat(tokens[i + 7]);
        const a22 = parseFloat(tokens[i + 8]);
        const a23 = parseFloat(tokens[i + 9]);
        
        if ([sa1, sa2, sa3, a11, a12, a13, a21, a22, a23].every(v => !isNaN(v))) {
          particle.semiAxes = { x: sa1, y: sa2, z: sa3 };
          particle.axis1 = { x: a11, y: a12, z: a13 };
          particle.axis2 = { x: a21, y: a22, z: a23 };
        }
        i += 10;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  
  return particle;
}

/**
 * Parses a single MGL shape from a line (legacy format)
 * @param {string} shapeStr - Shape string
 * @returns {object|null} - Parsed particle object or null if invalid
 */
function parseMGLShape(shapeStr) {
  if (!shapeStr || shapeStr.trim() === '') return null;
  
  const tokens = shapeStr.split(/\s+/);
  if (tokens.length < 7) return null; // Minimum required tokens
  
  const type = tokens[0];
  const x = parseFloat(tokens[1]) * MGL_SCALE;
  const y = parseFloat(tokens[2]) * MGL_SCALE;
  const z = parseFloat(tokens[3]) * MGL_SCALE;
  const radius = parseFloat(tokens[4]) * MGL_SCALE;
  
  // Basic validation
  if (isNaN(x) || isNaN(y) || isNaN(z) || isNaN(radius)) return null;
  
  const particle = {
    type,
    position: { x, y, z },
    radius,
    color: { r: 0.5, g: 0.5, b: 0.5, opacity: 1.0 }, // Default color
    patches: [],
    properties: {}
  };
  
  let tokenIndex = 5;
  
  // Parse based on particle type
  switch (type.toUpperCase()) {
    case 'S': // Sphere
      particle.color = materialFromMGLColor(tokens.slice(tokenIndex).join(' '));
      break;
      
    case 'M': // Patchy particle
      // Parse patches
      if (tokenIndex < tokens.length) {
        try {
          const patchCount = parseInt(tokens[tokenIndex]);
          tokenIndex++;
          
          for (let i = 0; i < patchCount && tokenIndex + 6 < tokens.length; i++) {
            const patch = {
              position: {
                x: parseFloat(tokens[tokenIndex]) * MGL_SCALE,
                y: parseFloat(tokens[tokenIndex + 1]) * MGL_SCALE,
                z: parseFloat(tokens[tokenIndex + 2]) * MGL_SCALE
              },
              color: materialFromMGLColor(`${tokens[tokenIndex + 3]} ${tokens[tokenIndex + 4]} ${tokens[tokenIndex + 5]}`),
              patchId: i
            };
            particle.patches.push(patch);
            tokenIndex += 6;
          }
        } catch (e) {
          console.warn('Error parsing patches for patchy particle:', e);
        }
      }
      // Remaining tokens are particle color
      if (tokenIndex < tokens.length) {
        particle.color = materialFromMGLColor(tokens.slice(tokenIndex).join(' '));
      }
      break;
      
    case 'C': // Cylinder
      // Parse axis vector (next 3 tokens)
      if (tokenIndex + 2 < tokens.length) {
        particle.axis = {
          x: parseFloat(tokens[tokenIndex]),
          y: parseFloat(tokens[tokenIndex + 1]),
          z: parseFloat(tokens[tokenIndex + 2])
        };
        tokenIndex += 3;
      }
      // Remaining tokens are color
      if (tokenIndex < tokens.length) {
        particle.color = materialFromMGLColor(tokens.slice(tokenIndex).join(' '));
      }
      break;
      
    case 'D': // Dipolar sphere
      // Parse dipole vector (next 3 tokens)
      if (tokenIndex + 2 < tokens.length) {
        particle.dipole = {
          x: parseFloat(tokens[tokenIndex]),
          y: parseFloat(tokens[tokenIndex + 1]),
          z: parseFloat(tokens[tokenIndex + 2])
        };
        tokenIndex += 3;
      }
      // Remaining tokens are color
      if (tokenIndex < tokens.length) {
        particle.color = materialFromMGLColor(tokens.slice(tokenIndex).join(' '));
      }
      break;
      
    default:
      console.warn(`Unknown MGL particle type: ${type}`);
      // Treat as sphere with remaining tokens as color
      if (tokenIndex < tokens.length) {
        particle.color = materialFromMGLColor(tokens.slice(tokenIndex).join(' '));
      }
  }
  
  return particle;
}

/**
 * Updates bounding box with a new position
 * @param {object} boundingBox - Bounding box object
 * @param {object} position - Position object with x, y, z
 */
function updateBoundingBox(boundingBox, position) {
  boundingBox.min.x = Math.min(boundingBox.min.x, position.x);
  boundingBox.min.y = Math.min(boundingBox.min.y, position.y);
  boundingBox.min.z = Math.min(boundingBox.min.z, position.z);
  boundingBox.max.x = Math.max(boundingBox.max.x, position.x);
  boundingBox.max.y = Math.max(boundingBox.max.y, position.y);
  boundingBox.max.z = Math.max(boundingBox.max.z, position.z);
}

/**
 * Converts MGL data to ppview format
 * @param {object} mglData - Parsed MGL data
 * @returns {object} - Data in ppview format
 */
export function convertMGLToPPViewFormat(mglData) {
  const positions = [];
  const particleTypes = new Map();
  let typeIndex = 0;
  
  // Handle single frame or trajectory
  const frames = mglData.frames || [{ particles: mglData.particles }];
  
  // Process first frame for now (ppview expects single configuration)
  const firstFrame = frames[0];
  if (!firstFrame || !firstFrame.particles) {
    throw new Error('No particles found in MGL data');
  }
  
  // Create particle types based on MGL particle colors
  const typeMap = new Map();
  
  firstFrame.particles.forEach((particle, particleIndex) => {
    // Use color as the key for particle type (convert to string for consistent comparison)
    const colorKey = `${particle.color.r}_${particle.color.g}_${particle.color.b}`;
    
    if (!typeMap.has(colorKey)) {
      const particleType = {
        typeIndex: typeIndex++,
        count: 0,
        patchCount: particle.patches.length,
        patches: particle.patches.map((_, i) => i),
        patchPositions: particle.patches.map(patch => patch.position),
        mglType: particle.type,
        mglColor: particle.color, // Store the MGL color for this type
        properties: { ...particle.properties }
      };
      typeMap.set(colorKey, particleType);
      particleTypes.set(particleType.typeIndex, particleType);
    }
    
    typeMap.get(colorKey).count++;
    
    // Convert to ppview position format
    const position = {
      x: particle.position.x,
      y: particle.position.y,
      z: particle.position.z,
      typeIndex: typeMap.get(colorKey).typeIndex,
      particleType: typeMap.get(colorKey),
      mglColor: particle.color,
      mglType: particle.type,
      radius: particle.radius,
      patches: particle.patches
    };
    
    // Add type-specific properties
    if (particle.axis) position.axis = particle.axis;
    if (particle.dipole) position.dipole = particle.dipole;
    
    positions.push(position);
  });
  
  // Calculate box size from bounding box if not provided
  let boxSize = [34.199520111084, 34.199520111084, 34.199520111084]; // Default
  
  if (firstFrame.boxDimensions) {
    boxSize = firstFrame.boxDimensions;
  } else if (mglData.boundingBox) {
    const padding = 2.0;
    boxSize = [
      mglData.boundingBox.max.x - mglData.boundingBox.min.x + padding,
      mglData.boundingBox.max.y - mglData.boundingBox.min.y + padding,
      mglData.boundingBox.max.z - mglData.boundingBox.min.z + padding
    ];
  }
  
  // Create topology data
  const topData = {
    totalParticles: positions.length,
    typeCount: particleTypes.size,
    particleTypes: Array.from(particleTypes.values())
  };
  
  return {
    positions,
    topData,
    boxSize,
    frameData: frames.length > 1 ? frames : null // Include frame data if trajectory
  };
}

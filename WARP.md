# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

PPView is a React-based 3D visualization tool for molecular dynamics simulations, specifically designed for oxDNA systems and patchy particle simulations. It provides interactive visualization with advanced features like clustering analysis, multiple file format support, and real-time trajectory playback.

## Core Technologies

- **Frontend**: React 18.3.1 with Create React App
- **3D Rendering**: Three.js 0.168.0 with React Three Fiber 8.17.7
- **UI Components**: @react-three/drei 9.113.0 for 3D controls
- **File Handling**: Native File API with drag-and-drop support
- **State Management**: React hooks and context
- **Styling**: Custom CSS with responsive design

## Development Commands

### Essential Commands
```bash
# Start development server (opens http://localhost:3000)
npm start

# Run tests in watch mode
npm test

# Build production bundle
npm run build

# Deploy to GitHub Pages
npm run deploy
```

### Testing Commands
```bash
# Run all tests
npm test

# Run specific test file
npm test ClusteringPane.test.js

# Run tests with coverage
npm test -- --coverage
```

## Architecture Overview

### Main Application Structure
- **App.js**: Central component managing file loading, trajectory navigation, and state coordination
- **ParticleScene.js**: Three.js scene setup with lighting, controls, and 3D rendering
- **Particles.js**: Core particle rendering with instanced meshes for performance
- **Patches.js**: Patch visualization as cone geometries pointing inward

### File Format Support
PPView supports multiple topology and trajectory formats through a sophisticated detection system:

#### Topology Formats
- **Lorenzo Format**: Traditional `.top` files with particle type definitions
- **Flavio Format**: Modern format using `particles.txt` and `patches.txt` files
- **MGL Format**: Self-contained molecular graphics format with embedded particle data

#### Trajectory Formats
- **Standard**: `.dat`, `.traj`, `.conf` files with position and orientation data
- **MGL Trajectory**: Multi-frame MGL files with `.Box:` headers

### Key Components

#### Core Visualization
- **FileDropZone**: Handles file upload and format detection
- **SelectableParticle**: Individual particle interaction and selection
- **SelectedParticlesDisplay**: Shows details of selected particles

#### Analysis Features
- **ClusteringPane**: DBSCAN clustering with real-time statistics and histogram visualization
- **ColorSchemeSelector**: Multiple color schemes including colorblind-friendly options
- **ParticleLegend/PatchLegend**: Dynamic legends showing particle types and patch colors

### File Type Detection System

The application uses content-based file detection in `utils/fileTypeDetector.js`:
- **Priority-based**: Trajectory files prioritized by keywords (traj > last > init > conf)
- **Format-specific**: Lorenzo vs Flavio topology detection
- **MGL Support**: Automatic detection of MGL format files
- **Fallback Logic**: Comprehensive fallback for ambiguous files

### Performance Optimizations

- **Instanced Rendering**: Uses Three.js InstancedMesh for efficient particle rendering
- **Demand-based Rendering**: Canvas frameloop set to "demand" to reduce CPU usage
- **Memoized Computations**: Clustering and statistics calculated only when parameters change
- **Lazy Loading**: Trajectory frames loaded on-demand during navigation

## Working with Different File Formats

### Lorenzo Format (Traditional)
```
<particle_count> <type_count>
<count> <patch_count> <patch_ids> <patch_file>
```
- Requires separate patch files for patch positions
- Cumulative particle counting system
- External patch geometry files

### Flavio Format (Modern)
```
<particle_count> <type_count>
<type_per_particle_list>
```
- Requires `particles.txt` and `patches.txt` companion files
- Direct particle-to-type mapping
- Integrated patch definitions with position, color, and strength

### MGL Format (Self-contained)
```
.Box:Lx,Ly,Lz
x y z @ r C[color] [type_data]
```
- No external topology files needed
- Embedded patch definitions with `M` token
- Supports named colors and transparency

## Key Features Implementation

### DBSCAN Clustering
- Real-time clustering with adjustable epsilon distance and minimum points
- Interactive histogram showing cluster size distribution
- Selective cluster highlighting with "show only selected" mode
- Size-ordered cluster list for analysis

### Color Schemes
- Six predefined schemes including colorblind-friendly options
- Persistent storage in localStorage
- Live preview in selector dropdown
- Automatic legend updates

### Export Capabilities
- **Screenshots**: High-resolution PNG capture with 'P' key
- **GLTF Export**: 3D model export with materials, lighting, and clustering state
- **Geometry Preservation**: Maintains particle colors, patch orientations, and selection states

### Trajectory Navigation
- **Playback Controls**: Play/pause with adjustable speed
- **Frame Indexing**: Efficient random access to trajectory frames
- **MGL Trajectories**: Multi-frame MGL file support

## Common Development Tasks

### Adding New File Format Support
1. Extend `utils/fileTypeDetector.js` with new detection logic
2. Add parser in `App.js` handleFilesReceived function
3. Implement data conversion to internal format
4. Update documentation in feature MD files

### Implementing New Analysis Features
1. Create component in `src/components/`
2. Add state management in `App.js`
3. Integrate with ParticleScene props
4. Add UI controls and legends
5. Include in GLTF export if needed

### Performance Optimization
- Use `useMemo` for expensive calculations
- Implement `useCallback` for stable function references
- Consider Three.js instancing for repeated geometries
- Profile with React DevTools and Three.js Stats

### Testing New Components
- Create `.test.js` files alongside components
- Test both UI interactions and computational logic
- Mock Three.js dependencies for unit tests
- Use React Testing Library patterns

## Molecular Dynamics Specifics

### Coordinate Systems
- **oxDNA Convention**: Particles have position (x,y,z) and orientation vectors (a1,a3)
- **Periodic Boundaries**: Automatic wrapping and center-of-mass centering
- **Patch Positioning**: Local patch coordinates transformed by particle rotation matrices

### Scientific Accuracy
- **Patch Directionality**: Cones point inward to particle center, bases show interaction zones
- **Color Coding**: Consistent particle type and patch ID coloring across formats
- **Physical Units**: Distances and angles preserved from simulation data

### Research Applications
- **Aggregation Analysis**: Study particle clustering patterns over time
- **Structural Visualization**: Identify ordered structures and defects
- **Trajectory Analysis**: Compare configurations across simulation frames

## Browser Compatibility

- **WebGL Support**: Required for Three.js 3D rendering
- **Modern ES6+**: Uses async/await, destructuring, modules
- **File API**: Drag-and-drop requires modern browser support
- **Local Storage**: Color schemes and preferences persist across sessions

## Deployment

The application is configured for GitHub Pages deployment:
- **Build Process**: Creates optimized production bundle
- **Homepage**: Set to `https://m-matthies.github.io/ppview`
- **Asset Optimization**: Includes hash-based filenames for caching
- **Static Hosting**: All processing happens client-side

## Troubleshooting

### Common File Loading Issues
- **Format Misdetection**: Check file extensions and content format
- **Memory Limits**: Large trajectory files may exceed browser limits
- **Patch File Missing**: Lorenzo format requires separate patch files

### Performance Issues
- **Large Particle Counts**: Consider reducing particle detail or using clustering
- **Heavy Trajectories**: Implement frame caching or reduce update frequency
- **Rendering Slowdown**: Check Three.js Stats component for bottlenecks

### Browser Compatibility
- **WebGL Errors**: Ensure hardware acceleration is enabled
- **File API Issues**: Modern browsers only for drag-and-drop
- **Memory Warnings**: Large datasets may need browser optimization

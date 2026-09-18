# PPView - Patchy Particle Viewer

A React-based visualization tool for molecular dynamics simulations, specifically designed for oxDNA systems and patchy particle models. This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Features

### Core Visualization
- Interactive 3D particle visualization using Three.js and React Three Fiber
- Support for trajectory playback with controls
- Particle and patch rendering with customizable color schemes
- Simulation box visualization with optional backdrop planes and coordinate axes
- Screenshot and GLTF export capabilities
- Path tracer mode (`@react-three/gpu-pathtracer`) for photorealistic rendering

### Particle Types
- **Standard spherical particles** — rendered as instanced spheres
- **Raspberry particles** — multi-bead particles with an inner core and outer repulsion beads; only the outer beads are visible and selectable
- **SRS Springs particles** — spring-bonded particle chains with directional binding patches
- **oxDNA nucleotides** — full nucleotide representation with backbone beads, nucleoside ellipsoids, and connector cylinders

### Patch Visualization
- Patches rendered as outward-pointing cones on the particle surface
- Cone size proportional to particle radius (scales correctly for all formats)
- Color-coded by patch ID using the active color scheme
- Rotation matrix applied from trajectory orientation vectors

### Spring Bond Visualization
- Spring bonds between particles rendered as instanced cylinders
- Springs longer than half the minimum box dimension are hidden (periodic boundary artifact filter)
- Spring radius proportional to particle radius

### Clustering Analysis
- **DBSCAN Clustering**: Automatically cluster particles based on spatial proximity
- **Interactive Parameters**:
  - Epsilon distance: Control the maximum distance between particles in a cluster
  - Minimum points: Set the minimum number of particles required to form a cluster
- **Real-time Statistics**: View cluster counts, sizes, and noise particles
- **Size Distribution Histogram**: Shows how many clusters have each particle count
- **Selective Highlighting**:
  - Choose which clusters to highlight from the cluster list
  - Option to show only selected clusters (dims non-selected particles)
  - Highlighted clusters maintain their original particle colors but are scaled larger

### oxDNA Nucleotide Visualization
When a standard oxDNA topology (`.top`) is loaded, PPView automatically switches to the nucleotide representation matching the oxdna-viewer style:
- **Backbone bead** (sphere r=0.2) — colored by strand, individually selectable
- **Nucleoside** (ellipsoid r=0.3, flattened along the helix axis) — colored by base type: A=blue, G=yellow, C=green, T/U=red
- **ns↔bb connector** (cylinder r=0.1) — colored by strand
- **Backbone connector** (tapered cylinder r=0.1→0.02) — follows the sugar-phosphate backbone along the strand, hidden at periodic boundaries

Strand colors cycle through four distinct colors to match standard DNA duplex conventions. Click a backbone bead to select and inspect it; Ctrl/Cmd+click for multi-selection; double-click to zoom the camera to that nucleotide.

### File Format Support
- Standard oxDNA nucleotide topology (`.top` with `strandId base n3 n5` body lines)
- Lorenzo's topology format (`.top` files)
- Flavio's topology format with `particles.txt` and `patches.txt`
- Raspberry topology format (`.top` with `iP`/`iR`/`iC` keywords)
- SRS Springs topology format (`.psp` with `iP`/`iS` keywords)
- Trajectory files (`.dat`, `.traj`, `.conf`, etc.)
- MGL format (`.mgl`)
- Automatic file type detection and prioritization

### User Interface
- Collapsible control panels
- Particle and patch legends
- Selected particle display
- Responsive design for different screen sizes

## Usage

### Getting Started
1. Start the application using `npm start`
2. Drag and drop your simulation files (topology + trajectory)
3. Use the controls to navigate through the trajectory
4. Enable clustering analysis using the chart icon in the controls

### File Formats

#### Standard oxDNA nucleotide topology
Drop a standard oxDNA `.top` file alongside a `.dat` trajectory. The topology format is:
```
<numNucleotides> <numStrands>
<strandId> <base> <n3> <n5>   # one line per nucleotide; n3/n5 = -1 at chain ends
...
```
PPView automatically detects this format and renders the full nucleotide representation. Backbone beads are clickable and show position and orientation in the selection panel.

#### Lorenzo / Flavio topology
Standard oxDNA `.top` file + `.dat` trajectory, used for patchy particle simulations.

For Flavio format, PPView also reads a particles file and a patches file. Filenames are matched flexibly:
- **Particles**: any file whose name contains `particles` and ends in `.txt` (e.g. `CRYSTAL.particles.txt`, `CRYSTAL.particles (1).txt`)
- **Patches**: any file whose name ends in `.patch.txt` (e.g. `sat3.patch.txt`)

If you also drop an oxDNA **input file** (any file with `input` in its name, e.g. `input_sims`), PPView reads `PATCHY_radius` to set the particle display radius, and uses `particle_file`/`patchy_file` fields to locate the companion files by name.

#### Raspberry particles
Drop a `.top` file using `iP`/`iR`/`iC` keywords alongside a `.dat` trajectory. The inner center particle is hidden; the outer repulsion-site beads are rendered and are individually selectable.

#### SRS Springs (Bullview `.psp`)
Drop a `.psp` topology alongside a `.dat` trajectory. Format:
```
<numParticles> <numStrands> <maxSpringsPerParticle> <repeatedPatchesPerParticle>
iP <id> <color> <strength> <x> <y> <z>   # patch definition
iS <id> <k> <r0> <x> <y> <z>             # spring definition
<particleType> <strand> <radius> <mass> <numPatches> [patchIds...] [neighborIdx springIdx]...
```
Springs between particles are visualized as cylinders. Patches are shown as cones on the particle surface.

### Clustering Analysis
1. **Enable Clustering**: Click the clustering icon in the control panel
2. **Adjust Parameters**:
   - Use the epsilon slider to control cluster detection sensitivity
   - Adjust minimum points to filter small clusters
3. **View Statistics**: Check the real-time cluster statistics and size distribution
4. **Highlight Clusters**:
   - Select individual clusters from the list
   - Use "Show only selected clusters" to focus on specific clusters

### Keyboard Shortcuts
- `P`: Take a screenshot
- `Q/A`: Shift particles along X-axis
- `W/S`: Shift particles along Y-axis
- `E/D`: Shift particles along Z-axis

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run deploy`

Deploys to GitHub Pages at `https://m-matthies.github.io/ppview`.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

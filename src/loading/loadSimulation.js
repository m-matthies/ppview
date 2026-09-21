import { parseTopology } from '../formats/registry';
import { parseInputFile } from '../formats/detection';
import { createFileMap } from '../utils/fileLoader';
import { buildTrajIndex } from '../utils/trajectoryLoader';
import { readMGL, readMGLTrajectory, convertMGLToPPViewFormat } from '../utils/mglParser';
import { pickTopologyFile, pickTrajectoryFile } from './resolveFiles';
import { step, checkpoint, LoadError } from './staleness';

/**
 * Turning a drop of files into a loaded scene.
 *
 * Extracted from a 245-line `handleFilesReceived` whose every concern — reading
 * files, choosing between formats, writing the store, staleness, alerting the
 * user and toggling spinners — was interleaved. What remains here is the
 * sequence; the caller supplies `scene` (the store writers) and decides what to
 * show when something fails.
 *
 * Nothing here touches React. Every `await` goes through `step`, so a load that
 * has been overtaken stops at the next one rather than finishing and clobbering
 * a newer scene.
 */

/** Reads an oxDNA input file, if the drop has one. Never fatal. */
async function readInputFile(categorized, signal, scene) {
  if (!categorized.inputFile) return {};
  try {
    const content = await step(signal, categorized.inputFile.text());
    const params = parseInputFile(content);
    // A radius the files specify, not one the control set: it becomes the
    // baseline that intrinsic geometry is measured against.
    if (params.PATCHY_radius !== undefined) {
      scene.setFormatParticleRadius(params.PATCHY_radius);
    }
    return params;
  } catch (error) {
    if (error.name === 'StaleLoad') throw error;
    console.warn('Could not read the input file; continuing without it:', error.message);
    return {};
  }
}

/** MGL carries its own coordinates, so it needs no topology or trajectory. */
async function loadMgl(categorized, signal, scene) {
  const isTrajectory = !categorized.mglFile;
  const source = categorized.mglFile ?? categorized.mglTrajectory;
  const content = await step(signal, source.text());

  const mglData = isTrajectory ? readMGLTrajectory(content) : readMGL(content);
  const ppview = convertMGLToPPViewFormat(mglData);

  scene.setTopData(ppview.topData);
  scene.setPositions(ppview.positions);
  scene.setCurrentBoxSize(ppview.boxSize);
  scene.setCurrentTime(0);
  scene.setCurrentEnergy([0]);

  const frames = isTrajectory ? mglData.frameCount : 1;
  if (frames > 1) {
    // MGL frames are already in memory, so the "index" is just frame numbers.
    scene.setConfigIndex(Array.from({ length: frames }, (_, i) => i));
    scene.setTotalConfigs(frames);
    scene.setTrajFile({ ...categorized.mglTrajectory, mglTrajectoryData: mglData });
  } else {
    scene.setConfigIndex([0]);
    scene.setTotalConfigs(1);
  }
}

/** Parses the topology and hands the format its chance to set up the store. */
async function loadTopology(categorized, files, inputParams, signal, scene) {
  const chosen = pickTopologyFile(categorized, files);
  if (!chosen) {
    throw new LoadError('No topology file detected. Check that the drop includes one.');
  }

  const content = await step(signal, chosen.file.text());
  const { data, format } = await step(signal, parseTopology(
    content,
    createFileMap(files),
    chosen.format,
    { particleFile: inputParams.particle_file, patchFile: inputParams.patchy_file },
  ));

  scene.setTopData(data);
  // Format-specific store setup lives with the format, not in the pipeline.
  format?.onLoad?.(data, { setParticleRadius: scene.setFormatParticleRadius });
}

/** Points the scene at the trajectory and indexes its frames. */
async function loadTrajectory(categorized, files, signal, scene, exclude) {
  const file = pickTrajectoryFile(categorized, files, { exclude });
  if (!file) {
    throw new LoadError('No trajectory file detected. Check that the drop includes one.');
  }
  scene.setTrajFile(file);

  const index = await step(signal, buildTrajIndex(file));
  scene.setConfigIndex(index);
  scene.setTotalConfigs(index.length);
}

/**
 * @param scene  store writers: setTopData, setPositions, setCurrentBoxSize,
 *               setCurrentTime, setCurrentEnergy, setConfigIndex,
 *               setTotalConfigs, setTrajFile, setFormatParticleRadius
 * @throws {LoadError} with a message meant for the person
 * @throws {StaleLoad} when a newer load has taken over
 */
export async function loadSimulation({ files, categorized, signal, scene }) {
  const inputParams = await readInputFile(categorized, signal, scene);
  checkpoint(signal);

  // MGL is self-contained: no topology, no trajectory file, nothing after this.
  if (categorized.mglFile || categorized.mglTrajectory) {
    await loadMgl(categorized, signal, scene);
    return;
  }

  await loadTopology(categorized, files, inputParams, signal, scene);
  // The topology and input files are spoken for; the name-based trajectory
  // fallback must not pick one of them.
  const spokenFor = [pickTopologyFile(categorized, files)?.file, categorized.inputFile];
  await loadTrajectory(categorized, files, signal, scene, spokenFor);

  if (categorized.unknown?.length) {
    console.warn('Ignored files of unrecognised type:',
      categorized.unknown.map(f => f.name).join(', '));
  }
}

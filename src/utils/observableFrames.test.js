import { observableUpdatesForFrame } from './observableFrames';
import { bondObservableOverlay } from './overlays';
import { parsePLClusterTopology } from '../formats/observables/plClusterTopology';

const FRAMES = [
  '1 ( 0 0 ) [0 -> (1), 1 -> (0)]',
  '1 ( 0 0 0 ) [0 -> (1 2), 1 -> (0), 2 -> (0)]',
].join('\n');

const observableOverlay = (id) => ({
  id,
  ...bondObservableOverlay({
    name: id, observable: parsePLClusterTopology(FRAMES), colorScheme: 'default',
  }),
});

const staticOverlay = { id: 'file-1', kind: 'clusters', clusters: [], colors: new Map() };

test('an observable overlay is rewritten to the frame on screen', () => {
  const { updates } = observableUpdatesForFrame([observableOverlay('o1')], 1, null);
  expect(updates).toHaveLength(1);
  expect(updates[0].id).toBe('o1');
  expect(updates[0].clusters[0].indices).toEqual([0, 1, 2]);
  expect(updates[0].frameIndex).toBe(1);
});

test('an overlay already showing that frame is not rewritten', () => {
  // Every update re-renders all five renderers, and this runs on every frame.
  const overlay = { ...observableOverlay('o1'), frameIndex: 1 };
  expect(observableUpdatesForFrame([overlay], 1, null).updates).toEqual([]);
});

test('a cluster file has no frames and is left alone', () => {
  const { updates } = observableUpdatesForFrame([staticOverlay], 3, null);
  expect(updates).toEqual([]);
});

test('bonds come from the cluster source, so one selector decides what is drawn', () => {
  const overlays = [observableOverlay('o1'), observableOverlay('o2')];
  const { bonds } = observableUpdatesForFrame(overlays, 1, 'o2');
  expect(Array.from(bonds.a)).toEqual([0, 0]);
  expect(Array.from(bonds.b)).toEqual([1, 2]);
});

test('no bonds are drawn while the source is DBSCAN or a cluster file', () => {
  const overlays = [observableOverlay('o1'), staticOverlay];
  expect(observableUpdatesForFrame(overlays, 0, null).bonds).toBeNull();
  expect(observableUpdatesForFrame(overlays, 0, 'file-1').bonds).toBeNull();
});

test('a frame past the end of the observable draws no bonds', () => {
  const { bonds } = observableUpdatesForFrame([observableOverlay('o1')], 99, 'o1');
  expect(bonds).toBeNull();
});

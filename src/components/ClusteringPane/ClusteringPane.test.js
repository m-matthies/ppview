import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ClusteringPane from '.';
import { useParticleStore } from '../../store/particleStore';
import { useClusteringStore } from '../../store/clusteringStore';
import { useUIStore } from '../../store/uiStore';

// ClusteringPane takes no props — it reads `positions` from the particle store
// and pushes highlights back through the clustering store.
//
// Two tight groups of four, far apart. With the default epsilon (2.0) each
// point sees its 3 groupmates, meeting the default minPoints (3), so DBSCAN
// finds exactly 2 clusters of 4.
const mockPositions = [
  { x: 0, y: 0, z: 0 },
  { x: 0.5, y: 0, z: 0 },
  { x: 0, y: 0.5, z: 0 },
  { x: 0, y: 0, z: 0.5 },
  { x: 10, y: 10, z: 10 },
  { x: 10.5, y: 10, z: 10 },
  { x: 10, y: 10.5, z: 10 },
  { x: 10, y: 10, z: 10.5 },
];

const seedPositions = (positions) => useParticleStore.setState({ positions });

describe('ClusteringPane', () => {
  beforeEach(() => {
    seedPositions(mockPositions);
    useClusteringStore.getState().resetClusterState();
    useUIStore.getState().setShowClusteringPane(true);
  });

  test('renders clustering pane with correct title', () => {
    render(<ClusteringPane />);
    expect(screen.getByText('Particle Clustering')).toBeInTheDocument();
  });

  test('displays parameter controls', () => {
    render(<ClusteringPane />);
    expect(screen.getByText(/Epsilon Distance:/)).toBeInTheDocument();
    expect(screen.getByText(/Min Points:/)).toBeInTheDocument();
  });

  test('displays statistics section', () => {
    render(<ClusteringPane />);
    expect(screen.getByText('Statistics')).toBeInTheDocument();
    expect(screen.getByText('Total Clusters:')).toBeInTheDocument();
    expect(screen.getByText('Clustered Particles:')).toBeInTheDocument();
  });

  test('finds the two seeded clusters', () => {
    render(<ClusteringPane />);
    const totalClusters = screen.getByText('Total Clusters:').nextSibling;
    expect(totalClusters).toHaveTextContent('2');
  });

  test('displays histogram section', () => {
    render(<ClusteringPane />);
    expect(screen.getByText('Cluster Size Distribution')).toBeInTheDocument();
  });

  test('allows epsilon parameter adjustment', () => {
    render(<ClusteringPane />);
    const epsilonSlider = screen.getByDisplayValue('2');
    fireEvent.change(epsilonSlider, { target: { value: '3.5' } });
    expect(screen.getByText(/Epsilon Distance: 3.50/)).toBeInTheDocument();
  });

  test('allows min points parameter adjustment', () => {
    render(<ClusteringPane />);
    const minPointsSlider = screen.getByDisplayValue('3');
    fireEvent.change(minPointsSlider, { target: { value: '5' } });
    expect(screen.getByText(/Min Points: 5/)).toBeInTheDocument();
  });

  // The pane is mounted by App only while showClusteringPane is true, so its
  // close button must clear that shared flag rather than a local one —
  // otherwise the control-bar toggle still reads as "on".
  test('closing the pane clears the shared visibility flag', () => {
    render(<ClusteringPane />);

    fireEvent.click(screen.getByTitle('Hide Clustering Panel'));

    expect(useUIStore.getState().showClusteringPane).toBe(false);
  });

  test('renders nothing when no positions are loaded', () => {
    seedPositions([]);
    const { container } = render(<ClusteringPane />);
    expect(container).toBeEmptyDOMElement();
  });

  test('pushes showOnlySelected through to the clustering store', () => {
    render(<ClusteringPane />);
    expect(useClusteringStore.getState().showOnlyHighlightedClusters).toBe(false);

    const showOnlyCheckbox = screen.getByText('Show only selected clusters').previousSibling;
    fireEvent.click(showOnlyCheckbox);

    expect(useClusteringStore.getState().showOnlyHighlightedClusters).toBe(true);
  });
});

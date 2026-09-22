import React from 'react';
import { render, screen } from '@testing-library/react';
import ImpostorIndicator from '.';
import { useUIStore, usesImpostors } from '../../store/uiStore';

const reset = () => useUIStore.setState({ impostorLayers: {} });

describe('ImpostorIndicator', () => {
  beforeEach(reset);

  test('says nothing while the scene is real geometry', () => {
    render(<ImpostorIndicator />);
    expect(screen.queryByTestId('impostor-indicator')).toBeNull();
  });

  test('appears once a layer reports impostors', () => {
    useUIStore.getState().setImpostorLayer('particles', true);
    render(<ImpostorIndicator />);
    expect(screen.getByTestId('impostor-indicator')).toBeInTheDocument();
  });

  // Raspberry is the case this exists for: the beads decide on their own count,
  // which is several per particle, so the particle count cannot answer for them.
  test('a bead layer alone is enough', () => {
    useUIStore.getState().setImpostorLayer('beads-0', true);
    render(<ImpostorIndicator />);
    expect(screen.getByTestId('impostor-indicator')).toBeInTheDocument();
  });

  test('withdraws only when every layer has stopped', () => {
    const { setImpostorLayer } = useUIStore.getState();
    setImpostorLayer('particles', true);
    setImpostorLayer('beads-0', true);
    setImpostorLayer('particles', false);
    expect(usesImpostors(useUIStore.getState())).toBe(true);
    setImpostorLayer('beads-0', false);
    expect(usesImpostors(useUIStore.getState())).toBe(false);
  });

  test('a repeated report does not produce new state', () => {
    const { setImpostorLayer } = useUIStore.getState();
    setImpostorLayer('particles', true);
    const first = useUIStore.getState().impostorLayers;
    setImpostorLayer('particles', true);
    // Identity, not equality: every renderer subscribes to this store, so a new
    // object on a repeated report would re-render all of them.
    expect(useUIStore.getState().impostorLayers).toBe(first);
  });
});

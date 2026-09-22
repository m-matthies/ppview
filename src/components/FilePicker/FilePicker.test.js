import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FilePicker from '.';

const pressOpen = (init = {}) =>
  fireEvent.keyDown(window, { key: 'o', ctrlKey: true, ...init });

describe('FilePicker', () => {
  test('Ctrl+O opens the chooser', () => {
    render(<FilePicker onFilesReceived={() => {}} />);
    const input = screen.getByTestId('file-picker');
    const click = jest.spyOn(input, 'click').mockImplementation(() => {});
    pressOpen();
    expect(click).toHaveBeenCalled();
  });

  test('Cmd+O opens it too', () => {
    render(<FilePicker onFilesReceived={() => {}} />);
    const input = screen.getByTestId('file-picker');
    const click = jest.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.keyDown(window, { key: 'o', metaKey: true });
    expect(click).toHaveBeenCalled();
  });

  test('a bare O does not, since it is an ordinary keystroke', () => {
    render(<FilePicker onFilesReceived={() => {}} />);
    const input = screen.getByTestId('file-picker');
    const click = jest.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.keyDown(window, { key: 'o' });
    expect(click).not.toHaveBeenCalled();
  });

  test('typing an O into a field is not a request to open files', () => {
    render(
      <>
        <input data-testid="field" />
        <FilePicker onFilesReceived={() => {}} />
      </>,
    );
    const input = screen.getByTestId('file-picker');
    const click = jest.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'o', ctrlKey: true });
    expect(click).not.toHaveBeenCalled();
  });

  test('does nothing while drag and drop is disabled, as in an iframe', () => {
    render(<FilePicker onFilesReceived={() => {}} enabled={false} />);
    const input = screen.getByTestId('file-picker');
    const click = jest.spyOn(input, 'click').mockImplementation(() => {});
    pressOpen();
    expect(click).not.toHaveBeenCalled();
  });

  test('accepts several files at once', () => {
    const received = jest.fn();
    render(<FilePicker onFilesReceived={received} />);
    const input = screen.getByTestId('file-picker');
    expect(input).toHaveAttribute('multiple');
    fireEvent.change(input, {
      target: {
        files: [
          new File(['x'], 'a.top', { type: 'text/plain' }),
          new File(['y'], 'b.dat', { type: 'text/plain' }),
        ],
      },
    });
    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0][0].map(f => f.name)).toEqual(['a.top', 'b.dat']);
  });

  test('prevents the browser from opening the file over the page', () => {
    render(<FilePicker onFilesReceived={() => {}} />);
    jest.spyOn(screen.getByTestId('file-picker'), 'click').mockImplementation(() => {});
    const event = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, cancelable: true, bubbles: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

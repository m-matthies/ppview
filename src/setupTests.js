// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom ships neither the encoding APIs nor web streams, but the app targets
// browsers where both are standard — buildTrajIndex reads a File as a stream and
// decodes it incrementally. Borrow Node's implementations rather than reshaping
// the code around a test-environment gap.
import { TextDecoder, TextEncoder } from 'util';
import { ReadableStream } from 'stream/web';

if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.ReadableStream === 'undefined') global.ReadableStream = ReadableStream;

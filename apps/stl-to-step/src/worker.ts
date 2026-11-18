// The conversion runs here, so a big STL never freezes the page. The worker keeps the part as it
// was read between the two requests: reading it again would take as long as the first time.
import { answerRequests } from '@vostok/ui-kit/build-loop';
import { type PreviewMesh, type Reading, makeStep, readPart } from '@vostok/mesh-to-cad';

export type ConvertRequest = { op: 'read'; bytes: ArrayBuffer } | { op: 'make'; name: string };

/** The STL as read, to show beside the STEP while the STEP is made. */
export type ReadResult = { op: 'read'; stl: PreviewMesh };
/** The STEP. */
export type MadeResult = { op: 'made' } & ReturnType<typeof makeStep>;
export type ConvertResult = ReadResult | MadeResult;

let reading: Reading | null = null;

// Progress reports go to the page as plain messages, ahead of the one reply.
answerRequests<ConvertRequest, ConvertResult>((req) => {
  if (req.op === 'read') {
    reading = null;
    reading = readPart(new Uint8Array(req.bytes), {}, (p) => postMessage(p));
    return { op: 'read', stl: { positions: new Float32Array(reading.mesh.pos), indices: new Uint32Array(reading.mesh.tri) } };
  }
  if (!reading) throw new Error('Open an STL first.');
  return { op: 'made', ...makeStep(reading, req.name, (p) => postMessage(p)) };
}, {
  // The meshes move to the screen rather than being copied.
  transfer: (r) => [r.stl.positions.buffer, r.stl.indices.buffer, ...(r.op === 'made' ? r.faces.flatMap((f) => [f.positions.buffer, f.indices.buffer, f.edges.buffer]) : [])],
});

/**
 * Geometry off the main thread.
 *
 * Same shape as the keychain's worker, including the module memoisation: manifold's WASM
 * is a few megabytes and initialising it per build would dominate every keystroke.
 */
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildSign } from '../geometry/buildSign';
import type { GeometryRequest, GeometryResponse } from '../types';

type Wasm = Awaited<ReturnType<typeof Module>>;
let modulePromise: Promise<Wasm> | null = null;

async function getModule(): Promise<Wasm> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const wasm = await Module({ locateFile: () => wasmUrl });
      wasm.setup();
      return wasm;
    })();
  }
  return modulePromise;
}

function post(msg: GeometryResponse, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(msg, transfer);
}

self.onmessage = async (e: MessageEvent<GeometryRequest>) => {
  try {
    const wasm = await getModule();
    const msg = e.data;

    if (msg.type === 'init') { post({ type: 'ready' }); return; }

    if (msg.type === 'build') {
      const { parts, warnings, size } = buildSign(wasm, msg.textContours, msg.params, msg.textLines);
      // The buffers are handed over rather than copied — they are the largest thing that
      // crosses this boundary and nothing on this side needs them afterwards.
      const transfer: Transferable[] = [];
      for (const p of parts) transfer.push(p.vertProperties.buffer, p.triVerts.buffer);
      post({ type: 'parts', parts, warnings, size }, transfer);
      return;
    }
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  }
};

getModule()
  .then(() => post({ type: 'ready' }))
  .catch((err) => post({ type: 'error', message: `WASM init failed: ${err.message}` }));

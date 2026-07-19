import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildKeychain } from '../geometry/buildKeychain';
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

    if (msg.type === 'init') {
      // Just confirm worker is loaded and WASM is ready
      post({ type: 'ready' });
      return;
    }

    if (msg.type === 'build') {
      const { parts, warnings } = buildKeychain(wasm, msg.textContours, msg.params);

      // Collect transferables (Float32Array and Uint32Array buffers)
      const transfer: Transferable[] = [];
      for (const p of parts) {
        transfer.push(p.vertProperties.buffer, p.triVerts.buffer);
      }

      post({ type: 'parts', parts, warnings }, transfer);
      return;
    }
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  }
};

// Initial worker confirmation
getModule().then(() => {
  post({ type: 'ready' });
}).catch((err) => {
  post({ type: 'error', message: `WASM init failed: ${err.message}` });
});

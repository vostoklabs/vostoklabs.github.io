import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildSet } from '../geometry/buildSet';
import type { GeometryRequest, GeometryResponse } from '../types';

/*
  Every CSG operation happens here, never on the main thread. A set is a few dozen booleans
  and a few dozen booleans on the main thread is a slider that stutters under the finger.
*/

type Wasm = Awaited<ReturnType<typeof Module>>;
let modulePromise: Promise<Wasm> | null = null;

async function getModule(): Promise<Wasm> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const wasm = await Module({ locateFile: () => wasmUrl });
      wasm.setup(); // easy to forget; nothing works without it
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
      post({ type: 'ready' });
      return;
    }
    if (msg.type === 'build') {
      const started = performance.now();
      const { parts, assembled, chain, hookFrame, warnings, size, marks } = buildSet(wasm, msg.params);
      // Hand the buffers over rather than cloning them; the sender's views are neutered
      // afterwards, which is fine because nothing here reads them again.
      const transfer: Transferable[] = [];
      for (const p of [...parts, ...assembled]) transfer.push(p.positions.buffer, p.indices.buffer);
      post(
        { type: 'parts', parts, assembled, chain, hookFrame, warnings, stats: { size, marks, ms: Math.round(performance.now() - started) } },
        transfer,
      );
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  }
};

getModule()
  .then(() => post({ type: 'ready' }))
  .catch((err) => post({ type: 'error', message: `WASM init failed: ${err.message}` }));

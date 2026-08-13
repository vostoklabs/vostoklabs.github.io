// Geometry worker. Owns the manifold WASM kernel; the main thread never runs a
// boolean. Same shape as the clicker's worker — load once, cache the promise,
// never forget `setup()`.

import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { solve } from '../geometry/buildSlot';
import type { GeometryRequest, GeometryResponse } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
let modulePromise: Promise<any> | null = null;

async function getModule(): Promise<any> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const wasm = await Module({ locateFile: () => wasmUrl });
      wasm.setup(); // nothing works without this
      return wasm;
    })();
  }
  return modulePromise;
}

function post(msg: GeometryResponse, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

self.onmessage = async (e: MessageEvent<GeometryRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'ping') {
      await getModule();
      post({ type: 'ready' });
      return;
    }
    if (msg.type === 'build') {
      const wasm = await getModule();
      const result = solve(wasm, msg.outline, msg.params);
      // Hand the mesh buffers over rather than cloning them.
      const transfer: Transferable[] = [];
      for (const p of result.preview) {
        transfer.push(p.positions.buffer, p.indices.buffer);
      }
      post({ type: 'result', result }, transfer);
      return;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

post({ type: 'ready' });

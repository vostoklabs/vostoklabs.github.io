// Geometry worker: owns the Manifold WASM kernel. All CSG happens here so the
// UI thread never blocks. See docs/briefs/magnet-generator-spec.md.
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildMagnet } from '../geometry/buildMagnet';
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

    if (msg.type === 'buildMagnet') {
      const { parts, warnings, magnet } = buildMagnet(wasm, msg.regions, msg.outline, msg.params);
      const transfer: Transferable[] = [];
      for (const p of parts) transfer.push(p.vertProperties.buffer, p.triVerts.buffer);
      post({ type: 'parts', parts, warnings, magnet }, transfer);
      return;
    }
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  }
};

post({ type: 'ready' });

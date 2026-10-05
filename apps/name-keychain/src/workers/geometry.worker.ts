import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { answerRequests } from '@vostok/ui-kit/build-loop';
import { buildKeychain } from '../geometry/buildKeychain';
import type { GeometryRequest, GeometryResult } from '../types';

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

// One reply per build, matched to it by id. The WASM loads inside the first build, so a load
// failure fails that build, and reaches the screen, instead of only the console.
answerRequests<GeometryRequest, GeometryResult>(
  async (msg) => buildKeychain(await getModule(), msg.textContours, msg.params),
  // The meshes' buffers move to the main thread rather than being copied.
  { transfer: ({ parts }) => parts.flatMap((p) => [p.vertProperties.buffer, p.triVerts.buffer]) },
);

// Geometry worker: owns the manifold-3d WASM kernel. Every boolean happens here, so the page never
// blocks while a card builds.
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { answerRequests } from '@vostok/ui-kit/build-loop';
import type { Design } from '../design/types';
import { buildSolid, type SolidParams, type SolidResult } from './solid';

export interface SolidRequest {
  design: Design;
  params: SolidParams;
}

type Wasm = Awaited<ReturnType<typeof Module>>;
let modulePromise: Promise<Wasm> | null = null;

function getModule(): Promise<Wasm> {
  modulePromise ??= (async () => {
    const wasm = await Module({ locateFile: () => wasmUrl });
    wasm.setup();
    return wasm;
  })();
  return modulePromise;
}

// One reply per build, matched to it by id. The WASM loads inside the first build, so a failed load
// fails that build, and reaches the status line, instead of only the console.
answerRequests<SolidRequest, SolidResult>(
  async (msg) => buildSolid(await getModule(), msg.design, msg.params),
  // The meshes' buffers move to the page rather than being copied.
  { transfer: ({ parts }) => parts.flatMap((p) => [p.vertProperties.buffer, p.triVerts.buffer]) },
);

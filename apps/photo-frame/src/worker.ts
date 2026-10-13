// The geometry worker: it owns manifold-3d, so a rebuild never blocks the screen.
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { answerRequests } from '@vostok/ui-kit/build-loop';
import { buildModel, type BuildRequest, type BuildResult } from './geometry/build';

type Wasm = Awaited<ReturnType<typeof Module>>;
let wasm: Promise<Wasm> | null = null;

/** Loaded inside the first build, so a load that fails fails that build and reaches the status
 *  line instead of only the console. */
function kernel(): Promise<Wasm> {
  wasm ??= Module({ locateFile: () => wasmUrl }).then((m) => {
    m.setup();
    return m;
  });
  return wasm;
}

answerRequests<BuildRequest, BuildResult>(async (req) => buildModel(await kernel(), req), {
  // The meshes move to the screen rather than being copied.
  transfer: (r) => [...r.assembled, ...r.print].flatMap((p) => [p.vertProperties.buffer, p.triVerts.buffer]),
});

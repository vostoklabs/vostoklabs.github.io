// The geometry worker: owns the manifold WASM kernel and the pattern library, answers one
// `build` at a time, so the page never blocks on a boolean. It answers through the kit's worker
// transport (`answerRequests`): one reply per build, matched to it by id.
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { answerRequests } from '@vostok/ui-kit/build-loop';
import { patternById, type PatternDef } from '@vostok/patterns';
import { buildAll, type BuildRequest, type BuildResult } from './build';

export interface WorkerRequest {
  request: BuildRequest;
}

type Wasm = Awaited<ReturnType<typeof Module>>;
let modulePromise: Promise<Wasm> | null = null;
function getModule(): Promise<Wasm> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const wasm = await Module({ locateFile: () => wasmUrl });
      wasm.setup();
      // Both constraints, because manifold takes the COARSER of them (see Laser Studio's
      // worker): a 3° step on any curve the kerf offset or a pattern's boolean rounds.
      wasm.setMinCircularEdgeLength(0.15);
      wasm.setMinCircularAngle(3);
      return wasm;
    })();
  }
  return modulePromise;
}

/** A library tile loads only when one is first asked for: a customer who stays with the
 *  procedural patterns never pays for the ~900 KB of tile data. */
let library: Promise<PatternDef[]> | null = null;
async function patternFor(id: string): Promise<PatternDef> {
  if (id.startsWith('pm-')) {
    library ??= import('@vostok/patterns/library').then((m) => m.LIBRARY);
    const lib = await library;
    const hit = lib.find((d) => d.id === id);
    if (hit) return hit;
  }
  return patternById(id) ?? patternById('honeycomb')!;
}

// The kernel starts inside the first build, so a kernel that fails to start fails that build,
// where the page says so, instead of only in the console.
answerRequests<WorkerRequest, BuildResult>(async ({ request }) => {
  try {
    return await buildAll(await getModule(), request, patternFor);
  } catch (err) {
    // A trap inside the WASM leaves its heap in no state to trust: start a fresh kernel next time.
    if (err instanceof WebAssembly.RuntimeError) modulePromise = null;
    throw err;
  }
});

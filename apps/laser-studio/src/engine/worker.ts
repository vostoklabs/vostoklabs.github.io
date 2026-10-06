// The geometry worker: owns the manifold WASM kernel, answers one `build` at a time. The main
// thread never blocks on a boolean. Every request gets exactly one reply carrying its id, the
// output or the error (`answerRequests`), so a build that fails is heard about, never waited on.
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { answerRequests } from '@vostok/ui-kit/build-loop';
import { buildKeychain } from './build';
import type { BuildOutput, WorkerRequest } from './types';

type Wasm = Awaited<ReturnType<typeof Module>>;
let modulePromise: Promise<Wasm> | null = null;
function getModule(): Promise<Wasm> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const wasm = await Module({ locateFile: () => wasmUrl });
      wasm.setup();
      /*
        How finely a curve is tessellated, set once for every boolean this worker runs. The
        rounded outline of a hugging plate IS an offset, so this number is its smoothness; the
        old hardcoded 32 segments put visible flat facets on a 12 mm border.

        Both constraints, because Manifold takes the COARSER of them: measured on a 12 mm
        radius, the edge-length limit alone changes nothing (the 10° default angle still caps
        it at 36 segments), the angle alone gives 76, and the two together give 120 — a 3° turn
        per step, which reads as a curve at any zoom this app offers.
      */
      wasm.setMinCircularEdgeLength(0.15);
      wasm.setMinCircularAngle(3);
      return wasm;
    })().catch((err) => {
      // A load that failed (the .wasm did not arrive) is tried again by the next build, rather
      // than failing every build after it until the page is reloaded.
      modulePromise = null;
      throw err;
    });
  }
  return modulePromise;
}

answerRequests<WorkerRequest, BuildOutput | null>(async (req) => {
  try {
    // The kernel loads inside the request that needs it, so a load that fails fails that request.
    const wasm = await getModule();
    return req.type === 'warm' ? null : buildKeychain(wasm, req.input);
  } catch (err) {
    // A trap inside the WASM (an out-of-bounds read deep in a boolean) leaves the module's heap
    // in no state to trust: every later call on it fails the same way. Drop it, so the next
    // build starts a fresh kernel instead of the page needing a reload.
    if (err instanceof WebAssembly.RuntimeError) modulePromise = null;
    throw err;
  }
});

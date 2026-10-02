// The geometry worker: owns the manifold WASM kernel, answers one `build` at a time. The main
// thread never blocks on a boolean. Same skeleton as the clicker's.
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildKeychain } from './build';
import type { WorkerRequest, WorkerResponse } from './types';

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
    })();
  }
  return modulePromise;
}

const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type !== 'build') return;
  try {
    const wasm = await getModule();
    const started = performance.now();
    const output = buildKeychain(wasm, msg.input);
    post({ type: 'built', id: msg.id, output, ms: Math.round(performance.now() - started) });
  } catch (err) {
    // A trap inside the WASM (an out-of-bounds read deep in a boolean) leaves the module's heap
    // in no state to trust: every later call on it fails the same way. Drop it, so the next
    // build starts a fresh kernel instead of the page needing a reload.
    if (err instanceof WebAssembly.RuntimeError) modulePromise = null;
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};

getModule()
  .then(() => post({ type: 'ready' }))
  .catch((err) => console.error('manifold failed to start', err));

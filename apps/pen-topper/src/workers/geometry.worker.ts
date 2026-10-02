import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildTopper } from '../geometry/buildTopper';
import { packShelf } from '@vostok/plates';
import type { BatchResult, GeometryRequest, GeometryResponse, PartMesh } from '../types';

/*
  Every CSG operation happens here, never on the main thread. A topper rebuild is
  200 ms of booleans on a bad day, and 200 ms on the main thread is a slider that
  stutters under the finger.
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

/** Set by a `cancelBatch` message. Read between items, which is the only place a
 *  batch can stop: one topper's CSG is not interruptible. */
let cancelRequested = false;

/** Slide a built topper so its min corner lands on `(x, y)`.
 *
 *  Done here rather than on the main thread because the buffers are about to be
 *  TRANSFERRED — once they are, this side cannot touch them, and the other side would
 *  have to walk every vertex again for a translation the builder could have folded in
 *  for free. */
function placeParts(parts: PartMesh[], x: number, y: number): void {
  let minX = Infinity;
  let minY = Infinity;
  for (const p of parts) {
    for (let i = 0; i < p.positions.length; i += 3) {
      if (p.positions[i]! < minX) minX = p.positions[i]!;
      if (p.positions[i + 1]! < minY) minY = p.positions[i + 1]!;
    }
  }
  if (!Number.isFinite(minX)) return;
  const dx = x - minX;
  const dy = y - minY;
  for (const p of parts) {
    for (let i = 0; i < p.positions.length; i += 3) {
      p.positions[i] = p.positions[i]! + dx;
      p.positions[i + 1] = p.positions[i + 1]! + dy;
    }
  }
}

self.onmessage = async (e: MessageEvent<GeometryRequest>) => {
  try {
    const msg = e.data;
    if (msg.type === 'cancelBatch') {
      // Handled before the WASM await: a cancel that queues behind module init is a
      // cancel that arrives after the run it was meant to stop.
      cancelRequested = true;
      return;
    }

    const wasm = await getModule();

    if (msg.type === 'init') {
      post({ type: 'ready' });
      return;
    }

    if (msg.type === 'batch') {
      const started = performance.now();
      cancelRequested = false;

      /*
        Two passes, and the first one is the reason a set lays out at all: the packer
        needs each topper's footprint, and a footprint is not known until the thing is
        built. So build them all, measure, pack, then place. Guessing the footprint
        from the text width instead would be one number wrong per name — and every
        name is a different width.
      */
      const built: { label: string; parts: PartMesh[]; warnings: string[]; w: number; d: number }[] = [];
      for (let i = 0; i < msg.items.length; i++) {
        if (cancelRequested) break;
        const item = msg.items[i]!;
        post({ type: 'batchProgress', done: i, total: msg.items.length, label: item.label });
        // Yield, so the progress message is delivered and a cancel can be read. Without
        // it the whole batch is one synchronous block and the UI shows nothing until
        // the end.
        await new Promise((r) => setTimeout(r, 0));
        if (cancelRequested) break;

        const { parts, warnings } = buildTopper(wasm, item.textContours, item.params);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of parts) {
          for (let k = 0; k < p.positions.length; k += 3) {
            const x = p.positions[k]!;
            const y = p.positions[k + 1]!;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        built.push({ label: item.label, parts, warnings, w: maxX - minX, d: maxY - minY });
      }

      const places = packShelf(built.map((b) => ({ w: b.w, d: b.d })), { plate: msg.plate });
      const results: BatchResult[] = [];
      const transfer: Transferable[] = [];
      for (let i = 0; i < built.length; i++) {
        const b = built[i]!;
        const at = places[i]!;
        placeParts(b.parts, at.x, at.y);
        results.push({ label: b.label, parts: b.parts, plate: at.plate, warnings: b.warnings });
        for (const p of b.parts) transfer.push(p.positions.buffer, p.indices.buffer);
      }

      post(
        {
          type: 'batchDone',
          results,
          plates: places.length ? Math.max(...places.map((p) => p.plate)) + 1 : 0,
          cancelled: cancelRequested,
          ms: Math.round(performance.now() - started),
        },
        transfer,
      );
      cancelRequested = false;
      return;
    }

    if (msg.type === 'build') {
      const started = performance.now();
      const { parts, warnings, size, bore, letterScale, depth } = buildTopper(wasm, msg.textContours, msg.params);

      // Hand the buffers over rather than cloning them; the sender's views are
      // neutered afterwards, which is fine because nothing here reads them again.
      const transfer: Transferable[] = [];
      for (const p of parts) transfer.push(p.positions.buffer, p.indices.buffer);

      post(
        {
          type: 'parts',
          parts,
          warnings,
          stats: { size, bore, letterScale, depth, ms: Math.round(performance.now() - started) },
        },
        transfer,
      );
      return;
    }
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  }
};

getModule()
  .then(() => post({ type: 'ready' }))
  .catch((err) => post({ type: 'error', message: `WASM init failed: ${err.message}` }));

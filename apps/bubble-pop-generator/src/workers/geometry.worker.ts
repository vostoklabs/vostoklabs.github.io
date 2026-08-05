// Geometry worker: owns the Manifold WASM kernel. All CSG happens here so the
// UI thread never blocks. See docs/briefs/bubble-pop-generator-spec.md.
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildPop } from '../geometry/buildPop';
import { loadPopModule, type PopModule } from '../geometry/popModule';
import { buildShape } from '../geometry/shapes';
import { SHAPE_LIBRARY, type GeometryRequest, type GeometryResponse, type Ring } from '../types';

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

// The pop module is parsed once and cached per clearance value — rebuilding it
// on every slider tick would re-run three mesh imports for nothing.
let moduleBuffer: ArrayBuffer | null = null;
let cached: { clearance: number; mod: PopModule } | null = null;

function getPopModule(wasm: Wasm, clearance: number): PopModule {
  if (!moduleBuffer) throw new Error('pop module was never delivered to the worker');
  if (cached && Math.abs(cached.clearance - clearance) < 1e-6) return cached.mod;
  cached = { clearance, mod: loadPopModule(wasm, moduleBuffer, clearance) };
  return cached.mod;
}

function post(msg: GeometryResponse, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(msg, transfer);
}

self.onmessage = async (e: MessageEvent<GeometryRequest>) => {
  try {
    const wasm = await getModule();
    const msg = e.data;
    if (msg.moduleBuffer) moduleBuffer = msg.moduleBuffer;

    if (msg.type === 'buildPop') {
      const mod = getPopModule(wasm, msg.params.buttonClearance);
      const { parts, warnings, report } = buildPop(wasm, msg.regions, msg.outline, msg.params, mod);
      const transfer: Transferable[] = [];
      for (const p of parts) transfer.push(p.vertProperties.buffer, p.triVerts.buffer);
      post({ type: 'parts', parts, warnings, report }, transfer);
      return;
    }

    if (msg.type === 'shapePreviews') {
      const trash: { delete(): void }[] = [];
      const track = <T extends { delete(): void }>(o: T): T => {
        trash.push(o);
        return o;
      };
      const previews = SHAPE_LIBRARY.map((s) => {
        const sec = buildShape(wasm, track, s.id, 100, {
          cornerRadius: 12,
          holeRatio: 0.4,
          starPoints: 5,
          aspect: 1.4,
        });
        return { id: s.id, rings: sec.toPolygons() as Ring[] };
      });
      for (const o of trash) {
        try {
          o.delete();
        } catch {
          /* already freed */
        }
      }
      post({ type: 'previews', previews });
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

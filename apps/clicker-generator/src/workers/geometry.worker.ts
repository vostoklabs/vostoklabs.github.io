// Geometry worker: owns the Manifold WASM kernel and the validated MX assets.
// All CSG happens here so the UI thread never blocks. See DEV_PLAN.md §1, §6.
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { parse3MF } from '../geometry/threemfImport';
import { buildFitStrip } from '../geometry/fitStrip';
import { buildClicker } from '../geometry/buildClicker';
import { buildBlocks, prepareBlockAssets, type BlockAssets, type KeycapAsset } from '../geometry/buildBlocks';
import type { GeometryRequest, GeometryResponse } from '../types';

type Wasm = Awaited<ReturnType<typeof Module>>;

let modulePromise: Promise<Wasm> | null = null;
let socket: any = null; // cached MX socket (negative), in mm
let stem: any = null; // cached MX stem (positive), in mm
// Letter-block assets, normalised into the assembly frame once at init.
let blockAssets: BlockAssets | null = null;
let keycapAsset: KeycapAsset | null = null;

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

function assetToSolid(wasm: any, buf: ArrayBuffer): { solid: any; info: string } {
  const raw = parse3MF(buf);
  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: raw.vertProperties,
    triVerts: raw.triVerts,
  });
  mesh.merge();
  const solid = wasm.Manifold.ofMesh(mesh);
  const bb = solid.boundingBox();
  const size = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
  const status = typeof solid.status === 'function' ? solid.status() : 'ok';
  const info = `${size.map((v: number) => v.toFixed(2)).join('×')} mm, Z[${bb.min[2].toFixed(
    2,
  )},${bb.max[2].toFixed(2)}], status=${status}`;
  return { solid, info };
}

/** keycap.json (shared with the keycap generator): shell mesh at the top level, the MX
 *  stem as its own body, and metadata describing the dish. Authored in the same Z frame
 *  as the MX assets, so no re-anchoring is needed. */
function toKeycapAsset(json: any): KeycapAsset | null {
  if (!json?.positions || !json?.indices || !json?.meta) return null;
  return {
    shell: { positions: json.positions, indices: json.indices },
    stem: json.stem ?? null,
    meta: json.meta,
  };
}

self.onmessage = async (e: MessageEvent<GeometryRequest>) => {
  try {
    const wasm = await getModule();
    const msg = e.data;

    if (msg.type === 'init') {
      socket?.delete?.();
      stem?.delete?.();
      const a = assetToSolid(wasm, msg.socket);
      const b = assetToSolid(wasm, msg.stem);
      // The socket and stem are authored in independent local frames (separate
      // exports), so normalize each into the shared assembly frame — Z = 0 is the
      // switch-plate top (where the switch latches), switch axis at the XY origin:
      //  • Socket: center on its own bbox (the ~14 mm cutout is symmetric about the
      //    axis) and drop its TOP face to Z = 0 — ianku's updated socket has its flat
      //    top at the plate/latch plane; it cuts downward (−Z) into the body.
      //  • Stem: center on its own bbox (symmetric keycap mount). Keep its authored
      //    Z — the stem top is the cap-underside rest height above the plate, which
      //    is what makes the cap float proud of the body border.
      const sbb = a.solid.boundingBox();
      const scx = (sbb.min[0] + sbb.max[0]) / 2;
      const scy = (sbb.min[1] + sbb.max[1]) / 2;
      socket = a.solid.translate([-scx, -scy, -sbb.max[2]]);
      const tbb = b.solid.boundingBox();
      const tcx = (tbb.min[0] + tbb.max[0]) / 2;
      const tcy = (tbb.min[1] + tbb.max[1]) / 2;
      stem = b.solid.translate([-tcx, -tcy, 0]);
      a.solid.delete();
      b.solid.delete();

      // Letter blocks: measure and re-anchor each block asset now (see buildBlocks) so a
      // rebuild is pure placement. Failure here only disables the Blocks mode.
      for (const v of blockAssets?.byMask.values() ?? []) {
        try { v.solid.delete(); } catch { /* shared between masks — already freed */ }
      }
      blockAssets = null;
      if (msg.blockNoSides && msg.blockSouth && msg.blockNorthSouth) {
        const rawBlocks: Record<string, any> = {
          noSides: assetToSolid(wasm, msg.blockNoSides).solid,
          south: assetToSolid(wasm, msg.blockSouth).solid,
          northSouth: assetToSolid(wasm, msg.blockNorthSouth).solid,
        };
        // The grid shells are optional: without them only rows and columns are possible.
        if (msg.blockNorthWest) rawBlocks.northWest = assetToSolid(wasm, msg.blockNorthWest).solid;
        if (msg.blockNorthSouthWest) rawBlocks.northSouthWest = assetToSolid(wasm, msg.blockNorthSouthWest).solid;
        if (msg.blockAllSides) rawBlocks.allSides = assetToSolid(wasm, msg.blockAllSides).solid;
        try {
          blockAssets = prepareBlockAssets(wasm, socket, rawBlocks as any);
        } catch (err) {
          console.error('[blocks] asset prep failed', err);
        }
        for (const s of Object.values(rawBlocks)) s.delete();
      }
      if (msg.keycapJson) keycapAsset = toKeycapAsset(msg.keycapJson);

      // The switch is DISPLAY-ONLY (a preview toggle) — no CSG. Parse it raw and place
      // it in the assembly frame:
      //  • XY: shift by the SAME amount as the stem so it stays coaxial with cap/socket.
      //  • Z: AUTO-SEAT — drop the bottom of its widest section (the top-housing
      //    shoulder that rests on the plate) to Z = 0 (the socket top / plate plane).
      //    This is robust to the asset's authored Z, and lands the plunger at the cap
      //    underside (the stem top), so the switch seats in the socket and meets the cap.
      const sw = parse3MF(msg.switch);
      const v = sw.vertProperties;
      let maxExtent = 0;
      for (let i = 0; i < v.length; i += 3) {
        v[i] -= tcx;
        v[i + 1] -= tcy;
        const e = Math.max(Math.abs(v[i]), Math.abs(v[i + 1]));
        if (e > maxExtent) maxExtent = e;
      }
      const wide = maxExtent * 0.96; // the top housing is the single widest feature
      let seatZ = Infinity;
      for (let i = 0; i < v.length; i += 3) {
        if (Math.max(Math.abs(v[i]), Math.abs(v[i + 1])) >= wide && v[i + 2] < seatZ) {
          seatZ = v[i + 2];
        }
      }
      let zmin = Infinity;
      let zmax = -Infinity;
      for (let i = 0; i < v.length; i += 3) {
        v[i + 2] -= seatZ; // raise so the seating shoulder sits at Z = 0
        if (v[i + 2] < zmin) zmin = v[i + 2];
        if (v[i + 2] > zmax) zmax = v[i + 2];
      }
      const switchMesh = { vertProperties: v, triVerts: sw.triVerts, numProp: 3 as const };
      const switchInfo = `${(sw.triVerts.length / 3) | 0} tris, seated +${(-seatZ).toFixed(
        2,
      )}mm, Z[${zmin.toFixed(2)},${zmax.toFixed(2)}]`;
      post({ type: 'initDone', socketInfo: a.info, stemInfo: b.info, switchInfo, switchMesh }, [
        switchMesh.vertProperties.buffer,
        switchMesh.triVerts.buffer,
      ]);
      return;
    }

    if (msg.type === 'buildClicker') {
      if (!socket || !stem) throw new Error('Assets not initialized');
      const { parts, switchPlacements, warnings } = buildClicker(
        wasm,
        socket,
        stem,
        msg.regions,
        msg.outline,
        msg.params,
      );
      const transfer: Transferable[] = [];
      for (const p of parts) transfer.push(p.vertProperties.buffer, p.triVerts.buffer);
      post({ type: 'parts', parts, switchPlacements, warnings }, transfer);
      return;
    }

    if (msg.type === 'buildBlocks') {
      if (!blockAssets || !keycapAsset) throw new Error('Block assets not initialized');
      const { parts, switchPlacements, warnings } = buildBlocks(
        wasm,
        blockAssets,
        keycapAsset,
        msg.regions,
        msg.params,
      );
      const transfer: Transferable[] = [];
      for (const p of parts) transfer.push(p.vertProperties.buffer, p.triVerts.buffer);
      post({ type: 'parts', parts, switchPlacements, warnings }, transfer);
      return;
    }

    if (msg.type === 'buildFitStrip') {
      if (!stem) throw new Error('Assets not initialized');
      const { parts, warnings } = buildFitStrip(wasm, stem, {
        labels: msg.labels,
        colorRgb: msg.colorRgb,
      });
      const transfer: Transferable[] = [];
      for (const p of parts) transfer.push(p.vertProperties.buffer, p.triVerts.buffer);
      // No switches to report: the strip has no sockets, only the posts under test.
      post({ type: 'parts', parts, switchPlacements: [], warnings }, transfer);
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

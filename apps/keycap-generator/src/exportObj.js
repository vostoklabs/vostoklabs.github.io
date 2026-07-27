import { weldPositions } from './meshUtils.js';

/*
 * OBJ + MTL writer for the MakerLab host export path.
 *
 * MakerWorld's review (2026-07-27) asked us to export 3MF the way the SDK guide describes
 * rather than handing over a ZIP with our own .3mf inside. The SDK's export API accepts
 * `stl | obj | zip` only — the documented route to a 3MF is the OBJ path: the host converts
 * OBJ (+ MTL colours, one ArrayBuffer per print plate) into the 3MF the user receives.
 * See "Export OBJ (Multi-Plate + MTL Materials)" in the SDK developer guide.
 *
 * Guide constraints honoured here:
 *  - each colour region is its own `o` object referencing its material via `usemtl`
 *  - MTL carries `Kd` diffuse colour only (no texture maps)
 *  - materials are deduped per filament slot, so we stay far under the 16-slot AMS ceiling
 *
 * Geometry is written in the same native millimetre space buildThreeMF() uses, so the OBJ
 * and the standalone .3mf describe an identical model.
 */

// Round to keep the file compact without losing print precision (1e-4 mm) and avoid
// exponent notation, which some OBJ readers reject.
const f = (n) => (Math.round(n * 1e4) / 1e4).toString();

// "#rrggbb" -> "r g b" as 0..1 floats, the only colour form MTL's Kd takes.
function kd(hex) {
  const h = hex.replace('#', '');
  const v = (i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4);
  return `${v(0)} ${v(2)} ${v(4)}`;
}

// OBJ object/material names are whitespace-delimited — keep them token-safe.
const slug = (s) => s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'part';

/**
 * Build an OBJ (+ matching MTL) describing one print plate.
 *
 * @param {Array<{name:string, color:string, extruder:number, geom:THREE.BufferGeometry}>} parts
 *        Same shape buildThreeMF() takes. `extruder` is the 1-based filament slot; parts
 *        sharing a slot share one material (cap + stem are both slot 1 normally).
 * @param {{ mtlFileName?: string }} [opts]
 * @returns {{ obj: string, mtl: string, materials: Array<{name:string,color:string,extruder:number}> }}
 */
export function buildObjMtl(parts, { mtlFileName = 'model.mtl' } = {}) {
  // One material per filament slot. First part to claim a slot names and colours it.
  const bySlot = new Map();
  for (const p of parts) {
    if (!bySlot.has(p.extruder)) {
      bySlot.set(p.extruder, { name: `filament${p.extruder}`, color: p.color, extruder: p.extruder });
    }
  }

  const mtl = [...bySlot.values()]
    .map((m) => `newmtl ${m.name}\nKd ${kd(m.color)}`)
    .join('\n\n');

  const lines = [
    '# Keycap Legend Generator — Vostok Labs',
    '# Units: millimetres. One `o` object per filament slot region.',
    `mtllib ${mtlFileName}`,
  ];

  // OBJ face indices are 1-based and run GLOBALLY across the file, so every object's
  // indices shift by the number of vertices already written.
  let vertexOffset = 0;

  for (const p of parts) {
    // Manifold output is already a clean, indexed, watertight solid — use it as-is.
    // Only weld when handed a non-indexed mesh (don't re-weld and risk false merges).
    const g = p.geom.index ? p.geom : weldPositions(p.geom);
    const pos = g.getAttribute('position').array;
    const idx = g.getIndex().array;

    lines.push(`o ${slug(p.name)}`);
    lines.push(`usemtl ${bySlot.get(p.extruder).name}`);

    for (let i = 0; i < pos.length; i += 3) {
      lines.push(`v ${f(pos[i])} ${f(pos[i + 1])} ${f(pos[i + 2])}`);
    }
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] + 1 + vertexOffset;
      const b = idx[i + 1] + 1 + vertexOffset;
      const c = idx[i + 2] + 1 + vertexOffset;
      lines.push(`f ${a} ${b} ${c}`);
    }

    vertexOffset += pos.length / 3;
  }

  return { obj: lines.join('\n') + '\n', mtl: mtl + '\n', materials: [...bySlot.values()] };
}

/** UTF-8 ArrayBuffer of an OBJ plate — the `buffer` shape sdk.export() expects. */
export function objToArrayBuffer(obj) {
  const bytes = new TextEncoder().encode(obj);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

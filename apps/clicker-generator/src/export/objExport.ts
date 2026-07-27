import type { ClickerPart, RGB } from '../types';

/*
 * OBJ + MTL writer for the MakerLab host export path.
 *
 * MakerWorld's review (2026-07-27) asked us to export 3MF the way the SDK guide describes
 * rather than handing over a ZIP with our own .3mf inside. The SDK's export API accepts
 * `stl | obj | zip` only — the documented route to a 3MF is the OBJ path: the host converts
 * OBJ (+ MTL colours) into the 3MF the user receives. See "Export OBJ (Multi-Plate + MTL
 * Materials)" in the SDK developer guide.
 *
 * Guide constraints honoured here:
 *  - each colour region is its own `o` object referencing its material via `usemtl`
 *  - MTL carries `Kd` diffuse colour only (no texture maps)
 *  - materials are deduped per filament slot, keeping us under the 16-slot AMS ceiling
 *
 * Geometry matches buildThreeMF() exactly, including the drop-to-bed Z shift, so the OBJ
 * and the standalone .3mf describe an identical model.
 *
 * NOTE: OBJ has no concept of the independently-movable top/base grouping the 3MF encodes
 * via <components>. Parts keep their `clicker_top_* / clicker_base_*` names so the grouping
 * is still readable downstream, but the host decides how to reassemble them.
 */

// Round to keep the file compact without losing print precision (1e-4 mm) and avoid
// exponent notation, which some OBJ readers reject.
const f = (n: number): string => (Math.round(n * 1e4) / 1e4).toString();

// RGB 0..255 -> "r g b" as 0..1 floats, the only colour form MTL's Kd takes.
const kd = (rgb: RGB): string =>
  `${(rgb[0] / 255).toFixed(4)} ${(rgb[1] / 255).toFixed(4)} ${(rgb[2] / 255).toFixed(4)}`;

// OBJ object/material names are whitespace-delimited — keep them token-safe.
const slug = (s: string): string =>
  s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'part';

export interface ObjMtlResult {
  obj: string;
  mtl: string;
  materialCount: number;
}

/** Build an OBJ (+ matching MTL) for one print plate from the same parts buildThreeMF() takes. */
export function buildObjMtl(parts: ClickerPart[], mtlFileName = 'clicker.mtl'): ObjMtlResult {
  // Drop the whole assembly onto the build plate (min Z -> 0), keeping relative
  // positions — identical to buildThreeMF().
  let minZ = Infinity;
  for (const p of parts) {
    for (let i = 2; i < p.vertProperties.length; i += p.numProp) {
      if (p.vertProperties[i] < minZ) minZ = p.vertProperties[i];
    }
  }
  if (!isFinite(minZ)) minZ = 0;

  // One material per unique colour, in first-seen order — mirrors assignExtruders()
  // so OBJ material slots line up with the 3MF's filament slots.
  const matByColor = new Map<string, string>();
  const mtlBlocks: string[] = [];
  const materialFor = (rgb: RGB): string => {
    const key = rgb.join(',');
    let name = matByColor.get(key);
    if (name === undefined) {
      name = `filament${matByColor.size + 1}`;
      matByColor.set(key, name);
      mtlBlocks.push(`newmtl ${name}\nKd ${kd(rgb)}`);
    }
    return name;
  };

  const lines: string[] = [
    '# Clicker Generator — Vostok Labs',
    '# Units: millimetres. One `o` object per colour region.',
    `mtllib ${mtlFileName}`,
  ];

  // OBJ face indices are 1-based and run GLOBALLY across the file, so every object's
  // indices shift by the number of vertices already written.
  let vertexOffset = 0;
  const usedNames = new Set<string>();

  for (const p of parts) {
    const material = materialFor(p.colorRgb);

    // OBJ object names must be unique for the host to keep regions apart.
    let name = slug(`${p.group}_${p.name}`);
    let n = 2;
    while (usedNames.has(name)) name = `${slug(`${p.group}_${p.name}`)}_${n++}`;
    usedNames.add(name);

    lines.push(`o ${name}`);
    lines.push(`usemtl ${material}`);

    const vp = p.vertProperties;
    const np = p.numProp;
    for (let i = 0; i < vp.length; i += np) {
      lines.push(`v ${f(vp[i])} ${f(vp[i + 1])} ${f(vp[i + 2] - minZ)}`);
    }

    const tv = p.triVerts;
    for (let i = 0; i < tv.length; i += 3) {
      lines.push(
        `f ${tv[i] + 1 + vertexOffset} ${tv[i + 1] + 1 + vertexOffset} ${tv[i + 2] + 1 + vertexOffset}`
      );
    }

    vertexOffset += vp.length / np;
  }

  return {
    obj: lines.join('\n') + '\n',
    mtl: mtlBlocks.join('\n\n') + '\n',
    materialCount: matByColor.size,
  };
}

/** UTF-8 ArrayBuffer of an OBJ plate — the `buffer` shape sdk.export() expects. */
export function objToArrayBuffer(obj: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(obj);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

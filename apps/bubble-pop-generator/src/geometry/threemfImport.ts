// Parse a bundled .3mf asset into raw indexed mesh arrays, normalized to mm.
// Works in a worker (no DOM): fflate unzip + regex over the model XML.
//
// Extended from the clicker generator's copy: that one flattens the whole file
// into a single mesh, which is wrong for any 3MF with more than one <object> —
// triangle indices are per-object, so concatenating them scrambles the geometry.
// The pop module has three objects, so we split them.
import { unzipSync, strFromU8 } from 'fflate';

export interface RawMesh {
  vertProperties: Float32Array; // xyz interleaved (numProp = 3)
  triVerts: Uint32Array;
  numProp: 3;
}

export interface RawObject extends RawMesh {
  id: string;
}

const UNIT_TO_MM: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

function modelXml(buf: ArrayBuffer): string {
  const files = unzipSync(new Uint8Array(buf));
  const key = Object.keys(files).find((k) => k.toLowerCase().endsWith('3dmodel.model'));
  if (!key) throw new Error('3MF: missing 3D/3dmodel.model');
  return strFromU8(files[key]);
}

function meshFrom(body: string, scale: number): { vertProperties: Float32Array; triVerts: Uint32Array } {
  const verts: number[] = [];
  const vre = /<vertex\s+x="(-?[\d.eE+-]+)"\s+y="(-?[\d.eE+-]+)"\s+z="(-?[\d.eE+-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = vre.exec(body))) {
    verts.push(parseFloat(m[1]) * scale, parseFloat(m[2]) * scale, parseFloat(m[3]) * scale);
  }
  const tris: number[] = [];
  const tre = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g;
  while ((m = tre.exec(body))) tris.push(+m[1], +m[2], +m[3]);
  return { vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris) };
}

/** Every <object> in the file, in document order, each with its own index space. */
export function parse3MFObjects(buf: ArrayBuffer): RawObject[] {
  const xml = modelXml(buf);
  const unit = (xml.match(/<model[^>]*\bunit="([^"]+)"/)?.[1] ?? 'millimeter').toLowerCase();
  const s = UNIT_TO_MM[unit] ?? 1;

  const out: RawObject[] = [];
  const ore = /<object\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/object>/g;
  let m: RegExpExecArray | null;
  while ((m = ore.exec(xml))) {
    const { vertProperties, triVerts } = meshFrom(m[2], s);
    if (vertProperties.length < 9 || triVerts.length < 3) continue;
    out.push({ id: m[1], vertProperties, triVerts, numProp: 3 });
  }
  if (out.length === 0) throw new Error('3MF: empty or unparseable mesh');
  return out;
}

/** Single-mesh convenience for files that really do hold one object. */
export function parse3MF(buf: ArrayBuffer): RawMesh {
  const objs = parse3MFObjects(buf);
  if (objs.length !== 1) throw new Error(`3MF: expected 1 object, found ${objs.length}`);
  const { vertProperties, triVerts, numProp } = objs[0];
  return { vertProperties, triVerts, numProp };
}

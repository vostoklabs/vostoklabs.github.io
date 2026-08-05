// Converts the Bambu build-plate .3mf files in ./source into a single checked-in
// TS module (src/meshes.generated.ts) so generators can draw a plate with no zip
// parsing, no fetch and no extra runtime dependency.
//
// Normalisation, so every plate drops straight into a Z-up CAD scene:
//   - metres -> millimetres
//   - centred on X/Y about the outline's bounding box
//   - shifted in Z so the plate's TOP face sits at z = 0 (the part rests on it)
//
// Run: pnpm --filter @vostok/plates build-meshes
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(here, '..', 'source');
const OUT = join(here, '..', 'src', 'meshes.generated.ts');

/** Source file -> plate id. Keep in sync with src/registry.ts. */
const FILE_TO_ID = {
  '256x256 mm X2D, P2S P1 Series, X1 Series, A1.3mf': 'a1',
  'A1 mini 184x184 mm.3mf': 'a1mini',
  'H2D,H2C  355x346 mm.3mf': 'h2d',
};

/** Minimal ZIP reader: pulls one stored/deflated entry out of a .3mf.
 *  Reads the central directory — slicers stream the archive, so the local
 *  headers carry zeroed sizes and a trailing data descriptor instead. */
function readZipEntry(buf, wanted) {
  // End-of-central-directory record: scan back for its signature (no ZIP64 here).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      // The local header's own name/extra lengths give the data offset.
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`entry ${wanted} not found`);
}

function parseModel(xml) {
  const unit = /<model[^>]*unit="([^"]+)"/.exec(xml)?.[1] ?? 'millimeter';
  const perMm = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[unit];
  if (!perMm) throw new Error(`unknown unit ${unit}`);

  const verts = [];
  for (const m of xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)) {
    verts.push(+m[1] * perMm, +m[2] * perMm, +m[3] * perMm);
  }
  const tris = [];
  for (const m of xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)) {
    tris.push(+m[1], +m[2], +m[3]);
  }
  return { verts, tris };
}

/** The outline's X extent at a given Y, by scanlining the plate's top face.
 *  Returns null where the row misses the outline entirely. */
function extentAt(edges, y) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x1, y1, x2, y2] of edges) {
    if (y1 === y2) continue;
    if (y < Math.min(y1, y2) || y > Math.max(y1, y2)) continue;
    const x = x1 + ((y - y1) / (y2 - y1)) * (x2 - x1);
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return lo > hi ? null : [lo, hi];
}

/** Centre on the plate BODY, put the top face at z = 0, round to 1/1000 mm.
 *
 *  Body, not bounding box: these outlines include the handle tab that sticks
 *  out of the front of a real Bambu plate, so the bbox centre sits ~9 mm off
 *  the actual bed centre. The body is the run of rows that span (nearly) the
 *  full width — the tab is far narrower, so it drops out. */
function normalise({ verts, tris }) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < verts.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], verts[i + a]);
      hi[a] = Math.max(hi[a], verts[i + a]);
    }
  }

  // Top-face edges only — the outline seen from above.
  const zTop = hi[2];
  const edges = [];
  const onTop = (v) => Math.abs(verts[v * 3 + 2] - zTop) < 1e-6;
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (onTop(p) && onTop(q)) edges.push([verts[p * 3], verts[p * 3 + 1], verts[q * 3], verts[q * 3 + 1]]);
    }
  }

  const STEP = 0.25;
  const rows = [];
  for (let y = lo[1]; y <= hi[1]; y += STEP) {
    const e = extentAt(edges, y);
    if (e) rows.push([y, e[0], e[1]]);
  }
  const fullWidth = Math.max(...rows.map((r) => r[2] - r[1]));
  const body = rows.filter((r) => r[2] - r[1] >= fullWidth * 0.9);
  if (body.length === 0) throw new Error('could not find the plate body');
  const bodyY = [body[0][0], body[body.length - 1][0]];
  const bodyX = [Math.min(...body.map((r) => r[1])), Math.max(...body.map((r) => r[2]))];

  const off = [-(bodyX[0] + bodyX[1]) / 2, -(bodyY[0] + bodyY[1]) / 2, -hi[2]];
  const out = new Array(verts.length);
  for (let i = 0; i < verts.length; i += 3) {
    for (let a = 0; a < 3; a++) out[i + a] = Math.round((verts[i + a] + off[a]) * 1000) / 1000;
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    verts: out,
    tris,
    width: r2(bodyX[1] - bodyX[0]),
    depth: r2(bodyY[1] - bodyY[0]),
    thickness: r2(hi[2] - lo[2]),
    outlineWidth: r2(hi[0] - lo[0]),
    outlineDepth: r2(hi[1] - lo[1]),
  };
}

const entries = [];
for (const file of readdirSync(SOURCE_DIR).sort()) {
  if (!file.endsWith('.3mf')) continue;
  const id = FILE_TO_ID[file];
  if (!id) throw new Error(`no plate id mapped for source file "${file}" — add it to FILE_TO_ID`);
  const zip = readFileSync(join(SOURCE_DIR, file));
  const mesh = normalise(parseModel(readZipEntry(zip, '3D/3dmodel.model').toString('utf8')));
  entries.push({ id, file, ...mesh });
  console.log(
    `${id}: body ${mesh.width}x${mesh.depth}mm (outline ${mesh.outlineWidth}x${mesh.outlineDepth}), ` +
      `${mesh.thickness}mm thick, ${mesh.tris.length / 3} tris`,
  );
}

const body = entries
  .map(
    (e) => `  ${e.id}: {
    // ${e.file} — ${e.width} x ${e.depth} mm, ${e.thickness} mm thick
    width: ${e.width},
    depth: ${e.depth},
    thickness: ${e.thickness},
    positions: [${e.verts.join(',')}],
    indices: [${e.tris.join(',')}],
  },`,
  )
  .join('\n');

writeFileSync(
  OUT,
  `// GENERATED by scripts/build-plates.mjs from ./source/*.3mf — do not edit by hand.
// Millimetres, Z-up, centred on X/Y, top face at z = 0.
export interface PlateMesh {
  /** Outline bounding box, mm. */
  width: number;
  depth: number;
  thickness: number;
  positions: number[];
  indices: number[];
}

export const PLATE_MESHES: Record<string, PlateMesh> = {
${body}
};
`,
);
console.log(`wrote ${OUT}`);

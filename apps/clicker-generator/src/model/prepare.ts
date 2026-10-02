// Turn a parsed file into the one solid every cut is made from.
//
//   weld → orient → validate → union overlapping shells → repair → simplify → set down
//
// Runs once per upload, in the worker. The result is cached there and every rebuild is a
// transform of it plus the cutter, so none of this is paid twice.
import type { RawModel } from './parse';
import type { ModelInfo } from './types';
import { remeshByVoxels } from './repair';

type Wasm = any;
type Solid = any;

/** Triangles the cutters work on. Past this a rebuild stops feeling live: a boolean against the
 *  model costs 70–250 ms at 50–150k triangles in the worker and 1.5–3.9 s at a million,
 *  and a cut is three or four of them. */
export const TRIANGLE_BUDGET = 100_000;

export interface PreparedModel {
  solid: Solid;
  info: ModelInfo;
}

export function prepareModel(wasm: Wasm, raw: RawModel, name: string): PreparedModel {
  const notes: string[] = [];
  const fileTriangles = Math.floor(raw.indices.length / 3);
  const welded = weld(raw.positions, raw.indices);
  if (welded.triangles < 4) throw new Error('This file has no solid in it.');

  // A closed mesh wound inside-out has a negative volume; flipping it is lossless.
  if (signedVolume(welded.positions, welded.indices) < 0) {
    flipAll(welded.indices);
    notes.push('The model was inside-out; it has been turned the right way.');
  }

  const longest = Math.max(...boxOf(welded.positions));
  if (!(longest > 0)) throw new Error('This model has no size.');

  let solid = toManifold(wasm, welded.positions, welded.indices);
  if (solid) {
    // A huge upload is brought down before the shells are joined: the union's cost scales with
    // what it is given, and nothing it would join is finer than the simplify tolerance anyway.
    if (solid.numTri() > 2 * TRIANGLE_BUDGET) solid = simplifyTo(solid, 2 * TRIANGLE_BUDGET, longest);
    const merged = unionShells(wasm, solid);
    if (merged !== solid) {
      solid.delete();
      solid = merged;
      notes.push('Overlapping parts were joined into one solid.');
    }
  } else {
    solid = remeshByVoxels(wasm, welded.positions, welded.indices);
    notes.push('The model had holes or broken faces, so it was rebuilt as a closed solid. Tiny details may be softer.');
  }

  if (solid.numTri() > TRIANGLE_BUDGET) {
    solid = simplifyTo(solid, TRIANGLE_BUDGET, longest);
    notes.push(`Simplified from ${fileTriangles.toLocaleString('en')} to ${solid.numTri().toLocaleString('en')} triangles.`);
  }

  // Set it down: X/Y centred, bottom on Z 0.
  const bb = solid.boundingBox();
  const centred = solid.translate([-(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, -bb.min[2]]);
  solid.delete();

  return {
    solid: centred,
    info: {
      name,
      fileTriangles,
      triangles: centred.numTri(),
      sizeMm: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]],
      notes,
    },
  };
}

/**
 * Simplify to `budget` triangles with the smallest tolerance that gets there — output size tracks
 * the tolerance, not the input's density. Tolerances are for a model printed about 60 mm
 * long, the size Model mode starts at, so a file authored in other units behaves the same.
 * Consumes `solid`.
 */
function simplifyTo(solid: Solid, budget: number, longest: number): Solid {
  const unit = longest / 60;
  let out = solid;
  for (const t of [0.02, 0.05, 0.1, 0.2, 0.4]) {
    const next = out.simplify(t * unit);
    out.delete();
    out = next;
    if (out.numTri() <= budget) break;
  }
  return out;
}

/** Extent of a vertex list on each axis. */
function boxOf(pos: Float32Array): [number, number, number] {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < x0) x0 = pos[i]; if (pos[i] > x1) x1 = pos[i];
    if (pos[i + 1] < y0) y0 = pos[i + 1]; if (pos[i + 1] > y1) y1 = pos[i + 1];
    if (pos[i + 2] < z0) z0 = pos[i + 2]; if (pos[i + 2] > z1) z1 = pos[i + 2];
  }
  return pos.length ? [x1 - x0, y1 - y0, z1 - z0] : [0, 0, 0];
}

/** Make a Manifold, or null when the mesh is not a closed, consistently wound surface. */
export function toManifold(wasm: Wasm, positions: Float32Array, indices: Uint32Array): Solid | null {
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: positions, triVerts: indices });
  mesh.merge();
  let solid: Solid | null = null;
  try {
    solid = wasm.Manifold.ofMesh(mesh);
  } catch {
    return null;
  }
  if (solid.status() !== 'NoError' || solid.isEmpty()) {
    solid.delete();
    return null;
  }
  return solid;
}

/**
 * Join shells that overlap. A sculpt is typically exported as separate closed bodies pushed into
 * each other — an arm through a torso — and each is a fine manifold on its own, so `ofMesh`
 * accepts the lot. The overlap is invisible until a cut goes through it and leaves the inner
 * faces standing. A batch union of the parts is the real solid.
 *
 * Not done when any part is a cavity (negative volume): that is one body with a hollow inside,
 * already correct, and unioning its pieces would fill the hollow.
 */
function unionShells(wasm: Wasm, solid: Solid): Solid {
  const parts: Solid[] = solid.decompose();
  try {
    if (parts.length < 2) return solid;
    if (parts.some((p) => p.volume() <= 0)) return solid;
    return wasm.Manifold.union(parts);
  } finally {
    for (const p of parts) p.delete();
  }
}

/**
 * Weld vertices that sit at exactly the same position — an STL is a triangle soup, three fresh
 * vertices per triangle, and a closed surface only exists once they are shared. Exact, not
 * epsilon: `Mesh.merge()` closes the near-misses afterwards, and an epsilon weld here would also
 * pinch together features that are merely close. Degenerate triangles are dropped.
 */
export function weld(pos: Float32Array, idx: Uint32Array): { positions: Float32Array; indices: Uint32Array; triangles: number } {
  const n = pos.length / 3;
  const bits = new Uint32Array(n * 3);
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  for (let i = 0; i < n * 3; i++) {
    f[0] = pos[i] === 0 ? 0 : pos[i]; // -0 and +0 are one position
    bits[i] = u[0];
  }
  let size = 1;
  while (size < n * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1);
  const remap = new Uint32Array(n);
  const outBits = new Uint32Array(n * 3);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a = bits[i * 3];
    const b = bits[i * 3 + 1];
    const c = bits[i * 3 + 2];
    let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & (size - 1);
    for (;;) {
      const j = table[h];
      if (j < 0) {
        table[h] = count;
        outBits[count * 3] = a;
        outBits[count * 3 + 1] = b;
        outBits[count * 3 + 2] = c;
        remap[i] = count++;
        break;
      }
      if (outBits[j * 3] === a && outBits[j * 3 + 1] === b && outBits[j * 3 + 2] === c) {
        remap[i] = j;
        break;
      }
      h = (h + 1) & (size - 1);
    }
  }
  const positions = new Float32Array(new Uint32Array(outBits.buffer, 0, count * 3).slice().buffer);
  const finite = (v: number) => Number.isFinite(positions[v * 3]) && Number.isFinite(positions[v * 3 + 1])
    && Number.isFinite(positions[v * 3 + 2]);
  const tris = new Uint32Array(idx.length);
  let t = 0;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    if (idx[i] >= n || idx[i + 1] >= n || idx[i + 2] >= n) continue; // an index past the vertex list
    const a = remap[idx[i]];
    const b = remap[idx[i + 1]];
    const c = remap[idx[i + 2]];
    if (a === b || b === c || a === c) continue;
    // A NaN or infinite corner is a named failure mode of real exports — drop the face.
    if (!finite(a) || !finite(b) || !finite(c)) continue;
    tris[t++] = a;
    tris[t++] = b;
    tris[t++] = c;
  }
  // Keep only vertices a face still uses: a dropped face's NaN corner would otherwise stay in the
  // list, and `ofMesh` rejects a mesh for an unreferenced non-finite vertex as readily as a used one.
  const keep = new Int32Array(count).fill(-1);
  let used = 0;
  for (let i = 0; i < t; i++) if (keep[tris[i]] < 0) keep[tris[i]] = used++;
  const compact = new Float32Array(used * 3);
  for (let v = 0; v < count; v++) {
    const k = keep[v];
    if (k < 0) continue;
    compact[k * 3] = positions[v * 3];
    compact[k * 3 + 1] = positions[v * 3 + 1];
    compact[k * 3 + 2] = positions[v * 3 + 2];
  }
  for (let i = 0; i < t; i++) tris[i] = keep[tris[i]];
  return { positions: compact, indices: tris.slice(0, t), triangles: t / 3 };
}

export function signedVolume(pos: Float32Array, idx: Uint32Array): number {
  let v = 0;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
      - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
      + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return v / 6;
}

function flipAll(idx: Uint32Array): void {
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
}

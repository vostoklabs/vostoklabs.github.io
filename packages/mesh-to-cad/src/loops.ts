// Whether a face's loops are simple on its own surface. An importer trims a face by its loops as
// drawn in the surface's own parameters (u, v): a loop that crosses itself there, or crosses
// another loop of the face, is one it cannot trim, and it repairs it by cutting the face into
// pieces, which no longer join the rest of the solid. Two edges can cross there without coming
// near each other in space, so this is tested where the importer tests it.

import { type V3, basis, dist, dot, sub } from './linalg';
import { surfaceHit } from './bspline';
import { asWritten, nearestOnSheet, sheetCloses, spanOf } from './meet';
import { type Surface } from './surfaces';
import { type BEdge, type BFace } from './topology';

/** Points per millimetre of edge, the least and most per edge, and per piece of a curve, a loop is drawn with. */
const PER_MM = 10, LEAST = 8, MOST = 200, PER_PIECE = 12;

const hit = surfaceHit();

/** A face's surface drawn flat: the point's place, and how far apart the copies of a place are in each direction (0 where the surface does not close). */
type Flat = { at: (p: V3) => [number, number]; period: [number, number] };

/**
 * The faces' surfaces that can be tested: a plane (its own two directions) and a sheet (its
 * parameters, followed point by point along the loop). A sheet that closes on itself is followed
 * across its seam: each place is taken in the copy of the parameters nearest the last one, so a
 * loop that goes once round the sheet draws as one run carried on past the seam, not as a run that
 * jumps back. Others (turned and swept faces) return null and are not tested.
 */
function flattener(s: Surface): Flat | null {
  if (s.kind === 'plane') {
    const [e1, e2] = basis(s.n);
    return { at: (p) => { const d = sub(p, s.o); return [dot(d, e1), dot(d, e2)]; }, period: [0, 0] };
  }
  if (s.kind === 'bspline') {
    const w = asWritten(s);
    if (w.kind !== 'bspline') return null;
    const cl = sheetCloses(w);
    const period: [number, number] = [cl.u ? w.knotsU[w.knotsU.length - 1] - w.knotsU[0] : 0, cl.v ? w.knotsV[w.knotsV.length - 1] - w.knotsV[0] : 0];
    let last: [number, number] | undefined, shown: [number, number] | undefined;
    const near = (x: number, ref: number, span: number) => (span ? x + span * Math.round((ref - x) / span) : x);
    return {
      at: (p) => {
        const c = nearestOnSheet(w, p, last, hit);
        last = [c.u, c.v];
        shown = shown ? [near(c.u, shown[0], period[0]), near(c.v, shown[1], period[1])] : [c.u, c.v];
        return shown;
      },
      period,
    };
  }
  return null;
}

/** One straight piece of a loop drawn in a face's parameters, and the edge it belongs to. */
type Piece = { ax: number; ay: number; bx: number; by: number; edge: number; loop: number; at: number; of: number; s: number; total: number; copy: boolean };

/**
 * The edges of each given face whose loops are not simple in the face's own parameters: edges
 * that take part in a loop crossing itself or another loop of the face, and every edge of a loop
 * that turns the other way round from the same loop drawn along its borders in the mesh, or
 * encloses next to nothing (`borders[i]`: edge i's border, from its first corner to its last).
 * On a sheet that closes on itself a loop may go once round it (the two rims of a band round a
 * hole): such a loop encloses nothing in the parameters and is not a fault, and it is tested for
 * crossings against the copies of every loop one period either side, so a real crossing across
 * the seam is still found. A loop going round more than once is a fault.
 * Faces whose surface cannot be tested are skipped. Of each pair of edges that cross, and of each
 * such loop, only the edge `worse` picks is returned (the one to redraw first). The result maps a
 * face to those edges.
 */
export function loopTrouble(edges: BEdge[], faces: BFace[], vertices: V3[], borders: V3[][], which: Iterable<number>, worse: (a: number, b: number) => number): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const f of which) {
    const shared = flattener(faces[f].surf);
    if (!shared) continue;
    const closes = !!(shared.period[0] || shared.period[1]);
    const pieces: Piece[] = [];
    const bad = new Set<number>();
    faces[f].loops.forEach((loop, li) => {
      // On a sheet that closes, each loop is followed from its own start: a search carried over
      // from the last loop would start on the other rim of the band and settle there.
      const flat = closes ? flattener(faces[f].surf)! : shared, meshFlat = closes ? flattener(faces[f].surf)! : shared;
      const pts: [number, number][] = [], owner: number[] = [], mesh: [number, number][] = [], along: number[] = [];
      let s = 0, last: V3 | null = null;
      for (const oe of loop) {
        const e = edges[oe.edge];
        const sp = spanOf(e.curve, vertices[e.v0], vertices[e.v1], e.v0 === e.v1);
        const n = Math.min(MOST, Math.max(LEAST, Math.ceil(sp.length * PER_MM), sp.pieces * PER_PIECE));
        for (let k = 0; k < n; k++) {
          const t = oe.fwd ? sp.t0 + ((sp.t1 - sp.t0) * k) / n : sp.t1 - ((sp.t1 - sp.t0) * k) / n;
          const p = sp.at(t);
          if (last) s += dist(p, last);
          last = p;
          pts.push(flat.at(p));
          owner.push(oe.edge);
          along.push(s);
        }
      }
      for (const oe of loop) {
        const b = borders[oe.edge];
        for (let k = 0; k + 1 < b.length; k++) mesh.push(meshFlat.at(b[oe.fwd ? k : b.length - 1 - k]));
      }
      const m = pts.length;
      if (!m) return;
      const start = loopStart(edges, vertices, loop[0]);
      if (last) s += dist(last, start);
      // Where the loop comes back to: its first place again, or a copy of it once round the sheet.
      const end = closes ? flat.at(start) : pts[0];
      const turns = [0, 1].map((d) => (flat.period[d] ? Math.round((end[d] - pts[0][d]) / flat.period[d]) : 0));
      const closeAt: [number, number] = [pts[0][0] + turns[0] * flat.period[0], pts[0][1] + turns[1] * flat.period[1]];
      for (const [cu, cv] of copies(flat.period)) for (let k = 0; k < m; k++) {
        const a = pts[k], b = k + 1 < m ? pts[k + 1] : closeAt;
        pieces.push({ ax: a[0] + cu, ay: a[1] + cv, bx: b[0] + cu, by: b[1] + cv, edge: owner[k], loop: li, at: k, of: m, s: along[k], total: s, copy: cu !== 0 || cv !== 0 });
      }
      if (Math.abs(turns[0]) + Math.abs(turns[1]) > 1) { bad.add(loop.map((oe) => oe.edge).reduce(worse)); return; }
      if (turns[0] || turns[1]) return;
      const drawn = area(pts), meshArea = area(mesh);
      if (Math.sign(drawn) !== Math.sign(meshArea) || Math.abs(drawn) < NEXT_TO_NOTHING * Math.abs(meshArea)) bad.add(loop.map((oe) => oe.edge).reduce(worse));
    });
    for (const [a, b] of crossingPieces(pieces)) bad.add(worse(a, b));
    if (bad.size) out.set(f, bad);
  }
  return out;
}

/** The shifts a loop is drawn at: itself, and on a sheet that closes, one period either side. */
function copies(period: [number, number]): [number, number][] {
  const out: [number, number][] = [[0, 0]];
  for (const du of period[0] ? [-period[0], period[0]] : []) out.push([du, 0]);
  for (const dv of period[1] ? [-period[1], period[1]] : []) out.push([0, dv]);
  return out;
}

/** How far along a loop (mm) a crossing of the loop with itself may be and still be a wobble. */
const WOBBLE = 0.05;

/** The first point of a loop's first edge, where the loop closes. */
function loopStart(edges: BEdge[], vertices: V3[], oe: { edge: number; fwd: boolean }): V3 {
  const e = edges[oe.edge];
  return vertices[oe.fwd ? e.v0 : e.v1];
}

/** A loop enclosing less than this share of what its borders in the mesh enclose encloses next to nothing. */
const NEXT_TO_NOTHING = 0.01;

/** The pairs of edges whose pieces cross (pieces that are not neighbours), found through a grid. */
function crossingPieces(pieces: Piece[]): [number, number][] {
  const bad: [number, number][] = [];
  if (pieces.length < 4) return bad;
  let lx = Infinity, ly = Infinity, hx = -Infinity, hy = -Infinity;
  for (const p of pieces) {
    lx = Math.min(lx, p.ax, p.bx); hx = Math.max(hx, p.ax, p.bx);
    ly = Math.min(ly, p.ay, p.by); hy = Math.max(hy, p.ay, p.by);
  }
  const n = Math.max(1, Math.ceil(Math.sqrt(pieces.length)));
  const sx = (hx - lx) / n || 1, sy = (hy - ly) / n || 1;
  const cell = (x: number, y: number) => [Math.min(n - 1, Math.max(0, Math.floor((x - lx) / sx))), Math.min(n - 1, Math.max(0, Math.floor((y - ly) / sy)))];
  const grid = new Map<number, number[]>();
  pieces.forEach((p, i) => {
    const [x0, y0] = cell(Math.min(p.ax, p.bx), Math.min(p.ay, p.by)), [x1, y1] = cell(Math.max(p.ax, p.bx), Math.max(p.ay, p.by));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = x * n + y;
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(i);
    }
  });
  const seen = new Set<number>();
  for (const list of grid.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const i = Math.min(list[a], list[b]), j = Math.max(list[a], list[b]);
    const key = i * pieces.length + j;
    if (seen.has(key)) continue;
    seen.add(key);
    const P = pieces[i], Q = pieces[j];
    if (P.copy && Q.copy) continue;
    // Neighbours along one loop share an end; and a curve that wobbles across itself within a
    // few hundredths of a millimetre of its own length is closed by an importer's tolerance.
    if (P.loop === Q.loop && (Math.abs(P.at - Q.at) === 1 || Math.abs(P.at - Q.at) === P.of - 1)) continue;
    if (P.loop === Q.loop && Math.min(Math.abs(P.s - Q.s), P.total - Math.abs(P.s - Q.s)) < WOBBLE) continue;
    if (cross(P, Q)) bad.push([P.edge, Q.edge]);
  }
  return bad;
}

/** Whether two straight pieces cross (touching at an end does not count). */
function cross(P: Piece, Q: Piece): boolean {
  const o = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d1 = o(P.ax, P.ay, P.bx, P.by, Q.ax, Q.ay), d2 = o(P.ax, P.ay, P.bx, P.by, Q.bx, Q.by);
  const d3 = o(Q.ax, Q.ay, Q.bx, Q.by, P.ax, P.ay), d4 = o(Q.ax, Q.ay, Q.bx, Q.by, P.bx, P.by);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** The signed area of a closed polygon. */
function area(p: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

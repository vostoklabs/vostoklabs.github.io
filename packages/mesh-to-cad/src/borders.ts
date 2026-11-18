// The border map: where each face of the design ends, read from the mesh before any surface is
// fitted to what the list of surfaces does not already hold.
//
// A border is a mesh edge, for one of four reasons, strongest first:
//   surface  a face on a listed surface that is believed ends here;
//   crease   two triangles meet at a sharp angle;
//   stop     a long straight chain of mesh edges (a rail) that other rails end on instead of
//            crossing: an exporter meshes each face on its own grid, and the grid stops at its border;
//   bend     the surface starts or stops bending. Along a rail: the rows on one side of it turn
//            from one to the next and the rows on the other side do not. Where the mesh has no
//            rows (long flat strips side by side), per edge: the strip on one side turns on, for
//            its width, several times faster than the one on the other.
// Patches are the triangles joined across every edge that is not a border. Then a border that
// separates nothing is dropped, and a patch one row of the mesh wide between two soft borders
// (stop, bend) is two readings of one border a row apart: it joins the side it bends least from.
//
// Nothing here fits anything, and nothing is cut to make a fit work.

import { type V3, dot, maxOf, sub } from './linalg';
import { type Mesh, triNormal, triVerts, vtx } from './mesh';
import { cornersOf } from './segment';
import { type Surface, distance } from './surfaces';

type Face = { tris: number[]; surf: Surface | null; err: number };
export type BorderKind = 'surface' | 'crease' | 'stop' | 'bend';
export type BorderMap = {
  /** The patch each triangle is in. */
  label: Int32Array;
  patches: number[][];
  /** For each patch, the listed face it is (an index into the faces given), or -1: still to be given a surface. */
  face: number[];
  /** The borders that separate two patches: a mesh edge (two vertices) and why. */
  borders: [number, number, BorderKind][];
  /** Border edges dropped because they separated nothing, and patches joined to a neighbour as slivers. */
  dropped: number;
  joined: number;
};

const deg = (x: number) => (x * Math.PI) / 180;
/** Two triangles meeting at this angle or more are two faces. */
const CREASE = deg(30);
/** A rail goes straight on at each vertex to within this, and has at least this many vertices. */
const RAIL_TURN = Math.cos(deg(15)), RAIL_LEAST = 5;
/** Rows that turn this little from one to the next are flat; this much, round. */
const FLAT = deg(1.5), ROUND = deg(4);
/** How many times faster one side must turn than the other for the bending to start between them. */
const JUMP = 3;
/** A strip of a round is at least this many times longer than it is wide. */
const STRIP_LONG = 4;
/** A lone curved face of this many triangles or fewer is not believed on its own (as in the list of surfaces). */
const SCRAP = 16;
/** A patch this many triangles or fewer between soft borders is a sliver whatever its shape. */
const SLIVER = 3;
/** A one-row patch is a sliver if it is no wider than this many of its neighbour's rows. */
const ROW_WIDE = 1.5;
/**
 * A curved face of this many triangles or more is believed when its vertices sit within LOOSE of
 * its surface, not only within the point tolerance: where two curved faces of a design meet, the
 * CAD program's own curve between them puts the shared vertices a few thousandths off either
 * surface, and a large round read as one torus to 0.0015 mm is far nearer the design than a sheet
 * cut into pieces over it. Only if the surface is in proportion to the face (LOOSE_SIZE): a small
 * blend fits a torus of almost any size.
 */
const LOOSE_FACE = 200, LOOSE = 5e-3, LOOSE_SIZE = 5;

export function borderMap(m: Mesh, faces: Face[], opt: { eps: number }): BorderMap {
  const nT = m.tri.length / 3, nV = m.pos.length / 3;
  const P = (v: number) => vtx(m.pos, v);
  const key = (a: number, b: number) => (a < b ? a * nV + b : b * nV + a);
  const unit = (a: V3): V3 => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };

  // The faces that are believed: a swept face; a curved face whose surface holds its own points
  // exactly and is either shared or more than a scrap; a flat face of five corners or more.
  const groups = new Map<Surface, { faces: number; tris: number; exact: boolean }>();
  const vertsOf = faces.map((f) => [...new Set(f.tris.flatMap((t) => triVerts(m, t)))]);
  faces.forEach((f, i) => {
    if (!f.surf) return;
    const g = groups.get(f.surf) ?? { faces: 0, tris: 0, exact: true };
    g.faces++;
    g.tris += f.tris.length;
    if (g.exact && f.surf.kind !== 'revolution' && f.surf.kind !== 'extrusion' && f.surf.kind !== 'bspline') {
      g.exact = vertsOf[i].every((v) => Math.abs(distance(f.surf!, P(v))) <= opt.eps);
    }
    groups.set(f.surf, g);
  });
  const believed = faces.map((f, i) => {
    const s = f.surf;
    if (!s || s.kind === 'bspline') return false;
    if (s.kind === 'revolution' || s.kind === 'extrusion') return true;
    if (s.kind === 'plane') return cornersOf(m, f.tris[0], vertsOf[i], opt.eps) >= 5;
    const g = groups.get(s)!;
    return (g.exact && (g.faces > 1 || g.tris > SCRAP)) || looseBelieved(i);
  });
  /** A large curved face near enough its surface, which is in proportion to it (see LOOSE_FACE). */
  function looseBelieved(i: number): boolean {
    const s = faces[i].surf!;
    if (faces[i].tris.length < LOOSE_FACE) return false;
    const radius = s.kind === 'cylinder' || s.kind === 'sphere' ? s.r : s.kind === 'torus' ? Math.max(s.r, Math.abs(s.R)) : 0;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of vertsOf[i]) {
      const p = P(v);
      if (Math.abs(distance(s, p)) > LOOSE) return false;
      for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], p[d]); hi[d] = Math.max(hi[d], p[d]); }
    }
    return radius <= LOOSE_SIZE * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  }
  const known = new Int32Array(nT).fill(-1);
  faces.forEach((f, i) => { if (believed[i]) for (const t of f.tris) known[t] = i; });

  // Every mesh edge once: its two triangles and the angle they meet at.
  type Edge = { a: number; b: number; t: number; w: number; turn: number };
  const edges = new Map<number, Edge>();
  const nbr: number[][] = Array.from({ length: nV }, () => []);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w < t) continue;
    const a = m.tri[t * 3 + k], b = m.tri[t * 3 + ((k + 1) % 3)];
    edges.set(key(a, b), { a, b, t, w, turn: Math.acos(Math.max(-1, Math.min(1, dot(triNormal(m, t), triNormal(m, w))))) });
    nbr[a].push(b);
    nbr[b].push(a);
  }
  const border = new Map<number, BorderKind>();
  /** Open ground: an edge with no believed face on either side, where the map has to find the borders itself. */
  const open = (e: Edge) => known[e.t] < 0 && known[e.w] < 0;
  const mark = (k: number, why: BorderKind) => { if (!border.has(k) && open(edges.get(k)!)) border.set(k, why); };

  const heightOver = (t: number, a: number, b: number) => {
    const A = P(a), d = unit(sub(P(b), A));
    return maxOf(triVerts(m, t).map((v) => { const q = sub(P(v), A), h = dot(q, d); return Math.hypot(q[0] - h * d[0], q[1] - h * d[1], q[2] - h * d[2]); }));
  };

  // 1. Believed faces, and creases.
  for (const [k, e] of edges) {
    if (known[e.t] !== known[e.w]) border.set(k, 'surface');
    else if (e.turn >= CREASE) mark(k, 'crease');
  }

  // Rails: chains of edges that go straight on at every vertex, each the other's straightest way on.
  const dir = (a: number, b: number) => unit(sub(P(b), P(a)));
  const straight = (u: number, v: number) => {
    const d = dir(u, v);
    let best = -1, c = -2;
    for (const y of nbr[v]) { if (y === u) continue; const cc = dot(d, dir(v, y)); if (cc > c) { c = cc; best = y; } }
    return c >= RAIL_TURN ? best : -1;
  };
  const next = (u: number, v: number) => { const w = straight(u, v); return w >= 0 && straight(w, v) === u ? w : -1; };
  const walked = new Set<number>();
  const rails: number[][] = [];
  const railOf = new Map<number, number>();
  for (let a = 0; a < nV; a++) for (const b of nbr[a]) {
    if (walked.has(key(a, b))) continue;
    walked.add(key(a, b));
    const line = [a, b], on = new Set(line);
    for (let u = a, v = b; ;) { const w = next(u, v); if (w < 0 || on.has(w)) break; walked.add(key(v, w)); line.push(w); on.add(w); u = v; v = w; }
    for (let u = b, v = a; ;) { const w = next(u, v); if (w < 0 || on.has(w)) break; walked.add(key(v, w)); line.unshift(w); on.add(w); u = v; v = w; }
    if (line.length < RAIL_LEAST) continue;
    for (let i = 0; i + 1 < line.length; i++) railOf.set(key(line[i], line[i + 1]), rails.length);
    rails.push(line);
  }

  // 2. Rails that other rails stop on.
  const ends = new Map<number, number>(), through = new Map<number, number>();
  for (const c of rails) c.forEach((v, i) => { const at = i === 0 || i === c.length - 1 ? ends : through; at.set(v, (at.get(v) ?? 0) + 1); });
  for (const c of rails) {
    let stop = 0, cross = 0;
    for (const v of c.slice(1, -1)) { stop += ends.get(v) ?? 0; cross += (through.get(v) ?? 1) - 1; }
    if (stop < 3 || stop < cross) continue;
    for (let i = 0; i + 1 < c.length; i++) mark(key(c[i], c[i + 1]), 'stop');
  }

  // 3. Where the bending starts or stops, along a rail. Each triangle with a side on a rail is in
  // a row beside it; the row's far side is the rail through its third corner. A rail's own turn
  // is the typical angle its two rows meet at.
  const railTurn = rails.map((c) => {
    const turns: number[] = [];
    for (let i = 0; i + 1 < c.length; i++) turns.push(edges.get(key(c[i], c[i + 1]))!.turn);
    turns.sort((x, y) => x - y);
    return turns[turns.length >> 1];
  });
  const onRail: number[][] = Array.from({ length: nV }, () => []);
  rails.forEach((c, i) => c.forEach((v) => onRail[v].push(i)));
  const beside: Map<number, number>[] = rails.map(() => new Map());
  for (let t = 0; t < nT; t++) {
    const vs = triVerts(m, t);
    for (let k = 0; k < 3; k++) {
      const r = railOf.get(key(vs[k], vs[(k + 1) % 3]));
      if (r === undefined) continue;
      for (const o of onRail[vs[(k + 2) % 3]]) if (o !== r) beside[r].set(o, (beside[r].get(o) ?? 0) + 1);
    }
  }
  rails.forEach((c, r) => {
    if (railTurn[r] >= CREASE) return;
    const sides = [...beside[r]].filter(([, n]) => n >= 0.5 * (c.length - 1)).map(([o]) => railTurn[o]);
    if (sides.length < 2) return;
    const lo = Math.min(...sides), hi = Math.max(...sides);
    if (lo <= FLAT && hi >= ROUND && railTurn[r] >= FLAT && railTurn[r] <= 0.8 * hi) for (let i = 0; i + 1 < c.length; i++) mark(key(c[i], c[i + 1]), 'bend');
  });

  // 3b. The same where there are no rows: long strips lying side by side (an exporter steps a
  // ruled face in strips that run its whole length). A strip is the triangles joined across edges
  // that as good as do not turn: one long triangle of a tapering round, or a whole flat face.
  // How fast a strip bends is the angles it meets its two longest neighbours at, over its width:
  // both sides at once, because on a twisting round the angles alternate (a triangle's diagonal
  // side turns little, its other side a lot) and either alone says little. The bending starts
  // between two strips where one bends several times faster than the other.
  const stripOf = new Int32Array(nT).fill(-1);
  const strips: number[][] = [];
  for (let t0 = 0; t0 < nT; t0++) {
    if (stripOf[t0] >= 0) continue;
    const part = [t0];
    stripOf[t0] = strips.length;
    for (let i = 0; i < part.length && known[t0] < 0; i++) for (let k = 0; k < 3; k++) {
      const t = part[i], w = m.adj[t * 3 + k];
      if (w < 0 || stripOf[w] >= 0 || known[w] >= 0) continue;
      if (edges.get(key(m.tri[t * 3 + k], m.tri[t * 3 + ((k + 1) % 3)]))!.turn >= FLAT) continue;
      stripOf[w] = strips.length;
      part.push(w);
    }
    strips.push(part);
  }
  /** Each strip's smooth neighbours: the length of border they share and the largest angle along it. */
  const meets: Map<number, { len: number; turn: number }>[] = strips.map(() => new Map());
  for (const e of edges.values()) {
    const u = stripOf[e.t], v = stripOf[e.w];
    if (u === v || e.turn >= CREASE || !open(e)) continue;
    const A = P(e.a), B = P(e.b), len = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    for (const [x, y] of [[u, v], [v, u]]) {
      const side = meets[x].get(y) ?? { len: 0, turn: 0 };
      side.len += len;
      side.turn = Math.max(side.turn, e.turn);
      meets[x].set(y, side);
    }
  }
  const bending = strips.map((tris, u) => {
    const sides = [...meets[u].values()].sort((x, y) => y.len - x.len);
    if (!sides.length) return { rate: 0, turn: 0, width: 0, long: false };
    const width = tris.reduce((a, t) => a + m.area[t], 0) / sides[0].len;
    const turn = (sides[0].turn + (sides[1]?.turn ?? 0)) / 2;
    return { rate: turn / width, turn, width, long: sides[0].len >= STRIP_LONG * width };
  });
  // (An edge on a rail is left to the rails above, which see a whole row at once.)
  const flats = new Set<number>();
  for (const [k, e] of edges) {
    if (border.has(k) || railOf.has(k) || !open(e) || e.turn < FLAT || e.turn >= CREASE) continue;
    const u = stripOf[e.t], v = stripOf[e.w];
    if (u === v) continue;
    const [slow, fast] = bending[u].rate <= bending[v].rate ? [u, v] : [v, u];
    if (!(bending[fast].long && bending[fast].turn >= ROUND && bending[slow].rate * JUMP <= bending[fast].rate)) continue;
    border.set(k, 'bend');
    if (strips[slow].length > 1 && bending[slow].width >= JUMP * bending[fast].width) flats.add(slow);
  }
  // A strip of several triangles, several times wider than the strips of the round that starts
  // beside it, is a flat face, and a flat face ends all the way round: at its ends, where it runs
  // into a blend, as much as along the round. So the rest of its outline is a border wherever
  // what lies beyond bends several times faster, long strip or not. Without this the border found
  // along the round stops at the blend, and the two faces it parted are joined again round its
  // end. (Where what lies beyond is as flat as it is, the face just goes on: a bar that bends
  // gently along its length is one face, not a row of them.)
  const endsAt = (flat: number, beyond: number) => flats.has(flat) && bending[beyond].rate >= JUMP * bending[flat].rate;
  for (const [k, e] of edges) {
    const u = stripOf[e.t], v = stripOf[e.w];
    if (border.has(k) || !open(e) || u === v || e.turn >= CREASE) continue;
    if (endsAt(u, v) || endsAt(v, u)) border.set(k, 'bend');
  }

  // Patches: triangles joined across every edge that is not a border.
  const label = new Int32Array(nT).fill(-1);
  let patches: number[][] = [];
  for (let t0 = 0; t0 < nT; t0++) {
    if (label[t0] >= 0) continue;
    const part = [t0];
    label[t0] = patches.length;
    for (let i = 0; i < part.length; i++) for (let k = 0; k < 3; k++) {
      const t = part[i], w = m.adj[t * 3 + k];
      if (w < 0 || label[w] >= 0 || border.has(key(m.tri[t * 3 + k], m.tri[t * 3 + ((k + 1) % 3)]))) continue;
      label[w] = patches.length;
      part.push(w);
    }
    patches.push(part);
  }

  // A border edge with one patch on both sides separates nothing.
  let dropped = 0;
  for (const [k, e] of edges) if (border.has(k) && label[e.t] === label[e.w]) { border.delete(k); dropped++; }

  // Slivers: smallest first, each to the neighbour across the soft border it bends least from.
  const soft = (why: BorderKind | undefined) => why === 'stop' || why === 'bend';
  let joined = 0;
  for (let again = true; again;) {
    again = false;
    const order = patches.map((_, i) => i).filter((i) => patches[i].length && known[patches[i][0]] < 0).sort((x, y) => patches[x].length - patches[y].length);
    for (const s of order) {
      const tris = patches[s];
      if (!tris.length) continue;
      // Its soft borders, by neighbour: length, turn summed by length, and the two sides' row widths.
      const sides = new Map<number, { len: number; turn: number; mine: number[]; theirs: number[] }>();
      const onSoft = new Set<number>();
      for (const t of tris) for (let k = 0; k < 3; k++) {
        const w = m.adj[t * 3 + k], a = m.tri[t * 3 + k], b = m.tri[t * 3 + ((k + 1) % 3)];
        if (w < 0 || label[w] === s || !soft(border.get(key(a, b)))) continue;
        onSoft.add(a);
        onSoft.add(b);
        const A = P(a), B = P(b), L = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
        const side = sides.get(label[w]) ?? { len: 0, turn: 0, mine: [], theirs: [] };
        side.len += L;
        side.turn += L * edges.get(key(a, b))!.turn;
        side.mine.push(heightOver(t, a, b));
        side.theirs.push(heightOver(w, a, b));
        sides.set(label[w], side);
      }
      // One row wide between soft borders: every corner of every triangle is on one of them. (A
      // flat of long triangles side by side is not: its corners are at its two ends.)
      if (tris.length > SLIVER && !tris.every((t) => triVerts(m, t).every((v) => onSoft.has(v)))) continue;
      let to = -1, least = Infinity;
      for (const [n, side] of sides) { const turn = side.turn / side.len; if (turn < least) { least = turn; to = n; } }
      if (to < 0) continue;
      if (tris.length > SLIVER) {
        const side = sides.get(to)!;
        const mid = (xs: number[]) => [...xs].sort((x, y) => x - y)[xs.length >> 1];
        if (mid(side.mine) > ROW_WIDE * mid(side.theirs)) continue;
      }
      for (const t of tris) {
        for (let k = 0; k < 3; k++) if (label[m.adj[t * 3 + k]] === to) border.delete(key(m.tri[t * 3 + k], m.tri[t * 3 + ((k + 1) % 3)]));
        label[t] = to;
      }
      for (const t of tris) patches[to].push(t);
      patches[s] = [];
      joined++;
      again = true;
    }
  }
  // Number the patches again without the ones that were joined away.
  const renumber = new Int32Array(patches.length).fill(-1);
  patches = patches.filter((p, i) => { if (!p.length) return false; renumber[i] = 1; return true; });
  let n = 0;
  for (let i = 0; i < renumber.length; i++) if (renumber[i] > 0) renumber[i] = n++;
  for (let t = 0; t < nT; t++) label[t] = renumber[label[t]];

  return {
    label, patches, dropped, joined,
    face: patches.map((p) => known[p[0]]),
    borders: [...border].map(([k, why]) => { const e = edges.get(k)!; return [e.a, e.b, why] as [number, number, BorderKind]; }),
  };
}

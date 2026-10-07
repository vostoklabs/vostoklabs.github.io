// From blocks of material to outlines.
//
// A box is described the way it stands on the table: every piece a SLAB — the whole block of
// sheet it would be with no joint cut into it — placed at its face of the box, so neighbouring
// slabs overlap along every edge. Then each overlap is given away, bit by bit:
//
//   · inside a JOINT's range, along its axis, `b` keeps its intervals (its fingers or tabs) and
//     `a` keeps the rest;
//   · anywhere else two or three slabs overlap — a box's corner block, the run of a skirt below
//     the floor — the highest RANK keeps it.
//
// A piece's outline is then nothing but the edge of what it kept, traced on a grid of every
// line any of that can change at. Two pieces read the SAME rule from two sides, so a finger on
// one is the notch on the other by construction: there is no second drawing to keep in step.
// tests/slabs.test.mjs proves it the physical way — every piece extruded, posed and intersected
// with every other — and finds the volumes the fit asked for and nothing else.
//
// The fit is the one place the two sides deliberately disagree. Each piece reads its own
// fingers a quarter of the joint's `fit` wider a side than its neighbour reads them, so where a
// finger sits in its notch the two overlap by `fit` across the finger: interference when the
// fit is positive, a gap when it is negative. A flex tab adds its own `flex` to that, along the
// joint only — its slits let it give that way and no other. A `slot` joint's hole is also read `fit / 4`
// narrower a side across the sheet, because a tab's thickness is the raw sheet — only the hole
// is cut — so it gets half the squeeze a cut-against-cut finger does. Corners and the depths of
// notches are stops, not fits, and stay exact: shifting those would push the walls apart.
import { signedArea } from '@vostok/laser/rings';
import { pointInRing } from '@vostok/patterns';
import type { AABB, Axis, Joint, Pt, Ring, Slab, V3 } from './types';

/** Two coordinates closer than this are one grid line. */
const SNAP = 1e-7;

export interface SlabWorld {
  slabs: Slab[];
  joints: Joint[];
}

export const axisOf = (v: V3): Axis => (Math.abs(v[0]) > 0.5 ? 0 : Math.abs(v[1]) > 0.5 ? 1 : 2);
const signOf = (v: V3): number => v[axisOf(v)] < 0 ? -1 : 1;

function overlaps(a: AABB, b: AABB): boolean {
  for (let i = 0; i < 3; i++) if (a.max[i]! <= b.min[i]! + SNAP || b.max[i]! <= a.min[i]! + SNAP) return false;
  return true;
}

/** How much wider a side each piece reads its own fingers along a joint, mm: a quarter of the
 *  interference, a flex tab's extra squeeze included. */
export const along = (j: Joint): number => (j.fit + (j.flex ?? 0)) / 4;

function jointOf(world: SlabWorld, p: string, q: string): Joint | undefined {
  return world.joints.find((j) => (j.a === p && j.b === q) || (j.a === q && j.b === p));
}

/** `s`'s block as `me` reads it: a slab passing through `me` on a `slot` joint is read a little
 *  thinner across its sheet, which is what draws the hole for it a little narrower. */
function boxAsSeenBy(world: SlabWorld, me: Slab, s: Slab): AABB {
  const j = jointOf(world, me.id, s.id);
  if (!j || j.kind !== 'slot' || j.a !== me.id) return s.box;
  const d = j.fit / 4;
  const min = [...s.box.min] as V3;
  const max = [...s.box.max] as V3;
  min[s.normal] += d;
  max[s.normal] -= d;
  return { min, max };
}

const inside = (b: AABB, p: V3): boolean =>
  p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1] && p[2] > b.min[2] && p[2] < b.max[2];

/** Who keeps the material at `p`, as `me` reads it. `p` is inside `me`'s own block. */
export function ownerAt(world: SlabWorld, me: Slab, p: V3): string {
  const here = world.slabs.filter((s) => s === me || inside(boxAsSeenBy(world, me, s), p));
  if (here.length === 1) return me.id;
  if (here.length === 2) {
    const other = here[0] === me ? here[1]! : here[0]!;
    const j = jointOf(world, me.id, other.id);
    if (j) {
      const x = p[j.axis];
      if (x > j.range[0] && x < j.range[1]) {
        const d = along(j);
        // `me` grows its own intervals by d a side and shrinks its neighbour's by the same.
        const grow = me.id === j.b ? d : -d;
        const inB = j.intervals.some(([s, e]) => x > s - grow && x < e + grow);
        return inB ? j.b : j.a;
      }
    }
  }
  let best = here[0]!;
  for (const s of here) if (s.rank > best.rank || (s.rank === best.rank && s.id < best.id)) best = s;
  return best.id;
}

/** Every coordinate along `ax` where what `me` keeps can change. */
function breaks(world: SlabWorld, me: Slab, ax: Axis): number[] {
  const lo = me.box.min[ax];
  const hi = me.box.max[ax];
  const out = [lo, hi];
  for (const s of world.slabs) {
    if (s === me || !overlaps(me.box, s.box)) continue;
    const seen = boxAsSeenBy(world, me, s);
    out.push(seen.min[ax], seen.max[ax], s.box.min[ax], s.box.max[ax]);
  }
  for (const j of world.joints) {
    if ((j.a !== me.id && j.b !== me.id) || j.axis !== ax) continue;
    const d = along(j);
    const grow = me.id === j.b ? d : -d;
    out.push(j.range[0], j.range[1]);
    for (const [s, e] of j.intervals) out.push(s - grow, e + grow);
  }
  const sorted = out.filter((x) => x >= lo - SNAP && x <= hi + SNAP).map((x) => Math.min(hi, Math.max(lo, x))).sort((a, b) => a - b);
  const lines: number[] = [];
  for (const x of sorted) if (!lines.length || x - lines[lines.length - 1]! > SNAP) lines.push(x);
  return lines;
}

/**
 * The boundary of a set of grid cells, as rings: material on the LEFT of every edge, so outer
 * rings come out counter-clockwise and holes clockwise. Where two kept cells touch only at a
 * corner, the walk turns left, so each keeps its own ring rather than one ring crossing itself.
 */
export function traceCells(xs: number[], ys: number[], kept: (i: number, j: number) => boolean): Pt[][] {
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && kept(i, j);
  // Directed edges between grid vertices (i, j), keyed by their start.
  const out = new Map<number, { to: number; dir: number }[]>();
  const key = (i: number, j: number) => i * (ny + 2) + j;
  const add = (i0: number, j0: number, i1: number, j1: number, dir: number) => {
    const k = key(i0, j0);
    const list = out.get(k);
    const e = { to: key(i1, j1), dir };
    if (list) list.push(e);
    else out.set(k, [e]);
  };
  // dir: 0 = +x, 1 = +y, 2 = −x, 3 = −y
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (!at(i, j)) continue;
      if (!at(i, j - 1)) add(i, j, i + 1, j, 0);
      if (!at(i + 1, j)) add(i + 1, j, i + 1, j + 1, 1);
      if (!at(i, j + 1)) add(i + 1, j + 1, i, j + 1, 2);
      if (!at(i - 1, j)) add(i, j + 1, i, j, 3);
    }
  }
  const rings: Pt[][] = [];
  const vi = (k: number) => Math.floor(k / (ny + 2));
  const vj = (k: number) => k % (ny + 2);
  for (;;) {
    let start = -1;
    for (const [k, list] of out) if (list.length) { start = k; break; }
    if (start < 0) break;
    const ring: Pt[] = [];
    let at0 = start;
    let dir = -1;
    for (let guard = 0; guard < 1e6; guard++) {
      const list = out.get(at0);
      if (!list || !list.length) break;
      // Prefer a left turn, then straight on, then right: at a pinch this keeps each cell's ring.
      let pick = 0;
      if (dir >= 0 && list.length > 1) {
        const rank = (d: number) => [1, 0, 3, 2][(d - dir + 4) % 4]!; // left 0, straight 1, right 2, back 3
        pick = list.reduce((b, e, i) => (rank(e.dir) < rank(list[b]!.dir) ? i : b), 0);
      }
      const e = list.splice(pick, 1)[0]!;
      if (e.dir !== dir) ring.push([xs[vi(at0)]!, ys[vj(at0)]!]);
      dir = e.dir;
      at0 = e.to;
      if (at0 === start) break;
    }
    // The walk can start mid-run: drop a first vertex that is only a point on a straight edge.
    if (ring.length >= 3) rings.push(dropCollinear(ring));
  }
  return rings.filter((r) => r.length >= 3);
}

function dropCollinear(ring: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i - 1 + ring.length) % ring.length]!;
    const b = ring[i]!;
    const c = ring[(i + 1) % ring.length]!;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-12) out.push(b);
  }
  return out;
}

/** The world point of the slab's own (0, 0) on its mid-thickness: the corner its u and v count
 *  up from. */
export function originOf(s: Slab): V3 {
  const o: V3 = [0, 0, 0];
  const ua = axisOf(s.u);
  const va = axisOf(s.v);
  o[ua] = signOf(s.u) > 0 ? s.box.min[ua] : s.box.max[ua];
  o[va] = signOf(s.v) > 0 ? s.box.min[va] : s.box.max[va];
  o[s.normal] = (s.box.min[s.normal] + s.box.max[s.normal]) / 2;
  return o;
}

/** A world point (on the slab's plane) in the slab's own 2D frame. */
export function toLocal(s: Slab, p: V3): Pt {
  const o = originOf(s);
  const d: V3 = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  return [d[0] * s.u[0] + d[1] * s.u[1] + d[2] * s.u[2], d[0] * s.v[0] + d[1] * s.v[1] + d[2] * s.v[2]];
}

/** The slab's 2D outline: the edge of everything it keeps, in its own frame, outer ring
 *  counter-clockwise and holes clockwise. More than one island means a piece fell apart — the
 *  caller reports it; it never happens for a box this engine builds. */
export function outlineOf(world: SlabWorld, me: Slab): Ring[][] {
  const ua = axisOf(me.u);
  const va = axisOf(me.v);
  const xs = breaks(world, me, ua);
  const ys = breaks(world, me, va);
  const mid = (me.box.min[me.normal] + me.box.max[me.normal]) / 2;
  const keptCache = new Map<number, boolean>();
  const kept = (i: number, j: number) => {
    const k = i * ys.length + j;
    let v = keptCache.get(k);
    if (v === undefined) {
      const p: V3 = [0, 0, 0];
      p[ua] = (xs[i]! + xs[i + 1]!) / 2;
      p[va] = (ys[j]! + ys[j + 1]!) / 2;
      p[me.normal] = mid;
      v = ownerAt(world, me, p) === me.id;
      keptCache.set(k, v);
    }
    return v;
  };
  // Traced in the (ua, va) plane with material on the left: an outer ring is counter-clockwise
  // THERE. Decide outer or hole before the move into the piece's frame, which mirrors the ring
  // whenever exactly one of u and v runs backwards along its world axis.
  const rings = traceCells(xs, ys, kept)
    .map((r) => ({ outer: signedArea(r) > 0, r: r.map(([a, b]) => toLocal(me, withPlane(me, ua, va, a, b))) }))
    .filter((x) => Math.abs(signedArea(x.r)) > 1e-9);
  const wind = (r: Ring, ccw: boolean): Ring => (signedArea(r) > 0 === ccw ? r : [...r].reverse());
  const islands = rings.filter((x) => x.outer).map((x) => ({ outer: wind(x.r, true), holes: [] as Ring[] }));
  for (const h of rings.filter((x) => !x.outer)) {
    const ring = wind(h.r, false);
    // A hole goes to the smallest outer around it. Test a point just inside the hole's first
    // edge's middle, never a vertex: a vertex may sit on the outline it touches.
    const [a, b] = [ring[0]!, ring[1]!];
    const probe: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const host = islands
      .filter((isl) => pointInRing(probe, isl.outer))
      .sort((p, q) => Math.abs(signedArea(p.outer)) - Math.abs(signedArea(q.outer)))[0];
    host?.holes.push(ring);
  }
  return islands.map((isl) => [isl.outer, ...isl.holes]);
}

/**
 * The biggest rectangle on the slab's face that no other slab touches — the room a pattern
 * has, before its own margin. An overlap that runs along more than half of one side is an edge
 * strip (a joint) or a band across the face (a floor's slots) and pushes that side in.
 */
export function clearRect(world: SlabWorld, me: Slab): { u0: number; v0: number; u1: number; v1: number } {
  const ua = axisOf(me.u);
  const va = axisOf(me.v);
  let lo = [me.box.min[ua], me.box.min[va]];
  let hi = [me.box.max[ua], me.box.max[va]];
  const span = [hi[0]! - lo[0]!, hi[1]! - lo[1]!];
  const centre = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2];
  lo = [...lo];
  hi = [...hi];
  for (const s of world.slabs) {
    if (s === me || s.insert || !overlaps(me.box, s.box)) continue;
    const r0 = [Math.max(s.box.min[ua], me.box.min[ua]), Math.max(s.box.min[va], me.box.min[va])];
    const r1 = [Math.min(s.box.max[ua], me.box.max[ua]), Math.min(s.box.max[va], me.box.max[va])];
    for (const [along, across] of [[0, 1], [1, 0]] as const) {
      if (r1[along]! - r0[along]! < span[along]! / 2) continue;
      if ((r0[across]! + r1[across]!) / 2 < centre[across]!) lo[across] = Math.max(lo[across]!, r1[across]!);
      else hi[across] = Math.min(hi[across]!, r0[across]!);
    }
  }
  // Into the piece's frame (an axis may be flipped).
  const a = toLocal(me, withPlane(me, ua, va, lo[0]!, lo[1]!));
  const b = toLocal(me, withPlane(me, ua, va, hi[0]!, hi[1]!));
  return { u0: Math.min(a[0], b[0]), v0: Math.min(a[1], b[1]), u1: Math.max(a[0], b[0]), v1: Math.max(a[1], b[1]) };
}

function withPlane(me: Slab, ua: Axis, va: Axis, a: number, b: number): V3 {
  const p: V3 = [0, 0, 0];
  p[ua] = a;
  p[va] = b;
  p[me.normal] = (me.box.min[me.normal] + me.box.max[me.normal]) / 2;
  return p;
}

/** Where `other` passes through `me`, as a rectangle in `me`'s own frame — a divider's slots on a
 *  wall, for the pattern to keep off. Null when they do not overlap. */
export function footprintOn(me: Slab, other: Slab): { u0: number; v0: number; u1: number; v1: number } | null {
  if (!overlaps(me.box, other.box)) return null;
  const ua = axisOf(me.u);
  const va = axisOf(me.v);
  const lo = [Math.max(other.box.min[ua], me.box.min[ua]), Math.max(other.box.min[va], me.box.min[va])];
  const hi = [Math.min(other.box.max[ua], me.box.max[ua]), Math.min(other.box.max[va], me.box.max[va])];
  const a = toLocal(me, withPlane(me, ua, va, lo[0]!, lo[1]!));
  const b = toLocal(me, withPlane(me, ua, va, hi[0]!, hi[1]!));
  return { u0: Math.min(a[0], b[0]), v0: Math.min(a[1], b[1]), u1: Math.max(a[0], b[0]), v1: Math.max(a[1], b[1]) };
}

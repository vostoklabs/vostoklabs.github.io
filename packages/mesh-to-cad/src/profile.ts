// Revolved and extruded faces, read from the mesh's rings.
//
// CAD tessellates a revolved face on its own grid: rings of vertices at one point of the profile,
// joined ring to ring. Every triangle then has one edge along a ring, and every band between two
// rings sits exactly on a sphere and on a cone (any two coaxial circles do), so the analytic pass
// reads a revolved spline as a stack of fake spheres. Extrusions are the same with rulings for
// rings, read as fake cylinders.
//
// So: guess an axis (or a direction) from those fake faces, gather every face whose triangles all
// have an edge along a ring of it, check the rings stack into one profile, and read the profile
// itself: straight runs become planes, cylinders and cones, round runs spheres and tori (or
// cylinders, for an extrusion), and what is left is a spline swept round the axis or along it.

import { type V3, basis, dist, dot, levenberg, madd, normalize, scale, sub } from './linalg';
import { interpolate } from './bspline';
import { type Mesh, connected, triCentroid, triNormal, triVerts, vtx } from './mesh';
import { type Analytic, type Surface, distance, normalAt, refine } from './surfaces';
import { type Swept, extrusionAxes, profilePoint } from './swept';

type Frame = { kind: 'revolution' | 'extrusion'; o: V3; a: V3 };
/** How far off a flat face a scrap along its border may sit (mm), and how nearly parallel to it the scrap must be (cosine of half a degree). */
const FLAT_BORDER = 2e-3, FLAT_TILT = Math.cos((0.5 * Math.PI) / 180);
/** The furthest a swept spline may stand off one of its facets, as a share of the facet's length. */
const SPLINE_BOW = 0.1;
export type ProfileRegion = { tris: number[]; surf: Surface | null; err: number };

/** For the probe scripts: called with each profile read, accepted or not. */
let trace: ((info: Record<string, unknown>) => void) | null = null;
export function traceProfiles(f: typeof trace) { trace = f; }

/** Faces swept from one profile, re-read from that profile. Returns the regions to use instead. */
export function sweptFaces<R extends ProfileRegion>(m: Mesh, found: R[], opt: { eps: number; chord: number }): ProfileRegion[] {
  const { eps } = opt;
  const nT = m.tri.length / 3;
  // A family takes whole faces and, from the small ones around them, single triangles: its own copy.
  const regions: ProfileRegion[] = found.map((r) => ({ ...r }));
  const label = new Int32Array(nT).fill(-1);
  regions.forEach((r, i) => r.tris.forEach((t) => (label[t] = i)));
  const adj: Set<number>[] = regions.map(() => new Set());
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w >= 0 && label[w] !== label[t]) adj[label[t]].add(label[w]);
  }

  const claimed = new Set<number>();
  const shrunk = new Set<number>();
  const out: ProfileRegion[] = [];
  for (const cand of candidates(m, regions, adj)) {
    if (cand.support.every((r) => claimed.has(r))) continue;
    const family = readFamily(m, regions, adj, claimed, label, cand.frame, cand.support.filter((r) => !claimed.has(r)), opt);
    if (!family) continue;
    out.push(...family.faces);
    const lost = new Set<number>();
    for (const f of family.faces) for (const t of f.tris) { lost.add(label[t]); label[t] = TAKEN; }
    for (const r of lost) {
      regions[r].tris = regions[r].tris.filter((t) => label[t] === r);
      if (regions[r].tris.length) shrunk.add(r); else claimed.add(r);
    }
  }
  regions.forEach((r, i) => {
    if (claimed.has(i)) return;
    if (shrunk.has(i)) for (const part of connected(m, r.tris)) out.push({ ...r, tris: part });
    else out.push(r);
  });
  return settle(m, out, opt);
}

/** The label of a triangle a family has taken from the face it was found in. */
const TAKEN = -2;
/** A face of more triangles than this is never taken apart for the ones a swept surface also holds. */
const GROW_FROM = 60;
/** How far a triangle may face away from a surface that takes it, as a cosine (35 degrees). */
const GROW_FACING = Math.cos((35 * Math.PI) / 180);

/**
 * Facets and scraps that sit on a bigger face's own surface join it. The exporter's long thin
 * triangles are read as flat facets, and a strip of a real surface cut off by them as a small
 * surface of its own; left apart they make the face's edge zigzag and hang off the free-form
 * patches next door like tendrils.
 *
 * CAD vertices are exact, so a triangle with all three corners on a surface is on it. A small
 * face only counts as a real surface if this finds it a good many more points: a strip of a
 * free-form face fits a surface of its own but the next facets over do not.
 */
function settle(m: Mesh, faces: ProfileRegion[], opt: { eps: number; chord: number }): ProfileRegion[] {
  const label = new Int32Array(m.tri.length / 3).fill(-1);
  faces.forEach((f, i) => f.tris.forEach((t) => (label[t] = i)));
  const swept = (x: ProfileRegion) => x.surf?.kind === 'revolution' || x.surf?.kind === 'extrusion';
  const facet = (x: ProfileRegion) => x.surf?.kind === 'plane' && x.tris.length <= 3;
  const scrap = (x: ProfileRegion) => facet(x) || (x.surf?.kind !== 'plane' && !swept(x) && x.tris.length <= 16);
  const vertsOf = (tris: number[]) => new Set(tris.flatMap((t) => triVerts(m, t)));
  const gone = new Set<number>();
  const order = [...faces.keys()].sort((x, y) => faces[y].tris.length - faces[x].tris.length);
  for (const i of order) {
    const f = faces[i];
    if (gone.has(i) || !f.surf || facet(f)) continue;
    // A flat face's own border triangles: where it meets a curved face its vertices sit on the
    // CAD program's fitted curve between the two, a little off the plane, so the triangles
    // along that border fall out of it as flat scraps of their own. They are still its: as
    // good as parallel to it, and nowhere further off than a fitted curve strays.
    const flat = f.surf.kind === 'plane';
    const tol = swept(f) ? Math.max(4 * opt.eps, 2e-4) * 4 : flat ? FLAT_BORDER : 2 * opt.eps;
    let surf = f.surf;
    const own = vertsOf(f.tris).size;
    const verts = vertsOf(f.tris);
    let fittedAt = verts.size;
    const took = new Set<number>();
    const refused = new Set<number>();
    const queue = [...f.tris];
    const fits = (x: ProfileRegion, s: Surface) =>
      (!flat || (facet(x) && x.tris.every((t) => Math.abs(dot(triNormal(m, t), (s as { n: V3 }).n)) >= FLAT_TILT))) &&
      [...vertsOf(x.tris)].every((v) => Math.abs(distance(s, vtx(m.pos, v))) <= tol) &&
      x.tris.every((t) => Math.abs(distance(s, triCentroid(m, t))) <= opt.chord);
    while (queue.length) {
      const t = queue.pop()!;
      for (let k = 0; k < 3; k++) {
        const w = m.adj[t * 3 + k];
        if (w < 0) continue;
        const g = label[w];
        if (g === i || gone.has(g) || took.has(g) || refused.has(g) || !scrap(faces[g])) continue;
        if (!fits(faces[g], surf)) { refused.add(g); continue; }
        took.add(g);
        for (const t of faces[g].tris) queue.push(t);
        for (const v of vertsOf(faces[g].tris)) verts.add(v);
        if (!swept(f) && verts.size > fittedAt * 1.5) {
          const pts = [...verts].map((v) => vtx(m.pos, v));
          const s2 = refine(surf as Analytic, pts);
          if (pts.every((p) => Math.abs(distance(s2, p)) <= tol)) { surf = s2; refused.clear(); }
          fittedAt = verts.size;
        }
      }
    }
    if (f.tris.length <= 16 && !(verts.size >= 24 && verts.size >= 2 * own)) continue;
    if (!took.size) continue;
    f.surf = surf;
    let err = 0;
    for (const v of verts) err = Math.max(err, Math.abs(distance(surf, vtx(m.pos, v))));
    f.err = err;
    for (const g of took) {
      gone.add(g);
      for (const t of faces[g].tris) f.tris.push(t);
      for (const t of faces[g].tris) label[t] = i;
    }
  }
  return faces.filter((_, i) => !gone.has(i));
}

/** Axes and directions the curved faces suggest, most suggested first. */
function candidates(m: Mesh, regions: ProfileRegion[], adj: Set<number>[]): { frame: Frame; support: number[] }[] {
  const list: { frame: Frame; support: number[]; weight: number }[] = [];
  // Faces that agree on an axis each fitted their own, and the largest of them fitted it best: a
  // band a millimetre tall leaves the direction of its axis open, a wall fifty tall does not.
  const areaOf = (r: number) => regions[r].tris.reduce((a, t) => a + m.area[t], 0);
  const same = (f: Frame, g: Frame) => {
    if (f.kind !== g.kind || Math.abs(dot(f.a, g.a)) < 1 - 1e-6) return false;
    if (f.kind === 'extrusion') return true;
    const d = sub(g.o, f.o);
    return Math.hypot(...madd(d, f.a, -dot(d, f.a))) < 1e-3;
  };
  const offer = (frame: Frame, r: number) => {
    const known = list.find((c) => same(c.frame, frame));
    const weight = areaOf(r);
    if (!known) { list.push({ frame, support: [r], weight }); return; }
    if (!known.support.includes(r)) known.support.push(r);
    if (weight > known.weight) { known.frame = frame; known.weight = weight; }
  };
  regions.forEach((reg, i) => {
    const s = reg.surf;
    if (!s) return;
    if (s.kind === 'cylinder') {
      offer({ kind: 'revolution', o: s.o, a: s.a }, i);
      offer({ kind: 'extrusion', o: s.o, a: s.a }, i);
    } else if (s.kind === 'cone') offer({ kind: 'revolution', o: s.apex, a: s.a }, i);
    else if (s.kind === 'torus') offer({ kind: 'revolution', o: s.c, a: s.a }, i);
    else if (s.kind === 'sphere') {
      // A sphere fixes a point of the axis; a neighbouring sphere on the same axis fixes the line.
      for (const j of adj[i]) {
        const t = regions[j].surf;
        if (t?.kind !== 'sphere' || dist(t.c, s.c) < 1e-3) continue;
        offer({ kind: 'revolution', o: s.c, a: normalize(sub(t.c, s.c)) }, i);
      }
    }
  });
  // A narrow band fixes its own axis poorly: a strip of a blend a few degrees wide puts it a few
  // hundredths of a millimetre off, and read about that axis its neighbours' rings do not close.
  // So a face also stands behind the axis of a larger face that passes close to its own, and
  // that one is tried first; whether the face is really on its rings is decided there. Its own
  // axis is still tried afterwards, for whatever the larger one did not read.
  const near = (strong: Frame, weak: Frame) => {
    if (strong.kind !== weak.kind || Math.abs(dot(strong.a, weak.a)) < NEAR_TILT) return false;
    if (strong.kind === 'extrusion') return true;
    const d = sub(weak.o, strong.o);
    return Math.hypot(...madd(d, strong.a, -dot(d, strong.a))) <= NEAR_AXIS;
  };
  const heads: typeof list = [], rest: typeof list = [];
  for (const c of [...list].sort((a, b) => b.weight - a.weight)) {
    const head = heads.find((h) => near(h.frame, c.frame));
    if (!head) { heads.push(c); continue; }
    for (const r of c.support) if (!head.support.includes(r)) head.support.push(r);
    rest.push(c);
  }
  const bySupport = (a: { support: number[] }, b: { support: number[] }) => b.support.length - a.support.length;
  return [...heads.sort(bySupport), ...rest.sort(bySupport)];
}

/** How nearly parallel (as a cosine, two degrees) and how close (mm) a face's own axis must be to a better-supported one to be read about that one. */
const NEAR_TILT = Math.cos((2 * Math.PI) / 180), NEAR_AXIS = 0.5;

/** Union-find over vertex ids. */
class Rings {
  private parent = new Map<number, number>();
  find(v: number): number {
    let p = this.parent.get(v) ?? v;
    if (p === v) return v;
    p = this.find(p);
    this.parent.set(v, p);
    return p;
  }
  join(a: number, b: number) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

type Family = { faces: ProfileRegion[] };

function readFamily(
  m: Mesh, regions: ProfileRegion[], adj: Set<number>[], claimed: Set<number>, label: Int32Array,
  start: Frame, seeds: number[], opt: { eps: number; chord: number },
): Family | null {
  const { eps } = opt;
  // Loose at first: the frame comes from a fit to a narrow band, and is refined on the rings.
  const loose = 0.05;
  let frame = start;
  const cache = new Map<number, [number, number]>();
  const at = (v: number) => {
    let q = cache.get(v);
    if (!q) { q = profilePoint(frame, vtx(m.pos, v)); cache.set(v, q); }
    return q;
  };
  // Two vertices on one ring: the same profile point, though the edge between them is long. On
  // a tiny triangle any two corners are close in every coordinate, so the loose test is relative.
  let rel = 0.05;
  const close = (a: number, b: number, tol: number) => {
    const p = at(a), q = at(b);
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    return d <= tol && d <= rel * dist(vtx(m.pos, a), vtx(m.pos, b));
  };
  /** The triangle's edges along a ring, as vertex pairs. */
  const ringEdges = (t: number, tol: number) => {
    const [a, b, c] = triVerts(m, t);
    return ([[a, b], [b, c], [c, a]] as [number, number][]).filter(([x, y]) => close(x, y, tol));
  };
  const onRings = (r: number, tol: number) => regions[r].tris.every((t) => ringEdges(t, tol).length > 0);

  // Every face joined to the seeds whose triangles all lie between rings.
  const gather = (tol: number) => {
    const list: number[] = [];
    const inFamily = new Set<number>();
    const queue = seeds.filter((r) => onRings(r, tol));
    for (const r of queue) inFamily.add(r);
    while (queue.length) {
      const r = queue.pop()!;
      list.push(r);
      for (const n of adj[r]) {
        if (inFamily.has(n) || claimed.has(n)) continue;
        if (!onRings(n, tol)) continue;
        inFamily.add(n);
        queue.push(n);
      }
    }
    return list;
  };
  const tight = Math.max(4 * eps, 2e-4);
  let members = gather(loose);
  if (members.length < 2) return null;
  const gathered = members;
  let tris = members.flatMap((r) => regions[r].tris);

  // The rings: vertices joined by ring edges.
  const ringsOf = (tol: number) => {
    const u = new Rings();
    for (const t of tris) for (const [x, y] of ringEdges(t, tol)) u.join(x, y);
    const groups = new Map<number, number[]>();
    for (const v of new Set(tris.flatMap((t) => triVerts(m, t)))) {
      const root = u.find(v);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(v);
    }
    return [...groups.values()];
  };
  const fail = (why: string, more: Record<string, unknown> = {}) => { trace?.({ frame, fail: why, members: members.map((r) => `${regions[r].surf?.kind}:${regions[r].tris.length}`), ...more }); return null; };
  /** Each vertex's distance from its ring's median profile point. */
  const offRing = (g: number[]) => {
    const qs = g.map(at);
    const med = (k: 0 | 1) => { const xs = qs.map((q) => q[k]).sort((a, b) => a - b); return xs[xs.length >> 1]; };
    const mx = med(0), my = med(1);
    return qs.map((q) => Math.hypot(q[0] - mx, q[1] - my));
  };

  // Refine the frame so every ring is one point of the profile. A face that only looked like it
  // was on the rings (an edge across a blend that happened to point the right way) shows up as
  // a vertex off its ring's point: drop the faces holding one and refine again.
  for (let round = 0; ; round++) {
    rel = 0.05;
    cache.clear();
    const rings = ringsOf(loose).filter((g) => g.length > 1);
    if (rings.length < 3) return fail(`rings ${rings.length}`);
    // The rings gathered loosely hold strays (a vertex on the curve where a blend meets the next
    // face), and a frame fitted to those as well can end up worse than the one it started from:
    // an axis read off a whole face is right to begin with, and moved by strays it puts the
    // faces that are truly on the rings off them. No frame makes a stray sit on a ring, and only
    // the true one closes the true rings, so of the two frames the one whose rings, drawn at
    // their own tolerance, hold more vertices is kept.
    const held = (f: Frame) => {
      frame = f;
      cache.clear();
      return ringsOf(2 * tight).reduce((n, g) => (g.length >= 3 ? n + g.length : n), 0);
    };
    const given = frame, refined = refineFrame(m, given, rings);
    frame = held(refined) > held(given) ? refined : given;
    cache.clear();
    const off = new Set<number>();
    let spread = 0;
    for (const g of rings) offRing(g).forEach((d, i) => { spread = Math.max(spread, d); if (d > tight) off.add(g[i]); });
    if (!off.size) break;
    const drop = new Set(members.filter((r) => regions[r].tris.some((t) => triVerts(m, t).some((v) => off.has(v)))));
    if (round === 3 || drop.size >= members.length - 1) return fail(`spread ${spread.toExponential(2)} after ${round} rounds`);
    members = members.filter((r) => !drop.has(r));
    tris = members.flatMap((r) => regions[r].tris);
  }
  rel = 1;
  // A face was dropped for one stray vertex, and all of it but that one triangle is on the rings
  // (a strip of a blend that runs a triangle too far, into the corner where the blend turns).
  // With the frame settled each triangle can speak for itself: one with a side along a ring, at
  // the rings' own tolerance, is read, whatever face it was found in.
  tris = gathered.flatMap((r) => regions[r].tris).filter((t) => ringEdges(t, tight * 2).length > 0);

  // Profile nodes: rings at the same profile point are one node (a ring broken by another face).
  const ringOf = new Map<number, number>();
  const groups = ringsOf(tight * 2);
  // The middle one of a ring's points, not their mean: where the ring ends on the curve between
  // two faces its last vertex is a little off, and the mean of a short ring with it.
  const pts: [number, number][] = groups.map((g) => {
    const qs = g.map(at);
    const mid = (k: 0 | 1) => { const xs = qs.map((q) => q[k]).sort((x, y) => x - y); return (xs[(xs.length - 1) >> 1] + xs[xs.length >> 1]) / 2; };
    return [mid(0), mid(1)];
  });
  const nodeOf: number[] = [];
  const nodes: [number, number][] = [];
  groups.forEach((g, i) => {
    let n = nodes.findIndex((q) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]) <= tight * 2);
    if (n < 0) { n = nodes.length; nodes.push(pts[i]); }
    nodeOf.push(n);
    for (const v of g) ringOf.set(v, n);
  });
  // Node links, from the triangles: each spans a ring and the next.
  const links: Set<number>[] = nodes.map(() => new Set());
  const triNodes: number[][] = tris.map((t) => [...new Set(triVerts(m, t).map((v) => ringOf.get(v)!))]);
  // A face with every vertex on one ring is a flat cap, meshed from its rim. Its triangles are
  // chords of the ring and lie on no surface swept from the profile, so it stays the face it was.
  const caps = new Set(members
    .filter((r) => new Set(regions[r].tris.flatMap((t) => triVerts(m, t).map((v) => ringOf.get(v)!))).size === 1)
    .flatMap((r) => regions[r].tris));
  const ringSize = nodes.map(() => 0);
  groups.forEach((g, i) => { ringSize[nodeOf[i]] += g.length; });
  for (const ns of triNodes) {
    if (ns.length > 2) return fail(`triangle across ${ns.length} rings`);
    if (ns.length === 2) { links[ns[0]].add(ns[1]); links[ns[1]].add(ns[0]); }
  }
  // A straight stretch needs no rings inside it, so where one part of it was given a ring and the
  // part beside it was not, a triangle reaches from the first ring straight to the third. And a
  // lone vertex on the curve where the face ends sits on the profile between two rings. Neither
  // is a fork in the profile: where a ring lies between two linked ones (the way round by it is
  // hardly longer), the long link goes, and its triangles count with the first short one.
  const lk = (x: number, y: number) => (x < y ? `${x}_${y}` : `${y}_${x}`);
  const gap = (x: number, y: number) => Math.hypot(nodes[x][0] - nodes[y][0], nodes[x][1] - nodes[y][1]);
  const stands = new Map<string, [number, number]>();
  const long: [number, number][] = [];
  links.forEach((l, x) => { for (const y of l) if (x < y) long.push([x, y]); });
  long.sort((p, q) => gap(q[0], q[1]) - gap(p[0], p[1]));
  for (const [x, y] of long) {
    const L = gap(x, y);
    if (!(L > 0)) continue;
    // The nearest ring linked to x that lies on the way to y.
    let via = -1, nearest = Infinity;
    for (const k of links[x]) {
      if (k === y) continue;
      const first = gap(x, k), second = gap(k, y);
      if (first <= 2 * tight || second <= 2 * tight || first + second > (1 + BETWEEN) * L) continue;
      if (first < nearest) { nearest = first; via = k; }
    }
    if (via < 0) continue;
    links[x].delete(y);
    links[y].delete(x);
    links[via].add(y);
    links[y].add(via);
    stands.set(lk(x, y), [x, via]);
  }
  // A lone vertex hanging off a ring by one link is a stray, not the start of another profile.
  for (let pruned = true; pruned;) {
    pruned = false;
    nodes.forEach((_, n) => {
      if (links[n].size !== 1 || ringSize[n] > 1) return;
      const k = links[n].values().next().value as number;
      links[n].delete(k);
      links[k].delete(n);
      pruned = true;
    });
  }
  const standIn = (x: number, y: number): string => {
    let key = lk(x, y);
    for (let i = 0; i < 20 && stands.has(key); i++) { const [p, q] = stands.get(key)!; key = lk(p, q); }
    return key;
  };
  // Rings that hang together are one profile, or several that share it (a face of another kind
  // can split the family). One on its own with a single neighbour shows nothing.
  const compOf = new Int32Array(nodes.length).fill(-1);
  const compSize: number[] = [];
  nodes.forEach((_, n) => {
    if (compOf[n] >= 0 || !links[n].size) return;
    const c = compSize.length, stack = [n];
    let size = 1;
    compOf[n] = c;
    while (stack.length) for (const k of links[stack.pop()!]) if (compOf[k] < 0) { compOf[k] = c; size++; stack.push(k); }
    compSize.push(size);
  });
  // A profile forks where the part does: a wall runs on down past the top of a rib that stands on
  // it, and the fillet round the rib turns off there. Each run between forks is read on its own.
  const walked = new Set<string>();
  const paths: number[][] = [];
  const follow = (from: number, to: number) => {
    const path = [from, to];
    walked.add(lk(from, to));
    for (;;) {
      const at = path[path.length - 1], back = path[path.length - 2];
      if (links[at].size !== 2 || at === from) break;
      const next = [...links[at]].find((k) => k !== back)!;
      if (walked.has(lk(at, next))) break;
      walked.add(lk(at, next));
      path.push(next);
    }
    return path;
  };
  for (const ends of [true, false]) nodes.forEach((_, n) => {
    if (!links[n].size || (links[n].size !== 2) !== ends || compSize[compOf[n]] < 3) return;
    for (const k of links[n]) if (!walked.has(lk(n, k))) paths.push(follow(n, k));
  });
  /** Where each link is: its path and how far along. A triangle on one ring only goes with a path through it. */
  const linkAt = new Map<string, [number, number]>(), nodeAt = new Map<number, [number, number]>();
  paths.forEach((path, p) => {
    for (let i = 0; i + 1 < path.length; i++) {
      linkAt.set(lk(path[i], path[i + 1]), [p, i]);
      if (!nodeAt.has(path[i])) nodeAt.set(path[i], [p, i]);
    }
    const last = path.length - 1;
    if (!nodeAt.has(path[last])) nodeAt.set(path[last], [p, last - 1]);
  });
  const triAt = triNodes.map((ns, i) => (caps.has(tris[i]) ? undefined : ns.length === 2 ? linkAt.get(standIn(ns[0], ns[1])) : nodeAt.get(ns[0])));
  const faces: ProfileRegion[] = [];
  const read = new Set<number>();
  let pieceCount = 0, anySpline = false;
  paths.forEach((path, p) => {
    const chain = path.map((n) => nodes[n]);
    const pieces = readProfile(chain, eps);
    trace?.({
      frame, members: members.map((r) => `${regions[r].surf?.kind}:${regions[r].tris.length}`),
      chain: chain.map((q) => q.map((x) => +x.toFixed(4))), pieces: pieces.map((q) => `${q.kind} ${q.from}-${q.to}`),
    });
    const pieceOfSeg = new Int32Array(chain.length).fill(-1);
    pieces.forEach((q, k) => { for (let i = q.from; i < q.to; i++) pieceOfSeg[i] = k; });
    const byPiece: number[][] = pieces.map(() => []);
    tris.forEach((t, i) => { const at = triAt[i]; if (at && at[0] === p) byPiece[pieceOfSeg[at[1]]].push(t); });
    // A run that will not read is left as it was found; the rest of the family still stands.
    const mine: ProfileRegion[] = [];
    for (let k = 0; k < pieces.length; k++) {
      if (!byPiece[k].length) continue;
      const surf = surfaceOf(m, frame, pieces[k], chain, byPiece[k]);
      if (!surf) { fail('no surface'); return; }
      let err = 0;
      for (const v of new Set(byPiece[k].flatMap((t) => triVerts(m, t)))) err = Math.max(err, Math.abs(distance(surf, vtx(m.pos, v))));
      if (!(err <= tight * 4)) { fail(`piece ${pieces[k].kind} err ${err.toExponential(2)}`); return; }
      // A spline through the profile's points can swing wide between two far apart, where no
      // vertex shows it. The facets do: a curve its mesher stepped this coarsely stays close to them.
      if (pieces[k].kind === 'spline') {
        for (const t of byPiece[k]) {
          const [a, b, c] = triVerts(m, t).map((v) => vtx(m.pos, v));
          const longest = Math.max(dist(a, b), dist(b, c), dist(c, a));
          const off = Math.abs(distance(surf, triCentroid(m, t)));
          if (off > SPLINE_BOW * longest) { fail(`spline ${off.toExponential(2)} off a facet`); return; }
        }
      }
      mine.push({ tris: byPiece[k], surf, err });
    }
    pieceCount += pieces.length;
    anySpline ||= pieces.some((q) => q.kind === 'spline');
    for (const f of mine) { faces.push(f); for (const t of f.tris) read.add(t); }
  });
  // The evidence is in whole faces: two or more read entire, and fewer pieces than faces unless
  // one of them is a spline, or nothing was gained.
  const replaced = members.filter((r) => regions[r].tris.every((t) => read.has(t)));
  if (replaced.length < 2 || (pieceCount >= replaced.length && !anySpline)) return null;
  // Two runs of one straight stretch (above and below a fork) are one surface, and so one face.
  const joined: ProfileRegion[] = [];
  for (const f of faces) {
    const twin = joined.find((g) => sameSwept(g.surf, f.surf, tight));
    if (twin) { twin.tris = [...twin.tris, ...f.tris]; twin.err = Math.max(twin.err, f.err); } else joined.push({ ...f });
  }
  // The surfaces read from the rings hold more than the faces that showed the rings: the same
  // blend runs on where its triangles were found as loose facets, or in a strip that also took in
  // one triangle of the next face and so was not on the rings whole. A triangle beside one of
  // these faces whose corners and middle are on its surface, and which faces the way the surface
  // does, is part of it, whatever small face it was found in.
  const member = new Set(members);
  // Not from a flat face, though: a disc meshed from its rim has every vertex on the fillet
  // round it, and its triangles along the rim lie nearly in that fillet too.
  const flatFace = (x: ProfileRegion) => x.surf?.kind === 'plane' && x.tris.length > 3;
  const donor = (r: number) => r >= 0 && !claimed.has(r) && !flatFace(regions[r]) && (member.has(r) || (regions[r].tris.length <= GROW_FROM && !isSwept(regions[r])));
  const holds = (surf: Surface, t: number) => {
    const [a, b, c] = triVerts(m, t).map((v) => vtx(m.pos, v));
    if (Math.abs(distance(surf, a)) > tight * 4 || Math.abs(distance(surf, b)) > tight * 4 || Math.abs(distance(surf, c)) > tight * 4) return false;
    const mid = triCentroid(m, t);
    if (Math.abs(distance(surf, mid)) > Math.min(opt.chord, SPLINE_BOW * Math.max(dist(a, b), dist(b, c), dist(c, a)))) return false;
    return Math.abs(dot(triNormal(m, t), normalAt(surf, mid))) >= GROW_FACING;
  };
  for (const f of joined) {
    const queue = [...f.tris];
    while (queue.length) {
      const t = queue.pop()!;
      for (let k = 0; k < 3; k++) {
        const w = m.adj[t * 3 + k];
        if (w < 0 || read.has(w) || !donor(label[w]) || !holds(f.surf!, w)) continue;
        read.add(w);
        f.tris.push(w);
        queue.push(w);
        for (const v of triVerts(m, w)) f.err = Math.max(f.err, Math.abs(distance(f.surf!, vtx(m.pos, v))));
      }
    }
  }
  return { faces: joined.flatMap((f) => connected(m, f.tris).map((part) => ({ ...f, tris: part }))) };
}

const isSwept = (x: ProfileRegion) => x.surf?.kind === 'revolution' || x.surf?.kind === 'extrusion';

/** Whether two surfaces read about one frame are the same one: a plane, cylinder or cone from two runs of one straight stretch. */
function sameSwept(s: Surface | null, t: Surface | null, tol: number): boolean {
  if (!s || !t || s.kind !== t.kind) return false;
  // (Round an axis every cylinder shares it; along a direction each rounded corner has its own.)
  if (s.kind === 'cylinder' && t.kind === 'cylinder') {
    const d = sub(t.o, s.o);
    return Math.abs(s.r - t.r) <= tol && Math.hypot(...madd(d, s.a, -dot(d, s.a))) <= tol;
  }
  if (s.kind === 'plane' && t.kind === 'plane') return Math.abs(dot(sub(s.o, t.o), s.n)) <= tol && Math.abs(dot(s.n, t.n)) > 1 - 1e-9;
  if (s.kind === 'cone' && t.kind === 'cone') return dist(s.apex, t.apex) <= tol && Math.abs(s.ang - t.ang) <= 1e-6 && dot(s.a, t.a) > 0;
  return false;
}

/** Least-squares frame in which every ring collapses to one profile point. */
function refineFrame(m: Mesh, f: Frame, rings: number[][]): Frame {
  const sample = rings.map((g) => (g.length > 24 ? g.filter((_, i) => i % Math.ceil(g.length / 24) === 0) : g));
  const pts = sample.map((g) => g.map((v) => vtx(m.pos, v)));
  const res = (fr: Frame) => {
    const r: number[] = [];
    for (const g of pts) {
      const qs = g.map((p) => profilePoint(fr, p));
      const mx = qs.reduce((s, q) => s + q[0], 0) / qs.length, my = qs.reduce((s, q) => s + q[1], 0) / qs.length;
      for (const q of qs) r.push(q[0] - mx, q[1] - my);
    }
    return r;
  };
  const n = f.kind === 'revolution' ? 4 : 2;
  return levenberg<Frame>(f, n, (fr, d) => {
    const [e1, e2] = basis(fr.a);
    const a = normalize(madd(madd(fr.a, e1, d[0]), e2, d[1]));
    const o = n === 4 ? madd(madd(fr.o, e1, d[2]), e2, d[3]) : fr.o;
    return { kind: fr.kind, a, o };
  }, res, 1e-7);
}

type Piece =
  | { kind: 'line' | 'spline'; from: number; to: number }
  | { kind: 'arc'; from: number; to: number; c: [number, number]; r: number };

/**
 * Splits the profile into straight runs (three points or more on a line, or one segment far
 * longer than its neighbours: a tessellator puts no rings inside a straight run), round runs
 * (four points or more on a circle; three always are), and spline between them.
 */
function readProfile(chain: [number, number][], eps: number): Piece[] {
  const n = chain.length - 1;
  const segLen = (i: number) => Math.hypot(chain[i + 1][0] - chain[i][0], chain[i + 1][1] - chain[i][1]);
  const onLine = (i: number, j: number) => {
    const a = chain[i], b = chain[j];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-9) return false;
    const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
    for (let k = i + 1; k < j; k++) if (Math.abs((chain[k][0] - a[0]) * dy - (chain[k][1] - a[1]) * dx) > eps) return false;
    return true;
  };
  let extent = 0;
  for (const q of chain) extent = Math.max(extent, Math.hypot(q[0] - chain[0][0], q[1] - chain[0][1]));
  const onCircle = (i: number, j: number) => {
    const c = circle2(chain.slice(i, j + 1));
    // A nearly straight run fits a huge circle: that is a line, or spline.
    if (!c || c.r > 50 * extent + 1000) return null;
    for (let k = i; k <= j; k++) if (Math.abs(Math.hypot(chain[k][0] - c.c[0], chain[k][1] - c.c[1]) - c.r) > eps) return null;
    return c;
  };
  // A node where the profile turns sharply is a corner: no arc or spline runs through one. A
  // tessellator steps a smooth curve in small turns, so a sharp one is an edge of the design
  // (and four corners of a rectangle do sit on a circle).
  const maxTurn = (40 * Math.PI) / 180;
  const sharp = chain.map((_, k) => {
    if (k === 0 || k === n) return true;
    const ax = chain[k][0] - chain[k - 1][0], ay = chain[k][1] - chain[k - 1][1];
    const bx = chain[k + 1][0] - chain[k][0], by = chain[k + 1][1] - chain[k][1];
    return Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by) > maxTurn;
  });
  const pieces: Piece[] = [];
  const push = (p: Piece) => {
    const last = pieces[pieces.length - 1];
    if (p.kind === 'spline' && last?.kind === 'spline' && last.to === p.from && !sharp[p.from]) last.to = p.to;
    else pieces.push(p);
  };
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j + 1 <= n && onLine(i, j + 1)) j++;
    let k = i;
    let arc: { c: [number, number]; r: number } | null = null;
    for (let e = i + 3; e <= n; e++) {
      if (sharp[e - 1]) break;
      const c = onCircle(i, e);
      if (!c) break;
      k = e; arc = c;
    }
    if (arc && k - i > j - i) { pieces.push({ kind: 'arc', from: i, to: k, ...arc }); i = k; continue; }
    if (j - i >= 2) { pieces.push({ kind: 'line', from: i, to: j }); i = j; continue; }
    push({ kind: 'spline', from: i, to: i + 1 });
    i++;
  }
  // Four points in a row on any smooth curve sit on a circle to within a point's tolerance, so a
  // round run that short, running smoothly on into a spline, is more of the spline. A real arc
  // that short stands between corners or straight runs (a small fillet, coarsely stepped).
  const first = pieces.slice();
  pieces.length = 0;
  first.forEach((p, k) => {
    // (A stretch of a segment or two between a line and an arc is no spline: it ends up straight.)
    const smoothInto = (q: Piece | undefined, at: number) => q?.kind === 'spline' && q.to - q.from >= 3 && !sharp[at];
    if (p.kind === 'arc' && p.to - p.from < ARC_SURE && (smoothInto(first[k - 1], p.from) || smoothInto(first[k + 1], p.to))) push({ kind: 'spline', from: p.from, to: p.to });
    else push(p);
  });
  // Spline needs evidence: three segments or more that are neither straight nor round. A segment
  // or two between straight and round runs is a straight run the tessellator put no rings in.
  // At the end of a real spline run, a segment far longer than its neighbours is straight too.
  const out: Piece[] = [];
  const lineAt = (k: number) => out.push({ kind: 'line', from: k, to: k + 1 });
  const splineRun = (start: number, end: number) => {
    let from = start, to = end;
    // The same inside a run: a segment far longer than the ones either side of it is a straight
    // stretch between two curves, and a spline carried through it would swing wide of it.
    for (let k = from + 1; k < to - 1; k++) {
      if (segLen(k) > 2.5 * segLen(k - 1) && segLen(k) > 2.5 * segLen(k + 1)) {
        splineRun(from, k);
        lineAt(k);
        splineRun(k + 1, to);
        return;
      }
    }
    const head: number[] = [], tail: number[] = [];
    while (to - from >= 2 && segLen(from) > 2.5 * segLen(from + 1)) head.push(from++);
    while (to - from >= 2 && segLen(to - 1) > 2.5 * segLen(to - 2)) tail.unshift(--to);
    head.forEach(lineAt);
    if (to - from < 3) for (let k = from; k < to; k++) lineAt(k);
    else out.push({ kind: 'spline', from, to });
    tail.forEach(lineAt);
  };
  for (const p of pieces) {
    if (p.kind !== 'spline') out.push(p);
    else splineRun(p.from, p.to);
  }
  return out;
}

/** How far a straight run of a profile may lean (mm, end to end) and still be along the axis or square to it. */
const FLAT_LINE = 4e-4;
/** How much longer the way between two rings by a third may be than the straight way, as a share, for the third to lie between them. */
const BETWEEN = 0.02;
/** Segments a round run needs to be believed where it runs smoothly into a spline. */
const ARC_SURE = 5;

function circle2(pts: [number, number][]): { c: [number, number]; r: number } | null {
  // Algebraic fit x² + y² + Dx + Ey + F = 0, about the first point for conditioning.
  const [ox, oy] = pts[0];
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (const [px, py] of pts) {
    const x = px - ox, y = py - oy, row = [x, y, 1], rhs = -(x * x + y * y);
    for (let i = 0; i < 3; i++) { b[i] += row[i] * rhs; for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j]; }
  }
  const det = (M: number[][]) =>
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const D0 = det(A);
  if (Math.abs(D0) < 1e-18) return null;
  const col = (k: number) => A.map((row, i) => row.map((x, j) => (j === k ? b[i] : x)));
  const D = det(col(0)) / D0, E = det(col(1)) / D0, F = det(col(2)) / D0;
  const cx = -D / 2, cy = -E / 2, r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  return { c: [cx + ox, cy + oy], r: Math.sqrt(r2) };
}

/** The widest an arc of the profile may be swept round into a torus, as a multiple of the piece it was read from. */
const ARC_ACROSS = 5;

/** The surface a piece of the profile sweeps. */
function surfaceOf(m: Mesh, f: Frame, p: Piece, chain: [number, number][], tris: number[]): Surface | null {
  const { e1, e2 } = extrusionAxes(f.a);
  const point = (q: [number, number]): V3 => (f.kind === 'revolution' ? madd(f.o, f.a, q[1]) : madd(madd(f.o, e1, q[0]), e2, q[1]));
  if (p.kind === 'line') {
    const a = chain[p.from], b = chain[p.to];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
    if (f.kind === 'extrusion') {
      // The line's normal in the profile plane, as a 3D direction.
      return { kind: 'plane', o: madd(madd(f.o, e1, a[0]), e2, a[1]), n: normalize(madd(scale(e1, dy), e2, -dx)) } satisfies Analytic;
    }
    // (rho, z): z constant is a plane across the axis, rho constant a cylinder, else a cone.
    // "Constant" to within what a ring's own points vary by: a cone that narrows by less than
    // that over its whole length has its tip kilometres away, and was drawn as a cylinder.
    const flat = FLAT_LINE / L;
    if (Math.abs(dy) < flat) return { kind: 'plane', o: point([a[0], (a[1] + b[1]) / 2]), n: f.a };
    if (Math.abs(dx) < flat) return { kind: 'cylinder', o: f.o, a: f.a, r: (a[0] + b[0]) / 2 };
    const t = -a[0] / dx;
    const apexZ = a[1] + t * dy;
    const far = a[0] > b[0] ? a : b;
    const up = far[1] > apexZ ? 1 : -1;
    return { kind: 'cone', apex: madd(f.o, f.a, apexZ), a: scale(f.a, up), ang: Math.atan2(far[0], Math.abs(far[1] - apexZ)) };
  }
  // An arc far wider than the piece it was read from is a nearly straight run, swept round into
  // a torus whose tube dwarfs the face (a 0.9 mm piece read as a 62 mm tube with a 0.2 mm hole):
  // importers cannot trim that. It is swept as the spline through its points instead.
  const across = (() => {
    let lo0 = Infinity, hi0 = -Infinity, lo1 = Infinity, hi1 = -Infinity;
    for (let i = p.from; i <= p.to; i++) { lo0 = Math.min(lo0, chain[i][0]); hi0 = Math.max(hi0, chain[i][0]); lo1 = Math.min(lo1, chain[i][1]); hi1 = Math.max(hi1, chain[i][1]); }
    return Math.hypot(hi0 - lo0, hi1 - lo1);
  })();
  if (p.kind === 'arc' && (f.kind === 'extrusion' || p.r <= ARC_ACROSS * across)) {
    if (f.kind === 'extrusion') return { kind: 'cylinder', o: madd(madd(f.o, e1, p.c[0]), e2, p.c[1]), a: f.a, r: p.r };
    // A torus with no hole is a sphere, as the analytic pass decides it too.
    if (Math.abs(p.c[0]) < 1e-3 * p.r) return { kind: 'sphere', c: point(p.c), r: p.r };
    return { kind: 'torus', c: point(p.c), a: f.a, R: p.c[0], r: p.r };
  }
  // A spline through the piece's points, one more each side so its ends run on as the profile
  // does. Not a point far beyond the end, though (the far end of a long straight stretch): a
  // cubic drawn through one swings wide inside the piece itself.
  const gap = (i: number) => Math.hypot(chain[i + 1][0] - chain[i][0], chain[i + 1][1] - chain[i][1]);
  const before = p.from > 0 && gap(p.from - 1) <= 2.5 * gap(p.from) ? 1 : 0;
  const after = p.to + 1 < chain.length && gap(p.to) <= 2.5 * gap(p.to - 1) ? 1 : 0;
  const pts = chain.slice(p.from - before, p.to + 1 + after).map((q) => [q[0], q[1]]);
  const profile = interpolate(pts);
  if (f.kind === 'extrusion') return { kind: 'extrusion', o: f.o, a: f.a, e1, e2, profile } satisfies Swept;
  // Write the profile on the far side of the axis from the face, so the seam is nowhere near it.
  let mean: V3 = [0, 0, 0];
  for (const t of tris) for (const v of triVerts(m, t)) {
    const d = sub(vtx(m.pos, v), f.o);
    mean = madd(mean, madd(d, f.a, -dot(d, f.a)), 1);
  }
  const ref = Math.hypot(...mean) > 1e-9 ? normalize(scale(mean, -1)) : basis(f.a)[0];
  return { kind: 'revolution', o: f.o, a: f.a, ref, profile } satisfies Swept;
}

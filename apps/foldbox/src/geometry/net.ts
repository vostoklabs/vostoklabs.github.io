// The derivation. Everything the app shows, folds or exports comes out of this file,
// and it does one thing:
//
//     Given panels that tile the blank edge to edge, an edge shared by two panels is
//     a CREASE and an edge belonging to only one is a CUT.
//
// That is not a heuristic. A net's fold graph is a spanning tree of the panels'
// adjacency graph, so "shared" and "folds" are the same relation. The consequence is
// that a style builder authors panels and nothing else — it cannot emit a silhouette
// that disagrees with its creases, because it never authors a silhouette.
//
// The one subtlety is that panels do NOT always share a whole edge. A tuck flap is
// narrower than the closure panel it hinges from, so its short edge lies partway
// along the panel's long one. Step 2 below fixes that by splitting every edge at
// every neighbouring vertex that lies on it, after which every contact IS a whole
// edge and the twin test is exact.

import type { Crease, Net, Op, Panel, Poly, Pt, Slit, StyleParts } from '../types';
import { EPS, at, bboxOf, dist, ensureCCW, ensureCW, key, onSegment, pathLength, snapPt } from './poly';

interface DirEdge {
  a: Pt;
  b: Pt;
  panelId: string;
  /** Which ring of the panel: -1 outline, >=0 hole index. */
  ring: number;
}

/** Split every edge of every panel at any vertex from any panel that lies strictly
 *  inside it. After this, two panels in contact share edges exactly. */
function splitAtSharedVertices(rings: { id: string; ring: number; poly: Poly }[]): typeof rings {
  const verts: Pt[] = [];
  const seen = new Set<string>();
  for (const r of rings) {
    for (const p of r.poly) {
      const k = key(p);
      if (!seen.has(k)) {
        seen.add(k);
        verts.push(p);
      }
    }
  }

  return rings.map((r) => {
    const out: Poly = [];
    const n = r.poly.length;
    for (let i = 0; i < n; i++) {
      const a = at(r.poly, i);
      const b = at(r.poly, i + 1);
      out.push(a);
      // Every vertex that lands on this edge, ordered along it.
      const hits = verts
        .filter((v) => onSegment(v, a, b))
        .map((v) => ({ v, t: dist(a, v) }))
        .sort((p, q) => p.t - q.t);
      for (const h of hits) out.push(h.v);
    }
    return { ...r, poly: out };
  });
}

/** Walk boundary edges into closed rings.
 *
 *  At a vertex where more than two boundary edges meet — two flaps touching at a
 *  corner — take the next edge CLOCKWISE from the reverse of the one we arrived on.
 *  That is the standard next-edge-in-face rule for a planar subdivision and it keeps
 *  the material on the left the whole way round. Picking arbitrarily there is what
 *  makes a naive tracer emit a figure-of-eight. */
function walkRings(edges: DirEdge[]): Poly[] {
  const byStart = new Map<string, DirEdge[]>();
  for (const e of edges) {
    const k = key(e.a);
    const list = byStart.get(k);
    if (list) list.push(e);
    else byStart.set(k, [e]);
  }

  const used = new Set<DirEdge>();
  const rings: Poly[] = [];

  const angle = (from: Pt, to: Pt) => Math.atan2(to[1] - from[1], to[0] - from[0]);

  for (const start of edges) {
    if (used.has(start)) continue;
    const ring: Poly = [];
    let cur: DirEdge | undefined = start;
    let guard = 0;

    while (cur && !used.has(cur) && guard++ < edges.length + 4) {
      used.add(cur);
      ring.push(cur.a);

      const outgoing: DirEdge[] = (byStart.get(key(cur.b)) ?? []).filter((e) => !used.has(e));
      if (!outgoing.length) break;

      if (outgoing.length === 1) {
        cur = outgoing[0] as DirEdge;
      } else {
        // Reverse of the incoming direction, then the next one clockwise from it.
        const back = angle(cur.b, cur.a);
        let best: DirEdge = outgoing[0] as DirEdge;
        let bestDelta = Infinity;
        for (const e of outgoing) {
          // Clockwise distance from `back` round to this edge, in (0, 2pi].
          let d = back - angle(e.a, e.b);
          while (d <= 1e-9) d += Math.PI * 2;
          while (d > Math.PI * 2) d -= Math.PI * 2;
          if (d < bestDelta) {
            bestDelta = d;
            best = e;
          }
        }
        cur = best;
      }

      if (cur === start) break;
    }

    if (ring.length >= 3) rings.push(dedupeCollinear(ring));
  }

  return rings;
}

/** Drop the split points again once they have done their job. A vertex that only
 *  exists because a neighbour's corner landed on this edge is not a corner of the
 *  finished blank, and leaving it in makes the machine stop and restart mid-line —
 *  which scorches on a laser and dimples with a blade. */
function dedupeCollinear(ring: Poly): Poly {
  const n = ring.length;
  if (n < 3) return ring;
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const prev = at(ring, i - 1);
    const cur = at(ring, i);
    const next = at(ring, i + 1);
    const ax = cur[0] - prev[0];
    const ay = cur[1] - prev[1];
    const bx = next[0] - cur[0];
    const by = next[1] - cur[1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < EPS || lb < EPS) continue;
    // Cross product normalised by both lengths: a true angle test, so a long edge
    // and a short one are judged the same way.
    if (Math.abs((ax * by - ay * bx) / (la * lb)) > 1e-6) out.push(cur);
  }
  return out.length >= 3 ? out : ring;
}

/** The hinge between a panel and its parent: the run they share. After splitting
 *  they may share several consecutive sub-edges, so take the extent of all of them.
 *  Ordered so the child lies to the LEFT of a -> b, which is what fixes the sign of
 *  the fold — get it backwards and the flap folds away from the box. */
function hingeBetween(child: Poly, parent: Poly): [Pt, Pt] | null {
  const parentEdges = new Set<string>();
  for (let i = 0; i < parent.length; i++) {
    const a = at(parent, i);
    const b = at(parent, i + 1);
    parentEdges.add(`${key(a)}|${key(b)}`);
  }

  const shared: [Pt, Pt][] = [];
  for (let i = 0; i < child.length; i++) {
    const a = at(child, i);
    const b = at(child, i + 1);
    // The parent traverses a shared edge in the OPPOSITE direction, both being CCW.
    if (parentEdges.has(`${key(b)}|${key(a)}`)) shared.push([a, b]);
  }
  if (!shared.length) return null;

  // All shared runs are collinear (they are the same straight contact), so the hinge
  // is the two extreme endpoints along the shared direction.
  const pts: Pt[] = [];
  for (const [a, b] of shared) pts.push(a, b);
  const first = shared[0] as [Pt, Pt];
  const dir: Pt = [first[1][0] - first[0][0], first[1][1] - first[0][1]];
  const L = Math.hypot(dir[0], dir[1]) || 1;
  const u: Pt = [dir[0] / L, dir[1] / L];
  let lo = pts[0] as Pt;
  let hi = pts[0] as Pt;
  let loT = Infinity;
  let hiT = -Infinity;
  for (const p of pts) {
    const t = p[0] * u[0] + p[1] * u[1];
    if (t < loT) {
      loT = t;
      lo = p;
    }
    if (t > hiT) {
      hiT = t;
      hi = p;
    }
  }
  return [lo, hi];
}

/** Depth of every panel in the fold tree, and a cycle guard. A flat net cannot
 *  contain a fold cycle, so a cycle here means a builder pointed two panels at each
 *  other — a bug worth surfacing rather than hanging on. */
function depths(panels: Panel[], rootId: string): Map<string, number> {
  const byId = new Map(panels.map((p) => [p.id, p]));
  const out = new Map<string, number>();
  for (const p of panels) {
    let d = 0;
    let cur: Panel | undefined = p;
    const seen = new Set<string>();
    while (cur && cur.parent && cur.id !== rootId) {
      if (seen.has(cur.id)) {
        d = -1;
        break;
      }
      seen.add(cur.id);
      cur = byId.get(cur.parent);
      d++;
    }
    out.set(p.id, d);
  }
  return out;
}

export function buildNet(parts: StyleParts): Net {
  const panels: Panel[] = parts.panels.map((p) => ({
    ...p,
    outline: ensureCCW(p.outline.map(snapPt)),
    holes: p.holes.map((h) => ensureCW(h.map(snapPt))),
  }));

  // 1 + 2. Every ring of every panel, split so contacts are whole edges.
  const rings = splitAtSharedVertices(
    panels.map((p) => ({ id: p.id, ring: -1, poly: p.outline })),
  );
  const splitById = new Map(rings.map((r) => [r.id, r.poly]));

  // 3. Twin test. An edge with a reverse twin in another panel is interior.
  const all: DirEdge[] = [];
  for (const r of rings) {
    for (let i = 0; i < r.poly.length; i++) {
      all.push({ a: at(r.poly, i), b: at(r.poly, i + 1), panelId: r.id, ring: r.ring });
    }
  }
  const present = new Set(all.map((e) => `${key(e.a)}|${key(e.b)}`));
  const boundary = all.filter((e) => !present.has(`${key(e.b)}|${key(e.a)}`));

  // 4. Walk the boundary into closed rings, and add every panel's holes as their own.
  const cutRings = walkRings(boundary);
  for (const p of panels) for (const h of p.holes) cutRings.push(h);

  // 5. Hinges.
  const depth = depths(panels, parts.rootId);
  const creases: Crease[] = [];
  for (const p of panels) {
    if (!p.parent) continue;
    const childPoly = splitById.get(p.id);
    const parentPoly = splitById.get(p.parent);
    if (!childPoly || !parentPoly) continue;
    const hinge = hingeBetween(childPoly, parentPoly);
    if (!hinge) continue;
    creases.push({
      panelId: p.id,
      parentId: p.parent,
      a: hinge[0],
      b: hinge[1],
      foldAngle: p.foldAngle,
      dir: p.foldAngle >= 0 ? 'valley' : 'mountain',
      depth: depth.get(p.id) ?? 1,
      // Zero at cardstock caliper: a creased fold is a delamination hinge, not a bend
      // with an arc length. It becomes a real V-groove width only for the printed net.
      creaseWidthMm: 0,
    });
  }

  const lengthByOp: Record<Op, number> = { cut: 0, crease: 0, perf: 0, film: 0, engrave: 0 };
  for (const r of cutRings) lengthByOp.cut += pathLength(r, true);
  for (const c of creases) lengthByOp.crease += dist(c.a, c.b);
  for (const s of parts.slits) lengthByOp[s.op] += pathLength(s.points, false);
  for (const l of parts.loose) {
    lengthByOp[l.op] += pathLength(l.outline, true);
    for (const h of l.holes) lengthByOp[l.op] += pathLength(h, true);
  }

  const bbox = bboxOf([...cutRings, ...parts.loose.map((l) => l.outline)]);

  return {
    panels,
    creases,
    slits: parts.slits,
    loose: parts.loose,
    cutRings,
    rootId: parts.rootId,
    assembly: parts.assembly,
    bbox,
    lengthByOp,
  };
}

/** Translate a whole net so its bottom-left corner sits at (margin, margin). Done
 *  once, at the end, so every builder can work in whatever coordinates suit it. */
export function placeNet(net: Net, margin: number): Net {
  const dx = margin - net.bbox[0];
  const dy = margin - net.bbox[1];
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return net;
  const t = (p: Poly): Poly => p.map(([x, y]) => [x + dx, y + dy] as Pt);
  const tp = (p: Pt): Pt => [p[0] + dx, p[1] + dy];
  return {
    ...net,
    panels: net.panels.map((p) => ({ ...p, outline: t(p.outline), holes: p.holes.map(t) })),
    creases: net.creases.map((c) => ({ ...c, a: tp(c.a), b: tp(c.b) })),
    slits: net.slits.map((s) => ({ ...s, points: t(s.points) })),
    loose: net.loose.map((l) => ({ ...l, outline: t(l.outline), holes: l.holes.map(t) })),
    cutRings: net.cutRings.map(t),
    bbox: [net.bbox[0] + dx, net.bbox[1] + dy, net.bbox[2] + dx, net.bbox[3] + dy],
  };
}

/** The numbered guide that ships with the files.
 *
 *  It deliberately does NOT enumerate the folds in tree order. Tree depth is the
 *  right sequence for the animation, where each panel simply has to move after the
 *  one it hangs off — but on a tube it counts round the wrap, so "fold the back, then
 *  the left side" describes nothing a person does. What a person actually does is
 *  crease everything first and then close the box, which is two sentences and the
 *  style's own words. */
export function assemblySteps(net: Net): string[] {
  const mountains = net.creases.filter((c) => c.dir === 'mountain').length;
  const prep = [
    `Crease all ${net.creases.length} fold lines before you fold anything: lay a ruler along each one and run it over, then open it flat again. Card creased first folds square; card folded cold wanders.`,
  ];
  if (mountains > 0) {
    // Cricut and every scoring tool fold INTO the score, so a crease that folds the
    // other way has to be worked from the back or it cracks along the outside face.
    prep.push(
      `${mountains} of those fold the opposite way to the rest — crease those from the other side of the sheet.`,
    );
  }
  return [...prep, ...net.assembly];
}

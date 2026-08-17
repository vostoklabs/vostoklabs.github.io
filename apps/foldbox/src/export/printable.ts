// Phase 2: the same net, printed flat as a thin sheet you fold once.
//
// The point is not to replace cardstock — it is that a 0.4 mm printed sheet behaves
// enough like 300 gsm card (which measures 0.38 mm) to prove a structure before you
// spend a sheet of board on it. Everything the box already knows is reused: the
// blank outline, the holes, the slots, and — the part that matters — the CREASES,
// which become thinned bands the sheet actually hinges on.
//
// Two things fall out of the existing model for free:
//
//   1. Caliper already drives every clamp, tab and slot in the geometry. Set it to
//      the printed thickness and the whole box is dimensioned for plastic. Nothing
//      in the builders needs to know it is being printed.
//   2. A crease is already a segment with a sign. `dir` tells us which face the
//      groove belongs on, so we can say out loud which folds go the wrong way.
//
// No CSG. The solid is built directly:
//
//     sheet   the whole blank, extruded to the HINGE thickness
//     panels  each panel, pulled back from its own fold lines, extruded on top
//
// Two shells that meet on a face. Every slicer unions parts within an object, and
// this avoids pulling a WASM kernel into an app whose whole design is that it does
// not need one.

import { buildStl, buildThreeMF, downloadFile, type ExportPart, type RGB } from '@vostok/export';
import { BRAND } from '@vostok/brand';
import type { Crease, Net, Panel, Poly, Pt } from '../types';
import { EPS, at, bboxOf, cross, len, signedArea, sub } from '../geometry/poly';

export interface PrintOpts {
  layerHeightMm: number;
  /** Total sheet thickness, in layers. */
  sheetLayers: number;
  /** What is left under a fold line, in layers. Equal to `sheetLayers` = no groove. */
  hingeLayers: number;
  /** Width of the thinned band. */
  hingeWidthMm: number;
}

export function sheetThicknessMm(o: PrintOpts): number {
  return Math.max(1, o.sheetLayers) * o.layerHeightMm;
}

export function hingeThicknessMm(o: PrintOpts): number {
  return Math.max(1, Math.min(o.hingeLayers, o.sheetLayers)) * o.layerHeightMm;
}

/** Slots the dieline draws as a zero-width cut have to become real openings — a
 *  nozzle cannot make a line. One nozzle width is the floor; 0.6 mm actually
 *  survives a tab being pushed through it. */
const SLIT_WIDTH_MM = 0.6;

const CARD: RGB = [232, 226, 214];

// ──────────────────────────────── tessellation ────────────────────────────────

const TOL = 1e-9;

interface Tess {
  verts: Pt[];
  tris: [number, number, number][];
}

/** Watertight tessellation of a polygon with holes, by a y-sweep into trapezoids.
 *
 *  NOT ear clipping, and the reason is specific. Ear clipping (three's
 *  `ShapeUtils.triangulateShape`, i.e. earcut) removes holes by bridging each one to
 *  the outer ring, and the bridge needs a pair of zero-area slivers to stay a valid
 *  simple polygon. When the bridge lands on collinear geometry those slivers are
 *  dropped, and the surface comes out torn along a line that has material on BOTH
 *  sides — the area still adds up exactly, so nothing but an edge-pairing test finds
 *  it. That is not a corner case here: a mailer's four locking slots are mirrored
 *  about the centre of the floor, so every bridge is horizontal and collinear, and
 *  the blank tore every time.
 *
 *  The sweep has no bridges. Cut at every vertex's y, pair the crossings left to
 *  right, and each band is a run of trapezoids. Two neighbouring bands share a
 *  horizontal line, so their shared edges are split at the union of both sides'
 *  crossings and every interior edge ends up used exactly twice. */
function tessellate(rings: Poly[]): Tess {
  interface Edge {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }
  // Quantise y BEFORE anything else. The sweep's whole correctness rests on every
  // edge starting and ending exactly on a band boundary; a rounded corner's arc
  // segments miss that by a few ulps, the edge then spans no band, its crossing goes
  // missing, and the even-odd pairing for that band silently shifts by one — which
  // shows up as overlapping trapezoids much further along. A tenth of a micron is
  // four orders below anything a printer resolves.
  const QY = 1e-7;
  const qy = (y: number): number => Math.round(y / QY) * QY;

  const edges: Edge[] = [];
  const levelSet: number[] = [];
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = at(r, i);
      const b = at(r, i + 1);
      const ay = qy(a[1]);
      const by = qy(b[1]);
      levelSet.push(ay);
      if (ay === by) continue;
      edges.push(
        ay < by
          ? { x0: a[0], y0: ay, x1: b[0], y1: by }
          : { x0: b[0], y0: by, x1: a[0], y1: ay },
      );
    }
  }
  if (!edges.length) return { verts: [], tris: [] };

  const levels: number[] = [];
  for (const y of levelSet.sort((p, q) => p - q)) {
    if (!levels.length || y !== levels[levels.length - 1]) levels.push(y);
  }

  const xAt = (e: Edge, y: number): number =>
    e.x0 + ((e.x1 - e.x0) * (y - e.y0)) / (e.y1 - e.y0);

  interface Span {
    xb0: number;
    xb1: number;
    xt0: number;
    xt1: number;
  }
  const bands: { yb: number; yt: number; spans: Span[] }[] = [];
  for (let i = 0; i + 1 < levels.length; i++) {
    const yb = levels[i] as number;
    const yt = levels[i + 1] as number;
    const crossing = edges
      .filter((e) => e.y0 <= yb && e.y1 >= yt)
      .map((e) => ({ b: xAt(e, yb), t: xAt(e, yt) }))
      .sort((p, q) => p.b + p.t - (q.b + q.t));
    // An odd count means the ring set is not closed across this band — impossible
    // for a real blank, so bail loudly rather than emit trapezoids that overlap.
    if (crossing.length % 2 !== 0) throw new Error(`tessellate: ${crossing.length} crossings at y=${yb}`);
    const spans: Span[] = [];
    // Even-odd: inside the material between crossing 0 and 1, 2 and 3, and so on.
    // Valid because the ring set is simple and holes lie inside their outer ring.
    for (let k = 0; k + 1 < crossing.length; k += 2) {
      const l = crossing[k] as { b: number; t: number };
      const r = crossing[k + 1] as { b: number; t: number };
      if (r.b - l.b < TOL && r.t - l.t < TOL) continue;
      spans.push({ xb0: l.b, xt0: l.t, xb1: r.b, xt1: r.t });
    }
    if (spans.length) bands.push({ yb, yt, spans });
  }

  // Every x a span touches on a given level, from the band above AND the one below,
  // so the horizontal edge they share is split the same way from both sides.
  const cuts = new Map<number, number[]>();
  const addCut = (y: number, x: number) => {
    const list = cuts.get(y);
    if (list) list.push(x);
    else cuts.set(y, [x]);
  };
  for (const band of bands) {
    for (const s of band.spans) {
      addCut(band.yb, s.xb0);
      addCut(band.yb, s.xb1);
      addCut(band.yt, s.xt0);
      addCut(band.yt, s.xt1);
    }
  }
  for (const [y, list] of cuts) {
    list.sort((a, b) => a - b);
    const uniq: number[] = [];
    for (const x of list) {
      if (!uniq.length || x - (uniq[uniq.length - 1] as number) > TOL) uniq.push(x);
    }
    cuts.set(y, uniq);
  }
  const between = (y: number, x0: number, x1: number): number[] =>
    (cuts.get(y) ?? []).filter((x) => x > x0 + TOL && x < x1 - TOL);

  const verts: Pt[] = [];
  const index = new Map<string, number>();
  const vid = (x: number, y: number): number => {
    const k = `${Math.round(x / 1e-7)},${Math.round(y / 1e-7)}`;
    let i = index.get(k);
    if (i === undefined) {
      i = verts.length;
      index.set(k, i);
      verts.push([x, y]);
    }
    return i;
  };

  const tris: [number, number, number][] = [];
  for (const band of bands) {
    for (const s of band.spans) {
      // CCW: along the bottom left to right, up the right leg, back along the top.
      const ring: number[] = [];
      const push = (i: number) => {
        if (ring[ring.length - 1] !== i && ring[0] !== i) ring.push(i);
      };
      push(vid(s.xb0, band.yb));
      for (const x of between(band.yb, s.xb0, s.xb1)) push(vid(x, band.yb));
      push(vid(s.xb1, band.yb));
      push(vid(s.xt1, band.yt));
      for (const x of between(band.yt, s.xt0, s.xt1).reverse()) push(vid(x, band.yt));
      push(vid(s.xt0, band.yt));
      // A trapezoid stays convex however many collinear points are inserted along
      // its two horizontal edges, so a fan from the first vertex is safe.
      for (let k = 1; k + 1 < ring.length; k++) {
        tris.push([ring[0] as number, ring[k] as number, ring[k + 1] as number]);
      }
    }
  }
  return { verts, tris };
}

// ─────────────────────────────────── mesh ───────────────────────────────────

class MeshBuf {
  readonly pos: number[] = [];
  readonly idx: number[] = [];

  /** A straight prism over a polygon with holes.
   *
   *  The side walls are built from the tessellation's OWN boundary — the directed
   *  edges it left unpaired — rather than from the input rings. That is what keeps
   *  the walls and the faces in step: the sweep splits a ring edge wherever a band
   *  boundary crosses it, and a wall built from the original ring would then meet a
   *  face made of two edges with one. */
  prism(outer: Poly, holes: Poly[], z0: number, z1: number): void {
    if (outer.length < 3 || z1 - z0 <= 0) return;
    const { verts, tris } = tessellate([outer, ...holes]);
    if (!tris.length) return;

    const n = verts.length;
    const base = this.pos.length / 3;
    for (const p of verts) this.pos.push(p[0], p[1], z0);
    for (const p of verts) this.pos.push(p[0], p[1], z1);

    const seen = new Map<string, number>();
    for (const [a, b, c] of tris) {
      this.idx.push(base + n + a, base + n + b, base + n + c);
      this.idx.push(base + c, base + b, base + a);
      for (const [i, j] of [
        [a, b],
        [b, c],
        [c, a],
      ] as [number, number][]) {
        seen.set(`${i}|${j}`, (seen.get(`${i}|${j}`) ?? 0) + 1);
      }
    }

    for (const [k, count] of seen) {
      const [as, bs] = k.split('|');
      const a = Number(as);
      const b = Number(bs);
      if ((seen.get(`${b}|${a}`) ?? 0) === count) continue;
      // Boundary: material is on the left of a -> b, so right of it is outward.
      this.idx.push(base + a, base + b, base + n + b);
      this.idx.push(base + a, base + n + b, base + n + a);
    }
  }

  toPart(name: string, group: string): ExportPart | null {
    if (!this.idx.length) return null;
    return {
      name,
      positions: new Float32Array(this.pos),
      indices: new Uint32Array(this.idx),
      color: CARD,
      group,
    };
  }
}

// ───────────────────────────────── geometry ─────────────────────────────────

/** Is `p` on segment ab, endpoints included? Used to decide whether a panel edge
 *  is a fold line, so it is deliberately tolerant: a crease run is derived from the
 *  same snapped vertices the outline is, but a midpoint test is not exact. */
function onSeg(p: Pt, a: Pt, b: Pt, tol: number): boolean {
  const ab = sub(b, a);
  const L = len(ab);
  if (L < EPS) return false;
  if (Math.abs(cross(ab, sub(p, a))) / L > tol) return false;
  const t = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (L * L);
  return t > -tol / L && t < 1 + tol / L;
}

function pointInRing(p: Pt, ring: Poly): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Pt;
    const b = ring[j] as Pt;
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
      if (p[0] < x) inside = !inside;
    }
  }
  return inside;
}

/** Move each edge inward by its own distance and re-intersect the neighbours.
 *  `dists[i]` belongs to the edge from `ring[i]` to `ring[i+1]`. */
function insetRing(ring: Poly, dists: number[]): Poly {
  const n = ring.length;
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const prev = at(ring, i - 1);
    const cur = at(ring, i);
    const next = at(ring, i + 1);
    const e1 = sub(cur, prev);
    const e2 = sub(next, cur);
    const l1 = len(e1);
    const l2 = len(e2);
    if (l1 < EPS || l2 < EPS) {
      out.push(cur);
      continue;
    }
    const d1 = dists[(i - 1 + n) % n] ?? 0;
    const d2 = dists[i] ?? 0;
    // Left of travel is inward for a CCW ring.
    const n1: Pt = [(-e1[1] / l1) * d1, (e1[0] / l1) * d1];
    const n2: Pt = [(-e2[1] / l2) * d2, (e2[0] / l2) * d2];
    const denom = cross(e1, e2);
    if (Math.abs(denom) < EPS * Math.max(l1, l2)) {
      out.push([cur[0] + n2[0], cur[1] + n2[1]]);
      continue;
    }
    const p1: Pt = [prev[0] + n1[0], prev[1] + n1[1]];
    const p2: Pt = [cur[0] + n2[0], cur[1] + n2[1]];
    const t = cross(sub(p2, p1), e2) / denom;
    out.push([p1[0] + e1[0] * t, p1[1] + e1[1] * t]);
  }
  return out;
}

/** Every crease run this panel takes part in — as a child of its parent, and as the
 *  parent of each of its children. In a net whose fold graph is a tree those are
 *  exactly the panel's interior edges. */
function creasesOf(panel: Panel, creases: Crease[]): Crease[] {
  return creases.filter((c) => c.panelId === panel.id || c.parentId === panel.id);
}

/** The panel, pulled back from its own fold lines by half the groove width — the
 *  footprint of the material that stays at full thickness.
 *
 *  Returns null when there is nothing left to keep. That is not a failure: a mailer's
 *  roll strip is 2t wide with a crease down BOTH sides, so the whole strip is hinge,
 *  which is exactly what it should be. */
function panelTop(panel: Panel, creases: Crease[], groove: number): Poly | null {
  const mine = creasesOf(panel, creases);
  if (!mine.length) return panel.outline;

  const [x0, y0, x1, y1] = bboxOf([panel.outline]);
  const minDim = Math.min(x1 - x0, y1 - y0);
  const back = Math.min(groove / 2, minDim * 0.35);
  if (back <= EPS) return panel.outline;

  const ring = panel.outline;
  const dists = ring.map((_, i) => {
    const a = at(ring, i);
    const b = at(ring, i + 1);
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return mine.some((c) => onSeg(mid, c.a, c.b, 0.02)) ? back : 0;
  });
  if (!dists.some((d) => d > 0)) return panel.outline;

  const inset = insetRing(ring, dists);
  const area = signedArea(inset);
  // A pull-back that ate the panel, folded it inside out, or somehow grew it is not
  // a shape to extrude. Drop the top slab and leave that panel at hinge thickness.
  if (area <= 0.3 || area > signedArea(ring) + EPS) return null;
  const [ix0, iy0, ix1, iy1] = bboxOf([inset]);
  if (ix0 < x0 - EPS || iy0 < y0 - EPS || ix1 > x1 + EPS || iy1 > y1 + EPS) return null;
  return inset;
}

/** Group the blank's rings into outer boundaries and the holes that belong to each. */
function shells(rings: Poly[]): { outer: Poly; holes: Poly[] }[] {
  const outers = rings.filter((r) => signedArea(r) > 0).map((outer) => ({ outer, holes: [] as Poly[] }));
  for (const r of rings) {
    if (signedArea(r) >= 0) continue;
    const p = r[0] as Pt;
    const host = outers.find((o) => pointInRing(p, o.outer)) ?? outers[0];
    host?.holes.push(r);
  }
  return outers;
}

/** A zero-width slit becomes a real slot: a rectangle of `w` about the line. Wound
 *  CW, because it is a hole. */
function slitSlot(a: Pt, b: Pt, w: number): Poly | null {
  const d = sub(b, a);
  const L = len(d);
  if (L < EPS) return null;
  const u: Pt = [d[0] / L, d[1] / L];
  const n: Pt = [-u[1] * (w / 2), u[0] * (w / 2)];
  const ring: Poly = [
    [a[0] + n[0], a[1] + n[1]],
    [b[0] + n[0], b[1] + n[1]],
    [b[0] - n[0], b[1] - n[1]],
    [a[0] - n[0], a[1] - n[1]],
  ];
  return signedArea(ring) > 0 ? [...ring].reverse() : ring;
}

// ──────────────────────────────── the export ────────────────────────────────

export interface PrintableStats {
  sheetMm: number;
  hingeMm: number;
  parts: number;
  triangles: number;
  /** Folds whose groove ends up on the wrong face — see the note in the readme. */
  mountains: number;
  /** Panels too narrow to keep any full-thickness material at all. */
  allHinge: number;
}

/** The one printable-geometry function. `buildPrintable` -> parts, and every caller
 *  that wants a file goes through `downloadPrintable`. */
export function buildPrintable(net: Net, o: PrintOpts): { parts: ExportPart[]; stats: PrintableStats } {
  const sheet = sheetThicknessMm(o);
  const hinge = Math.min(hingeThicknessMm(o), sheet);
  const grooved = hinge < sheet - 1e-6;

  const slots: Poly[] = [];
  for (const s of net.slits) {
    if (s.op !== 'cut' || s.points.length < 2) continue;
    const slot = slitSlot(s.points[0] as Pt, s.points[s.points.length - 1] as Pt, SLIT_WIDTH_MM);
    if (slot) slots.push(slot);
  }

  const blank = shells([...net.cutRings, ...slots]);

  const base = new MeshBuf();
  // With no groove the blank is one plain prism and the file is a single closed
  // shell — the safest thing to hand a slicer, so it stays the shape of the output
  // whenever the hinge is not actually thinner.
  for (const s of blank) base.prism(s.outer, s.holes, 0, grooved ? hinge : sheet);

  const tops = new MeshBuf();
  let allHinge = 0;
  if (grooved) {
    for (const panel of net.panels) {
      const top = panelTop(panel, net.creases, o.hingeWidthMm);
      if (!top) {
        allHinge++;
        continue;
      }
      // A hole that no longer sits inside the pulled-back panel would be covered by
      // the slab that is supposed to leave it open.
      const holes = panel.holes.filter((h) => h.every((p) => pointInRing(p, top)));
      if (holes.length !== panel.holes.length) {
        allHinge++;
        continue;
      }
      tops.prism(top, holes, hinge, sheet);
    }
  }

  // Loose parts are cut but never folded, so they print at full thickness. The film
  // insert is acetate and has no business in a 3MF.
  const inserts = new MeshBuf();
  for (const l of net.loose) {
    if (l.op === 'film') continue;
    const ring = signedArea(l.outline) > 0 ? l.outline : [...l.outline].reverse();
    inserts.prism(ring, l.holes, 0, sheet);
  }

  const parts = [
    base.toPart(grooved ? 'sheet + hinges' : 'sheet', 'blank'),
    tops.toPart('panels', 'blank'),
    inserts.toPart('inserts', 'inserts'),
  ].filter((p): p is ExportPart => p !== null);

  return {
    parts,
    stats: {
      sheetMm: sheet,
      hingeMm: grooved ? hinge : sheet,
      parts: parts.length,
      triangles: parts.reduce((n, p) => n + p.indices.length / 3, 0),
      mountains: net.creases.filter((c) => c.dir === 'mountain').length,
      allHinge,
    },
  };
}

export function downloadPrintable(
  net: Net,
  o: PrintOpts,
  meta: { title: string; baseName: string; buildId?: string },
  format: '3mf' | 'stl',
): PrintableStats {
  const { parts, stats } = buildPrintable(net, o);
  if (!parts.length) throw new Error('There is no geometry to print at this size.');
  if (format === 'stl') {
    downloadFile(buildStl(parts), `${meta.baseName}.stl`, 'model/stl');
  } else {
    downloadFile(
      buildThreeMF(parts, {
        title: meta.title,
        generator: 'foldbox',
        application: `${BRAND.name} Fold-Up Box Generator`,
        buildId: meta.buildId,
      }),
      `${meta.baseName}.3mf`,
      'model/3mf',
    );
  }
  return stats;
}

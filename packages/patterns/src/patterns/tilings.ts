// The uniform (Archimedean) tilings, two of their duals, and the Penrose rhombus patch.
//
// Every one of these is an edge-to-edge tiling of whole polygons, so each is drawn the same
// way: the tile hands back the polygons of one period and `tiles()` decides what the laser
// sees — shrunk apart by `gap` they are holes to cut, and at gap 0 they are the bare lattice
// to score, shared edges and all (the engine's merge drops the duplicates).
//
// Coordinates are derived, never traced: each construction is one line of maths from the
// tiling's edge length, and the vertex configuration is what the test checks.
import { SQRT3, regularPolygon, signedArea } from '../geom';
import { SIZE, num, number } from '../params';
import type { Box, Island, ParamSpec, PatternDef, PatternGeometry, Polyline, Pt, Ring } from '../types';

/** The golden ratio — the Penrose subdivision's one constant. */
export const PHI = (1 + Math.sqrt(5)) / 2;
/** Snub-square pitch ÷ edge: √(2+√3) = 1.93185. */
const SNUB_PITCH = Math.sqrt(2 + SQRT3);
/** Square centre → the centroid of the triangle on its edge, ÷ edge: 1/2 + √3/6. */
const SNUB_TRI = 0.5 + SQRT3 / 6;

const closed = (r: Ring): Polyline => [...r, r[0]!];
const dir = (deg: number, r: number): Pt => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** How far a box reaches from the origin — a field pattern draws out to this. */
const reach = (b: Box): number => Math.max(Math.hypot(b.minX, b.minY), Math.hypot(b.maxX, b.minY), Math.hypot(b.maxX, b.maxY), Math.hypot(b.minX, b.maxY));

/**
 * A ring with every edge moved `d` towards the inside and the corners re-cut where the moved
 * edges now meet. Unlike `shrinkRing` (which scales, so a long edge moves further than a short
 * one) this leaves the same web everywhere, which is the whole point when two different tiles
 * share an edge. Keep `d` well under the shape's inradius; a reflex corner is fine.
 */
export function insetRing(ring: Ring, d: number): Ring {
  if (!(d > 0) || ring.length < 3) return ring;
  const ccw = signedArea(ring) > 0 ? ring : [...ring].reverse();
  const lines: { px: number; py: number; ux: number; uy: number }[] = [];
  for (let i = 0; i < ccw.length; i++) {
    const a = ccw[i]!;
    const b = ccw[(i + 1) % ccw.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    // The interior of a CCW ring is to the left of travel: (−uy, ux).
    lines.push({ px: a[0] - uy * d, py: a[1] + ux * d, ux, uy });
  }
  if (lines.length < 3) return ring;
  const out: Ring = [];
  for (let i = 0; i < lines.length; i++) {
    const p = lines[(i + lines.length - 1) % lines.length]!;
    const q = lines[i]!;
    const den = p.ux * q.uy - p.uy * q.ux;
    if (Math.abs(den) < 1e-9) {
      out.push([q.px, q.py]);
      continue;
    }
    const t = ((q.px - p.px) * q.uy - (q.py - p.py) * q.ux) / den;
    out.push([p.px + p.ux * t, p.py + p.uy * t]);
  }
  return out.length >= 3 ? out : ring;
}

/** Tiles as holes with `gap` between them, or — at gap 0 — as the bare lattice lines. */
export function tiles(rings: Ring[], gap: number): PatternGeometry {
  if (!(gap > 0)) return { holes: [], lines: rings.map(closed), slits: [] };
  return { holes: rings.map((r): Island => [insetRing(r, gap / 2)]), lines: [], slits: [] };
}

const TILE_GAP = (value: number): ParamSpec =>
  number('gap', 'Gap', value, 0, 20, 0.1, 'mm', 'Material left between neighbouring tiles when cut. At 0 the tiling is drawn as its bare lattice of lines.');

// ---- skeletons, shared with the Islamic strapwork ------------------------------------------

/** 4.8.8: an octagon of edge `e` on the cell centre, a square turned 45° on its corner. */
export const truncSquarePitch = (e: number): number => e * (1 + Math.SQRT2);
export function truncSquarePolys(e: number): Ring[] {
  const p = truncSquarePitch(e);
  return [regularPolygon(p / 2, p / 2, e / (2 * Math.sin(Math.PI / 8)), 8, Math.PI / 8), regularPolygon(0, 0, e / Math.SQRT2, 4, 0)];
}

/** 3.12.12: dodecagons of edge `e` on a triangular lattice, a triangle in every 3-way gap.
 *  Cell w = pitch, h = pitch·√3 — two dodecagons and four triangles. */
export const truncHexPitch = (e: number): number => e / Math.tan(Math.PI / 12);
export function truncHexPolys(e: number): Ring[] {
  const p = truncHexPitch(e);
  const R = e / (2 * Math.sin(Math.PI / 12));
  const rt = e / SQRT3;
  const twelve = (cx: number, cy: number): Ring => regularPolygon(cx, cy, R, 12, Math.PI / 12);
  // The lattice's triangle centroids: two pointing one way, two the other. A gap triangle's
  // edges face the three dodecagons around it, so its vertices point between them.
  return [
    twelve(0, 0),
    twelve(p / 2, (p * SQRT3) / 2),
    regularPolygon(p / 2, p / (2 * SQRT3), rt, 3, Math.PI / 6),
    regularPolygon(0, (2 * p) / SQRT3, rt, 3, Math.PI / 6),
    regularPolygon(0, p / SQRT3, rt, 3, Math.PI / 2),
    regularPolygon(p / 2, p / SQRT3 + (p * SQRT3) / 2, rt, 3, Math.PI / 2),
  ];
}

/** 3.4.6.4: hexagons of edge `a` on a triangular lattice of pitch a(1+√3), a square on every
 *  hexagon edge and a triangle in every 3-way gap. */
export const rhombitrihexPitch = (a: number): number => a * (1 + SQRT3);
export function rhombitrihexPolys(a: number): Ring[] {
  const p = rhombitrihexPitch(a);
  const out: Ring[] = [];
  for (const c of [[0, 0], [p / 2, (p * SQRT3) / 2]] as Pt[]) {
    out.push(regularPolygon(c[0], c[1], a, 6, Math.PI / 6));
    // Six squares, one per hexagon edge; each is drawn again by the hexagon on its far side
    // and the engine drops the duplicate.
    for (let k = 0; k < 6; k++) {
      const s = add(c, dir(60 * k, p / 2));
      out.push(regularPolygon(s[0], s[1], a / Math.SQRT2, 4, rad(60 * k + 45)));
    }
  }
  const rt = a / SQRT3;
  // A gap triangle's edges face the three squares around it, not the hexagons.
  out.push(regularPolygon(p / 2, p / (2 * SQRT3), rt, 3, Math.PI / 2));
  out.push(regularPolygon(0, (2 * p) / SQRT3, rt, 3, Math.PI / 2));
  out.push(regularPolygon(0, p / SQRT3, rt, 3, Math.PI / 6));
  out.push(regularPolygon(p / 2, p / SQRT3 + (p * SQRT3) / 2, rt, 3, Math.PI / 6));
  return out;
}

// ---- the patterns ---------------------------------------------------------------------------

export const cairo: PatternDef = {
  id: 'cairo',
  name: 'Cairo pentagons',
  family: 'geometric',
  tags: ['tiling', 'pentagon', 'holes', 'cairo', 'paving', 'dual'],
  blurb: 'The pentagon paving from Cairo\'s streets — the dual of the snub square tiling, four pentagons to a pinwheel.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(9, 3, 60, 'Cell'), TILE_GAP(1.5)],
  cell: (p) => {
    const s = num(p, 'size') * SNUB_PITCH;
    return { w: s, h: s };
  },
  tile: (p) => tiles(cairoPentagons(num(p, 'size')), num(p, 'gap')),
  web: (p) => num(p, 'gap'),
};

/** The dual of the snub square tiling: every pentagon corner is a face centre of that tiling —
 *  two square centres (the 90° corners) and three triangle centroids (the 120° ones). */
function cairoPentagons(s: number): Ring[] {
  const p = s * SNUB_PITCH;
  const a: Pt = [p / 2, p / 2];
  const b: Pt = [p, p];
  const t = SNUB_TRI * s;
  const base: Ring = [a, add(a, dir(15, t)), b, add(b, dir(165, t)), add(a, dir(105, t))];
  return [0, 1, 2, 3].map((k) => base.map((q): Pt => {
    const c = Math.cos(rad(90 * k));
    const s90 = Math.sin(rad(90 * k));
    const dx = q[0] - a[0];
    const dy = q[1] - a[1];
    return [a[0] + dx * c - dy * s90, a[1] + dx * s90 + dy * c];
  }));
}

export const snubSquare: PatternDef = {
  id: 'snub-square',
  name: 'Snub square (3.3.4.3.4)',
  family: 'geometric',
  tags: ['tiling', 'archimedean', 'squares', 'triangles', 'holes', 'pinwheel'],
  blurb: 'Squares turned ±15° with triangles packed between — two squares and three triangles at every corner.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(9, 3, 60, 'Edge'), TILE_GAP(1.5)],
  cell: (p) => {
    const s = num(p, 'size') * SNUB_PITCH;
    return { w: s, h: s };
  },
  tile: (p) => tiles(snubSquarePolys(num(p, 'size')), num(p, 'gap')),
  web: (p) => num(p, 'gap'),
};

function snubSquarePolys(s: number): Ring[] {
  const p = s * SNUB_PITCH;
  const cx = p / 2;
  const cy = p / 2;
  const out: Ring[] = [
    regularPolygon(cx, cy, s / Math.SQRT2, 4, rad(60)),
    regularPolygon(0, 0, s / Math.SQRT2, 4, rad(30)),
  ];
  // One triangle on each edge of the centre square; the corner square's four are the
  // neighbouring cells' own.
  for (let k = 0; k < 4; k++) {
    const c = add([cx, cy], dir(15 + 90 * k, SNUB_TRI * s));
    out.push(regularPolygon(c[0], c[1], s / SQRT3, 3, rad(15 + 90 * k)));
  }
  return out;
}

export const truncatedSquare: PatternDef = {
  id: 'truncated-square',
  name: 'Truncated square (4.8.8)',
  family: 'geometric',
  tags: ['tiling', 'archimedean', 'octagon', 'lines', 'lattice'],
  blurb: 'Octagons meeting flat to flat with a small square in every gap — the lattice behind the 8-fold star.',
  ops: ['score', 'engrave'],
  params: [SIZE(6, 2, 50, 'Edge')],
  cell: (p) => {
    const s = truncSquarePitch(num(p, 'size'));
    return { w: s, h: s };
  },
  tile: (p) => tiles(truncSquarePolys(num(p, 'size')), 0),
};

export const truncatedHex: PatternDef = {
  id: 'truncated-hex',
  name: 'Truncated hexagonal (3.12.12)',
  family: 'geometric',
  tags: ['tiling', 'archimedean', 'dodecagon', 'holes', 'lattice'],
  blurb: 'Twelve-sided tiles edge to edge with a triangle in every 3-way gap — the natural bed for a 12-fold rosette.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(4, 1.5, 40, 'Edge'), TILE_GAP(1.5)],
  cell: (p) => {
    const s = truncHexPitch(num(p, 'size'));
    return { w: s, h: s * SQRT3 };
  },
  tile: (p) => tiles(truncHexPolys(num(p, 'size')), num(p, 'gap')),
  web: (p) => num(p, 'gap'),
};

export const rhombitrihexagonal: PatternDef = {
  id: 'rhombitrihexagonal',
  name: 'Rhombitrihexagonal (3.4.6.4)',
  family: 'geometric',
  tags: ['tiling', 'archimedean', 'hexagon', 'squares', 'triangles', 'holes'],
  blurb: 'Hexagons ringed by squares with a triangle at every three-way meeting — one of each around every corner.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(5, 2, 40, 'Edge'), TILE_GAP(1.5)],
  cell: (p) => {
    const s = rhombitrihexPitch(num(p, 'size'));
    return { w: s, h: s * SQRT3 };
  },
  tile: (p) => tiles(rhombitrihexPolys(num(p, 'size')), num(p, 'gap')),
  web: (p) => num(p, 'gap'),
};

export const deltoidal: PatternDef = {
  id: 'deltoidal',
  name: 'Deltoidal trihexagonal',
  family: 'geometric',
  tags: ['tiling', 'dual', 'kite', 'lines', 'lattice'],
  blurb: 'Kites, six round every hexagon centre and four round every square one — the dual of 3.4.6.4.',
  ops: ['score', 'engrave'],
  params: [SIZE(6, 2, 40, 'Edge')],
  cell: (p) => {
    const s = rhombitrihexPitch(num(p, 'size'));
    return { w: s, h: s * SQRT3 };
  },
  tile: (p) => tiles(deltoidalKites(num(p, 'size')), 0),
};

/** One kite per vertex of 3.4.6.4: its corners are the centres of the hexagon, the two squares
 *  and the triangle that meet there. */
function deltoidalKites(a: number): Ring[] {
  const p = rhombitrihexPitch(a);
  const out: Ring[] = [];
  for (const c of [[0, 0], [p / 2, (p * SQRT3) / 2]] as Pt[]) {
    for (let k = 0; k < 6; k++) {
      out.push([c, add(c, dir(60 * k, p / 2)), add(c, dir(60 * k + 30, p / SQRT3)), add(c, dir(60 * k + 60, p / 2))]);
    }
  }
  return out;
}

export const penrose: PatternDef = {
  id: 'penrose',
  name: 'Penrose (P3)',
  family: 'geometric',
  tags: ['tiling', 'aperiodic', 'rhombus', 'lines', 'penrose', 'golden'],
  blurb: 'The aperiodic rhombus tiling: two diamonds, five-fold symmetry, and no repeat anywhere.',
  ops: ['score', 'engrave'],
  params: [SIZE(10, 3, 60, 'Rhombus side')],
  generate: (box, p) => ({ holes: [], lines: penroseLines(box, num(p, 'size')), slits: [] }),
  thumb: { params: { size: 7 } },
};

/**
 * Robinson-triangle subdivision (Penrose's own construction, as in Preshing's write-up): start
 * from a ten-fold sun of acute half-rhombi bigger than the box, then split every triangle at
 * the golden ratio until its legs are the asked side. Each half-rhombus draws its two legs —
 * the base is the rhombus's own diagonal and belongs to nobody.
 */
function penroseLines(box: Box, side: number): Polyline[] {
  const r0 = reach(box) * 1.1 + side;
  const steps = Math.max(1, Math.min(7, Math.round(Math.log(r0 / Math.max(side, 0.5)) / Math.log(PHI))));
  const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  let tris: { acute: boolean; a: Pt; b: Pt; c: Pt }[] = [];
  for (let i = 0; i < 10; i++) {
    const u: Pt = [r0 * Math.cos(((2 * i - 1) * Math.PI) / 10), r0 * Math.sin(((2 * i - 1) * Math.PI) / 10)];
    const v: Pt = [r0 * Math.cos(((2 * i + 1) * Math.PI) / 10), r0 * Math.sin(((2 * i + 1) * Math.PI) / 10)];
    tris.push(i % 2 === 0 ? { acute: true, a: [0, 0], b: v, c: u } : { acute: true, a: [0, 0], b: u, c: v });
  }
  for (let s = 0; s < steps; s++) {
    const next: typeof tris = [];
    for (const t of tris) {
      if (t.acute) {
        const q = lerp(t.a, t.b, 1 / PHI);
        next.push({ acute: true, a: t.c, b: q, c: t.b }, { acute: false, a: q, b: t.c, c: t.a });
      } else {
        const q = lerp(t.b, t.a, 1 / PHI);
        const r = lerp(t.b, t.c, 1 / PHI);
        next.push({ acute: false, a: r, b: t.c, c: t.a }, { acute: false, a: q, b: r, c: t.b }, { acute: true, a: r, b: q, c: t.a });
      }
    }
    tris = next;
  }
  return tris.map((t): Polyline => [t.b, t.a, t.c]);
}

export const TILINGS: PatternDef[] = [cairo, snubSquare, truncatedSquare, truncatedHex, rhombitrihexagonal, deltoidal, penrose];

// Islamic geometric pattern: star polygons and the strapwork drawn over a hidden skeleton.
//
// Two constructions, both classical. The star-and-cross tilings are laid out directly — an
// {n/k} star on every lattice point, touching its neighbours tip to tip, and whatever polygon
// the gap between them turns out to be (a 16-sided cross on the square lattice, a regular
// hexagon on the triangular one). Those tile, so they cut.
//
// The rosettes use Hankin's POLYGONS IN CONTACT (Hankin 1925; Kaplan, "Islamic Star Patterns
// from Polygons in Contact", 2005): take an edge-to-edge tiling as a hidden skeleton, walk out
// of every edge's midpoint at the contact angle, stop each ray where it meets the one coming
// back from the next edge — and throw the skeleton away. What is left is continuous strapwork,
// an n-pointed star in every n-gon, knotted at every edge midpoint where the rays from the two
// polygons cross. The contact angle is the taste knob: 180° − 2α is the angle of the star's
// point, so α = 67.5° gives the {8/3} star the 4.8.8 tiling is famous for.
import { SQRT3, signedArea, star } from '../geom';
import { GAP, SIZE, bool, num, number, toggle } from '../params';
import { tiles, truncHexPitch, truncHexPolys, truncSquarePitch, truncSquarePolys } from './tilings';
import type { Island, ParamSpec, PatternDef, PatternGeometry, Params, Polyline, Pt, Ring } from '../types';

const TILE_GAP = (value: number): ParamSpec =>
  number('gap', 'Gap', value, 0, 20, 0.1, 'mm', 'Material left between neighbouring tiles when cut. At 0 the pattern is drawn as its bare lattice of lines.');
const CONTACT = (value: number): ParamSpec =>
  number('contact', 'Contact angle', value, 30, 85, 0.5, '°', 'Hankin\'s angle between a strap and the skeleton edge it leaves. The star\'s points are 180° − 2× this.');

/** The outline of an {n/k} star polygon: the inner radius that makes the points meet the way
 *  the star polygon's chords would. */
export const starInner = (n: number, k: number, outer: number): number =>
  (outer * Math.cos((k * Math.PI) / n)) / Math.cos(((k - 1) * Math.PI) / n);

/**
 * Hankin's polygons-in-contact, one skeleton polygon at a time: two rays out of every edge
 * midpoint at `contact` degrees from that edge, each trimmed where it meets the ray coming the
 * other way out of the next midpoint. Neighbouring polygons share a midpoint, so their straps
 * cross there and the whole thing reads as one interlaced line.
 */
export function picStrapwork(poly: Ring, contactDeg: number): Polyline[] {
  const ring = signedArea(poly) > 0 ? poly : [...poly].reverse();
  const th = (Math.min(85, Math.max(5, contactDeg)) * Math.PI) / 180;
  const edges: { m: Pt; u: Pt; v: Pt }[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    // Interior is left of travel on a CCW ring.
    edges.push({ m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], u, v: [-u[1], u[0]] });
  }
  const out: Polyline[] = [];
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    const f = edges[(i + 1) % edges.length]!;
    const d1: Pt = [cos * e.u[0] + sin * e.v[0], cos * e.u[1] + sin * e.v[1]];
    const d2: Pt = [-cos * f.u[0] + sin * f.v[0], -cos * f.u[1] + sin * f.v[1]];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-9) continue;
    const t = ((f.m[0] - e.m[0]) * d2[1] - (f.m[1] - e.m[1]) * d2[0]) / den;
    if (!(t > 1e-9) || !Number.isFinite(t)) continue;
    const x: Pt = [e.m[0] + d1[0] * t, e.m[1] + d1[1] * t];
    out.push([e.m, x], [f.m, x]);
  }
  return out;
}

const linesOnly = (lines: Polyline[]): PatternGeometry => ({ holes: [], lines, slits: [] });
const pic = (polys: Ring[], contact: number): PatternGeometry => linesOnly(polys.flatMap((r) => picStrapwork(r, contact)));

// ---- star-and-cross, laid out directly -------------------------------------------------------

export const starCross8: PatternDef = {
  id: 'star-cross-8',
  name: 'Star and cross (8-fold)',
  family: 'islamic',
  tags: ['tiling', 'star', 'octagram', 'holes', 'islamic', 'seljuk', 'zellige'],
  blurb: 'Eight-point stars touching tip to tip, a pointed cross in every gap — the Seljuk tile that started it all.',
  ops: ['cut', 'engrave', 'score'],
  params: [
    SIZE(16, 6, 80, 'Star size'),
    number('inner', 'Star inner radius', starInner(8, 2, 1), 0.45, 0.85, 0.005, '×', 'The default is the octagram of two overlapping squares; smaller makes a sharper star and a thinner cross.'),
    TILE_GAP(1.5),
  ],
  cell: (p) => ({ w: num(p, 'size'), h: num(p, 'size') }),
  tile: (p) => {
    const r = num(p, 'size') / 2;
    const inner = num(p, 'inner') * r;
    return tiles([star(r, r, 8, r, inner, 0), crossRing(r, inner)], num(p, 'gap'));
  },
  web: (p) => num(p, 'gap'),
};

/** The gap between four stars: a 16-gon with a point at each star-to-star contact, a notch
 *  where each star's diagonal point comes in, and the star's own edges between. */
function crossRing(r: number, inner: number): Ring {
  const c22 = Math.cos(Math.PI / 8);
  const s22 = Math.sin(Math.PI / 8);
  const notch = r * (1 - Math.SQRT1_2);
  const quarter: Ring = [[r, 0], [r - inner * s22, r - inner * c22], [notch, notch], [r - inner * c22, r - inner * s22]];
  const out: Ring = [];
  for (let k = 0; k < 4; k++) {
    const c = Math.cos((k * Math.PI) / 2);
    const s = Math.sin((k * Math.PI) / 2);
    for (const q of quarter) out.push([q[0] * c - q[1] * s, q[0] * s + q[1] * c]);
  }
  return out;
}

export const khatam6: PatternDef = {
  id: 'khatam-6',
  name: 'Khatam (6-point star)',
  family: 'islamic',
  tags: ['tiling', 'star', 'hexagram', 'hexagon', 'holes', 'islamic', 'khatam'],
  blurb: 'Six-point stars on the triangular lattice with a hexagon in every gap — khatam, the seal.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(14, 5, 80, 'Star size'), TILE_GAP(1.5)],
  cell: (p) => ({ w: num(p, 'size'), h: num(p, 'size') * SQRT3 }),
  tile: (p) => {
    const r = num(p, 'size') / 2;
    const h = r / SQRT3;
    const hex = (cx: number, cy: number): Ring => {
      const out: Ring = [];
      for (let k = 0; k < 6; k++) out.push([cx + h * Math.cos(-Math.PI / 2 + (k * Math.PI) / 3), cy + h * Math.sin(-Math.PI / 2 + (k * Math.PI) / 3)]);
      return out;
    };
    // Stars on the lattice; hexagons on the centroid of every lattice triangle.
    return tiles([
      star(0, 0, 6, r, h, 0),
      star(r, r * SQRT3, 6, r, h, 0),
      hex(r, h),
      hex(0, 2 * h),
      hex(0, 4 * h),
      hex(r, 5 * h),
    ], num(p, 'gap'));
  },
  web: (p) => num(p, 'gap'),
};

export const starPolygon: PatternDef = {
  id: 'star-polygon',
  name: 'Star polygons {n/k}',
  family: 'islamic',
  tags: ['star', 'holes', 'islamic', 'rosette', 'lattice'],
  blurb: 'A field of {n/k} stars — the one primitive every rosette in this family is built from. More skip, sharper point.',
  ops: ['cut', 'engrave', 'score'],
  params: [
    SIZE(12, 3, 60, 'Star size'),
    number('points', 'Points', 8, 5, 12, 1, '', 'n — how many points the star has.'),
    number('skip', 'Skip', 3, 2, 5, 1, '', 'k — how far round the circle each chord reaches. The point angle is 180°(n − 2k) ÷ n.'),
    GAP(2),
    toggle('stagger', 'Stagger rows', true),
    number('phase', 'Turn', 0, 0, 90, 1, '°'),
  ],
  cell: (p) => {
    const pitch = num(p, 'size') + num(p, 'gap');
    return bool(p, 'stagger') ? { w: pitch, h: pitch * SQRT3 } : { w: pitch, h: pitch };
  },
  tile: (p) => {
    const n = Math.round(num(p, 'points'));
    const k = Math.max(2, Math.min(Math.floor((n - 1) / 2), Math.round(num(p, 'skip'))));
    const r = num(p, 'size') / 2;
    const rot = Math.PI / 2 + (num(p, 'phase') * Math.PI) / 180;
    const motif = (cx: number, cy: number): Ring => star(cx, cy, n, r, starInner(n, k, r), rot);
    return { holes: packed(p, num(p, 'size') + num(p, 'gap'), motif), lines: [], slits: [] };
  },
  web: (p) => num(p, 'gap'),
  thumb: { params: { size: 10, gap: 2 } },
};

/** One motif per cell on a square lattice, or two on a staggered one. */
function packed(p: Params, pitch: number, motif: (cx: number, cy: number) => Ring): Island[] {
  if (bool(p, 'stagger')) {
    const h = pitch * SQRT3;
    return [[motif(pitch / 2, h / 2)], [motif(0, 0)]];
  }
  return [[motif(pitch / 2, pitch / 2)]];
}

// ---- strapwork by polygons in contact --------------------------------------------------------

export const zellige8: PatternDef = {
  id: 'zellige-8',
  name: 'Zellige strapwork (8-fold)',
  family: 'islamic',
  tags: ['lines', 'strapwork', 'star', 'islamic', 'zellige', 'hankin', 'pic'],
  blurb: 'The classic 8-fold strapwork, drawn the way it was drawn: contact angles over a hidden 4.8.8 lattice.',
  ops: ['score', 'engrave'],
  params: [SIZE(6, 2, 50, 'Skeleton edge'), CONTACT(67.5)],
  cell: (p) => {
    const s = truncSquarePitch(num(p, 'size'));
    return { w: s, h: s };
  },
  tile: (p) => pic(truncSquarePolys(num(p, 'size')), num(p, 'contact')),
};

export const rosette12: PatternDef = {
  id: 'rosette-12',
  name: 'Rosette (12-fold)',
  family: 'islamic',
  tags: ['lines', 'strapwork', 'star', 'rosette', 'islamic', 'hankin', 'pic'],
  blurb: 'Twelve-point rosettes over a hidden 3.12.12 lattice, with a three-point star in every gap.',
  ops: ['score', 'engrave'],
  params: [SIZE(4, 1.5, 40, 'Skeleton edge'), CONTACT(75)],
  cell: (p) => {
    const s = truncHexPitch(num(p, 'size'));
    return { w: s, h: s * SQRT3 };
  },
  tile: (p) => pic(truncHexPolys(num(p, 'size')), num(p, 'contact')),
};

export const ISLAMIC: PatternDef[] = [starCross8, khatam6, starPolygon, zellige8, rosette12];

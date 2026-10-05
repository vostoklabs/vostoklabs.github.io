// The Library: blanks (keychains, earrings, tags, coasters) and basic shapes, as parametric
// ring generators — never frozen SVGs, so a blank resizes without breaking its hole.
//
// Default sizes and holes: a 60 × 20 tag with a 4 mm hole 2 mm from the edge, a 2 mm
// jump-ring hole on an earring, and so on. Defaults, not rules.
import type { Ring as CutRing } from '@vostok/shapes';
import { circleRing, roundedRectRing, teardropRing, dogTagRing, signedArea, type Pt, type Box } from './rings';

export type HoleSide = 'none' | 'top' | 'left' | 'right';
export type BlankCategory = 'keychains' | 'earrings' | 'tags' | 'coasters' | 'shapes' | 'attachments' | 'silhouettes';

export interface BlankParams {
  width: number;
  height: number;
  holeDia: number;
  holeSide: HoleSide;
  /** Material between the hole and the edge, mm. */
  holeMargin: number;
  /** Corner radius where the shape has corners. */
  corner: number;
  /** Add a mirrored twin — earrings come in pairs. */
  pair: boolean;
}

export interface BlankDef {
  id: string;
  label: string;
  category: BlankCategory;
  defaults: BlankParams;
  /** The outer ring, centred on the origin. */
  ring(p: BlankParams): CutRing;
  /** Extra holes and slots the shape carries by nature (an annulus, a strap slot). */
  extra?(p: BlankParams): CutRing[];
  /** ADDITIONAL outer rings (positive winding) that `buildBlank` pushes as separate islands —
   *  the ears, leaves, fins and tails welded onto the main `ring`. Each becomes its own
   *  `[ring]` island so the engine's "overlapping outer rings union automatically" rule does
   *  the welding; winding is corrected the same way the main ring's is. */
  extraOuter?(p: BlankParams): CutRing[];
  /** Where the keyring hole goes when `holeSide` is `top`, if not the default. */
  holeAt?(p: BlankParams): Pt | null;
  /** Character marks INSIDE the outline — a whisker, a ball seam, a lit window, laces.
   *  See `DetailSpec`. Absent means the blank carries none. */
  detail?(p: BlankParams): DetailSpec;
  /** Any text this blank might carry sits here, as a fraction of width/height. */
  textBox?: { w: number; h: number; dx: number; dy: number };
  /** What `p.corner` means for this shape's ring, if anything — undefined when the corner
   *  slider is dead for this blank (no corner control should be shown). */
  corner?: 'radius' | 'band';
  /** Which edge of this blank is meant to overlap (weld into) a body shape, for attachments —
   *  the design view uses it to place the piece against a selection's edge. */
  weldNeck?: 'bottom' | 'top' | 'left' | 'right';
}

const base = (o: Partial<BlankParams>): BlankParams => ({
  width: 60,
  height: 20,
  holeDia: 4,
  holeSide: 'left',
  holeMargin: 2,
  corner: 4,
  pair: false,
  ...o,
});

// --------------------------------------------------------------- primitives --

/**
 * A regular polygon that MEASURES `w × h` — the box it is cut inside, whatever its rotation.
 *
 * The vertices sit on an ellipse, and only a shape with a vertex on each axis touches that
 * ellipse's extremes. At the default rotation (a vertex at the top) a hexagon's widest points are
 * 30° off the horizontal, so `(w / 2) · cos 30°` was as far as it reached: the slider said 34 mm
 * and the part cut 29.4 — a 13 % shortfall, baked into the status line and the exported file's own
 * `<desc>`. A triangle was 13 % narrow AND 25 % short, and off-centre with it.
 *
 * So the ring is scaled and centred on its own bounding box here, once, rather than every caller
 * carrying its own `/ 0.866`. Callers that mean a RADIUS (a snowflake's hub, a football's pentagon)
 * pass a diameter and get a shape that fills it, which is what they wanted anyway.
 */
export function polygonRing(w: number, h: number, sides: number, rotate = -Math.PI / 2): CutRing {
  const unit: CutRing = [];
  for (let i = 0; i < sides; i++) {
    const t = rotate + (i / sides) * Math.PI * 2;
    unit.push([Math.cos(t), Math.sin(t)]);
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of unit) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const kx = spanX > 1e-9 ? w / spanX : 0;
  const ky = spanY > 1e-9 ? h / spanY : 0;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return unit.map(([x, y]): Pt => [(x - cx) * kx, (y - cy) * ky]);
}

/**
 * A star, POINT UP — vertex 0 is the outer point at `(0, h/2)`.
 *
 * It started at `-π/2`, which put the point at the BOTTOM and a notch at the top: a star hangs
 * from a point, and every caller that wanted one the right way up had to turn it (the family
 * tree's topper carried a 36° rotation for exactly this). An even-pointed star is unchanged by
 * the flip — 4 points at 90° apart land on the same set either way — so only the odd-pointed
 * ones move, which is the whole of the bug.
 */
export function starRing(w: number, h: number, points = 5, inner = 0.45): CutRing {
  const out: CutRing = [];
  for (let i = 0; i < points * 2; i++) {
    const t = Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const k = i % 2 === 0 ? 1 : inner;
    out.push([(w / 2) * k * Math.cos(t), (h / 2) * k * Math.sin(t)]);
  }
  return out;
}

/**
 * Where a hanging hole goes in a star: inside the TOP POINT, as high as a disc of `r` will sit.
 *
 * The point is a wedge, so the deepest an inscribed circle of radius `r` reaches is `r / sin θ`
 * below the tip, θ being the wedge's own half-angle. Measured off the built ring rather than
 * restated from the angles, so a squashed star or a fatter `inner` still lands the hole on
 * material. A star that came out point-DOWN (as `starRing` used to) had a wide notch at the top
 * and any sensible number worked; a point-up one has 9 mm of material there and it does not.
 */
function starHoleAt(w: number, h: number, points: number, inner: number, r: number): Pt {
  const ring = starRing(w, h, points, inner);
  const tip = ring[0] ?? [0, h / 2];
  const side = ring[1] ?? [w / 2, 0];
  const dx = side[0] - tip[0];
  const dy = side[1] - tip[1];
  const sin = Math.abs(dx) / Math.max(1e-6, Math.hypot(dx, dy));
  return [0, tip[1] - r / Math.max(0.1, sin)];
}

export function ellipseRing(w: number, h: number, n = 72): CutRing {
  return polygonRing(w, h, n, 0);
}

/** A heart, point down: two lobe circles of radius r = w/4 centred at (±r, top), tangent to
 *  each other at the cleft (0, top), plus the two outer tangent lines down to the point
 *  P = (0, -h/2). Walked CCW: P -> right tangent -> right lobe over the top -> cleft ->
 *  left lobe over the top -> left tangent -> back to P. */
export function heartRing(w: number, h: number, n = 48): CutRing {
  const r = w / 4;
  const top = h / 2 - r;
  const P: Pt = [0, -h / 2];
  const Cr: Pt = [r, top];
  const Cl: Pt = [-r, top];
  const cleft: Pt = [0, top];

  // Outer tangent point from P to the right circle: T = C + (r/d^2)(r*u + L*u_perp),
  // where u = P - C, u_perp = (-u.y, u.x), L = sqrt(|u|^2 - r^2).
  const ux = P[0] - Cr[0];
  const uy = P[1] - Cr[1];
  const d2 = ux * ux + uy * uy;
  const L = Math.sqrt(Math.max(0, d2 - r * r));
  const k = r / d2;
  const Tright: Pt = [Cr[0] + k * (r * ux - L * uy), Cr[1] + k * (r * uy + L * ux)];
  const Tleft: Pt = [-Tright[0], Tright[1]];

  const out: CutRing = [P, Tright];
  const arc = (c: Pt, from: number, to: number) => {
    let end = to;
    while (end < from) end += Math.PI * 2;
    for (let i = 1; i <= n; i++) {
      const t = from + ((end - from) * i) / n;
      out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
    }
  };
  const ang = (c: Pt, p: Pt) => Math.atan2(p[1] - c[1], p[0] - c[0]);

  arc(Cr, ang(Cr, Tright), ang(Cr, cleft)); // right lobe, over the top, down to the cleft
  arc(Cl, ang(Cl, cleft), ang(Cl, Tleft)); // left lobe, over the top, down to the tangent
  return out;
}

/** A house: a box with a gable. */
export function houseRing(w: number, h: number): CutRing {
  const roof = h * 0.35;
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2 - roof], [0, h / 2], [-w / 2, h / 2 - roof]];
}

/** A banner: a rectangle with a swallowtail notch on the right. */
export function bannerRing(w: number, h: number): CutRing {
  const notch = h * 0.35;
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2 - notch, 0], [w / 2, h / 2], [-w / 2, h / 2]];
}

/** A dog bone: four corner lobes (radius r = h/4, one per corner) with a narrow waist between
 *  them. At each end the two lobes are sized to be tangent to each other on the centreline, the
 *  same construction as the heart's lobes; the waist is a straight chord between the points
 *  where the shaft (half-height `waist`) meets each lobe's circle. */
export function boneRing(w: number, h: number, n = 40): CutRing {
  const r = h / 4;
  const cx = w / 2 - r;
  const waist = h * 0.2;
  const dx = Math.sqrt(Math.max(0, r * r - (waist - r) * (waist - r)));
  const Cru: Pt = [cx, r];
  const Crl: Pt = [cx, -r];
  const Clu: Pt = [-cx, r];
  const Cll: Pt = [-cx, -r];
  const tipR: Pt = [cx, 0];
  const tipL: Pt = [-cx, 0];
  const ruLeft: Pt = [cx - dx, waist];
  const luRight: Pt = [-cx + dx, waist];
  const llRight: Pt = [-cx + dx, -waist];
  const rlLeft: Pt = [cx - dx, -waist];

  const out: CutRing = [];
  const arc = (c: Pt, from: Pt, to: Pt) => {
    const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
    let a1 = Math.atan2(to[1] - c[1], to[0] - c[0]);
    while (a1 < a0) a1 += Math.PI * 2;
    for (let i = 0; i <= n; i++) {
      const t = a0 + ((a1 - a0) * i) / n;
      out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
    }
  };
  arc(Cru, tipR, ruLeft); // right-upper lobe
  out.push(luRight); // top of the shaft
  arc(Clu, luRight, tipL); // left-upper lobe
  arc(Cll, tipL, llRight); // left-lower lobe
  out.push(rlLeft); // bottom of the shaft
  arc(Crl, rlLeft, tipR); // right-lower lobe
  const ring = dedupe(out);
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) ring.pop(); // closing duplicate
  return ring;
}

/** An arch: a rectangle with a semicircular top. */
export function archRing(w: number, h: number, n = 32): CutRing {
  const r = w / 2;
  const out: CutRing = [[-r, -h / 2], [r, -h / 2]];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI;
    out.push([r * Math.cos(t), h / 2 - r + r * Math.sin(t)]);
  }
  return out;
}

/** A leaf (marquise): two circular arcs meeting at sharp points top and bottom, each arc's
 *  circle chosen so it passes through both tips (0, ±h/2) and bulges to (±w/2, 0). The old
 *  version swept two ellipse-arc halves with matching horizontal tangents at the tips, which is
 *  just a full ellipse (no point) wearing a leaf's name. */
export function leafRing(w: number, h: number, n = 40): CutRing {
  const W = w / 2;
  const H = h / 2;
  const cx = (W * W - H * H) / (2 * W);
  const r = W - cx;
  const th = Math.atan2(H, -cx); // angle of the top tip on the right-hand circle
  const out: CutRing = [];
  for (let i = 0; i <= n; i++) {
    const t = th - (i / n) * (2 * th);
    out.push([cx + r * Math.cos(t), r * Math.sin(t)]);
  }
  for (let i = 1; i < n; i++) {
    const t = -th + (i / n) * (2 * th);
    out.push([-cx - r * Math.cos(t), r * Math.sin(t)]);
  }
  return out;
}

/** A lug: a circle of diameter `w`, sitting on top of a rectangular neck (width `neckFrac * w`)
 *  that extends down to fill the rest of `h`. The neck's top corners are the tangent points
 *  where a chord of the circle equals the neck width — the same tangent construction as the
 *  heart's lobes — so the two pieces meet without a seam or an overlap. */
export function lugRing(w: number, h: number, neckFrac = 0.6, n = 48): CutRing {
  const R = w / 2;
  const Hn = (neckFrac * w) / 2;
  const cy = h / 2 - R;
  const dy = Math.sqrt(Math.max(0, R * R - Hn * Hn));
  const tRight = Math.atan2(-dy, Hn);
  let tLeft = Math.atan2(-dy, -Hn);
  while (tLeft < tRight) tLeft += Math.PI * 2;
  const out: CutRing = [];
  for (let i = 0; i <= n; i++) {
    const t = tRight + ((tLeft - tRight) * i) / n;
    out.push([R * Math.cos(t), cy + R * Math.sin(t)]);
  }
  out.push([-Hn, -h / 2]);
  out.push([Hn, -h / 2]);
  return out;
}

/** A teardrop pointing down: `teardropRing` mirrored so the apex (the neck, welded into a
 *  body) is at the bottom and the round bulb is at the top. */
export function teardropDownRing(w: number, h: number, n = 72): CutRing {
  return teardropRing(w, h, n).map(([x, y]): Pt => [x, -y]).reverse();
}

function dedupe(ring: CutRing): CutRing {
  const out: CutRing = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) out.push(p);
  }
  return out;
}

// ------------------------------------------------------------- silhouettes --
// Parametric constructions for the `silhouettes` category: circles, rounded rects, arcs and
// tangent constructions, to the shaped-name template's spec (carrot, fish, cloud, egg, shield
// share its exact numbers). Never traced.

/** A tapered blade from `anchor` out along `angle` (radians) for `length`, half-width `w0` at
 *  the base narrowing (or widening, for a bow's loop) to a semicircular tip of radius `wt`.
 *  The carrot's leaves, the bow's loops, the leaf's stem all share this one construction. */
function bladeRing(anchor: Pt, angle: number, length: number, w0: number, wt: number, n = 20): CutRing {
  const c = Math.cos(angle), s = Math.sin(angle);
  const px = -s, py = c;
  const at = (t: number): Pt => [anchor[0] + c * t * length, anchor[1] + s * t * length];
  const g = (t: number) => wt + (w0 - wt) * Math.pow(1 - t, 1.1);
  const out: CutRing = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, [x, y] = at(t), w = g(t);
    out.push([x + px * w, y + py * w]);
  }
  const tip = at(1);
  const base = Math.atan2(py, px);
  for (let i = 1; i < n; i++) {
    const a = base - (Math.PI * i) / n;
    out.push([tip[0] + wt * Math.cos(a), tip[1] + wt * Math.sin(a)]);
  }
  for (let i = n; i >= 0; i--) {
    const t = i / n, [x, y] = at(t), w = g(t);
    out.push([x - px * w, y - py * w]);
  }
  return out;
}

/** Rotate `ring` about its own local origin then translate — placing a locally-drawn part
 *  (an ear, a spine, a branch) at `(x, y)` tilted `angleDeg`. */
function placeRing(ring: CutRing, x: number, y: number, angleDeg: number): CutRing {
  const a = (angleDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return ring.map(([px, py]): Pt => [px * c - py * s + x, px * s + py * c + y]);
}

/** A capsule (stadium): `w × h`, fully-round ends, shifted so its base sits at local y = 0 and
 *  it stands upward — the shape `placeRing` anchors ears, snowflake spines and branches by. */
function standingCapsule(w: number, h: number): CutRing {
  return roundedRectRing(w, h, Math.min(w, h) / 2, 12).map(([x, y]): Pt => [x, y + h / 2]);
}

/** The carrot's root: a tangent-arc taper from a nearly flat crown to a rounded tip on the
 *  right.
 *
 *  The crown's cap used to bulge a third of the root's own half-height to the left, which made
 *  the root pointed at BOTH ends — a lens, and with a fan of blades on the left point, a fish.
 *  A carrot is blunt where it was pulled: the cap is now a shallow curve, and the leaves stand
 *  on it rather than on a nose. */
export function carrotRootRing(w: number, h: number, n = 28): CutRing {
  const tipX = w / 2;
  const xs = -0.28 * w;
  const Lr = tipX - xs;
  const R = 0.47 * h;
  const rt = Math.max(1.5, 0.045 * h);
  const as = 0.1 * R;
  const half = (u: number) => rt + (R - rt) * Math.cos((Math.PI * u) / 2);
  const out: CutRing = [];
  for (let i = 0; i <= n; i++) { const u = i / n; out.push([xs + u * (Lr - rt), -half(u)]); }
  for (let i = 1; i < n; i++) { const a = -Math.PI / 2 + (Math.PI * i) / n; out.push([tipX - rt + rt * Math.cos(a), rt * Math.sin(a)]); }
  for (let i = n; i >= 0; i--) { const u = i / n; out.push([xs + u * (Lr - rt), half(u)]); }
  for (let i = 1; i < n; i++) { const phi = Math.PI / 2 - (Math.PI * i) / n; out.push([xs - as * Math.cos(phi), R * Math.sin(phi)]); }
  return dedupe(out);
}

/** One carrot-top lobe: a LEAF, not a wedge. The half-width swells from `0.55·wmax` at the base
 *  (buried in the root) to `wmax` at 42 % of the axis, then tapers to a rounded point.
 *  `bladeRing`'s monotone taper is what made the greens read as three thin stubs.
 *
 *  `bend` bows the axis sideways by that fraction of the lobe's own length at its middle — a
 *  leaf that curves is a leaf, and a straight one at a regular angle is a fin. The perpendicular
 *  is taken from the straight axis, which is exact enough at these bends (under a tenth of a
 *  millimetre of width error at 0.2) and keeps the ring's two sides exactly parallel. */
function leafLobeRing(anchor: Pt, angle: number, length: number, wmax: number, n = 22, bend = 0): CutRing {
  const c = Math.cos(angle), s = Math.sin(angle);
  const px = -s, py = c;
  const tipR = Math.max(0.6, 0.16 * wmax);
  const peak = 0.42, baseFrac = 0.38;
  const bow = (t: number) => bend * length * Math.sin(Math.PI * t) * 0.5;
  const at = (t: number): Pt => [anchor[0] + c * t * length + px * bow(t), anchor[1] + s * t * length + py * bow(t)];
  const g = (t: number) => {
    if (t <= peak) return wmax * (baseFrac + (1 - baseFrac) * Math.sin((Math.PI / 2) * (t / peak)));
    return Math.max(tipR, wmax * Math.pow(Math.cos((Math.PI / 2) * ((t - peak) / (1 - peak))), 0.8));
  };
  const out: CutRing = [];
  for (let i = 0; i <= n; i++) { const t = i / n, [x, y] = at(t), ww = g(t); out.push([x + px * ww, y + py * ww]); }
  const tip = at(1);
  const base = Math.atan2(py, px);
  for (let i = 1; i < n; i++) { const a = base - (Math.PI * i) / n; out.push([tip[0] + tipR * Math.cos(a), tip[1] + tipR * Math.sin(a)]); }
  for (let i = n; i >= 0; i--) { const t = i / n, [x, y] = at(t), ww = g(t); out.push([x - px * ww, y - py * ww]); }
  return dedupe(out);
}

/** The carrot top, as one fan: the crown the leaves grow from, and one entry per leaf. Shared by
 *  `carrotLeaves`, `carrotMidribs` and `carrotHoleAt` so the hole and the ribs cannot drift off
 *  the leaves they belong to.
 *
 *  Four leaves, no two alike, all of them leaning UP and back over the root. Three lobes fanned
 *  symmetrically about the axis — which is what this was — read as a dart's flights or a fish's
 *  tail, not as foliage: a fan with a mirror line is a fin, and greens have no mirror line. So
 *  the angles are irregular (97°–173°), the lengths run 0.62 to 1.0 of the longest, each lobe
 *  bows a little, and the wider leaves are the longer ones. They all overlap near the crown, so
 *  the union is one piece, and separate past about a third of their length.
 *
 *  The crown sits just INSIDE the root's shoulder (its left boundary is `xs − as`), overlapping
 *  it by ~4 mm — not buried deep in the root. Burying it so the tips land on the nominal left
 *  edge leaves only ~16 mm of leaf showing, and 16 mm of overlapping lobes is an arrowhead, not
 *  a carrot top. So the greens run past the nominal box: the root is fixed at `0.28 w` (its own
 *  `textBox` is the name's home) and the leaves have to come from somewhere. */
function carrotGeom(p: BlankParams) {
  const wmax = 0.16 * p.height;
  const tipR = Math.max(0.6, 0.16 * wmax);
  const mid = 0.32 * p.width - tipR;
  const ax = -0.28 * p.width - 0.141 * p.height + Math.max(3, 0.04 * p.width);
  const lobes = [
    // `fx`/`fy` stand each leaf's base on the crown — along the root as a fraction of the longest
    // leaf, up it as a fraction of the root's own half-height. Greens sprout from the TOP of a
    // carrot across its whole crown, not from one point on its axis: a fan of lobes sharing an
    // anchor comes out as a solid spiky mass, and one whose bases sit on the axis pokes out past
    // the crown's own wall and gives the root a chin. `rib0` is where the engraved midrib
    // starts; the hanging hole pushes back whichever ribs would cross it.
    { deg: 141, len: 0.52, bend: -0.14, fx: 0.00, fy: 0.30, rib0: 0.30 },
    { deg: 122, len: 0.74, bend: -0.10, fx: 0.04, fy: 0.46, rib0: 0.30 },
    { deg: 106, len: 1.00, bend: -0.06, fx: 0.09, fy: 0.56, rib0: 0.30 },
    { deg: 86, len: 0.80, bend: 0.10, fx: 0.14, fy: 0.50, rib0: 0.30 },
    { deg: 64, len: 0.58, bend: 0.16, fx: 0.18, fy: 0.38, rib0: 0.30 },
  ].map((l, i) => {
    const length = l.len * mid;
    // A long leaf is a wide leaf; the short upright one is the slenderest of the five. The
    // tallest one carries the hanging hole, so it is never narrower than that hole's own border
    // needs — at a flattened proportion or a small size it would otherwise be a 3.8 mm blade
    // asked to hold a 9 mm hole, and the engine would slide the ring off it onto the lettering.
    const ribbon = wmax * (0.72 + 0.28 * l.len);
    return {
      angle: (l.deg * Math.PI) / 180,
      at: [ax + l.fx * mid, l.fy * 0.47 * p.height] as Pt,
      length,
      bend: l.bend,
      rib0: l.rib0,
      wmax: i === 2 ? Math.max(ribbon, Math.min(0.45 * length, p.holeDia / 2 + p.holeMargin + 0.8)) : ribbon,
    };
  });
  return { A: [ax, 0] as Pt, mid, wmax, tipR, lobes };
}

/** The hole centre: in the CROWN, where every leaf's base and the root's shoulder overlap — by
 *  far the thickest material on the piece, and the point a real carrot tag hangs from. It used
 *  to sit 45 % out along one leaf, which is where that leaf's own midrib now runs. */
function carrotHoleAt(p: BlankParams): Pt {
  const g = carrotGeom(p);
  const l = g.lobes[2]!;
  // 42 % out along the lowest leaf — its own widest point, where it also still overlaps its
  // neighbour — and far enough from the root's shoulder that the hole's border never reaches the
  // lettering's box. That leaf's midrib starts past it (`rib0`).
  const t = 0.42;
  const bow = l.bend * l.length * Math.sin(Math.PI * t) * 0.5;
  return [
    l.at[0] + Math.cos(l.angle) * t * l.length - Math.sin(l.angle) * bow,
    l.at[1] + Math.sin(l.angle) * t * l.length + Math.cos(l.angle) * bow,
  ];
}

/** The carrot's greens. */
export function carrotLeaves(p: BlankParams): CutRing[] {
  const g = carrotGeom(p);
  return g.lobes.map((l) => leafLobeRing(l.at, l.angle, l.length, l.wmax, 22, l.bend));
}

/** One engraved midrib per leaf, from clear of the hanging hole to just short of the tip. The
 *  rib is the one thing a leaf has that a fin does not, and it is what stops the greens reading
 *  as a dart at a glance. Drawn on the bowed axis, so each rib follows its own leaf. */
function carrotMidribs(p: BlankParams): CutRing[] {
  const g = carrotGeom(p);
  const w = markWidth(p);
  const hole = carrotHoleAt(p);
  // Nothing may be engraved inside the hanging hole's own border — the engine reads ink under
  // the ring as a mistake, and it would be right. Every rib starts clear of that disc.
  const keepOff = p.holeDia / 2 + p.holeMargin + w + 0.3;   // the ring's own border, the mark's width, and slack
  return g.lobes.map((l) => {
    const c = Math.cos(l.angle), s = Math.sin(l.angle);
    const px = -s, py = c;
    const on = (t: number): Pt => {
      const bow = l.bend * l.length * Math.sin(Math.PI * t) * 0.5;
      return [l.at[0] + c * t * l.length + px * bow, l.at[1] + s * t * l.length + py * bow];
    };
    // The rib runs from its start to 90 % — short of the rounded tip — and is pushed back until
    // no part of it lies in the hole's border. A neighbour's rib crosses the leaf that carries
    // the hole, so it is the whole run that is tested, not only where it starts; a rib with
    // nothing left to draw is dropped rather than left as a dash beside the ring.
    const run = (t0: number): Pt[] => {
      const out: Pt[] = [];
      for (let i = 0; i <= 12; i++) out.push(on(t0 + (0.9 - t0) * (i / 12)));
      return out;
    };
    let t0 = l.rib0;
    while (0.9 - t0 > 0.16 && run(t0).some((q) => Math.hypot(q[0] - hole[0], q[1] - hole[1]) < keepOff)) t0 += 0.01;
    return 0.9 - t0 > 0.16 ? strokeRing(run(t0), w) : null;
  }).filter((r): r is CutRing => r !== null);
}

/** The fish's body: snout to peduncle, half-height `b(τ)` peaking just behind the head — the
 *  0.78 exponent is what keeps the widest point off-centre, so it reads as a fish, not a lens. */
export function fishBodyRing(w: number, h: number, n = 40): CutRing {
  const Lb = 0.74 * w;
  const x0 = -w / 2;
  const B = 0.42 * h, rn = 0.07 * h;
  const half = (tau: number) => Math.max(rn, B * Math.sin(Math.PI * Math.pow(tau, 0.78)));
  const out: CutRing = [];
  for (let i = 0; i <= n; i++) { const tau = i / n; out.push([x0 + tau * Lb, half(tau)]); }
  for (let i = n; i >= 0; i--) { const tau = i / n; out.push([x0 + tau * Lb, -half(tau)]); }
  return dedupe(out);
}

/** The fish's forked tail and dorsal fin, welded onto the peduncle and the back. */
export function fishExtras(p: BlankParams): CutRing[] {
  const w = p.width, h = p.height;
  const xp = -w / 2 + 0.74 * w;
  const rn = 0.07 * h;
  const overlap = 3;
  const apexX = w / 2 - 0.1 * w;
  const tipY = 0.44 * h;
  const topLobe: CutRing = [[xp - overlap, rn * 0.7], [w / 2, tipY], [apexX, 1]];
  const botLobe: CutRing = [[xp - overlap, -rn * 0.7], [apexX, -1], [w / 2, -tipY]];
  const dorsal: CutRing = [[-0.13 * w, rn], [0.06 * w, rn], [-0.035 * w, rn + 0.09 * h]];
  return [topLobe, botLobe, dorsal];
}

function circleUpperIntersect(c1: Pt, r1: number, c2: Pt, r2: number): Pt {
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1];
  const d = Math.max(1e-6, Math.hypot(dx, dy));
  const a = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const hh = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = c1[0] + (a * dx) / d, my = c1[1] + (a * dy) / d;
  const ox = (-dy / d) * hh, oy = (dx / d) * hh;
  return my + oy >= my - oy ? [mx + ox, my + oy] : [mx - ox, my - oy];
}

/** The cloud's four bump circles, laid out left to right and scaled so the outer two are
 *  tangent to the sides at exactly ±w/2. Shared between
 *  `cloudRing`'s chain and the blank's `holeAt` (which sits in the tallest bump). */
function cloudBumps(w: number, h: number): { cx: number[]; cy: number[]; r: number[]; rectTop: number } {
  const fr = [0.26, 0.33, 0.27, 0.19];
  const r = fr.map((f) => f * h);
  const rectTop = -h / 2 + 0.4 * h;
  const sink = Math.min(3, 0.4 * Math.min(...r));
  const cy = r.map((ri) => rectTop + ri - sink);
  const rawCx = [0];
  for (let i = 1; i < r.length; i++) {
    const overlap = 0.35 * Math.min(r[i - 1]!, r[i]!);
    rawCx.push(rawCx[i - 1]! + r[i - 1]! + r[i]! - overlap);
  }
  const rawSpan = rawCx[rawCx.length - 1]! - rawCx[0]!;
  const targetSpan = w - r[0]! - r[r.length - 1]!;
  const scale = rawSpan > 1e-6 ? targetSpan / rawSpan : 1;
  const cx = rawCx.map((v) => -w / 2 + r[0]! + (v - rawCx[0]!) * scale);
  return { cx, cy, r, rectTop };
}

/** A flat-bottomed cloud: the four bumps above chained by their upper circle-circle
 *  intersections into one polyline, on a rounded-bottom base. */
export function cloudRing(w: number, h: number, n = 14): CutRing {
  const { cx, cy, r, rectTop } = cloudBumps(w, h);
  const centres: Pt[] = cx.map((x, i) => [x, cy[i]!]);
  const pts: Pt[] = [[-w / 2, cy[0]!]];
  for (let i = 0; i < centres.length - 1; i++) pts.push(circleUpperIntersect(centres[i]!, r[i]!, centres[i + 1]!, r[i + 1]!));
  pts.push([w / 2, cy[cy.length - 1]!]);
  const cornerR = Math.min(2, (rectTop + h / 2) / 2);
  const out: CutRing = [];
  out.push([-w / 2, -h / 2 + cornerR]);
  out.push([-w / 2 + cornerR, -h / 2]);
  out.push([w / 2 - cornerR, -h / 2]);
  out.push([w / 2, -h / 2 + cornerR]);
  out.push([w / 2, cy[cy.length - 1]!]);
  for (let i = centres.length - 1; i >= 0; i--) {
    const c = centres[i]!;
    const a0 = Math.atan2(pts[i + 1]![1] - c[1], pts[i + 1]![0] - c[0]);
    let a1 = Math.atan2(pts[i]![1] - c[1], pts[i]![0] - c[0]);
    if (a1 < a0) a1 += Math.PI * 2;
    for (let k = 1; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      out.push([c[0] + r[i]! * Math.cos(a), c[1] + r[i]! * Math.sin(a)]);
    }
  }
  return dedupe(out);
}

/** Inside the tallest bump (index 1, radius 0.33h), near its top. */
function cloudHoleAt(p: BlankParams): Pt {
  const { cx, cy, r } = cloudBumps(p.width, p.height);
  return [cx[1]!, cy[1]! + r[1]! - (p.holeMargin + p.holeDia / 2)];
}

/** An egg: two half-ellipses of the same width, narrower-radius top (0.57h) than bottom
 *  (0.43h) — both tangent to the horizontal at y = 0, so the join has no kink. */
export function eggRing(w: number, h: number, n = 24): CutRing {
  const R = w / 2, top = 0.57 * h, bot = 0.43 * h;
  const out: CutRing = [];
  const quarter = (a0: number, a1: number, b: number, mirror: 1 | -1) => {
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([mirror * R * Math.cos(a), b * Math.sin(a)]); }
  };
  quarter(-Math.PI / 2, 0, bot, 1);
  quarter(0, Math.PI / 2, top, 1);
  quarter(Math.PI / 2, 0, top, -1);
  quarter(0, -Math.PI / 2, bot, -1);
  return dedupe(out);
}

/** The bow's two loops: rounded teardrops (via `bladeRing`, base narrow at the knot end,
 *  bulb wide at the outer tip) pointing in at the centre knot. `bladeRing`'s farthest point is
 *  `length + wt` from its anchor (the tip cap's own radius reaches past the nominal length), so
 *  `length` is the reach MINUS the bulb radius, not the reach itself. */
export function bowLoops(p: BlankParams): CutRing[] {
  const w = p.width, h = p.height;
  const knotHalf = 0.11 * w;
  const neckW = knotHalf * 0.6;
  const anchorX = knotHalf * 0.5;
  const bulbR = 0.32 * h;
  const reach = w / 2 - anchorX;
  const length = Math.max(2, reach - bulbR);
  return [
    bladeRing([-anchorX, 0], Math.PI, length, neckW, bulbR),
    bladeRing([anchorX, 0], 0, length, neckW, bulbR),
  ];
}

export function bowKnotRing(w: number, h: number): CutRing {
  const kw = 0.22 * w;
  return roundedRectRing(kw, h, Math.min(kw, h) * 0.3);
}

/** Round every corner of a polygon by `r` (clamped so a short edge cannot be over-run), arc by
 *  arc along the bisector — the cat's ear, a nose, any drawn-as-a-polygon detail that must not
 *  read as a paper cut-out. Works on reflex corners too (the bisector simply points outward). */
export function roundPolygonRing(ring: CutRing, r: number, seg = 6): CutRing {
  const n = ring.length;
  const len = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const unit = (v: Pt): Pt => { const d = Math.hypot(v[0], v[1]) || 1; return [v[0] / d, v[1] / d]; };
  const out: CutRing = [];
  for (let i = 0; i < n; i++) {
    const p = ring[i]!, a = ring[(i - 1 + n) % n]!, b = ring[(i + 1) % n]!;
    const v1 = unit([a[0] - p[0], a[1] - p[1]]);
    const v2 = unit([b[0] - p[0], b[1] - p[1]]);
    const theta = Math.acos(Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1])));
    if (!(theta > 1e-3 && theta < Math.PI - 1e-3)) { out.push(p); continue; }
    const half = theta / 2;
    const t = Math.min(r / Math.tan(half), 0.48 * len(a, p), 0.48 * len(b, p));
    const rr = t * Math.tan(half);
    const bis = unit([v1[0] + v2[0], v1[1] + v2[1]]);
    const c: Pt = [p[0] + bis[0] * (rr / Math.sin(half)), p[1] + bis[1] * (rr / Math.sin(half))];
    const a0 = Math.atan2(p[1] + v1[1] * t - c[1], p[0] + v1[0] * t - c[0]);
    const a1 = Math.atan2(p[1] + v2[1] * t - c[1], p[0] + v2[0] * t - c[0]);
    let d = a1 - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    for (let k = 0; k <= seg; k++) { const u = a0 + (d * k) / seg; out.push([c[0] + rr * Math.cos(u), c[1] + rr * Math.sin(u)]); }
  }
  return dedupe(out);
}

/** Scale a ring about the origin so its bbox measures `w × h` — how a ROUNDED polygon still
 *  ends up the size it was asked for (rounding a corner always eats into the bbox). */
function fitRingToBox(ring: CutRing, w: number, h: number): CutRing {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const sx = w / Math.max(1e-6, maxX - minX), sy = h / Math.max(1e-6, maxY - minY);
  return ring.map(([x, y]): Pt => [x * sx, y * sy]);
}

/** Two long ears rising from the head, tilted ±12° with rounded tops — the bunny. They are
 *  0.55·h long and 0.22·w wide and their bases sit HIGH in the head (0.55 R up), so roughly
 *  three quarters of each ear stands clear of the skull: an ear sunk to the head's centre is
 *  the stub the first pass shipped. */
export function bunnyEars(p: BlankParams): CutRing[] {
  const w = p.width, h = p.height;
  const headR = 0.5 * w;
  const earH = 0.55 * h, earW = 0.22 * w;
  const baseY = headR * 0.55;
  const dx = headR * 0.4;
  const ear = standingCapsule(earW, earH);
  return [placeRing(ear, -dx, baseY, 12), placeRing(ear, dx, baseY, -12)];
}

/** Two rounded triangles at ±35° from the crown — the cat's ears, now real ears: 0.32·w across
 *  the base, 0.28·h tall, sunk 0.16 R into the head so they weld. The old version drew them
 *  into the head's own polyline with their tips at `max(R, h/2)`, which on the shipped defaults
 *  is the head's own top — two nubs flush with the skull. */
export function catEars(p: BlankParams): CutRing[] {
  const R = 0.5 * p.width;
  const earW = 0.32 * p.width, earH = 0.28 * p.height;
  const tri: CutRing = [[-earW / 2, 0], [earW / 2, 0], [0, earH]];
  const ear = fitRingToBox(roundPolygonRing(tri, Math.min(earW, earH) * 0.16, 6), earW, earH);
  const out: CutRing[] = [];
  for (const s of [1, -1]) {
    const a = ((90 - s * 35) * Math.PI) / 180;
    out.push(placeRing(ear, 0.84 * R * Math.cos(a), 0.84 * R * Math.sin(a), -s * 35));
  }
  return out;
}

/** Two round ears at ±45° on a circular head — the bear. Each ear's centre sits `0.4 r` PAST
 *  the skull, so roughly two thirds of it shows: the old 0.72 R centre buried five sixths of
 *  the ear and left a bump. §2.3 asks for `r = 0.24·w` at a 0.35 r overlap; rendered, that is
 *  a cartoon mouse (the ears reach 1.41× the head's width and stop reading as a bear), so the
 *  ear is 0.22·w and sits 0.25 r deeper — checked by eye, not by arithmetic. */
export function bearEars(p: BlankParams): CutRing[] {
  const R = 0.5 * p.width;
  const earR = 0.17 * p.width;
  const d = R + 0.2 * earR;
  const a1 = Math.PI / 4, a2 = Math.PI - a1;
  return [circleRing(d * Math.cos(a1), d * Math.sin(a1), earR, 32), circleRing(d * Math.cos(a2), d * Math.sin(a2), earR, 32)];
}

/** The dog's head is 0.44 of the blank's WIDTH, not half of it: the ears hang OUTSIDE the skull
 *  at the sides and they, not the head, set the silhouette's width. */
const DOG_HEAD = 0.44;

/**
 * Two drop ears hinged at the temples and flaring out as they fall — the dog of §2.3.
 *
 * DROP ears rather than upright ones, deliberately: the library's cat is already "two triangles
 * on a circle", and an upright dog would be the same silhouette with the triangles rounded off.
 * A floppy ear is the one head shape in this set that nothing else claims, and it is what the
 * blank's own `DOG_HEAD` (a skull narrower than the blank, so the ears set the width) was drawn
 * for in the first place.
 *
 * The previous ear was a capsule `0.8 × width` long parked at `(±0.45 w, −0.2 w)` and barely
 * leaning. Rendered at thumbnail size and full size, it did not read as a dog at all: each ear
 * was almost as tall as the whole skull is wide (0.8 against 0.88), both hung well BELOW the jaw,
 * and because the ear sat below the skull's own widest point there was no notch anywhere along
 * the outline — the result was an arch with two tabs. Every number here comes from fixing that:
 *
 *  - `hinge` is where on the skull the ear's base sits, degrees from the x axis — 45° is the
 *    temple. It is sunk `sink` of the radius in so the union always welds, and putting it up there
 *    is what leaves a rounded CROWN showing between the two ears: the concave notch either side of
 *    that crown is the one line that says "ear" and not "bump". At 55° the ears met over the top
 *    and the head went back to being a dome (rendered, all three).
 *  - `flare` is how far past straight down the ear leans, so the lobe swings clear of the cheek
 *    instead of lying flat along it. 14° is barely an ear; 26° spreads the head to 90 × 73 mm,
 *    wider than any other animal in the set; 20° reads as a floppy ear and keeps the ornament at
 *    90 × 78, in the company of the cat and the bear.
 *  - `length` lands the lobe ON the jaw line rather than under it. The old ear hung past the jaw,
 *    which is what made the whole silhouette an arch.
 */
const DOG_EAR = { hinge: 45, flare: 20, length: 0.62, width: 0.28, sink: 0.14 };

export function dogEars(p: BlankParams): CutRing[] {
  const r = DOG_HEAD * p.width * (1 - DOG_EAR.sink);
  const a = (DOG_EAR.hinge * Math.PI) / 180;
  const base: Pt = [r * Math.cos(a), r * Math.sin(a)];
  // `standingCapsule` points up from its own base, so 180° past that is straight down.
  const ear = standingCapsule(DOG_EAR.width * p.width, DOG_EAR.length * p.width);
  return [
    placeRing(ear, base[0], base[1], 180 + DOG_EAR.flare),
    placeRing(ear, -base[0], base[1], -(180 + DOG_EAR.flare)),
  ];
}

/** The head+ears blanks share one hole rule: just inside the top of the plain head circle
 *  (not the full bbox, which the ears extend past). */
function headTopHoleAt(p: BlankParams): Pt {
  return [0, p.width / 2 - (p.holeMargin + p.holeDia / 2)];
}

/** A tiered Christmas tree: three stacked triangles, each tier stepping outward past where the
 *  tier below has tapered to by that height, topped by a real apex; a trunk under the base. */
export function treeRing(w: number, h: number): CutRing {
  const trunkW = 0.18 * w, trunkH = 0.12 * h;
  const bottomY = -h / 2;
  const trunkTop = bottomY + trunkH;
  const remaining = h / 2 - trunkTop;
  const tierH = remaining / 3.4;
  const ratio = 0.72;
  const taperSlow = 1.7;
  const bw0 = w / 2;
  const ys = [trunkTop, trunkTop + tierH, trunkTop + 2 * tierH];
  const bw = [bw0, bw0 * ratio, bw0 * ratio * ratio];
  const apexY = ys[2]! + tierH * 1.4;
  const right: Pt[] = [[trunkW / 2, bottomY], [trunkW / 2, trunkTop]];
  for (let i = 0; i < 3; i++) {
    right.push([bw[i]!, ys[i]!]);
    const topOfTier = i < 2 ? ys[i + 1]! : apexY;
    const edgeTop = i < 2 ? bw[i]! * (1 - (topOfTier - ys[i]!) / (tierH * taperSlow)) : 0;
    right.push([Math.max(0, edgeTop), topOfTier]);
  }
  const out: CutRing = [[-trunkW / 2, bottomY], ...right];
  for (let i = right.length - 1; i >= 0; i--) out.push([-right[i]![0], right[i]![1]]);
  return dedupe(out);
}

/** A round boss unioned at the tree's apex so a hole there keeps ≥ material around it. */
export function treeApexBoss(p: BlankParams): CutRing[] {
  const r = Math.max(4, p.holeDia / 2 + p.holeMargin + 2.5);
  return [circleRing(0, p.height / 2 - r * 0.3, r, 28)];
}

/** Six 60°-spaced spines, each with two pairs of side branches — a snowflake, entirely as
 *  `extraOuter` rounded rects (`ring` is the hexagonal central plate they all overlap).
 *
 *  The plate is 0.52 R across: a real stellar-plate crystal's centre is about a quarter of its
 *  diameter, and anything much under that is a shape with no middle — a hole punched there has
 *  no material round it, a rim frame has no window, and a design that puts content in the
 *  centre (the names crossword) gets a box a millimetre wide however big the ornament is. */
export function snowflakeHubRing(w: number, h: number): CutRing {
  const R = Math.min(w, h) / 2;
  return polygonRing(0.52 * R, 0.52 * R, 6, 0);
}

export function snowflakeArms(p: BlankParams): CutRing[] {
  const R = Math.min(p.width, p.height) / 2;
  // The spines carry the branches and read as the crystal; they thicken with the plate so the
  // arms stay part of the same object rather than hairs stuck to a hexagon.
  const spineW = 0.11 * R, spineLen = 0.92 * R;
  const branchW = spineW * 0.85;
  const specs = [{ t: 0.42, len: 0.32 * R }, { t: 0.68, len: 0.2 * R }];
  const out: CutRing[] = [];
  for (let k = 0; k < 6; k++) {
    const rot = k * 60;
    out.push(placeRing(standingCapsule(spineW, spineLen), 0, 0, rot));
    for (const b of specs) {
      const [ax, ay] = placeRing([[0, spineLen * b.t]], 0, 0, rot)[0]!;
      out.push(placeRing(standingCapsule(branchW, b.len), ax, ay, rot + 60));
      out.push(placeRing(standingCapsule(branchW, b.len), ax, ay, rot - 60));
    }
  }
  return out;
}

/** A disc with `n` tangent scallops of radius `r` — `R_c = r / sin(π/n)` puts every scallop
 *  exactly tangent to its neighbours. `r` is the
 *  blank's `corner` value here, not a rounding radius — there is no plain edge to round. */
export function scallopDiscRing(r: number, n = 16, seg = 8): CutRing {
  const Rc = r / Math.sin(Math.PI / n);
  const out: CutRing = [];
  for (let k = 0; k < n; k++) {
    const theta = (2 * Math.PI * k) / n;
    const c: Pt = [Rc * Math.cos(theta), Rc * Math.sin(theta)];
    const a0 = theta - Math.PI / n - Math.PI / 2;
    const a1 = theta + Math.PI / n + Math.PI / 2;
    for (let i = 0; i <= seg; i++) { const a = a0 + ((a1 - a0) * i) / seg; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  }
  return dedupe(out);
}

/** A heraldic shield: flat top with rounded shoulders, straight sides, then a circular arc —
 *  tangent to the side, so no kink — down to a rounded point. */
export function shieldRing(w: number, h: number, n = 20): CutRing {
  // Rounding the point costs `rp` of the requested height (the tip sits `rp` above where a
  // sharp point would) — grown back here so the outer bbox still lands on the requested h.
  const hAdj = h + 0.045 * w;
  const halfW = w / 2, topY = hAdj / 2;
  const cr = 0.08 * w;
  const sideY = 0.08 * hAdj;
  const rp = 0.045 * w;
  const pointY = -hAdj / 2 + rp;
  const d = sideY - pointY;
  const Rs = (halfW * halfW + d * d) / w;
  const Cx = (halfW * halfW - d * d) / w;
  const a1 = Math.atan2(pointY - sideY, -Cx);
  const cornerN = Math.max(6, Math.round(n / 3));
  const out: CutRing = [[0, pointY]];
  for (let i = n - 1; i >= 0; i--) { const a = (a1 * i) / n; out.push([Cx + Rs * Math.cos(a), sideY + Rs * Math.sin(a)]); }
  out.push([halfW, sideY]);
  out.push([halfW, topY - cr]);
  for (let i = 1; i <= cornerN; i++) { const a = (Math.PI / 2) * (i / cornerN); out.push([halfW - cr + cr * Math.cos(a), topY - cr + cr * Math.sin(a)]); }
  for (let i = 1; i <= cornerN; i++) { const a = Math.PI / 2 + (Math.PI / 2) * (i / cornerN); out.push([-halfW + cr + cr * Math.cos(a), topY - cr + cr * Math.sin(a)]); }
  out.push([-halfW, sideY]);
  for (let i = 1; i <= n; i++) { const a = (a1 * i) / n; out.push([-(Cx + Rs * Math.cos(a)), sideY + Rs * Math.sin(a)]); }
  return dedupe(out);
}

/** A rectangle with its two top corners clipped at 45° — the classic swing tag. */
export function swingTagRing(w: number, h: number, clip: number): CutRing {
  const hw = w / 2, hh = h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh - clip], [hw - clip, hh], [-hw + clip, hh], [-hw, hh - clip]];
}

/** A ribbon banner: a rectangle with a swallowtail notch cut into BOTH ends, the way a
 *  scroll's tails are drawn. `notch` is how deep each tail's V reaches into the end. */
export function ribbonRing(w: number, h: number, notch = Math.min(0.12 * w, 0.6 * h)): CutRing {
  const hw = w / 2, hh = h / 2;
  return [[-hw, -hh], [hw, -hh], [hw - notch, 0], [hw, hh], [-hw, hh], [-hw + notch, 0]];
}

/** A pennant pointing RIGHT: a flat left edge tapering to a rounded tip — the two sides are
 *  the outer tangents from the left corners to the tip's circle, the same construction as the
 *  heart's lobes. */
export function pennantRing(w: number, h: number, n = 24): CutRing {
  const r = Math.max(0.5, 0.05 * h);
  const C: Pt = [w / 2 - r, 0];
  // Both tangent points from a corner to the tip circle; the bottom edge wants the one below
  // the centreline, the top edge the one above.
  const tangent = (P: Pt, below: boolean): Pt => {
    const ux = P[0] - C[0], uy = P[1] - C[1];
    const d2 = ux * ux + uy * uy;
    const L = Math.sqrt(Math.max(0, d2 - r * r));
    const k = r / d2;
    const a: Pt = [C[0] + k * (r * ux - L * uy), C[1] + k * (r * uy + L * ux)];
    const b: Pt = [C[0] + k * (r * ux + L * uy), C[1] + k * (r * uy - L * ux)];
    return (a[1] < b[1]) === below ? a : b;
  };
  const bottom: Pt = [-w / 2, -h / 2];
  const top: Pt = [-w / 2, h / 2];
  const tb = tangent(bottom, true);
  const tt = tangent(top, false);
  const out: CutRing = [bottom, tb];
  const a0 = Math.atan2(tb[1] - C[1], tb[0] - C[0]);
  let a1 = Math.atan2(tt[1] - C[1], tt[0] - C[0]);
  while (a1 <= a0) a1 += Math.PI * 2;
  for (let i = 1; i < n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]); }
  out.push(tt, top);
  return dedupe(out);
}

// ----------------------------------------------------------------- detail --
// The marks a silhouette carries INSIDE its outline.
// Outline (ears, a chimney, a bauble's cap) is `ring`/`extraOuter` — welded material. Detail is
// what is burned or scored on the face, plus the rare island meant to be cut as a second, light
// piece and glued on.

export interface DetailSpec {
  /** Hairline character marks: a whisker, a basketball seam. */
  score?: CutRing[];
  /** The same marks, burned instead of scored. A blank that offers both channels is offering a
   *  CHOICE — score on a pale wood that carries fine detail, engrave on a dense dark one — and
   *  the consumer runs one of them, never both. */
  engrave?: CutRing[];
  /** Rare: a feature safe to cut clean through (a true see-through window). */
  cut?: CutRing[];
  /** One entry per PIECE meant to be cut separately from light wood and glued on (laces, a
   *  number plate). Every ring in an entry is positively wound and overlaps its neighbours, to
   *  be unioned by the consumer into one piece — it is NOT an outer-ring-plus-holes island. */
  raised?: CutRing[][];
}

/** A blank's detail, or nothing — `detail()` is optional like every other `BlankDef` extra. */
export function blankDetail(def: BlankDef, p: BlankParams): DetailSpec {
  return def.detail?.(p) ?? {};
}

/** How wide a scored or engraved mark is drawn: the 0.3 mm engraving stroke plus slack as a
 *  floor, growing with the piece so a 90 mm ornament's seam is not a hairline. */
function markWidth(p: BlankParams): number {
  return Math.max(0.45, 0.012 * Math.max(p.width, p.height));
}

/** A closed ribbon `width` wide around an open polyline — the ONE way a detail mark is drawn.
 *  Every mark has area (so `engrave` fills it) and an outline (so `score` traces it); an open
 *  polyline would serve only one of the two, and `DetailSpec` offers the same rings to both.
 *  The offset at each interior vertex uses the central difference, which is exact for the arcs
 *  and straight runs every mark here is made of. */
export function strokeRing(path: Pt[], width: number): CutRing {
  const pts = dedupe(path as CutRing);
  const hw = width / 2;
  if (pts.length < 2) return circleRing(pts[0]?.[0] ?? 0, pts[0]?.[1] ?? 0, hw, 12);
  const normals: Pt[] = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const d = Math.hypot(dx, dy) || 1;
    return [-dy / d, dx / d];
  });
  const left = pts.map(([x, y], i): Pt => [x + normals[i]![0] * hw, y + normals[i]![1] * hw]);
  const right = pts.map(([x, y], i): Pt => [x - normals[i]![0] * hw, y - normals[i]![1] * hw]);
  return [...right, ...left.reverse()];
}

/** The seam arc every ball shares (§2.2): the circle through the two poles `(0, ±R)` and the
 *  equator point `(bulge, 0)`. Three real points fix it — `cx = (b² − R²)/2b`, `r = |b − cx|` —
 *  so it is an arc, not a freehand curve. Mirror it in x for the other side. */
export function seamArc(R: number, bulge: number, n = 48): Pt[] {
  const cx = (bulge * bulge - R * R) / (2 * bulge);
  const rad = Math.abs(bulge - cx);
  const a0 = Math.atan2(R, -cx);
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) { const t = a0 - ((2 * a0) * i) / n; out.push([cx + rad * Math.cos(t), rad * Math.sin(t)]); }
  return out;
}

/** Keep only the run of a path inside a circle of radius `rMax` about the origin, clipping the
 *  crossing segments. A seam drawn pole to pole ENDS on the outline; a mark must stay inside
 *  it, or half the ribbon hangs off the edge of the piece. */
function clipPathToCircle(path: Pt[], rMax: number): Pt[] {
  const inside = (q: Pt) => Math.hypot(q[0], q[1]) <= rMax;
  const out: Pt[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (inside(p)) { out.push(p); continue; }
    for (const nb of [path[i - 1], path[i + 1]]) {
      if (!nb || !inside(nb)) continue;
      let a = nb, b = p;
      for (let k = 0; k < 20; k++) {
        const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (inside(m)) a = m; else b = m;
      }
      out.push(a);
    }
  }
  return dedupe(out as CutRing);
}

const mirrorPath = (path: Pt[]): Pt[] => path.map(([x, y]): Pt => [-x, y]);

/** A football's laces as ONE piece: the stripe plus five cross-ties, every tie overlapping the
 *  stripe, so a union welds them into a single island of light wood (§2.2).
 *
 *  Along the ball's LONG axis, which is the only way a football is laced
 *  (as on a real football): the spine runs in x across half the width and the
 *  ties step along it. Drawn across the short axis — what this was — the ladder read as a zip up
 *  the ball's belly and every template that used it had to turn the set 90° itself. */
export function footballLaces(p: BlankParams): CutRing[] {
  const w = p.width, h = p.height;
  const span = 0.5 * w;
  const tieW = 0.022 * h;
  const out: CutRing[] = [roundedRectRing(span, 0.06 * h, 0.03 * h, 8)];
  for (let i = 0; i < 5; i++) {
    const x = -span / 2 + (span * (i + 0.5)) / 5;
    out.push(roundedRectRing(tieW, 0.16 * h, Math.min(0.011 * h, tieW / 2), 6).map(([xx, y]): Pt => [xx + x, y]));
  }
  return out;
}

/** Two straight diameters at right angles plus two mirrored arcs bulging to 0.55 R — the
 *  basketball (§2.2). Upright by default: one seam down, one across, an arc either side, which is
 *  what a basketball looks like in a photograph (as on a real basketball).
 *
 *  The CROSS seam is the one a basketball is recognised by. With only the pole-to-pole line and
 *  the two arcs — every one of them running the same way — the ball read as "a ball with curved
 *  seams", closer to a beachball than a basketball (review finding 9); the second diameter is the
 *  horizontal seam that crosses them.
 *
 *  `turn` swings the whole set, degrees CCW, for a design whose own hole sits at a pole: the seams
 *  converge there, so drawn upright the straight seam runs down through such a hole. 32° is the
 *  angle that clears both it and the arcs' tangent points (the clearance is worst around 17° and
 *  only passes again past 30°) — and it is a dodge, not a look: at 32° the seams read as an X, so
 *  a design that punches no hole at the pole leaves this at 0. */
export function basketballSeams(p: BlankParams, turn = 0): CutRing[] {
  const R = Math.min(p.width, p.height) / 2;
  const mw = markWidth(p);
  const lim = R - mw / 2 - 0.8;
  const arc = clipPathToCircle(seamArc(R, 0.55 * R), lim);
  const paths: Pt[][] = [[[0, lim], [0, -lim]], [[-lim, 0], [lim, 0]], arc, mirrorPath(arc)];
  return paths.map((path) => strokeRing(turn ? placeRing(path, 0, 0, turn) : path, mw));
}

/** A filled centre pentagon with a seam radiating from each vertex — the simplified football
 *  (soccer) pictogram of §2.2, not the full truncated-icosahedron tiling. */
export function soccerSeams(p: BlankParams): CutRing[] {
  const R = Math.min(p.width, p.height) / 2;
  const mw = markWidth(p);
  // §2.2 writes the pentagon as `polygonRing(0.35R, 0.35R, 5)`, whose arguments are a width and
  // a height — that is a pentagon of radius 0.175 R, a 5 mm dot on a 55 mm ball. Read as the
  // radius it plainly means, it is 0.35 R. Point DOWN (the generator's own default rotation),
  // so no seam runs up into the hanging hole.
  const pentR = 0.35 * R;
  const out: CutRing[] = [polygonRing(2 * pentR, 2 * pentR, 5)];
  for (let i = 0; i < 5; i++) {
    const t = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    out.push(strokeRing([[pentR * Math.cos(t), pentR * Math.sin(t)], [0.78 * R * Math.cos(t), 0.78 * R * Math.sin(t)]], mw));
  }
  return out;
}

/** How deep a baseball's seam sags toward the centre, as a share of R, and how far above the
 *  equator it crosses the ball — as on a real baseball, where the
 *  arc's belly sits at 0.39 R and its ends leave the rim about 38° up from the horizontal. */
const BASEBALL_DIP = 0.4;
const BASEBALL_SPREAD = 38;

/** One baseball seam: the circular arc through the two rim points at ±`BASEBALL_SPREAD` above the
 *  equator and the sag point `BASEBALL_DIP × R` over the centre. Three real points fix the circle
 *  — centre `(0, cy)` with `cy = (R² − yMid²) / 2(yEnd − yMid)` — so it is an arc, not a freehand
 *  curve, the same construction `seamArc` uses pole to pole. */
function baseballArc(R: number, n = 80): Pt[] {
  const a = (BASEBALL_SPREAD * Math.PI) / 180;
  const xEnd = R * Math.cos(a), yEnd = R * Math.sin(a), yMid = BASEBALL_DIP * R;
  const cy = (R * R - yMid * yMid) / (2 * (yEnd - yMid));
  const rad = cy - yMid;
  const t0 = Math.atan2(yEnd - cy, -xEnd);
  const t1 = Math.atan2(yEnd - cy, xEnd);
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) { const t = t0 + ((t1 - t0) * i) / n; out.push([rad * Math.cos(t), cy + rad * Math.sin(t)]); }
  return out;
}

/** Two facing C-curves with a stitch tie every 0.12 R of arc length — the baseball.
 *
 *  Drawn pole to pole (what this was, `seamArc` twice) the two arcs MEET and cross at both poles:
 *  the ball read as a pointed oval with an X at each end, not as a baseball. A real baseball's
 *  seams stop well short of the poles and sag toward each other — one over the name and one under
 *  it, which is also the arrangement every reference tag uses. The ends are pulled inside the
 *  outline by the stitch's own reach, so no tie hangs off the edge of the piece. */
export function baseballSeams(p: BlankParams): CutRing[] {
  const R = Math.min(p.width, p.height) / 2;
  const mw = markWidth(p);
  const tie = 0.055 * R;
  const lim = R - mw / 2 - 0.8 - tie;
  const arc = clipPathToCircle(baseballArc(R), lim);
  const out: CutRing[] = [];
  for (const path of [arc, arc.map(([x, y]): Pt => [x, -y])]) {
    out.push(strokeRing(path, mw));
    let run = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!;
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      run += seg;
      if (run < 0.12 * R) continue;
      run = 0;
      // Square across the seam it crosses, which is how a stitch is sewn — the normal of the
      // segment the walk is on, never a fixed direction.
      const nx = -(b[1] - a[1]) / (seg || 1), ny = (b[0] - a[0]) / (seg || 1);
      out.push(strokeRing([[b[0] - nx * tie, b[1] - ny * tie], [b[0] + nx * tie, b[1] + ny * tie]], mw));
    }
  }
  return out;
}

/** One closed wave seam, `r(θ) = base + amp·sin(2θ + φ)`, two periods round the ball — the
 *  tennis ball (§2.2). Drawn as two half ribbons meeting end to end, because a ribbon around a
 *  CLOSED path is an annulus and `DetailSpec` rings carry no holes. `base` is pulled in from
 *  0.94 R so the crests stay inside the outline instead of 4 % past it. */
export function tennisSeam(p: BlankParams): CutRing[] {
  const R = Math.min(p.width, p.height) / 2;
  const mw = markWidth(p);
  // §2.2's 0.10 R amplitude renders as a slightly squashed circle — a ring drawn inside a
  // circle, not a seam. 0.22 R is where the crests and troughs read as the ball's two panels.
  const amp = 0.22 * R;
  const base = R - mw / 2 - 0.8 - amp;
  const phi = Math.PI / 4;
  const half = (from: number): Pt[] => {
    const pts: Pt[] = [];
    for (let i = 0; i <= 48; i++) {
      const th = from + (Math.PI * i) / 48;
      const r = base + amp * Math.sin(2 * th + phi);
      pts.push([r * Math.cos(th), r * Math.sin(th)]);
    }
    return pts;
  };
  return [strokeRing(half(0), mw), strokeRing(half(Math.PI), mw)];
}

/** A house with eaves: the gable's base points widen past the wall line so the roof overhangs
 *  (§2.4). The EAVES take the full `w` and the wall sits `0.03 w` in from each side, so the
 *  blank still measures exactly the width it was asked for. */
export function houseChimneyRing(w: number, h: number): CutRing {
  const eaveY = h / 2 - h * 0.35;
  const hw = w / 2, wall = hw - 0.03 * w;
  return [[-wall, -h / 2], [wall, -h / 2], [wall, eaveY], [hw, eaveY], [0, h / 2], [-hw, eaveY], [-wall, eaveY]];
}

/** The apex boss's radius: enough material round the hanging hole that a 3 mm hole keeps its
 *  margin at the one point of a gable that has none — the tree's trick (§1.5). */
function houseBossR(p: BlankParams): number {
  return Math.max(4, p.holeDia / 2 + p.holeMargin + 1);
}

/** The chimney (real, welded material — it carries the year on its own face) and the peak boss.
 *  The chimney's lower half is buried in the roof slope, so the union leaves it standing on the
 *  roof rather than floating beside it. */
export function houseChimneyExtras(p: BlankParams): CutRing[] {
  const w = p.width, h = p.height;
  const r = houseBossR(p);
  return [
    roundedRectRing(0.14 * w, 0.3 * h, 0.02 * w, 6).map(([x, y]): Pt => [x + 0.28 * w, y + 0.3 * h]),
    circleRing(0, h / 2 - r, r, 28),
  ];
}

/** One door low centre and two windows either side, engraved on the wall (§2.4). The door stops
 *  0.02 h short of the base: an engrave that runs into the cut edge chars it.
 *
 *  The windows sit at `0.31 w`, not the chimney's own `0.28 w`. 0.28 is where a window centres in
 *  the wall panel beside the door, so the two landing on one line was arithmetic rather than
 *  composition — the right-hand window stood exactly under the chimney. Rendered at both, the
 *  wider pair also simply spaces a facade better: door, air, window, air, eave. */
export function houseDoorWindows(p: BlankParams): CutRing[] {
  const w = p.width, h = p.height;
  const win = (s: number) => roundedRectRing(0.14 * w, 0.14 * w, 0.01 * w, 6).map(([x, y]): Pt => [x + s * 0.31 * w, y - 0.22 * h]);
  return [
    roundedRectRing(0.16 * w, 0.32 * h, 0.02 * w, 6).map(([x, y]): Pt => [x, y - 0.32 * h]),
    win(1),
    win(-1),
  ];
}

/** The bauble's measurements. The height budget is `R` below the ball's centre, `0.9367 R` up
 *  to where the cap leaves the ball, the cap, then the loop — so the ball's radius follows from
 *  whichever of `width`/`height` binds, and the outline never overruns the box it was given. */
function baubleGeom(p: BlankParams) {
  // The wall left round the hole: at least 2.2 mm whatever is asked for, and as much more as is
  // asked for. It used to be capped at 4, which made the loop a fixed size the moment a design
  // threaded a real hole into it — a 3 mm ribbon and an 8 mm cord got the same cap, and the
  // engine then slid the bigger hole off the loop and onto the ball's shoulder to find its own
  // border (christmas-ornament review finding 3).
  const loopR = p.holeDia / 2 + Math.max(2.2, p.holeMargin);
  const R = Math.max(4, Math.min(p.width / 2, (p.height - 1.55 * loopR) / 2.2167));
  const capTopHalf = Math.max(0.18 * R, 0.835 * loopR + 0.5);
  const capBaseHalf = Math.min(0.92 * R, Math.max(0.35 * R, capTopHalf + 0.6));
  const yB = Math.sqrt(Math.max(1e-6, R * R - capBaseHalf * capBaseHalf));
  const crownY = yB + 0.28 * R;
  const loopCy = crownY + 0.55 * loopR;
  return { R, loopR, capTopHalf, capBaseHalf, yB, crownY, loopCy, shift: -(loopCy + loopR - R) / 2 };
}

/** The single arc that blends the cap's side off the ball: it starts at `B` in the ball's OWN
 *  tangent direction and ends at the crown corner `C`, so there is no step at the joint — the
 *  step is what makes a cheap laser bauble read as "a circle with a rectangle glued on".
 *  Centre `B + s·n̂`, `s = |C−B|² / 2(C−B)·n̂`. */
function tangentBlend(B: Pt, C: Pt, tangent: Pt, n = 14): Pt[] {
  const nx = -tangent[1], ny = tangent[0];
  const dx = C[0] - B[0], dy = C[1] - B[1];
  const denom = 2 * (dx * nx + dy * ny);
  if (Math.abs(denom) < 1e-9) return [B, C];
  const s = (dx * dx + dy * dy) / denom;
  const c: Pt = [B[0] + nx * s, B[1] + ny * s];
  const rad = Math.abs(s);
  const a0 = Math.atan2(B[1] - c[1], B[0] - c[0]);
  const a1 = Math.atan2(C[1] - c[1], C[0] - c[0]);
  let d = a1 - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) { const t = a0 + (d * i) / n; out.push([c[0] + rad * Math.cos(t), c[1] + rad * Math.sin(t)]); }
  return out;
}

/** The bauble: ball, tapered cap and hanger loop as ONE outline. The loop's inner hole IS the
 *  blank's keyring hole, so `holeAt` returns the loop's centre and no `extra` ring is needed;
 *  the wall left round it is 2.2–4 mm, never the 1.2 mm the sourced 0.10 R / 0.06 R annulus
 *  would leave on a 3 mm hook. */
export function baubleRing(p: BlankParams, n = 96): CutRing {
  const g = baubleGeom(p);
  const B: Pt = [g.capBaseHalf, g.yB];
  const C: Pt = [g.capTopHalf, g.crownY];
  const tangent: Pt = [-g.yB / g.R, g.capBaseHalf / g.R];
  const blend = tangentBlend(B, C, tangent);
  const xi = Math.sqrt(Math.max(0, g.loopR * g.loopR - (g.crownY - g.loopCy) * (g.crownY - g.loopCy)));
  const out: CutRing = [...blend, [xi, g.crownY]];
  const a0 = Math.atan2(g.crownY - g.loopCy, xi);
  const a1 = Math.PI - a0;
  for (let i = 0; i <= 40; i++) {
    const t = a0 + ((a1 - a0) * i) / 40;
    out.push([g.loopR * Math.cos(t), g.loopCy + g.loopR * Math.sin(t)]);
  }
  out.push([-xi, g.crownY]);
  for (let i = blend.length - 1; i >= 0; i--) out.push([-blend[i]![0], blend[i]![1]]);
  const aB = Math.atan2(g.yB, g.capBaseHalf);
  const from = Math.PI - aB;
  const sweep = Math.PI * 2 - (Math.PI - 2 * aB);
  for (let i = 1; i < n; i++) {
    const t = from + (sweep * i) / n;
    out.push([g.R * Math.cos(t), g.R * Math.sin(t)]);
  }
  return dedupe(out).map(([x, y]): Pt => [x, y + g.shift]);
}

/** Two stripes at a fixed latitude either side of the ball's equator, each held 2 mm off the
 *  outline — the bauble's band (§2.5). */
export function baubleStripes(p: BlankParams): CutRing[] {
  const g = baubleGeom(p);
  const t = Math.max(1.6, 0.075 * g.R);
  return [1, -1].map((s) => {
    const yc = s * 0.42 * g.R;
    const half = Math.sqrt(Math.max(1, g.R * g.R - (Math.abs(yc) + t / 2) ** 2)) - 2;
    return roundedRectRing(2 * half, t, t / 2, 6).map(([x, y]): Pt => [x, y + yc + g.shift]);
  });
}

/** §2.3's face marks: a rounded-triangle nose pointing down just above centre, then either
 *  three whiskers a side fanning out to `±0.40 W`, or a muzzle arc under the nose. */
export function faceMarks(p: BlankParams, kind: 'whiskers' | 'muzzle'): CutRing[] {
  const w = p.width, h = p.height;
  const mw = markWidth(p);
  const noseW = 0.08 * w, noseH = 0.75 * noseW, ny = 0.02 * h;
  const tri: CutRing = [[-noseW / 2, ny + noseH / 2], [noseW / 2, ny + noseH / 2], [0, ny - noseH / 2]];
  const out: CutRing[] = [roundPolygonRing(tri, noseW * 0.2, 5)];
  const y0 = ny - noseH * 0.2;
  if (kind === 'whiskers') {
    for (const s of [1, -1]) {
      for (const dy of [0.05, 0, -0.05]) out.push(strokeRing([[s * noseW * 0.75, y0], [s * 0.4 * w, y0 + dy * h]], mw));
    }
  } else {
    const r = 0.2 * w, cy = ny - noseH / 2 - r * 0.3;
    const arc: Pt[] = [];
    for (let i = 0; i <= 24; i++) { const a = Math.PI * (1.15 + (0.7 * i) / 24); arc.push([r * Math.cos(a), cy + r * Math.sin(a)]); }
    out.push(strokeRing(arc, mw));
  }
  return out;
}

/**
 * The strap slot of a luggage tag, as a hole: a stadium at ONE END of the tag, its long axis
 * parallel to the short edge it sits behind.
 *
 * Every one of these numbers was wrong before:
 *  - **Length** ≈ 50 % of the edge the slot runs along, so a strap sized for the tag gets a slot
 *    sized for the tag. It used to come from the HEIGHT whatever the tag's shape, which made a
 *    160 × 25 mm tag wear a 15 mm nub.
 *  - **Width** 5.5 mm — a folded 12–15 mm webbing or leather strap doubles through it. It was 4.
 *  - **Setback** of the slot's centre from the near edge 12–15 mm. "This margin, not the slot
 *    itself, is what determines strap tear-out resistance"; it was a constant 4 mm, a third of the
 *    minimum, and the tag tears there on a carousel. Never more than a quarter of the tag, so a
 *    small one does not wear its slot in the middle, and never less than 4 mm of web.
 *  - **At one end**, not on the centreline: the centred slot is the textbook generic-luggage-tag
 *    tell, and a slot at the end leaves the face as one clear column for the name.
 *
 * The length also gives way to the corner radius, so a pill-cornered tag cannot have its slot
 * severed from the body by its own outline.
 */
export function luggageSlotRing(p: BlankParams): CutRing {
  const long = Math.max(p.width, p.height);
  const short = Math.min(p.width, p.height);
  // The slot lies across the short edge, at one end of the long one: on a wide tag that is the
  // left edge and the slot stands upright; on a tall one it is the top and the slot lies flat.
  const upright = p.width >= p.height;
  const slotW = 5.5;
  const len = Math.max(16, Math.min(0.5 * short, short - 2 * p.corner - 8));
  const setback = Math.max(slotW / 2 + 4, Math.min(Math.max(13, p.corner + slotW / 2 + 4), 0.25 * long));
  const ring = upright ? roundedRectRing(slotW, len, slotW / 2) : roundedRectRing(len, slotW, slotW / 2);
  const dx = upright ? -p.width / 2 + setback : 0;
  const dy = upright ? 0 : p.height / 2 - setback;
  return ring.map(([x, y]): Pt => [x + dx, y + dy]).reverse();
}

// ------------------------------------------------------------------ library --

export const BLANKS: BlankDef[] = [
  // Keychains
  { id: 'tag', label: 'Rounded tag', category: 'keychains', defaults: base({}), corner: 'radius', ring: (p) => roundedRectRing(p.width, p.height, p.corner) },
  { id: 'bar', label: 'Bar', category: 'keychains', defaults: base({ width: 75, height: 15, corner: 7.5 }), corner: 'radius', ring: (p) => roundedRectRing(p.width, p.height, p.corner) },
  { id: 'dogtag', label: 'Dog tag', category: 'keychains', defaults: base({ width: 50, height: 28, holeMargin: 2.5 }), ring: (p) => dogTagRing(p.width, p.height) },
  { id: 'round', label: 'Round tag', category: 'keychains', defaults: base({ width: 35, height: 35, holeSide: 'top', holeMargin: 3 }), ring: (p) => circleRing(0, 0, Math.min(p.width, p.height) / 2, 72) },
  { id: 'house', label: 'House', category: 'keychains', defaults: base({ width: 40, height: 46, holeSide: 'top', holeMargin: 3 }), ring: (p) => houseRing(p.width, p.height) },
  {
    id: 'heart',
    label: 'Heart',
    category: 'keychains',
    defaults: base({ width: 44, height: 40, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => heartRing(p.width, p.height),
    // Inside the left lobe, near its top, shifted up but kept at least holeMargin off the outline.
    holeAt: (p) => {
      const r = p.width / 4;
      const top = p.height / 2 - r;
      const shift = Math.max(0, r - p.holeDia / 2 - p.holeMargin) * 0.4;
      return [-r, top + shift];
    },
  },
  // "Hexagon tag", not "Hexagon": the plain hexagon lives on the Shapes shelf under that name,
  // and a picker offering both shelves showed the same word twice with no way to tell them apart.
  { id: 'hexagon', label: 'Hexagon tag', category: 'keychains', defaults: base({ width: 44, height: 40, holeSide: 'top', holeMargin: 3 }), ring: (p) => polygonRing(p.width, p.height, 6) },
  { id: 'banner', label: 'Banner', category: 'keychains', defaults: base({ width: 65, height: 24 }), ring: (p) => bannerRing(p.width, p.height) },
  { id: 'teardrop', label: 'Teardrop', category: 'keychains', defaults: base({ width: 32, height: 50, holeSide: 'top', holeMargin: 2.5 }), ring: (p) => teardropRing(p.width, p.height), holeAt: (p) => [0, p.height / 2 - (p.holeMargin + p.holeDia / 2) * 2.5] },
  {
    id: 'hoop',
    label: 'Hoop',
    category: 'keychains',
    defaults: base({ width: 45, height: 45, holeSide: 'none', corner: 8 }),
    corner: 'band',
    ring: (p) => circleRing(0, 0, Math.min(p.width, p.height) / 2, 128),
    // The band is the corner value here: an 8 mm ring around an open centre.
    extra: (p) => [circleRing(0, 0, Math.max(2, Math.min(p.width, p.height) / 2 - p.corner), 128).reverse()],
  },
  // Earrings (1.5 mm stock, 2 mm jump-ring holes)
  { id: 'ear-teardrop', label: 'Teardrop', category: 'earrings', defaults: base({ width: 25, height: 40, holeDia: 2, holeSide: 'top', holeMargin: 2, pair: true }), ring: (p) => teardropRing(p.width, p.height), holeAt: (p) => [0, p.height / 2 - (p.holeMargin + p.holeDia / 2) * 2.5] },
  { id: 'ear-arch', label: 'Arch', category: 'earrings', defaults: base({ width: 22, height: 36, holeDia: 2, holeSide: 'top', holeMargin: 2, pair: true }), ring: (p) => archRing(p.width, p.height) },
  { id: 'ear-leaf', label: 'Leaf', category: 'earrings', defaults: base({ width: 20, height: 42, holeDia: 2, holeSide: 'top', holeMargin: 2.5, pair: true }), ring: (p) => leafRing(p.width, p.height), holeAt: (p) => [0, p.height / 2 - (p.holeMargin + p.holeDia / 2) * 2.2] },
  { id: 'ear-round', label: 'Disc', category: 'earrings', defaults: base({ width: 24, height: 24, holeDia: 2, holeSide: 'top', holeMargin: 2, pair: true }), ring: (p) => circleRing(0, 0, Math.min(p.width, p.height) / 2, 72) },
  {
    id: 'ear-hoop',
    label: 'Hoop',
    category: 'earrings',
    defaults: base({ width: 30, height: 30, holeDia: 2, holeSide: 'top', holeMargin: 1.5, corner: 6, pair: true }),
    corner: 'band',
    ring: (p) => circleRing(0, 0, Math.min(p.width, p.height) / 2, 96),
    extra: (p) => [circleRing(0, 0, Math.max(2, Math.min(p.width, p.height) / 2 - p.corner), 96).reverse()],
  },
  // Tags
  {
    id: 'bone',
    label: 'Pet bone',
    category: 'tags',
    defaults: base({ width: 45, height: 26, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => boneRing(p.width, p.height),
    // Inside the upper-left lobe, near its top, shifted up but kept off the outline by the margin.
    holeAt: (p) => {
      const r = p.height / 4;
      const cx = p.width / 2 - r;
      const shift = Math.max(0, r - p.holeDia / 2 - p.holeMargin) * 0.4;
      return [-cx, r + shift];
    },
  },
  { id: 'bookmark', label: 'Bookmark', category: 'tags', defaults: base({ width: 50, height: 150, holeSide: 'top', holeMargin: 4, corner: 4 }), corner: 'radius', ring: (p) => roundedRectRing(p.width, p.height, p.corner) },
  {
    id: 'luggage',
    label: 'Luggage tag',
    category: 'tags',
    defaults: base({ width: 100, height: 55, holeSide: 'none', corner: 8 }),
    corner: 'radius',
    ring: (p) => roundedRectRing(p.width, p.height, p.corner),
    extra: (p) => [luggageSlotRing(p)],
  },
  { id: 'ornament', label: 'Ornament', category: 'tags', defaults: base({ width: 90, height: 90, holeDia: 3, holeSide: 'top', holeMargin: 3 }), ring: (p) => circleRing(0, 0, Math.min(p.width, p.height) / 2, 128) },
  {
    id: 'ornament-star',
    label: 'Star ornament',
    category: 'tags',
    defaults: base({ width: 80, height: 80, holeDia: 3, holeSide: 'top', holeMargin: 3 }),
    ring: (p) => starRing(p.width, p.height, 5, 0.5),
    // The top IS the point now that `starRing` is the right way up, so the hole hangs inside it.
    // It used to sit under the NOTCH the old point-down star had at the top.
    holeAt: (p) => starHoleAt(p.width, p.height, 5, 0.5, p.holeMargin + p.holeDia / 2),
  },
  // Coasters
  { id: 'coaster-round', label: 'Round coaster', category: 'coasters', defaults: base({ width: 100, height: 100, holeSide: 'none' }), ring: (p) => circleRing(0, 0, Math.min(p.width, p.height) / 2, 128) },
  { id: 'coaster-square', label: 'Square coaster', category: 'coasters', defaults: base({ width: 95, height: 95, holeSide: 'none', corner: 8 }), corner: 'radius', ring: (p) => roundedRectRing(p.width, p.height, p.corner) },
  { id: 'coaster-hex', label: 'Hex coaster', category: 'coasters', defaults: base({ width: 100, height: 88, holeSide: 'none' }), ring: (p) => polygonRing(p.width, p.height, 6, 0) },
  { id: 'plaque', label: 'Plaque', category: 'coasters', defaults: base({ width: 200, height: 80, holeSide: 'none', corner: 6 }), corner: 'radius', ring: (p) => roundedRectRing(p.width, p.height, p.corner) },
  // Basic shapes
  { id: 'rect', label: 'Rectangle', category: 'shapes', defaults: base({ width: 40, height: 30, holeSide: 'none', corner: 0 }), corner: 'radius', ring: (p) => roundedRectRing(p.width, p.height, p.corner) },
  { id: 'rounded', label: 'Rounded rectangle', category: 'shapes', defaults: base({ width: 40, height: 30, holeSide: 'none', corner: 6 }), corner: 'radius', ring: (p) => roundedRectRing(p.width, p.height, p.corner) },
  { id: 'circle', label: 'Circle', category: 'shapes', defaults: base({ width: 30, height: 30, holeSide: 'none' }), ring: (p) => circleRing(0, 0, Math.min(p.width, p.height) / 2, 96) },
  { id: 'ellipse', label: 'Ellipse', category: 'shapes', defaults: base({ width: 40, height: 26, holeSide: 'none' }), ring: (p) => ellipseRing(p.width, p.height) },
  { id: 'triangle', label: 'Triangle', category: 'shapes', defaults: base({ width: 34, height: 30, holeSide: 'none' }), ring: (p) => polygonRing(p.width, p.height, 3) },
  { id: 'hex', label: 'Hexagon', category: 'shapes', defaults: base({ width: 34, height: 30, holeSide: 'none' }), ring: (p) => polygonRing(p.width, p.height, 6, 0) },
  {
    id: 'star', label: 'Star', category: 'shapes', defaults: base({ width: 34, height: 34, holeSide: 'none' }),
    ring: (p) => starRing(p.width, p.height),
    // A point-up star has no material at the very top: a hole hung from "top-centre" punches the
    // tip off. The resting place is inside that point instead, as high as its own wedge allows.
    holeAt: (p) => starHoleAt(p.width, p.height, 5, 0.45, p.holeMargin + p.holeDia / 2),
  },
  { id: 'heart-shape', label: 'Heart', category: 'shapes', defaults: base({ width: 34, height: 30, holeSide: 'none' }), ring: (p) => heartRing(p.width, p.height) },
  {
    id: 'ring',
    label: 'Ring',
    category: 'shapes',
    defaults: base({ width: 34, height: 34, holeSide: 'none', corner: 5 }),
    corner: 'band',
    ring: (p) => circleRing(0, 0, Math.min(p.width, p.height) / 2, 96),
    extra: (p) => [circleRing(0, 0, Math.max(1, Math.min(p.width, p.height) / 2 - p.corner), 96).reverse()],
  },
  // Attachments (weld onto a shape: a keyring point plus a neck the body absorbs)
  {
    id: 'att-keyring-tab',
    label: 'Keyring tab',
    category: 'attachments',
    defaults: base({ width: 12, height: 16, holeDia: 4, holeSide: 'top', holeMargin: 2, corner: 4, pair: false }),
    ring: (p) => lugRing(p.width, p.height),
    holeAt: (p) => [0, p.height / 2 - p.width / 2],
    weldNeck: 'bottom',
  },
  {
    id: 'att-hanging-loop',
    label: 'Hanging loop',
    category: 'attachments',
    defaults: base({ width: 14, height: 16, holeSide: 'none', holeMargin: 2, corner: 2.5, pair: false }),
    corner: 'band',
    ring: (p) => archRing(p.width, p.height),
    extra: (p) => [archRing(Math.max(2, p.width - 2 * p.corner), Math.max(2, p.height - 2 * p.corner)).reverse()],
    weldNeck: 'bottom',
  },
  {
    id: 'att-bar-tab',
    label: 'Bar tab',
    category: 'attachments',
    defaults: base({ width: 22, height: 8, holeDia: 3, holeSide: 'left', holeMargin: 2, corner: 4, pair: false }),
    ring: (p) => roundedRectRing(p.width, p.height, p.height / 2),
    weldNeck: 'right',
  },
  {
    id: 'att-jump-ring-lug',
    label: 'Jump-ring lug',
    category: 'attachments',
    defaults: base({ width: 8, height: 11, holeDia: 2, holeSide: 'top', holeMargin: 2, corner: 4, pair: false }),
    ring: (p) => teardropDownRing(p.width, p.height),
    weldNeck: 'bottom',
  },
  {
    id: 'att-frame-square',
    label: 'Square frame',
    category: 'attachments',
    defaults: base({ width: 50, height: 50, holeDia: 4, holeSide: 'top', holeMargin: 4, corner: 0, pair: false }),
    corner: 'radius',
    ring: (p) => roundedRectRing(p.width, p.height, p.corner),
    extra: (p) => [roundedRectRing(Math.max(2, p.width - 2 * p.holeMargin), Math.max(2, p.height - 2 * p.holeMargin), Math.max(0, p.corner - p.holeMargin)).reverse()],
    holeAt: (p) => [0, p.height / 2 - p.holeMargin / 2],
  },
  {
    id: 'att-frame-rounded',
    label: 'Rounded frame',
    category: 'attachments',
    defaults: base({ width: 50, height: 50, holeDia: 4, holeSide: 'top', holeMargin: 4, corner: 8, pair: false }),
    corner: 'radius',
    ring: (p) => roundedRectRing(p.width, p.height, p.corner),
    extra: (p) => [roundedRectRing(Math.max(2, p.width - 2 * p.holeMargin), Math.max(2, p.height - 2 * p.holeMargin), Math.max(0, p.corner - p.holeMargin)).reverse()],
    holeAt: (p) => [0, p.height / 2 - p.holeMargin / 2],
  },
  // Silhouettes
  {
    id: 'carrot',
    label: 'Carrot',
    category: 'silhouettes',
    defaults: base({ width: 95, height: 32, holeDia: 4, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => carrotRootRing(p.width, p.height),
    extraOuter: carrotLeaves,
    holeAt: carrotHoleAt,
    // A rib down each leaf: the mark a leaf carries and a fin never does.
    detail: (p) => ({ engrave: carrotMidribs(p), score: carrotMidribs(p) }),
    // The name starts a little clear of the crown, where the leaves stand.
    textBox: { w: 0.75, h: 1.0, dx: 0.125, dy: 0 },
  },
  {
    id: 'fish',
    label: 'Fish',
    category: 'silhouettes',
    defaults: base({ width: 95, height: 44, holeDia: 4, holeSide: 'top', holeMargin: 2 }),
    ring: (p) => fishBodyRing(p.width, p.height),
    extraOuter: fishExtras,
    holeAt: (p) => [-0.2 * p.width, 0.3 * p.height],
    textBox: { w: 0.6, h: 0.56, dx: -0.1, dy: -0.1 },
  },
  {
    id: 'cloud',
    label: 'Cloud',
    category: 'silhouettes',
    defaults: base({ width: 115, height: 64, holeDia: 3, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => cloudRing(p.width, p.height),
    holeAt: cloudHoleAt,
    textBox: { w: 0.82, h: 0.52, dx: 0, dy: -0.04 },
  },
  {
    id: 'egg',
    label: 'Egg',
    category: 'silhouettes',
    defaults: base({ width: 64, height: 84, holeDia: 3, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => eggRing(p.width, p.height),
    holeAt: (p) => [0, 0.41 * p.height],
    textBox: { w: 0.86, h: 0.46, dx: 0, dy: 0.03 },
  },
  {
    id: 'bow',
    label: 'Bow',
    category: 'silhouettes',
    defaults: base({ width: 60, height: 38, holeDia: 3, holeSide: 'top', holeMargin: 2 }),
    ring: (p) => bowKnotRing(p.width, p.height),
    extraOuter: bowLoops,
    textBox: { w: 0.18, h: 0.5, dx: 0, dy: 0 },
  },
  {
    id: 'bunny',
    label: 'Bunny',
    category: 'silhouettes',
    defaults: base({ width: 60, height: 76, holeDia: 4, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => circleRing(0, 0, 0.5 * p.width, 72),
    extraOuter: bunnyEars,
    holeAt: headTopHoleAt,
    detail: (p) => ({ score: faceMarks(p, 'whiskers') }),
    textBox: { w: 0.6, h: 0.55, dx: 0, dy: -0.15 },
  },
  {
    id: 'cat',
    label: 'Cat',
    category: 'silhouettes',
    defaults: base({ width: 60, height: 58, holeDia: 4, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => circleRing(0, 0, 0.5 * p.width, 72),
    extraOuter: catEars,
    holeAt: headTopHoleAt,
    detail: (p) => ({ score: faceMarks(p, 'whiskers') }),
    textBox: { w: 0.6, h: 0.45, dx: 0, dy: -0.2 },
  },
  {
    id: 'bear',
    label: 'Bear',
    category: 'silhouettes',
    defaults: base({ width: 60, height: 54, holeDia: 4, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => circleRing(0, 0, 0.5 * p.width, 72),
    extraOuter: bearEars,
    holeAt: headTopHoleAt,
    detail: (p) => ({ score: faceMarks(p, 'muzzle') }),
    textBox: { w: 0.6, h: 0.5, dx: 0, dy: -0.18 },
  },
  {
    id: 'dog',
    label: 'Dog',
    category: 'silhouettes',
    defaults: base({ width: 64, height: 64, holeDia: 4, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => circleRing(0, 0, DOG_HEAD * p.width, 72),
    extraOuter: dogEars,
    holeAt: (p) => [0, DOG_HEAD * p.width - (p.holeMargin + p.holeDia / 2)],
    detail: (p) => ({ score: faceMarks(p, 'whiskers') }),
    // Sized against the HEAD (0.44 w), not the blank: the widest part of this silhouette is the
    // ears, and a name set to the full width would run off the muzzle into fresh air.
    textBox: { w: 0.54, h: 0.25, dx: 0, dy: -0.19 },
  },
  {
    id: 'tree',
    label: 'Christmas tree',
    category: 'silhouettes',
    defaults: base({ width: 60, height: 84, holeDia: 3, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => treeRing(p.width, p.height),
    extraOuter: treeApexBoss,
    holeAt: (p) => [0, p.height / 2 - Math.max(4, p.holeDia / 2 + p.holeMargin + 2.5) * 0.3],
    textBox: { w: 0.4, h: 0.16, dx: 0, dy: 0.32 },
  },
  {
    id: 'snowflake',
    label: 'Snowflake',
    category: 'silhouettes',
    defaults: base({ width: 90, height: 90, holeDia: 3, holeSide: 'top', holeMargin: 2 }),
    ring: (p) => snowflakeHubRing(p.width, p.height),
    // The top arm carries a round boss at its tip so a 3 mm hole keeps 2 mm of material; a
    // hole in the hub would strand a frame's loop in the middle of the window.
    extraOuter: (p) => [...snowflakeArms(p), circleRing(0, 0.92 * (Math.min(p.width, p.height) / 2) - 4.5, 4.5, 40)],
    holeAt: (p) => [0, 0.92 * (Math.min(p.width, p.height) / 2) - 4.5],
  },
  {
    id: 'scallop-disc',
    label: 'Scalloped disc',
    category: 'silhouettes',
    defaults: base({ width: 74, height: 74, holeDia: 4, holeSide: 'top', holeMargin: 2.5, corner: 6 }),
    corner: 'radius', // here `corner` is the scallop radius `r`, not a rounding radius — there
    // is no plain edge on this blank for a rounding radius to apply to.
    // The disc is `width` across its crests; `corner` is the bump radius and the count follows
    // from it (R_c = r / sin(π/n), crest = R_c + r), with r re-solved so the crests land on the
    // diameter exactly for a whole number of bumps.
    ring: (p) => {
      const D = Math.min(p.width, p.height);
      const r0 = Math.min(Math.max(2, p.corner), D / 6);
      const n = Math.max(8, Math.round(Math.PI / Math.asin(r0 / (D / 2 - r0))));
      const sn = Math.sin(Math.PI / n);
      return scallopDiscRing(((D / 2) * sn) / (1 + sn), n);
    },
    // The default top-of-bbox formula lands close enough to a scallop crest to eat into
    // holeMargin once the crest's own curvature is accounted for; pull it in a little further.
    holeAt: (p) => [0, p.height / 2 - (p.holeMargin + p.holeDia / 2) - 1],
  },
  {
    id: 'shield',
    label: 'Shield',
    category: 'silhouettes',
    defaults: base({ width: 70, height: 84, holeDia: 3, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => shieldRing(p.width, p.height),
    holeAt: (p) => [0, 0.42 * p.height],
    textBox: { w: 0.8, h: 0.4, dx: 0, dy: 0.06 },
  },
  {
    id: 'swing-tag',
    label: 'Swing tag',
    category: 'silhouettes',
    defaults: base({ width: 51, height: 89, holeDia: 4, holeSide: 'top', holeMargin: 2 }),
    ring: (p) => swingTagRing(p.width, p.height, 0.18 * p.height),
  },
  {
    id: 'arch-tag',
    label: 'Arch tag',
    category: 'silhouettes',
    defaults: base({ width: 51, height: 89, holeDia: 4, holeSide: 'top', holeMargin: 2 }),
    ring: (p) => archRing(p.width, p.height),
  },
  {
    id: 'sil-heart',
    label: 'Heart (silhouette)',
    category: 'silhouettes',
    defaults: base({ width: 92, height: 84, holeDia: 4, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => heartRing(p.width, p.height),
    holeAt: (p) => {
      const r = p.width / 4;
      const top = p.height / 2 - r;
      const shift = Math.max(0, r - p.holeDia / 2 - p.holeMargin) * 0.4;
      return [-r, top + shift];
    },
    textBox: { w: 0.78, h: 0.34, dx: 0, dy: 0.06 },
  },
  {
    id: 'sil-bone',
    label: 'Bone (silhouette)',
    category: 'silhouettes',
    defaults: base({ width: 74, height: 38, holeDia: 4, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => boneRing(p.width, p.height),
    holeAt: (p) => {
      const r = p.height / 4;
      const cx = p.width / 2 - r;
      const shift = Math.max(0, r - p.holeDia / 2 - p.holeMargin) * 0.4;
      return [-cx, r + shift];
    },
    textBox: { w: 0.56, h: 0.4, dx: 0, dy: 0 },
  },
  {
    id: 'sil-leaf',
    label: 'Leaf (silhouette)',
    category: 'silhouettes',
    defaults: base({ width: 105, height: 44, holeDia: 3, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => leafRing(p.height, p.width).map(([x, y]): Pt => [y, x]),
    textBox: { w: 0.9, h: 0.9, dx: 0, dy: 0 },
  },
  {
    id: 'ribbon',
    label: 'Ribbon banner',
    category: 'silhouettes',
    defaults: base({ width: 110, height: 34, holeDia: 3, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => ribbonRing(p.width, p.height),
    holeAt: (p) => [0, p.height / 2 - p.holeMargin - p.holeDia / 2],
    textBox: { w: 0.62, h: 0.7, dx: 0, dy: 0 },
  },
  {
    id: 'pennant',
    label: 'Pennant',
    category: 'silhouettes',
    defaults: base({ width: 120, height: 50, holeDia: 3, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => pennantRing(p.width, p.height),
    holeAt: (p) => [-p.width / 2 + p.holeMargin + p.holeDia / 2 + 1.5, p.height / 2 - p.holeMargin - p.holeDia / 2 - 1.5],
    textBox: { w: 0.6, h: 0.62, dx: -0.1, dy: 0 },
  },
  // Sports balls. One body construction (the leaf's
  // vesica, or a plain circle) and one seam construction (the three-point pole arc) between
  // them; what tells the five apart is the detail, which is why they are `detail()` blanks and
  // not five hand-drawn outlines. No team marks, no league logos — generic balls only.
  {
    id: 'football',
    label: 'Football',
    category: 'silhouettes',
    defaults: base({ width: 70, height: 40, holeDia: 4, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => leafRing(p.height, p.width).map(([x, y]): Pt => [y, x]),
    detail: (p) => ({ raised: [footballLaces(p)], engrave: footballLaces(p) }),
    textBox: { w: 0.62, h: 0.34, dx: 0, dy: 0 },
  },
  {
    id: 'basketball',
    label: 'Basketball',
    category: 'silhouettes',
    defaults: base({ width: 55, height: 55, holeDia: 4, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => circleRing(0, 0, Math.min(p.width, p.height) / 2, 96),
    // Upright, unless this blank is punching its OWN hole: the seams converge on the poles and
    // that hole sits just inside the north one, so a hole is the one case that has to be dodged
    // (and 32° is the angle that clears it). Every template sets `holeSide: 'none'` and places
    // the ring itself, so what a customer sees is the upright ball.
    detail: (p) => {
      const seams = basketballSeams(p, p.holeSide === 'none' ? 0 : 32);
      return { score: seams, engrave: seams };
    },
    textBox: { w: 0.62, h: 0.3, dx: 0, dy: 0 },
  },
  {
    id: 'soccer',
    label: 'Football (soccer)',
    category: 'silhouettes',
    defaults: base({ width: 55, height: 55, holeDia: 4, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => circleRing(0, 0, Math.min(p.width, p.height) / 2, 96),
    detail: (p) => ({ engrave: soccerSeams(p) }),
    textBox: { w: 0.62, h: 0.3, dx: 0, dy: 0 },
  },
  {
    id: 'baseball',
    label: 'Baseball',
    category: 'silhouettes',
    defaults: base({ width: 55, height: 55, holeDia: 4, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => circleRing(0, 0, Math.min(p.width, p.height) / 2, 96),
    detail: (p) => ({ engrave: baseballSeams(p) }),
    textBox: { w: 0.62, h: 0.3, dx: 0, dy: 0 },
  },
  {
    id: 'tennis',
    label: 'Tennis ball',
    category: 'silhouettes',
    defaults: base({ width: 55, height: 55, holeDia: 4, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => circleRing(0, 0, Math.min(p.width, p.height) / 2, 96),
    detail: (p) => ({ engrave: tennisSeam(p) }),
    textBox: { w: 0.62, h: 0.3, dx: 0, dy: 0 },
  },
  {
    id: 'house-chimney',
    label: 'House with chimney',
    category: 'silhouettes',
    defaults: base({ width: 80, height: 90, holeDia: 3, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => houseChimneyRing(p.width, p.height),
    extraOuter: houseChimneyExtras,
    holeAt: (p) => [0, p.height / 2 - houseBossR(p)],
    detail: (p) => ({ engrave: houseDoorWindows(p) }),
    textBox: { w: 0.72, h: 0.22, dx: 0, dy: -0.02 },
  },
  {
    id: 'bauble',
    label: 'Bauble',
    category: 'silhouettes',
    defaults: base({ width: 80, height: 95, holeDia: 3, holeSide: 'top', holeMargin: 2.5 }),
    ring: (p) => baubleRing(p),
    holeAt: (p) => [0, baubleGeom(p).loopCy + baubleGeom(p).shift],
    detail: (p) => ({ engrave: baubleStripes(p) }),
    textBox: { w: 0.7, h: 0.45, dx: 0, dy: -0.078 },
  },
];

export const CATEGORY_LABELS: Record<BlankCategory, string> = {
  keychains: 'Keychains',
  earrings: 'Earrings · pairs',
  tags: 'Tags & ornaments',
  coasters: 'Coasters & plaques',
  shapes: 'Shapes',
  attachments: 'Attachments · weld onto a shape',
  silhouettes: 'Silhouettes',
};

export const blankById = (id: string): BlankDef | undefined => BLANKS.find((b) => b.id === id);

/** The corner slider's label for this blank, or null when the control is dead (`p.corner`
 *  reaches nowhere in the shape's ring). */
export function cornerLabel(def: BlankDef): string | null {
  if (def.corner === 'radius') return 'Corner radius';
  if (def.corner === 'band') return 'Band';
  return null;
}

/** The keyring hole's centre for a side, inside the outer ring by the margin. */
export function holeCentre(def: BlankDef, p: BlankParams): Pt | null {
  if (p.holeSide === 'none' || p.holeDia <= 0) return null;
  const inset = p.holeMargin + p.holeDia / 2;
  if (p.holeSide === 'top') return def.holeAt?.(p) ?? [0, p.height / 2 - inset];
  if (p.holeSide === 'left') return [-p.width / 2 + inset, 0];
  return [p.width / 2 - inset, 0];
}

/** One island: the outer ring, the keyring hole, and whatever the shape carries by nature —
 *  plus one further island per `extraOuter` ring (ears, leaves, fins, tails), each forced CCW
 *  so the engine's overlapping-outer-rings union picks it up as more material, not a hole. */
export function buildBlank(def: BlankDef, p: BlankParams): CutRing[][] {
  const outer = def.ring(p);
  const island: CutRing[] = [signedArea(outer) < 0 ? [...outer].reverse() : outer];
  const c = holeCentre(def, p);
  if (c) island.push(circleRing(c[0], c[1], p.holeDia / 2, 40).reverse());
  if (def.extra) island.push(...def.extra(p));
  const islands: CutRing[][] = [island];
  if (def.extraOuter) {
    for (const r of def.extraOuter(p)) islands.push([signedArea(r) < 0 ? [...r].reverse() : r]);
  }
  return islands;
}

/** The `textBox` fraction of width/height as an absolute box, centred at
 *  `(dx·width, dy·height)` — `null` when the blank declares no `textBox`. */
export function textBoxOf(def: BlankDef, p: BlankParams): Box | null {
  const tb = def.textBox;
  if (!tb) return null;
  const cx = tb.dx * p.width;
  const cy = tb.dy * p.height;
  const hw = (tb.w * p.width) / 2;
  const hh = (tb.h * p.height) / 2;
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh };
}

/** A 40 × 40 SVG path for the tile, drawn from the real generator at its defaults. */
/** The blank alone — no hole — as a path `d` in a 40 × 40 box, for a picker that shows the
 *  shape rather than one particular keyring arrangement. */
export function blankSilhouette(def: BlankDef): string {
  const shapes = buildBlank(def, { ...def.defaults, holeSide: 'none', pair: false });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const isl of shapes) for (const r of isl) for (const [x, y] of r) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const k = 34 / Math.max(maxX - minX, maxY - minY, 1e-6);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const n = (v: number) => v.toFixed(2);
  return shapes
    .flat()
    .map((r) => `M ${r.map(([x, y]) => `${n(20 + (x - cx) * k)} ${n(20 - (y - cy) * k)}`).join(' L ')} Z`)
    .join(' ');
}

export function blankThumb(def: BlankDef): string {
  const shapes = buildBlank(def, def.defaults);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const isl of shapes) for (const r of isl) for (const [x, y] of r) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const k = 32 / Math.max(maxX - minX, maxY - minY, 1e-6);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const n = (v: number) => v.toFixed(2);
  return shapes
    .flat()
    .map((r) => `M ${r.map(([x, y]) => `${n(20 + (x - cx) * k)} ${n(20 - (y - cy) * k)}`).join(' L ')} Z`)
    .join(' ');
}

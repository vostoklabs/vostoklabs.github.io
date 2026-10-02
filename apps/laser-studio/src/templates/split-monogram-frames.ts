// The frames a split monogram can wear, and the two bits of pure geometry the design needs that
// the engine does not have: a dilation, and a stroke-width measurement.
//
// Everything here is closed-form parametric code — circles, arcs, marquise leaves and booleans
// done by the engine's own union. Nothing is traced from anyone's SVG, so nothing with an
// attribution clause can reach a customer's export.
//
// The laurel wreath: a rib arc, leaf stations at s_k = k·Δs, leaf length
// ℓ(k) = ℓ_max(0.4 + 0.6(1 − s/L)) and splay γ_k = γ0(1 − s/L) — the angle falling toward the tip
// is what reads as laurel rather than vine. The floors (rib ≥ 2 × thickness,
// a real attachment chord, never a mathematical point) are applied by the caller through `ribW`,
// and by seating every leaf's inner tip on the rib centreline so the chord where it crosses the
// rib's edge is ~0.8 × w_leaf.
import { circleRing, roundedRectRing, simplifyRing, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';

type Pt = [number, number];

/**
 * A leaf (marquise): two circular arcs meeting at sharp points at (0, ±h/2), bulging to
 * (±w/2, 0). The same construction as `@vostok/laser`'s `leafRing`, which is defined in
 * `blanks.ts` but not re-exported from that package's `index.ts` — export it there and this
 * copy goes away.
 */
function leafRing(w: number, h: number, n = 28): CutRing {
  const W = w / 2;
  const H = h / 2;
  const cx = (W * W - H * H) / (2 * W);
  const r = W - cx;
  const th = Math.atan2(H, -cx);
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

/** Move a ring: rotate about its own origin by `deg`, then translate. */
function place(ring: CutRing, x: number, y: number, deg: number): CutRing {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return ring.map(([px, py]) => [x + px * c - py * s, y + px * s + py * c] as Pt);
}

// ------------------------------------------------------------------------- the frames --

/** The ring frame: an annulus, one island, outer ring plus its hole. Never cut by the split. */
export function ringFrameShapes(R: number, band: number, segments = 192): Shapes {
  const inner = Math.max(0.4, R - band);
  return [[circleRing(0, 0, R, segments), circleRing(0, 0, inner, segments)]];
}

/** A solid disc. */
export function discShapes(R: number, segments = 192): Shapes {
  return [[circleRing(0, 0, R, segments)]];
}

/**
 * The scallop radius to hand `@vostok/laser`'s `scallopDiscRing`, and the hinge circle it puts
 * the scallop centres on. `n` tangent arcs of radius ρ with
 * the crest pinned to `R`, so ρ = R / (1 + 1/sin(π/n)) and hinge = R − ρ. ρ is floored at 3 mm —
 * below that the edge chips on 3 mm ply.
 */
export function scallopHinge(R: number, n: number): { rho: number; hinge: number } {
  const k = Math.max(4, Math.round(n));
  const s = Math.sin(Math.PI / k);
  const rho = Math.max(3, R / (1 + 1 / s));
  return { rho, hinge: Math.max(1, R - rho) };
}

export interface WreathParams {
  /** Outer radius, mm — the leaf tips reach it. */
  R: number;
  /** Leaves per rib (a pair is one per side). */
  pairs: number;
  /** The gap at the top, degrees, where the two ribs part. */
  openDeg: number;
  /** Rib width, mm — `max(2.5, 2 × thickness)` at the call site. */
  ribW: number;
  /** Splay at the base, degrees. Falls to 0 at the tip. */
  splay?: number;
  /** Longest leaf, as a fraction of R. */
  leafMax?: number;
  /** Leaf width as a fraction of its length. */
  leafRatio?: number;
}

/**
 * Two mirrored laurel ribs tied at the bottom, open at the top. Returns loose islands: the
 * engine's `blank: { kind: 'shape' }` unions overlapping outer rings, so rib + leaves + tie
 * come back as one piece.
 *
 * `ribRadius` is the rib's centreline — where a wall hole can go and where the rails cross;
 * `innerRadius` is how far in the wreath actually reaches.
 */
export function laurelWreathShapes(p: WreathParams): { shapes: Shapes; ribRadius: number; innerRadius: number } {
  const R = Math.max(10, p.R);
  const ribW = Math.max(1.5, p.ribW);
  const splay = ((p.splay ?? 55) * Math.PI) / 180;
  const leafMax = (p.leafMax ?? 0.16) * R;
  const ratio = p.leafRatio ?? 0.35;
  const N = Math.max(1, Math.round(p.pairs));
  // Seat the rib so the widest leaf's radial reach lands on R.
  const ribRadius = Math.max(0.55 * R, R - leafMax * Math.sin(splay) - ribW / 2);
  const open = Math.min(120, Math.max(0, p.openDeg));

  // The left rib runs from the tie at the bottom (270°) up through 180° to the top gap.
  const start = (270 * Math.PI) / 180;
  const end = ((90 + open / 2) * Math.PI) / 180;
  const sweep = start - end;
  const L = ribRadius * sweep;

  const branch: Shapes = [];
  // The rib band: outer arc out, inner arc back.
  const steps = 72;
  const outer: CutRing = [];
  const inner: CutRing = [];
  for (let i = 0; i <= steps; i++) {
    const a = start - (i / steps) * sweep;
    outer.push([(ribRadius + ribW / 2) * Math.cos(a), (ribRadius + ribW / 2) * Math.sin(a)]);
    inner.push([(ribRadius - ribW / 2) * Math.cos(a), (ribRadius - ribW / 2) * Math.sin(a)]);
  }
  branch.push([[...outer, ...inner.reverse()]]);
  // A round cap on the free end, so the tip is not a square stub.
  branch.push([circleRing(ribRadius * Math.cos(end), ribRadius * Math.sin(end), ribW / 2, 20)]);

  for (let k = 1; k <= N; k++) {
    const s = (k / (N + 1)) * L;
    const f = 1 - s / L;
    // §4.1's own length law is 0.4 + 0.6 f, which leaves the leaves nearest the tip at two
    // fifths of the longest — small enough that a rib two thirds their width swallows them and
    // the top of the wreath reads as a bare hoop. The floor is 0.55 here; the leaves still
    // shorten toward the tip, which is what reads as laurel rather than as a wreath of
    // identical blobs.
    const len = leafMax * (0.55 + 0.45 * f);
    // §4.1's splay falls to zero at the tip; floored at 25° here, because a leaf lying within a
    // few degrees of the tangent is swallowed whole by a rib two thirds its own width and the
    // wreath comes out a bare hoop with nubs on it. At 15° a tip leaf projected 13 × sin 15° =
    // 3.4 mm past the rib on a 200 mm piece and only the bottom third of each rib read as
    // leaves; at 25° it projects 5.5 mm, and the leaves read the whole way up.
    const gamma = Math.max((25 * Math.PI) / 180, splay * f);
    const a = start - s / ribRadius;
    // Tangent toward the tip, rotated `gamma` (a +90° turn takes the tangent to the outward
    // radial, so +gamma lies between the two; −gamma is the opposite leaf of the pair).
    const axis = Math.atan2(-Math.cos(a), Math.sin(a));
    // The leaf's inner tip sits on the rib centreline: it is embedded ribW/2 deep, so the chord
    // where it crosses the rib's outer edge is a real attachment, never a point.
    const ring = leafRing(Math.max(0.8, ratio * len), len).map(([x, y]) => [x, y + len / 2] as Pt);
    for (const side of [gamma, -gamma]) {
      branch.push([place(ring, ribRadius * Math.cos(a), ribRadius * Math.sin(a), ((axis + side) * 180) / Math.PI - 90)]);
    }
  }

  const shapes: Shapes = [...branch, ...branch.map((isl) => isl.map((r) => r.map(([x, y]) => [-x, y] as Pt)))];
  // The tie: a small band across the bottom, welding the two ribs into one piece.
  shapes.push([place(roundedRectRing(ribW * 2.8, ribW * 1.5, ribW * 0.45), 0, -ribRadius, 0)]);
  // How far in the wreath actually reaches — the inward leaves of the widest pair. The lettering
  // has to clear this, not the nominal 0.82 R.
  let innerRadius = Infinity;
  for (const isl of branch) for (const r of isl) for (const [x, y] of r) innerRadius = Math.min(innerRadius, Math.hypot(x, y));
  return { shapes, ribRadius, innerRadius: Number.isFinite(innerRadius) ? innerRadius : ribRadius };
}

// -------------------------------------------------------- the two geometry primitives --

/**
 * Grow outlines by `w` mm without CSG: the Minkowski sum of the shape with a disc of radius w,
 * built as the shape itself plus a band along every edge and a disc at every vertex. The engine
 * unions `blank.shapes` with manifold's Positive fill rule, so the pieces come back as one
 * dilated outline — counters shrink correctly, because a band laid across a hole's boundary
 * lifts that strip's winding back to 1.
 *
 * This exists because `DesignLayer.grow` is a layer property and a cut monogram's lettering is
 * the BODY, not a layer. See the note in `split-monogram.ts`.
 */
export function dilate(shapes: Shapes, w: number, capSteps = 4): Shapes {
  if (!(w > 1e-3) || !shapes.length) return shapes;
  const out: Shapes = shapes.map((isl) => isl.slice());
  // One capsule per edge rather than a quad plus a disc per vertex: half the islands and half
  // the points for manifold to fill, and the round caps still meet at every corner. The source
  // ring is simplified first — a chord error well under the offset itself, invisible once the
  // outline has grown by `w`, and it is the difference between 350 ms and 1.1 s on a long name.
  const tol = Math.min(0.15, w * 0.35);
  for (const island of shapes) {
    for (const ring of island) {
      const pts = simplifyRing(ring, tol);
      const n = pts.length;
      if (n < 2) continue;
      for (let i = 0; i < n; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % n]!;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) continue;
        const ang = Math.atan2(dy, dx);
        const cap: CutRing = [];
        for (let s = 0; s <= capSteps; s++) {
          const t = ang - Math.PI / 2 + (s / capSteps) * Math.PI;
          cap.push([b[0] + w * Math.cos(t), b[1] + w * Math.sin(t)]);
        }
        for (let s = 0; s <= capSteps; s++) {
          const t = ang + Math.PI / 2 + (s / capSteps) * Math.PI;
          cap.push([a[0] + w * Math.cos(t), a[1] + w * Math.sin(t)]);
        }
        out.push([cap]);
      }
    }
  }
  return out;
}

/**
 * The thinnest stroke the design actually has, in mm: horizontal runs of material sampled
 * across the ink box, reported at a percentile. The same measurement as a p5 horizontal stroke
 * run taken off the TTFs with fontTools, taken here at the built size so it is true for
 * whatever face and size the customer picked.
 *
 * Returns 0 when there is nothing to measure.
 */
export function strokeRun(shapes: Shapes, percentile = 0.05, samples = 81): number {
  if (!shapes.length) return 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const isl of shapes) for (const r of isl) for (const [, y] of r) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minY) || maxY - minY < 1e-6) return 0;
  const widths: number[] = [];
  for (let i = 0; i < samples; i++) {
    // Off the exact top and bottom, and off round numbers, so a scanline never lands on a vertex row.
    const y = minY + ((i + 0.5137) / samples) * (maxY - minY);
    const spans: [number, number][] = [];
    for (const island of shapes) {
      const xs: number[] = [];
      for (const ring of island) {
        for (let j = 0; j < ring.length; j++) {
          const p = ring[j]!;
          const q = ring[(j + 1) % ring.length]!;
          if (p[1] > y !== q[1] > y) xs.push(p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let j = 0; j + 1 < xs.length; j += 2) spans.push([xs[j]!, xs[j + 1]!]);
    }
    if (!spans.length) continue;
    spans.sort((a, b) => a[0] - b[0]);
    let [lo, hi] = spans[0]!;
    for (let j = 1; j < spans.length; j++) {
      const s = spans[j]!;
      if (s[0] <= hi + 1e-6) hi = Math.max(hi, s[1]);
      else {
        widths.push(hi - lo);
        [lo, hi] = s;
      }
    }
    widths.push(hi - lo);
  }
  if (!widths.length) return 0;
  widths.sort((a, b) => a - b);
  return widths[Math.min(widths.length - 1, Math.floor(percentile * widths.length))]!;
}

import type { EdgeSpec } from './buildSet';

/*
  The print-in-place chain: links that come off the bed already interlocked.

  WHY THE LINKS ARE NOT FLAT RINGS. Two rings lying in parallel planes cannot be linked —
  lift one straight up and it comes away — so a flat chain needs each link to pass OVER its
  neighbour at one crossing and UNDER it at the other. Every printed Cuban-link chain does it
  the same way, and so does this one (Ian's examples, 2026-09-07):

    - The link is SOLID from the bed up, everywhere. Its top is at the full height H except
      from the tip to past the crossing where it goes UNDER: there the top is `h`, stepping up
      vertically at the tip and climbing back at 45° toward the side — a rise on a top surface
      is a staircase, never an overhang.
    - Where it goes OVER, the underside lifts to `h + gap` for exactly the width of the
      neighbour's band plus a margin: a BRIDGE. Nothing on the underside is ever angled.

  WHY THE LINKS ARE OCTAGONS. A bridge prints cleanly only when it is a STRAIGHT span between
  two anchors; a bridge that follows a curve sags (Ian's second print). So the crossings sit
  on straight FACETS: each link is an elongated octagon — two straight sides, at each end two
  facets at 45° meeting a short blunt tip. Consecutive links are identical and their facets
  cross at right angles, so every bridge is a straight bar as long as the neighbour's band
  plus margins, with square ends. A "round" link is a regular octagon. The plain loop the
  chain grows from is a teardrop: round on top where it fuses to the hook, the same two 45°
  facets at the bottom so link 1 hangs through it like any other link.

  Corners are MITRED, not filleted — a fillet the size of half the bar would eat the facet —
  so the outline is a plain convex polygon and the band is its mitred offset both ways.

  WHAT HAS TO BE TRUE FOR IT TO PRINT.
    - `PIP_Z_GAP` between a bridge and the low top beneath it: three layers at 0.2 mm.
    - Neighbouring tips are both full height and sit inside each other's holes: `PIP_XY_GAP`
      between a tip's inner corner and the hole end it points at.
    - The crossing (the neighbour's band, `bar` wide) sits on the facet with `PIP_MARGIN` to
      spare each side, and the 45° slope from the low top is back at full height before it
      reaches the bridge's crossing on the other side of the tip, and before the next end's.
      `pipGeometry` checks all of it and reports `feasible`; a size that fails is reported by
      the builder and refused by the UI's shape picker.
    - Every edge carries the bottom chamfer against elephant's foot, like every other part.

  The mesh is SWEPT: a chamfered rectangle carried round the centreline polygon with its
  bottom and top read off the profile at each step — a mitre section at every corner — and
  closed on itself. No caps to triangulate, no booleans to fail.

  Portable: nothing here knows about the app. Local frame per element: centred on the
  origin, long axis on Y, the chain running toward −Y (the far end) from the hook (+Y, the
  near end). The perimeter runs counter-clockwise from the far tip.
*/

export type Pt = [number, number];
/** A stretch of perimeter, [from, to]. */
export type Span = [number, number];

/** Z gap between a bridge and the low top under it, mm. Three layers. */
export const PIP_Z_GAP = 0.6;
/** XY gap between a tip's inner corner and the hole end it points into, mm. */
export const PIP_XY_GAP = 0.6;
/** The least tip gap a link is allowed to be built with: two first layers' squish. */
export const PIP_TIP_MIN = 0.4;
/** How far a low top or a bridge extends beyond the neighbour's band, mm — at least this, and
 *  never less than a corner's mitre zone (see `zoneOf`), so no wall lands inside a corner. */
export const PIP_MARGIN = 0.6;
/** Slope of the top surface where it climbs from the low top back to full height, degrees. */
export const PIP_RAMP_DEG = 45;
/** The thinnest a low top or a bridge may be before the chain is not worth printing, mm. */
export const PIP_MIN_BAND = 1.6;
/** Sweep step along the centreline, mm. */
const STEP = 0.35;
/** The loop's round top is a polygon with this many degrees per side. */
const ARC_STEP = (4 * Math.PI) / 180;
/** Scan step for the overlap check, mm. */
const SCAN = 0.02;

export interface PipLevels {
  /** The low top under a crossing, and the thickness of the bridge over one, mm. */
  h: number;
  /** The Z gap between a bridge and the low top beneath it. */
  gap: number;
  /** Full height: 2h + gap. Equal to the hook's thickness. */
  H: number;
}

/** The levels for a chain as thick as `total`: the low top and the bridge share what is left
 *  after the gap. */
export function pipLevels(total: number, gap = PIP_Z_GAP): PipLevels {
  const h = Math.max(0.4, (total - gap) / 2);
  return { h, gap, H: 2 * h + gap };
}

// --- Outlines -------------------------------------------------------------------------------

/** A convex centreline polygon and what the sweep and the solver need to know about it. */
export interface PipOutline {
  /** Counter-clockwise, starting at the far tip (on the −Y axis). */
  poly: Pt[];
  /** Perimeter position of each vertex; `cum[n]` is the perimeter. */
  cum: number[];
  L: number;
  /** Half the bar. */
  hw: number;
  nearTipY: number;
  farTipY: number;
  /** How far in from the far tip's centreline the hole ends: the band's inner corner. */
  holeDepth: number;
  /** The straight facets that carry a crossing, as perimeter spans in perimeter order:
   *  far-right, then (for a link) near-right and near-left, then far-left. */
  facets: Span[];
}

type Edge = { a: Pt; b: Pt; facet: boolean };

function outlineOf(edges: Edge[], hw: number, nearTipY: number, farTipY: number, holeDepth: number): PipOutline {
  const kept = edges.filter((e) => Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) > 1e-6);
  const poly = kept.map((e) => e.a);
  const cum = [0];
  for (const e of kept) cum.push(cum[cum.length - 1]! + Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]));
  const facets: Span[] = [];
  kept.forEach((e, i) => { if (e.facet) facets.push([cum[i]!, cum[i + 1]!]); });
  return { poly, cum, L: cum[cum.length - 1]!, hw, nearTipY, farTipY, holeDepth, facets };
}

/**
 * A link: an octagon `Lc` long and `Wc` wide on the centreline, with a tip flat `Tx` wide and
 * 45° facets between the flat and the straight sides. `Tx = 0` gives a hexagon.
 */
function outlineLink(Lc: number, Wc: number, Tx: number, hw: number): PipOutline {
  const Sy = Lc - (Wc - Tx);
  const v: Pt[] = [
    [0, -Lc / 2], [Tx / 2, -Lc / 2], [Wc / 2, -Sy / 2], [Wc / 2, Sy / 2], [Tx / 2, Lc / 2],
    [0, Lc / 2], [-Tx / 2, Lc / 2], [-Wc / 2, Sy / 2], [-Wc / 2, -Sy / 2], [-Tx / 2, -Lc / 2],
  ];
  const facetEdge = new Set([1, 3, 6, 8]);
  const edges: Edge[] = v.map((a, i) => ({ a, b: v[(i + 1) % v.length]!, facet: facetEdge.has(i) }));
  return outlineOf(edges, hw, Lc / 2, -Lc / 2, Tx > 1e-6 ? hw : hw * Math.SQRT2);
}

/**
 * The plain loop: a circle of radius `R` on top, and at the bottom the same tip flat and two
 * 45° facets of length `Lf` as the links, tangent to the circle, so link 1 crosses it exactly
 * as it would cross another link.
 */
function outlineLoop(Lf: number, Tx: number, hw: number): PipOutline {
  const R = Lf + Tx / Math.SQRT2;
  const yV = -(R + Lf) / Math.SQRT2;
  const t = R / Math.SQRT2;
  const v: Pt[] = [[0, yV], [Tx / 2, yV], [t, -t]];
  const facetFrom = 1;
  for (let a = -Math.PI / 4 + ARC_STEP; a < (5 * Math.PI) / 4 - ARC_STEP / 2; a += ARC_STEP) v.push([R * Math.cos(a), R * Math.sin(a)]);
  v.push([-t, -t], [-Tx / 2, yV]);
  const edges: Edge[] = v.map((a, i) => ({ a, b: v[(i + 1) % v.length]!, facet: i === facetFrom || i === v.length - 2 }));
  return outlineOf(edges, hw, R, yV, Tx > 1e-6 ? hw : hw * Math.SQRT2);
}

/** Point, outward normal and mitre stretch at perimeter position `s`. Exactly at a vertex the
 *  normal is the bisector and the stretch widens the section into the mitre. */
export function at(o: PipOutline, s: number): { p: Pt; n: Pt; stretch: number } {
  const L = o.L;
  // Wrap only when out of range: `((s % L) + L) % L` moves an in-range s by a few
  // nanometres, and a vertex position that lands a hair before its vertex is read as the end
  // of the previous edge — no mitre, the previous edge's normal — which is how every corner
  // ring and every offset corner came out wrong in the first cut of this.
  if (s < 0 || s >= L) s = ((s % L) + L) % L;
  const n = o.poly.length;
  let i = 0;
  while (i + 1 < n && s >= o.cum[i + 1]! - 1e-7) i++;
  if (i >= n) i = n - 1;
  const a = o.poly[i]!, b = o.poly[(i + 1) % n]!;
  const len = o.cum[i + 1]! - o.cum[i]!;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const nrm: Pt = [uy, -ux];
  const t = Math.max(0, Math.min(1, (s - o.cum[i]!) / len));
  const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  if (Math.abs(s - o.cum[i]!) < 1e-6) {
    const pv = o.poly[(i - 1 + n) % n]!;
    const pl = Math.hypot(a[0] - pv[0], a[1] - pv[1]);
    const pn: Pt = [(a[1] - pv[1]) / pl, -(a[0] - pv[0]) / pl];
    let bx = pn[0] + nrm[0], by = pn[1] + nrm[1];
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl; by /= bl;
    return { p: [a[0], a[1]], n: [bx, by], stretch: 1 / Math.max(0.2, bx * nrm[0] + by * nrm[1]) };
  }
  return { p, n: nrm, stretch: 1 };
}

/** The outline's band edge, `d` out from the centreline (negative = in): the mitred offset. */
function offsetPoly(o: PipOutline, d: number): Pt[] {
  return o.poly.map((_, i) => {
    const { p, n, stretch } = at(o, o.cum[i]!);
    return [p[0] + n[0] * d * stretch, p[1] + n[1] * d * stretch] as Pt;
  });
}

/** Inside a convex counter-clockwise polygon. */
function inConvex(poly: Pt[], q: Pt): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    if ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) < -1e-9) return false;
  }
  return true;
}

/**
 * Where the band of `A` overlaps the band of `B` (placed `dyB` along Y), as perimeter spans
 * of A. Measured: walk A's centreline and ask, at each step, whether any point across A's
 * band lies within B's band. `hwA`/`hwB` may be inflated to test clearance rather than touch.
 */
export function overlapAlong(A: PipOutline, B: PipOutline, dyB: number, hwA: number, hwB: number): Span[] {
  const outer = offsetPoly(B, hwB), inner = offsetPoly(B, -hwB);
  const spans: Span[] = [];
  let open: Span | null = null;
  for (let s = SCAN / 2; s < A.L; s += SCAN) {
    const { p, n } = at(A, s);
    let hit = false;
    for (let k = 0; k <= 8 && !hit; k++) {
      const u = -hwA + (2 * hwA * k) / 8;
      const q: Pt = [p[0] + n[0] * u, p[1] + n[1] * u - dyB];
      hit = inConvex(outer, q) && !inConvex(inner, q);
    }
    if (hit) { if (open) open[1] = s; else { open = [s, s]; spans.push(open); } }
    else open = null;
  }
  return spans;
}

const within = (span: Span, inside: Span) => span[0] >= inside[0] - 1e-6 && span[1] <= inside[1] + 1e-6;

// --- The solve ------------------------------------------------------------------------------

export interface PipLinkSpec {
  /** Outer long axis, mm. */
  length: number;
  /** Outer short axis, mm. */
  width: number;
  /** Band width, mm. */
  bar: number;
}

export interface PipGeom {
  link: PipOutline;
  loop: PipOutline;
  bar: number;
  /** Centre-to-centre spacing of consecutive links, mm. */
  pitch: number;
  /** The next element's near tip sits this far above this one's far tip, mm. Half of it is the
   *  lens the two share, where the dangle turns them. */
  step: number;
  /** Length of a crossing facet, mm. */
  Lf: number;
  /** The neighbour's band on a link's far-right facet, as a perimeter span from the far tip;
   *  the other three crossings are its mirror images. */
  patch: Span;
  /** The same on the loop's far-right facet, and on link 1's near facets where it hangs from
   *  the loop — closer to the tips than a link-to-link crossing. */
  loopPatch: Span;
  patchAfterLoop: Span;
  /** Link 1's near tip sits this far above the loop's far tip, mm. */
  stepLoop: number;
  /** Run of the 45° slope, mm: the height it climbs. */
  ramp: number;
  /** How far a low top or a bridge extends beyond the neighbour's band, mm. */
  margin: number;
  /** Room between a tip's inner corner and the hole end it points at, mm. */
  tipGap: number;
  /** Outer width of the plain loop, mm — it is wider than a link. */
  loopWidth: number;
  feasible: boolean;
  /** Which of the checks passed, for a message that names the cause. */
  flags: { facet: boolean; slopeTip: boolean; slopeSide: boolean; tip: boolean; scan: boolean };
}

/**
 * Solve the link. There is no free angle to search: identical octagons whose facets cross at
 * right angles fix the pitch once the crossing is centred on the facet. What is left is to
 * check that everything fits, analytically and then by measuring the overlap.
 */
export function pipGeometry(spec: PipLinkSpec, levels: PipLevels): PipGeom {
  const bar = Math.max(1.2, Math.min(spec.bar, (spec.width - 2.4) / 2));
  const hw = bar / 2;
  const Wc = spec.width - bar;
  const Lc = Math.max(Wc, spec.length - bar);
  const round = spec.length <= spec.width + 1e-6;
  // A regular octagon when round; otherwise a blunt tip 0.7 bar wide — a flat that spares the
  // inner corner, at little cost in facet length and tip clearance.
  const Tx = round ? Wc / (1 + Math.SQRT2) : Math.min(0.7 * bar, Wc - 1);
  const step = (Wc - Tx) / 2;
  const Lf = step * Math.SQRT2;
  const link = outlineLink(Lc, Wc, Tx, hw);
  const pitch = Lc - step;
  const ramp = (levels.H - levels.h) / Math.tan((PIP_RAMP_DEG * Math.PI) / 180);
  // A wall (a bridge end) inside a corner's mitre zone would sit on a folded edge, so the
  // margin is at least the zone of the 135° corners the facets end in.
  const m = Math.max(PIP_MARGIN, hw * Math.tan(Math.PI / 8) + 0.05);

  const f0 = link.facets[0]!;
  const lo = f0[0] + Lf / 2 - hw, hi = lo + bar;
  const patch: Span = [lo, hi];

  // The plain loop: as small as the crossing allows. Its facets need only carry link 1's band
  // plus margins, so they are `bar + 2m` long, not a whole link facet, and the crossing sits
  // as close to the tips as the margins let it on BOTH the loop and link 1's near end — link 1
  // gets its own near patch for that. The loop's bar is a little thinner than the links'. A
  // loop with link-length facets was 18 mm wide for 22 mm links; this one is ~14.
  const hwL = Math.max(1.2, hw - 0.4);
  // ...but no closer than the tips allow: link 1's flat tip and the loop's inner corner face
  // each other `√2·u1 − hw − hwL` apart on the axis, and that has to be the XY gap on the 45°.
  const u1 = Math.max(hw + m, (hw + hwL) / Math.SQRT2 + PIP_XY_GAP);
  const LfLoop = u1 + hw + m;
  const loop = outlineLoop(LfLoop, Tx, hwL);
  const stepLoop = Math.SQRT2 * u1;
  const fl = loop.facets[0]!;
  const loopPatch: Span = [fl[0] + u1 - hw, fl[0] + u1 + hw];
  const patchAfterLoop: Span = [f0[0] + u1 - hw, f0[0] + u1 + hw];
  // The tips' closest approach is not on the axis: it is from the inner corner of one tip flat
  // to the other link's inner facet, which runs at 45° — the axis gap over √2.
  const tipGap = (step - 2 * link.holeDepth) / Math.SQRT2;

  // (a) The crossing and its margins sit on the facet.
  const facetOk = Lf >= bar + 2 * m;
  // (b) Toward the tip the low top runs to the tip's midpoint and steps up there — a vertical
  //     rise on a top surface, not an overhang — so the bridge on the other side of the tip is
  //     full height from its first millimetre. Nothing to check.
  // (c) The slope climbing toward the side is back at full height before the next end's
  //     crossing, half a perimeter away.
  const slopeSideOk = hi + m + ramp <= link.L / 2 - hi;
  // (d) Tips clear the hole ends they point into.
  // The geometry AIMS for `PIP_XY_GAP`; it is refused only below the first-layer squish
  // budget, where two tips really can weld. Between the two nothing touches, and a warning
  // there was a false alarm on a chain that prints.
  const tipOk = tipGap >= PIP_TIP_MIN;
  // (e) Measured: the only places the bands overlap are the far facets — nothing at the tips,
  //     nothing on the sides — for a link over the next link and for the loop over link 1. The
  //     bands are grown by a hair so a touch counts; not by the XY gap, because a mitred
  //     offset polygon grows its corners further than a real band would and reads corners
  //     that are 0.68 apart as touching. The tip clearance is (d) above, measured properly.
  let scanOk = false;
  if (facetOk && tipOk) {
    // The hair the bands are grown by shows up as hair-thin spans at the mitre corners; only
    // real spans count, and a real span may lean on a facet's end by that hair.
    const onFar = (raw: Span[], o: PipOutline) => {
      const spans = raw.filter((sp) => sp[1] - sp[0] > 0.1);
      const pad = (f: Span): Span => [f[0] - 0.1, f[1] + 0.1];
      return spans.length === 2 && within(spans[0]!, pad(o.facets[0]!)) && within(spans[1]!, pad(o.facets[o.facets.length - 1]!));
    };
    const linkSpans = overlapAlong(link, link, -pitch, hw + 0.05, hw + 0.05);
    const dy1 = loop.farTipY + stepLoop - link.nearTipY;
    const loopSpans = overlapAlong(loop, link, dy1, hwL + 0.05, hw + 0.05);
    scanOk = onFar(linkSpans, link) && onFar(loopSpans, loop);
  }

  return {
    link, loop, bar, pitch, step, stepLoop, Lf, patch, loopPatch, patchAfterLoop, ramp, tipGap,
    loopWidth: 2 * (loop.nearTipY + hwL),
    margin: m,
    feasible: facetOk && slopeSideOk && tipOk && scanOk,
    flags: { facet: facetOk, slopeTip: true, slopeSide: slopeSideOk, tip: tipOk, scan: scanOk },
  };
}

// --- The chain's elements -------------------------------------------------------------------

/** Where an element's band changes level: low top (with slopes) over `under`, bridge over
 *  `over`, as perimeter spans of its own outline. */
export interface PipFeatures {
  under: Span[];
  over: Span[];
}

/**
 * The features of one element. An element goes UNDER its neighbour at the far-right and
 * near-left crossings (its top drops there) and OVER at the far-left and near-right (it
 * bridges there). The root has no near-end crossings (it fuses to the hook there); the
 * terminal has no far-end ones (the connector ring hangs there). Consecutive elements agree:
 * "over" on one's far end meets "under" on the next one's near end.
 */
export function pipFeatures(o: PipOutline, farPatch: Span, nearPatch: Span, m: number, kind: { root: boolean; terminal: boolean }): PipFeatures {
  const L = o.L;
  const under: Span[] = [], over: Span[] = [];
  // The low top runs from the TIP's midpoint (a vertical step there) out past the crossing;
  // the 45° climb back to full height is on its far end only, toward the side.
  if (!kind.terminal) { const [lo, hi] = farPatch; under.push([0, hi + m]); over.push([L - hi - m, L - lo + m]); }
  if (!kind.root) { const [lo, hi] = nearPatch; under.push([L / 2, L / 2 + hi + m]); over.push([L / 2 - hi - m, L / 2 - lo + m]); }
  return { under, over };
}

export interface PipElement {
  outline: PipOutline;
  features: PipFeatures;
  /** The outline's origin, in the chain's frame (x = 0 on the axis). */
  cy: number;
  nearY: number;
  farY: number;
  /** Where the next element (or the connector ring) hangs from: the hole's far end. */
  holeBottomY: number;
}

/**
 * The chain, top to bottom: the root (the plain loop, or a link when it is the swivel's
 * captive ring) with its near tip at `topY`, then `count` links, each hung through the one
 * above with its near tip `step` above the previous far tip.
 */
export function pipLayout(g: PipGeom, count: number, root: 'loop' | 'link', topY: number): PipElement[] {
  const out: PipElement[] = [];
  let nearY = topY;
  for (let k = 0; k <= count; k++) {
    const isLoop = k === 0 && root === 'loop';
    const outline = isLoop ? g.loop : g.link;
    const farPatch = isLoop ? g.loopPatch : g.patch;
    const nearPatch = k === 1 && root === 'loop' ? g.patchAfterLoop : g.patch;
    const cy = nearY - outline.nearTipY;
    const farY = cy + outline.farTipY;
    out.push({
      outline,
      features: pipFeatures(outline, farPatch, nearPatch, g.margin, { root: k === 0, terminal: k === count }),
      cy, nearY, farY,
      holeBottomY: farY + outline.holeDepth,
    });
    nearY = farY + (isLoop ? g.stepLoop : g.step);
  }
  return out;
}

// --- The sweep ------------------------------------------------------------------------------

interface Level { zb: number; zt: number }

/** Signed distance from `s` to the span: 0 inside, else the perimeter distance to its nearer
 *  end — wrapping, so a span that crosses s = 0 still reads right. */
function outside(s: number, span: Span, L: number): number {
  const wrap = (x: number) => ((x % L) + L) % L;
  const rel = wrap(s - span[0]);
  const len = span[1] - span[0];
  if (rel <= len) return 0;
  return Math.min(rel - len, L - rel);
}

/** Bottom and top of the band at position `s`: full height, except the low top (with its 45°
 *  slopes) where the neighbour passes over, and the bridge where this element passes over it. */
function profileOf(o: PipOutline, levels: PipLevels, f: PipFeatures, ramp: number) {
  const slope = (levels.H - levels.h) / ramp;
  return (s: number): Level => {
    let zt = levels.H;
    for (const [a, b] of f.under) {
      const rel = ((s - a) % o.L + o.L) % o.L;
      if (rel <= b - a) zt = levels.h;
      else if (rel - (b - a) < ramp) zt = Math.min(zt, levels.h + (rel - (b - a)) * slope);
    }
    let zb = 0;
    for (const v of f.over) if (outside(s, v, o.L) === 0) zb = levels.h + levels.gap;
    // An infeasible element (already reported) can put a slope over a bridge; keep the mesh a
    // mesh rather than let the section turn inside out.
    if (zt < zb + 0.4) zt = zb + 0.4;
    return { zb, zt };
  };
}

/** Positions along the centreline to sweep at: an even step, every vertex (for its mitre
 *  section), the exact ends of every slope and, as a close pair, either end of every bridge
 *  so its walls come out vertical. */
function samples(o: PipOutline, f: PipFeatures, ramp: number): number[] {
  const L = o.L;
  const raw: number[] = [];
  // Same care as `at`: wrap only what is out of range, so a vertex stays exactly a vertex.
  const put = (s: number) => raw.push(s < 0 || s >= L ? ((s % L) + L) % L : s);
  const n = Math.max(24, Math.ceil(L / STEP));
  const eps = 1e-3;
  for (let i = 0; i < n; i++) put((L * i) / n);
  for (const [a, b] of f.under) { put(a - eps); put(a + eps); put(b); put(b + ramp); }
  for (const [a, b] of f.over) { put(a - eps); put(a + eps); put(b - eps); put(b + eps); }
  // At a mitred corner the band's inner edge does not begin at the vertex: the two inner
  // offset lines meet `hw·tan(φ/2)` further along. A ring placed within that stretch of either
  // edge has its inner point BEHIND the inner corner and the edge folds back — a bow-tie the
  // slicer read as a sliver, and a dark fan of triangles in the render. So no ring goes there:
  // a sample inside a zone is pushed to its edge, and the vertex ring alone turns the corner.
  const zones = o.poly.map((_, i) => ({ s: o.cum[i]!, z: zoneOf(o, i) + 2e-3 }));
  const clear = (s: number) => {
    for (const k of zones) {
      let d = s - k.s;
      if (d > L / 2) d -= L; else if (d < -L / 2) d += L;
      if (Math.abs(d) < k.z && Math.abs(d) > 1e-9) return k.s + Math.sign(d) * k.z;
    }
    return s;
  };
  const cleared = raw.map(clear).map((s) => (s < 0 || s >= L ? ((s % L) + L) % L : s));
  for (let i = 0; i < o.poly.length; i++) cleared.push(o.cum[i]!);
  cleared.sort((a, b) => a - b);
  const out: number[] = [];
  for (const s of cleared) if (!out.length || s - out[out.length - 1]! > 2e-4) out.push(s);
  return out;
}

/** Half-width of the mitre zone at vertex `i`: how far past the vertex the inner offset edges
 *  meet, `hw·tan(φ/2)` for a turn of φ. */
function zoneOf(o: PipOutline, i: number): number {
  const nv = o.poly.length;
  const v = o.poly[i]!, pv = o.poly[(i - 1 + nv) % nv]!, nx = o.poly[(i + 1) % nv]!;
  const d0x = v[0] - pv[0], d0y = v[1] - pv[1], d1x = nx[0] - v[0], d1y = nx[1] - v[1];
  const l0 = Math.hypot(d0x, d0y) || 1, l1 = Math.hypot(d1x, d1y) || 1;
  const cos = Math.max(-1, Math.min(1, (d0x * d1x + d0y * d1y) / (l0 * l1)));
  return o.hw * Math.sqrt((1 - cos) / (1 + cos));
}

/** The cross-section in the (outward, up) plane: a rectangle `bar` wide from `zb` to `zt`
 *  with its edges chamfered or rounded. Ordered so the swept tube faces outward. */
function section(bar: number, lv: Level, edge: EdgeSpec): Pt[] {
  const th = lv.zt - lv.zb;
  // Never fewer points than the other sections: the sweep zips ring to ring.
  const c = Math.max(0.05, Math.min(edge.size, th * 0.25, bar * 0.3));
  const o = bar / 2;
  if (edge.style === 'chamfer') {
    return [
      [o - c, lv.zt], [o, lv.zt - c], [o, lv.zb + c], [o - c, lv.zb],
      [-o + c, lv.zb], [-o, lv.zb + c], [-o, lv.zt - c], [-o + c, lv.zt],
    ];
  }
  // Round: quarter circles, three segments each, same clockwise order.
  const out: Pt[] = [];
  const corner = (cx: number, cz: number, a0: number, a1: number) => {
    for (let i = 0; i <= 3; i++) {
      const a = a0 + ((a1 - a0) * i) / 3;
      out.push([cx + c * Math.cos(a), cz + c * Math.sin(a)]);
    }
  };
  corner(o - c, lv.zt - c, Math.PI / 2, 0);
  corner(o - c, lv.zb + c, 0, -Math.PI / 2);
  corner(-o + c, lv.zb + c, -Math.PI / 2, -Math.PI);
  corner(-o + c, lv.zt - c, Math.PI, Math.PI / 2);
  return out;
}

export interface PipMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * One element as a closed triangle mesh in its local frame. `edge` is the same treatment the
 * flat parts get. Every section has the same point count, so consecutive rings zip into
 * quads and the last ring closes onto the first.
 */
export function pipMesh(o: PipOutline, levels: PipLevels, f: PipFeatures, ramp: number, edge: EdgeSpec): PipMesh {
  const prof = profileOf(o, levels, f, ramp);
  const ss = samples(o, f, ramp);
  const bar = o.hw * 2;
  const hw = o.hw;
  const K = section(bar, prof(0), edge).length;
  const n = ss.length;
  const positions = new Float32Array(n * K * 3);


  for (let i = 0; i < n; i++) {
    const s = ss[i]!;
    const { p, n: nrm, stretch } = at(o, s);
    const sec = section(bar, prof(s), edge);
    // The segment the section spans in the plane: inner base to outer base.
    const inX = p[0] - nrm[0] * hw * stretch, inY = p[1] - nrm[1] * hw * stretch;
    const outX = p[0] + nrm[0] * hw * stretch, outY = p[1] + nrm[1] * hw * stretch;
    const mx = (inX + outX) / 2, my = (inY + outY) / 2;
    const hx = (outX - inX) / 2, hy = (outY - inY) / 2;
    for (let j = 0; j < K; j++) {
      const [u, z] = sec[j]!;
      const q = (i * K + j) * 3;
      const t = u / hw; // −1 at the inner base, +1 at the outer
      positions[q] = mx + hx * t;
      positions[q + 1] = my + hy * t;
      positions[q + 2] = z;
    }
  }
  const indices = new Uint32Array(n * K * 6);
  let t = 0;
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    for (let j = 0; j < K; j++) {
      const j1 = (j + 1) % K;
      const a = i * K + j, b = i * K + j1, c = i1 * K + j1, d = i1 * K + j;
      indices[t++] = a; indices[t++] = b; indices[t++] = c;
      indices[t++] = a; indices[t++] = c; indices[t++] = d;
    }
  }
  return { positions, indices };
}

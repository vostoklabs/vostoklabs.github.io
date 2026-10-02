// Heart puzzle keychains: two landscape bars, a script name engraved on each, a keyring hole at
// the left end of each — and a shared long edge that runs straight, then at the right end runs
// THROUGH two small upright hearts standing side by side at the same height, so the pair keys
// together like two puzzle pieces and the join reads as a pair of hearts. The seam crosses each
// heart just under its lobes. The LEFT heart's lobes are
// a knob of the bottom bar, locked in the top bar because they are wider than the neck they
// stand on; the RIGHT heart's point is a knob of the top bar, keyed into a V in the bottom bar.
// What the seam does not draw of each heart is ENGRAVED on the bar it lies in — the left heart's
// point on the bottom bar, the right heart's lobes on the top bar — so each bar carries one whole
// heart, and the pair put together shows two.
//
// ONE SEAM, TWO OUTLINES. Both bars are built in the pair's frame with the seam on y = 0: the top
// bar above it, the bottom bar below. The seam is ONE curve, written once (`seamCurve`) out of
// lines and arcs that meet tangentially, and each bar's edge is that curve moved `gap/2` into its
// own material along the curve's normal. So the knob of one bar and the socket of the other are
// the same line by construction — they cannot disagree — and the air between them is `gap`
// everywhere along the seam, round the lobes and down into the necks alike.
//
// WHY THE BARS ARE CUT APART, AND WHAT THE GAP IS (kerf-derived, not a hairline). The seam could
// be cut once, as a single line (the kerf is then the clearance, the way a jigsaw is cut); but
// this engine cuts each piece's outline whole, so a shared line is burnt TWICE — a double pass
// that chars the edge and loosens the fit. Laid out interlocked with a hairline gap the two
// passes run 0.02–0.5 mm apart, which is the same scorching sliver. So the bars are cut apart
// (`layout: column`, 3 mm between them — §2.5's floor between two cut paths) and the fit is
// DRAWN: each cut takes kerf/2 off its own edge, so the finished air round a knob is
// `gap + kerf`, and the gap is drawn as `CLEARANCE − kerf` to land on CLEARANCE = 0.2 mm a side
// (0.4 mm total: the middle of §1.3's "loose slide, repeated assembly" band — two keychains that
// are clipped together and pulled apart every day) — but never under GAP_MIN = 0.05 mm.
//
// THE FLOOR (2026-09-28: the puzzle needs a tolerance so it actually fits). Without it the shipped
// 0.18 mm kerf drew a 0.02 mm gap, and a wider kerf drew the knob OVER its socket: exact when the
// Kerf field is right, tight the moment it is not — a
// 0.08 mm diode beam with the field left at 0.18 finished at 0.10 a side, and a field raised to
// 0.25 on a 0.12 beam at 0.07. With the floor a pair never finishes tighter than 0.05 + the real
// kerf, whatever the field says. Measured on a simulated cut (each bar's outline taken in by half
// the kerf, then the air sampled every 0.1 mm along the whole seam — round the lobes, in the V
// and along the straights), at the shipped 8 mm heart:
//
//   Kerf field = the real kerf     0.08        0.12        0.18        0.25
//     finished air, a side         0.19–0.21   0.19–0.21   0.22–0.24   0.29–0.31
//     lock, a side                 0.76        0.76        0.73        0.66
//   field left at 0.18, real kerf  0.08        0.12        0.18        0.25
//     finished air, a side         0.12–0.14   0.16–0.18   0.22–0.24   0.29–0.31
//
// §1.3's loose band is 0.15–0.25 a side. A correctly set 0.25 finishes 0.05 past it, which is
// what never drawing a knob over its socket costs: exact compensation would draw it 0.05 over. The
// lock — the lobes wider than their socket's mouth — holds throughout; at the smallest 6.5 mm
// heart it is 0.51 / 0.48 / 0.41 a side for a 0.12 / 0.18 / 0.25 kerf, and 0.26 at the field's
// 0.4 maximum. `assembledAt: 'built'` puts the pair back together for the card and 3D.
//
// THE HEARTS (numbers at the shipped 8 mm heart, 0.32 of the 25 mm bar as in the photo). Two
// lobes of r = 1.85 mm standing 0.3 mm apart, drawn to a point 0.65 W below their centres — the
// blank heart's own proportion (`heartRing`'s 0.63) — so the flanks lean 41.7° off vertical.
// Both hearts are the same shape at the same height, and the seam runs SINK = 0.275 W = 2.2 mm
// under their lobe centres (the photo's ~0.25 W, a hair lower for the lock). There the heart is
// 5.34 mm across. The LEFT knob — the lobes, 4 mm proud — stands on that, its neck widened to
// 6.1 mm by the lip rounds (5.9 of wood after the kerf); the RIGHT knob is the point below it,
// 2.7 mm deep, 4.8 mm across its root. The lock is the lobes (8 mm) against their socket's mouth
// (6.1 mm): 0.73 mm a side of wood-on-wood once the kerf and the finished air are taken out
// (0.48 at the smallest heart; see THE FLOOR above). The lip — the 48° wedge of the top bar
// tucked under each lobe, which holds that lock — is 2.0 mm thick at the lobe's widest after the
// cut, and its nose is rounded at BASE_ROUND = 0.3 mm, not a point. Not 0.8: at this seam height
// only 1.3 mm of flank stands above the seam, a 0.8 mm round needs 1.8 mm of it, and it would
// climb the lobe and leave 0.15 mm of lock. The V's base corners take the same 0.3 mm round — a
// sharp corner cannot be moved along a normal (`offsetCurve`) — and its point a 0.6 mm one; the
// cleft is rounded at 0.6 mm so the top bar's tongue in it is ≥ 1 mm of wood after the kerf, not
// a splinter.
//
// THE ENGRAVED HALVES. The rest of each heart is a LINE = 0.4 mm line (§2.6's reliable ≥ 0.2)
// on the bar it lies in, running along the heart's own outline to the very point where the seam
// takes that outline over — where the seam's round leaves each flank — and trimmed there by the
// bar's own outline (`keep`), so its ends lie ON the cut. The heart is one continuous line: cut
// where the seam is, engraved where it is not. Since 2026-09-28 the scores go to the edges of the
// design. Until then it stopped LINE_AIR = 0.3 mm short of the cut, to read as
// the cut line carrying on rather than a scorch along the edge; on the bars it read as a gap.
//
// WHERE THINGS GO. The right heart ends END_WALL = 4 mm from the bars' right end (§5.2's 3 mm,
// plus room for the corner), the left one HEART_GAP = 1.5 mm to its left, so the two read as a
// pair; the bars' corners stop SHOULDER = 2 mm short of the V, so the wood beside it stays
// ≥ 3.7 mm across. Each name is centred between the hole and the right margin, as big as the
// Name size allows, and never within 1.5 mm of its bar's hearts (the socket and the engraved
// half): a long name first slides away from the seam, then shrinks (`placeName`).
//
// Rules of thumb: fits and kerf compensation; webs ≥ the stock, 3 mm between cut paths; engraved
// line width; 4 mm hole, 3 mm of wall.
import { bboxOf, heartRing, strokeRing, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { textLayer } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import { finalHoleCentre } from '../engine/editorGeometry';
import { readSymbols, type InlineSymbol, type SymbolMap } from '../symbols/model';
import { keyringFields, keyringFrom } from './keyring';
import { stem } from './shared';
import type { DesignLayer, KeyringSpec, PartInput } from '../engine/types';
import { num, str, type TemplateDef } from './types';

type Pt = [number, number];
type Side = 1 | -1;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// ------------------------------------------------------------------------ the numbers --

/** The finished air between a knob and its socket, per side, mm — §1.3's loose slide for a joint
 *  taken apart and put back every day (0.3–0.5 mm total). The DRAWN gap is this less the kerf… */
export const CLEARANCE = 0.2;
/** …but never under this, mm, whatever the Kerf field says (2026-09-28): a knob is never drawn
 *  over its socket, and a field set higher than the real beam never cuts a pair that will not go
 *  together. See THE FLOOR in the header for what it costs a truly wide beam. */
export const GAP_MIN = 0.05;
/** How far under the hearts' lobe centres the seam runs, as a share of the heart's width. */
export const SINK = 0.275;
/** The round where the seam meets a heart's flank: the nose of the lip under each lobe, and the
 *  two base corners of the V. */
const BASE_ROUND = 0.3;
/** The round at the heart's point — the right knob's tip, and the engraved left heart's. */
const TIP_ROUND = 0.6;
/** The round in the heart's cleft — the other bar's tongue there stays ≥ 1 mm after the kerf. */
const CLEFT_FILLET = 0.6;
/** Point to lobe centres, as a share of the heart's width (the blank heart is 0.63). */
const HEART_LENGTH = 0.65;
/** Air between the two lobe circles, mm — under CLEFT_FILLET, so the round still bridges them. */
const LOBE_SPREAD = 0.3;
/** Wood between the right heart and the bars' right end, mm. */
export const END_WALL = 4;
/** Air between the two hearts' outlines, mm: close enough to read as a pair. */
const HEART_GAP = 1.5;
/** Straight seam kept between the V's foot and the start of the bars' corner round, mm. */
const SHOULDER = 2;
/** The engraved half of each heart: its line, mm. It runs right up to its bar's cut. */
export const LINE = 0.4;
/** Air between the two bars on the cut sheet — §2.5's floor between two cut paths. */
const SHEET_GAP = 3;
/** Ink to the bar's long edges and to its right end, mm. */
const EDGE_MARGIN = 3;
const END_MARGIN = 3.5;
/** Ink to a socket, and to the keyring hole's own border, mm. */
export const NAME_AIR = 1.5;
/** A capital under this stops reading once it is burnt into wood. */
const MIN_CAP = 3;
/** Arc sampling, radians — 4.5° a step keeps the chord within 0.002 mm of a 2 mm lobe. */
const ARC_STEP = Math.PI / 40;

/** Faces for a name engraved along a 25 mm bar. The reference is a flowing script; the list is
 *  the scripts that still read at the 6–11 mm letter these bars set (every one built and measured in
 *  tests/node/heart-puzzle-keychains.test.mjs, the fonts section) and two serifs for a plainer pair. */
const NAME_FACES = ['great-vibes', 'parisienne', 'allura', 'dancing-script', 'sacramento', 'alex-brush', 'playfair-display', 'cinzel'];

/** A heart typed into a name ("Anna ♥ Tom") is drawn by the design, not the font: none of the
 *  faces above has U+2665 or U+2764, nor does the fallback face, so it would engrave as the empty
 *  box a font puts where a glyph is missing. A 0.55 em heart centred on the lowercase. */
const TYPED_HEARTS: SymbolMap = Object.fromEntries(['♥', '❤'].map((char): [string, InlineSymbol] =>
  [char, { id: 'typed-heart', label: 'Heart', source: 'template', char, shapes: [[heartRing(1, 0.95)]], scale: 0.55, dx: 0, dy: 0, rotation: 0 }]));

// --------------------------------------------------------------------- curve sampling --

/** A point on the seam and the direction the seam runs there (a unit vector). The direction is
 *  what lets each bar's edge be the SAME curve moved along its normal. */
interface Sample { p: Pt; t: Pt }

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const unit = (a: Pt): Pt => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };

/** An arc round `c` from angle `a0` to `a1` (radians): counter-clockwise when `a1 > a0`. */
function arc(c: Pt, r: number, a0: number, a1: number): Sample[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / ARC_STEP));
  const dir = a1 >= a0 ? 1 : -1;
  const out: Sample[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ p: [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)], t: [-Math.sin(a) * dir, Math.cos(a) * dir] });
  }
  return out;
}

/** A straight run from `a` to `b`. */
function line(a: Pt, b: Pt): Sample[] {
  const t = unit(sub(b, a));
  return [{ p: a, t }, { p: b, t }];
}

/** Runs joined end to start. The pieces meet tangentially, so a shared end point is kept once. */
function chain(...runs: Sample[][]): Sample[] {
  const out: Sample[] = [];
  for (const run of runs) {
    for (const s of run) {
      const last = out[out.length - 1];
      if (last && Math.hypot(last.p[0] - s.p[0], last.p[1] - s.p[1]) < 1e-7) continue;
      out.push(s);
    }
  }
  return out;
}

/** The curve moved `d` to the LEFT of the way it runs (negative: to the right). Exact for lines
 *  and arcs, because every sample carries the curve's own tangent rather than a chord's. */
const offsetCurve = (curve: Sample[], d: number): Pt[] =>
  curve.map(({ p, t }) => [p[0] - d * t[1], p[1] + d * t[0]]);

// ------------------------------------------------------------------------- the heart --

/** One upright heart standing on the seam, and the two halves the seam and the engraving make
 *  of it. Everything is in the heart's own frame: centred on x = 0, the seam on y = 0. */
export interface Heart {
  /** The seam OVER the lobes, left base to right base: the knob of the bar below the seam. */
  lobes: Sample[];
  /** The seam UNDER the point, left base to right base: the knob of the bar above the seam. */
  point: Sample[];
  /** The heart's own outline above the seam and below it, flank to flank, from each point where
   *  the seam's round leaves the flank — what the engraving draws of the half the seam does not.
   *  Each starts and ends where the seam takes the outline over, so the engraving meets the cut
   *  (`engravedHalf`, then trimmed to its bar). */
  upper: Pt[];
  lower: Pt[];
  /** How far the heart stands above the seam line (its lobes' tops) and below it (its point). */
  reachUp: number;
  reachDown: number;
  /** Half the heart's width where the seam crosses it (the knob's neck, the V's root), at its
   *  lobes, and the half-width of each knob's footprint on the seam line, rounds included. */
  cross: number;
  half: number;
  footLobes: number;
  footPoint: number;
}

/**
 * The heart: two lobes of radius r, LOBE_SPREAD apart, their centres SINK·W above the seam; a
 * point HEART_LENGTH·W below them; flanks tangent to the lobes. The two lobes stand apart rather
 * than touching so the cleft's round sits deeper between them, and the heart keeps a cleft a sixth
 * of its width deep instead of losing it to the round. The flank's lean β from the vertical is the
 * lobe centre's bearing from the point plus the tangent's own angle.
 *
 * Over the lobes the seam leaves the straight line through a BASE_ROUND fillet, climbs the left
 * flank, goes over the left lobe, dips through the rounded cleft, over the right lobe and down,
 * and fillets back onto the line. Under the point it turns down the left flank through the same
 * round, round the TIP_ROUND point and back up. Every piece meets the next tangentially, so
 * moving the curve along its normal is exact (`offsetCurve`).
 */
export function heart(width: number): Heart {
  const r = (width / 2 - LOBE_SPREAD) / 2;
  const d = r + LOBE_SPREAD;
  const D = HEART_LENGTH * width;
  const beta = Math.atan(d / D) + Math.asin(r / Math.hypot(d, D));
  const [sb, cb] = [Math.sin(beta), Math.cos(beta)];
  const yc = SINK * width;
  const X0 = (D - yc) * Math.tan(beta);
  const mirror = (p: Pt): Pt => [-p[0], p[1]];
  const corner: Pt = [-X0, 0];

  // The lobes and the cleft between them, left flank's tangent point to the right one's.
  const TL: Pt = [-d - r * cb, yc - r * sb];
  // The cleft's round touches both lobes: its centre is r + CLEFT_FILLET from each lobe centre.
  const t = Math.sqrt((r + CLEFT_FILLET) ** 2 - d * d);
  const phi = Math.atan2(t, d);
  const top = chain(
    arc([-d, yc], r, Math.PI + beta, phi),
    arc([0, yc + t], CLEFT_FILLET, -Math.PI + phi, -phi),
    arc([d, yc], r, Math.PI - phi, -beta),
  );
  // The point, rounded: the round's centre is on the axis, TIP_ROUND/sin β above the sharp point.
  const tipC: Pt = [0, yc - D + TIP_ROUND / sb];
  const TT: Pt = [-TIP_ROUND * cb, tipC[1] - TIP_ROUND * sb];
  const bottom = arc(tipC, TIP_ROUND, Math.PI + beta, 2 * Math.PI - beta);

  // Where the seam meets a flank it turns by α = 90° − β (48° here), either way.
  const alpha = Math.PI / 2 - beta;
  // Over the lobes: the turn's inside is the OTHER bar's lip, a 48° wedge under the lobe; its
  // round sits in the wedge, on the bisector of the seam running left and the flank running up.
  const up: Pt = [-sb, cb];
  const F = add(corner, mul(unit(add([-1, 0], up)), BASE_ROUND / Math.sin(alpha / 2)));
  const lipTangent = BASE_ROUND / Math.tan(alpha / 2);
  const T2 = add(corner, mul(up, lipTangent));
  if (lipTangent > Math.hypot(TL[0] - corner[0], TL[1] - corner[1])) throw new Error('heart: the lip round overruns the flank');
  const lobes = chain(
    arc(F, BASE_ROUND, -Math.PI / 2, beta),
    line(T2, TL),
    top,
    line(mirror(TL), mirror(T2)),
    arc(mirror(F), BASE_ROUND, Math.PI - beta, (3 * Math.PI) / 2),
  );
  // Under the point: an obtuse 132° corner of the bar below, rounded only so the curve stays one
  // tangent line (a sharp corner has no normal to move it along).
  const vTangent = BASE_ROUND * Math.tan(alpha / 2);
  const Fv: Pt = [-X0 - vTangent, -BASE_ROUND];
  const B2: Pt = [-X0 + sb * vTangent, -cb * vTangent];
  const point = chain(
    arc(Fv, BASE_ROUND, Math.PI / 2, beta),
    line(B2, TT),
    bottom,
    line(mirror(TT), mirror(B2)),
    arc(mirror(Fv), BASE_ROUND, Math.PI - beta, Math.PI / 2),
  );

  return {
    lobes,
    point,
    // Above the seam line, the lobes (the RIGHT heart's, engraved on the top bar): from B2, where
    // the V's base round leaves the flank just under the line, up through the corner. Below it,
    // the point (the LEFT heart's, on the bottom bar): from T2, where the lip's round leaves the
    // flank just over the line, down through the corner. Everything past those points IS the seam.
    upper: [B2, corner, ...top.map((s) => s.p), mirror(corner), mirror(B2)],
    lower: [T2, corner, ...bottom.map((s) => s.p), mirror(corner), mirror(T2)],
    reachUp: yc + r,
    reachDown: D - yc - TIP_ROUND / sb + TIP_ROUND,
    cross: X0,
    half: d + r,
    footLobes: X0 + lipTangent,
    footPoint: X0 + vTangent,
  };
}

const shiftX = (samples: Sample[], dx: number): Sample[] => samples.map(({ p, t }) => ({ p: [p[0] + dx, p[1]], t }));

// -------------------------------------------------------------------------- the seam --

/** Where the two hearts sit on a pair of bars `length` long, and the seam that carries them. */
export interface Seam {
  curve: Sample[];
  heart: Heart;
  /** Centre of the LEFT heart (its lobes a knob of the bottom bar) and the RIGHT one (its point
   *  a knob of the top bar), in the pair's frame. */
  xLeft: number;
  xRight: number;
  /** The biggest corner radius that keeps the seam straight where it meets the bars' ends. */
  maxCorner: number;
}

export function seamCurve(length: number, width: number, corner: number): Seam {
  const h = heart(width);
  const half = length / 2;
  const xRight = half - END_WALL - h.half;
  const xLeft = xRight - 2 * h.half - HEART_GAP;
  // The bars' corners stop SHOULDER short of the V's foot: the bottom bar's wood between the V
  // and a round corner is then ≥ 3.7 mm across 0.3 mm under the seam, and wider below it.
  const maxCorner = Math.max(0, half - (xRight + h.footPoint) - SHOULDER);
  const rc = Math.min(corner, maxCorner);
  const curve = chain(
    line([-half + rc, 0], [xLeft - h.footLobes, 0]),
    shiftX(h.lobes, xLeft),
    line([xLeft + h.footLobes, 0], [xRight - h.footPoint, 0]),
    shiftX(h.point, xRight),
    line([xRight + h.footPoint, 0], [half - rc, 0]),
  );
  return { curve, heart: h, xLeft, xRight, maxCorner };
}

/**
 * The half of a heart the seam does not draw, as a LINE-wide engraved stroke: the heart's outline
 * (`path`, pair frame — `Heart.upper` or `.lower`, placed) walked in 0.05 mm steps and stroked,
 * from one point where the seam takes the outline over to the other.
 *
 * Its ends reach the seam's own curve, so half of each butt end lies past the bar's cut: the layer
 * carries its bar as `keep`, and the engine's intersect trims it exactly ON the cut (2026-09-28).
 * Nothing is left outside the bar for the "runs past the edge" net to count — the trim happens
 * before it looks.
 */
export function engravedHalf(path: Pt[]): Shapes {
  const step = 0.05;
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  pts.push(path[path.length - 1]!);
  return pts.length >= 2 ? [[strokeRing(pts, LINE)]] : [];
}

/** A quarter of a corner, from angle `a0` counter-clockwise, as points. */
const quarter = (c: Pt, r: number, a0: number): Pt[] =>
  r <= 0 ? [[c[0], c[1]]] : arc(c, r, a0, a0 + Math.PI / 2).map((s) => s.p);

/**
 * One bar's outline, counter-clockwise. The TOP bar (`side` 1) runs along the seam left to right
 * as its bottom edge; the BOTTOM bar (−1) runs it right to left as its top edge. Either way the
 * seam is moved `gap/2` into the bar's own material, so the two bars stand exactly `gap` apart
 * along the whole of it.
 */
export function barRing(seam: Seam, side: Side, length: number, height: number, corner: number, gap: number): CutRing {
  const half = length / 2;
  const rc = Math.min(corner, seam.maxCorner, height / 2);
  const g = gap / 2;
  // Left of the seam's direction of travel is UP: the top bar's edge moves up, the bottom's down.
  const edge = offsetCurve(seam.curve, side * g);
  if (side > 0) {
    const y0 = g;
    const y1 = g + height;
    return closed([
      ...edge,
      ...quarter([half - rc, y0 + rc], rc, -Math.PI / 2),
      ...quarter([half - rc, y1 - rc], rc, 0),
      ...quarter([-half + rc, y1 - rc], rc, Math.PI / 2),
      ...quarter([-half + rc, y0 + rc], rc, Math.PI),
    ]);
  }
  const y0 = -g - height;
  const y1 = -g;
  return closed([
    ...quarter([-half + rc, y0 + rc], rc, Math.PI),
    ...quarter([half - rc, y0 + rc], rc, -Math.PI / 2),
    ...quarter([half - rc, y1 - rc], rc, 0),
    ...edge.slice().reverse(),
    ...quarter([-half + rc, y1 - rc], rc, Math.PI / 2),
  ]);
}

/** A ring with no point repeated — a corner arc starts exactly where the seam ended, and the
 *  last corner ends where the ring began. */
function closed(points: Pt[]): CutRing {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push(p);
  }
  const first = out[0];
  const end = out[out.length - 1];
  if (first && end && out.length > 1 && Math.hypot(first[0] - end[0], first[1] - end[1]) <= 1e-6) out.pop();
  return out as CutRing;
}

// ------------------------------------------------------------------------- the names --

interface Rect { minX: number; minY: number; maxX: number; maxY: number }

/** Where a name goes and how big: scale `k` about its own ink centre, then centre it on (x, y). */
interface NameFit { k: number; x: number; y: number }

/**
 * The lowest (`toward` −1) or highest (+1) point of the ink over a band of x — the ink the socket
 * would meet. Every segment is clipped to the band, so a long stroke that crosses it with both
 * ends outside still counts. Relative to the ink's own centre, unscaled.
 */
function inkEdgeOver(segs: [Pt, Pt][], x0: number, x1: number, toward: Side): number {
  let best = toward > 0 ? -Infinity : Infinity;
  const take = (y: number) => { best = toward > 0 ? Math.max(best, y) : Math.min(best, y); };
  for (const [a, b] of segs) {
    const lo = Math.min(a[0], b[0]);
    const hi = Math.max(a[0], b[0]);
    if (hi < x0 || lo > x1) continue;
    if (hi - lo < 1e-12) { take(a[1]); take(b[1]); continue; }
    for (const x of [Math.max(lo, x0), Math.min(hi, x1)]) take(a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]));
  }
  return best;
}

/**
 * A name as big as `room` allows (never bigger than it was set), centred in it — then kept off
 * the socket. The socket sits against the seam at one end of the name's room, so a name that
 * would run over it first SLIDES away from the seam, as far as the far margin lets it, and only
 * then shrinks. `seam` says which
 * way the seam is from the room: −1 below it (the top bar), +1 above (the bottom bar).
 */
export function placeName(ink: Shapes, room: Rect, keepOut: Rect, seam: Side): NameFit {
  const b = bboxOf(ink);
  const w = Math.max(b.maxX - b.minX, 1e-6);
  const h = Math.max(b.maxY - b.minY, 1e-6);
  const icx = (b.minX + b.maxX) / 2;
  const icy = (b.minY + b.maxY) / 2;
  const segs: [Pt, Pt][] = [];
  for (const island of ink) {
    for (const ring of island) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const z = ring[(i + 1) % ring.length]!;
        segs.push([[a[0] - icx, a[1] - icy], [z[0] - icx, z[1] - icy]]);
      }
    }
  }
  const x = (room.minX + room.maxX) / 2;
  const y = (room.minY + room.maxY) / 2;
  let k = Math.min(1, (room.maxX - room.minX) / w, (room.maxY - room.minY) / h);
  for (let i = 0; i < 120 && k > 0.02; i++, k *= 0.97) {
    // The band of x the socket occupies, in the ink's own unscaled frame at this scale.
    const edge = inkEdgeOver(segs, (keepOut.minX - x) / k, (keepOut.maxX - x) / k, seam);
    if (!Number.isFinite(edge)) return { k, x, y };
    // How far the name must move away from the seam to clear the socket, and how far it may.
    const need = seam < 0 ? keepOut.maxY - (y + k * edge) : y + k * edge - keepOut.minY;
    const slack = (room.maxY - room.minY - h * k) / 2;
    if (need <= slack + 1e-9) return { k, x, y: y - seam * Math.max(0, need) };
  }
  return { k, x, y };
}

/** Ink moved by a fit: scaled about `centre`, then centred on the fit's point. */
const applyFit = (shapes: Shapes, centre: Pt, f: NameFit): Shapes =>
  shapes.map((island) => island.map((ring) => ring.map(([px, py]) => [(px - centre[0]) * f.k + f.x, (py - centre[1]) * f.k + f.y] as Pt) as CutRing));

// ---------------------------------------------------------------------- the template --

export const heartPuzzleKeychains: TemplateDef = {
  id: 'heart-puzzle-keychains',
  name: 'Heart puzzle keychains',
  blurb: 'Two name bars that lock together with a pair of hearts.',
  tags: ['couple', 'keychain', 'engrave + cut'],
  fields: [
    // ------------------------------------------------------------------ RIGHT --
    {
      kind: 'text', key: 'name1', label: 'Name 1', panel: 'right', section: 'Names',
      value: 'Isabella', maxLength: 24, placeholder: 'On the top bar',
    },
    {
      kind: 'text', key: 'name2', label: 'Name 2', panel: 'right', section: 'Names',
      value: 'Benjamin', maxLength: 24, placeholder: 'On the bottom bar',
    },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'great-vibes', recommended: NAME_FACES, previewFrom: 'name1' },

    // ------------------------------------------------------------ LEFT: "Size" --
    // Both ends of every slider build the shipped pair with nothing to say (G25, swept in the
    // suite): at 50 × 20 mm the default names still set a ≥ 3 mm capital clear of the hearts, and
    // past 90 mm the pair is a ruler, not a keychain.
    { kind: 'number', key: 'width', label: 'Length', section: 'Size', value: 66, min: 50, max: 90, step: 1, unit: 'mm' },
    { kind: 'number', key: 'height', label: 'Height', section: 'Size', value: 25, min: 20, max: 32, step: 1, unit: 'mm' },
    // 8 mm is the photo's heart, 0.32 of the bar. Below 6.5 the lock under the lobes drops under
    // 0.5 mm a side at a 0.2 mm finish (0.48 at the shipped kerf's 0.23 since the floor, 2026-09-28);
    // past 10 the pair of hearts outgrows a 20 mm bar's names.
    { kind: 'number', key: 'heartSize', label: 'Heart size', section: 'Size', value: 8, min: 6.5, max: 10, step: 0.5, unit: 'mm' },

    // --------------------------------------------------------- LEFT: "Keyring" --
    // The shared control, Loop tab | None, its tab RESTING inside each bar's left end where the
    // reference hangs it from a hole (Hole was an option here from 2026-09-22 to 2026-09-28) —
    // and the tag's own numbers (G25): §5.2's 3 mm border, a hole no bigger than a split ring
    // wants, and a nudge of half the bar so the ring reaches any point ON it.
    ...keyringFields('outside', {
      rest: 'inside', dia: 4, ring: 3, side: 'left', along: 50, nudge: 33, maxDia: 6, maxRing: 5,
      ringNote: 'Both bars wear the same ring, mirrored.',
    }),

    // ------------------------------------------------------ LEFT: "More options" --
    // 4 at most: past ~3–3.5 mm (by heart size) the corner would reach the V (`SHOULDER`) and stops.
    { kind: 'number', key: 'corner', label: 'Corner radius', section: 'Size', value: 2.5, min: 0, max: 4, step: 0.5, unit: 'mm', advanced: true },
    {
      kind: 'number', key: 'nameSize', label: 'Name size', section: 'Size', value: 11, min: 6, max: 16, step: 0.5, unit: 'mm', advanced: true,
      help: 'Long names shrink past this to fit.',
    },
    {
      // The kerf sets how the knobs are drawn against their sockets, so the fit lands on 0.2 mm a
      // side whatever the machine burns — up to a 0.15 mm beam; past that the drawn air stays at
      // GAP_MIN, so a field set higher than the beam never cuts a pair too tight to go together.
      kind: 'number', key: 'kerf', label: 'Kerf', section: 'Material', value: 0.18,
      min: 0.05, max: 0.4, step: 0.01, unit: 'mm', advanced: true,
      help: 'The width the laser burns away.',
    },
  ],

  async build(v) {
    const warnings: string[] = [];
    const length = clamp(num(v, 'width'), 40, 120);
    const height = clamp(num(v, 'height'), 16, 40);
    const heartSize = clamp(num(v, 'heartSize'), 6, 14);
    const kerf = clamp(num(v, 'kerf'), 0.01, 1);
    const size = clamp(num(v, 'nameSize'), 3, 20);
    const font = str(v, 'font');
    const symbols: SymbolMap = { ...readSymbols(v), ...TYPED_HEARTS };
    // The drawn air between the bars: the cut takes kerf/2 off each edge, so this lands on
    // CLEARANCE a side once cut — never drawn under GAP_MIN, so never over the socket and never
    // tight on a beam finer than the field says (THE FLOOR, in the header).
    const gap = Math.max(GAP_MIN, CLEARANCE - kerf);
    const g = gap / 2;

    // --------------------------------------------------------------- the two bodies --
    // The corner may not reach the hearts: the seam has to meet each end of the bars straight.
    const asked = clamp(num(v, 'corner'), 0, height / 2);
    const seam = seamCurve(length, heartSize, asked);
    const h = seam.heart;
    const corner = Math.min(asked, seam.maxCorner);
    const topBody: Shapes = [[barRing(seam, 1, length, height, corner, gap)]];
    const bottomBody: Shapes = [[barRing(seam, -1, length, height, corner, gap)]];

    // ------------------------------------------------------------ the engraved halves --
    // Each bar finishes the heart whose other half is its own knob: the top bar the RIGHT heart's
    // lobes, above its point; the bottom bar the LEFT heart's point, below its lobes.
    // Each is trimmed to its own bar (`keep`), which is what lands its ends on the cut.
    const shiftPts = (pts: Pt[], dx: number): Pt[] => pts.map(([x, y]) => [x + dx, y]);
    const heartLine = (id: string, shapes: Shapes, bar: Shapes): DesignLayer[] =>
      shapes.length ? [{ id, label: 'Heart', shapes, op: 'engrave', kind: 'detail', keep: bar }] : [];
    const topHeart = heartLine('heart-top', engravedHalf(shiftPts(h.upper, seam.xRight)), topBody);
    const bottomHeart = heartLine('heart-bottom', engravedHalf(shiftPts(h.lower, seam.xLeft)), bottomBody);

    // ---------------------------------------------------------------- the two rings --
    // The shared Ring control, resting at the middle of the TOP bar's left end — inside it, where
    // the hole was, or (a Loop tab saved before 2026-09-28) standing off the end. It rests there by
    // name (`rest`) because `side`/`along` measure the outline's box, and the top bar's box
    // reaches down its heart's point, below the bar's own edge. The drag and the pad
    // move it from there (`ringDx`/`ringDy`). A saved `ringPos` — a fraction round the outline,
    // which the editor no longer writes — is NOT honoured: round this outline it runs along the
    // seam, where a ring breaks a heart and a tab would sit inside the other bar. The bottom bar
    // is a part carrying the same spec at the mirror of wherever the top one settled, across the
    // seam, so the two bars wear the same tab and cannot drift apart.
    const keyring: KeyringSpec = { ...keyringFrom(v), position: -1 };
    const inside = keyring.enabled && keyring.restInside === true;
    const rest: Pt = inside
      ? [-length / 2 + keyring.ring + keyring.dia / 2, g + height / 2]
      : [-length / 2 - keyring.dia / 2 - keyring.ring / 2, g + height / 2];
    if (keyring.enabled) keyring.rest = rest;
    const topHole: Pt | null = keyring.enabled ? finalHoleCentre(topBody, keyring).centre : null;
    const atRest: KeyringSpec = { ...keyring, position: -1, dx: 0, dy: 0 };
    const bottomRing: PartInput['keyring'] = topHole ? { ...atRest, rest: [topHole[0], -topHole[1]] } : 'none';

    // ---------------------------------------------------------------- the lettering --
    // The name's room: from the ring's own border when it rests inside the bar (where it RESTS —
    // the layout is the design's, the drag is the customer's) to the right margin, between the
    // long edges' margins. The
    // hearts are the one thing inside that room the name has to keep off: on the top bar the
    // left heart's socket and the right heart's engraved lobes, on the bottom bar the left
    // heart's engraved point and the right heart's V — each box grown by the wider of the stroke
    // and the drawn air, then NAME_AIR.
    const left = inside ? rest[0] + keyring.dia / 2 + keyring.ring + NAME_AIR : -length / 2 + END_MARGIN;
    const right = length / 2 - END_MARGIN;
    const rim = Math.max(g, LINE / 2) + NAME_AIR;
    const hearts = (side: Side): Rect => side > 0
      ? { minX: seam.xLeft - h.half - rim, maxX: seam.xRight + h.half + rim, minY: -Infinity, maxY: h.reachUp + rim }
      : { minX: seam.xLeft - h.cross - rim, maxX: seam.xRight + h.footPoint + rim, minY: -h.reachDown - rim, maxY: Infinity };
    const floorSize = await sizeForCapHeight(font, MIN_CAP);

    const nameLayers = async (side: Side): Promise<DesignLayer[]> => {
      // U+FE0F asks for the emoji look of the ❤ before it; it has no glyph of its own anywhere.
      const text = str(v, side > 0 ? 'name1' : 'name2').replace(/️/g, '').trim();
      if (!text) return [];
      const id = side > 0 ? 'name-top' : 'name-bottom';
      const built = await textLayer({ text, font, size, x: 0, y: 0, symbols }, 'engrave', id, 'Name');
      const ink = built.flatMap((l) => l.shapes);
      if (!ink.length) return [];
      const b = bboxOf(ink);
      const room: Rect = side > 0
        ? { minX: left, maxX: right, minY: g + EDGE_MARGIN, maxY: g + height - EDGE_MARGIN }
        : { minX: left, maxX: right, minY: -g - height + EDGE_MARGIN, maxY: -g - EDGE_MARGIN };
      const fit = placeName(ink, room, hearts(side), side > 0 ? -1 : 1);
      // It always fits; the sentence says when that cost it its legibility — a name clipped at
      // the edge or run into a heart is worse than a small one.
      if (size * fit.k < floorSize - 1e-6) warnings.push('The names only fit under 3 mm — shorten them, or lengthen the bars.');
      const centre: Pt = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
      return built.map((l) => ({ ...l, shapes: applyFit(l.shapes, centre, fit) }));
    };

    // ---------------------------------------------------------------- the two pieces --
    const bottomPart: PartInput = {
      id: 'bottom',
      label: 'Bottom',
      blank: { kind: 'shape', shapes: bottomBody, oneIsland: true },
      layers: [...(await nameLayers(-1)), ...bottomHeart],
      keyring: bottomRing,
      // Cut apart, glued up as built: the card and the 3D view show the pair locked together.
      assembledAt: 'built',
      material: 'light',
    };

    return {
      label: 'Top',
      blank: { kind: 'shape', shapes: topBody, oneIsland: true },
      keyring,
      // The bar without its heart: the top bar's box reaches down its heart's point, which put
      // the drag's horizontal centre line 1.35 mm under the bar's middle — under where the ring
      // rests, too. This box's middle is the bar's own, `rest[1]` above.
      snapBox: { minX: -length / 2, maxX: length / 2, minY: g, maxY: g + height },
      layers: [...(await nameLayers(1)), ...topHeart],
      parts: [bottomPart],
      layout: { flow: 'column', gap: SHEET_GAP },
      material: 'light',
      // Both bars are lettered by the same code, so a sentence about the names is said once.
      ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}),
    };
  },

  exportNote: 'Cut both bars — the hearts lock them together.',

  fileName: (v) => stem(str(v, 'name1').toLowerCase() || 'one', str(v, 'name2').toLowerCase() || 'two', 'keychains'),
};

import { readSymbols } from '../symbols/model';
// Sports bag tags — one template per ball, each a fixed two-layer build: the bottom is the ball,
// with its markings engraved; the second layer is the name and the number, both welded to the
// frame.
//
// What this replaces: `sports-bag-tag.ts`, one template with a Ball thumbs picker whose five
// tiles were one football and four identical discs, a name and a number welded into a lump on
// the ball's face, and the loop tab dragged wherever. Four templates now, one ball each, and
// the ball is the gallery card rather than a dropdown.
//
// The two pieces, always, one origin:
//
//   BACKER  the ball's own silhouette from the DARK sheet, carrying the marks that make it that
//           ball (a basketball's seams, a baseball's stitches, a soccer ball's panels, a
//           football's seams and stripes) and the hanging hole — the football's on a loop tab. Never any lettering in Raised mode:
//           what the eye reads first is the light piece on top.
//   FRAME   the primary, from the LIGHT sheet: the same silhouette as a constant-width RIM, with
//           the name across the window and the number below it WELDED into the ring where they
//           touch it (the union is one island, a weld-and-score construction) — one cut
//           outline, with each letter's own
//           edge SCORED where it crosses the ring and where it runs into the next letter, so the
//           name reads as sitting on the frame (see "the pieces" in `buildTag`).
//           A football's laces are welded into the ring the same way, centred at the top of
//           the window. (Its frame is a thin 4 mm band; see `FOOTBALL`.)
//
// Text need not be a single body, since people glue it on anyway: where the name
// cannot reach the ring — a long name on a shallow football, a block face whose word is too deep
// for the window's ends — it becomes its OWN light piece, centred in the window with
// `assembledAt` and a scored glue guide on the backer. Never a bridge bar across the window.
//
// The numbers, all derived from Size, because each has exactly one right answer once the
// customer has said how big the tag is (Ø 85 mm default; 75–89 mm is the sourced range for a
// round ball tag). At Ø 85 with a 3 mm hole:
//   rim        = max(rimWidthFor(D), holeDia + 2 × WALL)      → 7.0 mm
//   window     = the ball's TRUE offset by the rim            → 71.0 × 71.0
//   hole       = Ø 3 on the rim's centre line at the top      → 2.0 mm of wall on both sides
//   bite       = 0.45 × rim, 2–4 mm                           → 3.2 mm of welded overlap
//   number ink = 0.24 × the window's height + the bite        → 20.2 mm, 17.0 of it in the window
// The football is its own (`FOOTBALL`): 85 × 58.6 mm with 4.0 mm tips, a 4.0 mm rim, a window of
// 77.0 × 50.6, the name biting 1.0 mm, the number 1.4 mm and 15.1 mm of ink, on a loop tab.
import {
  bboxOf,
  blankById,
  blankDetail,
  circleRing,
  placeShapes,
  signedArea,
  strokeRing,
  type BlankParams,
  type Box,
  type Pt,
  type Shapes,
} from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { rimWidthFor } from '../engine/frame';
import { sizeForCapHeight, textMetrics } from '../engine/metrics';
import { MIN_COUNTER, textLayer } from '../engine/text';
import type { BuildInput, DesignLayer, KeyringSpec, PartInput } from '../engine/types';
import { NO_KEYRING, hangHoleFields } from './keyring';
import {
  WELDING_SCRIPTS,
  connectSpec,
  countersTooTight,
  letterScoreField,
  lightPieceFields,
  stem,
} from './shared';
import { num, str, type Field, type TemplateDef, type Values } from './types';

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const more = (f: Field): Field => ({ ...f, advanced: true });

/** Material left round the hanging hole, mm. §5.2/§5.4 of the laser reference: 2 mm is real
 *  shipped precedent on plywood, and the rim is GROWN to hold it rather than the hole being
 *  slid inward to find its own border. */
const WALL = 2;
/** How far any ink stays inside the ball's own outer edge, mm. */
const EDGE = 1.5;
/** How much window a name that could NOT reach the ring keeps between itself and the rim, mm —
 *  it is a separate piece then, and a piece glued 2 mm off the frame still reads as centred. */
const CLEAR = 2;
/** Below this a welded letter stops reading as a letter. */
const MIN_CAP = 3;
/** How far inside a light piece's own edge its glue guide is scored, so the line disappears
 *  under the piece that is glued over it. */
const GUIDE_INSET = 0.3;

/** How deep welded ink runs into the ring, mm: enough that the weld survives kerf on both edges
 *  and reads as a join rather than a kiss, never so deep that the ink reaches the outer edge. */
const biteFor = (rim: number) => clamp(0.45 * rim, 2, 4);
/** Air between the name, the number and a football's laces, mm. */
const gapFor = (D: number) => Math.max(1.5, 0.02 * D);
/** The bar that holds an i's dot to the rest of a welded word, mm (G33: 1.5–3). */
const bridgeFor = (size: number) => Math.min(3, Math.max(1.5, 0.12 * size));

/**
 * The faces this design is for, in order (G2). `WELDING_SCRIPTS` first — the four bundled faces
 * measured to write as ONE connected line, so a name set in them is the glyph outlines exactly
 * as the type designer drew them, with no overlap walk and no seams to score (G33). That is what
 * a bag tag like this is set in: a flowing script welded to the ring.
 *
 * Then three fat rounded faces for a block name, which weld and score instead. Each was built
 * here at the card's own name and at "Alexandra" before it was listed: one island, counters
 * open, and the ring still one piece.
 */
const TAG_FACES = [...WELDING_SCRIPTS, 'fredoka', 'baloo-2', 'lilita-one'];
/** Jersey numerals: heavy, condensed, flat-footed — a flat foot is also what welds cleanly into
 *  the bottom of the ring. The name's script last, for anyone who wants the two to match. */
const NUMBER_FACES = ['anton', 'bebas-neue', 'oswald', 'staatliches', 'fjalla-one', 'pacifico'];

// ------------------------------------------------------------------- the ball, as geometry --

/**
 * Every ball this design ships is a LENS: the intersection of two discs of radius `r` centred at
 * (0, ∓cy). A round ball is the degenerate case, cy = 0.
 *
 * This is what lets the frame be cut on the main thread. Erosion distributes over intersection —
 * (A ∩ B) ⊖ D = (A ⊖ D) ∩ (B ⊖ D) — so the window is the SAME lens with `r − rim`, exactly, with
 * no offset pass in the worker and no scaled-down copy of the outline pretending to be one. The
 * difference matters on the football: at Ø 85 a 7 mm rim takes 7 mm off the ball's height and
 * 8.4 mm off each pointed end, which is what a true offset does and a scale never can.
 */
interface Lens {
  /** Half-width and half-height of the OUTLINE, mm (with rounded tips, of the rounded one). */
  halfW: number;
  halfH: number;
  /** The two disc centres' y offset, and their radius. */
  cy: number;
  r: number;
  /**
   * The football's tips, rounded (2026-09-26: ours was a sharp
   * lemon). The outline is then the lens OPENED by a disc of radius `round` — eroded by it and
   * grown back — which is the same two arcs with each point replaced by an arc of radius
   * `round`. `core` is the lens eroded by `round`, the one the rounding is grown from.
   *
   * Everything below stays exact because the lens is convex: eroding the opened shape by `d` is
   * opening the eroded lens by `round − d`, and once `d ≥ round` it is simply the eroded lens —
   * so a rim at least as wide as the rounding leaves a window with the lens's own sharp tips,
   * and the rim is the same width all the way round, tips included.
   */
  round?: number;
  core?: Lens;
}

/** The lens with `halfW × halfH`, from the standard chord identity. */
function lensOf(halfW: number, halfH: number): Lens {
  const cy = Math.abs(halfW - halfH) < 1e-9 ? 0 : (halfW * halfW - halfH * halfH) / (2 * halfH);
  return { halfW, halfH, cy, r: halfH + cy };
}

/** A lens whose OUTLINE is `halfW × halfH` with its two tips rounded by `round`: the core lens
 *  is `halfW − round × halfH − round`, and the outline is that grown back by `round`. */
function roundedLensOf(halfW: number, halfH: number, round: number): Lens {
  if (round <= 0) return lensOf(halfW, halfH);
  const core = lensOf(halfW - round, halfH - round);
  return { halfW, halfH, cy: core.cy, r: core.r + round, round, core };
}

/** The same lens eroded by `d` — its own radius less `d`, the centres untouched. Null when the
 *  erosion has swallowed it. A rounded lens loses `d` of its rounding with it. */
function erode(lens: Lens, d: number): Lens | null {
  const r = lens.r - d;
  if (r <= lens.cy + 0.5) return null;
  const sharp: Lens = { halfW: Math.sqrt(Math.max(0, r * r - lens.cy * lens.cy)), halfH: r - lens.cy, cy: lens.cy, r };
  const round = (lens.round ?? 0) - d;
  if (!lens.core || round <= 0) return sharp;
  return { ...sharp, halfW: lens.core.halfW + round, round, core: lens.core };
}

/** How far inside the lens a point lies, mm — negative outside. The window's edge is at `rim`,
 *  so `depth < rim` is the ring and `depth < 0` is off the ball. */
function depthIn(lens: Lens, p: Pt): number {
  if (lens.core && lens.round) {
    // The opened shape: inside the core, the core's depth plus the rounding (a convex set grown
    // by `round` is `round` deeper everywhere); outside it, the rounding less the gap.
    const d = depthIn(lens.core, p);
    return d >= 0 ? d + lens.round : lens.round - lensGap(lens.core, p);
  }
  const a = lens.r - Math.hypot(p[0], p[1] + lens.cy);
  if (lens.cy === 0) return a;
  return Math.min(a, lens.r - Math.hypot(p[0], p[1] - lens.cy));
}

/** How far OUTSIDE a sharp lens a point lies: to the nearer arc where the point projects onto
 *  it, else to the nearer tip. */
function lensGap(lens: Lens, p: Pt): number {
  if (lens.cy === 0) return Math.hypot(p[0], p[1]) - lens.r;
  let best = Math.min(Math.hypot(p[0] - lens.halfW, p[1]), Math.hypot(p[0] + lens.halfW, p[1]));
  // The upper arc is the disc centred BELOW, and the other way round.
  for (const s of [-1, 1]) {
    const cy = s * lens.cy;
    const dist = Math.hypot(p[0], p[1] - cy);
    if (dist <= lens.r) continue;
    const q: Pt = [(p[0] * lens.r) / dist, cy + ((p[1] - cy) * lens.r) / dist];
    if (Math.hypot(q[0], q[1] + cy) <= lens.r + 1e-9) best = Math.min(best, dist - lens.r);
  }
  return best;
}

/** The lens as a ring, wound CCW: the top arc left to right over the top, then the bottom arc
 *  back under. A circle when `cy` is 0; with its tips rounded, a small arc round each tip. */
function lensRing(lens: Lens, n = 96): CutRing {
  if (lens.core && lens.round) return roundedLensRing(lens, n);
  if (lens.cy === 0) return circleRing(0, 0, lens.r, n);
  const t0 = Math.atan2(lens.cy, lens.halfW); // the right tip, seen from the lower centre
  const ring: CutRing = [];
  const steps = Math.max(8, Math.round(n / 2));
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((Math.PI - 2 * t0) * i) / steps;
    ring.push([lens.r * Math.cos(t), -lens.cy + lens.r * Math.sin(t)]);
  }
  for (let i = 1; i < steps; i++) {
    const t = t0 - Math.PI + ((Math.PI - 2 * t0) * i) / steps;
    ring.push([lens.r * Math.cos(t), lens.cy + lens.r * Math.sin(t)]);
  }
  return ring;
}

/** The rounded lens as a ring, CCW: the top arc, the left tip's arc, the bottom arc, the right
 *  tip's arc. Each tip's arc is centred on the core's tip and runs between the two arcs'
 *  normals there, so the outline is smooth (G1) where they meet. */
function roundedLensRing(lens: Lens, n: number): CutRing {
  const core = lens.core!;
  const rr = lens.round!;
  const t0 = Math.atan2(lens.cy, core.halfW);
  const steps = Math.max(8, Math.round(n / 2));
  const tip = Math.max(4, Math.round(n / 16));
  const ring: CutRing = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((Math.PI - 2 * t0) * i) / steps;
    ring.push([lens.r * Math.cos(t), -lens.cy + lens.r * Math.sin(t)]);
  }
  for (let i = 1; i < tip; i++) {
    const t = Math.PI - t0 + (2 * t0 * i) / tip;
    ring.push([-core.halfW + rr * Math.cos(t), rr * Math.sin(t)]);
  }
  for (let i = 0; i <= steps; i++) {
    const t = Math.PI + t0 + ((Math.PI - 2 * t0) * i) / steps;
    ring.push([lens.r * Math.cos(t), lens.cy + lens.r * Math.sin(t)]);
  }
  for (let i = 1; i < tip; i++) {
    const t = -t0 + (2 * t0 * i) / tip;
    ring.push([core.halfW + rr * Math.cos(t), rr * Math.sin(t)]);
  }
  return ring;
}

/**
 * A football's leather, as scored lines on the backer: what makes a brown oval read as a
 * football at a glance.
 *
 *   SEAMS    two arcs from tip to tip, meeting at the tips the way a real ball's seams do — the
 *            seams of the ball's panels, seen side-on. The upper one runs through `laceY`, right
 *            under the lace on the frame, so the laces sit on their own seam and it carries on
 *            past them to both tips; the lower one bows down, a little flatter.
 *   STRIPES  near each end, a band between two arcs that cross the ball from edge to edge and
 *            bow gently towards their tip — the painted stripes, following the curve of the end.
 *
 * Open runs, so the laser draws each in one pass. Every point keeps `INSET` of ball outside it;
 * a run that would reach nearer the edge is cut there.
 */
function footballLeather(lens: Lens, D: number, laceY: number): { seams: Pt[][]; stripes: Pt[][] } {
  const INSET = 0.8;
  const tipX = lens.halfW - 1.2;
  const inside = (path: Pt[]): Pt[][] => {
    const out: Pt[][] = [];
    let run: Pt[] = [];
    for (const q of path) {
      if (depthIn(lens, q) >= INSET) run.push(q);
      else { if (run.length > 1) out.push(run); run = []; }
    }
    if (run.length > 1) out.push(run);
    return out;
  };
  /** The circular arc through both tips with its apex at (0, apex). */
  const seam = (apex: number): Pt[] => {
    const s = Math.sign(apex);
    const R = (tipX * tipX + apex * apex) / (2 * Math.abs(apex));
    const c = apex - s * R;
    const a = Math.asin(Math.min(1, tipX / R));
    return Array.from({ length: 97 }, (_, i): Pt => {
      const t = -a + (2 * a * i) / 96;
      return [R * Math.sin(t), c + s * R * Math.cos(t)];
    });
  };
  const seams = [...inside(seam(laceY)), ...inside(seam(-0.8 * laceY))];
  const top = (x: number) => -lens.cy + Math.sqrt(Math.max(0, lens.r * lens.r - x * x));
  const stripes: Pt[][] = [];
  const band = 0.055 * D;
  for (const side of [-1, 1]) {
    for (const x0 of [0.56 * lens.halfW, 0.56 * lens.halfW + band]) {
      const h = top(x0);
      const bow = 0.12 * h;
      const arc = Array.from({ length: 49 }, (_, i): Pt => {
        const y = -h + (2 * h * i) / 48;
        return [side * (x0 + bow * (1 - (y / h) ** 2)), y];
      });
      stripes.push(...inside(arc));
    }
  }
  return { seams, stripes };
}

/** A bar `w` wide from `a` to `b` with round ends — a football's stitch. CCW. */
function capsuleRing(a: Pt, b: Pt, w: number, n = 8): CutRing {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const r = w / 2;
  const ring: CutRing = [];
  for (let i = 0; i <= n; i++) { const t = ang - Math.PI / 2 + (Math.PI * i) / n; ring.push([b[0] + r * Math.cos(t), b[1] + r * Math.sin(t)]); }
  for (let i = 0; i <= n; i++) { const t = ang + Math.PI / 2 + (Math.PI * i) / n; ring.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]); }
  return ring;
}

/** A ribbon `width` wide along every contour of `shapes` — the lettering grown by half of it,
 *  without the CSG offset a template cannot reach from the main thread. It is what a ball's own
 *  marks are cut back by in Engrave mode (`DesignLayer.minus`): two blacks that touch are one
 *  black, and a soccer ball's pentagon is a solid fill right where the name goes. */
function halo(shapes: Shapes, width: number): Shapes {
  const out: Shapes = [];
  for (const island of shapes) {
    let ring = island[0];
    for (const r of island) if (ring && Math.abs(signedArea(r)) > Math.abs(signedArea(ring))) ring = r;
    if (!ring || ring.length < 3) continue;
    out.push([ring]);
    // `strokeRing` walks an OPEN polyline, so a ring handed over as it is comes back ribboned
    // everywhere except along the segment that closes it. Repeating the first point closes it.
    out.push([strokeRing([...ring, ring[0]!], width)]);
    // A mitred band leaves a wedge open at every corner it turns outward, apex on the corner —
    // exactly where a mark then runs into a letter. A disc at the corner is the round join.
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length]!;
      const p = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const turn = Math.abs(Math.atan2(p[1] - a[1], p[0] - a[0]) - Math.atan2(b[1] - p[1], b[0] - p[0]));
      const wrapped = turn > Math.PI ? 2 * Math.PI - turn : turn;
      if (wrapped > 0.14) out.push([circleRing(p[0], p[1], width / 2, 10)]);
    }
  }
  return out;
}

/**
 * A basketball's seams as they look on a real ball held at an angle — the four seams of the
 * sphere, projected — instead of the blank's flat pictogram.
 *
 * Why: the pictogram is one straight line down, one across and two arcs bulging OUTWARD from
 * pole to pole, which is the meridians of a globe. On a tag that read as a beach ball; a
 * basketball reads as a basketball because every seam CURVES, the way a ball turned a little
 * towards you draws them.
 *
 * The construction is the ball's own, nothing traced: two great circles at right angles (the
 * planes x = 0 and y = 0), and the two "curved" seams — the circles of angular radius
 * `CURVE_DEG` round the poles of the first great circle, crossing the second. The sphere is
 * turned by `TILT` and projected straight on; only the half facing the viewer is drawn, and every
 * run is pulled `inset` inside the ball's edge so no stroke touches the cut.
 */
const CURVE_DEG = 52;
/** Yaw, pitch and roll of the ball, degrees — chosen by eye from a sweep of views as the one
 *  that reads most like a real ball in hand: every seam curves, one runs top to bottom and one
 *  arcs across, and the two small circles show as the side curves. */
const TILT: [number, number, number] = [-25, -20, 10];

function basketballPanels(D: number, width: number): CutRing[] {
  const R = D / 2;
  const lim = R - width / 2 - 0.8;
  const rad = Math.PI / 180;
  const [ya, pa, ra] = TILT.map((d) => d * rad) as [number, number, number];
  const turn = ([x, y, z]: [number, number, number]): [number, number, number] => {
    // yaw about y, then pitch about x, then roll about z.
    let X = x * Math.cos(ya) + z * Math.sin(ya);
    let Z = -x * Math.sin(ya) + z * Math.cos(ya);
    let Y = y;
    const Y2 = Y * Math.cos(pa) - Z * Math.sin(pa);
    Z = Y * Math.sin(pa) + Z * Math.cos(pa);
    Y = Y2;
    const X2 = X * Math.cos(ra) - Y * Math.sin(ra);
    Y = X * Math.sin(ra) + Y * Math.cos(ra);
    X = X2;
    return [X, Y, Z];
  };
  const ca = Math.cos(CURVE_DEG * rad);
  const sa = Math.sin(CURVE_DEG * rad);
  const circles: ((t: number) => [number, number, number])[] = [
    (t) => [0, Math.cos(t), Math.sin(t)],
    (t) => [Math.cos(t), 0, Math.sin(t)],
    (t) => [ca, sa * Math.cos(t), sa * Math.sin(t)],
    (t) => [-ca, sa * Math.cos(t), sa * Math.sin(t)],
  ];
  const N = 240;
  const out: CutRing[] = [];
  for (const circle of circles) {
    // Walk the whole circle once and cut it into runs on the visible hemisphere. Starting the
    // walk at a hidden point means a visible run never straddles the seam of the walk itself.
    const pts = Array.from({ length: N }, (_, i) => turn(circle((2 * Math.PI * i) / N)));
    let start = pts.findIndex((p) => p[2] <= 0.06);
    if (start < 0) start = 0;
    let run: Pt[] = [];
    const flush = () => { if (run.length > 3) out.push(strokeRing(run, width)); run = []; };
    for (let k = 0; k <= N; k++) {
      const p = pts[(start + k) % N]!;
      // 0.06 rather than 0: the last few degrees before the limb foreshorten into a stroke that
      // runs along the edge of the ball, which reads as a burn on the rim, not as a seam.
      if (p[2] > 0.06) run.push([p[0] * lim, p[1] * lim]);
      else flush();
    }
    flush();
  }
  return out;
}

/**
 * A soccer ball as a real one looks — the truncated icosahedron on a sphere, seen straight on:
 * one black pentagon in the middle, the five white hexagons round it, and the next ring of
 * pentagons foreshortened towards the edge, where the frame's rim takes over from them.
 *
 * Why: the blank's own pictogram is one flat pentagon and five spokes, and on the tag it read as
 * a pentagon with legs, not as a ball. What makes a
 * soccer ball read at a glance is the SECOND ring — the pentagons shrinking and squashing as the
 * sphere turns away — and only a projection draws that.
 *
 * The construction is the ball's own, nothing traced: the twelve vertices of an icosahedron are
 * the twelve pentagons' centres, and cutting every edge in thirds gives the ball's 60 corners.
 * Each pentagon is the five thirds nearest its centre; the seams are the pentagons' sides plus
 * the middle third of every icosahedron edge (the side two hexagons share), each drawn as the
 * great-circle arc it is on the ball. The sphere is turned so one pentagon faces the viewer,
 * then `SOCCER_TILT` more, and projected straight on. Only what faces the viewer is drawn, and
 * every mark stays `width / 2 + 0.8` inside the ball's edge.
 *
 * Returned as PENTAGONS (solid, engraved black) and SEAMS (ribbons `width` wide).
 */
/** Pitch, yaw and roll of the ball, degrees, after a pentagon is turned to face the viewer with
 *  one of its corners straight up. Picked by eye from a sweep. */
const SOCCER_TILT: [number, number, number] = [-12, 9, 0];

function soccerPanels(D: number, width: number): { pentagons: CutRing[]; seams: CutRing[] } {
  type V = [number, number, number];
  const lim = D / 2 - width / 2 - 0.8;
  const norm = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
  const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const phi = (1 + Math.sqrt(5)) / 2;
  const ico: V[] = [];
  for (const a of [-1, 1]) for (const b of [-phi, phi]) ico.push(norm([0, a, b]), norm([a, b, 0]), norm([b, 0, a]));
  // Each vertex's five neighbours: the ones at the icosahedron's edge angle, cos = 1 / √5.
  const near = ico.map((a) => ico.flatMap((b, j) => (Math.abs(dot(a, b) - 1 / Math.sqrt(5)) < 1e-6 ? [j] : [])));
  const third = (i: number, j: number): V =>
    norm([2 * ico[i]![0] + ico[j]![0], 2 * ico[i]![1] + ico[j]![1], 2 * ico[i]![2] + ico[j]![2]]);

  // The view: an orthonormal frame whose +z is the front pentagon's centre and whose +y is one of
  // its corners — the pentagon faces the viewer point up — then tilted by SOCCER_TILT.
  const front = ico[0]!;
  const corner = third(0, near[0]![0]!);
  const yAxis = norm(cross(cross(front, corner), front));
  const xAxis = cross(yAxis, front);
  const rad = Math.PI / 180;
  const [pa, ya, ra] = SOCCER_TILT.map((d) => d * rad) as [number, number, number];
  const turn = (p: V): V => {
    let x = dot(p, xAxis);
    let y = dot(p, yAxis);
    let z = dot(p, front);
    [x, y] = [x * Math.cos(ra) - y * Math.sin(ra), x * Math.sin(ra) + y * Math.cos(ra)];
    [y, z] = [y * Math.cos(pa) - z * Math.sin(pa), y * Math.sin(pa) + z * Math.cos(pa)];
    [x, z] = [x * Math.cos(ya) + z * Math.sin(ya), -x * Math.sin(ya) + z * Math.cos(ya)];
    return [x, y, z];
  };
  /** The great-circle arc a → b in `n` steps, turned into the view. */
  const arc = (a: V, b: V, n: number): V[] => {
    const om = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
    return Array.from({ length: n + 1 }, (_, k) => {
      const s0 = Math.sin((1 - k / n) * om) / Math.sin(om);
      const s1 = Math.sin((k / n) * om) / Math.sin(om);
      return turn([a[0] * s0 + b[0] * s1, a[1] * s0 + b[1] * s1, a[2] * s0 + b[2] * s1]);
    });
  };
  /** Past this the sphere turns away so fast that a stroke runs along the ball's own edge,
   *  which reads as a burn on the rim rather than as a seam. All of it is under the frame. */
  const Z_MIN = 0.08;
  const flat = (p: V): Pt => [p[0] * lim, p[1] * lim];

  const pentagons: CutRing[] = [];
  const seams: CutRing[] = [];
  const edges: [V, V][] = [];
  for (let i = 0; i < ico.length; i++) {
    const c = ico[i]!;
    // The five corners, in order round the centre.
    const e1 = norm(cross(c, Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    const e2 = cross(c, e1);
    const corners = near[i]!.map((j) => third(i, j))
      .sort((a, b) => Math.atan2(dot(a, e2), dot(a, e1)) - Math.atan2(dot(b, e2), dot(b, e1)));
    corners.forEach((a, k) => edges.push([a, corners[(k + 1) % 5]!]));
    // The patch: its sides as arcs, clipped to the front of the sphere (Sutherland–Hodgman
    // against z = Z_MIN), then flattened.
    const poly = corners.flatMap((a, k) => arc(a, corners[(k + 1) % 5]!, 10).slice(0, -1));
    const kept: V[] = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]!;
      const b = poly[(k + 1) % poly.length]!;
      if (a[2] >= Z_MIN) kept.push(a);
      if ((a[2] >= Z_MIN) !== (b[2] >= Z_MIN)) {
        const t = (Z_MIN - a[2]) / (b[2] - a[2]);
        kept.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), Z_MIN]);
      }
    }
    if (kept.length >= 3) {
      const ring = kept.map(flat);
      const area = signedArea(ring);
      if (Math.abs(area) > 0.5) pentagons.push(area < 0 ? ring.reverse() : ring);
    }
    // The side two hexagons share: the middle third of each icosahedron edge, once per edge.
    for (const j of near[i]!) if (j > i) edges.push([third(i, j), third(j, i)]);
  }
  for (const [a, b] of edges) {
    let run: Pt[] = [];
    const flush = () => { if (run.length > 1) seams.push(strokeRing(run, width)); run = []; };
    for (const p of arc(a, b, 16)) {
      if (p[2] >= Z_MIN) run.push(flat(p));
      else flush();
    }
    flush();
  }
  return { pentagons, seams };
}

/** Every vertex of a set of shapes, strided so a block of tessellated glyphs answers a fit in a
 *  few hundred tests rather than a few thousand. The extremes are always kept: they are the
 *  points a fit is actually decided by. */
function inkPoints(shapes: Shapes, cap = 700): Pt[] {
  const all: Pt[] = [];
  for (const island of shapes) for (const ring of island) for (const p of ring) all.push(p);
  if (all.length <= cap) return all;
  const stride = Math.ceil(all.length / cap);
  const out: Pt[] = [];
  let lo = all[0]!;
  let hi = all[0]!;
  for (let i = 0; i < all.length; i++) {
    if (i % stride === 0) out.push(all[i]!);
    if (all[i]![0] < lo[0]) lo = all[i]!;
    if (all[i]![0] > hi[0]) hi = all[i]!;
  }
  out.push(lo, hi);
  return out;
}

// ------------------------------------------------------------------- how much room there is --

/**
 * How far any point lies from a set of shapes' UNION, mm, read off a grid — 0 inside.
 *
 * Why a grid: the fits below ask "is this point clear of the laces / the name?" hundreds of
 * thousands of times (a scan of 48 scales × 700 ink points, bisected, for four number spots).
 * Answered exactly — `insideUnion` + `unionOutlineDistance` over a script's overlapping glyph
 * islands, each candidate edge tested for being buried in a neighbour — that was 25 s of main
 * thread for the football's default "Carter 9", freezing the whole page.
 * The union is rasterised ONCE (scanline, per island even-odd, OR across islands) and an exact
 * Euclidean distance transform (Felzenszwalb) turns it into distances; every question after that
 * is a lookup. `CELL` = 0.1 mm, so an answer is good to about a tenth of a millimetre — against
 * clearances of 1–2 mm.
 *
 * `reach` is how far out the grid runs past the shapes; beyond it a point answers with a lower
 * bound (its distance to the grid's box plus `reach`), which is conservative.
 */
const CELL = 0.1;
class Clearance {
  private readonly x0: number;
  private readonly y0: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly d: Float32Array;
  private readonly reach: number;
  constructor(shapes: Shapes, reach: number) {
    const b = bboxOf(shapes);
    this.reach = reach;
    this.x0 = b.minX - reach;
    this.y0 = b.minY - reach;
    const nx = (this.nx = Math.max(1, Math.ceil((b.maxX - b.minX + 2 * reach) / CELL)));
    const ny = (this.ny = Math.max(1, Math.ceil((b.maxY - b.minY + 2 * reach) / CELL)));
    const INF = 1e20;
    const f = new Float64Array(nx * ny).fill(INF);
    // Inside: per island even-odd across its rings (a counter is a hole), OR across islands.
    for (const island of shapes) {
      const rows = new Map<number, number[]>();
      for (const ring of island) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xa, ya] = ring[j]!;
          const [xb, yb] = ring[i]!;
          if (ya === yb) continue;
          const lo = Math.min(ya, yb);
          const hi = Math.max(ya, yb);
          const r0 = Math.max(0, Math.ceil((lo - this.y0) / CELL - 0.5));
          const r1 = Math.min(ny - 1, Math.floor((hi - this.y0) / CELL - 0.5));
          for (let r = r0; r <= r1; r++) {
            const y = this.y0 + (r + 0.5) * CELL;
            if (y < lo || y >= hi) continue;
            let xs = rows.get(r);
            if (!xs) rows.set(r, (xs = []));
            xs.push(xa + ((y - ya) / (yb - ya)) * (xb - xa));
          }
        }
      }
      for (const [r, xs] of rows) {
        xs.sort((a, c) => a - c);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const c0 = Math.max(0, Math.ceil((xs[k]! - this.x0) / CELL - 0.5));
          const c1 = Math.min(nx - 1, Math.floor((xs[k + 1]! - this.x0) / CELL - 0.5));
          for (let c = c0; c <= c1; c++) f[r * nx + c] = 0;
        }
      }
    }
    // The exact squared distance transform, columns then rows (Felzenszwalb & Huttenlocher).
    const n = Math.max(nx, ny);
    const line = new Float64Array(n);
    const out = new Float64Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    const edt1 = (len: number) => {
      let k = 0;
      v[0] = 0;
      z[0] = -Infinity;
      z[1] = Infinity;
      for (let q = 1; q < len; q++) {
        if (line[q]! >= INF) {
          // An empty cell adds no parabola; skip it (its own answer comes from the envelope).
          continue;
        }
        if (line[v[k]!]! >= INF) { v[k] = q; z[k] = -Infinity; z[k + 1] = Infinity; continue; }
        let s = ((line[q]! + q * q) - (line[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
        while (k > 0 && s <= z[k]!) {
          k--;
          s = ((line[q]! + q * q) - (line[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Infinity;
      }
      k = 0;
      for (let q = 0; q < len; q++) {
        while (z[k + 1]! < q) k++;
        const p = v[k]!;
        out[q] = line[p]! >= INF ? INF : (q - p) * (q - p) + line[p]!;
      }
    };
    for (let c = 0; c < nx; c++) {
      for (let r = 0; r < ny; r++) line[r] = f[r * nx + c]!;
      edt1(ny);
      for (let r = 0; r < ny; r++) f[r * nx + c] = out[r]!;
    }
    this.d = new Float32Array(nx * ny);
    for (let r = 0; r < ny; r++) {
      for (let c = 0; c < nx; c++) line[c] = f[r * nx + c]!;
      edt1(nx);
      // Centre to centre, less half a cell: the edge of the nearest inside cell, not its middle.
      for (let c = 0; c < nx; c++) this.d[r * nx + c] = out[c]! >= INF ? reach : Math.max(0, Math.sqrt(out[c]!) * CELL - CELL / 2);
    }
  }

  /** Distance from `p` to the union, mm; 0 inside it. */
  at(p: Pt): number {
    const c = Math.floor((p[0] - this.x0) / CELL);
    const r = Math.floor((p[1] - this.y0) / CELL);
    if (c < 0 || r < 0 || c >= this.nx || r >= this.ny) {
      const dx = Math.max(this.x0 - p[0], 0, p[0] - (this.x0 + this.nx * CELL));
      const dy = Math.max(this.y0 - p[1], 0, p[1] - (this.y0 + this.ny * CELL));
      return this.reach + Math.hypot(dx, dy);
    }
    return this.d[r * this.nx + c]!;
  }
}

/** One grid per shapes array — the same laces and the same name are asked about by every fit. */
const clearances = new WeakMap<Shapes, Clearance>();
function clearanceOf(shapes: Shapes, reach = 5): Clearance {
  let c = clearances.get(shapes);
  if (!c) clearances.set(shapes, (c = new Clearance(shapes, reach)));
  return c;
}

/** What a piece of ink on this tag has to keep clear of. Every clearance carries the layer's own
 *  `grow` (the weld's hairline of bold, which the engine adds after the template has finished),
 *  so a fit measures the ink that will really be cut. */
interface Room {
  lens: Lens;
  grow: number;
  hole: { c: Pt; r: number } | null;
  /** Rectangles already in place on the frame — the number, a football's laces — each grown by
   *  the air this design keeps between two pieces of ink. */
  blocks: { minX: number; minY: number; maxX: number; maxY: number }[];
  /** Ink already placed that is NOT a rectangle — the football's laces, which follow the ring's
   *  curve, and its welded name, which the number tucks in under — kept `gap` clear point by
   *  point. A box round either would take the whole of the window beside or under it. */
  avoid: { shapes: Shapes; gap: number }[];
}

/** Whether a point has `minDepth` of ball around it and clears the hole and the blocks. */
function clearAt(room: Room, p: Pt, minDepth: number): boolean {
  if (depthIn(room.lens, p) < minDepth + room.grow) return false;
  if (room.hole && Math.hypot(p[0] - room.hole.c[0], p[1] - room.hole.c[1]) < room.hole.r + room.grow) return false;
  for (const b of room.blocks) {
    if (p[0] > b.minX - room.grow && p[0] < b.maxX + room.grow && p[1] > b.minY - room.grow && p[1] < b.maxY + room.grow) return false;
  }
  for (const a of room.avoid) {
    if (clearanceOf(a.shapes).at(p) < a.gap + room.grow) return false;
  }
  return true;
}

/**
 * The largest scale about `c` at which every one of `pts` still clears everything.
 *
 * Scanned, then bisected — not bisected alone. The ball and the hole are convex constraints and
 * would answer a bisection honestly, but a BLOCK is not: a ray from the name's centre can pass
 * through the number's box and out the far side, and a bisection would sail straight over it and
 * report a fit that lands the descender of a "y" in the middle of a 15.
 */
function roomFor(pts: Pt[], c: Pt, room: Room, minDepth: number, hi = 5): number {
  const okAt = (k: number) => pts.every((p) => clearAt(room, [c[0] + k * (p[0] - c[0]), c[1] + k * (p[1] - c[1])], minDepth));
  if (!okAt(0.02)) return 0;
  const STEPS = 48;
  let lo = 0.02;
  let bad = hi;
  for (let i = 1; i <= STEPS; i++) {
    const k = (hi * i) / STEPS;
    if (okAt(k)) lo = k;
    else { bad = k; break; }
  }
  if (bad >= hi) return hi;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + bad) / 2;
    if (okAt(mid)) lo = mid;
    else bad = mid;
  }
  return lo;
}

/** Whether the ink, scaled by `k` about `c`, runs `bite` mm into the ring on BOTH sides of the
 *  centre — which is what welds a word to the frame in one union rather than at one end. */
function bitesBoth(pts: Pt[], c: Pt, k: number, room: Room, rim: number, bite: number): boolean {
  let left = false;
  let right = false;
  for (const p of pts) {
    const q: Pt = [c[0] + k * (p[0] - c[0]), c[1] + k * (p[1] - c[1])];
    if (depthIn(room.lens, q) - room.grow > rim - bite) continue;
    if (q[0] < c[0]) left = true;
    else right = true;
    if (left && right) return true;
  }
  return false;
}

/** The smallest scale about `c` (up to `kMax`) at which the ink on ONE side of `c` runs `bite`
 *  into the ring; `2 × kMax` when it never does. */
function sideScale(pts: Pt[], c: Pt, room: Room, rim: number, bite: number, side: -1 | 1, kMax: number): number {
  const bites = (k: number) => pts.some((p) => {
    const q: Pt = [c[0] + k * (p[0] - c[0]), c[1] + k * (p[1] - c[1])];
    return (side < 0 ? q[0] < c[0] : q[0] >= c[0]) && depthIn(room.lens, q) - room.grow <= rim - bite;
  });
  const STEPS = 24;
  for (let i = 1; i <= STEPS; i++) {
    const k = (kMax * i) / STEPS;
    if (!bites(k)) continue;
    let lo = (kMax * (i - 1)) / STEPS;
    let hi = k;
    for (let j = 0; j < 8; j++) { const mid = (lo + hi) / 2; if (bites(mid)) hi = mid; else lo = mid; }
    return hi;
  }
  return 2 * kMax;
}

/**
 * How far to slide the name sideways so its two ends reach the ring at the SAME scale — the
 * football's (the "C" of "Carter" had half its bowl scored on the ring).
 *
 * A name is not symmetric: a script's capital swings out high on the left, its last letter ends
 * in a tail at the baseline. Centred, one end meets the ring long before the other, and by the
 * time the late end has reached it the early one is buried — "Mateo" never welded at all,
 * because its M hit the ring's taper while the o was still well short. Slid by this much, both
 * ends touch together: each only just meets the ring, the score where it crosses is a short arc
 * at the letter's tip, and the name gets bigger for it. Bisected, since sliding right can only
 * push the left end's scale up and the right end's down.
 */
function balanceX(pts: Pt[], c: Pt, room: Room, rim: number, bite: number): number {
  const kMax = 3;
  const f = (dx: number) => {
    const moved = pts.map((p): Pt => [p[0] + dx, p[1]]);
    const cc: Pt = [c[0] + dx, c[1]];
    return sideScale(moved, cc, room, rim, bite, -1, kMax) - sideScale(moved, cc, room, rim, bite, 1, kMax);
  };
  const reach = 0.15 * room.lens.halfW;
  let lo = -reach;
  let hi = reach;
  if (f(lo) >= 0) return lo;
  if (f(hi) <= 0) return hi;
  for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** The scale the name is drawn at, and whether it reached the ring.
 *
 *  Three rules in order: grow until the ink bites the ring on both sides (welded — the default
 *  construction); if the ball runs out first, grow only until the ink has `CLEAR` of window
 *  around it (a separate light piece, glued in the window); and never past what keeps `EDGE` of
 *  material outside the ink. */
function nameScale(pts: Pt[], c: Pt, room: Room, rim: number, bite: number): { k: number; welded: boolean; kFit: number } {
  const kFit = roomFor(pts, c, room, EDGE);
  if (kFit <= 0) return { k: 0, welded: false, kFit };
  const STEPS = 40;
  for (let i = 1; i <= STEPS; i++) {
    const k = (kFit * i) / STEPS;
    if (!bitesBoth(pts, c, k, room, rim, bite)) continue;
    // …then bisected down to the smallest scale that still bites, so a redraw at that size
    // answers k = 1 and the fit settles in one more drawing rather than hunting a 2.5 % step.
    let lo = (kFit * (i - 1)) / STEPS;
    let hi = k;
    for (let j = 0; j < 10; j++) { const mid = (lo + hi) / 2; if (bitesBoth(pts, c, mid, room, rim, bite)) hi = mid; else lo = mid; }
    return { k: hi, welded: true, kFit };
  }
  return { k: roomFor(pts, c, room, rim + CLEAR), welded: false, kFit };
}

// ------------------------------------------------------------------------------ the balls --

interface BallSpec {
  id: string;
  /** The `@vostok/laser` blank this ball's outline and marks come from. */
  blank: string;
  name: string;
  blurb: string;
  /** The blank's own marks, on the BACKER, and how they are run. Null for the football, whose
   *  `detail()` draws the LACES rather than a seam — its leather is drawn by hand below. */
  marks: { op: 'engrave' | 'score'; label: string } | null;
  /** The football: its own outline, thin frame, lacing, leather and loop tab (`FOOTBALL`). */
  football: boolean;
  /** The gallery card's own name and number. */
  first: [string, string];
  /** The smallest tag this ball still reads at — a shallow ball runs out of window first. */
  minSize: number;
  /** The ops the default build really runs, in job order (G29). */
  ops: string;
}

const BALLS: BallSpec[] = [
  {
    id: 'basketball-tag', blank: 'basketball', name: 'Basketball bag tag',
    blurb: 'A basketball with its seams engraved, the name and number welded into the frame.',
    // Upright: one seam down, one across, an arc either side — what a basketball looks like.
    // (The blank used to swing the set 32° to dodge an inside hole at the north pole; this tag's
    // hole is in the FRAME's rim, and the swing is the blank's own parameter now, default 0.)
    marks: { op: 'engrave', label: 'Seams' }, football: false,
    first: ['Elsie', '7'], minSize: 60, ops: 'engrave + score + cut',
  },
  {
    id: 'baseball-tag', blank: 'baseball', name: 'Baseball bag tag',
    blurb: 'A baseball with its stitching engraved, the name and number welded into the frame.',
    marks: { op: 'engrave', label: 'Stitching' }, football: false,
    first: ['Noah', '12'], minSize: 60, ops: 'engrave + score + cut',
  },
  {
    id: 'soccer-tag', blank: 'soccer', name: 'Soccer bag tag',
    blurb: 'A soccer ball with its panels engraved, the name and number welded into the frame.',
    marks: { op: 'engrave', label: 'Panels' }, football: false,
    first: ['Ava', '10'], minSize: 60, ops: 'engrave + score + cut',
  },
  {
    // The only ball that is not round, so the only one whose frame proves the true offset.
    id: 'football-tag', blank: 'football', name: 'Football bag tag',
    blurb: 'A football with its seams and stripes scored, the name, number and laces welded into the frame.',
    marks: null, football: true,
    first: ['Carter', '9'], minSize: 75, ops: 'score + cut',
  },
];

/**
 * The football, redrawn (2026-09-26) because the first one did not look like a football: the
 * number was not centred, the border was too big and too thick, and the scoring was poor. Ours
 * was a sharp lemon 1.75 : 1 with a 7 mm frame (the
 * rim had to hold a 3 mm hole with 2 mm of wall each side), the number stepped aside under the
 * name's end, and the backer carried two nested lenses.
 *
 *   aspect    an American football seen side-on is 1.4–1.5 : 1, not 1.75; a typical tag is
 *             about 100 × 70 mm.
 *   tip       its ends are blunt: each tip rounded by 4.7 % of the width (4.0 mm at 85 mm).
 *   rim       a thin, even band — 4.7 % of the width, 4.0 mm at 85 — never under `MIN_RIM`. A rim
 *             that thin cannot carry the hanging hole, so the football hangs from a loop TAB on
 *             the backer above the ball.
 *   bite      the number's feet and the stitches run 35 % of the rim into it (1.4 mm at 85);
 *   nameBite  the name's ends only just meet it (25 %, 1.0 mm), so where they cross it the score
 *             is a short arc at the tip of the letter, not half a C's bowl.
 *   numberInk centred under the name, a quarter of the ball tall.
 *   stitches… eight stitches crossing one lace along the window's top edge, symmetric about the
 *             middle and welded into the ring at their tops, spanning about 43 % of the ball.
 */
const FOOTBALL = {
  aspect: 1.45,
  tip: 0.047,
  rim: 0.047,
  bite: 0.35,
  nameBite: 0.25,
  numberInk: 0.27,
  stitches: 8,
  /** The span of the stitches' centres, as a share of the ball's half-width. */
  laceSpan: 0.42,
  /** A stitch's width and length, as shares of the width: 1.6 × 6.4 mm at 85. */
  stitchW: 0.019,
  stitchL: 0.075,
};
/** The thinnest frame a football gets, mm: the §2 floor for material between a cut and an edge,
 *  2 × a 3 mm sheet capped at 3.2 mm. */
const MIN_RIM = 3.2;
/** How tall the number's INK is drawn, as a share of the window's height — measured as ink and
 *  not as a cap height, because a script's digits are nothing like its capitals (Pacifico's "9"
 *  is 70 % of its cap). The part that runs into the ring is extra, so the number READS this
 *  tall whatever the weld takes. */
const NUMBER_INK = 0.24;
/** How far above the window's centre the name's block may ride, as a share of the window's own
 *  half-height. The name sits a little high with the number under it. */
const LIFT = 0.10;
/** The biggest tag the slider offers, mm. */
const MAX_SIZE = 140;

// ------------------------------------------------------------------------------- the build --

async function buildTag(spec: BallSpec, v: Values): Promise<BuildInput> {
  const def = blankById(spec.blank)!;
  const D = clamp(num(v, 'size'), spec.minSize, MAX_SIZE);
  const fb = spec.football;
  const p: BlankParams = {
    ...def.defaults,
    width: D,
    height: fb ? D / FOOTBALL.aspect : (D * def.defaults.height) / def.defaults.width,
    holeSide: 'none',
    pair: false,
  };
  // The blank's own ring, in closed form: every one of these four is drawn as a circle or as
  // `leafRing`, and both are the lens above — which is what lets the frame be cut here instead
  // of by an offset pass in the worker. `blankDetail` still reads the blank, so the marks are
  // the ball's own. The football's is its own: fatter, with blunt tips (`FOOTBALL`).
  const lens = fb ? roundedLensOf(p.width / 2, p.height / 2, FOOTBALL.tip * D) : lensOf(p.width / 2, p.height / 2);
  const outline: Shapes = [[lensRing(lens, 180)]];
  const raised = str(v, 'lightOp') !== 'engrave';
  const hangs = v.hangHole !== false;
  const dia = clamp(num(v, 'holeDia'), 2, 6);
  const warnings: string[] = [];

  // The frame is as wide as the shared rule says, or as wide as the hanging hole needs —
  // whichever is more, so the hole always has WALL of material on both sides of it. At Ø 85 with
  // a 3 mm hole that is 7 mm, and the rim never eats more than 40 % of the ball's short half.
  // The football's is a thin band instead, and it hangs from a tab on the backer.
  const want = fb ? Math.max(MIN_RIM, FOOTBALL.rim * D) : Math.max(rimWidthFor(D), hangs ? dia + 2 * WALL : 0);
  const rim = Math.min(want, 0.4 * lens.halfH);
  if (rim < want - 0.01) warnings.push('That hanging hole needs more frame than this tag has — use a smaller hole, or a bigger tag.');
  const win = erode(lens, rim)!;
  const bite = fb ? clamp(FOOTBALL.bite * rim, 1.2, 2) : biteFor(rim);
  // The football's NAME only just meets the ring: a round capital (the C of "Carter", the a of
  // "Alexandrina") lies almost parallel to the blunt tip, so every tenth of a millimetre deeper
  // lengthens the arc of its bowl that ends up scored on the ring — 25 mm of the C at 1.4 mm,
  // 13 at 1.0. A millimetre along an arc that long is still a solid weld. The number and the
  // laces keep `bite`: a digit's foot is all that holds it.
  const nameBite = fb ? clamp(FOOTBALL.nameBite * rim, 0.9, 1.5) : bite;
  const gap = gapFor(D);

  // The hole sits on the rim's own centre line at the top of the ball, through BOTH sheets: the
  // ring then bears on 6 mm of glued stack instead of 3, and the two layers cannot shear apart.
  const holeAt: Pt = [0, lens.halfH - rim / 2];
  const keyring: KeyringSpec = hangs && !fb
    ? { ...NO_KEYRING, enabled: true, mode: 'inside', dia, ring: (rim - dia) / 2, rest: holeAt }
    : NO_KEYRING;
  // The football's loop: a tab grown off the top of the BACKER — the dark
  // ball carries the ring, the thin light frame is glued on under it and carries nothing.
  const tab: KeyringSpec | null = hangs && fb
    ? { ...NO_KEYRING, enabled: true, mode: 'outside', side: 'top', along: 0.5, dia, ring: clamp(0.03 * D, 2, 3.5) }
    : null;

  const font = str(v, 'font');
  const base = { symbols: readSymbols(v), font, letterSpacing: 0 };
  // The number in its OWN face: a jersey number is a block numeral, not the name's script. A
  // Pacifico "23" is a pair of swashes; a bag tag — like every team shirt — sets it in a
  // heavy condensed sans.
  const numberFont = str(v, 'numberFont') || font;
  const room: Room = { lens, grow: 0, hole: hangs && !fb ? { c: holeAt, r: dia / 2 + WALL } : null, blocks: [], avoid: [] };

  // ------------------------------------------------------------------------------- the laces --
  // The lacing, redrawn (2026-09-26: the old one looked like blobs — five fat ties
  // jammed under the rim with a sliver of waste between them and it). One LACE — a thin strip
  // following the window's top edge, a few millimetres down it, so the dark ball shows between
  // the lace and the frame — and `stitches` short bars crossing it, evenly spaced along the same
  // curve and square to it, symmetric about the middle. Every stitch runs up into the ring by
  // `sink`, so the ladder is welded to the frame along its whole span and hangs from it; where
  // each stitch crosses the ring its own outline is scored, the short blue arcs at the top of
  // the stitches.
  let laces: Shapes = [];
  /** Where the lace crosses the middle — the backer's top seam runs under it. */
  let lacesY = 0;
  if (fb) {
    const tw = clamp(FOOTBALL.stitchW * D, 1.2, 2.6);
    const tl = FOOTBALL.stitchL * D;
    const sink = 0.3 * rim;
    // The window's upper arc is centred at (0, −win.cy); every stitch lies along a radius of it,
    // and the lace runs halfway down the stitches' visible length.
    const oy = -win.cy;
    const rho = win.r - (tl - sink) / 2;
    const half = Math.asin(Math.min(0.9, (FOOTBALL.laceSpan * lens.halfW) / rho));
    const along = (r: number, a: number): Pt => [r * Math.sin(a), oy + r * Math.cos(a)];
    lacesY = oy + rho;
    const lace: Pt[] = [];
    for (let i = 0; i <= 48; i++) lace.push(along(rho, -half + (2 * half * i) / 48));
    const set: Shapes = [[strokeRing(lace, 0.85 * tw)]];
    for (let i = 0; i < FOOTBALL.stitches; i++) {
      const a = -half + (2 * half * i) / (FOOTBALL.stitches - 1);
      set.push([capsuleRing(along(win.r + sink - tl + tw / 2, a), along(win.r + sink - tw / 2, a), tw)]);
    }
    laces = set;
    room.avoid.push({ shapes: laces, gap });
  }

  // Engraved lettering stays CLEAR inside the window.
  const inkInset = CLEAR;

  // ------------------------------------------------------------------------------ the number --
  // Raised, the digits' feet run `bite` into the bottom of the ring: that is the whole weld, and
  // it is guaranteed rather than hoped for, because the window's lowest point is directly under
  // them. Engraved, they stay clear inside the window instead.
  const numberText = str(v, 'number').trim();
  // Cast, not annotated: it is assigned inside the helpers below, where TS cannot see it change.
  let number = null as { layers: DesignLayer[]; box: Box; size: number } | null;
  // What the digits READ at: a share of the window's height, plus whatever the weld buries.
  const numberInk = Math.max(MIN_CAP, (fb ? FOOTBALL.numberInk : NUMBER_INK) * 2 * win.halfH + (raised ? bite : 0));

  /** The number, centred, its feet on the window's lowest point. */
  const fitNumber = async (): Promise<typeof number> => {
    if (!numberText) return null;
    const numberX = 0;
    const winBottom = -(Math.sqrt(Math.max(0, win.r * win.r - numberX * numberX)) - win.cy);
    const numberFloor = raised ? winBottom - bite : winBottom + inkInset;
    let size = await sizeForCapHeight(numberFont, numberInk * 0.75);
    for (let pass = 0; pass < 3; pass++) {
      // No letter-to-letter weld: every digit's foot runs into the ring, so the ring is what holds
      // them — and walking a narrow "1" into a "5" at this size buried half of it.
      const drawn = await textLayer({ ...base, font: numberFont, text: numberText, size, connect: { ...connectSpec(numberFont, size), overlap: 0, joinLoose: 0 }, x: 0, y: 0 }, 'off', 'number', 'Number');
      if (!drawn[0]) return null;
      const grow = drawn[0].grow ?? 0;
      const bb = bboxOf(drawn[0].shapes);
      const placed = drawn.map((l) => ({ ...l, shapes: placeShapes(l.shapes, numberX - (bb.minX + bb.maxX) / 2, numberFloor + grow - bb.minY, 0) }));
      const ink = placed.flatMap((l) => l.shapes);
      // A digit is not a capital — the size is solved against the ink the face really draws —
      // and then held to what the ball's taper allows at that height.
      const tall = numberInk / Math.max(1e-6, bb.maxY - bb.minY + 2 * grow);
      let k = Math.min(tall, roomFor(inkPoints(ink), [numberX, numberFloor], { ...room, grow }, EDGE));
      // The other way round too: `roomFor` keeps the DIGITS out of what is already placed, but a
      // script's tail can still reach into the bowl of a 9 with no vertex of the 9 inside it — and
      // the union then swallows the bowl. So no vertex of the placed ink may land in the digits.
      if (k > 0 && room.avoid.length) {
        const others = room.avoid.flatMap((a) => inkPoints(a.shapes, 500));
        // Asked of the digits as drawn (k = 1), each other point taken INTO that frame: scaling
        // the digits by kk about their floor is scaling the point by 1 / kk, and every distance
        // by kk. One grid for the whole bisection instead of an exact walk per step.
        const digits = clearanceOf(ink);
        const clear = (kk: number) => others.every((q) =>
          digits.at([numberX + (q[0] - numberX) / kk, numberFloor + (q[1] - numberFloor) / kk]) * kk >= 1 + grow);
        if (!clear(k)) {
          let lo = 0;
          let hi = k;
          for (let i = 0; i < 10; i++) { const mid = (lo + hi) / 2; if (clear(mid)) lo = mid; else hi = mid; }
          k = lo;
        }
      }
      if (k <= 0) return null;
      if (Math.abs(k - 1) < 0.02 || pass === 2) {
        const box = bboxOf(ink);
        return { layers: placed, size, box: { minX: box.minX - grow, minY: box.minY - grow, maxX: box.maxX + grow, maxY: box.maxY + grow } };
      }
      size = Math.max(1, size * k);
    }
    return null;
  };
  const commitNumber = (n: typeof number) => {
    number = n;
    if (n) room.blocks.push({ minX: n.box.minX - gap, minY: n.box.minY - gap, maxX: n.box.maxX + gap, maxY: n.box.maxY + gap });
  };

  // -------------------------------------------------------------------------------- the name --
  // The band the name lives in: the window, less what the number has taken off the bottom. It
  // grows about that band's middle until it bites the ring on both sides (welded, the default
  // construction) or until the ball runs out (its own light piece, glued in the window). Every
  // obstacle is tested per POINT, so a script's ascender may still rise past the laces on either
  // side of them.
  //
  // The laces run right across the top of the window, so for the football they ARE the ceiling —
  // the name grows about the middle of what is left under them, which is what lets it stay wide
  // instead of being squeezed against a block it is centred on. Every ball without laces keeps
  // the whole window, its middle capped a little above the window's own centre: on a circle every
  // millimetre the name rides high is a millimetre of reach it loses at BOTH ends, which is the
  // difference between a welded name and a loose one.
  const bandTop = laces.length ? Math.min(win.halfH, bboxOf(laces).minY - gap) : win.halfH;
  type Name = { layers: DesignLayer[]; size: number; welded: boolean; at: Pt; notes: string[] };
  // Every drawing of the name, at the origin, by size. A drawing is the expensive step (a block
  // face walks every letter into the next: 50–100 ms a time), so no size is drawn twice.
  const drawnAt = new Map<number, DesignLayer[]>();
  const drawName = async (size: number): Promise<DesignLayer[]> => {
    let ls = drawnAt.get(size);
    if (!ls) {
      ls = await textLayer({ ...base, text: str(v, 'name'), size, connect: connectSpec(font, size), x: 0, y: 0 }, 'off', 'name', 'Name');
      drawnAt.set(size, ls);
    }
    return ls;
  };
  const fitName = async (): Promise<Name | null> => {
    const bandBottom = number ? number.box.maxY + gap : -win.halfH + (raised ? 0 : inkInset);
    let at: Pt = [0, Math.min((bandTop + bandBottom) / 2, LIFT * win.halfH)];
    if (!str(v, 'name').trim() || bandTop <= bandBottom + 2) return null;
    const draw = async (size: number) =>
      (await drawName(size)).map((l) => ({ ...l, shapes: placeShapes(l.shapes, at[0], at[1], 0) }));
    const seen = [...drawnAt.keys()];
    let size = seen.length ? seen[seen.length - 1]! : await sizeForCapHeight(font, Math.max(2, 0.55 * (bandTop - bandBottom)));
    // With nothing drawn yet, the first measure is taken off the glyphs laid out plainly — no
    // weld walk, a millisecond instead of a hundred — and only the sizes it points at are
    // really drawn. A twelve-letter name's first guess is twice the size it ends at, and the
    // walk at that size was the slowest drawing of the lot.
    let rough = !seen.length;
    let drawn = !rough
      ? await draw(size)
      : (await textLayer({ ...base, text: str(v, 'name'), size, connect: { ...connectSpec(font, size), overlap: 0, joinLoose: 0 }, x: at[0], y: at[1] }, 'off', 'name', 'Name'));
    let welded = false;
    for (let pass = rough ? -1 : 0; pass < 3 && drawn[0]; pass++) {
      const grow = drawn[0].grow ?? 0;
      let pts = inkPoints(drawn[0].shapes);
      if (fb && raised) {
        // The football's name slides to where both its ends meet the ring together (`balanceX`).
        const dx = balanceX(pts, at, { ...room, grow }, rim, nameBite);
        if (Math.abs(dx) > 0.05) {
          at = [at[0] + dx, at[1]];
          drawn = drawn.map((l) => ({ ...l, shapes: placeShapes(l.shapes, dx, 0, 0) }));
          pts = pts.map((q): Pt => [q[0] + dx, q[1]]);
        }
      }
      const got = raised
        ? nameScale(pts, at, { ...room, grow }, rim, nameBite)
        : { k: roomFor(pts, at, { ...room, grow }, rim + inkInset), welded: false, kFit: 0 };
      welded = got.welded;
      if (got.k <= 0) { drawn = []; break; }
      if (!rough && Math.abs(got.k - 1) < 0.01) break;
      // A welded drawing that already bites both sides, still fits, and is within 4 % of the
      // smallest size that bites is done: a redraw would only shave it by a hair, at the cost of
      // another weld walk — the slowest step there is.
      if (!rough && got.welded && got.k <= 1 && got.k >= 0.96 && got.kFit >= 1) break;
      size = Math.max(1, size * got.k);
      drawn = await draw(size);
      rough = false;
    }
    if (!drawn[0]) return null;
    // The verdict is taken off the drawing that is really cut, never off the pass that sized
    // it: a redraw re-runs the weld at the new size and can move the outermost stroke.
    const grow = drawn[0].grow ?? 0;
    const reaches = raised && welded && bitesBoth(inkPoints(drawn[0].shapes), at, 1, { ...room, grow }, rim, 0.6 * nameBite);
    const notes: string[] = [];
    const cap = (await textMetrics(font, size)).cap;
    if (cap < MIN_CAP) notes.push('The lettering has shrunk under 3 mm — shorten the name, or make the tag bigger.');
    notes.push(...countersTooTight(drawn.flatMap((l) => l.shapes)));
    return { layers: drawn, size, welded: reaches, at, notes };
  };

  // The number first, centred, as the floor the name stands on, on
  // every ball. (The football's number used to step aside under the end of its name, off
  // centre.)
  commitNumber(await fitNumber());
  const name = await fitName();
  const at: Pt = name?.at ?? [0, 0];
  if (name) warnings.push(...name.notes);

  // ------------------------------------------------------------------------------ the pieces --
  // The lettering is MATERIAL on whichever piece carries it and is never lasered itself (G33).
  // Two kinds of line are scored on it, both so the letters read as letters sitting ON the frame
  // rather than as lumps of it:
  //
  //   OUTLINES  where the ink runs into the ring, its own outline is scored across the ring
  //             (the J's side and the n's tail of "Jordan", the feet of the 23, the tops of the
  //             football's laces). See `outlinesOf`.
  //   SEAMS     where one letter is buried in the next, the buried edge (G32) — a second copy of
  //             the same per-glyph islands, `seams: true`: weld-and-score. On a block
  //             face that is the junction the overlap walk made; on a script it is each letter's
  //             exit stroke where the next letter takes it over, so the "a" of "Carter" still
  //             reads as an a and not as a lump of the r (scores where the name needs them to
  //             stay readable). Only the name has them: the number's digits never
  //             touch.
  const asMaterial = (ls: DesignLayer[]): DesignLayer[] => ls.map((l) => ({ ...l, op: 'off' as const, hugOnly: true }));
  const scores = str(v, 'letterLines') === 'score';
  /**
   * The ink's own outline, scored wherever it lies INSIDE the finished piece — which, for ink
   * welded into a ring, is exactly the run of it that crosses the ring and nothing else.
   *
   * Nothing here is constructed: the layer is a second copy of the SAME islands with the SAME
   * `grow`, so the engine offsets it by the very call that shapes the piece (and unions it on
   * the way — the overlapping glyphs of a script become one outline, with no line across a
   * join) and the line lies ON the letter's edge to the micron. The engine then clips every
   * score to the piece inset by 0.1 mm (`SCORE_INSET`), and that clip does the rest: the part of
   * the outline that IS the cut edge — every letter's edge in the window — is on the boundary
   * and drops out; what survives is the part with material on both sides of it, the ring. So a
   * line can never run off the piece, over the hanging hole, or past the outer edge.
   *
   * What it replaced (2026-09-22 → 26): patches of the ring handed to the seam clip as extra
   * "glyphs", each grown and trimmed on its own. Their edges did not follow the letters exactly
   * and read as dark gaps beside them, and the whole idea was then dropped for no line at all —
   * which left every tag with no scores where it contacts the border.
   *
   * `kind: 'fill'` is the engine's word for "meant to be trimmed at the edge"; without it the
   * build reports the name as "mostly off the part" (the family-tree names do the same). A layer
   * whose ink carries no `grow` of its own gets a hair of one so the engine still unions it.
   * `hugOnly` too: the copy is the same material the piece is already made of, so it changes
   * nothing in the hug — but it exempts the copy from the "two letters have merged" check, which
   * exists for engraved artwork and fired on every long welded name.
   */
  const outlinesOf = (ls: DesignLayer[]): DesignLayer[] =>
    !scores ? [] : ls.map((l) => {
      const { glyphIslands: _g, ...rest } = l;
      return { ...rest, id: `${l.id}-outline`, label: 'Letter outlines', op: 'score' as const, kind: 'fill' as const, hugOnly: true, grow: Math.max(l.grow ?? 0, 0.002) };
    });
  const seamsOf = (ls: DesignLayer[]): DesignLayer[] => {
    // Not on the football: there the name is scored only where it meets the ring, and on a
    // name as big as the football's the joins read as blobs under every letter.
    if (!scores || fb) return [];
    return ls.map((l) => ({ ...l, id: `${l.id}-seam`, label: 'Letter seams', op: 'score' as const, seams: true }));
  };
  const closed = (ring: CutRing): Pt[] => [...ring, ring[0]!];

  const frameLayers: DesignLayer[] = [
    { id: 'frame', label: 'Frame', shapes: [[lensRing(lens, 180), [...lensRing(win, 180)].reverse()]], op: 'off', hugOnly: true },
  ];
  const lacesLayer: DesignLayer = { id: 'laces', label: 'Laces', shapes: laces, op: 'off', hugOnly: true };
  if (laces.length) frameLayers.push(lacesLayer, ...outlinesOf([lacesLayer]));
  // The number's digits are set apart, never welded to each other (the ring holds them), so it
  // has no seams of its own to score — only its feet, where they stand in the ring.
  if (raised && number) frameLayers.push(...asMaterial(number.layers), ...outlinesOf(number.layers));
  if (raised && name?.welded) {
    frameLayers.push(...asMaterial(name.layers), ...outlinesOf(name.layers), ...seamsOf(name.layers));
  }

  const backerLayers: DesignLayer[] = [];
  const burn: Shapes = raised ? [] : [...(name?.layers ?? []), ...(number?.layers ?? [])].flatMap((l) => l.shapes);
  if (spec.marks) {
    const d = blankDetail(def, p);
    const soccer = spec.blank === 'soccer' ? soccerPanels(D, clamp(0.014 * D, 0.9, 1.8)) : null;
    const rings = spec.blank === 'basketball'
      // Bold, like a real ball's black seams: 2.6 % of the ball, 2.2 mm at Ø 85.
      ? basketballPanels(D, clamp(0.026 * D, 1.4, 3.2))
      // The pentagons solid and the seams a hair over a millimetre: a real ball's stitching is
      // a fine line beside its patches, and at the basketball's weight the hexagons disappear.
      : soccer ? [...soccer.pentagons, ...soccer.seams]
      : spec.marks.op === 'score' ? (d.score?.length ? d.score : d.engrave ?? []) : (d.engrave?.length ? d.engrave : d.score ?? []);
    if (rings.length) {
      backerLayers.push({
        id: 'marks', label: spec.marks.label, kind: 'detail', op: spec.marks.op,
        shapes: rings.map((r): CutRing[] => [r]),
        // Two blacks that touch are one black: engraved lettering has the ball's own marks cut
        // back around it, or a soccer ball's pentagon swallows the name whole.
        ...(burn.length ? { minus: halo(burn, clamp(0.025 * D, 1.2, 2.4)) } : {}),
        // The soccer ball's panels stop 1 mm under the frame: past the window the sphere is
        // turning away, the outer pentagons are clipped chords and the seams crowd the limb —
        // all of it hidden by the rim, but burnt for nothing, cluttering the backer on the
        // sheet, and the top panel ran right up to the hanging hole.
        ...(soccer ? { keep: [[lensRing(erode(lens, rim - 1) ?? win, 180)]] } : {}),
      });
    }
  }
  if (fb) {
    // The leather, scored — a football, not two nested lenses. See `footballLeather`. Cut back
    // round engraved lettering the same way the other balls' marks are: a line never runs into a
    // burnt letter.
    const leather = footballLeather(lens, D, laces.length ? lacesY : 0.75 * win.halfH);
    const clear = burn.length ? clearanceOf(burn) : null;
    const haloW = clamp(0.025 * D, 1.2, 2.4);
    const keep = (paths: Pt[][]): Pt[][] => {
      if (!clear) return paths;
      const out: Pt[][] = [];
      for (const path of paths) {
        let run: Pt[] = [];
        for (const q of path) {
          if (clear.at(q) >= haloW) run.push(q);
          else { if (run.length > 1) out.push(run); run = []; }
        }
        if (run.length > 1) out.push(run);
      }
      return out;
    };
    backerLayers.push(
      { id: 'marks', label: 'Seams', kind: 'detail', op: 'score', shapes: [], paths: keep(leather.seams) },
      { id: 'stripes', label: 'Stripes', kind: 'detail', op: 'score', shapes: [], paths: keep(leather.stripes) },
    );
  }
  if (!raised && name) backerLayers.push(...name.layers.map((l) => ({ ...l, op: 'engrave' as const })));
  if (!raised && number) backerLayers.push(...number.layers.map((l) => ({ ...l, op: 'engrave' as const })));
  if (raised && str(v, 'glue') !== 'none') {
    // Where the frame's inner edge lands, a hair OUTSIDE it so the line disappears under the
    // ring once the frame is glued on — and the name's own outline when it is a loose piece.
    const edge = erode(lens, Math.max(0.5, rim - GUIDE_INSET));
    if (edge) backerLayers.push({ id: 'glue', label: 'Glue guide', kind: 'guide', op: 'score', shapes: [], paths: [closed(lensRing(edge, 180))] });
    if (name && !name.welded) {
      backerLayers.push(...name.layers.map((l) => ({
        ...l, id: `${l.id}-guide`, label: 'Glue guide', kind: 'guide' as const, op: 'score' as const,
        grow: (l.grow ?? 0) - GUIDE_INSET,
      })));
    }
  }

  const parts: PartInput[] = [{
    id: 'backer',
    label: 'Ball · dark sheet',
    blank: { kind: 'shape', shapes: outline },
    layers: backerLayers,
    // The same silhouette about the same origin and the SAME hole at the same local point, so
    // the glue-up is the build frame again and the two sheets register. The
    // football hangs from its own tab instead, and the frame registers by the glue guide.
    keyring: tab ?? (hangs && !fb ? 'shared' : 'none'),
    assembledAt: 'built',
    material: 'dark',
  }];
  if (raised && name && !name.welded) {
    parts.push({
      id: 'name',
      label: 'Name · light sheet',
      // G33: the piece IS the letters. Margin 0, no smoothing pass, counters open so the ball
      // shows through the bowl of an "o".
      blank: { kind: 'hug', margin: 0, smoothing: 0, counters: 'open', bridge: bridgeFor(name.size), minHole: MIN_COUNTER },
      layers: [...asMaterial(name.layers), ...seamsOf(name.layers)],
      keyring: 'none',
      assembledAt: { x: at[0], y: at[1] },
      material: 'light',
    });
  }

  return {
    label: 'Frame · light sheet',
    material: 'light',
    // Margin 0 and no smoothing: the piece is the ring and whatever ink reaches it, unioned and
    // nothing else (G33). `bridges: 'dots'` joins an i's tittle and NOTHING ELSE — a name that
    // could not reach the ring is its own piece, never a bar thrown across the window.
    blank: { kind: 'hug', margin: 0, smoothing: 0, counters: 'open', bridges: 'dots', bridge: bridgeFor(name?.size ?? 0.2 * D), minHole: MIN_COUNTER },
    keyring,
    layers: frameLayers,
    parts,
    layout: { flow: 'row', gap: 6 },
    status: `${parts.length + 1} pieces · dark ball, light frame${parts.length > 1 ? ' and name' : ''}`,
    ...(warnings.length ? { warnings } : {}),
  };
}

// -------------------------------------------------------------------------------- the form --

function tagFields(spec: BallSpec): Field[] {
  return [
    // ---------------------------------------------------------- RIGHT: what you type --
    {
      kind: 'text', key: 'name', label: 'Name', panel: 'right', section: 'Text',
      value: spec.first[0], placeholder: 'A name', maxLength: 16, symbols: true,
    },
    {
      kind: 'text', key: 'number', label: 'Number', panel: 'right', section: 'Text',
      value: spec.first[1], placeholder: '9', maxLength: 3, symbols: false,
      help: 'Up to three digits; it welds to the frame’s bottom.',
    },
    // The font field always lands on the left as its own category, whatever `panel` says.
    { kind: 'font', key: 'font', label: 'Name font', panel: 'right', section: 'Font', value: 'pacifico', recommended: TAG_FACES },
    {
      kind: 'font', key: 'numberFont', label: 'Number font', panel: 'right', section: 'Font', value: 'anton',
      recommended: NUMBER_FACES, previewFrom: 'number',
      visibleWhen: (v) => str(v, 'number').trim() !== '',
    },

    // -------------------------------------------------------- LEFT: "Tag" (opens first) --
    // One knob, and it is the product's: how big the tag is. The frame, the window, the hole,
    // the number's size and the name's all follow from it.
    {
      kind: 'number', key: 'size', label: 'Size', section: 'Tag',
      value: 85, min: spec.minSize, max: MAX_SIZE, step: 1, unit: 'mm',
      help: '75–90 mm is the usual bag-tag size.',
    },
    ...lightPieceFields('Tag', 'raised', { help: 'Raised welds the lettering into the frame; Engrave burns it on.' }),

    // --------------------------------------------------------------- LEFT: "More options" --
    // Always on the page, whatever the face: every name runs into the ring and into itself, and
    // both are the lines this control draws.
    more({ ...letterScoreField('Lettering'), help: 'Scores each letter where it meets the frame or the next letter.' }),
    // The football hangs from a loop tab on its backer, not a hole through its thin frame.
    ...hangHoleFields('Hanging', { dia: 3, maxDia: 6, ...(spec.football ? { label: 'Hanging loop' } : {}) }).map(more),
  ];
}

const sportsTag = (spec: BallSpec): TemplateDef => ({
  id: spec.id,
  name: spec.name,
  blurb: spec.blurb,
  tags: ['tag', spec.ops],
  batch: { key: 'name', noun: 'tag' },
  fields: tagFields(spec),
  build: (v) => buildTag(spec, v),
  // A function, not a string (G27): there is nothing to glue when the lettering is engraved.
  exportNote: (v) =>
    str(v, 'lightOp') === 'engrave'
      ? 'Cut the ball from dark wood and the frame from light — nothing to glue.'
      : 'Cut the ball from dark wood and the light pieces from another sheet, then glue them on.',
  fileName: (v) => stem(str(v, 'name') || 'tag', str(v, 'number'), spec.blank),
});

export const basketballTag = sportsTag(BALLS[0]!);
export const baseballTag = sportsTag(BALLS[1]!);
export const soccerTag = sportsTag(BALLS[2]!);
export const footballTag = sportsTag(BALLS[3]!);

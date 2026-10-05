// Tie holder — a necktie-shaped board on a hanger hook. ONE cut piece and an engraved monogram;
// nothing to assemble.
//
// Read top to bottom, the way the photo does (every share below was measured off it, row by row,
// on the three boards side by side — 220 px from hook to tip):
//
//   HOOK   a "?" hook: a half ring over the knot, its right side running straight down into the
//          knot as the shank, its left end stopping at nine o'clock in a round cap. The bight fits
//          a closet rail of `rod` mm (35 by default, the thickest common round rail) with 1 mm to
//          spare, and the throat — the least distance from the cap to the knot, which the rail
//          passes through to get in — is at least rail + 2 mm, measured against the real shoulder.
//          The ring is ≥ 12 mm wide everywhere (the photo's 7 px band, grown to a 12 mm
//          floor); the shank meets the knot through a 6 mm fillet, where the load turns the corner.
//   KNOT   the top of the blade, carrying the monogram: as wide as the hook (0.19 × height, never
//          under the hook's own width), its height the monogram's capital plus 6 mm above and
//          below, its top-left shoulder a quarter ellipse from the centre line down 0.55 of that
//          height (the photo's). The monogram is a 12 mm capital on the centre line, dropped
//          toward the first slot where the shoulder crowds it, shrunk only if it still will not fit.
//   BLADE  one straight taper from the knot to 0.30 × height at the bottom (84 mm at 280), then
//          the tie's point: a chevron 0.36 × the bottom width tall (the photo's ~108° point).
//   SLOTS  8 by default, 7 mm tall so a folded tie slides in, OPEN on the left like the photo's:
//          the rungs between them hang off a spine down the right-hand side (0.22 × the knot
//          width, never under 12 mm), so a tie is slipped in from the side instead of threaded
//          through. Rungs are ≥ 6 mm (the sheet's thickness on 6 mm ply, twice it on 3 mm) and
//          at most 12 — past that the spare length goes to the plain blade under the last slot,
//          which is what a real tie looks like. "Slide-in slots" off closes them
//          with the spine's width of web on each side, the stronger board on 3 mm stock.
//
// Why it holds (6 mm ply, the default the export note states): the hook's worst section is the
// shank, 12 × 6 mm; eight ties and the board (~0.6 kg) hanging 24 mm off its line bend it at
// ~1 MPa, under a thirtieth of plywood's bending strength. A rung is a 10 mm-deep cantilever and
// a tie weighs a few newtons. The outline is drawn as ONE ring — hook, knot, rungs and point — so
// it cannot come off the bed in pieces, and the node suite measures every web on the cut plate.
import { bboxOf, filletRing, placeShapes, type Pt, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { readSymbols } from '../symbols/model';
import { applyCase, textLayer } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import { fitBoxInside } from '../engine/editorGeometry';
import type { BuildInput, DesignLayer } from '../engine/types';
import { NO_KEYRING } from './keyring';
import { letteringFields, stem } from './shared';
import { bool, num, str, type TemplateDef, type Values } from './types';

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

// ------------------------------------------------------------------ the numbers --

/** The board, hook top to point, mm: the default fits a 300 × 300 bed with room to spare. */
const HEIGHT = 280;
const HEIGHT_MIN = 240;
const HEIGHT_MAX = 360;
const BED = 300;
/** The knot's width and the blade's bottom width, as shares of the height (photo: 42 and 66 of
 *  220 px). The blade is never less than 1.35 × the knot, or it stops reading as a tie. */
const KNOT_SHARE = 0.19;
const BLADE_SHARE = 0.3;
const FLARE_MIN = 1.35;
/** The point's height as a share of the bottom width (photo: 24 of 66 px). */
const TIP_SHARE = 0.36;
/** The plain blade under the last slot, share of the height (photo 23 of 220 px), and its floor. */
const SOLID_SHARE = 0.105;
const SOLID_MIN = 14;
/** The hook: its ring is at least this wide, mm, and 0.4 of its outer radius on a big board. */
const BAND_MIN = 12;
const BAND_SHARE = 0.4;
/** The rail it hangs on: default and range, mm, and the play in the bight. */
const ROD = 35;
const ROD_MIN = 20;
const ROD_MAX = 45;
const ROD_PLAY = 1;
/** The throat is at least the rail plus this, mm. */
const THROAT_PLAY = 2;
/** The shank's inside corner into the knot, mm. */
const NECK_FILLET = 6;
/** The knot's top-left shoulder: a quarter ellipse from the knot's centre line down to its left
 *  edge, this share of the knot's height tall (photo: 21 × 10 px on a 42 × 17 px knot). */
const SHOULDER = 0.55;
/** Air above and below the monogram inside the knot, mm, and the knot's height floor as a share
 *  of the board (photo: 17 of 220 px). */
const KNOT_PAD = 6;
const KNOT_H_SHARE = 0.075;
/** The slots: height, the floor it may give way to, and the rungs' floor and ceiling, mm. */
const SLOT_H = 7;
const SLOT_H_MIN = 6;
const WEB_MIN = 6;
const WEB_MAX = 12;
/** The spine the rungs hang off (or each side web of a closed slot): share of the knot width,
 *  and its floor, mm. */
const SPINE_SHARE = 0.22;
const SPINE_MIN = 12;
/** Corner radii, mm: a rung's free end, the point and its shoulders. */
const MOUTH_R = 2;
const TIP_R = 2;
/** The monogram: default capital, its range, and how far it keeps from any edge, mm. */
const CAP = 12;
const CAP_MIN = 5;
const CAP_MAX = 16;
const CAP_FLOOR = 3;
const MARGIN = 4;
/** Segments per half circle — the hook's arcs are the part a customer's eye runs along. */
const ARC_SEG = 48;

// ------------------------------------------------------------------ the layout --

/** One slot: its top and bottom edge, and the x range it is cut over (the open slot's left end
 *  is the board's own edge; the right end is the far point of its rounded end). */
export interface TieSlot { top: number; bottom: number; left: number; right: number }

/** Everything the outline is drawn from, mm, in the board's own frame: the point at y = 0, the
 *  axis at x = 0 (`build` centres the board afterwards). Exported for the node suite, which
 *  measures the CUT plate against these claims rather than trusting them. */
export interface TieLayout {
  height: number;
  knotW: number;
  bladeW: number;
  tipH: number;
  hook: { cx: number; cy: number; rOut: number; rIn: number; band: number };
  rod: number;
  throat: number;
  knotTop: number;
  knotBottom: number;
  /** The quarter ellipse the knot's top-left shoulder is drawn as: `a` across, `b` down. */
  shoulder: { a: number; b: number };
  slotH: number;
  web: number;
  spine: number;
  open: boolean;
  slots: TieSlot[];
  /** How many were asked for — `slots.length` is fewer when the height cannot hold them. */
  asked: number;
  solidTop: number;
  /** The half width of the blade at height y (the taper, knot to point). */
  halfW: (y: number) => number;
}

export interface TieOpts { height: number; slots: number; rod: number; open: boolean; cap: number }

export function tieLayout(o: TieOpts): TieLayout {
  const H = clamp(o.height, HEIGHT_MIN, HEIGHT_MAX);
  const rod = clamp(o.rod, ROD_MIN, ROD_MAX);
  const cap = clamp(o.cap, CAP_MIN, CAP_MAX);
  const asked = Math.round(clamp(o.slots, 1, 20));

  // The hook sets the knot's floor: the bight must hold the rail, the ring must be BAND_MIN wide,
  // and the hook is exactly as wide as the knot it stands on (the photo's proportion).
  const rIn0 = (rod + ROD_PLAY) / 2;
  const knotW = Math.max(KNOT_SHARE * H, 2 * Math.max(rIn0 + BAND_MIN, rIn0 / (1 - BAND_SHARE)));
  const rOut = knotW / 2;
  const band = Math.max(BAND_MIN, BAND_SHARE * rOut);
  const rIn = rOut - band;
  const bladeW = Math.max(BLADE_SHARE * H, FLARE_MIN * knotW);
  const tipH = TIP_SHARE * bladeW;
  const cy = H - rOut;
  const knotH = Math.max(cap + 2 * KNOT_PAD, KNOT_H_SHARE * H);
  const shoulderH = SHOULDER * knotH;
  const taper = (kt: number) => (bladeW - knotW) / 2 / (kt - tipH);

  // The throat: the rail gets in between the hook's cap and the knot's top, so the least distance
  // between the two has to clear it. Measured, not assumed — the shoulder falls away under the
  // cap, so the knot can sit a few millimetres higher than a flat top would allow, and the shank
  // is that much shorter. The highest knot top that still clears is found by halving.
  const throat = Math.max(rod + THROAT_PLAY, 2 * rIn);
  const capAt: Pt = [-(rOut + rIn) / 2, cy];
  const gapAt = (kt: number) => {
    let best = Infinity;
    for (const p of knotTopEdge(knotW / 2 + taper(kt) * shoulderH, shoulderH, kt, rIn - NECK_FILLET)) {
      best = Math.min(best, Math.hypot(p[0] - capAt[0], p[1] - capAt[1]));
    }
    return best - band / 2;
  };
  let lo = cy - band / 2 - 2 * throat;
  let hi = cy - band / 2 - throat + shoulderH;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (gapAt(mid) >= throat) lo = mid;
    else hi = mid;
  }
  const knotTop = lo;
  const knotBottom = knotTop - knotH;
  const halfW = (y: number) => knotW / 2 + ((bladeW - knotW) / 2) * clamp((knotTop - y) / (knotTop - tipH), 0, 1);
  const shoulder = { a: halfW(knotTop - shoulderH), b: shoulderH };
  const spine = Math.max(SPINE_MIN, SPINE_SHARE * knotW);

  // The slots take the room between the knot and the plain blade: the plain blade gives way
  // first (to its floor), then the slot height (to 6 mm), then — only then — a slot.
  const room = (solid: number) => knotBottom - tipH - solid;
  const webFor = (n: number, sh: number, solid: number) => (n <= 1 ? WEB_MAX : (room(solid) - n * sh) / (n - 1));
  let n = asked;
  let slotH = SLOT_H;
  let solid = Math.max(SOLID_MIN, SOLID_SHARE * H);
  if (webFor(n, slotH, solid) < WEB_MIN) solid = SOLID_MIN;
  if (webFor(n, slotH, solid) < WEB_MIN) slotH = SLOT_H_MIN;
  while (n > 1 && webFor(n, slotH, solid) < WEB_MIN) n--;
  // A few slots do not spread out into planks: the rungs stop at WEB_MAX and the rest of the
  // length stays plain blade under the last slot.
  const web = Math.min(WEB_MAX, webFor(n, slotH, solid));
  const slots: TieSlot[] = [];
  for (let i = 0; i < n; i++) {
    const top = knotBottom - i * (slotH + web);
    const bottom = top - slotH;
    // Measured at the slot's TOP, where the taper is narrowest, so the web only grows below it.
    const right = halfW(top) - spine;
    const left = o.open ? -halfW(bottom) : -halfW(top) + spine;
    slots.push({ top, bottom, left, right });
  }
  const solidTop = slots.length ? slots[slots.length - 1]!.bottom : knotBottom;

  return {
    height: H, knotW, bladeW, tipH, hook: { cx: 0, cy, rOut, rIn, band }, rod, throat, knotTop, knotBottom, shoulder,
    slotH, web, spine, open: o.open, slots, asked, solidTop, halfW,
  };
}

/** The knot's top edge, right to left: flat from the shank's fillet to the centre line, then the
 *  shoulder — a quarter ellipse `a` wide and `b` tall — down to the left edge. The outline walks
 *  exactly these points, and the throat is measured against them. */
function knotTopEdge(a: number, b: number, top: number, xRight: number): Pt[] {
  const out: Pt[] = [];
  const flat = Math.max(1, Math.ceil(xRight));
  for (let i = 0; i < flat; i++) out.push([xRight * (1 - i / flat), top]);
  for (let i = 0; i <= ARC_SEG; i++) {
    const t = Math.PI / 2 + ((Math.PI / 2) * i) / ARC_SEG;
    out.push([a * Math.cos(t), top - b + b * Math.sin(t)]);
  }
  return out;
}

// ------------------------------------------------------------------ the outline --

/** Points on a circle about (cx, cy) from angle a0 to a1 (radians), both ends included.
 *  `outside`: the interior points stand off the circle by the chord's sag, so the polygon's
 *  EDGES touch the circle instead of cutting inside it — the hook's outer edge, where a chord
 *  that dips 0.02 mm would make the 12 mm ring an 11.98 mm one. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, seg: number, outside = false): Pt[] {
  const n = Math.max(2, Math.ceil((seg * Math.abs(a1 - a0)) / Math.PI));
  const out: Pt[] = [];
  const rr = outside ? r / Math.cos(Math.abs(a1 - a0) / n / 2) : r;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const ri = i === 0 || i === n ? r : rr;
    out.push([cx + ri * Math.cos(a), cy + ri * Math.sin(a)]);
  }
  return out;
}

/**
 * The board as ONE ring, walked counter-clockwise from the point: up the right edge and the
 * shank, over the hook, round its cap, back under the bight, down into the knot, then down the
 * left edge — in and out of every open slot — and back to the point. Corners are rounded where
 * they are drawn (`filletRing`, one radius per vertex; the arcs carry radius 0). A closed slot
 * comes back as a hole instead, and the left edge runs straight.
 *
 * One ring rather than a union of hook, knot and blade: nothing is left for a boolean to weld
 * or to leave a hairline in, so the board is one island by construction.
 */
export function tieOutline(L: TieLayout): { outer: CutRing; holes: CutRing[] } {
  const { cy, rOut, rIn, band } = L.hook;
  const pts: Pt[] = [];
  const radii: number[] = [];
  const at = (p: Pt, r = 0) => { pts.push(p); radii.push(r); };
  const x = (y: number) => L.halfW(y);

  // The point and the right edge, up to the knot's top, then straight up the shank. The point's
  // vertex sits a hair below zero so that, once rounded, the board is exactly `height` tall.
  const half = Math.atan2(L.bladeW / 2, L.tipH);
  at([0, -TIP_R * (1 / Math.sin(half) - 1)], TIP_R);
  at([x(L.tipH), L.tipH], TIP_R);
  at([x(L.knotTop), L.knotTop]);
  // Over the hook: 3 o'clock round to 9, the cap under its end, then back under the bight.
  for (const p of arc(0, cy, rOut, 0, Math.PI, ARC_SEG, true)) at(p);
  const cap = arc(-(rOut + rIn) / 2, cy, band / 2, Math.PI, 2 * Math.PI, ARC_SEG);
  for (const p of cap.slice(1, -1)) at(p);
  for (const p of arc(0, cy, rIn, Math.PI, 0, ARC_SEG)) at(p);
  // Down the shank's inside into the knot, along its top, round the shoulder (the flat run's own
  // points are left out: the fillet needs the whole straight to lay its arc on).
  at([rIn, L.knotTop], NECK_FILLET);
  for (const p of knotTopEdge(L.shoulder.a, L.shoulder.b, L.knotTop, rIn - NECK_FILLET)) if (p[0] <= 1e-9) at(p);

  const holes: CutRing[] = [];
  const mouthR = Math.min(MOUTH_R, L.web / 3);
  for (const s of L.slots) {
    const r = (s.top - s.bottom) / 2;
    const end = arc(s.right - r, s.top - r, r, Math.PI / 2, -Math.PI / 2, ARC_SEG / 2);
    if (L.open) {
      // In along the slot's top, round its end, out along its bottom to the edge again.
      at([-x(s.top), s.top], mouthR);
      for (const p of end) at(p);
      at([-x(s.bottom), s.bottom], mouthR);
    } else {
      // A stadium, walked clockwise as a hole: the far end, then the near end.
      const near = arc(s.left + r, s.top - r, r, -Math.PI / 2, -(3 * Math.PI) / 2, ARC_SEG / 2);
      holes.push([...end, ...near]);
    }
  }
  at([-x(L.tipH), L.tipH], TIP_R);
  return { outer: filletRing(pts, radii), holes };
}

// ------------------------------------------------------------------ the monogram --

/** Roman serif capitals. The photo's monograms are a bold book serif; set side by side on the
 *  knot (fifteen faces, 2026-09-27), Merriweather is the one with that weight — Libre
 *  Baskerville and Cinzel read as the same letters a weight lighter, Abril Fatface as the dressy
 *  version. Every one is a single weight that engraves cleanly at the 10 mm default. */
const ROMAN_FACES = ['merriweather', 'libre-baskerville', 'cinzel', 'abril-fatface', 'playfair-display', 'eb-garamond'];

/**
 * The monogram, engraved on the knot on its centre line, between the shoulder and the first slot.
 *
 * Built, then measured against the real outline (`fitBoxInside`, the box walked point by point so
 * the shoulder counts). It starts halfway down the knot and may drop toward the first slot — the
 * photo's letters sit low, under the shoulder — before it is ever made smaller; and smaller is a
 * rebuild at a lower capital, never a squeeze in one axis, which would be another typeface. The
 * floor is a 3 mm capital; a monogram that still does not fit there is drawn anyway and the
 * build says so.
 */
async function monogram(v: Values, L: TieLayout, board: Shapes, dy: number, warnings: string[]): Promise<DesignLayer[]> {
  const text = applyCase(str(v, 'text'), str(v, 'textCase')).trim();
  if (!text) return [];
  const font = str(v, 'font');
  const mid = (L.knotTop + L.knotBottom) / 2 + dy;
  const low = L.knotBottom + dy;
  const draw = async (cap: number) => {
    const layers = await textLayer(
      { text, symbols: readSymbols(v), font, size: await sizeForCapHeight(font, cap), letterSpacing: num(v, 'letterSpacing') / 100 },
      'engrave', 'monogram', 'Monogram',
    );
    const shapes = layers.flatMap((l) => l.shapes);
    if (!shapes.length) return null;
    const b = bboxOf(shapes);
    const half: Pt = [(b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2];
    // The best height on the knot's centre line: the largest fit, the highest place among equals.
    let best = { k: -1, y: mid };
    for (let y = mid; y >= low + half[1] - 1e-9; y -= 0.5) {
      const k = fitBoxInside(board, [0, y], half, MARGIN, null, 32);
      if (k > best.k + 1e-3) best = { k, y };
      if (k >= 0.999) break;
    }
    const mx = -(b.minX + b.maxX) / 2;
    const my = best.y - (b.minY + b.maxY) / 2;
    return { layers: layers.map((l) => ({ ...l, shapes: placeShapes(l.shapes, mx, my, 0) })), k: best.k };
  };

  let cap = clamp(num(v, 'monogramSize'), CAP_MIN, CAP_MAX);
  let out = await draw(cap);
  for (let pass = 0; out && pass < 3; pass++) {
    if (out.k >= 0.999 || cap <= CAP_FLOOR) break;
    // A hair under the ratio: tracking and side bearings do not scale exactly with the size.
    cap = Math.max(CAP_FLOOR, cap * Math.max(0.2, out.k) * 0.99);
    out = await draw(cap);
  }
  if (!out) return [];
  if (out.k < 0.999) warnings.push('Monogram too long for the knot — shorten it.');
  return out.layers;
}

// ------------------------------------------------------------------ the template --

export const tieHolder: TemplateDef = {
  id: 'tie-holder',
  name: 'Tie holder',
  blurb: 'A tie on a hanger hook, with slots and a monogram.',
  tags: ['gift', 'home', 'engrave + cut'],
  // The photo is three of them with three monograms: a run of initials cuts as one sheet.
  batch: { key: 'text', noun: 'tie holder' },
  fields: [
    // ------------------------------------------------------- RIGHT: what you type --
    {
      // Neutral letters, not the photo's: a monogram is somebody's initials.
      kind: 'text', key: 'text', label: 'Monogram', panel: 'right', section: 'Monogram', value: 'JMR',
      placeholder: 'Initials', maxLength: 6,
    },
    { kind: 'font', key: 'font', label: 'Font', section: 'Font', value: 'merriweather', recommended: ROMAN_FACES },

    // --------------------------------------------------- LEFT: "Tie" — opens first --
    {
      kind: 'number', key: 'height', label: 'Height', section: 'Tie', value: HEIGHT, min: HEIGHT_MIN, max: HEIGHT_MAX, step: 5, unit: 'mm',
      help: 'Hook to point; the width follows.',
    },
    { kind: 'stepper', key: 'slots', label: 'Slots', section: 'Tie', value: 8, min: 4, max: 12 },
    // The photo's slots open on the left; closed slots are the stronger board on 3 mm stock.
    {
      kind: 'toggle', key: 'open', label: 'Slide-in slots', section: 'Tie', value: true,
      help: 'Open on one side, so a tie slips in.',
    },
    {
      kind: 'number', key: 'rod', label: 'Rail size', section: 'Tie', value: ROD, min: ROD_MIN, max: ROD_MAX, step: 1, unit: 'mm',
      help: 'The thickest closet rail the hook fits over.',
    },

    // ------------------------------------------------------------- LEFT: "Lettering" --
    { kind: 'number', key: 'monogramSize', label: 'Monogram size', section: 'Lettering', value: CAP, min: CAP_MIN, max: CAP_MAX, step: 0.5, unit: 'mm' },
    ...letteringFields('Lettering', { textCase: 'upper' }),
  ],

  async build(v: Values): Promise<BuildInput> {
    const warnings: string[] = [];
    const L = tieLayout({
      height: num(v, 'height'), slots: num(v, 'slots'), rod: num(v, 'rod'), open: bool(v, 'open'), cap: num(v, 'monogramSize'),
    });
    const { outer, holes } = tieOutline(L);
    // Centred on its own box, the axis staying at x = 0.
    const dy = -L.height / 2;
    const board = placeShapes([[outer, ...holes]], 0, dy, 0);

    if (L.slots.length < L.asked) warnings.push(`Only ${L.slots.length} slots fit at this height — raise Height.`);
    if (L.height > BED) warnings.push(`Taller than a ${BED} mm bed — lower Height to cut it.`);
    const layers = await monogram(v, L, board, dy, warnings);

    return {
      // No `label`: a batch then names every board by its monogram, the first one included.
      blank: { kind: 'shape', shapes: board, oneIsland: true },
      // The hook is how it hangs: no Ring control, no hole.
      keyring: NO_KEYRING,
      layers,
      ...(warnings.length ? { warnings } : {}),
      status: `${L.slots.length} slots`,
    };
  },

  fileName: (v) => stem(str(v, 'text') || 'monogram', 'tie-holder'),

  exportNote: (v) => `Sized for 6 mm ply; the hook fits a rail up to ${Math.round(clamp(num(v, 'rod'), ROD_MIN, ROD_MAX))} mm.`,
};


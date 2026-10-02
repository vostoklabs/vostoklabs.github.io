// Matching keychains, set 1: two long bars laid long edge to long edge, ONE heart cut through
// across the seam near the right end, the same date along each bar, and an initial with a tiny
// heart at each bar's right end.
//
// WHAT THE DESIGN IS, measured on a close crop rather than read off a thumbnail:
// - The heart lies ON ITS SIDE: its cleft and its point both sit on the seam, the point toward
//   the bars' right end. So the seam runs down the heart's own axis and each bar carries ONE
//   lobe as an open notch in its long edge — the top bar's notch is a single dome, and so is the
//   bottom bar's. "Lobes in the top bar, point in the bottom bar" would give the top bar a
//   two-bump notch with a cusp between; the photo's top notch has one bump.
// - The initials are UPRIGHT, like the date: the H's legs and the L's stem run parallel to the
//   bars' end edges, and the L's foot runs toward the right end. Each sits in a column at the
//   right end, the tiny heart above it — the same layout on both bars — and the big heart's
//   tapering point tucks in beside them, which is how the photo fits a long date on the bar.
// - The tiny hearts were the big heart again, small and engraved, pointing the same way. That
//   read as a heart lying on its side, with no option to change or remove it (2026-09-29). The
//   small mark is now a symbol the customer picks on the right, under the
//   initials — an upright heart by default, any symbol or their own SVG, or Remove — fitted to
//   the same square above each initial. Only the big, cut heart still lies on its side: that is
//   what makes one heart out of two bars.
//
// THE ONE FRAME (couple-keychains' method, turned a quarter): both bars are built in the PAIR's
// frame, seam at y = 0 — the top bar spans y ∈ [g, g + H], the bottom one y ∈ [−(g + H), −g],
// g = TAG_GAP/2. The heart is written once, on the seam, and each bar keeps its own half of it,
// so the two notches are one heart by construction rather than two drawings that nearly agree.
// `layout` stacks them on the sheet at the same 0.5 mm gap and `assembledAt: 'built'` puts the
// bottom bar back where it was built, so the cut file, the card and the 3D view are the photo.
//
// THE HEART'S CLEFT. `@vostok/laser`'s heart draws its lobes as two circles TANGENT to each other
// at the cleft, so split down the axis each half meets the seam at 0° — a knife-edge horn of
// wood under each lobe: 0.4 mm thick 1 mm back from its tip, still under 1 mm 2 mm back (§2.1:
// never under 1 mm). Here the lobe circles cross the axis at CLEFT = 30° instead, so the point of
// material the cleft leaves is a real corner, like a star's tip — 0.9 mm and 2.1 mm at those two
// places on the default — and the heart keeps the sibling's proportion (0.88 : 1) and its look.
//
// Rules of thumb: two independent pieces that complete the picture side by side; a cut-through
// heart is a notch in the inner edge; a 4–5 mm hole with ≥ 3 mm of wall; a web that carries
// anything ≥ 3 mm on 3 mm stock.
import { bboxOf, heartRing, placeShapes, roundedRectRing, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { fitShapes, symbolLayer, textLayer } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import { finalHoleCentre, keyringCentre } from '../engine/editorGeometry';
import { subdivideShapes } from '../engine/warp';
import { readSymbols, type InlineSymbol, type SymbolMap } from '../symbols/model';
import { keyringFields, keyringFrom } from './keyring';
import { stem } from './shared';
import type { DesignLayer, KeyringSpec, PartInput } from '../engine/types';
import { bool, num, str, type TemplateDef } from './types';

type Pt = [number, number];
type Side = -1 | 1;
interface Box { minX: number; minY: number; maxX: number; maxY: number }

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The air between the two bars, mm — the join (couple-keychains' number and reason: small
 *  enough that the pair reads as one picture; the sliver between the outlines is scrap). */
const TAG_GAP = 0.5;
/** The hanging hole's wall (§5.2: ≥ 3 mm on something that carries keys) — the Hole border the
 *  Ring control ships at, which also rests the 4 mm hole 5 mm in from the left end. */
const HOLE_WALL = 3;
/** Every web the notch leaves: from the lobe's deepest point to the bar's outer edge, from the
 *  heart to the hanging hole, and from the heart's point to the rounded end. §2.1: ≥ the
 *  material thickness on 3 mm stock, because the outer web is all that joins the bar's two ends. */
const WEB = 3;
/** Ink to the bar's right end (the initials) and to its left end when there is no hole. */
const EDGE = 3;
const END_MARGIN = 4;
/** Air between the heart and any engraving beside it (couple-keychains' INITIAL_AIR), and the
 *  wider breath the date takes before the heart. */
const AIR = 1.5;
const DATE_AIR = 2;
/** Air the date keeps past the hole's keep-off disc (dia/2 + border), which the engine's "the
 *  ring sits on the lettering" net tests glyph by glyph. */
const HOLE_AIR = 0.5;
/** The heart's length along the seam as a share of its width across it — the proportion
 *  `@vostok/laser`'s own heart ships at (34 × 30), and the sibling's. */
const HEART_RATIO = 0.88;
/** The angle each lobe meets the seam at, degrees — see the header. */
const CLEFT = 30;
/** The column at the right end the initial is fitted into, as a share of its cap height — wide
 *  enough for a serif M at full size; a W or a pair of letters shrinks to it. Reserved by DESIGN,
 *  not by the letter typed, so the heart never jumps about while someone types. */
const COLUMN = 1.3;
/** A capital under this stops reading once it is burnt into wood. */
const MIN_CAP = 3;
/** The longest edge a bar's outline keeps, mm. `holdInside` — which kept a dragged hole in
 *  material, in the build and the preview's drag alike — only ever tries the outline's own
 *  vertices, set in by the hole's clearance, as places to put it. A rounded rectangle's long
 *  sides have no vertices, so a hole nudged 2 mm off its rest jumped to the only candidates
 *  there were — the corners, 0.2 mm from the edge. At 0.5 mm there is one every half millimetre
 *  all the way round, and a held hole lands 3.00 mm off the edge, where it was asked to be.
 *  Since 2026-09-28 the ring is a loop tab that nothing holds; the outline keeps its vertices,
 *  because it is what the tab rests on and welds to, and the shipped bars are built from it. */
const SEG = 0.5;

/** A heart typed into the date or an initial ("♥ 2023") is drawn by the design, not the font:
 *  none of the faces below has U+2665 or U+2764, nor has the fallback face, so it engraved as the
 *  empty box a font puts where a glyph is missing (heart-puzzle-keychains' fix, the same numbers:
 *  a 0.55 em heart centred on the line). */
const TYPED_HEARTS: SymbolMap = Object.fromEntries(['♥', '❤'].map((char): [string, InlineSymbol] =>
  [char, { id: 'typed-heart', label: 'Heart', source: 'template', char, shapes: [[heartRing(1, 0.95)]], scale: 0.55, dx: 0, dy: 0, rotation: 0 }]));

/** The small symbol's default: Material Symbols' `favorite`, an upright heart — the one the
 *  bracelet set's card wears. */
const HEART = '\u{e87d}';

/** The ink box of a run of shapes, or null when there is no ink. */
const inkBox = (s: Shapes): Box | null => (s.length ? bboxOf(s) : null);

// ---------------------------------------------------------------------- the heart --

/**
 * A heart lying on its side: its axis on y = 0, its point toward +x at (len/2, 0), its lobes'
 * backs at x = −len/2, its lobes reaching y = ±w/2. Two lobe circles of radius R whose centres
 * sit c = R·cos(CLEFT) off the axis, so they cross it at the cleft at CLEFT degrees (not
 * tangent — see the header); w = 2(c + R). The flanks are the outer tangents from the point.
 * Built point-down, then turned a quarter anticlockwise.
 */
export function sideHeartRing(w: number, len: number, n = 40): CutRing {
  const phi = (CLEFT * Math.PI) / 180;
  const R = w / (2 * (1 + Math.cos(phi)));
  const c = R * Math.cos(phi);
  const yc = len / 2 - R;
  const P: Pt = [0, -len / 2];
  const Cr: Pt = [c, yc];
  const Cl: Pt = [-c, yc];
  // The outer tangent from P to the right circle (heartRing's construction).
  const ux = P[0] - Cr[0];
  const uy = P[1] - Cr[1];
  const d2 = ux * ux + uy * uy;
  const L = Math.sqrt(Math.max(0, d2 - R * R));
  const k = R / d2;
  const Tr: Pt = [Cr[0] + k * (R * ux - L * uy), Cr[1] + k * (R * uy + L * ux)];
  const Tl: Pt = [-Tr[0], Tr[1]];
  const cleftY = yc + R * Math.sin(phi);

  const down: Pt[] = [P];
  // The flank is a straight line; it is subdivided so a distance test against its points alone
  // is exact to a fraction of a millimetre.
  const line = (a: Pt, b: Pt) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.4));
    for (let i = 1; i <= steps; i++) down.push([a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps]);
  };
  const arc = (C: Pt, from: number, to: number) => {
    let end = to;
    while (end < from) end += Math.PI * 2;
    for (let i = 1; i <= n; i++) {
      const t = from + ((end - from) * i) / n;
      down.push([C[0] + R * Math.cos(t), C[1] + R * Math.sin(t)]);
    }
  };
  const ang = (C: Pt, p: Pt) => Math.atan2(p[1] - C[1], p[0] - C[0]);
  line(P, Tr);
  arc(Cr, ang(Cr, Tr), ang(Cr, [0, cleftY])); // right lobe, over the top, down to the cleft
  arc(Cl, ang(Cl, [0, cleftY]), ang(Cl, Tl)); // left lobe, over the top, down to its tangent
  line(Tl, P);
  down.pop(); // the flank's last point is P, which the ring already starts on
  // A quarter turn anticlockwise: (x, y) → (−y, x). The point goes to +x, the cleft to −x.
  return down.map(([x, y]) => [-y, x] as Pt) as CutRing;
}

// ------------------------------------------------------------------------ the bars --

/**
 * The part of a closed ring beyond the line y = e on `side` (+1 above it, −1 below), as ONE open
 * run from where the ring crosses the line going out to where it comes back, both crossings
 * exact. The heart crosses each bar's inner edge twice — under its cleft and near its point —
 * so its lobe is one run.
 */
function beyondEdge(ring: CutRing, e: number, side: Side): Pt[] {
  const n = ring.length;
  const out = (p: Pt) => side * (p[1] - e) > 0;
  const at = (i: number) => ring[((i % n) + n) % n] as Pt;
  const cross = (a: Pt, b: Pt): Pt => [a[0] + ((e - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), e];
  const start = ring.findIndex((p, i) => out(p as Pt) && !out(at(i - 1)));
  if (start < 0) return [];
  const run: Pt[] = [cross(at(start - 1), at(start))];
  for (let k = start; k < start + n; k++) {
    if (!out(at(k))) { run.push(cross(at(k - 1), at(k))); break; }
    run.push(at(k));
  }
  return run;
}

/**
 * One bar's outline in the pair's frame, with its half of the heart taken out of its INNER
 * (seam-side) edge, every edge ≤ SEG.
 *
 * The notch is drawn INTO the outline rather than cut by a layer afterwards, because the outline
 * is what everything that reasons about the blank reads: the engine's hold that kept a punched
 * hole in material (until 2026-09-28), the tab's weld, the preview's drag, the ring's own
 * warnings. Cut as a layer, the blank those saw had no notch, and a hole nudged toward the heart
 * sat 2.4 mm off it or broke into it with nothing said — and a tab dragged there now would be
 * welded on first and then cut through. The lobe's run is spliced into the inner edge between
 * its two crossings; the heart is symmetric about the seam, so the two bars' outlines are exact
 * mirror images, and so is where each ring lands.
 */
function barRing(W: number, H: number, corner: number, side: Side, heart: CutRing | null): CutRing {
  const g = TAG_GAP / 2;
  const cy = side * (g + H / 2);
  const e = side * g;
  const ring: Pt[] = roundedRectRing(W, H, corner).map(([x, y]) => [x, y + cy] as Pt);
  const run = heart ? beyondEdge(heart, e, side) : [];
  if (run.length > 2) {
    const lo = Math.min(run[0]![0], run[run.length - 1]![0]);
    const hi = Math.max(run[0]![0], run[run.length - 1]![0]);
    for (let j = 0; j < ring.length; j++) {
      const a = ring[j]!;
      const b = ring[(j + 1) % ring.length]!;
      if (Math.abs(a[1] - e) > 1e-6 || Math.abs(b[1] - e) > 1e-6 || Math.min(a[0], b[0]) > lo || Math.max(a[0], b[0]) < hi) continue;
      // Into the notch from the crossing nearest where this edge starts, out at the other.
      const first = Math.abs(run[0]![0] - a[0]) <= Math.abs(run[run.length - 1]![0] - a[0]);
      ring.splice(j + 1, 0, ...(first ? run : [...run].reverse()));
      break;
    }
  }
  return subdivideShapes([[ring as CutRing]], SEG)[0]![0]! as CutRing;
}

// ------------------------------------------------------------------ clearances --

/** Is `p` inside the ring (even–odd)? */
function inRing(ring: CutRing, p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const boxDist = (b: Box, p: Pt) => Math.hypot(Math.max(b.minX - p[0], 0, p[0] - b.maxX), Math.max(b.minY - p[1], 0, p[1] - b.maxY));

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The air between a ring and a box, mm — 0 where they touch or overlap. Exact for a polygon:
 *  the nearest pair is a ring vertex against the box, or a box corner against a ring edge. */
function airBetween(ring: CutRing, b: Box): number {
  const corners: Pt[] = [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]];
  if (corners.some((c) => inRing(ring, c))) return 0;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[i]!;
    best = Math.min(best, boxDist(b, p));
    for (const c of corners) best = Math.min(best, segDist(c, ring[j]!, p));
    if (best === 0) return 0;
  }
  return best;
}

// ------------------------------------------------------------------- the layout --

interface Plan {
  /** The heart, placed on the seam, and the numbers it was placed with. */
  heart: CutRing;
  heartW: number;
  /** The heart was asked for bigger than the bars can hold with their webs. */
  heartTrimmed: boolean;
  /** The right-end column: its centre, the initial's cap height and the small symbol's square. */
  colX: number;
  column: number;
  initialCap: number;
  tinyW: number;
  /** Per bar, where the small symbol and the initial sit (identical layouts, as in the photo). */
  rows: (side: Side) => { tinyY: number; initialY: number };
  /** The run the date is centred in. */
  dateX0: number;
  dateX1: number;
}

/**
 * Left to right, per bar: the hole · the date · the heart · the column (tiny heart over the
 * initial). The column is fixed by the bar's own size; the heart then slides as far right as it
 * can while its point keeps WEB of straight edge before the rounded end and its flank keeps AIR
 * off everything in the column — its tapering point tucks in beside the initial, as in the photo
 * — and the date takes whatever is left between the hole and the heart. The heart only gives way
 * (trimmed, with a warning) where the bars cannot hold it with every web at WEB.
 */
function planOf(o: {
  W: number; H: number; corner: number; heartSize: number; small: boolean;
  /** Where the date may begin, and where the heart must stop short of the hole's wall. */
  dateFrom: number; heartFrom: number;
}): Plan {
  const { W, H } = o;
  const g = TAG_GAP / 2;
  const initialCap = clamp(0.28 * H, 4, 8);
  const column = COLUMN * initialCap;
  const colX = W / 2 - EDGE - column / 2;
  // The small symbol is fitted, longer side, into a tinyW square.
  const tinyW = clamp(0.16 * H, 2.5, 4.5);
  // A clear gap, as the photo has: a tiny heart sat right on a capital reads as an accent on it.
  const tinyGap = 0.14 * H;
  const rows = (side: Side) => {
    const yc = side * (g + H / 2);
    const block = (o.small ? tinyW + tinyGap : 0) + initialCap;
    const top = yc + block / 2;
    return { tinyY: top - tinyW / 2, initialY: top - (o.small ? tinyW + tinyGap : 0) - initialCap / 2 };
  };
  // What the heart must keep AIR off: the initial's reserved slot and the tiny heart, both bars.
  const keepOff: Box[] = [];
  for (const side of [1, -1] as Side[]) {
    const r = rows(side);
    keepOff.push({ minX: colX - column / 2, maxX: colX + column / 2, minY: r.initialY - initialCap / 2, maxY: r.initialY + initialCap / 2 });
    if (o.small) keepOff.push({ minX: colX - tinyW / 2, maxX: colX + tinyW / 2, minY: r.tinyY - tinyW / 2, maxY: r.tinyY + tinyW / 2 });
  }

  // The deepest the notch may bite and keep WEB to the bar's outer edge: w/2 ≤ g + H − WEB.
  const asked = clamp(o.heartSize, 8, 200);
  const pMax = W / 2 - o.corner - WEB;
  let w = Math.min(asked, 2 * (g + H - WEB));
  for (; w >= 8; w -= 0.25) {
    const len = w * HEART_RATIO;
    const base = sideHeartRing(w, len);
    // Slide left by whatever air is still missing: the air can grow by at most the distance
    // moved, so this never overshoots, and it settles in a handful of steps.
    for (let px = pMax; px - len >= o.heartFrom - 1e-9;) {
      const ring = base.map(([x, y]) => [x + px - len / 2, y] as Pt) as CutRing;
      const air = Math.min(...keepOff.map((b) => airBetween(ring, b)));
      if (air < AIR) { px -= Math.max(0.02, AIR + 0.01 - air); continue; }
      return {
        heart: ring, heartW: w, heartTrimmed: asked > w + 0.05,
        colX, column, initialCap, tinyW, rows, dateX0: o.dateFrom, dateX1: px - len - DATE_AIR,
      };
    }
  }
  // Nothing fits: a bar too short for any heart. Build the smallest one against the hole and let
  // the date's own warning say what to change — never throw on a slider.
  const len = 8 * HEART_RATIO;
  const ring = sideHeartRing(8, len).map(([x, y]) => [x + o.heartFrom + len / 2, y] as Pt) as CutRing;
  return {
    heart: ring, heartW: 8, heartTrimmed: true,
    colX, column, initialCap, tinyW, rows, dateX0: o.dateFrom, dateX1: o.heartFrom - DATE_AIR,
  };
}

// --------------------------------------------------------------------------- the form --

/** One serif for the date and the initials, which is what the photo wears. Each face is built
 *  at the shipped size before it is listed (tests/node/heart-cutout-keychains.test.mjs, the fonts
 *  section): a ten-character date that still clears a 3 mm cap in the room it gets, and an
 *  initial that fills its column without leaving it. Every one sets LINING figures, as the
 *  photo's date does — Playfair and EB Garamond were tried and dropped: their old-style figures
 *  set "14-02-2023" as lowercase numerals half the height of the bar's other lettering. */
const FACES = ['libre-baskerville', 'pt-serif', 'lora', 'spectral', 'cinzel', 'marcellus', 'domine'];

export const heartCutoutKeychains: TemplateDef = {
  id: 'heart-cutout-keychains',
  name: 'Heart cutout keychains',
  blurb: 'Two bars that share one cut-out heart and a date.',
  tags: ['couple', 'keychain', 'engrave + cut'],
  fields: [
    // ------------------------------------------------------------------ RIGHT --
    // In the order they sit on the piece: the date along the bars, then the initials at the end.
    {
      kind: 'text', key: 'date', label: 'Date', panel: 'right', section: 'Date',
      value: '14-02-2023', maxLength: 16, symbols: false, placeholder: 'A date, or a short word',
    },
    {
      // couple-keychains' switch and wording: off is the same string on both bars, whole.
      kind: 'toggle', key: 'dateDifferent', label: 'Different text on each', panel: 'right', section: 'Date', value: false,
    },
    {
      kind: 'text', key: 'date2', label: 'Date 2', panel: 'right', section: 'Date',
      value: 'Always', maxLength: 16, symbols: false, placeholder: 'What the second bar says',
      visibleWhen: (v) => v.dateDifferent === true,
    },
    {
      kind: 'text', key: 'initialTop', label: 'Initial 1', panel: 'right', section: 'Initials',
      value: 'A', maxLength: 2, symbols: false, placeholder: 'One letter',
    },
    {
      kind: 'text', key: 'initialBottom', label: 'Initial 2', panel: 'right', section: 'Initials',
      value: 'M', maxLength: 2, symbols: false, placeholder: 'One letter',
    },
    {
      kind: 'symbol', key: 'smallSymbol', label: 'Small symbol', panel: 'right', section: 'Initials',
      value: HEART, clearable: true, help: 'Engraved above each initial.',
    },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'libre-baskerville', recommended: FACES },

    // ------------------------------------------------------------ LEFT: "Tags" --
    // 70 × 22 is the photo's 3.2 : 1, sized so its ten-character date keeps a ~4 mm capital
    // between the hole's keep-off and a 26 mm heart. Both ends of every slider build the shipped
    // design with nothing to say (G25): under 66 mm the default date drops under a 3 mm capital
    // in every recommended face, and a 30 mm heart still leaves it 3.4 mm.
    { kind: 'number', key: 'width', label: 'Width', section: 'Tags', value: 70, min: 66, max: 90, step: 1, unit: 'mm' },
    { kind: 'number', key: 'height', label: 'Height', section: 'Tags', value: 22, min: 18, max: 28, step: 1, unit: 'mm' },
    {
      kind: 'number', key: 'heartSize', label: 'Heart size', section: 'Tags', value: 26, min: 16, max: 30, step: 1, unit: 'mm',
      help: 'Across both bars — each one carries half.',
    },

    // --------------------------------------------------------- LEFT: "Keyring" --
    // The shared control, Loop tab | None (couple-keychains' ruling: "our usual keyring, just be
    // default placed as a hole" — a Hole option from 2026-09-22, the tab RESTING inside the bar
    // where that hole was since 2026-09-28), at the LEFT end, which is where the photo hangs both
    // bars from. The border is §5.2's 3 mm and stops at 5, so the keep-off disc (dia + 2 × border)
    // never outgrows a 22 mm bar; the nudge is half the bar's length, so the ring reaches any
    // point ON the bar and nowhere else.
    ...keyringFields('outside', {
      rest: 'inside', dia: 4, ring: HOLE_WALL, side: 'left', along: 50, nudge: 35, maxDia: 6, maxRing: 5,
      ringNote: 'Both bars wear the same ring, mirrored.',
    }),

    // ------------------------------------------------------ LEFT: "More options" --
    {
      kind: 'number', key: 'corner', label: 'Corner radius', section: 'Tags', value: 2,
      min: 0, max: 5, step: 0.5, unit: 'mm', advanced: true,
    },
    {
      kind: 'number', key: 'dateSize', label: 'Date size', section: 'Date', value: 4,
      min: 3, max: 6, step: 0.5, unit: 'mm', advanced: true,
      help: 'Long text shrinks past this to fit.',
    },
  ],

  async build(v) {
    const warnings: string[] = [];
    const W = clamp(num(v, 'width'), 40, 140);
    const H = clamp(num(v, 'height'), 12, 40);
    const corner = clamp(num(v, 'corner'), 0, 0.3 * H);
    const font = str(v, 'font');
    // The small symbol, upright, drawn at any size and scaled to the column's square below
    // (`fitShapes`). No symbol, or one with no ink, and the column holds the initial alone.
    const smallChar = str(v, 'smallSymbol');
    const smallInk = smallChar ? (await symbolLayer(smallChar, 10, 'engrave', { symbols: readSymbols(v) })).flatMap((l) => l.shapes) : [];
    const small = smallInk.length > 0;
    const dateOf = (side: Side) => (side > 0 || !bool(v, 'dateDifferent') ? str(v, 'date') : str(v, 'date2')).trim();

    const g = TAG_GAP / 2;
    /** The centre line of one bar, in the pair's frame: +1 the top bar, −1 the bottom one. */
    const cy = (side: Side) => side * (g + H / 2);

    const keyring: KeyringSpec = keyringFrom(v);
    const inside = keyring.enabled && keyring.restInside === true;
    const holeDia = clamp(keyring.dia, 1.5, 8);
    /** The same ring, undragged — where this design hangs from before anyone touches it. */
    const atRest: KeyringSpec = { ...keyring, position: -1, dx: 0, dy: 0 };

    // Where the ring RESTS decides where the date may start — not where it was dragged: a date
    // that followed the pointer would squash under it, and a drag onto the lettering is what the
    // engine's "the ring sits on the lettering" is for. Only a ring resting INSIDE the bar at its
    // LEFT end moves the design (a tab standing off the end frees the face; one the customer has
    // sent to another side leaves the bar's own margins). It is read off the plain bar, because
    // the heart is placed from it: the rest is on the bar's end, which the notch never reaches, so
    // it is the same point on the notched outline.
    const rest = inside ? keyringCentre([[barRing(W, H, corner, 1, null)]], atRest) : null;
    const atLeftEnd = !!rest && rest[0] < -W / 4;
    const plan = planOf({
      W, H, corner, small,
      heartSize: num(v, 'heartSize'),
      dateFrom: atLeftEnd ? rest![0] + holeDia / 2 + keyring.ring + HOLE_AIR : -W / 2 + END_MARGIN,
      heartFrom: atLeftEnd ? rest![0] + holeDia / 2 + WEB : -W / 2 + corner + WEB,
    });
    if (plan.heartTrimmed) warnings.push('Heart trimmed to fit — raise Height or Width for the full size.');

    // ---------------------------------------------------- the two bars and the heart --
    // ONE heart on the seam; each bar's outline keeps its own half of it as a notch (`barRing`).
    const topBody: Shapes = [[barRing(W, H, corner, 1, plan.heart)]];
    const bottomBody: Shapes = [[barRing(W, H, corner, -1, plan.heart)]];

    // ------------------------------------------------------------- the two rings --
    // couple-keychains' method, mirrored across the seam instead of the join: the TOP bar is the
    // primary and the engine places its ring as on every other design (rest, drag, nudge, and the
    // weld — a tab dragged onto the notch welds into it rather than losing its wall); the bottom
    // bar is a part carrying the same spec, resting at the mirror of wherever the top one settled.
    // One number, negated, on a mirror-image outline — the two cannot drift.
    const topHole: Pt | null = keyring.enabled ? finalHoleCentre(topBody, keyring).centre : null;
    const bottomRing: PartInput['keyring'] = topHole ? { ...atRest, rest: [topHole[0], -topHole[1]] } : 'none';

    // ------------------------------------------------------ the column at the right end --
    const tiny = small ? fitShapes(smallInk, plan.tinyW) : [];
    const smallLayer = (side: Side): DesignLayer[] => (small
      ? [{ id: side > 0 ? 'small-heart-top' : 'small-heart-bottom', label: 'Small symbol', shapes: placeShapes(tiny, plan.colX, plan.rows(side).tinyY, 0), op: 'engrave' }]
      : []);

    /** Fit one run of text into `room` mm at `cap`, shrinking with no floor — a letter held at
     *  3 mm while its room is 2 mm runs into the heart, which is a broken file dressed as a
     *  warning (couple-keychains). The floor is what the sentence is ABOUT, not a clamp. */
    const draw = async (text: string, cap: number, x = 0, y = 0, id = 'probe', label = '') =>
      textLayer({ text, font, size: await sizeForCapHeight(font, cap), x, y, symbols: TYPED_HEARTS }, 'engrave', id, label);
    /** How wide `text` sets at `cap`, mm — 0 for no ink. */
    const widthAt = async (text: string, cap: number) => {
      const b = text ? inkBox((await draw(text, cap)).flatMap((l) => l.shapes)) : null;
      return b ? b.maxX - b.minX : 0;
    };
    /** The one cap a PAIR of runs shares: the asked size, or less if the wider needs it. */
    const pairCap = async (texts: string[], cap: number, room: number) => {
      let out = cap;
      for (const t of texts) {
        const w = await widthAt(t, cap);
        if (w > room) out = Math.min(out, (cap * room) / w);
      }
      return out;
    };
    const fitted = async (text: string, cap: number, room: number, x: number, y: number, id: string, label: string, tooLong: string) => {
      if (!text) return [];
      if (room <= 0.5) { warnings.push(tooLong); return []; }
      let built = await draw(text, cap, x, y, id, label);
      let b = inkBox(built.flatMap((l) => l.shapes));
      if (!b) return [];
      if (b.maxX - b.minX > room) {
        const shrunk = (cap * room) / (b.maxX - b.minX);
        built = await draw(text, shrunk, x, y, id, label);
        b = inkBox(built.flatMap((l) => l.shapes));
        if (shrunk < MIN_CAP - 0.05) warnings.push(tooLong);
      }
      return b ? built : [];
    };

    // The two initials are ONE size — they are a matched pair — set so the wider of the two fills
    // the column: an A beside an M must not come out a millimetre taller than it. The two dates
    // likewise, when they differ: "Jane" beside "John Smith Jr" is one line of lettering broken
    // across two bars, and a 4 mm word over a 2.6 mm one reads as a mistake.
    // U+FE0F only asks for the emoji look of the ❤ before it; no face has a glyph for it.
    const clean = (s: string) => s.replace(/️/g, '').trim();
    const initialOf = (side: Side) => clean(str(v, side > 0 ? 'initialTop' : 'initialBottom'));
    const initialCap = await pairCap([initialOf(1), initialOf(-1)], plan.initialCap, plan.column);
    if (initialCap < MIN_CAP - 0.05) warnings.push('The initials only fit under 3 mm — use one letter.');
    const dateTooLong = 'The date is too long for these bars — shorten it, or raise Width.';
    const dateCap = await pairCap([clean(dateOf(1)), clean(dateOf(-1))], clamp(num(v, 'dateSize'), MIN_CAP, 20), plan.dateX1 - plan.dateX0);
    if (dateCap < MIN_CAP - 0.05) warnings.push(dateTooLong);

    const layersOf = async (side: Side): Promise<DesignLayer[]> => {
      const top = side > 0;
      return [
        ...smallLayer(side),
        ...(await fitted(initialOf(side), initialCap, plan.column,
          plan.colX, plan.rows(side).initialY, top ? 'initial-top' : 'initial-bottom', 'Initial',
          'The initials only fit under 3 mm — use one letter.')),
        ...(await fitted(clean(dateOf(side)), dateCap, plan.dateX1 - plan.dateX0,
          (plan.dateX0 + plan.dateX1) / 2, cy(side), top ? 'date-top' : 'date-bottom', 'Date', dateTooLong)),
      ];
    };

    // The notch bites the bar's INNER edge, so what joins its two ends is the web along the
    // OUTER edge. `planOf` clamps the heart so it is ≥ WEB; it is stated here so a future change
    // to the clamp trips a warning rather than shipping a snapped bar (§2.1).
    if (g + H - plan.heartW / 2 < WEB - 1e-6) warnings.push('The heart leaves the bars too thin — lower Heart size.');

    const bottomPart: PartInput = {
      id: 'bottom',
      label: 'Bottom',
      blank: { kind: 'shape', shapes: bottomBody, oneIsland: true },
      layers: await layersOf(-1),
      keyring: bottomRing,
      // Built seam to seam and stacked at the same gap, so gluing up is a no-op — saying it
      // keeps the card and the 3D view honest if the gap ever changes.
      assembledAt: 'built',
      material: 'light',
    };

    return {
      label: 'Top',
      blank: { kind: 'shape', shapes: topBody, oneIsland: true },
      keyring,
      layers: await layersOf(1),
      parts: [bottomPart],
      // The join, on the sheet as well as in the picture: the cut file IS the product photo.
      layout: { flow: 'column', gap: TAG_GAP },
      material: 'light',
      // Both bars are built by the same code, so a sentence about the date is said twice.
      ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}),
    };
  },

  exportNote: 'Cut both bars — the heart appears when they sit together.',

  fileName: (v) => stem(str(v, 'initialTop').toLowerCase() || 'one', str(v, 'initialBottom').toLowerCase() || 'two', 'heart-keychains'),
};


import { readSymbols } from '../symbols/model';
// The cat ornament: a cat's head as a light FRAME with the name welded into its window, a dark
// head behind it, and one ribbon hole through both at the crown.
//
// Rebuilt 2026-09-21: one head (the cat), done well, instead of four. What it was
// this morning and why it is not that any more:
//
// · It was FOUR heads — cat, dog, bear, bunny — and the rule is now one shape per template, so
//   the picker, the per-animal name band (`useAbove`) and the ear-width guard are gone with it.
//   The other blanks stay in `@vostok/laser` for whoever wants them.
// · The name was a light piece floating under the muzzle. Now it is WELDED INTO THE
//   FRAME — "Missy" runs into the rim at both ends and the seams are scored — which is what makes
//   the ornament one light piece instead of a frame plus a sticker.
// · The loop was the shared Ring control. It is the design's own hole now: a
//   round boss at the crown between the ears, `keyring: 'shared'` so it goes through both sheets.
// · The Santa hat is not here. See WHY NO HAT below.
//
// The pieces — the same silhouette about one origin, so the glue-up is the build frame again:
//   FRAME   primary. The head with its window taken out, the ears, the whiskers and the hanging
//           boss, and — when the name reaches — the name's own glyphs, all handed in as material
//           to a `{ kind: 'hug', margin: 0 }` blank. That is the plain union of what it is given
//           (G31), so the frame and the name come off the bed as ONE piece — plus the two things
//           a `shape` blank has not got: `minHole`, which fills the sliver a letter leaves where
//           it crosses the window at a shallow angle, and the bar that joins an i's tittle to its
//           stem instead of leaving it to fall out of the window.
//   BACKER  the same silhouette solid, dark, with the year engraved low in the window, the shared
//           hole, and `assembledAt: 'built'`.
//   NAME    only when the name is too short to reach the rim: its own light piece over a scored
//           glue guide: text need not be a single body.
//
// WHY A DRAWN RING AND NOT `{ kind: 'rim' }`. A true offset is the better frame — it is what the
// worker's rim blank does — but a rim blank's plate is the ring and nothing else, and nothing
// downstream can UNION the name into it. The name welded to the frame is the product here, so the
// ring is drawn instead: the head is a circle, whose inset is a concentric circle, so the band is
// exactly `rimWidth` wide all the way round it (`family-crossword.ts` builds its frames the same
// way and for the same reason). The ears, the whiskers and the boss are protrusions thinner than
// twice the band, so a true inset erases them too — they are solid on the frame, exactly as they
// are on the back piece.
//
// WHY THE EARS ARE SOLID. A framed ear would need a window inside it. Ours cannot: `catEars` draws
// an ear 0.32 w across the base with an inradius of 6.2 mm at the default head, and a 6.3 mm band
// leaves a window 0.1 mm wide inside it — under the 3 mm minimum hole for 3 mm ply.
// A bigger ear is a change to the blank, and the
// report says exactly which line.
//
// WHY NO HAT. A Santa hat toggle would only be worth it if it read cleanly. It does not: the hat's
// brim crosses the crown, which is where this design's hanging boss and its hole now live, so the
// ornament would hang from under its own hat. A hatted cat is a different product (and a second
// silhouette), which is the one thing tonight's rules forbid inside one template.
import {
  bboxOf,
  blankById,
  buildBlank,
  circleRing,
  placeShapes,
  roundedRectRing,
  type BlankParams,
  type Box,
  type Pt,
  type Shapes,
} from '@vostok/laser';
import { pointInRing } from '@vostok/patterns';
import type { CutRing } from '@vostok/export';
import { rimWidthFor } from '../engine/frame';
import { sizeForCapHeight } from '../engine/metrics';
import { MIN_COUNTER, applyCase, textLayer } from '../engine/text';
import type { DesignLayer, KeyringSpec, PartInput } from '../engine/types';
import { NO_KEYRING, hangHoleFields } from './keyring';
import { connectSpec, countersTooTight, letterScoreField, letteringFields, lightPieceFields, stem } from './shared';
import { num, str, type TemplateDef } from './types';

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/**
 * The faces this design is for, in order (G2), and it is the same shelf the Christmas ornament
 * measured: the name is CUT as one welded body, so the question is not what a face looks like but
 * what survives the weld. A fat rounded face has strokes and bowls that do; a script's hairlines
 * do not, and a script set this big inside a round window reads as a signature, not a pet's name.
 * Every one of these was built here at "Missy" and at "Bartholomew" and cuts silently.
 *
 * None of them connects on its own, and that is the design rather than a compromise — G33's block
 * case, where the letters overlap a little and the seams are scored. So `connectWarning` is not
 * raised here: "pick a script that connects" would fire on every build of this one.
 *
 * Luckiest Guy and Titan One are NOT here, and they are the two the Christmas ornament keeps: both
 * are wide, so an eleven-letter name shrinks further in them than in any other face on the shelf,
 * and at "Bartholomew" on the 90 mm default their counters measure under a millimetre and the
 * template warns. A recommendation that warns on a name someone will actually type is not one.
 */
const BUBBLY = ['fredoka', 'baloo-2', 'chewy', 'sniglet', 'jua', 'comfortaa', 'nunito'];

/** How far past the head's own edge the whiskers reach, as a share of its radius — so Size is the
 *  span across the whisker tips and the head follows from it: `size = 2R(1 + REACH)`. */
const REACH = 0.32;
/** How far a whisker's inner end is buried in the head, mm: enough that the capsule always welds
 *  and never reaches the window (the band is never narrower than 5 mm). */
const SINK = 3;
/** Each whisker's root angle on the head's circle and the direction it points, degrees from the
 *  x axis, for the RIGHT side; the left side is the mirror. Three a side, fanning down and out. */
const WHISKERS: { root: number; dir: number }[] = [
  { root: 12, dir: 20 },
  { root: -4, dir: 0 },
  { root: -20, dir: -19 },
];
/** A whisker's width, mm. A free decorative end, not a loaded web: 2.5 mm is two and a half times
 *  Ponoko's absolute 1 mm floor, it grows with the ornament,
 *  and in the glue-up the frame's whisker sits on the backer's, 6 mm of ply together. */
const whiskerWidth = (R: number) => Math.max(2.5, 0.075 * R);

/** Material left round the hanging hole, mm — the wall the boss at the crown is built from. The
 *  house floor for a light decorative hanger is 2 mm (§5.2); this is that with a margin, and the
 *  0.4 mm of slack keeps `holdInside` from deciding the hole does not fit its own boss. */
const WALL = 3;
const SLACK = 0.4;

/** How far past the window's edge the name is drawn when it welds, mm — the bite that makes the
 *  frame and the letters one piece. */
const BITE = 2;
/** Frame material left OUTSIDE the letters where they bite into the band, mm. This is the number
 *  that decides welded from loose: a short name spanning the window is tall, its corners come
 *  within this of the cut edge, and the fit takes it back until it no longer reaches the rim. */
const WEB = 3;
/** A loose name piece keeps this much air off the frame's inner edge, mm — it is glued on the
 *  backer inside the window, and it has to look deliberate there. */
const WINDOW_MARGIN = 3;
/** The share of the window's width a loose name is drawn at. */
const NAME_FILL = 0.86;
/** Below this the welded letters stop reading as letters. */
const INK_FLOOR = 5;
/** The year's own numbers: its cap as a share of the window, its floor, and the air it keeps off
 *  the window's edge and off the name above it. */
const YEAR_CAP = 0.09;
const MIN_YEAR_CAP = 2.5;
const YEAR_MARGIN = 1.5;
const AIR = 2;
/** How wide the bars that join an i's dot to its stem are (G33's 1.5–3 mm). */
const bridgeFor = (size: number) => Math.min(3, Math.max(1.5, 0.12 * size));
/** How far inside the piece it traces a glue guide is drawn, mm — and never more than a fiftieth
 *  of the letter height, because the guide is drawn by offsetting the glyphs INWARD: 0.3 mm eats a
 *  whole stroke on a name squeezed into a 9 mm window, the layer comes back empty, and the engine
 *  says the guide "lies outside the part". */
const guideInset = (size: number) => Math.min(0.3, 0.02 * size);

// ------------------------------------------------------------------------------ the shapes --

/** A capsule reaching from `a` to `b`, `w` wide: a rounded rectangle of that exact length, so the
 *  tip of a whisker IS the point asked for and the ornament is the width asked for. */
function capsule(a: Pt, b: Pt, w: number): CutRing {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const ring = roundedRectRing(Math.max(len, w), w, w / 2, 10);
  return placeShapes([[ring]], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, deg)[0]![0]!;
}

/**
 * The frame's band between two heights, on one side: the material a letter that bites into the
 * rim disappears behind.
 *
 * The seam layer is handed this rather than the whole ring because the engine sizes "what counts
 * as a dot" off the BIGGEST island it is given (`seamPaths`, `build.ts`): hand it the frame and
 * every letter of a five-letter name measures as a crumb beside it and nothing is scored at all.
 */
function bandPatch(R: number, Rw: number, y0: number, y1: number, side: 1 | -1): CutRing {
  const lo = clamp(Math.min(y0, y1), -Rw + 0.5, Rw - 0.5);
  const hi = clamp(Math.max(y0, y1), -Rw + 0.5, Rw - 0.5);
  const at = (r: number, y: number): Pt => [side * Math.sqrt(Math.max(0, r * r - y * y)), y];
  const n = 24;
  const ring: CutRing = [];
  for (let i = 0; i <= n; i++) ring.push(at(R, lo + ((hi - lo) * i) / n));
  for (let i = n; i >= 0; i--) ring.push(at(Rw, lo + ((hi - lo) * i) / n));
  return ring;
}

/** Six whiskers, three a side: rooted `SINK` inside the head's circle and reaching to a circle
 *  `reach` outside it, so the middle pair — the ones that point straight out — set the span. */
function whiskerRings(R: number, reach: number): CutRing[] {
  const w = whiskerWidth(R);
  const rings: CutRing[] = [];
  for (const side of [1, -1]) {
    for (const { root, dir } of WHISKERS) {
      const a = (side * root * Math.PI) / 180;
      const d = (side * dir * Math.PI) / 180;
      const from: Pt = [side * (R - SINK) * Math.cos(a), (R - SINK) * Math.sin(a)];
      const to: Pt = [side * (R + reach) * Math.cos(d), (R + reach) * Math.sin(d)];
      rings.push(capsule(from, to, w));
    }
  }
  return rings;
}

/** The furthest any ink point lies from the head's centre, mm — measured on the outlines rather
 *  than on the block's corners, because at the extreme x of a word there is a stem, not a corner. */
function inkRadius(shapes: Shapes): number {
  let r = 0;
  for (const island of shapes) for (const ring of island) for (const [x, y] of ring) r = Math.max(r, Math.hypot(x, y));
  return r;
}

/** Whether the point is inside the frame's band: in the head and out of the window. */
const inBand = (p: Pt, head: CutRing, window: CutRing) => pointInRing(p, head) && !pointInRing(p, window);

/** Whether the word bites into the frame's band — which is what decides a name welded into the
 *  frame from one cut as its own piece and glued in the window. */
const reachesRim = (word: Shapes, head: CutRing, window: CutRing) =>
  word.some((island) => (island[0] ?? []).some((p) => inBand(p, head, window)));

// -------------------------------------------------------------------------------- the name --

interface Base {
  symbols: ReturnType<typeof readSymbols>;
  font: string;
  letterSpacing: number;
}

/**
 * The word welded per G33 and centred on the window's own centre, as ONE layer whose shapes are
 * the glyph islands in reading order.
 *
 * `connectSpec(font, size, 0)` — no thicken. The hairline of bold is the ENGINE's, applied to a
 * layer's outlines, and the welded name is not a layer here: it is material in the frame's blank,
 * where nothing grows it. A hairline on the loose piece and none on the welded one would be two
 * different names at the same setting, so both are drawn exactly as the face cuts them; the faces
 * this design recommends are fat ones whose thinnest stroke at this size is over 2 mm, and the
 * thicken is what a script needs, which is not what this design sets.
 */
async function word(base: Base, text: string, size: number): Promise<DesignLayer | null> {
  const [l] = await textLayer({ ...base, text, size, connect: connectSpec(base.font, size, 0), x: 0, y: 0 }, 'off', 'name', 'Name');
  return l ?? null;
}

const halfWidth = (b: Box) => (b.maxX - b.minX) / 2;

/**
 * The name as big as the frame allows: wide enough to bite `BITE` past the window's edge at both
 * ends, then taken back until no ink comes within `WEB` of the cut edge.
 *
 * The second loop is what decides welded from loose, and it decides it by geometry. A long name
 * is wide and short, so it spans the window with its ink near the equator and nothing near the
 * edge; a three-letter name spanning the same width is half as tall as the head, its stems reach
 * for the corner of the window, and the shrink takes it back inside the rim — where it no longer
 * reaches, and is cut as its own piece instead.
 */
async function fitWelded(base: Base, text: string, R: number, Rw: number, floor: number): Promise<{ layer: DesignLayer; size: number } | null> {
  let size = Math.max(4, 0.6 * Rw);
  let l = await word(base, text, size);
  if (!l) return null;
  for (let pass = 0; pass < 3; pass++) {
    const k = (Rw + BITE) / Math.max(1e-6, halfWidth(bboxOf(l.shapes)));
    if (Math.abs(k - 1) < 0.005) break;
    size = Math.max(2, size * k);
    const next = await word(base, text, size);
    if (!next) break;
    l = next;
  }
  for (let pass = 0; pass < 3; pass++) {
    const low = bboxOf(l.shapes).minY;
    // Two caps, and the tighter wins — never a grow, because the span pass above has already
    // set the size. Both shrink about the window's own centre, so the name stays centred
    // whichever binds. The radial one aims a tenth of a millimetre inside `WEB`, so that the
    // loop's own half-percent stopping band cannot land the ink a hair PAST the number this
    // design promises.
    const k = Math.min(1, (R - WEB - 0.1) / inkRadius(l.shapes), low < -1e-6 ? floor / low : 1);
    if (k > 0.995) break;
    size = Math.max(2, size * k);
    const next = await word(base, text, size);
    if (!next) break;
    l = next;
  }
  return { layer: l, size };
}

/** The same word sized to sit INSIDE the window with air all round: `NAME_FILL` of its width, or
 *  its own circle less `WINDOW_MARGIN`, whichever is smaller. What a name that cannot reach the
 *  rim is cut as, and what an engraved name is burnt at. */
async function fitInside(base: Base, text: string, Rw: number, floor: number): Promise<{ layer: DesignLayer; size: number } | null> {
  let size = Math.max(4, 0.5 * Rw);
  let l = await word(base, text, size);
  if (!l) return null;
  for (let pass = 0; pass < 3; pass++) {
    const b = bboxOf(l.shapes);
    const w = Math.max(1e-6, b.maxX - b.minX);
    const h = Math.max(1e-6, b.maxY - b.minY);
    // Each term is the LARGEST scale that term allows, so the smallest of them is the fit — and
    // a term that is not binding says so with a number above 1 rather than pinning the name at
    // whatever size the first guess happened to draw it.
    const k = Math.min(
      (NAME_FILL * 2 * Rw) / w,
      Math.max(1, Rw - WINDOW_MARGIN) / Math.hypot(w / 2, h / 2),
      b.minY < -1e-6 ? floor / b.minY : Infinity,
    );
    if (Math.abs(k - 1) < 0.005) break;
    size = Math.max(2, size * k);
    const next = await word(base, text, size);
    if (!next) break;
    l = next;
  }
  return { layer: l, size };
}

// ---------------------------------------------------------------------------- the template --

export const themedFaceOrnament: TemplateDef = {
  // The id is what a saved project and a deep link are keyed on, and it is the only key they
  // carry — so it stays, and the NAME is what changed. Renaming the file's export or its id would
  // buy a tidier word in a URL at the price of every saved ornament and one more edit to the
  // registry, which five other builders are in tonight.
  id: 'themed-face-ornament',
  name: 'Cat ornament',
  blurb: 'A cat’s face in a light frame, with the name welded into it and the year on the back.',
  tags: ['ornament', 'engrave + score + cut'],
  fields: [
    // ---------------------------------------------------------- RIGHT: what you type --
    {
      kind: 'text', key: 'name', label: 'Name', panel: 'right', section: 'Text',
      value: 'Missy', placeholder: 'A pet’s name', maxLength: 16, symbols: true,
    },
    {
      kind: 'text', key: 'year', label: 'Year', panel: 'right', section: 'Text',
      value: '2026', placeholder: 'Optional', maxLength: 8,
      help: 'Engraved low on the dark head.',
    },
    // The font field always lands on the left as its own category, whatever `panel` says.
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'fredoka', recommended: BUBBLY },

    // -------------------------------------------------- LEFT: "Ornament" (opens first) --
    // One knob, and it is the product's: how big the cat is. The frame, the window, the name and
    // the year all follow from it.
    {
      kind: 'number', key: 'size', label: 'Size', section: 'Ornament',
      value: 90, min: 60, max: 140, step: 1, unit: 'mm',
      help: 'Across the whiskers, tip to tip.',
    },

    {
      kind: 'number', key: 'rimWidth', label: 'Frame width', section: 'Ornament',
      value: +rimWidthFor(90).toFixed(1), min: 5, max: 14, step: 0.5, unit: 'mm',
      help: 'How wide the rim round the head is.',
    },

    // --------------------------------------------------------------- LEFT: "Lettering" --
    ...lightPieceFields('Lettering', 'raised', {
      help: 'Raised welds the name into the frame; Engrave burns it on.',
    }),
    letterScoreField('Lettering'),
    ...letteringFields('Lettering'),

    // ----------------------------------------------------------------- LEFT: "Hanging" --
    // The design's own hole, not the shared Ring control: a cat hangs from the
    // boss between its ears, so there is nothing to choose and nothing to drag.
    ...hangHoleFields('Hanging', { dia: 3, maxDia: 6, label: 'Hanging hole' }),
  ],

  async build(v) {
    const def = blankById('cat')!;
    const warnings: string[] = [];
    // Size is the span across the whisker TIPS, which is what a customer measures: the whiskers
    // reach `REACH` of the head's radius past it, so `size = 2R(1 + REACH)`.
    const width = clamp(num(v, 'size'), 40, 300);
    const R = width / (2 * (1 + REACH));
    const p: BlankParams = {
      ...def.defaults,
      // The cat's own ring is a circle of radius `width / 2`, so the head is exactly this wide
      // and the ears — at ±35° from the crown — never reach past it.
      width: 2 * R,
      height: (2 * R * def.defaults.height) / def.defaults.width,
      holeSide: 'none',
      pair: false,
    };
    const head = buildBlank(def, p);
    const headRing = head[0]![0]!;
    const ears = head.slice(1);
    const whiskers = whiskerRings(R, REACH * R).map((r): CutRing[] => [r]);

    // The band, and the window it leaves. A circle's inset is a concentric circle, so this is the
    // true offset and the rim is `band` wide the whole way round the head.
    const band = clamp(num(v, 'rimWidth'), 2, 0.6 * R);
    const Rw = Math.max(4, R - band);
    const windowRing = circleRing(0, 0, Rw, 128);

    // The hanging boss: a disc centred ON the crown, so the hole in its middle keeps `WALL` of
    // material every way round — boss above, head below — and the loop grows with the ribbon
    // instead of the hole sliding down the skull to find its own border.
    const dia = clamp(num(v, 'holeDia'), 2, 8);
    const hangs = v.hangHole !== false;
    const boss: Shapes = hangs ? [[circleRing(0, R, dia / 2 + WALL + SLACK, 48)]] : [];
    const keyring: KeyringSpec = hangs
      ? { ...NO_KEYRING, enabled: true, mode: 'inside', dia, ring: WALL, rest: [0, R] }
      : NO_KEYRING;

    // ------------------------------------------------------------------------- the name --
    const base: Base = {
      symbols: readSymbols(v),
      font: str(v, 'font'),
      // G7: a percentage of the letter height. The WELD is `connectSpec`'s overlap, never
      // negative tracking (G33) — this knob is the customer's, on top of it.
      letterSpacing: num(v, 'letterSpacing') / 100,
    };
    const text = applyCase(str(v, 'name'), str(v, 'textCase')).trim();
    const raised = str(v, 'lightOp') !== 'engrave';
    // The year's band is the design's and it is reserved BEFORE the name is fitted: a name allowed
    // to fill the window first leaves a one-letter ornament with nowhere to put a year, and the
    // year is half of what this thing is for.
    const yearText = str(v, 'year').trim();
    const cap = yearText ? clamp(YEAR_CAP * 2 * Rw, MIN_YEAR_CAP, 7) : 0;
    const floor = yearText ? -Rw + YEAR_MARGIN + cap + AIR : -(R - WEB);

    let fit: { layer: DesignLayer; size: number } | null = null;
    let welded = false;
    if (text && raised) {
      fit = await fitWelded(base, text, R, Rw, floor);
      if (fit) {
        welded = reachesRim(fit.layer.shapes, headRing, windowRing);
        // Too short to reach the rim: its own piece, sized to sit in the window with air round it.
        if (!welded) fit = await fitInside(base, text, Rw, floor);
      }
    } else if (text) {
      fit = await fitInside(base, text, Rw, floor);
    }
    const nameBox = fit ? bboxOf(fit.layer.shapes) : null;
    if (fit && nameBox && nameBox.maxY - nameBox.minY < INK_FLOOR) {
      warnings.push('That name is long for this ornament — the letters are getting thin. Try a shorter name, or a bigger one.');
    }
    if (fit) warnings.push(...countersTooTight(fit.layer.shapes));

    // ------------------------------------------------------------------------- the year --
    // Low in the window, where it shows through under the name.
    const yearLayers: DesignLayer[] = [];
    if (yearText) {
      const yc = -Rw + YEAR_MARGIN + cap / 2;
      const em = await sizeForCapHeight(base.font, cap);
      const first = await textLayer({ ...base, text: yearText, size: em, x: 0, y: yc }, 'engrave', 'year', 'Year');
      // The window is a circle, so the room the year has is its chord at the year's own lowest
      // point, not the window's full width.
      const chord = 2 * Math.sqrt(Math.max(0, Rw * Rw - (Math.abs(yc) + cap / 2) ** 2)) - 2 * YEAR_MARGIN;
      const yb = bboxOf(first.flatMap((l) => l.shapes));
      const k = Math.min(1, Math.max(0.2, chord) / Math.max(1e-6, yb.maxX - yb.minX));
      yearLayers.push(...(k > 0.999 ? first : await textLayer({ ...base, text: yearText, size: em * k, x: 0, y: yc }, 'engrave', 'year', 'Year')));
      if (cap * k < MIN_YEAR_CAP) warnings.push('That year is long for this ornament — it has shrunk under 2.5 mm. Try fewer characters.');
    }

    // ----------------------------------------------------------------------- the pieces --
    const solid: Shapes = [[headRing], ...ears, ...whiskers, ...boss];
    const letters = fit ? fit.layer.shapes : [];
    const seamsOn = str(v, 'letterLines') === 'score' && letters.length > 1;
    // The seams are a second copy of the same islands in reading order, with the frame's own band
    // LAST: what is scored is each letter's edge where a later letter — or the rim it welds into —
    // covers it: blue arcs at the M and at the y (G33).
    const rim: Shapes = welded && nameBox
      ? [[bandPatch(R, Rw, nameBox.minY, nameBox.maxY, -1)], [bandPatch(R, Rw, nameBox.minY, nameBox.maxY, 1)]]
      : [];
    const seamLayer = (extra: Shapes): DesignLayer[] =>
      seamsOn && fit
        // The per-glyph tally (W3, 2026-09-22) has to grow with the islands appended after the
        // letters, or the engine sees a tally out of step and falls back to one island = one glyph
        // — scoring a stroke-built letter against its own strokes. Each rim patch is its own "glyph".
        ? [{ ...fit.layer, id: 'name-seam', label: 'Letter seams', op: 'score' as const, seams: true, shapes: [...letters, ...extra], glyphIslands: [...(fit.layer.glyphIslands ?? letters.map(() => 1)), ...extra.map(() => 1)] }]
        : [];

    const backerLayers: DesignLayer[] = [...yearLayers];
    if (fit && !raised) backerLayers.push({ ...fit.layer, op: 'engrave' });
    else if (fit && !welded && str(v, 'glue') !== 'none') {
      // The guide traces the glyphs a hair inside the edge the piece is really cut on, so the line
      // it is glued over never shows. `kind: 'guide'` keeps it out of the engine's "the hole sits
      // on the lettering" net — it is a registration mark, not a word.
      backerLayers.push(...letters.map((island, i) => ({
        id: `glue-${i}`, label: 'Glue guide', op: 'score' as const, kind: 'guide' as const,
        shapes: [island], grow: -guideInset(fit.size),
      })));
    }

    const parts: PartInput[] = [{
      id: 'backer',
      label: 'Head · dark sheet',
      blank: { kind: 'shape', shapes: solid, oneIsland: true },
      layers: backerLayers,
      // The same silhouette about the same origin, the SAME hole at the same local point, and
      // `'built'` puts its box centre back exactly where it was built — so the glue-up is the
      // build frame again and the two sheets register.
      keyring: 'shared',
      assembledAt: 'built',
      material: 'dark',
    }];
    if (fit && raised && !welded) {
      parts.push({
        id: 'name',
        label: 'Name · light sheet',
        // G33: the piece IS the letters. Margin 0, no smoothing pass, counters open so the dark
        // head shows through the bowl of an "o".
        blank: { kind: 'hug', margin: 0, smoothing: 0, counters: 'open', bridge: bridgeFor(fit.size), minHole: MIN_COUNTER },
        layers: [
          { ...fit.layer, op: 'off' as const, hugOnly: true },
          ...seamLayer([]),
        ],
        // Never: the top layer carries no loop and no hole.
        keyring: 'none',
        // Dead centre of the window — the point the fit centred the block on.
        assembledAt: { x: 0, y: 0 },
        material: 'light',
      });
    }

    // The frame's own material, as the hug blank reads it. A `hug` at `margin: 0, smoothing: 0` is
    // the plain union of what it is given (G31) — the same piece a `shape` blank would build — and
    // it brings the two things this piece needs that a shape blank has not got: `minHole`, which
    // fills the slivers a letter leaves where it crosses the window's edge at a shallow angle
    // (the same nick, one class down), and the automatic bar that joins an i's tittle to its
    // stem, which would otherwise float in the window and fall out of the bed.
    const frameMaterial: DesignLayer[] = [
      { id: 'frame', label: 'Frame', op: 'off', hugOnly: true, shapes: [[headRing, windowRing.slice().reverse()], ...ears, ...whiskers, ...boss] },
      ...(welded ? [{ id: 'frame-name', label: 'Name', kind: 'text' as const, op: 'off' as const, hugOnly: true, shapes: letters }] : []),
    ];

    return {
      label: 'Frame · light sheet',
      material: 'light',
      blank: { kind: 'hug', margin: 0, smoothing: 0, counters: 'open', minHole: 1.2, bridge: bridgeFor(fit?.size ?? 10) },
      keyring,
      layers: [...frameMaterial, ...(welded ? seamLayer(rim) : [])],
      parts,
      layout: { flow: 'row', gap: 6 },
      status: `${parts.length + 1} pieces · dark head, light frame${welded ? ' with the name' : parts.length > 1 ? ' and name' : ''}`,
      ...(warnings.length ? { warnings } : {}),
    };
  },

  // A function, not a string (G27): what there is to glue depends on how the name came out.
  exportNote: (v) =>
    str(v, 'lightOp') === 'engrave'
      ? 'Cut the head from dark wood and the frame from light, then glue them together.'
      : 'Cut the head from dark wood and the frame from light, then glue the frame on — and the name in the window if it came out as its own piece.',

  fileName: (v) => stem(str(v, 'name') || 'cat', str(v, 'year'), 'ornament'),
};

import { readSymbols } from '../symbols/model';
// The Christmas ornament: a bauble FRAME, a dark backer behind it, and the name cut as one
// welded piece that fills the window. The year burns on the cap and one ribbon hole goes
// through both sheets.
//
// Rebuilt 2026-09-21. What it was this morning and why it is not that
// any more:
//
// · The name was welded into the FRAME — one hug of ring + letters — so it had to span the whole
//   window to reach the rim on both sides. Fitted by its bounding BOX against a circle, "Holly"
//   came out left of centre, filling about half the ball, with the y's tail crossing the rim,
//   and the same improper scoring of the name as the name keychain had. The name is its own
//   LIGHT PIECE now, glued in the window over a
//   scored guide — text need not be a single body on a layered product —
//   which is what lets it be centred and sized to the window instead of stretched to reach wood.
// · The weld was faked with negative tracking (`WELD_TRACK = -0.085`) and closed by a hug margin.
//   G33 forbids both: the overlap is `connectSpec`'s, measured as penetration, and the piece is
//   the letters at `margin: 0`.
// · The ribbon hole came off the shared Ring control. It is the design's own now: fixed in
//   the bauble's own loop, no Ring select, no drag.
//
// The pieces (all three the same silhouette's business, one origin):
//   FRAME   the bauble with the ball's face taken out — a ring of `rimWidthFor` wide round the
//           window, the cap solid above it with the year on it, and the loop with the ribbon
//           hole. Built as an explicit ring rather than `blank: { kind: 'rim' }`: a true inset
//           of this silhouette erodes the loop (radius 3.7 mm) away entirely and leaves the cap
//           as a ring round a sliver, so the bauble's hardware has to be drawn, not offset.
//   BACKER  the same outline, plain, from the dark sheet, `keyring: 'shared'` so the ribbon hole
//           is punched at the same local point, and `assembledAt: 'built'` so the stack is the
//           build frame again. It carries the glue guide, or the name engraved.
//   NAME    the welded word (G33), `margin: 0`, counters open — only when Name pieces is Raised.
import { bboxOf, blankById, buildBlank, circleRing, type BlankParams, type Box, type Pt, type Shapes } from '@vostok/laser';
import { rimWidthFor } from '../engine/frame';
import { sizeForCapHeight } from '../engine/metrics';
import { MIN_COUNTER, applyCase, textLayer } from '../engine/text';
import type { DesignLayer, KeyringSpec, PartInput } from '../engine/types';
import { NO_KEYRING, hangHoleFields } from './keyring';
import { connectSpec, countersTooTight, letterScoreField, letteringFields, lightPieceFields, stem } from './shared';
import { num, str, type TemplateDef } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The faces this design is for, in order (G2). The name is cut as ONE welded piece, so the
 * question is not what a face looks like but what is left of it after the weld: a bubbly rounded
 * face has fat strokes and wide bowls that survive it, a high-contrast serif (Playfair Display,
 * which this template shipped as its default) loses its hairlines the moment the letters are
 * overlapped. Every one of these was built as the card's own name at 3, 5 and 10 letters,
 * rasterised and looked at; each cuts as ONE island with its counters open.
 *
 * None of them connects on its own, and that is the design rather than a compromise — this is
 * G33's block case, where the letters overlap a little and the seams are scored. So the shared
 * `connectWarning` is NOT raised here: "pick a script that connects" is advice for a template
 * whose product is a flowing line, and would fire on every build of this one.
 */
const BUBBLY = ['fredoka', 'baloo-2', 'luckiest-guy', 'chewy', 'nunito', 'comfortaa', 'sniglet'];
// Titan One was on this shelf and is not any more. It passes the weld — one island at every
// length — but its counters are the tightest of the eight: at a ten-letter name on the card's own
// 80 mm ball the letters are 10.8 mm tall and the bowl of its "e" closes under a millimetre, so
// `countersTooTight` fires on a face the design itself recommended. A shelf is a promise that the
// faces on it work at the sizes this product reaches (G2), so it comes off rather than being
// shipped with a warning attached.

/** The share of the window's WIDTH the name is drawn at, when the window's circle lets it: the
 *  proportion that reads well for a name inside a ring. */
const NAME_FILL = 0.8;
/** Air between the name and the frame's inner edge, mm — the second half of the same rule: the
 *  letters are as tall as the window allows once this is kept all round. */
const WINDOW_MARGIN = 3;
/** Material left round the ribbon hole, mm. The bauble's loop is built from it, so the loop is
 *  `dia/2 + WALL` in radius and the hole is exactly centred in it. 2 mm is the floor for a light
 *  decorative hanger; this is that with a margin. */
const WALL = 2.5;
/** Below this the welded letters stop reading as letters at all. */
const INK_SEVERE = 3;
/** Below this they read, but only just — the ornament wants a shorter name or a bigger ball. */
const INK_FLOOR = 6;
/** The smallest capital the year may be engraved at. */
const MIN_YEAR_CAP = 2.5;
/** Air between the year and the cap's own edges, mm. */
const YEAR_MARGIN = 1.2;
/** How wide the automatic bridges are — the bar under an i's dot. G33's 1.5–3 mm. */
const bridgeFor = (size: number) => Math.min(3, Math.max(1.5, 0.12 * size));
/** How far the glue guide is drawn inside the piece it traces, mm. */
const GUIDE_INSET = 0.3;

/** How wide the outline is at height `y` — the span between the outermost crossings of a
 *  horizontal ray. The cap tapers, so the year's room is not the bauble's width. */
function spanAt(ring: readonly Pt[], y: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (a[1] > y === b[1] > y) continue;
    const x = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return hi > lo ? hi - lo : 0;
}

/**
 * How much to scale a drawn word by so it fills a circular window of radius `windowR`.
 *
 * Two numbers, the smaller wins, and both are one division rather than a search:
 *   · `NAME_FILL` of the window's width;
 *   · the window's own circle with `WINDOW_MARGIN` of air, which is the block's half-DIAGONAL
 *     against `windowR - WINDOW_MARGIN`, because the corners of a word are not on the midline.
 * A short name is held by the circle (it grows until its corners touch) and a long one by the
 * width, which is exactly the way round it should be: three letters fill the ball, ten sit in a
 * band across it.
 *
 * `grow` is the layer's own thicken — the engine adds it to every outline after this runs, so it
 * is part of the block being fitted.
 */
function fillScale(box: Box, grow: number, windowR: number): number {
  const w = Math.max(1e-6, box.maxX - box.minX + 2 * grow);
  const h = Math.max(1e-6, box.maxY - box.minY + 2 * grow);
  const room = Math.max(1, windowR - WINDOW_MARGIN);
  return Math.min((NAME_FILL * 2 * windowR) / w, room / Math.hypot(w / 2, h / 2));
}

/** The name drawn at the size that fills the window, welded per G33 and centred on `at`. */
async function fitName(
  base: { symbols: ReturnType<typeof readSymbols>; font: string; letterSpacing: number },
  text: string,
  windowR: number,
  at: Pt,
): Promise<{ layers: DesignLayer[]; size: number; box: Box } | null> {
  if (!text.trim()) return null;
  // A first guess in the right order of magnitude; three passes land inside half a percent,
  // which is a hundredth of a millimetre at this scale. Each pass re-draws rather than scaling
  // the outlines, because the overlap the weld walks is a share of the SIZE.
  let size = Math.max(3, windowR);
  let drawn: DesignLayer[] = [];
  for (let pass = 0; pass < 3; pass++) {
    drawn = await textLayer(
      { ...base, text, size, connect: connectSpec(base.font, size), x: at[0], y: at[1] },
      'off',
      'name',
      'Name',
    );
    if (!drawn.length) return null;
    const k = fillScale(bboxOf(drawn[0]!.shapes), drawn[0]!.grow ?? 0, windowR);
    if (Math.abs(k - 1) < 0.005) break;
    size = Math.max(2, size * k);
  }
  const grow = drawn[0]!.grow ?? 0;
  const ink = bboxOf(drawn[0]!.shapes);
  // The piece's own box: the ink grown by the thicken the engine is about to apply. `textLayer`
  // centres the block on `at` before the grow, and a uniform grow keeps that centre — so this
  // box is centred on `at` to the last decimal, which is what registers the name in the window.
  return {
    layers: drawn,
    size,
    box: { minX: ink.minX - grow, minY: ink.minY - grow, maxX: ink.maxX + grow, maxY: ink.maxY + grow },
  };
}

export const christmasOrnament: TemplateDef = {
  id: 'christmas-ornament',
  name: 'Christmas ornament',
  blurb: 'A name welded to fill a bauble frame, the year on its cap, on a dark backer.',
  tags: ['ornament', 'engrave + score + cut'],
  batch: { key: 'text', noun: 'ornament' },
  fields: [
    // ---------------------------------------------------------- RIGHT: what you type --
    {
      kind: 'text', key: 'text', label: 'Name', panel: 'right', section: 'Text',
      value: 'Holly', placeholder: 'A name', maxLength: 14, symbols: true,
    },
    {
      kind: 'text', key: 'line2', label: 'Year', panel: 'right', section: 'Text',
      value: '2026', placeholder: 'Optional', maxLength: 8,
      help: 'Engraved on the bauble’s cap.',
    },
    // The font field always lands on the left as its own category, whatever `panel` says.
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'fredoka', recommended: BUBBLY },

    // -------------------------------------------------- LEFT: "Ornament" (opens first) --
    // One knob, and it is the product's: how big the bauble is. The rim, the window and the
    // name's size all follow from it, so there is nothing else to set here.
    {
      kind: 'number', key: 'size', label: 'Size', section: 'Ornament',
      value: 80, min: 50, max: 160, step: 1, unit: 'mm',
      help: '70–90 mm is the classic hanging-ornament range.',
    },

    // ---------------------------------------------------------------- LEFT: "Lettering" --
    letterScoreField('Lettering'),
    ...lightPieceFields('Lettering', 'raised', { help: 'Raised cuts the name as a piece to glue on.' }),
    ...letteringFields('Lettering'),

    // ------------------------------------------------------------------ LEFT: "Hanging" --
    // The design's own hole, not the shared Ring control: a bauble hangs from the loop it draws,
    // so there is nothing to drag — only whether it is cut, and how big. The rail reads
    // Ornament · Font · Lettering · Hanging, the order the other ornaments use.
    ...hangHoleFields('Hanging', { dia: 3, maxDia: 6, label: 'Ribbon hole' }),
  ],

  async build(v) {
    const def = blankById('bauble')!;
    const width = num(v, 'size');
    const dia = clamp(num(v, 'holeDia'), 2, 8);
    const hangs = v.hangHole !== false;
    const p: BlankParams = {
      ...def.defaults,
      width,
      // The bauble sizes its ball off whichever of width and height binds; a height this
      // generous never binds, so Size means the ball's own width and nothing else.
      height: 3 * width,
      // The ribbon hole is threaded into the SHAPE: the loop's radius is `dia/2 + WALL`, so the
      // cap grows to hold a bigger ribbon instead of the hole sliding down onto the ball's
      // shoulder to find its own border (review finding 3).
      holeDia: dia,
      holeMargin: WALL,
      holeSide: 'none',
      pair: false,
    };
    const outline = buildBlank(def, p);
    const rim = outline[0]?.[0] ?? [];
    const b = bboxOf(outline);
    // Measured, never copied: the ball spans the outline's full width and sits on its floor, and
    // the loop's own radius is how far the hole point is from the top of the piece.
    const R = (b.maxX - b.minX) / 2;
    const cy = b.minY + R;
    const loop = (def.holeAt?.(p) ?? [0, b.maxY]) as Pt;
    const loopR = Math.max(1, b.maxY - loop[1]);
    // The frame's own width, from the shared rule (`rimWidthFor`: 7 % of the diameter, 5–14 mm)
    // — the same proportion every framed ornament in the set uses.
    const band = Math.min(rimWidthFor(2 * R), 0.35 * R);
    const windowR = Math.max(4, R - band);

    // The hole is the design's: fixed in the loop, with `WALL` of material round it — the same
    // number the loop was built from, so it is exactly centred and `holdInside` leaves it there.
    const keyring: KeyringSpec = hangs
      ? { ...NO_KEYRING, enabled: true, mode: 'inside', dia, ring: WALL, rest: [loop[0], loop[1]] }
      : NO_KEYRING;

    const warnings: string[] = [];
    const base = {
      symbols: readSymbols(v),
      font: str(v, 'font'),
      // G7: a percentage of the letter height. The WELD is `connectSpec`'s overlap, never
      // negative tracking (G33) — this knob is the customer's, on top of it.
      letterSpacing: num(v, 'letterSpacing') / 100,
    };
    const raised = str(v, 'lightOp') !== 'engrave';

    // ------------------------------------------------------ the name, filling the window --
    const name = await fitName(base, applyCase(str(v, 'text'), str(v, 'textCase')), windowR, [0, cy]);
    const ink = name ? name.box.maxY - name.box.minY : 0;
    if (name && ink < INK_SEVERE) warnings.push('That name is far too long for this ball — try a shorter one, or a much bigger ornament.');
    else if (name && ink < INK_FLOOR) warnings.push('That name is long for this size — the letters are getting thin. Try a shorter name, or a bigger ornament.');
    if (name) warnings.push(...countersTooTight(name.layers.flatMap((l) => l.shapes)));

    // ------------------------------------------------------------------ the year, on the cap --
    // The cap is everything between the ball's crown and the loop's own bottom.
    const capLo = cy + R;
    const capHi = loop[1] - loopR;
    const yearText = str(v, 'line2').trim();
    const frameLayers: DesignLayer[] = [];
    if (yearText && capHi - capLo <= 2 * YEAR_MARGIN + MIN_YEAR_CAP) {
      // The cap does not grow with the ball as fast as the ball does, and a big ribbon hole eats
      // it from the other end: below about 60 mm, or with the loop opened right up, there is
      // genuinely nowhere to put a year. Saying so beats dropping it silently.
      warnings.push('There is no room on the cap for a year at this size — make the ornament bigger, or use a smaller ribbon hole.');
    } else if (yearText) {
      const yearY = (capLo + capHi) / 2;
      const cap = clamp(capHi - capLo - 2 * YEAR_MARGIN, MIN_YEAR_CAP, 6);
      const size = await sizeForCapHeight(base.font, cap);
      // The year is set at the face's own tracking, never the Lettering section's. That knob is
      // the NAME's — it is how far the customer pulls a welded word apart — and spending it on a
      // 4 mm caption engraved across a tapering cap only shrinks the caption: at +30 % "2026" ran
      // off the cap and came back under the 3 mm engraving floor with a warning attached, at both
      // ends of a slider that was never about the year (G25). `textCase` is already the name's
      // alone for the same reason.
      const yearBase = { ...base, letterSpacing: 0 };
      const first = await textLayer({ ...yearBase, text: yearText, size, x: 0, y: yearY }, 'engrave', 'year', 'Year');
      // The cap tapers, so the room is what the outline is wide at the year's OWN height, not
      // what the bauble is wide.
      const room = Math.max(1, spanAt(rim, yearY) - 2 * YEAR_MARGIN);
      const yb = bboxOf(first.flatMap((l) => l.shapes));
      const k = Math.min(1, room / Math.max(1e-6, yb.maxX - yb.minX));
      const year = k > 0.999 ? first : await textLayer({ ...yearBase, text: yearText, size: size * k, x: 0, y: yearY }, 'engrave', 'year', 'Year');
      // A long year shrinks rather than running off the cap — and says so once it has shrunk
      // past what a laser burns legibly.
      if (cap * k < INK_SEVERE) warnings.push('That year is long for the cap — it has shrunk under 3 mm. Try fewer characters.');
      frameLayers.push(...year);
    }
    // ------------------------------------------------------------------------- the pieces --
    // The name is MATERIAL on its own piece and never lasered (G33), and the seams are a second
    // copy of the same islands in reading order — only where the face had to be welded, because
    // a connecting script's joins were drawn by the type designer.
    const overlap = name ? connectSpec(base.font, name.size).overlap ?? 0 : 0;
    const letters: DesignLayer[] = name ? name.layers.map((l) => ({ ...l, op: 'off' as const, hugOnly: true })) : [];
    const seams: DesignLayer[] = name && raised && str(v, 'letterLines') === 'score' && overlap > 0
      ? name.layers.map((l) => ({ ...l, id: `${l.id}-seam`, label: 'Letter seams', op: 'score' as const, seams: true }))
      : [];

    const backerLayers: DesignLayer[] = [];
    if (name && raised && str(v, 'glue') !== 'none') {
      // The guide traces the glyphs a hair inside the edge the piece is really cut on, so the
      // line it is glued over never shows. `kind: 'guide'` keeps it out of the engine's "the
      // hole sits on the lettering" net — it is a registration mark, not a word.
      backerLayers.push(...name.layers.map((l) => ({
        ...l, id: `${l.id}-guide`, label: 'Glue guide', op: 'score' as const, kind: 'guide' as const,
        grow: (l.grow ?? 0) - GUIDE_INSET,
      })));
    } else if (name && !raised) {
      backerLayers.push(...name.layers.map((l) => ({ ...l, op: 'engrave' as const })));
    }

    const parts: PartInput[] = [{
      id: 'backer',
      label: 'Backer · dark sheet',
      blank: { kind: 'shape', shapes: outline },
      layers: backerLayers,
      // The same silhouette about the same origin, the SAME ribbon hole at the same local point,
      // and `'built'` puts its box centre back exactly where it was built — so the glue-up is the
      // build frame again and the two pieces register.
      keyring: 'shared',
      assembledAt: 'built',
      material: 'dark',
    }];
    if (name && raised) {
      parts.push({
        id: 'name',
        label: 'Name · light sheet',
        // G33: the piece IS the letters. Margin 0, no smoothing pass, counters open so the dark
        // backer shows through the bowl of an "o"; `minHole` is the counter the weld may keep.
        blank: { kind: 'hug', margin: 0, smoothing: 0, counters: 'open', bridge: bridgeFor(name.size), minHole: MIN_COUNTER },
        layers: [...letters, ...seams],
        // Never: the top layer carries no loop and no hole.
        keyring: 'none',
        // Dead centre of the window — the point `fitName` centred the block on.
        assembledAt: { x: 0, y: cy },
        material: 'light',
      });
    }

    return {
      label: 'Frame · light sheet',
      material: 'light',
      // An explicit ring, not `kind: 'rim'`: a true inset of this silhouette erodes the loop
      // away and hollows the cap. The ball's face is taken out and the cap stays solid.
      blank: { kind: 'shape', shapes: [[rim, circleRing(0, cy, windowR, 160).slice().reverse()]] },
      keyring,
      layers: frameLayers,
      parts,
      layout: { flow: 'row', gap: 6 },
      status: `${parts.length + 1} pieces · dark backer, light frame${name && raised ? ' and name' : ''}`,
      ...(warnings.length ? { warnings } : {}),
    };
  },

  // A function, not a string (G27): there is nothing to glue when the name is engraved.
  exportNote: (v) =>
    str(v, 'lightOp') === 'engrave'
      ? 'Cut the backer from dark wood and the frame from light — nothing to glue.'
      : 'Cut the backer from dark wood, the frame and name from light, then glue the name in the window.',

  fileName: (v) => stem(str(v, 'text') || 'ornament', str(v, 'line2')),
};

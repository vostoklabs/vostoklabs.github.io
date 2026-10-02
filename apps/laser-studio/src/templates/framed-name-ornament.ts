import { readSymbols } from '../symbols/model';
// A framed name ornament: a dark disc inside a light rim frame, the family's names engraved
// round the rim, and one name cut from the light sheet and glued in the middle.
//
// How it is built:
//
// · The FRAME is the primary piece — `blank: { kind: 'rim' }`, the silhouette minus itself inset
//   by the rim width, cut in the worker with a true offset. A disc has no natural hanging point,
//   so the loop is the ordinary outside-mode tab resting at top-centre, welded to the ring's own
//   edge — this design grows its loop from the frame rather than punching a hole in it.
// · The BACKER is a `parts[]` entry with `keyring: 'shared'` and `assembledAt: 'built'`: the same
//   disc about the same origin, the same lug and hole at the same local point, and its box centre
//   put back where it was built. The loop is two sheets thick and the stack registers exactly.
// · The NAMES engrave on the FRAME, as two arcs rather than one 340° band: `arcTextLayer` at 90°
//   reading outward, and at 270° reading inward — the only way the bottom half reads the right
//   way up. Each arc is fitted twice, both times measured off the drawn arc rather than off the
//   face's metrics: once so the run fits its 165° of rim, once so its ink sits inside the rim's
//   own width with the baseline moved to put it there.
// · The CENTRE NAME is G33's welded word, sized to the window and centred in it.
// · Dark and light are the customer's own two sheets, named in the part labels — never a colour.
//
// Rebuilt 2026-09-21:
// · The word was fused by a hug `margin` and a `bridge` — the "hug blob" G33 forbids. It is the
//   overlap walk now (`connectSpec`), at `margin: 0`, with the seams scored where a later letter
//   buries an earlier one.
// · "Word style: Script letters | Name band" is gone. One template, one object:
//   the band was a second construction that existed because the old fit shrank a long word past
//   legibility. The window fit below sizes the word to the frame instead, and where that is still
//   too small the design says so rather than swapping the product out underneath the customer.
// · The word sat in a band inset by a SECOND rim width and fitted to 0.85 of that chord — about
//   half the window. It fills the window now: `NAME_FILL` of its width, or as tall as the window
//   allows with `WINDOW_MARGIN` of air, whichever binds first.
// · "Loop through both layers" is gone with it: the layers always register.
//
// 2026-09-26 rework:
// · The rim names were two runs, "MAMA · DAD" bunched at 12 o'clock and "ELLA · JAY" at 6, with
//   the whole of 3 and 9 o'clock left bare. Each name is its own arc now, spaced EVENLY round the
//   full ring (`ringOfNames`) — the top half reading outward, the bottom half inward — so eight
//   names read as a wreath instead of two captions.
// · The centre name was a separate glued piece at 80 % of the window, floating in an empty ring.
//   It is WELDED to the frame by default now (`Centre name: Welded`): grown until it bites the
//   ring's inner edge, so frame and name are one light piece and the word spans the window the
//   edge to edge. Raised (its own piece) and Engrave are still one click away.
import { bboxOf, circleRing, type Box, type Pt, type Shapes } from '@vostok/laser';
import { MIN_COUNTER, applyCase, arcTextLayer, glyphLayers, textLayer, type TextSpec } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import type { DesignLayer, PartInput } from '../engine/types';
import { keyringFrom } from './keyring';
import {
  WELDING_SCRIPTS, connectSpec, countersTooTight, frameFields, isConnectingFont,
  letterScoreField, letteringFields, lightPieceFields, stem,
} from './shared';
import { lines, num, str, type Field, type TemplateDef } from './types';

const more = (f: Field): Field => ({ ...f, advanced: true });
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Loop hole and the wall round it, as shares of the ornament's size — family-crossword's own
 *  numbers, so the two framed ornaments hang from the same tab. At Ø 100: a 4 mm hole in a 14 mm
 *  tab (§5.3 of the laser reference). */
const LOOP_HOLE = 0.04;
const LOOP_WALL = 0.05;

/** The smallest engraved lettering this design draws without saying so — the floor of
 *  the 3–6 mm band. */
const CAP_FLOOR = 3;
/** The share of each name's slot of the ring its lettering may fill; the rest is air between it
 *  and the next name. */
const SLOT_FILL = 0.86;
/** How far a welded centre name runs into the frame's inner edge, mm — enough to survive kerf
 *  on both edges, well short of the rim names engraved further out. */
const WELD_BITE = 0.8;
/** The share of the window's WIDTH the centre name is drawn at, when the window's circle lets
 *  it: the proportion that reads well for a name inside a ring. */
const NAME_FILL = 0.8;
/** Air between the name and the frame's inner edge, mm. */
const WINDOW_MARGIN = 3;
/** Below this ink height the centre word has stopped being the dominant mark. */
const CENTRE_WARN = 6;
/** Below this it has stopped being letters at all. */
const CENTRE_SEVERE = 3;
/**
 * The rim names are the secondary line, so they are set in a plain face and uppercased rather
 * than in the script the centre word uses — "two typefaces, one accent", where the
 * script is the accent and the caption is not. It is not a preference: a script's ink runs from
 * its ascender to its descender, about 1.9 × its cap height, and fitting THAT between the two
 * edges of a 6.3 mm rim leaves a 2.6 mm cap — under the 3 mm engraving floor before anyone has
 * typed anything. Capitals in a sans are as tall as their own ink, so the same rim carries a
 * 3.3 mm cap with a millimetre of air either side.
 */
const RIM_FONT = 'montserrat';
/** Small engraved capitals want opening up: caption tracking. */
const RIM_TRACKING = 0.08;
/** How wide the automatic bridges are — the bar under an i's dot. G33's 1.5–3 mm. */
const bridgeFor = (size: number) => Math.min(3, Math.max(1.5, 0.12 * size));
/** How far the glue guide is drawn inside the piece it traces, mm. */
const GUIDE_INSET = 0.3;

/**
 * The faces this design is for, in order (G2): a connecting script, because the centre word is
 * cut as ONE light piece and a face whose letters do not touch has to be welded into one. The
 * four `WELDING_SCRIPTS` write as a single line at any size, so the piece is the letters exactly
 * as the type designer drew them; the rest of this shelf is welded by the overlap walk and its
 * seams scored, which is G33's block case and reads perfectly well.
 *
 * Which is why the shared `connectWarning` is NOT raised here (nor on the christmas ornament):
 * "this font's letters do not join on their own — pick a script that connects" is advice for a
 * template whose product is a flowing line. This one's product is a name in a frame, the weld
 * handles a face that does not join, and a sentence that fires on half the recommended shelf is
 * noise. `countersTooTight` stays — that one is a problem the weld cannot fix.
 */
const CENTRE_SCRIPTS = [...WELDING_SCRIPTS, 'satisfy', 'yellowtail', 'lobster', 'kaushan-script'];

/** How far a layer's ink reaches from the disc's centre, mm — the rim is a radial band, so a
 *  bounding box says nothing useful about whether the text is on it. */
function radialBand(shapes: Shapes): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = 0;
  for (const island of shapes) {
    for (const ring of island) {
      for (const [x, y] of ring) {
        const d = Math.hypot(x, y);
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
    }
  }
  return Number.isFinite(lo) ? { lo, hi } : { lo: 0, hi: 0 };
}

/**
 * Every name on its own arc, spaced evenly round the whole ring — the first at 12 o'clock and the
 * rest clockwise, each centred in a slot of 360° / n. Names in the top half read outward
 * (clockwise), the bottom half inward (counter-clockwise), so all of them read the right way up.
 *
 * ONE size for all of them — a wreath of names at three different heights reads as a mistake —
 * found the way the old two-arc fit found its own: the longest name must fit `SLOT_FILL` of its slot, and
 * the tallest ink must fit between the rim's two edges. Each name's baseline is then moved by
 * however far ITS ink missed the midline, since a J's hook and a Q's tail sit differently.
 */
async function ringOfNames(
  base: Omit<TextSpec, 'text' | 'size'>,
  names: string[],
  midline: number,
  rimWidth: number,
): Promise<{ layers: DesignLayer[]; cap: number }> {
  const live = names.filter((n) => n.trim());
  if (!live.length) return { layers: [], cap: 0 };
  const n = live.length;
  const slot = (2 * Math.PI) / n;
  const cap0 = Math.min(5.5, Math.max(CAP_FLOOR, 0.52 * rimWidth));
  const size0 = await sizeForCapHeight(base.font, cap0);
  // Span: the longest name's advance, as an angle on the midline, against its share of a slot.
  // One name alone may run most of the way round, never into itself.
  const maxSpan = n === 1 ? (300 * Math.PI) / 180 : SLOT_FILL * slot;
  let span = 0;
  for (const name of live) {
    const run = await glyphLayers({ ...base, text: name, size: size0 });
    span = Math.max(span, run.reduce((a, g) => a + g.advance, 0) / Math.max(midline, 1e-3));
  }
  const size1 = span > maxSpan ? (size0 * maxSpan) / span : size0;

  const centreOf = (i: number) => 90 - (i * 360) / n;
  const dirOf = (deg: number): 'outside' | 'inside' => (Math.sin((deg * Math.PI) / 180) > -0.3 ? 'outside' : 'inside');
  const allowed = Math.max(1, rimWidth - 2 * Math.max(0.6, 0.12 * rimWidth));
  // Trial pass: every name at size1 on the midline, measured as a radial band.
  const trials = await Promise.all(live.map((name, i) =>
    arcTextLayer({ ...base, text: name, size: size1, radius: midline, centreAngle: centreOf(i), direction: dirOf(centreOf(i)) }, 'engrave', `rim-${i}`, 'Names')));
  const bands = trials.map((t) => radialBand(t.flatMap((l) => l.shapes)));
  const tallest = Math.max(...bands.map((b) => b.hi - b.lo), 1e-6);
  const k = tallest > allowed ? allowed / tallest : 1;
  const layers = (await Promise.all(live.map((name, i) => {
    const b = bands[i]!;
    const offset = ((b.lo + b.hi) / 2 - midline) * k;
    return arcTextLayer(
      { ...base, text: name, size: size1 * k, radius: midline - offset, centreAngle: centreOf(i), direction: dirOf(centreOf(i)) },
      'engrave', `rim-${i}`, 'Names',
    );
  }))).flat();
  return { layers, cap: (cap0 * size1 * k) / size0 };
}

/** How far the ink of `shapes`, grown by `grow`, reaches from the centre, mm. */
const reachOf = (shapes: Shapes, grow: number) => radialBand(shapes).hi + grow;

/**
 * How much to scale a drawn word by so it fills a circular window of radius `windowR`.
 *
 * Two numbers, the smaller wins, and both are one division rather than a search:
 *   · `NAME_FILL` of the window's width;
 *   · the window's own circle with `WINDOW_MARGIN` of air, which is the block's half-DIAGONAL
 *     against `windowR - WINDOW_MARGIN`, because the corners of a word are not on the midline.
 * A short name is held by the circle and a long one by the width, which is the way round it
 * should be: "Mum" fills the frame, "Grandmother" sits across it.
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
  /** Grow the word until its farthest ink reaches this radius — the welded construction — rather
   *  than filling the window with air round it. */
  weldTo?: number,
): Promise<{ layers: DesignLayer[]; size: number; box: Box } | null> {
  if (!text.trim()) return null;
  // A first guess in the right order of magnitude; three passes land inside half a percent.
  // Each pass re-draws rather than scaling the outlines, because the overlap the weld walks is
  // a share of the SIZE.
  let size = Math.max(3, windowR);
  let drawn: DesignLayer[] = [];
  for (let pass = 0; pass < 3; pass++) {
    drawn = await textLayer(
      { ...base, text, size, connect: connectSpec(base.font, size), x: at[0], y: at[1] },
      'off',
      'centre',
      'Centre name',
    );
    if (!drawn.length) return null;
    const k = weldTo
      ? weldTo / Math.max(1e-6, reachOf(drawn[0]!.shapes, drawn[0]!.grow ?? 0))
      : fillScale(bboxOf(drawn[0]!.shapes), drawn[0]!.grow ?? 0, windowR);
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

export const framedNameOrnament: TemplateDef = {
  id: 'framed-name-ornament',
  name: 'Framed name ornament',
  blurb: 'A dark disc in a light rim frame — family names spaced round the ring, one name welded across the middle.',
  // No score by default: the welded centre name has no glue guide (Raised still scores one).
  tags: ['ornament', 'engrave + cut'],
  fields: [
    // ---------------------------------------------------------- RIGHT: what you type --
    {
      kind: 'lines', key: 'names', label: 'Names', panel: 'right', section: 'Names',
      value: 'Mama\nDad\nElla\nJay', placeholder: 'One name per line', rows: 4, maxLines: 6,
      help: 'About six names is what a 90 mm frame reads clearly.',
    },
    {
      kind: 'text', key: 'centreWord', label: 'Centre name', panel: 'right', section: 'Centre name',
      value: 'Grandad', placeholder: 'A name, or "Grandad", "Mum"…', maxLength: 14, symbols: true,
    },
    // The font field always lands on the left as its own category, whatever `panel` says.
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'pacifico', recommended: CENTRE_SCRIPTS },

    // ----------------------------------------------------- LEFT: "Ornament" (opens first) --
    // The whole of the first screen: how big the ornament is, and how wide the frame round it.
    // Two numbers about ONE object, so they are one category and not two — the rail reads
    // Ornament · Font · More, the same three entries the christmas bauble's does.
    {
      kind: 'number', key: 'backerSize', label: 'Diameter', section: 'Ornament',
      value: 90, min: 60, max: 140, step: 1, unit: 'mm',
      help: '80–100 mm is the classic hanging-ornament range.',
    },

    // The shared frame block, with three edits this design makes and says why:
    //   · "Loop through both layers" is gone — the layers ALWAYS register.
    //   · the loop's hole and wall are sized from the diameter above, so their fields are hidden
    //     rather than shown with numbers the build overrides (family-crossword's own pattern),
    //     and the switch and the nudge pad go under More.
    //   · the frame's own width joins Diameter in "Ornament"; the loop's controls keep the
    //     section they were built with, and every one of them is under More anyway.
    ...frameFields({ diameter: 90 })
      .filter((f) => f.key !== 'backerRing')
      .map((f): Field => {
        if (f.key === 'holeDia' || f.key === 'holeRing') return { ...f, hidden: true };
        // G25: the nudge is half the part's own longest side, never the shared 250 mm.
        if (f.key === 'ringDx' && f.kind === 'position') return more({ ...f, max: 45 });
        return f.hidden ? f : f.key === 'rimWidth' ? { ...f, section: 'Ornament' } : more(f);
      }),

    // ------------------------------------------------------------------ MORE: the lettering --
    // Hidden, not greyed, for a face that joins on its own: there are no seams to score when the
    // type designer already joined the letters.
    more({ ...letterScoreField('Lettering'), visibleWhen: (v) => !isConnectingFont(str(v, 'font')) }),
    // Three ways for the centre name, Welded first: the name grown into the frame's inner edge and
    // cut WITH the frame as one light piece. Raised cuts it as its own piece to glue on; Engrave
    // burns it.
    ...lightPieceFields('Lettering', 'raised', { help: 'Welded joins the name to the frame; Raised cuts it to glue on; Engrave burns it on.' })
      .map((f): Field => (f.key === 'lightOp' && f.kind === 'select'
        ? { ...f, label: 'Centre name', value: 'welded', options: [{ value: 'welded', label: 'Welded' }, ...f.options] }
        : f))
      .map(more),
    ...letteringFields('Lettering'),
  ],

  async build(v) {
    const d = num(v, 'backerSize');
    const r = d / 2;
    // The field's own 5–14 mm can never collapse a disc this size; the clamp is for a saved file
    // carrying something sillier, so a bad number is a thinner rim and not a lost ornament.
    const rim = Math.max(1, Math.min(num(v, 'rimWidth'), 0.45 * r));
    const op = str(v, 'lightOp');
    const welded = op !== 'engrave' && op !== 'raised';
    const raised = op === 'raised';
    // The loop is sized to the ornament, not set: a Ø 100 disc gets a 14 mm tab with a 4 mm hole,
    // both floored where the hardware is (§5.2–5.3 of the laser reference).
    const keyring = { ...keyringFrom(v), mode: 'outside' as const, dia: clamp(LOOP_HOLE * d, 3, 6), ring: clamp(LOOP_WALL * d, 3, 7) };
    const font = str(v, 'font');
    const base = { symbols: readSymbols(v), font, letterSpacing: num(v, 'letterSpacing') / 100 };
    const disc: Shapes = [[circleRing(0, 0, r, 160)]];
    const warnings: string[] = [];

    // ------------------------------------------------------------- the names, round the rim --
    // Half above, half below, each joined into one run: the top arc reads clockwise from the
    // loop, the bottom one counter-clockwise, and both read the right way up. The loop is a tab
    // welded OUTSIDE the edge, so it takes nothing from the rim and both arcs keep their room.
    const names = lines(v, 'names').map((n) => n.toUpperCase());
    const midline = r - rim / 2;
    const rimBase = { symbols: base.symbols, font: RIM_FONT, letterSpacing: RIM_TRACKING };
    const ring = await ringOfNames(rimBase, names, midline, rim);
    const rimCaps = [ring.cap].filter((c) => c > 0);
    if (rimCaps.length && Math.min(...rimCaps) < CAP_FLOOR) {
      warnings.push('Names are tight on this rim — try fewer names, or a bigger ornament.');
    }

    // ---------------------------------------------------- the centre name, filling the window --
    const windowR = Math.max(4, r - rim);
    const centre = await fitName(base, applyCase(str(v, 'centreWord'), str(v, 'textCase')), windowR, [0, 0], welded ? windowR + WELD_BITE : undefined);
    const ink = centre ? centre.box.maxY - centre.box.minY : 0;
    if (centre && ink < CENTRE_SEVERE) warnings.push('That name is far too long for this frame — try a shorter one, or a much bigger ornament.');
    else if (centre && ink < CENTRE_WARN) warnings.push('That name is long for this size — the letters are getting thin. Try a shorter one, or a bigger ornament.');
    if (centre) warnings.push(...countersTooTight(centre.layers.flatMap((l) => l.shapes)));

    // ------------------------------------------------------------------------- the pieces --
    const overlap = centre ? connectSpec(font, centre.size).overlap ?? 0 : 0;
    const letters: DesignLayer[] = centre ? centre.layers.map((l) => ({ ...l, op: 'off' as const, hugOnly: true })) : [];
    const seams: DesignLayer[] = centre && op !== 'engrave' && str(v, 'letterLines') === 'score' && overlap > 0
      ? centre.layers.map((l) => ({ ...l, id: `${l.id}-seam`, label: 'Letter seams', op: 'score' as const, seams: true }))
      : [];

    const backerLayers: DesignLayer[] = [];
    if (centre && raised && str(v, 'glue') !== 'none') {
      // The guide traces the glyphs a hair inside the edge the piece is really cut on, so the
      // line it is glued over never shows. `kind: 'guide'` keeps it out of the engine's "the
      // hole sits on the lettering" net — it is a registration mark, not a word.
      backerLayers.push(...centre.layers.map((l) => ({
        ...l, id: `${l.id}-guide`, label: 'Glue guide', op: 'score' as const, kind: 'guide' as const,
        grow: (l.grow ?? 0) - GUIDE_INSET,
      })));
    } else if (centre && op === 'engrave') {
      backerLayers.push(...centre.layers.map((l) => ({ ...l, op: 'engrave' as const })));
    }

    const parts: PartInput[] = [{
      id: 'backer',
      label: 'Backer · dark sheet',
      blank: { kind: 'shape', shapes: disc },
      layers: backerLayers,
      // Straight under the frame: the same disc about the same origin, the same lug and hole at
      // the same local point, and `'built'` puts its box centre back where it was built — so the
      // glue-up is the build frame again.
      keyring: 'shared',
      assembledAt: 'built',
      material: 'dark',
    }];
    if (centre && raised) {
      parts.push({
        id: 'name',
        label: 'Name · light sheet',
        // G33: the piece IS the letters. Margin 0, no smoothing pass, counters open so the dark
        // disc shows through the bowl of an "a"; `minHole` is the counter the weld may keep. The
        // engine's own 1.2 mm default is a name-keychain number, where the caps are 14 mm and a
        // bowl is 3 mm across; a script's bowls are nearer a millimetre.
        blank: { kind: 'hug', margin: 0, smoothing: 0, counters: 'open', bridge: bridgeFor(centre.size), minHole: MIN_COUNTER },
        layers: [...letters, ...seams],
        // Never: the top layer carries no loop and no hole.
        keyring: 'none',
        // Dead centre of the window — the point `fitName` centred the block on.
        assembledAt: { x: 0, y: 0 },
        material: 'light',
      });
    }

    // Welded: the frame is the ring and the name UNIONED — a hug at margin 0 round the ring and
    // the letters, the sports tags' construction — so they come off the bed as one light piece.
    // `bridges: 'dots'` holds an i's tittle and nothing else; the word itself reaches the ring.
    const ringShapes: Shapes = [[circleRing(0, 0, r, 160), [...circleRing(0, 0, r - rim, 160)].reverse()]];
    const frameBlank = welded && centre
      ? { kind: 'hug' as const, margin: 0, smoothing: 0, counters: 'open' as const, bridges: 'dots' as const, bridge: bridgeFor(centre.size), minHole: MIN_COUNTER }
      // A circle has no inner corner to round, so the rim's smoothing pass would buy nothing and
      // cost two more offsets.
      : { kind: 'rim' as const, outer: disc, rimWidth: rim, smoothing: 0 };
    const frameMaterial: DesignLayer[] = welded && centre
      ? [{ id: 'frame', label: 'Frame', shapes: ringShapes, op: 'off', hugOnly: true }, ...letters, ...seams]
      : [];

    return {
      label: 'Frame · light sheet',
      material: 'light',
      blank: frameBlank,
      keyring,
      layers: [...frameMaterial, ...ring.layers],
      parts,
      layout: { flow: 'row', gap: 6 },
      status: `${parts.length + 1} pieces · dark backer, light frame${centre && raised ? ' and name' : centre && welded ? ' with the name welded in' : ''}`,
      ...(warnings.length ? { warnings } : {}),
    };
  },

  // A function, not a string (G27): "then glue" is a lie in Engrave mode, where there is no
  // second light piece and nothing to glue.
  exportNote: (v) =>
    str(v, 'lightOp') === 'engrave'
      ? 'Cut the dark backer from one sheet and the light frame from another — nothing to glue.'
      : 'Cut the dark backer from one sheet, the light frame and name from another, then glue the name on.',

  fileName: (v) => stem(str(v, 'centreWord') || 'ornament', 'framed'),
};

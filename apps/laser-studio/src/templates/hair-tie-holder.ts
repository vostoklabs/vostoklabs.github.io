import { readSymbols } from '../symbols/model';
// Hair tie holder — the landscape slot card (Ian, 2026-09-21: "completely off, scrap that and
// let's have a couple of simpler templates", with two reference pictures; this one is
// `ref/REF-hair-tie-slot-card-sophia.png`). The v3 shape-on-a-plaque with its notched waist and
// its Slot bar alternative are gone: one template, one object, one shape.
//
// What the object is, in the order the material comes off the bed:
//
//   THE CARD — a landscape rounded rectangle, 90 × 62 by default, with
//     · a central rectangular slot (50 × 12): the ties are pushed through it and hang from the
//       bar of material below, which is what actually holds them;
//     · a notch cut into each side edge at mid height (6 along the edge × 8 deep): a tie
//       stretched round the card drops into the two seats and cannot slide off either end;
//     · a Ø 4 mm hanging hole 5 mm down from the top edge, cut into the OUTLINE — the design's
//       own hanging point, not the shared Ring control (that control is Loop tab | None now, and
//       a loop tab on a nursery card is not the product);
//     · an inner outline scored 3 mm in, the dotted line the reference draws.
//   THE NAME — its own cut piece, laid beside the card on the sheet and glued on below the slot
//     (`assembledAt`, so the 3D view and the gallery card show it glued). The letters are one
//     union: a face that joins writes it, anything else is overlapped a little and the buried
//     edges scored. Until the engine's G33 note lands this is the `connected-text` idiom —
//     `connectSpec` + a `hug` at margin 0 with bridges — which is the same weld the seams are
//     drawn from.
//
// Every cut keeps 4 mm of material from every other cut: 3 mm ply wants a web of at least its
// own thickness between two kerfs (`docs/design/laser-cutting-knowledge.md` §2.5), and 4 is that
// with the kerf paid for. The sliders are clamped to it rather than allowed to produce a card
// that snaps, and the clamp says so.
import { bboxOf, circleRing, placeShapes, roundedRectRing, type Pt, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { MIN_COUNTER, applyCase, textLayer } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import type { BuildInput, DesignLayer, PartInput } from '../engine/types';
import { NO_KEYRING } from './keyring';
import { fillShape } from '@vostok/patterns';
import { askedOp, fillOptions, patternDefFor, patternFields, resolveOp } from './pattern-shared';
import { bridgeField, bridgeModeOf, connectSpec, countersTooTight, letteringFields, stem } from './shared';
import { bool, num, str, type TemplateDef, type Values } from './types';

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** The least material left between any two cuts, mm. 3 mm ply's own thickness is the floor
 *  (§2.5); 4 is that with the kerf paid for, and it is what every slider here is clamped to. */
const MIN_WEB = 4;
/** The hanging hole: a 4 mm hole takes a jump ring, a ribbon or a cup hook, and 5 mm down from
 *  the edge leaves 3 mm of material above it — the material's own thickness (§5.2/§5.4). */
const HOLE_DIA = 4;
const HOLE_EDGE = 5;
/** How far in the scored inner outline runs, mm — the reference's dotted line. */
const INNER_INSET = 3;
/** Air between the name piece and the card's edges once it is glued on, mm. */
const NAME_AIR = 4;
/** Letters below this stop reading once they are cut rather than printed. */
const CAP_FLOOR = 6;
/** The bar that joins a letter the weld could not reach (a space, an inline symbol's pip), mm.
 *  The sheet's own thickness: a thinner bar is the first thing to snap off the piece. */
const NAME_BRIDGE = 3;
/** The card's own corner, seat depth and seat width, mm. They were sliders and they are not
 *  decisions: every value that was not the default either broke the web rule or looked like a
 *  different product, and the panel is the poorer for asking (Ian, 2026-09-23: "too much
 *  settings in both, simplify it"). */
const CORNER = 10;
/* The side seat, measured off Ian's reference sheet rather than guessed: 4.4 % of the width
   deep and 16.4 % of the height tall. The shipped 8 x 6 was the other way round — twice as
   deep and half as tall — which is why it read as a bite taken out of the edge instead of a
   seat an elastic drops into (Ian, 2026-09-23: "slots ... still not right, compare to the
   reference"). Kept as millimetres on the default card so the numbers are legible. */
const NOTCH_D = 4;
const NOTCH_W = 10;

/** How far ABOVE the card's middle the slot sits, as a share of the height.
 *
 *  Centred, the slot split the card in two and the name got whichever half was left. The
 *  reference (Ian's Cricut sheet, 2026-09-23) puts it high — the ties hang from the bar just
 *  under the hanging hole, and everything below it is clear for the name, which is the whole
 *  lower half of the card rather than a strip. */
const SLOT_RISE = 0.12;

/** The slot's corner radius, mm. The reference draws a plain rectangle; a small radius is the
 *  same drawing with the pierce divot off the corner (§2.1). */
const SLOT_CORNER = 1.5;

/** How far the scored inner line stops short of a seat it would otherwise run into, mm. */
const INNER_GAP = 0.8;

/** A notch: a rounded rectangle centred ON the edge, so its inner half bites `depth` into the
 *  material and its outer half hangs in fresh air.
 *
 *  SQUARE, with a small fillet — not the stadium it was. At 4 mm deep and 10 mm tall a
 *  full-radius end makes the whole notch one curve, and a curve is a round bite out of the edge
 *  rather than the square seat the reference draws (Ian, 2026-09-23, holding the two side by
 *  side). The fillet is what keeps it off being a stress riser; the flat is what makes it a
 *  seat an elastic sits IN instead of sliding across. */
const NOTCH_FILLET = 1.5;
const notchRing = (x: number, y: number, depth: number, along: number): CutRing =>
  placeShapes([[roundedRectRing(2 * depth, along, Math.min(NOTCH_FILLET, depth / 2, along / 2))]], x, y, 0)[0]![0]!;

/** Is `p` inside a rounded rectangle of half-sizes `hw × hh` and radius `r` about `c`, grown by
 *  `g`? Exact: the corner test only runs in the corner quadrant, so a stadium answers as a
 *  stadium rather than as its bounding box. */
function inRoundedRect(p: Pt, c: Pt, hw: number, hh: number, r: number, g = 0): boolean {
  const dx = Math.abs(p[0] - c[0]);
  const dy = Math.abs(p[1] - c[1]);
  const W = hw + g;
  const H = hh + g;
  const R = Math.min(r + g, W, H);
  if (dx > W || dy > H) return false;
  const ax = W - R;
  const ay = H - R;
  if (dx <= ax || dy <= ay) return true;
  return (dx - ax) ** 2 + (dy - ay) ** 2 <= R * R;
}

/**
 * The scored inner outline, as OPEN runs that stop either side of the seats.
 *
 * The reference draws it exactly this way (`ref/REF-hair-tie-slot-card-sophia.png`): the dotted
 * line runs round the card 3 mm in and simply stops where a seat is cut, picking up again on the
 * far side. Handing the engine a closed ring and letting it clip draws the same picture and then
 * reports 4 % of the rule "runs past the edge" — which is the engine describing a seat, not a
 * fault. So the break is made here, where it is the design's decision.
 */
function innerRuns(w: number, h: number, corner: number, inset: number, guards: { c: Pt; hw: number; hh: number; r: number }[]): Pt[][] {
  const ring = roundedRectRing(w - 2 * inset, h - 2 * inset, Math.max(0, corner - inset), 12);
  // Densified, because a rounded rectangle draws each straight edge as ONE segment and a run can
  // only start and stop on a vertex.
  const dense: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.6));
    for (let s = 0; s < steps; s++) dense.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
  }
  const clear = dense.map((p) => !guards.some((g) => inRoundedRect(p, g.c, g.hw, g.hh, g.r, INNER_GAP)));
  if (clear.every(Boolean)) return [[...dense, dense[0]!]];
  // Start at the first point that follows a blocked one, so the walk never splits a live run.
  const start = clear.findIndex((ok, i) => ok && !clear[(i + clear.length - 1) % clear.length]);
  if (start < 0) return [];
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (let i = 0; i < dense.length; i++) {
    const k = (start + i) % dense.length;
    if (clear[k]) run.push(dense[k]!);
    else if (run.length) { if (run.length > 1) runs.push(run); run = []; }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** Faces whose capitals weld into a piece a 3 mm sheet survives: fat, rounded, open-countered.
 *  Measured, not guessed — every one of these cuts "Sophia", "Mia" and "Charlotte" at the shipped
 *  size with nothing to say. The two that look like they belong and do not: Titan One, whose
 *  counters are already under a millimetre at a 14 mm capital, and the connecting scripts, which
 *  this design sets in CAPITALS (the reference is "SOPHIA") where they no longer connect and the
 *  hug has to bar them together. Nothing with hairlines either — a 0.5 mm stroke is not a piece,
 *  it is a splinter (`laser-cutting-knowledge.md` §2.3). */
const NAME_FACES = ['fredoka', 'baloo-2', 'lilita-one', 'bakbak-one', 'chewy', 'anton'];

export const hairTieHolder: TemplateDef = {
  id: 'hair-tie-holder',
  name: 'Hair tie holder',
  blurb: 'A slot card for hair ties, with a seat cut into each edge and the name cut as its own piece to glue on.',
  tags: ['home', 'score + cut'],
  batch: { key: 'text', noun: 'holder' },
  fields: [
    // ------------------------------------------------------- RIGHT: what you type --
    {
      // Not a name with an I in it. A welded word guarantees every letter keeps 1.5 mm of its
      // own ink (engine/text.ts, MIN_BODY) and no more — which is a readable stroke on a wide
      // capital and a sliver on a narrow one, so "MILA" comes off the bed reading MLA. The
      // default should show the design working, not its narrowest case (2026-09-23).
      kind: 'text', key: 'text', label: 'Name', panel: 'right', section: 'Name', value: 'Hazel',
      placeholder: 'A name', maxLength: 14, symbols: true,
      help: 'Cut as its own piece and glued on the card.',
    },
    {
      kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'fredoka',
      recommended: NAME_FACES,
    },

    // -------------------------------------------- LEFT: "Card" — opens first --
    { kind: 'number', key: 'width', label: 'Width', section: 'Card', value: 90, min: 60, max: 160, step: 1, unit: 'mm' },
    // 45, not 40: under 45 the band left under the slot is thinner than the 6 mm floor a cut
    // letter has, so the slider's own minimum shipped a warning (G25).
    { kind: 'number', key: 'height', label: 'Height', section: 'Card', value: 62, min: 45, max: 120, step: 1, unit: 'mm' },
    // Both slot sizes on the first screen: it is the part of this object that does the work,
    // and the shipped 50 x 12 letterbox was too small for a handful of ties (Ian, 2026-09-23).
    {
      kind: 'number', key: 'slotW', label: 'Slot width', section: 'Card', value: 56, min: 20, max: 140, step: 1, unit: 'mm',
      help: 'The ties are pushed through and hang on the bar.',
    },
    // 12, which is the reference's 19 % of a 62 mm card. It was 18 for one round, after "the
    // slot is too small" — and 18 is half again as tall as the drawing, which is what made the
    // card read as a frame rather than a holder. The slider is on the first screen either way.
    { kind: 'number', key: 'slotH', label: 'Slot height', section: 'Card', value: 12, min: 6, max: 40, step: 0.5, unit: 'mm' },

    { kind: 'number', key: 'nameSize', label: 'Name size', section: 'Name', value: 14, min: 8, max: 28, step: 0.5, unit: 'mm' },
    // The bars that join letters the weld could not reach. They were forced on and unmentioned,
    // which is how a name comes off the bed wearing them with nothing to switch (Ian,
    // 2026-09-23: "letters still have this shitty bridges with no way for me to turn them off").
    bridgeField('Name', 'Join loose letters'),

    // The whole card, patterned — the same engine and the same knobs the pattern holder uses,
    // behind one switch so a plain card stays a plain card (Ian, 2026-09-23: "add option to
    // slap pattern on the full board").
    { kind: 'toggle', key: 'usePattern', label: 'Pattern the card', section: 'Pattern', value: false },
    ...patternFields({ section: 'Pattern', op: 'engrave', margin: 0 })
      // No margin and no web: "full board" is the whole point, and the border those two held
      // back is the thing being asked for.
      .filter((f) => !['margin', 'web'].includes(f.key))
      .map((f) => ({ ...f, visibleWhen: (vv: Values) => bool(vv, 'usePattern') && (f.visibleWhen ? f.visibleWhen(vv) : true) })),
    ...letteringFields('Name', { textCase: 'upper' }),
  ],

  async build(v: Values): Promise<BuildInput> {
    const warnings: string[] = [];
    const w = clamp(num(v, 'width'), 60, 160);
    const h = clamp(num(v, 'height'), 45, 120);
    const corner = clamp(CORNER, 0, 0.3 * Math.min(w, h));

    // ------------------------------------------------------------- the card --
    // The hanging hole is a hole in the OUTLINE, not a layer: it is part of the shape the way
    // the slot is part of the product, and nothing the customer can drag off the edge.
    const holeCy = h / 2 - HOLE_EDGE;
    const card: Shapes = [[roundedRectRing(w, h, corner), circleRing(0, holeCy, HOLE_DIA / 2, 48)]];

    // Where the slot sits, and now the seats too: a tie stretched across the card runs from one
    // seat, through the slot and out the other, so all three being on ONE line is the whole
    // geometry of it (Ian, 2026-09-23: "the slots need to be on the same level as the cutout").
    const slotCy = SLOT_RISE * h;

    // ------------------------------------------------- the seats in the edges --
    // Held off the top and bottom edges as well as off the slot: a seat is a cut like any other.
    // As a SHARE of the card, so a 160 mm holder gets a seat an elastic can still find. The
    // fractions are the reference's; the constants above are what they come to on the default.
    const notchD = clamp(0.044 * w, 3, Math.max(3, Math.min(16, w / 2 - 2 * MIN_WEB)));
    const notchW = clamp(0.164 * h, 3, Math.max(3, Math.min(20, h - 2 * MIN_WEB)));
    const notches: Shapes = [
      [notchRing(-w / 2, slotCy, notchD, notchW)],
      [notchRing(w / 2, slotCy, notchD, notchW)],
    ];

    // ------------------------------------------------------------- the slot --
    // Wide enough to take a handful of ties, and held `MIN_WEB` clear of the seats' floors on
    // each side and of the hanging hole above.
    const maxSlotW = w - 2 * notchD - 2 * MIN_WEB;
    const slotW = clamp(num(v, 'slotW'), 10, Math.max(10, maxSlotW));
    if (num(v, 'slotW') > maxSlotW + 0.01) warnings.push(`The slot was cut back to ${slotW.toFixed(0)} mm to keep ${MIN_WEB} mm of material between it and the seats.`);
    // Room above (the hanging hole) and below (the card's own edge), measured from where the
    // slot actually sits rather than from the middle it no longer occupies.
    const maxSlotH = 2 * Math.min(holeCy - HOLE_DIA / 2 - MIN_WEB - slotCy, slotCy + h / 2 - MIN_WEB);
    const slotH = clamp(num(v, 'slotH'), 4, Math.max(4, maxSlotH));
    if (num(v, 'slotH') > maxSlotH + 0.01) warnings.push(`The slot was cut back to ${slotH.toFixed(0)} mm tall to keep clear of the hanging hole.`);

    const slotRing = roundedRectRing(slotW, slotH, Math.min(SLOT_CORNER, slotH / 2, slotW / 2))
      .map(([x, y]): [number, number] => [x, y + slotCy]);

    const layers: DesignLayer[] = [
      { id: 'slot', label: 'Slot', op: 'cut', stencil: false, shapes: [[slotRing]] },
      {
        // Trimmed to the material before it is punched: the outer half of each seat hangs in
        // fresh air and must not reach the size on the status line (G15).
        id: 'notches', label: 'Seats', op: 'cut', shapes: notches, keep: card, stencil: false,
      },
    ];
    if (w > 2 * INNER_INSET + 4 && h > 2 * INNER_INSET + 4) {
      const seat = { hw: notchD, hh: notchW / 2, r: Math.min(notchD, notchW / 2) };
      const runs = innerRuns(w, h, corner, INNER_INSET, [
        { c: [-w / 2, slotCy], ...seat },
        { c: [w / 2, slotCy], ...seat },
      ]);
      if (runs.length) layers.push({ id: 'inner', label: 'Inner line', op: 'score', shapes: [], paths: runs });
    }

    // ------------------------------------------------- the pattern, if asked for --
    // The region is the card less its own voids — the hanging hole and the slot — and nothing
    // else held back. The seats are NOT reserved: they are cut away afterwards, so a burn that
    // lands there leaves with them.
    if (bool(v, 'usePattern')) {
      const def = await patternDefFor(str(v, 'pattern'));
      const resolved = resolveOp(def, askedOp(v));
      const op = resolved.op;
      warnings.push(...resolved.warnings);
      const region: Shapes = [[roundedRectRing(w, h, corner), circleRing(0, holeCy, HOLE_DIA / 2 + 1, 48), slotRing]];
      const fill = fillShape(region, def, fillOptions({ ...v, margin: 0, web: MIN_WEB }, op));
      warnings.push(...fill.warnings);
      // `kind: 'fill'` — a pattern that covers the card is MEANT to reach the edge, and without
      // it every build reports the burn as having run off the part.
      if (op === 'cut') {
        layers.unshift({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'cut', stencil: false, kind: 'fill' });
      } else if (op === 'engrave') {
        if (fill.shapes.length) layers.unshift({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'engrave', kind: 'fill' });
        if (fill.paths.length) layers.unshift({ id: 'pattern-lines', label: `${def.name} lines`, shapes: [], op: 'score', paths: fill.paths, kind: 'fill' });
      } else {
        layers.unshift({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'score', paths: fill.paths, kind: 'fill' });
      }
    }

    // -------------------------------------------------- the name, its own piece --
    // The band under the slot is where it glues: the hole and the slot own everything above it.
    const bandTop = slotCy - slotH / 2;
    const bandH = bandTop + h / 2;
    const name = await namePiece(
      v,
      clamp(num(v, 'nameSize'), CAP_FLOOR, 28),
      w - 2 * Math.max(corner, NAME_AIR),
      bandH - 2 * NAME_AIR,
    );
    const parts: PartInput[] = [];
    if (name) {
      if (name.tight) warnings.push(`The name is at its ${CAP_FLOOR} mm floor and still runs past the card — use a shorter name or a wider card.`);
      warnings.push(...countersTooTight(name.layers.flatMap((l) => l.shapes)));
      parts.push({
        id: 'name',
        label: 'Name',
        // The piece IS the letters: margin 0 and no smoothing, so it is cut on the glyph
        // outlines and not in a jacket (G31). Bridges join what the weld could not reach.
        blank: { kind: 'hug', margin: 0, smoothing: 0, bridge: NAME_BRIDGE, counters: 'open', minHole: MIN_COUNTER, bridges: bridgeModeOf(v) },
        layers: [
          ...name.layers.map((l) => ({ ...l, op: 'off' as const, hugOnly: true })),
          ...name.seams,
        ],
        keyring: 'none',
        assembledAt: { x: 0, y: bandTop - bandH / 2 },
        material: 'light',
      });
    }

    return {
      label: 'Card',
      material: 'dark',
      blank: { kind: 'shape', shapes: card, oneIsland: true },
      // No Ring control at all: the hole above is the design's (Ian, 2026-09-21).
      keyring: NO_KEYRING,
      layers,
      ...(parts.length ? { parts, layout: { flow: 'row' as const, gap: 6 } } : {}),
      ...(warnings.length ? { warnings } : {}),
      status: parts.length ? 'card + name piece' : 'card',
    };
  },

  fileName: (v) => stem(str(v, 'text') || 'holder', 'hair-tie'),

  exportNote: 'Glue the name onto the card below the slot, then push the ties through.',
};

/**
 * The name as ONE welded body, centred on its own origin — the piece the customer glues on.
 *
 * Built, measured, rebuilt at a smaller capital — never scaled: a face squeezed in one axis is a
 * different typeface, and the font cards are the whole reason the customer picked this one. The
 * floor is 6 mm; below that a cut letter is a splinter, so the fit stops and the caller warns.
 */
async function namePiece(v: Values, wantedCap: number, maxW: number, maxH: number): Promise<
{ layers: DesignLayer[]; seams: DesignLayer[]; cap: number; tight: boolean } | null> {
  const text = applyCase(str(v, 'text'), str(v, 'textCase')).trim();
  if (!text || maxW <= 2 || maxH <= 2) return null;
  const font = str(v, 'font');
  const draw = async (cap: number) => {
    const size = await sizeForCapHeight(font, cap);
    const connect = connectSpec(font, size);
    const layers = await textLayer(
      { text, symbols: readSymbols(v), font, size, letterSpacing: num(v, 'letterSpacing') / 100, connect },
      'off', 'name', 'Name',
    );
    return { layers, connect, box: bboxOf(layers.flatMap((l) => l.shapes)) };
  };

  let out = await draw(wantedCap);
  if (!out.layers.length) return null;
  let cap = wantedCap;
  const k = Math.min(
    1,
    maxW / Math.max(1e-6, out.box.maxX - out.box.minX),
    maxH / Math.max(1e-6, out.box.maxY - out.box.minY),
  );
  if (k < 0.999) {
    cap = Math.max(CAP_FLOOR, wantedCap * k);
    out = await draw(cap);
  }
  const bw = out.box.maxX - out.box.minX;
  const bh = out.box.maxY - out.box.minY;
  const dx = -(out.box.minX + out.box.maxX) / 2;
  const dy = -(out.box.minY + out.box.maxY) / 2;
  const centred = out.layers.map((l) => ({ ...l, shapes: placeShapes(l.shapes, dx, dy, 0) }));
  // Welded letters blend into each other, so the word needs a line at every junction to still
  // read as letters — SOPHIA came off the bed with its I buried between the H and the A.
  //
  // `seams: true`, NOT the whole-outline trick the family tree uses. The two designs bury
  // different things: a tree's letter stands on a BAR, so what is hidden is an area and the
  // clip finds it; here one letter is buried 0.6 mm into the next, so what is hidden is a
  // short arc lying on the piece's own cut line — the clip drops all of it and the build says
  // "Letter outlines lies outside the part" (measured, 2026-09-23). `seams` computes the
  // junction directly instead of asking the clip to discover it.
  //
  // Always on, with no control: a welded word that cannot be read is not a product, and the
  // field that used to switch it went with the rest of the long tail.
  const seams = (out.connect.overlap ?? 0) > 0
    ? centred.map((l) => ({ ...l, id: `${l.id}-seam`, label: 'Letter seams', op: 'score' as const, seams: true }))
    : [];
  return { layers: centred, seams, cap, tight: bw > maxW + 0.05 || bh > maxH + 0.05 };
}

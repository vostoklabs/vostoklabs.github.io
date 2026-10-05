import { readSymbols } from '../symbols/model';
// The cake topper: up to three lines in a FAT rounded face, stacked so tightly that every line
// welds into the one below it, on ONE centred stick with a pointed tip.
//
// The target: three lines interlocked into one piece, one 8 mm stick, a balloon at the top
// right; or the same thing as two layers: a light backer following the letters, the dark text
// raised on it, a heart, one stick, about 158 × 166 mm. What we shipped before was a thin brush
// script, an ampersand hanging on a hair-thin rod, and two long twigs for legs.
//
// So, in the order the code does it:
//
//   1. Every line is set at the SAME size and welded by G33: each glyph
//      is its own island, walked left until it is buried `weldOverlap(em)` mm in the one before
//      it, and the seams — each letter's edge where a later letter covers it — are scored.
//   2. The em is SOLVED for the width the customer asked for. Width is affine in the em, so one
//      probe build gives the answer in closed form and two corrections land it inside 0.2 mm.
//   3. The lines are stacked at `lineHeight` % of the em and then SET INTO each other: the whole
//      line is dropped until its closest column is buried, and any cluster the line move left
//      hanging (the "&" of "Mr & Mrs") is walked down on its own by up to a quarter of the cap.
//      That is the finding P10 left open — after the September polish two short links remained,
//      under the ampersand and under "Mrs", and a fat face at 80 % leading must have none.
//   4. The strokes are thickened until the narrowest ink measures 2 mm (§10.3: the bottom line
//      carries the stick's shear load, and 2 mm is the floor for lettering that is cut through).
//      The thicken is capped by the engine at what the counters can spare, so a face that cannot
//      reach 2 mm is warned about rather than blobbed.
//   5. ONE stick, centred, seated where the bottom line has the most material across its width,
//      biting up into the letters — never two, never a rod.
//
// Nothing in here needs manifold: every measurement is a scan line over the outlines
// (engine/cake-topper-geom.ts), so it all runs inside the live preview.
import { bboxOf, placeShapes, type Shapes } from '@vostok/laser';
import { textLayer } from '../engine/text';
import { textMetrics } from '../engine/metrics';
import { accentShapes, baselineOf, clearance, clusterIndices, legSeat, smallestIsland, stickRing, thinnestStroke } from '../engine/cake-topper-geom';
import type { Blank, BuildInput, DesignLayer, KeyringSpec, PartInput } from '../engine/types';
import { connectSpec, countersTooTight, letterScoreField, stem } from './shared';
import { bool, num, str, type TemplateDef, type Values } from './types';

/** A topper hangs from nothing. The preview then has no hole handle, and the left rail keeps to
 *  three named categories instead of four. */
const noRing = (): KeyringSpec => ({ enabled: false, mode: 'outside', side: 'bottom', along: 0.5, dia: 5, ring: 2.5, position: -1 });

/** The narrowest ink a topper may be cut with, mm.
 *  Under it a stroke snaps in the hand, and on the bottom line it snaps at the stick. */
const MIN_STROKE = 2;

/** How much lettering the stick has to be welded to, mm. Less than this and the topper tears off
 *  its own stick the first time it is pushed into icing. */
const MIN_CONTACT = 8;

/** What the backer shows around the letters, mm — the shadow line (2–4 mm at this scale). It is
 *  the design, not a control: two layers, no layer options. */
const BORDER = 3;

/** The engine's bridge width — what a word space on a line gets when nothing else joins it, mm.
 *  Wider than the 3 mm sheet a topper is cut from, so nothing it draws is thinner than the
 *  material. There is no smoothing pass to go with it: G33 is explicit that a welded word is cut
 *  on the letters' own union and that a smoothing pass "to close the gaps" is how a word becomes
 *  a slab. The overlap is what closes them. */
const BRIDGE = 3.5;

/** The em every solve starts from. Any number works — this one makes the probe's numbers easy to
 *  read in a log. */
const PROBE_EM = 50;

const widthOf = (s: Shapes) => { const b = bboxOf(s); return b.maxX - b.minX; };

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * The faces to put in front of a topper buyer (G2): FAT rounded display faces, which is what
 * toppers like this are set in and the only kind of face that welds into a piece
 * you can push into a cake. Each one was built here at the default ("Happy / Birthday / Ava",
 * 150 mm) AND at "Mr & Mrs / Ramsey" before it went on the list — one cut island, no joining
 * bars, no warnings, nothing under 2 mm.
 *
 * Chewy leads and is the default because it is the look this design is after: fat, round and
 * bubbly, the widest weld under the stick of any of them (43 mm against Fredoka's 9), and the only
 * face here whose seams all land at letter junctions rather than across a bowl.
 *
 * Bubblegum Sans is not bundled (`packages/fonts/src/fonts/` has no `bubblegum-sans.ttf`), so
 * Sniglet takes its place on the shelf — the same round, soft-cornered idea. The scripts the old
 * topper recommended are all gone: a brush script at topper scale measures 1.2–1.5 mm at its
 * connectors, which is what the old topper cut as.
 */
const FAT_FACES = ['chewy', 'fredoka', 'baloo-2', 'lilita-one', 'luckiest-guy', 'bakbak-one', 'sniglet'];

export const cakeTopper: TemplateDef = {
  id: 'cake-topper',
  name: 'Cake topper',
  blurb: 'Three lines in a fat rounded face, welded into one piece, on a stick that pushes into the cake.',
  // Job order, which is the order the laser runs them in: the letter seams are scored, then the
  // outline is cut. G29 — the pill follows the DEFAULT build, and the default scores its seams.
  tags: ['party', 'score + cut'],
  fields: [
    // -------------------------------------------------------- RIGHT: what you type --
    {
      kind: 'text', key: 'line1', label: 'Line 1', panel: 'right', section: 'Text',
      value: 'Happy', placeholder: 'A word — e.g. "Happy"', maxLength: 24, symbols: true,
    },
    {
      kind: 'text', key: 'line2', label: 'Line 2', panel: 'right', section: 'Text',
      value: 'Birthday', placeholder: 'Optional', maxLength: 24, symbols: true,
    },
    {
      kind: 'text', key: 'line3', label: 'Line 3', panel: 'right', section: 'Text',
      value: 'Ava', placeholder: 'Optional', maxLength: 24, symbols: true,
    },
    {
      kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font',
      value: 'chewy', recommended: FAT_FACES,
      help: 'Fat rounded faces weld into one piece.',
    },

    // ------------------------------------------------------ LEFT: "Topper" (opens first) --
    {
      kind: 'number', key: 'width', label: 'Width', section: 'Topper',
      value: 150, min: 80, max: 300, step: 1, unit: 'mm',
      help: 'How wide the finished topper is, edge to edge.',
    },
    {
      // Two layers, and only ever two: the backer carries the stick, the text
      // is raised on it. There is no layer count and no third option.
      kind: 'toggle', key: 'backer', label: 'Backer', section: 'Topper', value: false,
      help: 'A second sheet behind the letters, in another colour.',
    },
    {
      kind: 'select', key: 'accent', label: 'Accent', section: 'Topper',
      value: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'heart', label: 'Heart' },
        { value: 'star', label: 'Star' },
        { value: 'balloon', label: 'Balloon' },
      ],
      help: 'A shape welded at the top right of the lettering.',
    },

    // --------------------------------------------------------------- LEFT: "Lettering" --
    {
      kind: 'number', key: 'lineHeight', label: 'Line height', section: 'Lettering',
      value: 80, min: 55, max: 100, step: 1, unit: '%', format: (v) => `${Math.round(v)}% of the letter height`,
      visibleWhen: (v) => [str(v, 'line1'), str(v, 'line2'), str(v, 'line3')].filter((t) => t.trim()).length >= 2,
      help: 'Lower packs the lines deeper into each other.',
    },
    letterScoreField('Lettering'),

    // ------------------------------------------------------------------- LEFT: "Stick" --
    {
      kind: 'number', key: 'stickWidth', label: 'Stick width', section: 'Stick',
      value: 9, min: 6, max: 14, step: 0.5, unit: 'mm',
      help: 'Under 8 mm the stick flexes going into the cake.',
    },
    {
      kind: 'number', key: 'stickLength', label: 'Stick length', section: 'Stick',
      value: 100, min: 60, max: 140, step: 1, unit: 'mm',
      help: 'About 40 mm of it ends up inside the cake.',
    },
  ],

  async build(v) {
    return buildTopper(v);
  },

  fileName: (v) => stem(str(v, 'line1'), str(v, 'line2'), str(v, 'line3'), 'topper'),
  exportNote: 'Acrylic is not food-safe: wrap the stick or push it into a food-safe pick before it goes into the cake.',
};

/** The artwork at one em: every line welded (G33), stacked, and set into the line below it. */
interface Laid {
  /** Every glyph of every line, one island each, in reading order, then the accent. The order is
   *  what the seam pass reads: a letter's edge is scored where a LATER island covers it. */
  islands: Shapes;
  /** The same islands, per line, as placed. */
  lines: Shapes[];
  /** How many of `islands` each character owns, in the same order, then one per accent island —
   *  the engine's per-glyph seam tally (G33, W3): without it a stroke-built letter is scored
   *  against its own strokes. */
  glyphIslands: number[];
  /** The bold the engine will actually apply, mm per side — it caps what we ask for at what the
   *  narrowest counter can spare, so this is a measurement, not a request. */
  grow: number;
  width: number;
}

async function buildTopper(v: Values): Promise<BuildInput> {
  const symbols = readSymbols(v);
  const font = str(v, 'font');
  const texts = [str(v, 'line1'), str(v, 'line2'), str(v, 'line3')].map((t) => t.trim()).filter(Boolean);
  // Nothing typed is not a design: one sentence, no invented shape.
  if (!texts.length) return { blank: { kind: 'none' }, keyring: noRing(), layers: [], warnings: ['Type a line to build the topper.'] };

  const width = num(v, 'width');
  const backer = bool(v, 'backer');
  const border = backer ? BORDER : 0;
  const lead = Math.max(0.3, num(v, 'lineHeight') / 100);
  const stickLen = num(v, 'stickLength');
  // With a backer the finished stick is the drawn one plus the border on each side, so the drawn
  // stick comes out that much narrower and "Stick width" means the same millimetres in both
  // modes. Floored at 3 mm: a border wider than the stick it offsets is not a stick any more.
  const stickW = Math.max(3, num(v, 'stickWidth') - 2 * border);
  const accent = str(v, 'accent');
  const scored = str(v, 'letterLines') === 'score';

  const lay = async (em: number, pct: number): Promise<Laid> => {
    const built = await Promise.all(texts.map((t) => textLayer({ symbols, text: t, font, size: em, connect: connectSpec(font, em, pct * em) }, 'off')));
    const drawn = built.map((b) => b[0]?.shapes ?? []);
    const grow = Math.min(...built.map((b) => b[0]?.grow ?? 0));
    const { cap } = await textMetrics(font, em);
    // How deep one line buries itself in the next. The same proportion the welded lines used
    // before tonight, and never under 1.5 mm — kerf takes 0.2 mm off each side of the joint.
    const weld = Math.max(1.5, 0.06 * cap);
    // Stacked on their BASELINES, which is where a reader sees the leading. Each line comes back
    // from the engine centred on its own box, and a box is the wrong ruler: a line with no
    // descender would sit a descender's depth too high.
    const lines = drawn.map((shapes, i) => {
      if (!shapes.length) return shapes;
      const b = bboxOf(shapes);
      return placeShapes(shapes, 0, -i * lead * em - baselineOf(shapes, b.minX, b.maxX), 0);
    });
    const pad = 2 * grow + 0.5;
    for (let i = lines.length - 2; i >= 0; i--) {
      const below = lines.slice(i + 1).flat();
      if (!lines[i]!.length || !below.length) continue;
      // The whole line first. Dropping it keeps it level and cannot tear it, and afterwards its
      // closest column is buried exactly `weld` deep in the stack under it — 80 % leading alone
      // leaves 4–5 mm of daylight on a face whose ascenders and descenders do not happen to meet.
      const gap = clearance(below, lines[i]!);
      if (Number.isFinite(gap) && gap > -weld) lines[i] = placeShapes(lines[i]!, 0, -Math.min(gap + weld, 0.5 * em), 0);
      // Then whatever the line move left hanging: a word the line below does not reach up to, the
      // "&" between two words. P10 — after the September polish two short links remained, under
      // the ampersand and under "Mrs", and each is a cluster that the whole-line drop could not
      // help because its neighbours landed first. Each walks down on its own, a quarter of the
      // cap at most; past that it is the engine's bridge, which is the honest answer.
      const here = lines[i]!;
      const groups = clusterIndices(here, pad);
      if (groups.length < 2) continue;
      const moved = here.slice();
      for (const g of groups) {
        const d = clearance(below, g.map((k) => here[k]!));
        if (!Number.isFinite(d) || d <= -weld) continue;
        const drop = Math.min(d + weld, 0.25 * cap);
        if (drop <= 0.01) continue;
        for (const k of g) moved[k] = placeShapes([here[k]!], 0, -drop, 0)[0]!;
      }
      lines[i] = moved;
    }
    // The accent: a quarter of it hangs over the end of the top line and the rest is out in the
    // air to its right — a balloon. Sat clear above first, then dropped
    // until its underside is buried in the line, by the same weld the lines use.
    let extra: Shapes = [];
    const mark = accent === 'none' ? [] : accentShapes(accent, 1.05 * cap);
    if (mark.length && lines[0]?.length) {
      const tb = bboxOf(lines[0]!);
      const ab = bboxOf(mark);
      const placed = placeShapes(mark, tb.maxX - 0.25 * (ab.maxX - ab.minX) - ab.minX, tb.maxY + 1 - ab.minY, 0);
      const d = clearance(lines[0]!, placed);
      extra = Number.isFinite(d) ? placeShapes(placed, 0, -(d + weld), 0) : placed;
    }
    const islands = [...lines.flat(), ...extra];
    // Each line's islands keep their order through placing and the cluster drops, so the lines'
    // own tallies concatenate; the accent's islands are one "glyph" each.
    const glyphIslands = [...built.flatMap((b) => b[0]?.glyphIslands ?? (b[0]?.shapes ?? []).map(() => 1)), ...extra.map(() => 1)];
    return { islands, lines, grow, width: widthOf(islands), glyphIslands };
  };

  // The em, solved. Width is affine in the em — advances scale with it, and so do the weld
  // overlap and the accent — so a probe build answers in closed form and the corrections only
  // have to chase what the thicken cap does to the outline.
  let pct = 0.012;
  const target = (grow: number) => Math.max(10, width - 2 * grow - 2 * border);
  const solve = (l: Laid, em: number) => clamp((em * target(l.grow)) / Math.max(l.width, 1e-6), 4, 400);
  const probe = await lay(PROBE_EM, pct);
  let em = solve(probe, PROBE_EM);
  let laid = await lay(em, pct);
  // The 2 mm floor, measured on the real outlines plus the bold the engine will add. One
  // correction: ask for the missing half-millimetre on each side and let the engine cap it at
  // what the counters can spare — a face that still cannot reach 2 mm is warned about below.
  const inkOf = (l: Laid) => thinnestStroke(l.lines.flat()) + 2 * l.grow;
  const thin = inkOf(laid);
  if (thin < MIN_STROKE && em > 0) {
    pct += (MIN_STROKE - thin) / (2 * em);
    laid = await lay(em, pct);
  }
  for (let pass = 0; pass < 2 && Math.abs(laid.width - target(laid.grow)) > 0.2 && laid.width > 0.1; pass++) {
    em = solve(laid, em);
    laid = await lay(em, pct);
  }
  // Width is the size the customer sets — but a width solve has no ceiling on the HEIGHT, and a
  // narrow design goes tall without limit: a single "1" (an age topper, the commonest one-line
  // order there is) came out 85 × 290 mm of lettering above the stick, a slab no cake carries
  // (2026-09-26 audit). So the lettering is never taller than the width asked for; a design that
  // hits this is simply narrower than the slider, the way a tall word on a keychain is.
  const tallest = Math.max(10, width - 2 * border);
  const artH = (() => { const b = bboxOf(laid.islands); return b.maxY - b.minY; })();
  if (artH > tallest + 0.2) {
    em = clamp((em * tallest) / artH, 4, 400);
    laid = await lay(em, pct);
  }

  // The artwork, centred on the origin as one block; the stick hangs below it.
  const box = bboxOf(laid.islands);
  const dx = -(box.minX + box.maxX) / 2;
  const dy = -(box.minY + box.maxY) / 2;
  const letters = placeShapes(laid.islands, dx, dy, 0);
  const bottomLine = placeShapes(laid.lines[laid.lines.length - 1] ?? [], dx, dy, 0);
  const art = bboxOf(letters);

  // ---- the stick -------------------------------------------------------------------------
  // ONE, centred, and seated where the BOTTOM line has material right across its width — the
  // underside of a word is not a straight line, and a stick on the bbox floor meets air between
  // two letters. The search walks outwards from the centre and stops at the first full seat, so
  // the stick is as central as a real weld allows.
  const half = stickW / 2;
  let seat: { cx: number; floor: number; span: number; coverage: number } | null = null;
  for (let d = 0; d <= 0.45 * (art.maxX - art.minX) && !(seat && seat.coverage >= 0.999); d += 0.5) {
    for (const s of d === 0 ? [0] : [-d, d]) {
      const found = legSeat(bottomLine, s - half, s + half);
      if (found && (!seat || found.coverage > seat.coverage + 1e-6)) seat = { cx: s, ...found };
      if (seat && seat.coverage >= 0.999) break;
    }
  }
  const sticks: Shapes = [];
  // How much lettering the stick is welded to. Every column of the stick that has material above
  // it is welded to it — the stick's top is at or above that column's underside by construction —
  // so the share of its width that found material IS the weld's width. With a backer the joint is
  // the offset one: the border grows the stick and the letters into each other by `border` a side.
  const contact = seat ? seat.coverage * stickW + 2 * border : 0;
  if (seat) {
    // The weld bites 90 % of the way through the stroke it meets, never more than 8 mm — past
    // that the stick reads as a spike driven THROUGH the lettering rather than grown out of it.
    const bite = Math.max(2, Math.min(0.9 * seat.span, 8));
    // The taper is measured on the FINISHED stick, and with a backer the drawn apex sits one
    // border above the finished tip so the offset lands the point where the slider says. An
    // offset rounds a convex corner by its own radius, so the two-layer stick ends in a small
    // nose rather than a needle — 3 mm of shadow line cannot be a point, and the alternative
    // (drawing the stick at full width and letting the border add 6 mm to it) makes the slider
    // lie about the piece that goes into the cake.
    const point = Math.min(2.2 * (stickW + 2 * border), 0.25 * stickLen);
    sticks.push([stickRing(seat.cx, seat.floor + bite, art.minY - stickLen + border, stickW, point)]);
  }

  // ---- what the piece has to say -----------------------------------------------------------
  const warnings: string[] = [];
  const ink = thinnestStroke(laid.lines.flat()) + 2 * laid.grow;
  if (ink < MIN_STROKE) warnings.push(`Thinnest stroke ${ink.toFixed(1)} mm — under ${MIN_STROKE} mm it snaps. Pick a fatter font, or make the topper wider.`);
  const speck = smallestIsland(letters) + 2 * laid.grow;
  if (speck < MIN_STROKE) warnings.push(`The smallest piece is ${speck.toFixed(1)} mm across — pick a fatter font so it survives the cut.`);
  if (!seat) warnings.push('The stick has nothing to hold onto — try a shorter bottom line.');
  else if (contact < MIN_CONTACT) warnings.push(`The stick is welded to ${contact.toFixed(1)} mm of lettering — under ${MIN_CONTACT} mm it can snap off. Make the topper wider.`);
  warnings.push(...countersTooTight(letters));

  // ---- the pieces ---------------------------------------------------------------------------
  // The lettering IS the outline, never a line the laser follows. The seams are a SECOND copy of
  // the same per-glyph islands, scored only where a later letter — or the next line — buries an
  // earlier one (G33).
  const lettering = (): DesignLayer => ({ id: 'letters', label: 'Lettering', shapes: letters, op: 'off', hugOnly: true, grow: laid.grow });
  const seams: DesignLayer[] = scored ? [{ id: 'letters-seam', label: 'Letter seams', shapes: letters, op: 'score', seams: true, grow: laid.grow, glyphIslands: laid.glyphIslands }] : [];
  const stick: DesignLayer[] = sticks.length ? [{ id: 'stick', label: 'Stick', shapes: sticks, op: 'off', hugOnly: true }] : [];
  // A counter under 2 mm across is a hairline ring nobody wants and the laser rounds shut anyway.
  // Margin 0 and no smoothing: the piece IS the letters (G33).
  const lettersBlank: Blank = { kind: 'hug', margin: 0, smoothing: 0, bridge: BRIDGE, counters: 'open', minHole: MIN_STROKE };

  if (!backer) {
    return {
      blank: lettersBlank,
      keyring: noRing(),
      layers: [lettering(), ...seams, ...stick],
      ...(warnings.length ? { warnings } : {}),
    };
  }
  // Two layers: a light backer
  // following the letters at BORDER, carrying the stick, and the dark lettering raised on it.
  // The top layer carries nothing — no stick, no hole (§4.2). Both pieces are the same outlines
  // at a different offset, so they register by construction; `assembledAt: 'built'` undoes the
  // sheet layout and puts the lettering back in the backer's frame for the 3D view and the card.
  const parts: PartInput[] = [{
    id: 'text',
    label: 'Lettering · colour 2',
    blank: lettersBlank,
    layers: [lettering(), ...seams],
    keyring: 'none',
    assembledAt: 'built',
    material: 'dark',
    z: 2,
  }];
  return {
    label: 'Backer · colour 1',
    material: 'light',
    // A backer is a silhouette, not lettering: counters filled, and the notch the offset leaves
    // between two letters rounded by the same 0.35 × border the framed ornaments use.
    blank: { kind: 'hug', margin: BORDER, smoothing: 0.35 * BORDER, bridge: Math.max(BRIDGE, BORDER), counters: 'filled' },
    keyring: noRing(),
    layers: [lettering(), ...stick],
    parts,
    // Two colours of sheet, so nesting them buys nothing: the reading order is the exploded
    // stack, the backer above the piece that lands on it.
    layout: { flow: 'column', gap: 5 },
    status: '2 pieces · cut each from its own colour',
    ...(warnings.length ? { warnings } : {}),
  };
}

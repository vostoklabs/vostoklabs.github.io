import { readSymbols } from '../symbols/model';
// A round coaster — or, with the ribbon hole turned on, an ornament — whose lettering follows
// the disc instead of ignoring it: a headline curving along the top rim, a name, monogram or
// symbol in the middle, a second line curving along the bottom rim that reads upright rather
// than upside-down, and a small mark at each seam where the two curves meet.
//
// How it is built:
//
// · The disc is one ring — a plain circle, or the scalloped rim from arc-coaster-scallop.ts.
// · Both arcs are one `arcTextLayer` call each. The bottom one is `direction: 'inside'` at
//   270°, which is the engine's own way of setting a bottom arc reversed, and the only reason
//   it reads the right way up. That also makes the two arcs asymmetric on purpose: the top
//   reaches toward the rim, the bottom reaches toward the middle.
// · Every radius is a fraction of R: top baseline 0.76R, bottom 0.71R, centre reserve 0.50R.
// · Only the top arc has anything above it, so only the top arc is clamped to a radial budget
//   — the edge treatment, or the ribbon hole resting at the same 12 o'clock the arc is centred
//   on; the tighter of the two wins. The baseline gives way first, then the cap height shrinks
//   toward a 4 mm floor until the string fits 140° of arc, then it warns.
import { bboxOf, circleRing, placeShapes, polygonRing, starRing, type Pt, type Shapes } from '@vostok/laser';
import { FONTS } from '@vostok/fonts';
import { boxCentre } from '@vostok/shapes';
import { applyCase, arcTextLayer, glyphLayers, symbolLayer, textLayer, type TextSpec } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import { finalHoleCentre, fitBoxInside, holdInside, holeTrack } from '../engine/editorGeometry';
import type { DesignLayer, KeyringSpec, OpChoice } from '../engine/types';
import { fitScallopRing } from './arc-coaster-scallop';
import { hangHoleFields, NO_KEYRING } from './keyring';
import { letteringFields, opField, opOf, stem } from './shared';
import { bool, num, str, type Field, type TemplateDef } from './types';

/** Fractions of the outer radius. */
const TOP_RATIO = 0.76;
/** The nominal top less 0.05R — kept off whatever the top's edge clamp lands on, so the
 *  bottom arc's placement never moves because of a decision about the rim. */
const BOTTOM_RATIO = 0.71;
const CENTRE_RATIO = 0.5;
/** The smallest arc lettering this design will draw, mm of cap height. */
const CAP_FLOOR = 4;
/** The safe headline span, the midpoint of the sourced 120–160° band. */
const ARC_SPAN = (140 * Math.PI) / 180;
/** The cap height a script face survives at. Under this its strokes are thinner than the burn
 *  and it closes up on a curve. */
const SCRIPT_FLOOR = 5;

/** The two inset radii of the double rule, as insets from the rim (§2.4). `stroke` only ever
 *  sets the gap: a score is a hairline on the machine, not a drawn stroke. */
function doubleRule(d: number) {
  const stroke = Math.max(0.8, 0.01 * d);
  const outerInset = 0.04 * d;
  return { stroke, outerInset, innerInset: outerInset + 3 * stroke };
}

/**
 * The disc's outline: a plain circle, or the scalloped rim from arc-coaster-scallop.ts.
 *
 * `@vostok/laser`'s own `scallop-disc` blank is deliberately not used. As it landed it fixes
 * the bump count at 16 and takes the piece's size from the bump radius alone, ignoring width
 * and height — which would leave this template's Diameter slider doing nothing in scalloped
 * mode and put a 16 mm bump on a 100 mm disc, outside the 6–20 mm bump band.
 */
function discShapes(d: number, scalloped: boolean): Shapes {
  if (!scalloped) return [[circleRing(0, 0, d / 2, 128)]];
  // The 6–20 mm bump band written as one formula, so there is no seam at any diameter.
  // The 6 mm floor is also what keeps the arc radius over the 3 mm that cuts cleanly in ply.
  return [[fitScallopRing(d, Math.min(Math.max(0.08 * d, 6), 14))]];
}

/** How far a built layer's ink actually reaches from the centre, mm — the measurement the radial
 *  budget is a prediction of. */
function reachOf(layers: DesignLayer[]): number {
  let hi = 0;
  for (const l of layers) for (const island of l.shapes) for (const ring of island) for (const [x, y] of ring) hi = Math.max(hi, Math.hypot(x, y));
  return hi;
}

/** How close to the centre the rim ever comes: R on a plain disc, the dip between two
 *  scallops on a scalloped one. Content has to clear this, not the crest. */
function innerRadius(shapes: Shapes): number {
  let lo = Infinity;
  for (const island of shapes) for (const ring of island) for (const [x, y] of ring) lo = Math.min(lo, Math.hypot(x, y));
  return Number.isFinite(lo) ? lo : 0;
}

/** One seam mark, centred on the origin. `polygonRing`'s own default rotation already puts
 *  points at N/E/S/W, which is a diamond rather than a square. */
function markShapes(kind: string, size: number): Shapes | null {
  const s = Math.max(0.6, size);
  if (kind === 'dot') return [[circleRing(0, 0, s / 2, 24)]];
  if (kind === 'diamond') return [[polygonRing(s, s, 4)]];
  if (kind === 'star') return [[starRing(s, s, 4, 0.45)]];
  return null;
}

function scaleAbout(shapes: Shapes, c: Pt, k: number): Shapes {
  return shapes.map((island) => island.map((ring) => ring.map(([x, y]): Pt => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k])));
}

/**
 * One arc of text at a wanted cap height, shrunk until it fits `ARC_SPAN` and no further than
 * the 4 mm floor.
 *
 * Measured, not stepped by character count: `glyphLayers` lays the run out with the very
 * advances `arcTextLayer` will use, and an advance scales exactly linearly with the size, so
 * the size that fits is one division rather than a table or a search.
 */
async function arcText(
  spec: Omit<TextSpec, 'size'>,
  capMm: number,
  radius: number,
  centreAngle: number,
  direction: 'outside' | 'inside',
  op: OpChoice,
  id: string,
  label: string,
): Promise<{ layers: DesignLayer[]; long: boolean }> {
  if (!spec.text.trim()) return { layers: [], long: false };
  const size = await sizeForCapHeight(spec.font, capMm);
  const run = await glyphLayers({ ...spec, size });
  const span = run.reduce((a, g) => a + g.advance, 0) / Math.max(radius, 1e-3);
  let cap = capMm;
  let long = false;
  if (span > ARC_SPAN) {
    const wanted = capMm * (ARC_SPAN / span);
    cap = Math.max(CAP_FLOOR, wanted);
    // Below the floor the line is drawn at 4 mm and allowed to run wider than the safe band:
    // shrinking further would be unreadable, so the status line says so instead.
    long = wanted < CAP_FLOOR;
  }
  const fitted = cap === capMm ? size : await sizeForCapHeight(spec.font, cap);
  return { layers: await arcTextLayer({ ...spec, size: fitted, radius, centreAngle, direction }, op, id, label), long };
}

/**
 * The centre-enlarged three-letter monogram: the surname
 * initial in the middle at full size, the flanks at 0.65×, every letter centred on the middle
 * one's midline rather than sharing a baseline — baseline-aligned flanks read as sunken.
 *
 * One or two initials have no surname to mark, so the convention does not apply and they are
 * simply set at one size.
 */
async function monogramLayers(initials: string, cap: number, base: Omit<TextSpec, 'text' | 'size'>, op: OpChoice): Promise<DesignLayer[]> {
  const chars = Array.from(initials.trim()).slice(0, 3);
  if (!chars.length) return [];
  if (chars.length < 3) return textLayer({ ...base, text: chars.join(''), size: await sizeForCapHeight(base.font, cap) }, op, 'centre', 'Monogram');
  const caps = [0.65 * cap, cap, 0.65 * cap];
  const built = await Promise.all(
    chars.map(async (c, i) => (await textLayer({ ...base, text: c, size: await sizeForCapHeight(base.font, caps[i]!) }, op, 'centre', 'Monogram'))[0]),
  );
  return [...rowLayer(built, 0.12 * cap, op, 'Monogram')];
}

/**
 * A year split either side of the centre symbol — "20 ✦ 15" — the one composition none of the
 * other three centre modes can reach (Name mode cannot put anything on both sides of a mark).
 *
 * The flanks are set at the monogram's own 0.65 ratio, so the emblem stays the dominant mark and
 * the two modes look like they belong to one design.
 */
async function emblemLayers(
  a: string,
  b: string,
  symbol: string,
  cap: number,
  base: Omit<TextSpec, 'text' | 'size'>,
  op: OpChoice,
  symbols: TextSpec['symbols'],
): Promise<DesignLayer[]> {
  const flankSize = await sizeForCapHeight(base.font, 0.65 * cap);
  const [left, mark, right] = await Promise.all([
    textLayer({ ...base, text: a.trim(), size: flankSize }, op, 'centre', 'Year').then((l) => l[0]),
    symbolLayer(symbol, cap, op, { symbols }, 'centre').then((l) => l[0]),
    textLayer({ ...base, text: b.trim(), size: flankSize }, op, 'centre', 'Year').then((l) => l[0]),
  ]);
  return [...rowLayer([left, mark, right], 0.18 * cap, op, 'Year and emblem')];
}

/** Several built pieces laid left to right with `gap` between them, every piece centred on the
 *  row's midline rather than sharing a baseline — baseline-aligned flanks read as sunken.
 *  Empty pieces simply are not there. */
function rowLayer(built: (DesignLayer | undefined)[], gap: number, op: OpChoice, label: string): DesignLayer[] {
  const pieces = built.filter((l): l is DesignLayer => !!l && l.shapes.length > 0);
  if (!pieces.length) return [];
  const boxes = pieces.map((l) => bboxOf(l.shapes));
  const widths = boxes.map((b) => b.maxX - b.minX);
  const total = widths.reduce((a, w) => a + w, 0) + gap * (pieces.length - 1);
  const shapes: Shapes = [];
  let x = -total / 2;
  for (let i = 0; i < pieces.length; i++) {
    const c = boxCentre(boxes[i]!);
    shapes.push(...placeShapes(pieces[i]!.shapes, x + widths[i]! / 2 - c[0], -c[1], 0));
    x += widths[i]! + gap;
  }
  return [{ id: 'centre', label, shapes, op }];
}

export const arcCoaster: TemplateDef = {
  id: 'arc-coaster',
  name: 'Arc coaster',
  blurb: 'Text curves around the rim of a coaster or ornament, with a name or monogram in the middle.',
  tags: ['gift', 'home', 'engrave + score + cut'],
  fields: [
    // ------------------------------------------------------------ RIGHT: what you type --
    {
      kind: 'text', key: 'topText', label: 'Top text', panel: 'right', section: 'Text',
      value: 'THE MILLERS', placeholder: 'A family name or motto', maxLength: 24, symbols: true,
    },
    // What goes in the middle — right above the fields it brings up, on the side where you type
    // them. On the left it was a switch whose effect happened in the other panel.
    {
      kind: 'select', key: 'centreMode', label: 'Centre style', panel: 'right', section: 'Text',
      value: 'monogram',
      options: [
        { value: 'monogram', label: 'Monogram' },
        { value: 'name', label: 'Name' },
        { value: 'symbol', label: 'Symbol' },
        { value: 'emblem', label: 'Split year' },
      ],
      help: 'What sits in the middle of the coaster.',
    },
    {
      kind: 'text', key: 'centreText', label: 'Centre text', panel: 'right', section: 'Text',
      value: 'Miller', placeholder: 'A name', maxLength: 16, symbols: true,
      visibleWhen: (v) => str(v, 'centreMode') === 'name',
    },
    {
      kind: 'text', key: 'initials', label: 'Initials', panel: 'right', section: 'Text',
      value: 'EMR', placeholder: 'e.g. EMR', maxLength: 3, symbols: false,
      help: 'Type first, surname, then middle, the surname shows larger.',
      visibleWhen: (v) => str(v, 'centreMode') === 'monogram',
    },
    {
      kind: 'text', key: 'yearA', label: 'Left of the symbol', panel: 'right', section: 'Text',
      value: '20', placeholder: '20', maxLength: 4, symbols: false,
      visibleWhen: (v) => str(v, 'centreMode') === 'emblem',
    },
    {
      kind: 'symbol', key: 'centreSymbol', label: 'Symbol', panel: 'right', section: 'Text',
      value: '',
      visibleWhen: (v) => str(v, 'centreMode') === 'symbol' || str(v, 'centreMode') === 'emblem',
    },
    {
      kind: 'text', key: 'yearB', label: 'Right of the symbol', panel: 'right', section: 'Text',
      value: '24', placeholder: '24', maxLength: 4, symbols: false,
      visibleWhen: (v) => str(v, 'centreMode') === 'emblem',
    },
    {
      kind: 'text', key: 'bottomText', label: 'Bottom text', panel: 'right', section: 'Text',
      value: 'EST. 2024', placeholder: 'EST. 2024', maxLength: 24, symbols: true,
    },
    {
      kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font',
      value: 'playfair-display',
      // Faces that hold a 6 mm capital on a curve and still carry a 32 mm monogram: two of the
      // library's Roman-capital serifs, its two book serifs, and three geometric/condensed sans
      // that set caps well. Every one built and looked at on this disc before it was listed.
      recommended: ['playfair-display', 'cinzel', 'marcellus', 'libre-baskerville', 'montserrat', 'oswald', 'bebas-neue'],
    },

    // ------------------------------------------------ LEFT: "Shape & size" (opens first) --
    {
      kind: 'number', key: 'diameter', label: 'Diameter', section: 'Shape & size',
      value: 100, min: 60, max: 130, step: 1, unit: 'mm',
      help: 'Overall size, 95 to 100 mm for a coaster or 80 mm for an ornament.',
    },
    {
      kind: 'select', key: 'edge', label: 'Edge', section: 'Shape & size',
      value: 'double',
      options: [
        { value: 'plain', label: 'Plain' },
        { value: 'double', label: 'Double rule' },
        { value: 'scalloped', label: 'Scalloped' },
      ],
      help: 'Double rule and Scalloped can shrink the top text a little.',
    },

    // -------------------------------------------------------------------- LEFT: "Centre" --
    {
      kind: 'number', key: 'centreSize', label: 'Centre size', section: 'Centre',
      // The floor sits just above Top/Bottom text size's own ceiling (14 mm), so the middle mark
      // can never end up the same weight as the lines curving round it — the two-tier hierarchy
      // this design is built on is a range, not just a lucky default.
      value: 32, min: 16, max: 45, step: 0.5, unit: 'mm',
      help: 'Stays bigger than the curved top and bottom text.',
    },
    {
      kind: 'toggle', key: 'fitCentre', label: 'Shrink to fit', section: 'Centre',
      value: true,
      help: 'Off draws it at full size, even if it crowds the text.',
    },

    // ----------------------------------------------------------------- LEFT: "Lettering" --
    {
      kind: 'number', key: 'topSize', label: 'Top text size', section: 'Lettering',
      value: 6, min: 4, max: 14, step: 0.5, unit: 'mm',
      help: 'Long text shrinks itself down to 4 mm before it runs out of room.',
    },
    {
      kind: 'number', key: 'bottomSize', label: 'Bottom text size', section: 'Lettering',
      value: 6, min: 4, max: 14, step: 0.5, unit: 'mm',
      help: 'Reads upright rather than upside down, and shrinks the same way.',
    },
    {
      kind: 'select', key: 'divider', label: 'Divider', section: 'Lettering',
      value: 'diamond',
      options: [
        { value: 'none', label: 'None' },
        { value: 'dot', label: 'Dot' },
        { value: 'diamond', label: 'Diamond' },
        { value: 'star', label: 'Star' },
      ],
      help: 'A small mark where the top and bottom text meet, at 3 and 9 o’clock.',
    },
    // Cut out is back (2026-09-21). It was withdrawn because "THE MILLERS · EMR · EST. 2024"
    // came off the bed in three pieces, two of them the middles of two R's: a serif draws its R
    // as overlapping contours, so the counter exists only in their union, and the engine's
    // stencil step skipped any layer whose islands had no hole of their own. That was the
    // engine's bug, not this design's — `stencilBridge` no longer pre-judges and `stencilPunch`
    // unions before it looks. The same default now cuts as one island.
    opField('Lettering', 'engrave', 'Letters', { help: 'Also sets the divider mark, cut keeps letter middles on bridges.' }),
    // G7's shared typographic knobs, in the section they belong to.
    ...letteringFields('Lettering', { textCase: 'upper' }).map((f): Field => {
      if (f.kind === 'number' && f.key === 'letterSpacing') {
        // Deliberately still 0. Opening arc caps a few percent looks better on a short line — but
        // the field's own 24-character maximum then runs past the
        // 140° safe band and warns, at an input the form itself allows. The knob is here; the
        // default protects the shrink-then-warn calibration.
        return { ...f, help: 'A few percent opens a short headline on the curve.' };
      }
      if (f.kind === 'select' && f.key === 'textCase') {
        return { ...f, help: 'Only changes the curved lines, not the centre text.' };
      }
      return f;
    }),

    // ------------------------------------------------------ LEFT: "Hanging" (the design's own) --
    // The shared Ring control is Loop tab | None since 2026-09-21; a coaster that hangs
    // is an ornament with a hole INSIDE its rim at 12 o'clock, so the hole is this design's own
    // (`hangHoleFields`: on/off + size, no drag), off by default — a coaster does not hang.
    ...hangHoleFields('Hanging', { dia: 3, maxDia: 5, label: 'Ribbon hole' }).map((f) =>
      f.key === 'hangHole' ? ({ ...f, value: false, help: 'Rests at 12 o’clock, where it can shrink the top text.' } as Field) : f),
  ],

  async build(v) {
    const d = num(v, 'diameter');
    const r = d / 2;
    const edge = str(v, 'edge');
    // The coercion that opened a saved `op: 'cut'` engraved is gone with the withdrawal it
    // existed for: the option is on the control again, so a project carrying it — from before
    // the withdrawal or from after it — opens as what it says, and its counters hold.
    const op: OpChoice = opOf(v);
    const font = str(v, 'font');
    const symbols = readSymbols(v);
    // The shared knob is a percentage of the letter height (G7); `TextSpec` wants a fraction.
    const letterSpacing = num(v, 'letterSpacing') / 100;
    const textCase = str(v, 'textCase');
    const shapes = discShapes(d, edge === 'scalloped');
    // The ribbon hole: Ø `holeDia` with RIBBON_WALL of rim outside it, resting at 12 o'clock and
    // held inside the real outline — on a scalloped rim that is the dip beside the crest, which
    // is why it is measured off the shapes rather than assumed at R − wall − dia/2.
    const RIBBON_WALL = 2;
    const holeDia = num(v, 'holeDia');
    const keyring: KeyringSpec = bool(v, 'hangHole')
      ? {
          ...NO_KEYRING, enabled: true, mode: 'inside', dia: holeDia, ring: RIBBON_WALL,
          rest: holdInside(shapes, [0, r - RIBBON_WALL - holeDia / 2], holeDia / 2 + RIBBON_WALL, holeTrack(shapes, { mode: 'inside', side: 'top', along: 0.5, dia: holeDia, ring: RIBBON_WALL })),
        }
      : NO_KEYRING;

    // --------------------------------------------- what the top arc is allowed to reach to --
    // Content clears the true edge by the standard margin; the edge treatment and the ribbon
    // hole each impose their own ceiling on `topR + cap`, and the tighter one wins.
    const margin = Math.max(3.2, 0.035 * d);
    const rule = doubleRule(d);
    // Measured off the rim rather than off R: a tangent-scallop envelope dips to R_c·cos(π/n)
    // between crests — a real 4.2 mm at D = 100, not a negligible 0.015 mm — and text that
    // cleared only the crest would be silently clipped at every seam.
    let budget = innerRadius(shapes) - margin;
    // A loop tab sits outside the body and a "None" ring is not there at all: neither claims any
    // of this. A hole does — and it is measured, not assumed to rest at R: on a scalloped rim it
    // settles into a dip 3.5 mm further in, which a crest-only formula would miss, and on a disc it
    // may have been dragged anywhere at all. On a plain rim this is R exactly, as it always was.
    const holeR = keyring.enabled && keyring.mode === 'inside' ? Math.hypot(...finalHoleCentre(shapes, keyring).centre) : Infinity;
    if (Number.isFinite(holeR)) budget = Math.min(budget, holeR - keyring.dia / 2 - margin);
    // The rules are drawn INSIDE the hole for the same reason the text is. A full-diameter circle
    // and a hole on the rim always cross, and a score line running into a punched hole is both
    // ugly and what trips the engine's ring-on-the-lettering net on an ornament.
    const ruleOuterR = Math.min(r - rule.outerInset, holeR - keyring.dia / 2 - keyring.ring - 0.5);
    const ruleInnerR = ruleOuterR - 3 * rule.stroke;
    if (edge === 'double') budget = Math.min(budget, ruleInnerR - 2.5);

    const centreR = CENTRE_RATIO * r;
    const topReq = num(v, 'topSize');
    const bottomReq = num(v, 'bottomSize');
    let capTop = topReq;
    let topR = Math.min(TOP_RATIO * r, budget - capTop);
    if (topR < centreR) {
      // The baseline has given up everything it can without landing in the centre reserve;
      // the cap height is what gives next, and it has its own floor below this.
      capTop = Math.max(CAP_FLOOR, budget - centreR);
      topR = Math.max(centreR, budget - capTop);
    }
    topR = Math.max(2, topR);
    const bottomR = BOTTOM_RATIO * r;

    // ------------------------------------------------------------------------- the arcs --
    const base = { symbols, font, letterSpacing };
    const topText = applyCase(str(v, 'topText'), textCase);
    let top = await arcText({ ...base, text: topText }, capTop, topR, 90, 'outside', op, 'arc-top', 'Top text');
    // What the budget PROMISED was `topR + cap`; what a letter set on a curve actually reaches is
    // its top corners, a little further out — and on a plain or scalloped rim there is no rule to
    // hide behind, so "keep 3–5 mm inside the outline" quietly became 2.85 mm at the biggest cap.
    // Measure the ink and pull the baseline in once, rather than trusting the estimate.
    const reach = reachOf(top.layers);
    if (reach > budget + 1e-6 && topR > centreR) {
      topR = Math.max(centreR, topR - (reach - budget));
      top = await arcText({ ...base, text: topText }, capTop, topR, 90, 'outside', op, 'arc-top', 'Top text');
    }
    const bottom = await arcText({ ...base, text: applyCase(str(v, 'bottomText'), textCase) }, bottomReq, bottomR, 270, 'inside', op, 'arc-bottom', 'Bottom text');

    // ---------------------------------------------------------------- the centre content --
    const centreCap = num(v, 'centreSize');
    const mode = str(v, 'centreMode');
    let centre: DesignLayer[] =
      mode === 'monogram'
        ? await monogramLayers(str(v, 'initials'), centreCap, base, op)
        : mode === 'symbol'
          ? await symbolLayer(str(v, 'centreSymbol'), centreCap, op, { symbols }, 'centre')
          : mode === 'emblem'
            ? await emblemLayers(str(v, 'yearA'), str(v, 'yearB'), str(v, 'centreSymbol'), centreCap, base, op, symbols)
            : await textLayer({ ...base, text: str(v, 'centreText'), size: await sizeForCapHeight(font, centreCap) }, op, 'centre', 'Centre');

    // The centre keeps to the inner half of the radius: that band of bare material is what
    // stops this reading as a monogram engraved to the full diameter.
    let centreOver = false;
    const drawn = centre.flatMap((l) => l.shapes);
    if (drawn.length) {
      const b = bboxOf(drawn);
      const c = boxCentre(b);
      const half: Pt = [(b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2];
      const k = fitBoxInside([[circleRing(0, 0, centreR, 64)]], c, half, 2, null);
      if (k < 0.999) {
        if (bool(v, 'fitCentre')) centre = centre.map((l) => ({ ...l, shapes: scaleAbout(l.shapes, c, k) }));
        else centreOver = true;
      }
    }

    // ------------------------------------------------------- seams and the edge treatment --
    // At the midpoint of the two baselines AS BUILT, sized against the two cap heights as
    // asked for — a divider that shrank with the text would not stay the accent it is.
    const mark = markShapes(str(v, 'divider'), 0.4 * Math.min(topReq, bottomReq));
    const markR = (topR + bottomR) / 2;
    const dividers: DesignLayer[] = mark
      ? [{ id: 'dividers', label: 'Divider marks', shapes: [...placeShapes(mark, markR, 0, 0), ...placeShapes(mark, -markR, 0, 0)], op }]
      : [];

    // Always a score, whatever Letters is set to: a full-diameter ring set to Cut would take
    // the coaster in two.
    const rules: DesignLayer[] =
      edge === 'double'
        ? [
            { id: 'rule-outer', label: 'Outer rule', shapes: [[circleRing(0, 0, ruleOuterR, 160)]], op: 'score' },
            { id: 'rule-inner', label: 'Inner rule', shapes: [[circleRing(0, 0, ruleInnerR, 160)]], op: 'score' },
          ]
        : [];

    const warnings: string[] = [];
    if (top.long) warnings.push('Top text is long for this size — try a shorter line, or a bigger coaster.');
    if (bottom.long) warnings.push('Bottom text is long for this size — try a shorter line, or a bigger coaster.');
    if (centreOver) warnings.push('The centre content is bigger than the middle — turn Shrink to fit back on, or make it smaller.');
    // This check was meant to be shared; it never was, and two sibling templates each
    // grew their own. A script's strokes are a fraction of its cap height, and a curve is where
    // they close up first — so the floor is on the cap, not on the string.
    const face = FONTS.find((f) => f.id === font);
    const smallestCap = Math.min(capTop, bottomReq);
    if (face && (face.category === 'Script' || face.category === 'Handwriting') && smallestCap < SCRIPT_FLOOR) {
      warnings.push(
        `${face.label} is a script face — its thin strokes merge or burn away on a curve at ${smallestCap.toFixed(1)} mm. Raise the text size to ${SCRIPT_FLOOR} mm, or pick a serif or a sans.`,
      );
    }

    return {
      blank: { kind: 'shape', shapes },
      keyring,
      layers: [...centre, ...top.layers, ...bottom.layers, ...dividers, ...rules],
      ...(warnings.length ? { warnings } : {}),
    };
  },

  fileName: (v) =>
    stem(
      str(v, 'centreMode') === 'monogram' ? str(v, 'initials') : str(v, 'centreMode') === 'name' ? str(v, 'centreText') : str(v, 'topText'),
      bool(v, 'hangHole') ? 'ornament' : 'coaster',
    ),
};

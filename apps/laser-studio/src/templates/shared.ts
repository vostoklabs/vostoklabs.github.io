// What more than one design needs. The rule from keyring.ts holds here: a template file says
// what makes it that design, and anything two designs both say lives in this file.
//
// Most of the library is one idea wearing different silhouettes — a shape, some lettering on
// it, a hole. `shapeFields` + `blankShapes` + `fitText` are that idea; a template supplies the
// defaults, the labels and the one knob that makes it itself.
import { bboxOf, blankById, blankDetail, buildBlank, circleRing, cornerLabel, placeShapes, textBoxOf, type BlankCategory, type BlankParams, type Box, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { pointInRing } from '@vostok/patterns';
import { MIN_COUNTER, smallestCounter, textLayer, type ConnectSpec, type TextSpec } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import { finalHoleCentre, fitBoxInside, insideUnion } from '../engine/editorGeometry';
import type { DesignLayer, KeyringSpec, OpChoice } from '../engine/types';
import { rimWidthFor } from '../engine/frame';
import { keyringFields } from './keyring';
import { bool, num, str, type Field, type Values } from './types';

// ------------------------------------------------------- keeping a mark off something --

/**
 * Everything of `layers` that stays out of `box`.
 *
 * A keep-out applied to a fill's OUTPUT rather than to the region handed to it. Passing the
 * exclusion as a hole in the region is the tidier idea and it is not reliable when the thing to
 * avoid touches the piece's edge — a slot that opens on the edge shares a boundary with the
 * outer ring, and the even-odd test the clipper uses goes wrong exactly there. Measured on the
 * phone stand: the pattern still touched the slot at 0 mm with a 3 mm hole in the region, and at
 * 0.4 mm with an 8 mm one.
 *
 * A closed shape is dropped WHOLE if it meets the box — half a hexagon is not a hexagon. An open
 * run is SPLIT at the box instead, because a scored line that stops short of the joint is
 * exactly what is wanted and it leaves no stub behind.
 *
 * A LATTICE cut (`DesignLayer.lattice`) carries its region, not its holes — the worker cuts the
 * faces — so the box joins its solids instead: no face is cut inside it, exactly, by a boolean,
 * and a strut that reaches it is held by it.
 */
export function keepOff(layers: DesignLayer[], box: Box): DesignLayer[] {
  const out = ([x, y]: [number, number]) => x < box.minX || x > box.maxX || y < box.minY || y > box.maxY;
  return layers
    .map((l) => {
      if (l.lattice) return { ...l, minus: [...(l.minus ?? []), [[[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]] as [number, number][]]] };
      const shapes = l.shapes.filter((island) => island.every((ring) => ring.every(out)));
      const paths: [number, number][][] = [];
      for (const run of l.paths ?? []) {
        let cur: [number, number][] = [];
        for (const p of run) {
          if (out(p)) cur.push(p);
          else {
            if (cur.length > 1) paths.push(cur);
            cur = [];
          }
        }
        if (cur.length > 1) paths.push(cur);
      }
      return { ...l, shapes, ...(l.paths ? { paths } : {}) };
    })
    .filter((l) => l.shapes.length || (l.paths?.length ?? 0));
}

// ------------------------------------------------------------- the shape --

export interface ShapeFieldOpts {
  /** The blank this design opens on. */
  value: string;
  /** Which shelves of the library the picker offers. */
  categories?: BlankCategory[];
  width: number;
  height: number;
  corner?: number;
  /** Slider ceilings — a bookmark and a porch sign are not the same order of size. */
  maxWidth?: number;
  maxHeight?: number;
  minWidth?: number;
  minHeight?: number;
  /** The corner slider's own ends. A generic 0…30 mm reaches a pill on most parts and a
   *  razor-sharp corner at the other end, so a design that knows its own proportions says so:
   *  the house rule is a maximum of 45 % of the part's SHORT side (G25),
   *  computed from this design's own defaults rather than left as one constant for every part
   *  from a 24 mm tag to a 200 mm plaque. A slot or a notch near a corner needs tighter still. */
  minCorner?: number;
  maxCorner?: number;
  section?: string;
  label?: string;
}

/** The shape picker and its size sliders: the trio most designs share. */
export function shapeFields(o: ShapeFieldOpts): Field[] {
  const section = o.section ?? 'Shape & size';
  return [
    {
      kind: 'blank', key: 'blank', label: o.label ?? 'Shape', section, value: o.value,
      ...(o.categories ? { categories: o.categories } : {}),
      linked: { width: 'width', height: 'height', corner: 'corner' },
    },
    { kind: 'number', key: 'width', label: 'Width', section, value: o.width, min: o.minWidth ?? 10, max: o.maxWidth ?? 300, step: 1, unit: 'mm' },
    { kind: 'number', key: 'height', label: 'Height', section, value: o.height, min: o.minHeight ?? 10, max: o.maxHeight ?? 300, step: 1, unit: 'mm' },
    {
      kind: 'number', key: 'corner', label: 'Corner radius', section, value: o.corner ?? 4,
      min: o.minCorner ?? 0, max: o.maxCorner ?? 30, step: 0.5, unit: 'mm',
      // The slider is dead on a shape with no corners — a star, a circle — so it is not shown.
      visibleWhen: (v) => { const d = blankById(str(v, 'blank')); return !!d && cornerLabel(d) === 'Corner radius'; },
    },
    {
      // What tells a football from a plain oval, a cat from a circle with ears. Hidden for the
      // blanks that carry no marks of their own, because a switch with nothing to switch reads
      // as a broken control.
      kind: 'toggle', key: 'shapeDetails', label: 'Shape details', section, value: true,
      help: 'The shape’s own marks, like laces or whiskers.',
      visibleWhen: (v) => !!blankById(str(v, 'blank'))?.detail,
    },
  ];
}

/** The same fields, shown only while `gate` says so — on top of any `visibleWhen` a field
 *  already has. `visibleWhen` is per field, never per section, so a design whose base can be an
 *  outline OR a shape from the library shows the shape's sliders only on the shape. */
export const onlyWhen = (fields: Field[], gate: (v: Values) => boolean): Field[] =>
  fields.map((f) => ({ ...f, visibleWhen: (v: Values) => gate(v) && (f.visibleWhen ? f.visibleWhen(v) : true) }));

/** The picked blank's parameters as the size sliders set them. The keyring is the engine's job,
 *  not the blank's — two holes is a bug, not a feature. */
function blankParamsOf(v: Values, def: { defaults: BlankParams }): BlankParams {
  return {
    ...def.defaults,
    width: num(v, 'width'),
    height: num(v, 'height'),
    corner: num(v, 'corner'),
    holeSide: 'none',
    pair: false,
  };
}

/** The blank those fields describe. `fallback` is used when a saved file names a shape that
 *  no longer exists, so an old project still opens. */
export function blankShapes(v: Values, fallback: string): Shapes {
  const def = blankById(str(v, 'blank')) ?? blankById(fallback)!;
  return buildBlank(def, blankParamsOf(v, def));
}

/** The content window the picked blank declares — a bone's waist, a bauble's face, a shield's
 *  upper field — in millimetres, or `null` for a blank that declares none. `fitText` re-centres
 *  on it when the place the design asked for holds nothing. */
export function blankTextBox(v: Values, fallback: string): Box | null {
  const def = blankById(str(v, 'blank')) ?? blankById(fallback)!;
  return textBoxOf(def, blankParamsOf(v, def));
}

/** The holes and slots the picked blank carries by nature — a strap slot, an annulus — as
 *  positive shapes, so `fitText`'s `avoid` can keep the lettering off them. `blankShapes` returns
 *  them as holes of the island, and a hole is something the fit steps over only if it happens to
 *  land a sample point in it. */
export function blankExtraShapes(v: Values, fallback: string): Shapes {
  const def = blankById(str(v, 'blank')) ?? blankById(fallback)!;
  if (!def.extra) return [];
  return def.extra(blankParamsOf(v, def)).map((r) => [r]);
}

/**
 * The marks the picked blank is DRAWN with, as layers — a football's laces, a cat's whiskers,
 * a bauble's stripes.
 *
 * `blankShapes` returns the silhouette and nothing else, which is why the football cut without
 * laces and the cat without whiskers: the detail was on the blank all along and no template ever
 * asked for it. `ops` says how to run each channel — a blank that offers both is offering a
 * CHOICE (score on pale wood that carries fine detail, engrave on a dense dark one), so pass
 * ONE of them; the rings are the same geometry either way, which is why a channel the blank
 * left empty falls back to the other rather than returning nothing.
 *
 * `raised` is deliberately not read here: that channel is a separate light PIECE to cut and glue,
 * which belongs to the framed family's part list, not to a layer on this piece.
 *
 * Pass the result to `fitText`'s `avoid` as well, or the name lands across the laces.
 */
export function blankDetailLayers(v: Values, ops: { score?: OpChoice; engrave?: OpChoice } = {}): DesignLayer[] {
  if (v.shapeDetails === false) return [];
  const def = blankById(str(v, 'blank'));
  if (!def?.detail) return [];
  const spec = blankDetail(def, blankParamsOf(v, def));
  const out: DesignLayer[] = [];
  const add = (id: string, op: OpChoice | undefined, rings: CutRing[] | undefined, other: CutRing[] | undefined) => {
    const marks = rings?.length ? rings : other;
    if (!op || op === 'off' || !marks?.length) return;
    out.push({ id, label: `${def.label} detail`, kind: 'detail', shapes: marks.map((r) => [r]), op });
  };
  add('detail-score', ops.score, spec.score, spec.engrave);
  add('detail-engrave', ops.engrave, spec.engrave, spec.score);
  return out;
}

// ---------------------------------------------------------------- the text --

export interface FitTextOpts {
  /** How far the lettering keeps from the outline, mm. Default: the house minimum, 4 — or 3 on
   *  a part whose short side is under 30 mm, where 4 would leave no room to be wrong in. */
  inset?: number;
  /** Extra shapes the text must clear as well as the edge: a blank's detail lines (laces,
   *  whiskers, stripes), a slot, anything already printed on the face. */
  avoid?: Shapes;
  /** Where the lettering belongs when the place it was asked for will not hold it: the blank's
   *  own content window (`blankTextBox`). Absent, the search falls back to the material. */
  home?: Box | null;
  /** The smallest capital this design may print, mm. Under 3 mm no weight of any face survives
   *  the burn, and a name shrunk past it hides the
   *  problem instead of showing it — so the fit stops there and says so in `warnings`. */
  minCap?: number;
  /** Where to put what the fit could not do, in the customer's words. The build passes it
   *  straight through as `BuildInput.warnings`. */
  warnings?: string[];
}

/** What a name shrunk past legibility says instead of shrinking (G25, name-tag finding 1). */
export const TOO_SMALL_WARNING = 'This shape is too small for the name — pick a wider shape or a shorter name.';

/** The fit's answer: how much to scale the lettering, and how far to move it first. */
export interface FitPlan {
  k: number;
  dx: number;
  dy: number;
  /** True when the box had to be moved off the centre it was asked for. */
  moved: boolean;
  /** True when the readable floor stopped the shrink — the lettering is as small as it may be
   *  and STILL does not fit, which is a warning, not a fit. */
  floored: boolean;
}

/**
 * The scale — and, when the place asked for will not hold the lettering at any scale, the move.
 *
 * Two fits, as name-tag.ts works them out: what the shape allows, and what also dodges the hole.
 * Shrinking keeps the lettering's centre still, so an obstacle parked ON that centre can only be
 * dodged by shrinking towards nothing; the ring and the shape's own marks are therefore dodged
 * separately and each only while it is cheap.
 *
 * What used to happen when a dodge was not cheap was nothing: the box stayed where it was and the
 * hole was allowed to sit on the letters, silently, at text lengths as ordinary as "Ana". And a
 * shape whose centre is not material at all — a hoop, whose middle is a hole — could satisfy no
 * scale, so `shapeFit` collapsed to zero, the guard returned the text UNSHRUNK into the void and
 * the engine threw the whole layer away. Both are the same bug: a fit that may only ever shrink.
 *
 * So when the dodge is abandoned, or the centre holds nothing, the box MOVES. Candidates in order
 * of preference: where it was asked for; the blank's own text box (a bone's waist, a bauble's
 * face); the mirror of the ask across the material's middle — the cheapest way off a hole on one
 * side; then a coarse sweep of the part, which is what finds the band of a hoop. The best fit
 * wins, ties going to the candidate nearest what was asked for, so a design that already fits
 * never moves.
 */
export function fitPlan(
  shapes: Shapes,
  box: Box,
  keyring: KeyringSpec,
  opts: FitTextOpts & { minScale?: number } = {},
): FitPlan {
  const centre: [number, number] = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
  const half: [number, number] = [(box.maxX - box.minX) / 2, (box.maxY - box.minY) / 2];
  const hole = keyring.enabled
    ? { centre: finalHoleCentre(shapes, keyring).centre, radius: keyring.dia / 2 + (keyring.mode === 'inside' ? keyring.ring : 0) }
    : null;
  const inset = opts.inset ?? (shortSideOf(shapes) < 30 ? 3 : 4);
  const avoid = opts.avoid ?? [];

  /** Every fit at one centre: what the shape allows, what clears everything, and what this
   *  design would settle for if it refused to move (the old behaviour — a dodge that costs more
   *  than half the shape's own fit is thrown away rather than shrinking towards nothing). */
  const fitAt = (at: [number, number]) => {
    const shape = fitBoxInside(shapes, at, half, inset, null);
    if (shape < 0.05) return { shape, clear: 0, settle: 0 };
    const cheap = (fit: number) => (fit < shape * 0.5 ? shape : fit);
    const rawHole = hole ? fitBoxInside(shapes, at, half, inset, hole) : shape;
    const rawAvoid = avoid.length ? fitBoxInside(shapes, at, half, inset, null, 0, avoid) : shape;
    return { shape, clear: Math.min(shape, rawHole, rawAvoid), settle: Math.min(cheap(rawHole), cheap(rawAvoid)) };
  };

  const floor = Math.max(0, Math.min(1, opts.minScale ?? 0));
  const asked = fitAt(centre);
  // What clearing every obstacle is allowed to cost: never more than half the size the shape
  // alone would allow, and never a letter under the readable floor.
  const bar = Math.max(floor, asked.shape * 0.5);
  // Nothing to improve on: it fits where it was asked for, clear of everything.
  if (asked.clear >= 0.999) return { k: 1, dx: 0, dy: 0, moved: false, floored: false };
  // Clearing it is affordable from here — shrinking is the whole answer, as it always was.
  if (asked.clear >= bar) return { k: asked.clear, dx: 0, dy: 0, moved: false, floored: false };

  const body = bboxOf(shapes);
  const mid: [number, number] = [(body.minX + body.maxX) / 2, (body.minY + body.maxY) / 2];
  const candidates: [number, number][] = [];
  if (opts.home) candidates.push([(opts.home.minX + opts.home.maxX) / 2, (opts.home.minY + opts.home.maxY) / 2]);
  // Mirrored across the part's middle: the shortest way out from under a ring on one side.
  candidates.push([2 * mid[0] - centre[0], centre[1]], [centre[0], 2 * mid[1] - centre[1]], mid);
  // And a sweep, for a part whose middle is not material at all.
  const steps = 6;
  for (let iy = 0; iy <= steps; iy++) {
    for (let ix = 0; ix <= steps; ix++) {
      candidates.push([
        body.minX + ((body.maxX - body.minX) * ix) / steps,
        body.minY + ((body.maxY - body.minY) * iy) / steps,
      ]);
    }
  }

  // The move: the centre where clearing everything costs least. `clear`, never `settle` — the
  // whole reason to be here is that settling means a ring on the letters.
  let best = { clear: asked.clear, dx: 0, dy: 0, moved: false, away: 0 };
  for (const at of candidates) {
    const got = fitAt(at);
    if (got.clear <= best.clear + 1e-4) continue;
    const away = Math.hypot(at[0] - centre[0], at[1] - centre[1]);
    // A meaningfully better fit, or the same fit closer to where it was asked for.
    if (got.clear > best.clear + 0.02 || away < best.away) {
      best = { clear: got.clear, dx: at[0] - centre[0], dy: at[1] - centre[1], moved: true, away };
    }
  }
  if (best.clear >= bar) return { k: best.clear, dx: best.dx, dy: best.dy, moved: best.moved, floored: false };
  // Nowhere on the part clears it for an affordable price. Keep the place the design asked for and
  // the size the shape itself allows, so the engine's own warnings — the ring on the lettering, the
  // name past the edge — are what the customer reads, rather than a name shrunk to a speck.
  if (asked.settle >= floor) return { k: asked.settle, dx: 0, dy: 0, moved: false, floored: false };

  // The floor binds: the lettering may not be made smaller, so the only question left is where to
  // put something that does not fit. The place that fails the fewest of the box's own test points
  // is the one that overlaps least — and the engine's own warnings then say so out loud, which is
  // the whole point of not shrinking further.
  let least = { fails: failsAt(centre, floor), dx: 0, dy: 0, away: 0 };
  for (const at of candidates) {
    const fails = failsAt(at, floor);
    const away = Math.hypot(at[0] - centre[0], at[1] - centre[1]);
    if (fails < least.fails || (fails === least.fails && away < least.away && (least.dx !== 0 || least.dy !== 0))) {
      least = { fails, dx: at[0] - centre[0], dy: at[1] - centre[1], away };
    }
  }
  return { k: floor, dx: least.dx, dy: least.dy, moved: least.dx !== 0 || least.dy !== 0, floored: true };

  /** How many of the box's nine test points land somewhere they should not, at scale `k`. */
  function failsAt(at: [number, number], k: number): number {
    const hx = half[0] * k;
    const hy = half[1] * k;
    let bad = 0;
    for (const sx of [-1, 0, 1]) {
      for (const sy of [-1, 0, 1]) {
        const p: [number, number] = [at[0] + sx * hx, at[1] + sy * hy];
        if (!insideUnion(shapes, p)) bad++;
        else if (hole && Math.hypot(p[0] - hole.centre[0], p[1] - hole.centre[1]) < hole.radius) bad++;
        else if (avoid.length && insideUnion(avoid, p)) bad++;
      }
    }
    return bad;
  }
}

/** Lettering scaled down — and moved, if it must be — until it sits inside the shape and clear
 *  of the ring.
 *
 *  The inset was 2 mm, which is under the house minimum of 3–5 mm and reads as a misprint on
 *  anything the size of a bag tag; it is 4 now, and every caller gets that for free. The floor
 *  under the shrink is a real capital height rather than a raw font size of 2: `Math.max(2, …)`
 *  let a star shrink "Annie" to a 1.45 mm smudge and call it a fit. */
export async function fitText(
  spec: TextSpec,
  op: OpChoice,
  shapes: Shapes,
  keyring: KeyringSpec,
  id = 'design',
  label = 'Text',
  opts: FitTextOpts = {},
): Promise<DesignLayer[]> {
  const layers = await textLayer(spec, op, id, label);
  if (!layers[0]) return layers;
  const size = spec.size ?? 10;
  const plan = fitPlan(shapes, bboxOf(layers.flatMap((l) => l.shapes)), keyring, {
    ...opts,
    minScale: await readableScale(spec.font, size, opts),
  });
  if (plan.floored && opts.warnings && !opts.warnings.includes(TOO_SMALL_WARNING)) opts.warnings.push(TOO_SMALL_WARNING);
  if (plan.k >= 0.999 && !plan.moved) return layers;
  return textLayer({ ...spec, size: size * plan.k, x: (spec.x ?? 0) + plan.dx, y: (spec.y ?? 0) + plan.dy }, op, id, label);
}

/** How far the fit may shrink this face at this size before the capitals drop under the readable
 *  floor — 0 when the design already asked for something at or under it, because a slider's own
 *  minimum is the template's business and the fit must not fight it. */
async function readableScale(font: string, size: number, opts: FitTextOpts): Promise<number> {
  if (size <= 0) return 0;
  const floor = await sizeForCapHeight(font, opts.minCap ?? 3);
  return size > floor ? floor / size : 0;
}

/** The shorter side of a part's bounding box, mm — what decides whether 4 mm of margin is
 *  generous or is most of the piece. */
export function shortSideOf(shapes: Shapes): number {
  if (!shapes.length) return 0;
  const b = bboxOf(shapes);
  return Math.min(b.maxX - b.minX, b.maxY - b.minY);
}

export interface StackLine {
  text: string;
  /** Letter height, mm. */
  size: number;
  /** Space above this line, as a fraction of its own size. Ignored on the first line. */
  gap?: number;
  /** This row in its OWN face — the pet sign's "Breakfast · Dinner" in a small-caps sans under a
   *  display name, the luggage tag's contact lines in the body face. Absent: `base.font`. */
  font?: string;
}

/** Several lines of different sizes stacked and centred as one block — a name over a date over
 *  an epitaph. Empty lines are skipped, so a plaque with one field filled in is still centred.
 *
 *  Each line is measured after it is built rather than assumed from its size: cap height, the
 *  descender on a "g" and an empty line all move a block that trusts the slider instead. */
export async function stackedText(
  lines: StackLine[],
  base: Omit<TextSpec, 'text' | 'size' | 'line2'>,
  op: OpChoice,
  id = 'design',
  label = 'Text',
): Promise<DesignLayer[]> {
  const rows = lines.filter((l) => l.text.trim() !== '' && l.size > 0);
  if (!rows.length) return [];
  const built = await Promise.all(rows.map((r) => textLayer({ ...base, ...(r.font ? { font: r.font } : {}), text: r.text, size: r.size, x: 0, y: 0, rotation: 0 }, op, id, label)));
  const drawn = built.map((layers) => layers.flatMap((l) => l.shapes));
  const boxes = drawn.map((s) => bboxOf(s));
  const heights = boxes.map((b) => Math.max(0, b.maxY - b.minY));
  const gaps = rows.map((r, i) => (i === 0 ? 0 : (r.gap ?? 0.45) * r.size));
  const total = heights.reduce((a, h) => a + h, 0) + gaps.reduce((a, g) => a + g, 0);

  const out: Shapes = [];
  let top = total / 2;
  for (let i = 0; i < rows.length; i++) {
    top -= gaps[i]!;
    const h = heights[i]!;
    const b = boxes[i]!;
    // Each line comes back centred on the origin; move its own centre to where this row sits.
    const rowCentre = top - h / 2;
    const dy = rowCentre - (b.minY + b.maxY) / 2;
    out.push(...placeShapes(drawn[i]!, 0, dy, 0));
    top -= h;
  }
  const at = placeShapes(out, base.x ?? 0, base.y ?? 0, base.rotation ?? 0);
  return [{ id, label, kind: 'text', shapes: at, op, ...(base.boldness ? { grow: base.boldness } : {}) }];
}

/**
 * A stack that stays on the part: `stackedText`, then `fitText`'s own fit applied to the whole
 * block, every line scaled by the one factor so the hierarchy between them survives.
 *
 * The luggage tag imported `fitText` and never called it, so a 40 mm-wide tag — its own supported
 * minimum, at its own default text — clipped the name at the plate edge and said nothing. Every
 * stacked-line design gets the safety net here rather than each growing its own.
 */
export async function fitStackedText(
  lines: StackLine[],
  base: Omit<TextSpec, 'text' | 'size' | 'line2'>,
  op: OpChoice,
  shapes: Shapes,
  keyring: KeyringSpec,
  id = 'design',
  label = 'Text',
  opts: FitTextOpts = {},
): Promise<DesignLayer[]> {
  const stack = await stackedText(lines, base, op, id, label);
  if (!stack[0]) return stack;
  // One factor for every line, floored on the SMALLEST line: the contact details are what a
  // stranger has to read off a lost bag, and they are the first thing a shrink makes unreadable.
  // The floor is measured in the face that row is actually set in — a row with its own `font` has
  // its own cap height, and the display face above it is not its metric.
  const live = lines.filter((l) => l.text.trim() !== '' && l.size > 0);
  const smallest = live.reduce((a, b) => (b.size < a.size ? b : a), live[0]!);
  const plan = fitPlan(shapes, bboxOf(stack.flatMap((l) => l.shapes)), keyring, {
    ...opts,
    minScale: await readableScale(smallest.font ?? base.font, smallest.size, opts),
  });
  if (plan.floored && opts.warnings && !opts.warnings.includes(TOO_SMALL_WARNING)) opts.warnings.push(TOO_SMALL_WARNING);
  if (plan.k >= 0.999 && !plan.moved) return stack;
  return stackedText(
    lines.map((l) => ({ ...l, size: l.size * plan.k })),
    { ...base, x: (base.x ?? 0) + plan.dx, y: (base.y ?? 0) + plan.dy },
    op,
    id,
    label,
  );
}

// -------------------------------------------------------------- the extras --

/** A mirrored twin beside the original — earrings and cufflinks come in pairs.
 *  `buildBlank` takes a `pair` flag it has never implemented, so this is where a pair is made. */
export function pairShapes(shapes: Shapes, gap = 6): Shapes {
  if (!shapes.length) return shapes;
  const b = bboxOf(shapes);
  const w = b.maxX - b.minX;
  const step = (w + gap) / 2;
  const left = placeShapes(shapes, -step, 0, 0);
  // Mirror in X. A ring's winding flips with it, so reverse each ring to keep holes as holes.
  const right = placeShapes(shapes, step, 0, 0).map((island) => island.map((ring) => ring.map(([x, y]) => [-x + 2 * step, y] as [number, number]).reverse()));
  return [...left, ...right];
}

/** Screw holes, inset from the corners of a w × h part. Two along the top, or one per corner. */
export function mountHoles(w: number, h: number, dia: number, inset: number, count: 2 | 4): Shapes {
  if (dia <= 0) return [];
  const x = Math.max(dia / 2 + 0.5, Math.min(inset, w / 2 - dia / 2 - 0.5));
  const y = Math.max(dia / 2 + 0.5, Math.min(inset, h / 2 - dia / 2 - 0.5));
  const at: [number, number][] = count === 2
    ? [[-w / 2 + x, h / 2 - y], [w / 2 - x, h / 2 - y]]
    : [[-w / 2 + x, h / 2 - y], [w / 2 - x, h / 2 - y], [-w / 2 + x, -h / 2 + y], [w / 2 - x, -h / 2 + y]];
  return at.map((c) => [circleRing(c[0], c[1], dia / 2, 32)]);
}

/** The "Letters are…" control every engraved design offers, with the same three words.
 *
 *  `key` is for the SECOND op control on a design that sets type twice — date-keychain's charm
 *  beside its calendar — so the copy and the option words come from here rather than being
 *  hand-made beside the shared one and drifting. Read it with `opOf(v, key)`. */
export function opField(
  section: string,
  value: 'engrave' | 'score' | 'cut' = 'engrave',
  label = 'Letters',
  opts: { help?: string; key?: string } = {},
): Field {
  return {
    kind: 'select', key: opts.key ?? 'op', label, section, value,
    options: [{ value: 'engrave', label: 'Engrave' }, { value: 'score', label: 'Score' }, { value: 'cut', label: 'Cut out' }],
    // What "Cut out" now does that it never used to — the tooltip comes with the control, so no
    // template has to remember to say it (and none may append its own after the spread).
    help: opts.help ?? CUT_OUT_HELP,
  };
}

/** Why "Cut out" no longer sheds the middle of an O (G14). */
export const CUT_OUT_HELP = 'Cut out keeps the middles of letters on small bridges.';

/** "Letter lines" — the seams of a welded word, scored so the letters still read.
 *
 *  A template applies it by adding `{ ...textLayer, op: 'score', seams: true }` beside its
 *  `hugOnly` text layer when the value is `score`; the engine scores the run of each letter's
 *  outline that the NEXT letter covers, so one clean line lands at every junction and nothing is
 *  burnt along the cut.
 *
 *  `engrave` is the third option a design whose border reads as a frame wants — the letters
 *  filled inside their own outline. It is opt-in rather than standard because most designs that
 *  weld a name have no border to be a frame, and an option that makes the piece a solid slab is
 *  not one to offer by accident. */
export function letterScoreField(
  section: string,
  value: 'off' | 'score' | 'engrave' = 'score',
  opts: { engrave?: boolean } = {},
): Field {
  return {
    kind: 'select', key: 'letterLines', label: 'Letter lines', section, value,
    options: [
      { value: 'off', label: 'Off' },
      { value: 'score', label: 'Score seams' },
      ...(opts.engrave ? [{ value: 'engrave', label: 'Engrave letters' }] : []),
    ],
    help: opts.engrave
      ? 'Score marks where letters meet; Engrave fills them in.'
      : 'Scores where one letter meets the next.',
  };
}

// ------------------------------------------------- one connected body (G31 / G32) --

/**
 * The bundled faces whose LOWERCASE actually joins: set a name in one of these and the word is
 * already a single connected line, so it is cut on the glyph outlines with no overlap walk and
 * no joining bars at all.
 *
 * Measured, not assumed. Every face here was built as the glyph union with bridges turned off —
 * "camila", "shiloh", "olivia", "anne", "ramsey" — and came out as ONE island once the dots of
 * the i's were bridged. Yellowtail, Allura, Rochester, Grand Hotel, Parisienne, Alex Brush,
 * Satisfy, Italianno and both Lobsters all look like connecting scripts and all break somewhere
 * in those five words, so none of them is here; a capital is never counted, because a script
 * capital's swash reaching the next letter is the exception in every face there is.
 *
 * A list rather than a flag on the face: `packages/fonts/src/registry.ts` is generated by
 * `scripts/fetch-fonts.mjs` and says so on its first line, so a field added to it is gone at the
 * next font fetch.
 *
 * 2026-09-21, W: the whole bundled library — all 242 faces — was swept again with "paisley"
 * added to the words, because it is a good test word. Exactly SEVEN faces
 * carry a lowercase word from c to y without a break: pacifico, norican, grand-hotel,
 * parisienne, pinyon-script, sacramento and homemade-apple — and the last three of those were
 * not on this list, so a design set in them was being welded and warned about as if it were a
 * block face. They are here now. Cookie, Damion, Dancing Script and Great Vibes connect
 * "camila", "shiloh", "olivia", "anne" and "ramsey" and all break "paisley"; they stay, because
 * this list is about how a face WRITES and the hug bridges the one gap and says so, but they are
 * off `WELDING_SCRIPTS`, which is about which face to hand someone first.
 */
export const CONNECTING_FONTS = [
  'pacifico', 'cookie', 'norican', 'damion', 'dancing-script', 'sacramento', 'great-vibes', 'pinyon-script',
  'grand-hotel', 'parisienne', 'homemade-apple',
];

/**
 * The faces whose LOWERCASE carried every one of `camila` / `shiloh` / `paisley` as ONE island
 * with bridges turned off, AND that still have their counters open at a 30 mm size: the shelf a
 * welding design recommends (G33). Chunky first, formal last.
 *
 * Lowercase, as `CONNECTING_FONTS` says above — a script CAPITAL's swash reaching the next letter
 * is the exception in every face there is, and never counted. Visible since E2 turned the bars off
 * by default: "Shiloh" in all four of these cuts as the S, the lowercase run and the i's tittle.
 *
 * FOUR, and every other candidate is here with the measurement that disqualified it, so widening
 * the shelf is a decision somebody makes on purpose rather than by forgetting:
 *   · Cookie, Damion, Dancing Script, Great Vibes — connect "camila", "shiloh", "olivia",
 *     "anne", "ramsey"; break "paisley", where the hug has to invent a joining bar.
 *   · Grand Hotel — connects all three, and one of "Camila"'s two a-counters still seals at a
 *     30 mm size even with the thicken taken to nothing.
 *   · Sacramento — connects all three; its a-counter measures exactly 1 mm at 30 mm and seals.
 *   · Homemade Apple — connects all three; a pencil hand whose strokes at a keychain size are
 *     under a millimetre.
 * All of them are still one click away under "Browse all fonts", and all of them build.
 */
export const WELDING_SCRIPTS = ['pacifico', 'norican', 'parisienne', 'pinyon-script'];

/** Whether this face writes as one connected body. */
export const isConnectingFont = (font: string): boolean => CONNECTING_FONTS.includes(font);

/**
 * How deep a letter has to bury itself in the one before it for the weld to survive kerf and
 * slop, mm: 0.6 mm, or 3 % of the letter height once the letters are big enough that 0.6 mm is
 * a hairline.
 *
 * Measured rather than assumed, and NOT the 1.5 mm / 6 % G32 asked for — that number was written
 * for a tight face and it mushes a loose one. Most of the travel a weld costs is closing the
 * font's own sidebearings, which a tight face like Dela Gothic barely has and Fredoka has plenty
 * of; the depth on top of that is all this number buys. At 6 % "Paisley" in Fredoka at 30 mm ran
 * its a into the bowl of its P and its i through the a (`sweep-paisley.png`, 1.5 and 1.8), while
 * "Noah" in Dela Gothic at 21 mm was unchanged — the whole range welds it. At 3 % both read, and
 * every junction draws ONE clean arc; under about 0.5 mm the seams start coming back as two
 * short arcs per junction instead of one.
 *
 * The other half of "a little" is the CAP, and it lives in `engine/text.ts`: no letter is walked
 * further than 0.4 of its own advance, whatever depth it reached. Measured as penetration — the
 * deepest any vertex of the new letter lies inside the one before it — never as boxes touching.
 */
export const weldOverlap = (size: number): number => Math.max(0.6, 0.03 * size);

/**
 * What `TextSpec.connect` should be for this face at this size: nothing to close for a script
 * that already connects, a real overlap for everything else.
 *
 * `thicken` is the design's own control when it has one (a share of the size), and a hairline —
 * 1.2 % — when it does not. The engine caps whatever is asked for here at what the narrowest
 * counter can spare (`MIN_COUNTER`), so a light face is thinned rather than blobbed;
 * `countersTooTight` is how a design says so when even nothing is too much.
 */
export function connectSpec(font: string, size: number, thicken?: number): ConnectSpec {
  const joins = isConnectingFont(font);
  return {
    thicken: thicken ?? 0.012 * size,
    overlap: joins ? 0 : weldOverlap(size),
    // A connecting script still has the odd letter that never reaches the next — Pacifico's P,
    // a J's swash — and that letter alone is walked in, so the name cuts as one piece. `overlap`
    // stays 0, so no design starts scoring seams across a script's own joins.
    ...(joins ? { joinLoose: weldOverlap(size) } : {}),
  };
}

/** What a design says when the face chosen does not join on its own. The original sentence
 *  promised joining bars; the overlap walk means there are none to promise, so it says what
 *  actually happens and still points at the fix. */
export const NOT_CONNECTING_NOTE =
  'This font’s letters do not join on their own — they are overlapped and the seams scored, so the piece still cuts as one. Pick a script that connects for a flowing line.';

/** The sentence, or nothing at all when the face connects. */
export const connectWarning = (font: string): string[] => (isConnectingFont(font) ? [] : [NOT_CONNECTING_NOTE]);

/** What a design says when the face's own counters are already narrower than a laser leaves
 *  open — the one case the thicken cap cannot rescue by thinning. */
export const TIGHT_COUNTERS_NOTE =
  'The holes in this font’s letters are under 1 mm at this size — make the piece bigger, or pick a rounder face.';

/** The sentence, or nothing, for the glyphs a design is about to weld. Give it the layer's own
 *  shapes, before the engine grows them. */
export const countersTooTight = (shapes: Shapes): string[] =>
  smallestCounter(shapes) < MIN_COUNTER ? [TIGHT_COUNTERS_NOTE] : [];

/**
 * The joining bars, as one toggle, OFF (2026-09-22).
 *
 * If the text is connected by letter spacing, good; if not, it is glued anyway. The letter bridge
 * stays as a toggle for anyone who wants it, off by default.
 *
 * A welded name that falls into two pieces is the product, not a fault: they are glued. What the
 * bars bought was one piece off the bed, and what they cost was a bar welded across the letters —
 * the N's diagonal running into the O in the serif shot — which is worse than two pieces. So the
 * engine's `bridges: 'all'` becomes the design's own choice, and the design's choice is `none`
 * until someone asks for it.
 *
 * A TOGGLE rather than the three-way `Connect` select it replaces ("Dots and letters" | "Dots
 * only" | "Off"): with the answer now "no bars" for everybody, the middle value is a distinction
 * nobody is choosing between, and a two-value control is a switch. `dots` is still an engine mode
 * and the designs that need a tittle carried — sports tags, the ornaments — pass it themselves.
 *
 * Old projects: the key is new, so a save carrying `connect: 'dots'` opens with the bars off. That
 * is the decision, applied to old work too; the toggle is one click away.
 */
export function bridgeField(section: string, label = 'Join loose letters'): Field {
  return {
    kind: 'toggle', key: 'bridges', label, section, value: false,
    help: 'Adds a small bar where two letters do not touch.',
  };
}

/**
 * The knobs a connected-text design shares: how bold the letters are, whether loose pieces get a
 * joining bar, and whether the seams are scored.
 *
 * Thicken is a PERCENTAGE of the letter height, not a millimetre count: 0.36 mm is a hairline on
 * a 30 mm word and a fattening on a 10 mm one, and the customer is choosing the same thing both
 * times.
 */
export function connectedTextFields(section: string): Field[] {
  return [
    {
      kind: 'number', key: 'thicken', label: 'Thicken', section,
      value: 1.2, min: 0, max: 3, step: 0.1, unit: '%',
      format: (v) => `${v.toFixed(1)}% of the size`,
      help: 'A little bold keeps thin strokes from cutting away.',
    },
    bridgeField(section),
    letterScoreField(section, 'score', { engrave: true }),
  ];
}

/** The toggle as the hugging blank's own word for it. Off is `none`: nothing is bridged, not even
 *  a tittle — a design that needs its dots carried passes `'dots'` itself. */
export const bridgeModeOf = (v: Values): 'all' | 'dots' | 'none' => (bool(v, 'bridges') ? 'all' : 'none');

export const opOf = (v: Values, key = 'op'): OpChoice => (str(v, key) || 'engrave') as OpChoice;

/**
 * The typographic knobs, once, for every design that sets type.
 *
 * Percentages rather than millimetres: a preset that says "a little tighter" survives a size
 * change, and 1.2 % is the same decision on a 20 mm keychain and a 160 mm topper. The template
 * does the arithmetic its own spec asks for —
 * `TextSpec.letterSpacing` is a fraction of the size, so `pct / 100`; `applyCase` does the case.
 *
 * All three live in the section the template names — Lettering, almost always — beside the
 * name they move, never in a drawer of their own: none of them makes the design the design, but
 * a type knob two folds away from the lettering is a knob nobody finds.
 *
 * `letterSpacing` is deliberately the key a few templates already use for a raw fraction. A
 * template spreading these must drop its own copy, not sit beside it — two controls writing one
 * key is the bug this helper exists to stop.
 */
export function letteringFields(section: string, o: { multiLine?: boolean; textCase?: 'as-typed' | 'upper' | 'lower' | 'title' } = {}): Field[] {
  return [
    {
      kind: 'number', key: 'letterSpacing', label: 'Letter spacing', section, value: 0,
      min: -10, max: 30, step: 1, unit: '%',
    },
    {
      // A design whose lettering is CUT at one size reads very differently in capitals and in
      // lowercase — a width-bound fit scales a lowercase string up until it fills the same room,
      // so the same name comes out nearly twice as tall. A template whose design is in
      // capitals says so here rather than leaving the customer to discover it.
      kind: 'select', key: 'textCase', label: 'Capitalise', section, value: o.textCase ?? 'as-typed',
      options: [
        { value: 'as-typed', label: 'As typed' },
        { value: 'upper', label: 'UPPERCASE' },
        { value: 'lower', label: 'lowercase' },
        { value: 'title', label: 'Title case' },
      ],
    },
    ...(o.multiLine
      ? [{
          kind: 'number', key: 'lineHeight', label: 'Line height', section, value: 100,
          min: 60, max: 140, step: 1, unit: '%',
        } as Field]
      : []),
  ];
}

/** A filename stem that is safe on every OS and never empty. */
export function stem(...parts: (string | number)[]): string {
  const s = parts
    .map((p) => String(p).trim())
    .filter(Boolean)
    .join('-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'design';
}

/** The site every sample link is on: a placeholder, nobody's page. Sample links used to open our
 *  own site, so every code nobody retyped pointed there (2026-09-30). One constant; each design
 *  adds its own path.
 *
 *  Keep a sample link 25 to 32 characters long. A code's module count follows its payload, and
 *  every default was fitted to that length (29 modules, 33 once a symbol raises it to H): the
 *  bare `https://example.com` makes a 25-module code whose wider quiet zone shrinks the QR tag's
 *  title under its 4.5 mm floor. */
export const SAMPLE_SITE = 'https://www.example.com';

// ----------------------------------------------------- the framed ornaments --

/** The rim, its loop and the registration switch — identical across every framed template.
 *  `diameter` seeds the frame
 *  width's default once; the loop is the standard keyring block in loop-tab mode, resting at
 *  the top.
 *
 *  Two sections, because they are two questions: the frame's own width under `section`, and the
 *  loop — how the ornament HANGS — under `hangSection`, the word every ornament and sign uses for
 *  it. A "Frame" category whose every other control was about the loop answered neither. */
export function frameFields(o: { diameter: number; section?: string; hangSection?: string; pieceNoun?: string }): Field[] {
  const section = o.section ?? 'Frame';
  const hang = o.hangSection ?? 'Hanging';
  // What the dark piece IS, in the customer's words. "The backer" is right for an ornament and
  // wrong for a house or a face — the house's dark piece is the house.
  const piece = o.pieceNoun ?? 'the backer';
  return [
    {
      kind: 'number', key: 'rimWidth', label: 'Frame width', section,
      value: +rimWidthFor(o.diameter).toFixed(1), min: 5, max: 14, step: 0.5, unit: 'mm',
      help: `How wide the rim round ${piece} is, loop included.`,
    },
    ...keyringFields('outside', { section: hang, dia: 3, ring: 4, side: 'top', along: 50 }),
    {
      kind: 'toggle', key: 'backerRing', label: 'Loop through both layers', section: hang, value: false,
      help: `On, ${piece} gets its own lug and the loop is two sheets thick.`,
      visibleWhen: (v) => str(v, 'ringMode') !== 'none',
    },
  ];
}

/** The choice in one sentence: it is made by what the customer OWNS. */
export const LIGHT_PIECES_HELP = 'Raised glues light parts on; Engrave burns them onto the dark piece.';

/** Whether the light content is its own glued piece, or burned onto the dark one.
 *
 *  `help` REPLACES the shared tooltip with a design's own sentence — by signature, not by
 *  spreading the field and appending, so a template cannot end up printing "undefined". */
export function lightPieceFields(
  section: string,
  defaultOp: 'raised' | 'engrave' = 'raised',
  opts: { help?: string } = {},
): Field[] {
  return [
    {
      kind: 'select', key: 'lightOp', label: 'Light pieces', section, value: defaultOp,
      options: [{ value: 'raised', label: 'Raised' }, { value: 'engrave', label: 'Engrave' }],
      help: opts.help ?? LIGHT_PIECES_HELP,
    },
    {
      kind: 'select', key: 'glue', label: 'Glue guide', section, value: 'score',
      options: [{ value: 'score', label: 'Score' }, { value: 'none', label: 'None' }],
      help: 'Scores where the light piece glues on.',
      visibleWhen: (v) => str(v, 'lightOp') === 'raised',
    },
  ];
}

// ------------------------------------------------------------------ dots joined to their letter --

/** How far straight down `p` is buried in `ring` — the distance to the ring's nearest crossing
 *  ABOVE it — or 0 when it is not inside at all. */
function depthBelowTop(p: [number, number], ring: CutRing): number {
  if (!pointInRing(p, ring)) return 0;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if ((xi > p[0]) === (xj > p[0])) continue;
    const y = yi + ((p[0] - xi) * (yj - yi)) / (xj - xi);
    if (y >= p[1] && y - p[1] < best) best = y - p[1];
  }
  return Number.isFinite(best) ? best : 0;
}

/**
 * Every i's and j's dot — any small island floating ABOVE the rest of its own letter — dropped
 * straight down until it is buried `depth` mm in that letter, so the word cuts as one piece
 * without a joining bar (with Score on, the junction is scored too).
 *
 * Why here and not a bridge: the engine's `bridges: 'dots'` holds a tittle on with a bar, and the
 * bars are off everywhere (2026-09-22) because a bar is a new mark on the letter. A dot
 * that sits ON its stem is the letter the type designer drew, lowered a millimetre or two.
 *
 * The letter's island tally is split so the dot counts as a glyph of its own AFTER the stem: a
 * `seams: true` copy of the layer then scores the stem's edge where the dot covers it — the
 * blue arc over the i in Weld and Score — and a design that scores nothing loses nothing.
 * A layer with no tally (no per-glyph structure to read) comes back untouched.
 */
export function joinDots(layers: DesignLayer[], depth: number): DesignLayer[] {
  return layers.map((l) => {
    const counts = l.glyphIslands;
    if (!counts || counts.reduce((a, b) => a + b, 0) !== l.shapes.length) return l;
    const shapes: Shapes = [];
    const tally: number[] = [];
    let at = 0;
    let moved = false;
    for (const n of counts) {
      const group = l.shapes.slice(at, at + n);
      at += n;
      if (n < 2) { shapes.push(...group); tally.push(n); continue; }
      const boxes = group.map((isl) => bboxOf([isl]));
      const tallest = Math.max(...boxes.map((b) => b.maxY - b.minY));
      const body: number[] = [];
      const dots: number[] = [];
      boxes.forEach((b, k) => {
        const small = Math.max(b.maxX - b.minX, b.maxY - b.minY) < 0.45 * tallest;
        // Above the rest of the letter: its underside clears the top of every other island.
        const above = boxes.every((o, m) => m === k || b.minY > o.maxY - 0.05 * tallest);
        (small && above ? dots : body).push(k);
      });
      if (!dots.length || !body.length) { shapes.push(...group); tally.push(n); continue; }
      const kept: Shapes = body.map((k) => group[k]!);
      const dropped: Shapes = [];
      for (const k of dots) {
        const dot = group[k]!;
        const b = boxes[k]!;
        // Never further than the gap to the letter's top plus the depth and a little: a dot over
        // a gap in its own letter finds no ink in that range and stays where it is.
        const top = Math.max(...body.map((m) => boxes[m]!.maxY));
        const limit = Math.max(0, b.minY - top) + depth + 0.6 * (b.maxY - b.minY);
        const pen = (s: number) => {
          let d = 0;
          for (const ring of dot) for (const [x, y] of ring) {
            for (const isl of kept) d = Math.max(d, depthBelowTop([x, y - s], isl[0]!));
          }
          return d;
        };
        let s = 0;
        const STEP = 0.1;
        while (s <= limit && pen(s) < depth) s += STEP;
        if (s > limit) { dropped.push(dot); continue; }
        dropped.push(placeShapes([dot], 0, -s, 0)[0]!);
        moved = true;
      }
      shapes.push(...kept, ...dropped);
      tally.push(kept.length, dropped.length);
    }
    return moved ? { ...l, shapes, glyphIslands: tally } : l;
  });
}

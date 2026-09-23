// Hair tie card — the tall pattern holder, rebuilt on Ian's own drawing
// (Ian's own drawing of the shape, 2026-09-23) after the first version was "too many settings"
// with four notches it did not want.
//
// THE SHAPE, read off that file rather than invented: two stadium POSTS down the sides, joined
// by a CROSSBAR at each end. What reads as "a notch top and bottom" is the air between the
// posts above and below those crossbars, and what reads as the slot is the gap between the two
// crossbars. The ties are threaded through the slot and hang on a crossbar.
//
//   · posts        (W − slot)/2 wide each, full height, capped with a semicircle — so the ends
//                  really are round rather than a rounded rectangle's corners;
//   · crossbars    one at each end, as wide as the gap, deep enough to take the pull;
//   · the slot     the void between them, as wide as the gap — which is why it is a big slot
//                  and not the 12 mm letterbox the first version cut (Ian: "too small");
//   · the hole     Ø 5 on the top-left cap, where the drawing puts it.
//
// THE PATTERN runs over the whole plate, edge to edge. No rim, no border, no inset (Ian: "we
// also don't need a border or a rim, just put pattern in full on the plate") — the region the
// fill is given is the plate less its own voids, and nothing else is held back.
import { bboxOf, circleRing, placeShapes, roundedRectRing, type Shapes } from '@vostok/laser';
import { fillShape } from '@vostok/patterns';
import { readSymbols } from '../symbols/model';
import { applyCase, textLayer } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import type { BuildInput, DesignLayer, OpChoice } from '../engine/types';
import { NO_KEYRING } from './keyring';
import { askedOp, fillCount, fillOptions, patternDefFor, patternFields, resolveOp } from './pattern-shared';
import { letteringFields, stem } from './shared';
import { num, str, type TemplateDef, type Values } from './types';

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** The least material left between any two cuts, mm (`laser-cutting-knowledge.md` §2.5: at
 *  least the sheet's own thickness; 4 is 3 mm ply with the kerf paid for). */
const MIN_WEB = 4;
/** The hanging hole, and the wall kept round it. */
const HOLE_DIA = 5;
/** How far the crossbars sit in from each end, as a share of the height — the depth of the
 *  notch, in other words. 0.20 is the drawing's (13.35 mm on 66.4). */
const NOTCH_SHARE = 0.2;
/** How deep a crossbar is, as a share of the height. 0.10 is the drawing's (6.4 mm on 66.4). */
const BAR_SHARE = 0.1;
/** The posts and the middle overlap by this much before they are unioned, so the two really
 *  weld instead of merely touching along a line. */
const KNIT = 0.4;

/** Faces that still read at an 8 mm capital burnt on a narrow post: condensed, even-weight,
 *  no hairlines. */
const NAME_FACES = ['bebas-neue', 'anton', 'oswald', 'montserrat', 'fredoka'];
/** Air kept between the name and the post's own edges, mm. */
const NAME_AIR = 2.5;
/** How far past the name's ink the pattern is held off, along the post. */
const NAME_BORDER = 3;

/** A scattered botanical — the tile nearest the reference photograph's floral. Pattern
 *  Monster's library (MIT), lazy-loaded, so a customer who never opens the gallery never pays
 *  for the ~900 KB of path data. */
const DEFAULT_PATTERN = 'pm-flower-5';

export const hairTieCard: TemplateDef = {
  id: 'hair-tie-card',
  name: 'Hair tie holder — pattern',
  blurb: 'A tall hair tie holder covered edge to edge in a repeating pattern, with a big slot and a seat at each end.',
  tags: ['home', 'engrave + cut'],
  fields: [
    // The name runs UP the right-hand post. A holder this narrow has no room for a word across
    // it, but it has 75 mm of post going the other way — which is exactly where a name fits
    // (Ian, 2026-09-23: "I want to be able to add full name, let's say on right side").
    {
      kind: 'text', key: 'text', label: 'Name', panel: 'right', section: 'Name', value: 'Freya',
      placeholder: 'Optional', maxLength: 18, symbols: true,
      help: 'Runs up the right-hand side.',
    },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'bebas-neue', recommended: NAME_FACES },
    // The pattern IS the design here, so it is what the right panel holds too — the one thing
    // you pick. Everything else is a size.
    {
      kind: 'pattern', key: 'pattern', label: 'Pattern', panel: 'right', section: 'Pattern', value: DEFAULT_PATTERN,
      help: 'Covers the whole holder, edge to edge.',
    },
    ...patternFields({ section: 'Pattern', value: DEFAULT_PATTERN, op: 'engrave', margin: 0 })
      // The picker itself is on the right, above; the knobs stay on the left. `margin` and
      // `web` are gone with the border they used to hold back.
      .filter((f) => !['pattern', 'margin', 'web'].includes(f.key)),

    { kind: 'number', key: 'width', label: 'Width', section: 'Size', value: 34, min: 24, max: 70, step: 1, unit: 'mm' },
    { kind: 'number', key: 'height', label: 'Height', section: 'Size', value: 75, min: 50, max: 160, step: 1, unit: 'mm' },
    {
      kind: 'number', key: 'slotW', label: 'Slot width', section: 'Size', value: 11, min: 6, max: 40, step: 0.5, unit: 'mm',
      help: 'The gap the ties are threaded through.',
    },
    ...letteringFields('Name'),
  ],

  async build(v: Values): Promise<BuildInput> {
    const warnings: string[] = [];
    const w = clamp(num(v, 'width'), 24, 70);
    const h = clamp(num(v, 'height'), 50, 160);

    // ---------------------------------------------------- the posts and the middle --
    // The slot can never eat the posts: each one keeps at least the web, which is what the
    // whole piece hangs from.
    const slotW = clamp(num(v, 'slotW'), 4, Math.max(4, w - 2 * MIN_WEB));
    if (num(v, 'slotW') > w - 2 * MIN_WEB + 0.01) {
      warnings.push(`The slot was cut back to ${slotW.toFixed(0)} mm so each side keeps ${MIN_WEB} mm of material.`);
    }
    const postW = (w - slotW) / 2;
    const postX = w / 2 - postW / 2;
    // A stadium: the corner radius IS half the post, so the cap is a semicircle and not a
    // rounded corner with a flat between. That is what the drawing draws.
    const posts: Shapes = [
      [roundedRectRing(postW, h, postW / 2).map(([x, y]): [number, number] => [x - postX, y])],
      [roundedRectRing(postW, h, postW / 2).map(([x, y]): [number, number] => [x + postX, y])],
    ];

    const notch = NOTCH_SHARE * h;
    const bar = Math.max(MIN_WEB, BAR_SHARE * h);
    const middleH = h - 2 * notch;
    const slotH = middleH - 2 * bar;
    if (slotH < MIN_WEB) {
      warnings.push('This holder is too short for a slot — raise Height.');
    }
    // Knitted into the posts rather than laid against them: two shapes that share only an edge
    // are two shapes as far as a union is concerned.
    const middle: Shapes = [[roundedRectRing(slotW + 2 * KNIT, middleH, Math.min(1.5, slotW / 2))]];

    const holeCentre: [number, number] = [-postX, h / 2 - postW / 2];
    const body: Shapes = [...posts, ...middle];

    // ------------------------------------------------------ the name, up the post --
    // Turned 90 degrees and run up the right post. The length it may use stops short of the
    // stadium caps, where the post is narrowing and a letter would hang off the curve.
    const name = await fitName(v, postW - 2 * NAME_AIR, h - postW - 2 * NAME_AIR, postX);
    if (name?.tight) warnings.push('The name is as small as it goes and still runs past the post — use a shorter name or a taller holder.');

    // ------------------------------------------------------------- the cuts in it --
    const layers: DesignLayer[] = [];
    if (slotH >= MIN_WEB) {
      layers.push({
        id: 'slot', label: 'Slot', op: 'cut', stencil: false,
        shapes: [[roundedRectRing(slotW, slotH, Math.min(1.5, slotW / 2))]],
      });
    }

    // ---------------------------------------------------------------- the pattern --
    // The region is the plate less its own voids, and nothing else: no inset, no rim, no border.
    // Each void is a HOLE in the plate's island, which `fillShape` reads even-odd.
    const def = await patternDefFor(str(v, 'pattern'));
    const resolved = resolveOp(def, askedOp(v));
    const op = resolved.op;
    warnings.push(...resolved.warnings);
    const region: Shapes = [
      ...posts.map((island) => [...island]),
      [
        middle[0]![0]!,
        ...(slotH >= MIN_WEB ? [roundedRectRing(slotW, slotH, Math.min(1.5, slotW / 2))] : []),
      ],
    ];
    // The hanging hole is a void in whichever post holds it.
    region[0]!.push(circleRing(holeCentre[0], holeCentre[1], HOLE_DIA / 2 + 1, 48));
    // …and the name keeps its own patch of plain material. "Pattern in full on the plate" is
    // about borders and rims; a pattern burnt THROUGH the letters is just an unreadable name.
    if (name) {
      const b = name.box;
      // A clear BAND, not a tight box round the ink. A reserve that hugs the letters leaves
      // pattern hard against them on both sides, and an engraved name in a field of engraved
      // flowers is a name you have to hunt for (Ian, 2026-09-23, on NINA). The band runs the
      // full width of the post, so the name sits on plain material with air all round it.
      // Strictly INSIDE the post, never flush with it: a hole whose edge lies on the outline it
      // is a hole in is a degenerate one, and even-odd stops excluding it — which is why the
      // first attempt at this band changed nothing at all.
      region[1]!.push(roundedRectRing(postW - 0.6, b.maxY - b.minY + 2 * NAME_BORDER, NAME_BORDER)
        .map(([x, y]): [number, number] => [x + postX, y + (b.minY + b.maxY) / 2]));
    }

    const fill = fillShape(region, def, fillOptions({ ...v, margin: 0, web: MIN_WEB }, op));
    warnings.push(...fill.warnings);
    // The region alone is not enough. A CONCAVE motif — every flower in the library — needs the
    // host's boolean to clip exactly, and this side of the build has none: the engine keeps
    // such a shape whole rather than cutting it (see @vostok/patterns, "Clipping, exactly"). So
    // anything still standing on the name's band is dropped here, which is what the first
    // version of this template did and what I lost in the rebuild.
    const band = name
      ? { minY: name.box.minY - NAME_BORDER, maxY: name.box.maxY + NAME_BORDER, minX: postX - postW / 2, maxX: postX + postW / 2 }
      : null;
    if (band) {
      const clearOfBand = (island: Shapes[number]): boolean => {
        const b = bboxOf([island]);
        return b.maxX <= band.minX || b.minX >= band.maxX || b.maxY <= band.minY || b.minY >= band.maxY;
      };
      fill.shapes = fill.shapes.filter(clearOfBand);
      fill.paths = fill.paths.filter((run) => clearOfBand([run as Shapes[number][number]]));
    }
    if (op === 'engrave') {
      if (fill.shapes.length) layers.unshift({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'engrave', kind: 'fill' });
      if (fill.paths.length) layers.unshift({ id: 'pattern-lines', label: `${def.name} lines`, shapes: [], op: 'score', paths: fill.paths, kind: 'fill' });
    } else if (op === 'score') {
      layers.unshift({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'score', paths: fill.paths, kind: 'fill' });
    } else {
      layers.unshift({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'cut', stencil: false, kind: 'fill' });
    }

    if (name) layers.push(...name.layers);

    return {
      blank: { kind: 'shape', shapes: body, oneIsland: true },
      // The hole is the design's own, cut where the drawing puts it — never the shared Ring.
      keyring: { ...NO_KEYRING, enabled: true, mode: 'inside', dia: HOLE_DIA, ring: 2, rest: holeCentre },
      layers,
      ...(warnings.length ? { warnings } : {}),
      status: `${def.name} · ${fillCount(op, fill)}`,
    };
  },

  fileName: (v) => stem(str(v, 'text') || str(v, 'pattern') || 'pattern', 'hair-tie'),

  exportNote: 'Engrave the pattern first, then cut the slot and the outline.',
};

/**
 * The name, turned a quarter turn and fitted to the post.
 *
 * Built, measured, rebuilt smaller — never scaled: a face squeezed in one axis is a different
 * typeface, and the font cards are the whole reason this one was picked.
 */
async function fitName(v: Values, across: number, along: number, x: number): Promise<
{ layers: DesignLayer[]; box: { minX: number; minY: number; maxX: number; maxY: number }; tight: boolean } | null> {
  const text = applyCase(str(v, 'text'), str(v, 'textCase')).trim();
  if (!text || across <= 2 || along <= 4) return null;
  const font = str(v, 'font');
  const draw = async (cap: number) => {
    const layers = await textLayer(
      { text, symbols: readSymbols(v), font, size: await sizeForCapHeight(font, cap), letterSpacing: num(v, 'letterSpacing') / 100 },
      'engrave' as OpChoice, 'name', 'Name',
    );
    return { layers, box: bboxOf(layers.flatMap((l) => l.shapes)) };
  };
  // The cap may be as tall as the post is wide — across the post once it is turned.
  let cap = across;
  let out = await draw(cap);
  if (!out.layers.length) return null;
  const run = () => out.box.maxX - out.box.minX;
  const tall = () => out.box.maxY - out.box.minY;
  const k = Math.min(1, along / Math.max(1e-6, run()), across / Math.max(1e-6, tall()));
  if (k < 0.999) { cap = Math.max(3, cap * k); out = await draw(cap); }
  // Centred on the origin, then turned and moved onto the post.
  const dx = -(out.box.minX + out.box.maxX) / 2;
  const dy = -(out.box.minY + out.box.maxY) / 2;
  const layers = out.layers.map((l) => ({ ...l, shapes: placeShapes(placeShapes(l.shapes, dx, dy, 0), x, 0, 90) }));
  return {
    layers,
    box: bboxOf(layers.flatMap((l) => l.shapes)),
    tight: run() > along + 0.05 || tall() > across + 0.05,
  };
}

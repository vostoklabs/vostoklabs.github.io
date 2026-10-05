// The jigsaw blank (2026-09-27): blank wooden puzzles — a portrait
// rectangle, a heart, a circle, a landscape rectangle, a tall one and a square — each a regular
// grid of classic round-knob pieces. Nothing is engraved: it is a blank to paint, draw on or
// print a photo onto.
//
// What the customer picks is what a puzzle is sold by: the shape, the size (the photo and paper
// sizes a blank is bought to match, all inside a 300 × 300 bed, or any size) and the piece count
// ("a 24-piece puzzle"); the grid that makes that count is worked out from the shape — the
// squarest cells for a rectangle, and for a circle or a heart the grid whose real count, once
// the slivers at the edge are merged into their neighbours, lands nearest. Shuffle deals a new set
// of knobs, which is how two puzzles of one size come out different — on a rectangle on the same
// grid; on a circle or a heart the jitter it deals can also move which rim slivers merge.
//
// The cut. The outline is the plate; the seams are ONE cut layer of OPEN lines (`paths`), which
// the engine clips to the plate and burns once each, and whose pieces it counts for the status
// line by making the cut (build.ts, cut-lines.ts). All the geometry is `engine/jigsaw.ts`.
import { bboxOf, type Shapes } from '@vostok/laser';
import type { KeyringSpec } from '../engine/types';
import { HEART_RATIO, jigsawOutline, planJigsaw, type JigsawOutline } from '../engine/jigsaw';
import { stem } from './shared';
import { num, str, type TemplateDef, type Values } from './types';

/** It lies on a table: no ring. `outside` because a loop tab is the only ring the app has. */
const noRing = (): KeyringSpec => ({ enabled: false, mode: 'outside', side: 'top', along: 0.5, dia: 5, ring: 2.5, position: -1 });

/** The sizes a blank is bought to match, portrait, mm. Every one fits a 300 × 300 bed. */
const RECT_SIZES: { value: string; label: string; w: number; h: number }[] = [
  { value: 'a6', label: 'A6 (105 × 148 mm)', w: 105, h: 148 },
  { value: '4x6', label: '4 × 6 in', w: 101.6, h: 152.4 },
  { value: '5x7', label: '5 × 7 in', w: 127, h: 177.8 },
  { value: 'a5', label: 'A5 (148 × 210 mm)', w: 148, h: 210 },
  { value: '8x10', label: '8 × 10 in', w: 203.2, h: 254 },
  { value: 'a4', label: 'A4 (210 × 297 mm)', w: 210, h: 297 },
];
/** A square's side, a circle's diameter, a heart's width, mm. */
const ROUND_SIZES: { value: string; label: string; w: number }[] = [
  { value: '15cm', label: '15 cm', w: 150 },
  { value: '6in', label: '6 in', w: 152.4 },
  { value: '20cm', label: '20 cm', w: 200 },
  { value: '8in', label: '8 in', w: 203.2 },
  { value: '25cm', label: '25 cm', w: 250 },
  { value: '10in', label: '10 in', w: 254 },
];
const PIECES = [4, 6, 9, 12, 16, 20, 24, 30, 36, 48];

const isRect = (v: Values) => str(v, 'outline') === 'rect';
const custom = (v: Values) => (isRect(v) ? str(v, 'rectSize') : str(v, 'roundSize')) === 'custom';

/** The outline's box, mm: a preset (turned for landscape) or the free size. */
export function jigsawSize(v: Values): { kind: JigsawOutline; width: number; height: number } {
  const raw = str(v, 'outline');
  const kind: JigsawOutline = raw === 'square' || raw === 'circle' || raw === 'heart' ? raw : 'rect';
  if (kind === 'rect') {
    const preset = RECT_SIZES.find((s) => s.value === str(v, 'rectSize'));
    let w = preset ? preset.w : num(v, 'width');
    let h = preset ? preset.h : num(v, 'height');
    if (preset && str(v, 'turn') === 'landscape') [w, h] = [h, w];
    return { kind, width: w, height: h };
  }
  const preset = ROUND_SIZES.find((s) => s.value === str(v, 'roundSize'));
  const w = preset ? preset.w : num(v, 'side');
  return { kind, width: w, height: kind === 'heart' ? w * HEART_RATIO : w };
}

/** An outline as a tile for the Shape picker, in the picker's 40 × 40 box. */
function thumb(shapes: Shapes): string {
  const b = bboxOf(shapes);
  const k = 32 / Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-6);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const n = (x: number) => x.toFixed(2);
  return shapes.flat().map((r) => `M ${r.map(([x, y]) => `${n(20 + (x - cx) * k)} ${n(20 - (y - cy) * k)}`).join(' L ')} Z`).join(' ');
}

export const jigsawBlank: TemplateDef = {
  id: 'jigsaw-blank',
  name: 'Jigsaw blank',
  blurb: 'A blank puzzle in the shape, size and pieces you pick.',
  tags: ['games', 'cut'],
  fields: [
    // --------------------------------------------------------- LEFT: "Puzzle", opens first --
    {
      kind: 'thumbs', key: 'outline', label: 'Shape', section: 'Puzzle', value: 'rect', columns: 4,
      options: [
        { value: 'rect', label: 'Rectangle', svgPath: thumb([[jigsawOutline('rect', 26, 36, 2)]]) },
        { value: 'square', label: 'Square', svgPath: thumb([[jigsawOutline('square', 30, 30, 2)]]) },
        { value: 'circle', label: 'Circle', svgPath: thumb([[jigsawOutline('circle', 30, 30, 0)]]) },
        { value: 'heart', label: 'Heart', svgPath: thumb([[jigsawOutline('heart', 30, 30 * HEART_RATIO, 0)]]) },
      ],
    },
    {
      kind: 'select', key: 'rectSize', label: 'Size', section: 'Puzzle', value: '5x7',
      options: [...RECT_SIZES.map(({ value, label }) => ({ value, label })), { value: 'custom', label: 'Custom' }],
      visibleWhen: isRect,
    },
    {
      kind: 'select', key: 'roundSize', label: 'Size', section: 'Puzzle', value: '20cm',
      options: [...ROUND_SIZES.map(({ value, label }) => ({ value, label })), { value: 'custom', label: 'Custom' }],
      visibleWhen: (v) => !isRect(v),
    },
    {
      kind: 'select', key: 'turn', label: 'Orientation', section: 'Puzzle', value: 'portrait',
      options: [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }],
      visibleWhen: (v) => isRect(v) && !custom(v),
    },
    { kind: 'number', key: 'width', label: 'Width', section: 'Puzzle', value: 150, min: 60, max: 290, step: 1, unit: 'mm', visibleWhen: (v) => isRect(v) && custom(v) },
    { kind: 'number', key: 'height', label: 'Height', section: 'Puzzle', value: 200, min: 60, max: 290, step: 1, unit: 'mm', visibleWhen: (v) => isRect(v) && custom(v) },
    { kind: 'number', key: 'side', label: 'Width', section: 'Puzzle', value: 200, min: 80, max: 290, step: 1, unit: 'mm', visibleWhen: (v) => !isRect(v) && custom(v) },
    {
      kind: 'select', key: 'pieces', label: 'Pieces', section: 'Puzzle', value: '24',
      options: PIECES.map((n) => ({ value: String(n), label: String(n) })),
    },

    // ----------------------------------------------------------------- LEFT: "Knobs" --
    {
      kind: 'stepper', key: 'seed', label: 'Shuffle', section: 'Knobs', value: 1, min: 1, max: 99,
      help: 'Deals a new set of knobs.',
    },
    { kind: 'number', key: 'knob', label: 'Knob size', section: 'Knobs', value: 25, min: 18, max: 32, step: 1, unit: '%', help: 'Knob width as a share of a piece.' },
    { kind: 'number', key: 'wobble', label: 'Irregularity', section: 'Knobs', value: 40, min: 0, max: 100, step: 5, unit: '%', help: 'How far the pieces stray from a perfect grid.' },

    // ---------------------------------------------------------- LEFT: "Puzzle", last row --
    { kind: 'number', key: 'corner', label: 'Rounded corners', section: 'Puzzle', value: 4, min: 0, max: 15, step: 0.5, unit: 'mm', visibleWhen: (v) => str(v, 'outline') === 'rect' || str(v, 'outline') === 'square' },
  ],
  async build(v) {
    const size = jigsawSize(v);
    const asked = Math.max(2, Math.round(Number(str(v, 'pieces')) || 24));
    const plan = planJigsaw({
      outline: size.kind, width: size.width, height: size.height,
      corner: num(v, 'corner'), pieces: asked,
      knob: num(v, 'knob') / 100, wobble: num(v, 'wobble') / 100, seed: Math.round(num(v, 'seed')),
    });
    // The count it suggests is one the Pieces list offers: the most that fits, rounded down to it.
    const fit = [...PIECES].reverse().find((n) => n <= plan.pieces) ?? PIECES[0];
    // A rectangle promises the count exactly; a custom size no grid of it fits says what it got.
    const exact = size.kind === 'rect' || size.kind === 'square';
    const warnings = !plan.fits ? [`Too small for ${asked} pieces — make it bigger, or pick ${fit}.`]
      : exact && plan.pieces !== asked ? [`${asked} pieces don't divide this size evenly — cut as ${plan.pieces}.`] : [];
    return {
      blank: { kind: 'shape', shapes: [[plan.outline]], oneIsland: true },
      keyring: noRing(),
      layers: [{ id: 'seams', label: 'Piece edges', op: 'cut', shapes: [], paths: plan.paths }],
      ...(warnings.length ? { warnings } : {}),
    };
  },
  exportNote: 'Every piece edge is one line, cut once, so the pieces keep a snug fit.',
  fileName: (v) => stem('jigsaw', jigsawSize(v).kind, `${str(v, 'pieces')}-pieces`),
};

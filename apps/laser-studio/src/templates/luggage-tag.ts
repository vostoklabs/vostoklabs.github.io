import { readSymbols } from '../symbols/model';
// A luggage tag: a name and the details under it, in the clear column beside the strap slot.
// The luggage blank carries its own slot, so the keyring starts at None — a tag with both a
// slot and a punched hole is two ways to attach one thing.
//
// The slot is at ONE END now, not on the centreline (the centred slot is the generic
// luggage-tag tell), which is why the lettering is offset into the column the slot leaves.
import { bboxOf, type Shapes } from '@vostok/laser';
import { textLayer } from '../engine/text';
import { keyringFields, keyringFrom } from './keyring';
import { blankExtraShapes, blankShapes, fitPlan, fitStackedText, opField, opOf, shapeFields, stem } from './shared';
import { num, str, type TemplateDef, type Values } from './types';

const WIDTH = 100;
const HEIGHT = 55;

/** The corner slider's own ends, from this design's proportions rather than the generic 0…30.
 *  `min` because a 0 % corner is fragile; `max` because the slot's
 *  length gives way to the corner radius (`blanks.ts` `luggageSlotRing`), so past about a fifth
 *  of the short side the tag keeps its slot only by shortening it below the sourced 45–55 % of
 *  the edge it sits behind — and a radius over ~15 % reads as a stock pill either way. */
const CORNER = 5;
const CORNER_MIN = 2;
const CORNER_MAX = Math.floor(Math.min(0.15 * HEIGHT, (0.5 * HEIGHT - 8) / 2) * 2) / 2;

/** The smallest letter this tag may set, mm. At 3 mm Montserrat's digits come out 2.14 mm tall —
 *  71 % of the number on the slider — which is under the 3 mm engraving floor
 *  in the one field a stranger finding a lost bag has to read. 4.5 renders 3.2. */
const MIN_SIZE = 4.5;

/** Where the lettering sits by default: centred in the column the slot leaves, and a whisker
 *  above the middle (the optical centre is 44–48 % down). */
const COLUMN_X = 8;
const COLUMN_Y = 1.5;

/** How far the pads may push the lettering or the ring: half the part's own longest side, so
 *  either can reach any point ON the tag and nowhere else (G25). */
const REACH = Math.round(WIDTH / 2);

/** Sans faces that stay legible at contact-detail size — this is the one design where the small
 *  line is the point of the product. Each was built here with the default name and number and
 *  looked at before it went on the list (G2); the condensed pair is last, for an address that
 *  will not otherwise fit. */
const READS_SMALL = ['montserrat', 'archivo', 'work-sans', 'figtree', 'inter', 'poppins', 'oswald', 'barlow-condensed'];

export const luggageTag: TemplateDef = {
  id: 'luggage-tag',
  name: 'Luggage tag',
  blurb: 'A name and contact details on a strap-slot tag. List two names — or a family — and every tag comes out on one sheet.',
  tags: ['tag', 'engrave + cut'],
  batch: { key: 'text', noun: 'tag' },
  exportNote: 'The strap slot is cut, not scored, and a 12–15 mm strap doubles through it.',
  fields: [
    { kind: 'text', key: 'text', label: 'Name', panel: 'right', section: 'Text', value: 'J. Morgan', placeholder: 'Your name', maxLength: 24, symbols: true },
    // No symbol button on the two detail lines: a phone number or an address has no use for an
    // inline icon, and the button is one more thing to read past.
    { kind: 'text', key: 'line2', label: 'Contact', panel: 'right', section: 'Text', value: '+44 7700 900000', placeholder: 'Phone or email', maxLength: 32, symbols: false },
    { kind: 'text', key: 'line3', label: 'Third line', panel: 'right', section: 'Text', value: '', placeholder: 'Optional', maxLength: 32, symbols: false },
    { kind: 'font', key: 'font', label: 'Name font', panel: 'right', section: 'Font', value: 'montserrat', recommended: READS_SMALL },
    // The contact lines keep their own face, and it stays the body sans by default even when the
    // name goes distinctive: MIN_SIZE above is a measurement of MONTSERRAT's digits, and a floor
    // measured in one face is not a floor in another. This is the line a stranger reads off a lost
    // bag, so it is the line that does not follow a display face up there.
    {
      kind: 'font', key: 'line2Font', label: 'Detail font', panel: 'right', section: 'Font', value: 'montserrat', recommended: READS_SMALL,
      help: 'Sets the font for the two contact lines only.',
    },
    ...shapeFields({ value: 'luggage', categories: ['tags', 'keychains', 'shapes'], width: WIDTH, height: HEIGHT, corner: CORNER, minWidth: 40, maxWidth: 160, minHeight: 25, maxHeight: 120, minCorner: CORNER_MIN, maxCorner: CORNER_MAX }),
    { kind: 'number', key: 'size', label: 'Name size', section: 'Lettering', value: 9, min: MIN_SIZE, max: 30, step: 0.5, unit: 'mm', help: 'Shrinks automatically if the name will not fit beside the slot.' },
    { kind: 'number', key: 'line2Size', label: 'Detail size', section: 'Lettering', value: 5, min: MIN_SIZE, max: 24, step: 0.5, unit: 'mm', help: 'Sets the size of both contact lines.' },
    { kind: 'position', key: 'offsetX', keyY: 'offsetY', label: 'Text position', section: 'Lettering', value: COLUMN_X, valueY: COLUMN_Y, max: REACH, step: 0.5, unit: 'mm', help: 'Off-centre by default, clear of the strap slot.' },
    opField('Lettering'),
    // The ring rests at the FAR end from the slot, so a tag that wears both does not wear them
    // in the same place. It is off by default: the slot is the attachment.
    ...keyringFields('none', { dia: 5, ring: 3, side: 'right', along: 50, nudge: REACH }),
  ],
  async build(v) {
    const shapes = blankShapes(v, 'luggage');
    const keyring = keyringFrom(v);
    const op = opOf(v);
    const warnings: string[] = [];
    const base = { symbols: readSymbols(v), font: str(v, 'font'), x: num(v, 'offsetX'), y: num(v, 'offsetY') };
    const detail = num(v, 'line2Size');
    // The slot is a hole in the blank, and a hole is something the fit steps over only by luck —
    // handed over as an obstacle, it is something the lettering keeps its margin off.
    const avoid: Shapes = blankExtraShapes(v, 'luggage');
    const detailFont = str(v, 'line2Font');
    const lines = [
      { text: str(v, 'text'), size: await nameSize(v, base, op, shapes, keyring, avoid) },
      { text: str(v, 'line2'), size: detail, gap: 0.6, font: detailFont },
      { text: str(v, 'line3'), size: detail, gap: 0.4, font: detailFont },
    ];
    const layers = await fitStackedText(lines, base, op, shapes, keyring, 'design', 'Text', { avoid, warnings });
    return { blank: { kind: 'shape', shapes }, keyring, layers, ...(warnings.length ? { warnings } : {}) };
  },
  fileName: (v) => stem(str(v, 'text') || 'luggage', 'tag'),
};

/**
 * The name's own size, fitted before the block is stacked.
 *
 * A full name is three times the width of a phone number, so the name is the line that runs out
 * of room first — and `fitStackedText` scales every line by ONE factor floored on the smallest of
 * them, which is right (the contact details are what a stranger has to read off a lost bag) and
 * leaves the block only about a seventh of shrink before the floor binds. "Christopher
 * Montgomery" — two characters inside the field's own limit — then stopped the fit dead and got
 * "this shape is too small" on a 100 mm tag with 30 mm of unused room under the name.
 *
 * So the name is fitted on its own first, down to but never under the size of the details below
 * it, which keeps the hierarchy the design is built on (it can never end up the smaller line).
 * The block fit afterwards is then the safety net it was meant to be rather than the only fit.
 */
async function nameSize(
  v: Values,
  base: { symbols: ReturnType<typeof readSymbols>; font: string; x: number; y: number },
  op: ReturnType<typeof opOf>,
  shapes: Shapes,
  keyring: ReturnType<typeof keyringFrom>,
  avoid: Shapes,
): Promise<number> {
  const asked = num(v, 'size');
  const text = str(v, 'text');
  if (!text.trim()) return asked;
  const layers = await textLayer({ ...base, text, size: asked }, op);
  if (!layers[0]?.shapes.length) return asked;
  const plan = fitPlan(shapes, bboxOf(layers.flatMap((l) => l.shapes)), keyring, { avoid });
  return Math.max(num(v, 'line2Size'), asked * plan.k);
}

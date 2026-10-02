import { readSymbols } from '../symbols/model';
// A charm for a zip pull: a monogram, a name or a symbol on a small shape, with a loop for the
// ring. What makes it this design rather than the name tag with the sliders turned down is the
// STYLE: an Initial is set to the shape, the way a monogram frame is drawn — the letter sized
// from the frame's own vertical span, not typed in millimetres. The name tag sets a name on a
// blank; this sets one letter INSIDE a frame.
import { bboxOf, type Shapes } from '@vostok/laser';
import { symbolLayer } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import { keyringFields, keyringFrom } from './keyring';
import { blankDetailLayers, blankExtraShapes, blankShapes, fitPlan, fitText, opField, opOf, shapeFields, stem } from './shared';
import { num, str, type TemplateDef, type Values } from './types';
import type { DesignLayer, KeyringSpec, OpChoice } from '../engine/types';

/**
 * How much of the frame's vertical span the monogram fills.
 *
 * §2.7 ("Diamond / geometric frame monogram") puts a framed initial's cap height at 55–65 % of
 * the frame's vertical span, and names the hexagon as one of those frames. That is the ASK here;
 * what actually lands is what the fit allows, because the house clearance rule (≥ 4 mm, or 3 on a
 * part whose short side is under 30) is measured from the letter's
 * BOX, and a box's corners reach a hexagon's slanted sides long before its cap height does. On the
 * shipped 34 mm charm the two rules meet at about 45 %; the letter is still three times the area
 * of the 29 % the generic "fit some text on a blank" path used to give it.
 */
const MONOGRAM_FILL = 0.6;

/** The smallest a symbol may be shrunk to before it stops being a picture of anything. */
const MIN_SYMBOL = 4;

/** The charm this design opens on, and how far the pads may push the lettering or the ring:
 *  half the part's own longest side, so either can reach any point ON the charm and nowhere else
 *  (G25 — the shared pad reached 250 mm, which on a 34 mm charm is a different postcode). */
const SIZE = 34;
const REACH = SIZE / 2;

/** The corner slider's ceiling: 45 % of the short side is where a rounded corner becomes a pill
 *  (G25), computed from this charm's own size rather than left at the generic 30 mm. */
const CORNER_MAX = Math.floor(SIZE * 0.45 * 2) / 2;

/** Faces that engrave at charm size and read as a monogram: Roman capitals first (what a
 *  monogram is), then the sturdier text serifs. Each was built here as the default "M" at the
 *  Initial fill and looked at before it went on the list (G2); Playfair Display stays on it
 *  because at 13 mm caps its hairlines are well clear of the burn floor, but it is no longer the
 *  default — at the old 10 mm it was under the 12 mm floor for a Regular-weight face.
 *
 *  Marcellus leads rather than Cinzel because its contours nest: a counter that comes back as its
 *  own island instead of a hole of its letter is invisible to the stencil bridges, and Cut out
 *  then sheds the middle of an "o" (see the note in `tests/node/bag-charm.test.mjs`). */
const MONOGRAM_FACES = ['marcellus', 'libre-baskerville', 'cinzel', 'eb-garamond', 'yeseva-one', 'playfair-display', 'bree-serif', 'patua-one'];

/** The charm's own symbol: a flower. Not the charm's paw (symbol-charm) or the card's rocket
 *  (svg-keychain), so no two designs share a photo in the gallery. */
const DEFAULT_SYMBOL = '\u{e545}';

const styleOf = (v: Values) => str(v, 'style') || 'initial';
const isName = (v: Values) => styleOf(v) === 'name';

export const bagCharm: TemplateDef = {
  id: 'bag-charm',
  name: 'Bag charm',
  blurb: 'A monogram, a name or a symbol on a small shape that clips to a zip pull.',
  tags: ['keychain', 'engrave + cut'],
  batch: { key: 'text', noun: 'charm' },
  fields: [
    {
      kind: 'select', key: 'style', label: 'Style', panel: 'right', section: 'Text', value: 'initial',
      options: [{ value: 'initial', label: 'Initial' }, { value: 'name', label: 'Name' }, { value: 'symbol', label: 'Symbol' }],
      help: 'Initial uses just the first letter you type.',
    },
    { kind: 'text', key: 'text', label: 'Text', panel: 'right', section: 'Text', value: 'M', placeholder: 'A name or an initial', maxLength: 12, symbols: true, visibleWhen: (v) => styleOf(v) !== 'symbol' },
    { kind: 'symbol', key: 'symbol', label: 'Symbol', panel: 'right', section: 'Text', value: DEFAULT_SYMBOL, visibleWhen: (v) => styleOf(v) === 'symbol' },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'marcellus', recommended: MONOGRAM_FACES, visibleWhen: (v) => styleOf(v) !== 'symbol' },
    ...shapeFields({ value: 'hexagon', categories: ['keychains', 'shapes', 'tags'], width: SIZE, height: SIZE, corner: 4, minWidth: 12, maxWidth: 90, minHeight: 12, maxHeight: 90, maxCorner: CORNER_MAX }),
    {
      kind: 'number', key: 'size', label: 'Text size', section: 'Lettering', value: 14, min: 3, max: 40, step: 0.5, unit: 'mm',
      help: 'Shrinks the name until it fits the shape.',
      // Initial and Symbol are sized FROM the shape; a slider that does nothing is a broken control.
      visibleWhen: isName,
    },
    {
      kind: 'position', key: 'offsetX', keyY: 'offsetY', label: 'Text position', section: 'Lettering', value: 0, valueY: 0, max: REACH, step: 0.5, unit: 'mm',
      help: 'The ring stays fixed, adjust it in the Keyring section instead.',
    },
    opField('Lettering'),
    {
      kind: 'number', key: 'letterSpacing', label: 'Letter spacing', section: 'Lettering', value: 0, min: -0.1, max: 0.5, step: 0.02,
      format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`,
      // One letter has nothing to space, and a symbol has no letters at all.
      visibleWhen: (v) => isName(v) && str(v, 'text').trim().length > 1,
    },
    ...keyringFields('outside', { dia: 4, ring: 2.5, side: 'top', along: 50, nudge: REACH, maxDia: 8 }),
  ],
  async build(v) {
    const shapes = blankShapes(v, 'hexagon');
    const keyring = keyringFrom(v);
    const op = opOf(v);
    const warnings: string[] = [];
    const details = blankDetailLayers(v, op === 'score' ? { score: 'score' } : { engrave: 'engrave' });
    // The shape's own marks and its own openings — a hoop's middle, a tag's slot — are things the
    // lettering has to keep off, not just the edge.
    const avoid: Shapes = [...details.flatMap((l) => l.shapes), ...blankExtraShapes(v, 'hexagon')];
    const span = shapes.length ? bboxOf(shapes) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const frame = span.maxY - span.minY;
    const fit = { inset: 3, avoid, warnings };
    const at = { x: num(v, 'offsetX'), y: num(v, 'offsetY') };
    const style = styleOf(v);

    let layers: DesignLayer[];
    if (style === 'symbol') {
      layers = await fitSymbol(str(v, 'symbol'), MONOGRAM_FILL * frame, op, { ...at, symbols: readSymbols(v) }, shapes, keyring, { ...fit, minScale: 0 }, warnings);
    } else {
      const text = str(v, 'text');
      const font = str(v, 'font');
      const initial = Array.from(text.trim())[0] ?? '';
      const spec = {
        symbols: readSymbols(v),
        text: style === 'initial' ? initial : text,
        font,
        // A monogram is set from the frame it sits in; a name is set in millimetres.
        size: style === 'initial' ? await sizeForCapHeight(font, MONOGRAM_FILL * frame) : num(v, 'size'),
        letterSpacing: num(v, 'letterSpacing'),
        ...at,
      };
      layers = await fitText(spec, op, shapes, keyring, 'design', 'Text', fit);
    }
    return { blank: { kind: 'shape', shapes }, keyring, layers: [...layers, ...details], ...(warnings.length ? { warnings } : {}) };
  },
  fileName: (v) => stem(styleOf(v) === 'symbol' ? 'charm' : str(v, 'text') || 'charm'),
};

/** A symbol set to the shape, the way `fitText` sets a name to it: build, ask `fitPlan` what the
 *  shape and the ring allow, build again at that size and place. A symbol has no cap height, so
 *  the floor under the shrink is a plain millimetre count. */
async function fitSymbol(
  char: string,
  size: number,
  op: OpChoice,
  at: { x?: number; y?: number; symbols?: ReturnType<typeof readSymbols> },
  shapes: Shapes,
  keyring: KeyringSpec,
  opts: Parameters<typeof fitPlan>[3],
  warnings: string[],
): Promise<DesignLayer[]> {
  const layers = await symbolLayer(char, size, op, at);
  if (!layers[0]) return layers;
  const plan = fitPlan(shapes, bboxOf(layers.flatMap((l) => l.shapes)), keyring, { ...opts, minScale: size > 0 ? Math.min(1, MIN_SYMBOL / size) : 0 });
  if (plan.floored) warnings.push('This shape is too small for the symbol — pick a wider shape.');
  if (plan.k >= 0.999 && !plan.moved) return layers;
  return symbolLayer(char, size * plan.k, op, { ...at, x: (at.x ?? 0) + plan.dx, y: (at.y ?? 0) + plan.dy });
}

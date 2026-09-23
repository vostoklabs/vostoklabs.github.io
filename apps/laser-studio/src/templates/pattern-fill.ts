import { readSymbols } from '../symbols/model';
// A shape from the library filled with a repeating pattern — punched through as holes,
// engraved as a fill, or scored as lines — with a clear disc in the middle for a monogram.
//
// The pattern engine is `@vostok/patterns` (packages/patterns/README.md); this template is its
// first home in the studio and the form later pattern templates copy. The template's own job
// is small: build the REGION the pattern may fill — the piece, less the clear centre and less
// the ring's border of material — and turn the fill's answer into layers. Everything that
// keeps the piece in one piece (holes dropped at the edge, the web between holes, lines
// clipped to the material, hinge slits kept off the edge) is the engine's.
//
// The picker, its ten knobs and the fill's options now live in `pattern-shared.ts`, so this
// design and `pattern-svg` (the customer's own SVG) cannot drift apart.
import { circleRing, type Shapes } from '@vostok/laser';
import { fillShape, insetShapes } from '@vostok/patterns';
import { finalHoleCentre } from '../engine/editorGeometry';
import { textLayer } from '../engine/text';
import type { DesignLayer } from '../engine/types';
import { keyringFields, keyringFrom } from './keyring';
import { DEFAULT_PATTERN, askedOp, fillCount, fillOptions, patternDefFor, patternFields, resolveOp } from './pattern-shared';
import { blankShapes, opField, opOf, shapeFields, shortSideOf, stem } from './shared';
import { bool, num, str, type TemplateDef, type Values } from './types';

/** A coaster: the size the gallery card is built at. */
const SIZE = 90;

/** Faces that read as a monogram engraved at 20 mm: bold, even strokes, no hairlines. */
const MONOGRAM_FACES = ['bebas-neue', 'anton', 'righteous', 'titan-one', 'montserrat'];

export const patternFill: TemplateDef = {
  id: 'pattern-fill',
  name: 'Pattern fill',
  blurb: 'Any shape filled with a repeating pattern — honeycomb, asanoha, living hinge — cut out, engraved or scored, with room for a monogram.',
  tags: ['home', 'engrave + score + cut'],
  fields: [
    { kind: 'text', key: 'text', label: 'Monogram', panel: 'right', section: 'Text', value: '', placeholder: 'Optional — a letter or two', maxLength: 4, symbols: true },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'bebas-neue', recommended: MONOGRAM_FACES },
    ...shapeFields({ value: 'coaster-round', categories: ['coasters', 'shapes', 'tags', 'keychains'], width: SIZE, height: SIZE, corner: 6, minWidth: 20, maxWidth: 300, maxHeight: 300 }),
    ...patternFields({ section: 'Pattern', value: DEFAULT_PATTERN, op: 'score' }),
    // A scored line following the outline, a little way in — the border a coaster usually has.
    // Off by default: the plain filled shape is the design, and a rim is a choice on top of it.
    // It rides in the shape's own section because it is a property of the PIECE, not of the
    // pattern: change the shape and the rim follows it.
    { kind: 'toggle', key: 'rim', label: 'Rim', section: 'Shape & size', value: false, help: 'A scored border following the edge.' },
    {
      kind: 'number', key: 'rimInset', label: 'Rim inset', section: 'Shape & size',
      value: 4, min: 1, max: 20, step: 0.5, unit: 'mm', visibleWhen: (v) => bool(v, 'rim'),
      help: 'How far in from the edge the border sits.',
    },
    // Both off by default (Ian, 2026-09-22: "so we have just the coaster with the pattern"). The
    // clear disc and the letter in it are a second design on top of the first one; a template
    // opens on the simplest thing it makes, and the two controls are one click away.
    { kind: 'toggle', key: 'clearCentre', label: 'Clear centre', section: 'Centre', value: false },
    { kind: 'number', key: 'clearRadius', label: 'Clear radius', section: 'Centre', value: 17, min: 3, max: 120, step: 0.5, unit: 'mm', visibleWhen: (v) => bool(v, 'clearCentre') },
    { kind: 'number', key: 'size', label: 'Monogram size', section: 'Centre', value: 20, min: 4, max: 120, step: 0.5, unit: 'mm', visibleWhen: (v) => str(v, 'text').trim() !== '' },
    opField('Centre', 'engrave', 'Monogram'),
    ...keyringFields('none', { section: 'Ring', nudge: SIZE / 2 }),
  ],
  async build(v) {
    const shapes = blankShapes(v, 'coaster-round');
    const def = await patternDefFor(str(v, 'pattern'));
    const warnings: string[] = [];
    const resolved = resolveOp(def, askedOp(v));
    const op = resolved.op;
    warnings.push(...resolved.warnings);
    const keyring = keyringFrom(v);
    const margin = num(v, 'margin');

    // The region the pattern may fill: the piece, less a disc for the monogram, less the ring's
    // border. Each reserve is a hole in the piece's island — the fill reads the region even-odd,
    // so a reserve has to stay inside the outline: the clear disc is shrunk to fit, and the
    // ring's disc is inside by construction (`finalHoleCentre` holds a hole in its border).
    const region: Shapes = shapes.map((island) => [...island]);
    const outer = region.reduce((best, island) => (islandArea(island) > islandArea(best) ? island : best), region[0] ?? []);
    if (bool(v, 'clearCentre')) {
      const roomFor = shortSideOf(shapes) / 2 - margin - 1;
      let r = num(v, 'clearRadius');
      if (r > roomFor) {
        r = Math.max(2, roomFor);
        warnings.push('The clear centre was shrunk to stay inside the piece.');
      }
      outer.push(circleRing(0, 0, r, 64));
    }
    if (keyring.enabled && keyring.mode === 'inside') {
      const { centre } = finalHoleCentre(shapes, keyring);
      outer.push(circleRing(centre[0], centre[1], keyring.dia / 2 + keyring.ring - 0.05, 48));
    }

    const fill = fillShape(region, def, fillOptions(v, op));
    warnings.push(...fill.warnings);

    const layers: DesignLayer[] = [];
    if (op === 'cut') {
      layers.push({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'cut', stencil: false });
    } else if (op === 'engrave') {
      if (fill.shapes.length) layers.push({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'engrave' });
      // A pattern of lines has nothing to fill: its lines are scored, in the score colour, and
      // the export note says so.
      if (fill.paths.length) layers.push({ id: 'pattern-lines', label: `${def.name} lines`, shapes: [], op: 'score', paths: fill.paths });
    } else {
      layers.push({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'score', paths: fill.paths });
    }

    // The rim: the outline again, a little way in, scored. `insetShapes` is a mitred vertex
    // offset and answers null when the outline folds in on itself — a star's arms at a deep
    // inset — so a rim that cannot exist says so rather than drawing a knot.
    if (bool(v, 'rim')) {
      const inset = num(v, 'rimInset');
      const rim = insetShapes(shapes, inset);
      if (rim?.length) layers.push({ id: 'rim', label: 'Rim', shapes: rim, op: 'score' });
      // The usual cause is a corner, not the size: inset a rounded rectangle by more than its
      // corner radius and the corner has nowhere to go. Say that, because "bring it in" alone
      // sends you to the wrong slider.
      else warnings.push(`A ${inset} mm rim does not fit this shape — it is wider than a corner can take. Bring the rim in, or raise Corner radius.`);
    }

    const text = str(v, 'text').trim();
    if (text) layers.push(...(await textLayer({ text, font: str(v, 'font'), size: num(v, 'size'), symbols: readSymbols(v) }, opOf(v), 'text', 'Monogram')));

    return { blank: { kind: 'shape', shapes }, keyring, layers, warnings, status: `${def.name} · ${fillCount(op, fill)}` };
  },
  fileName: (v) => stem(str(v, 'pattern') || 'pattern', str(v, 'text') || 'pattern'),
  exportNote: 'Cut the pattern holes before the outline, so the piece can’t shift.',
};

/** For tests and scripts: the values that pick one pattern by id. One key now — the gallery
 *  replaced the family dropdown and its per-family keys. */
export function pickPattern(id: string): Values {
  return { pattern: id };
}

function islandArea(island: Shapes[number]): number {
  const ring = island[0];
  if (!ring) return 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return Math.abs(a / 2);
}

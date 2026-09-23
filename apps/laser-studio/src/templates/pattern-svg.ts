// Your own SVG, with a pattern in the areas you clicked.
//
// The one thing this design does that no other does: it lets the customer POINT at part of
// their own drawing. An SVG traced by the symbol picker comes back as islands, and an island
// is a face — a surface with an area, which is what the laser cuts out and what a pattern can
// fill. So "click the areas" needs no new geometry at all: it is a set of island indices, and
// `src/areas.ts` holds the picker, the value format and the region it hands back.
//
// The piece IS the artwork: the blank is the traced faces, so an earring blank comes out
// earring-shaped and the outline is the cut. Everything else — the ten pattern knobs, the
// fill's options, the op a pattern will and will not do — is `pattern-shared.ts`, the same
// module the library-shape version (`pattern-fill`) uses, so the two cannot drift apart.
import { centreShapes, circleRing, type Shapes } from '@vostok/laser';
import { iconById } from '@vostok/fonts';
import { fillShape } from '@vostok/patterns';
import { areasValue, artworkFaces, pickedAreas, regionOf, scaleFaces, spanOf } from '../areas';
import { finalHoleCentre, insideShapes } from '../engine/editorGeometry';
import type { DesignLayer } from '../engine/types';
import { keyringFields, keyringFrom } from './keyring';
import { DEFAULT_PATTERN, askedOp, fillCount, fillOptions, patternDefFor, patternFields, resolveOp } from './pattern-shared';
import { stem } from './shared';
import { num, str, type TemplateDef } from './types';

/** The card's artwork: Material Symbols' eight-petal flower. Picked for its FACES — nine of
 *  them — because the card has one job, which is to show that the areas are separate things
 *  you can pattern one at a time. */
const DEFAULT_SYMBOL = iconById('filter_vintage')?.char ?? '';

export const patternSvg: TemplateDef = {
  id: 'pattern-svg',
  name: 'Pattern on your SVG',
  blurb: 'Upload your own shape — an earring blank, a pendant, a logo — click the areas you want patterned, and cut it out.',
  tags: ['home', 'engrave + score + cut'],
  exportNote: (v) =>
    str(v, 'patternOp') === 'cut'
      ? 'Cut the pattern holes before the outline, so the piece can’t shift.'
      : 'Run the engrave and score before the outline.',
  fields: [
    {
      kind: 'svg', key: 'artwork', label: 'Your SVG', panel: 'right', section: 'Artwork', value: DEFAULT_SYMBOL,
      help: 'Crop to the shape first, photos are ignored.',
    },
    {
      kind: 'areas', key: 'areas', from: 'artwork', label: 'Pattern areas', panel: 'right', section: 'Artwork', value: '',
      help: 'Click a surface of your SVG to pattern it or leave it plain.',
    },
    {
      kind: 'number', key: 'size', label: 'Size', section: 'Shape & size', value: 60, min: 20, max: 200, step: 1, unit: 'mm',
      help: 'Longest side of the finished piece.',
    },
    ...patternFields({ section: 'Pattern', value: DEFAULT_PATTERN, op: 'score', margin: 0 }),
    // Off by default (Ian, 2026-09-22). The customer's own SVG may already HAVE the hole it
    // hangs from — an earring blank usually does — and a second one punched through it
    // uninvited is a hole in someone else's drawing. The option stays one click away.
    ...keyringFields('none', { hole: true, section: 'Hanging hole', dia: 2.5, ring: 2, maxDia: 8, maxRing: 5, nudge: 60, ringNote: 'A hole for a jump ring, or a tab grown off the edge.' }),
  ],

  async build(v) {
    const keyring = keyringFrom(v);
    // The faces are taken ONCE, at the picker's own size, and scaled from there — never
    // re-traced at the size slider's value. Re-tracing is where a face could change index and
    // the customer's click would land on a different petal.
    const traced = await artworkFaces(v, 'artwork');
    if (!traced.length) {
      return {
        blank: { kind: 'shape', shapes: [] }, keyring, layers: [],
        warnings: ['Drop your SVG under “Your SVG” to start.'],
      };
    }
    const shapes = centreShapes(scaleFaces(traced, num(v, 'size') / spanOf(traced))).shapes;

    const def = await patternDefFor(str(v, 'pattern'));
    const resolved = resolveOp(def, askedOp(v));
    const op = resolved.op;
    const warnings = [...resolved.warnings];

    // The region: the faces that were clicked, each copied because a reserve is pushed onto it.
    const picked = pickedAreas(str(v, 'areas'), str(v, 'artwork'));
    const region: Shapes = regionOf(shapes, picked).map((face) => [...face]);
    if (!region.length) {
      warnings.push('No areas are picked, so nothing is patterned — open “Pattern areas” and click one.');
    }
    // The hanging hole keeps its border of material: the disc it needs is a hole in whichever
    // face holds it, so the fill leaves that much room. `insideShapes` reads one face even-odd,
    // which is "inside this face and outside its own holes" — the exact question.
    if (keyring.enabled && keyring.mode === 'inside') {
      const { centre } = finalHoleCentre(shapes, keyring);
      const host = region.find((face) => insideShapes([face], centre));
      if (host) host.push(circleRing(centre[0], centre[1], keyring.dia / 2 + keyring.ring - 0.05, 48));
    }

    const fill = region.length ? fillShape(region, def, fillOptions(v, op)) : null;
    if (fill) warnings.push(...fill.warnings);

    const layers: DesignLayer[] = [];
    if (fill) {
      if (op === 'cut') {
        layers.push({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'cut', stencil: false });
      } else if (op === 'engrave') {
        if (fill.shapes.length) layers.push({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'engrave' });
        // A pattern of lines has nothing to fill: its lines are scored, in the score colour.
        if (fill.paths.length) layers.push({ id: 'pattern-lines', label: `${def.name} lines`, shapes: [], op: 'score', paths: fill.paths });
      } else {
        layers.push({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'score', paths: fill.paths });
      }
    }

    // The same words the control uses, so the panel and the status line never disagree about
    // what is patterned — "Every area" beside "8 of 8 areas" reads as two different answers.
    const all = !picked || picked.size === shapes.length;
    const areas = all ? (shapes.length === 1 ? 'the whole shape' : `all ${shapes.length} areas`) : `${picked.size} of ${shapes.length} areas`;
    return {
      blank: { kind: 'shape', shapes },
      keyring,
      layers,
      warnings,
      status: fill ? `${def.name} · ${fillCount(op, fill)} · ${areas}` : `${shapes.length} areas · none patterned`,
    };
  },

  fileName: (v) => stem(str(v, 'pattern') || 'pattern', 'cutout'),
};

/** For tests and scripts: the values that pattern exactly these faces of an artwork. */
export const pickAreas = (char: string, ids: number[]) => ({ artwork: char, areas: areasValue(char, ids) });

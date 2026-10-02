// SVG keychain — the customer's OWN artwork as the design.
//
// The symbol picker already imports an SVG: "Import your own SVG" traces the file, stores it in
// `values.__symbols` under a private-use character and hands that character back as the field's
// value. So one `symbol` field takes a library icon AND an uploaded logo, and everything here is
// about what to DO with the artwork rather than how to get it in.
//
//   OUTLINE  the engine's hugging blank at `outline` mm — the plate follows the artwork's own
//            edge, so a logo comes out logo-shaped instead of a logo stuck on a disc. Engraved
//            artwork wants a solid plate under it; cut-out artwork wants its holes, so the
//            counters mode follows the operation.
//   SHAPE    a blank from the library with the artwork (and the name) laid on it, shrunk by
//            `fitBoxInside` — the same two-fit rule `fitText` uses — until it sits clear of the
//            edge and of the ring.
//
// A name is optional. It is placed against the artwork's MEASURED box (below it, or beside it),
// and it is scaled with the artwork, so the pair is fitted as one block and the gap between them
// keeps its proportion.
import { bboxOf, mirrorX, placeShapes, type Shapes } from '@vostok/laser';
import { symbolLayer, textLayer } from '../engine/text';
import { fitBoxInside, finalHoleCentre } from '../engine/editorGeometry';
import type { Blank, DesignLayer, OpChoice } from '../engine/types';
import { readSymbols } from '../symbols/model';
import { keyringFields, keyringFrom } from './keyring';
import { blankDetailLayers, blankShapes, blankTextBox, fitPlan, shapeFields, stem } from './shared';
import { bool, num, str, type Field, type TemplateDef, type Values } from './types';

type Pt = [number, number];

/** Material the cut leaves standing: anything narrower falls out or burns away (§2 laser facts). */
const MIN_ISLAND = 1;
/** Past this many separate pieces, a cut-out is lace and the engrave is the better job. */
const BUSY_ISLANDS = 40;
/** Air the design keeps off the blank's edge, mm — and the band a cut-out must stay inside of. */
const EDGE_CLEAR = 2;

/** The card's artwork: Material Symbols' rocket. A different one from the charm's paw, so the
 *  two designs do not share a photo in the gallery. */
const DEFAULT_SYMBOL = '';

const isShape = (v: Values) => str(v, 'base') === 'shape';
const isOutline = (v: Values) => !isShape(v);
const hasName = (v: Values) => str(v, 'text').trim() !== '';

/** The same fields, shown only on one base — `visibleWhen` is per field, never per section. */
const onlyWhen = (fields: Field[], gate: (v: Values) => boolean): Field[] =>
  fields.map((f) => ({ ...f, visibleWhen: (v: Values) => gate(v) && (f.visibleWhen ? f.visibleWhen(v) : true) }));

const move = (layers: DesignLayer[], dx: number, dy: number): DesignLayer[] =>
  Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 ? layers : layers.map((l) => ({ ...l, shapes: placeShapes(l.shapes, dx, dy, 0) }));

/** Artwork and name scaled as one block about `c`, so their gap scales with them. */
const scale = (layers: DesignLayer[], k: number, c: Pt): DesignLayer[] =>
  layers.map((l) => ({ ...l, shapes: l.shapes.map((isl) => isl.map((r) => r.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k] as Pt))) }));

const boxOf = (layers: DesignLayer[]) => bboxOf(layers.flatMap((l) => l.shapes));
const centreOf = (b: { minX: number; minY: number; maxX: number; maxY: number }): Pt => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
/** The short side of every island, mm — what a cut has to be able to hold. */
const islandWidths = (shapes: Shapes) => shapes.map((isl) => { const b = bboxOf([isl]); return Math.min(b.maxX - b.minX, b.maxY - b.minY); });

export const svgKeychain: TemplateDef = {
  id: 'svg-keychain',
  name: 'SVG keychain',
  blurb: 'Your own logo or drawing — outlined as a keychain, or set on a shape.',
  tags: ['keychain', 'engrave + cut'],
  batch: { key: 'text', noun: 'keychain' },
  exportNote: (v) =>
    str(v, 'op') === 'cut'
      ? 'Your artwork is cut out, so check the preview for pieces hanging on a bridge before you run it.'
      : 'Run the engrave first.',
  fields: [
    {
      kind: 'symbol', key: 'symbol', label: 'Your artwork', panel: 'right', section: 'Artwork', value: DEFAULT_SYMBOL,
      help: 'Crop to the artwork and outline any text first, photos are ignored.',
    },
    { kind: 'text', key: 'text', label: 'Name', panel: 'right', section: 'Text', value: '', placeholder: 'Optional', maxLength: 18, symbols: false },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'montserrat' },

    {
      // "Placement", not "Base": the section is already called Base, and a panel reading
      // "BASE / Base" tells a beginner nothing about what the control decides.
      kind: 'select', key: 'base', label: 'Placement', section: 'Base', value: 'outline',
      options: [{ value: 'outline', label: 'Outline' }, { value: 'shape', label: 'Shape' }],
      help: 'Shape lays your artwork onto a tag, disc or silhouette.',
    },
    ...onlyWhen(shapeFields({ value: 'tag', categories: ['keychains', 'tags', 'shapes', 'silhouettes'], width: 60, height: 40, corner: 5, section: 'Base' }), isShape),
    {
      // The loop tab is about 9 mm across whatever the artwork does, so an 8 mm drawing came out
      // smaller than its own hardware: the piece read as broken rather than small (finding 7).
      kind: 'number', key: 'size', label: 'Artwork size', section: 'Base', value: 30, min: 16, max: 120, step: 1, unit: 'mm',
      help: 'Longest side of your artwork, the border and loop add to it.',
    },
    {
      kind: 'number', key: 'outline', label: 'Border', section: 'Base', value: 4, min: 1, max: 12, step: 0.5, unit: 'mm', visibleWhen: isOutline,
      help: 'Material around your artwork, under 4 mm it looks like a sticker.',
    },
    {
      kind: 'number', key: 'smoothing', label: 'Rounded corners', section: 'Base', value: 2, min: 0, max: 8, step: 0.5, unit: 'mm', visibleWhen: isOutline,
      help: 'Rounds the border’s corners and closes tiny gaps in your artwork.',
    },
    {
      kind: 'toggle', key: 'fit', label: 'Shrink to fit the shape', section: 'Base', value: true, visibleWhen: isShape,
      help: 'Off keeps your size exactly, anything overhanging the shape is cut away.',
    },

    {
      kind: 'select', key: 'op', label: 'Artwork is', section: 'Lettering', value: 'engrave',
      options: [{ value: 'engrave', label: 'Engraved' }, { value: 'score', label: 'Scored' }, { value: 'cut', label: 'Cut out' }],
      help: 'Cut out keeps enclosed pieces on stencil bridges, so nothing falls out.',
    },
    { kind: 'number', key: 'textSize', label: 'Name size', section: 'Lettering', value: 8, min: 4, max: 30, step: 0.5, unit: 'mm', visibleWhen: hasName },
    {
      kind: 'select', key: 'textPlace', label: 'Name goes', section: 'Lettering', value: 'below', visibleWhen: hasName,
      options: [{ value: 'below', label: 'Below' }, { value: 'beside', label: 'Beside' }],
    },
    {
      kind: 'select', key: 'textOp', label: 'Name is', section: 'Lettering', value: 'engrave', visibleWhen: hasName,
      options: [{ value: 'engrave', label: 'Engrave' }, { value: 'score', label: 'Score' }],
    },
    {
      kind: 'number', key: 'rotation', label: 'Rotation', section: 'Lettering', value: 0, min: -180, max: 180, step: 1, unit: '°', advanced: true,
      help: 'Turns the artwork only, the name stays upright.',
    },
    {
      kind: 'toggle', key: 'flip', label: 'Flip artwork', section: 'Lettering', value: false, advanced: true,
      help: 'Mirrors the artwork, useful for an arrow facing the wrong way.',
    },

    ...keyringFields('outside'),
  ],

  async build(v) {
    const warnings: string[] = [];
    const onShape = isShape(v);
    const op = (str(v, 'op') || 'engrave') as OpChoice;
    const size = num(v, 'size');

    // An empty symbol gives no layers at all, exactly as the symbol charm does: the engine then
    // shows its own placeholder plate rather than a blank stage.
    const drawn = await symbolLayer(str(v, 'symbol'), size, op, { symbols: readSymbols(v) });
    // Mirrored before it is turned, so Flip reads as the artwork facing the other way rather
    // than as the rotation running backwards.
    const art = drawn.map((l) => {
      const shapes = bool(v, 'flip') ? mirrorX(l.shapes) : l.shapes;
      return { ...l, shapes: num(v, 'rotation') ? placeShapes(shapes, 0, 0, num(v, 'rotation')) : shapes };
    });

    // The name hangs off the artwork's MEASURED box, not off `size`: a wide logo and a tall one
    // do not put their name in the same place.
    const text = str(v, 'text').trim();
    const textSize = num(v, 'textSize');
    let name: DesignLayer[] = [];
    if (text) {
      name = await textLayer({ text, font: str(v, 'font'), size: textSize }, (str(v, 'textOp') || 'engrave') as OpChoice, 'name', 'Name');
      if (name.length && art.length) {
        const ab = boxOf(art);
        const nb = boxOf(name);
        const to: Pt = str(v, 'textPlace') === 'beside'
          ? [ab.maxX + size * 0.15 + (nb.maxX - nb.minX) / 2, (ab.minY + ab.maxY) / 2]
          : [(ab.minX + ab.maxX) / 2, ab.minY - textSize * 0.4 - (nb.maxY - nb.minY) / 2];
        const from = centreOf(nb);
        name = move(name, to[0] - from[0], to[1] - from[1]);
      }
    }

    // The pair sits on the origin, so the blank (which is built there) is under the middle of it.
    let layers = [...art, ...name];
    if (layers.length) {
      const c = centreOf(boxOf(layers));
      layers = move(layers, -c[0], -c[1]);
    }

    const keyring = keyringFrom(v);
    let blank: Blank;

    if (onShape) {
      const shapes = blankShapes(v, 'tag');
      // What the shape is DRAWN with — a football's laces, a cat's whiskers. The blank carried
      // them all along and nothing ever asked for them, so eleven of the picker's silhouettes
      // cut as bare outlines (G24). The artwork then has to keep off them, like any other ink.
      const details = blankDetailLayers(v, { engrave: 'engrave' });
      const detailShapes = details.flatMap((l) => l.shapes);
      // A "face" shape declares where content goes — a bunny's cheeks, a house's wall — and four
      // sibling templates already ask it. Centring on the raw origin put the rocket in the middle
      // of the bunny's head with an empty band under it.
      const home = blankTextBox(v, 'tag');
      const centre: Pt = home ? [(home.minX + home.maxX) / 2, (home.minY + home.maxY) / 2] : [0, 0];
      if (layers.length && (centre[0] !== 0 || centre[1] !== 0)) layers = move(layers, centre[0], centre[1]);
      if (bool(v, 'fit') && layers.length) {
        // The shared fit, not a local copy of half of it: it shrinks, and when shrinking cannot
        // clear the ring or the shape's own marks — because they sit on the very centre the
        // shrink keeps still — it MOVES the block to the best place on the part instead.
        const plan = fitPlan(shapes, boxOf(layers), keyring, { inset: EDGE_CLEAR, avoid: detailShapes, home });
        if (plan.k < 0.999) layers = scale(layers, Math.max(0.05, plan.k), centre);
        if (plan.dx || plan.dy) layers = move(layers, plan.dx, plan.dy);
      }
      blank = { kind: 'shape', shapes };
      layers = [...layers, ...details];

      if (op === 'cut') {
        const ab = boxOf(layers.filter((l) => l.id === 'design'));
        const sb = bboxOf(shapes);
        const outside = ab.minX < sb.minX + EDGE_CLEAR || ab.maxX > sb.maxX - EDGE_CLEAR || ab.minY < sb.minY + EDGE_CLEAR || ab.maxY > sb.maxY - EDGE_CLEAR;
        if (outside) warnings.push('Cut-out artwork touching the edge splits the shape — shrink it or engrave it instead.');
      }
    } else {
      // Engraved or scored artwork is a picture ON a plate, so the plate stays solid; a cut-out
      // artwork IS the plate's holes, so they are kept.
      blank = { kind: 'hug', margin: num(v, 'outline'), smoothing: num(v, 'smoothing'), counters: op === 'cut' ? 'open' : 'filled' };
    }

    if (op === 'cut') {
      const drawn = layers.filter((l) => l.id === 'design').flatMap((l) => l.shapes);
      if (drawn.length > BUSY_ISLANDS) warnings.push('Very detailed artwork is better engraved than cut.');
      if (islandWidths(drawn).some((w) => w < MIN_ISLAND)) warnings.push(`Some pieces of the artwork are under ${MIN_ISLAND} mm across — they will not survive the cut.`);
    }

    return { blank, keyring, layers, ...(warnings.length ? { warnings } : {}) };
  },

  fileName: (v) => stem(str(v, 'text') || 'artwork', 'keychain'),
};

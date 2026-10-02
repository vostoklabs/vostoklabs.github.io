import { readSymbols } from '../symbols/model';
// A name on a blank — a banner, a heart, a disc, a bone. The blank is the body; the lettering
// sits on it and is clipped to it.
//
// Every part of this design is the shared idea: `shapeFields` picks the blank and its size,
// `blankShapes` builds it, `fitText` shrinks the name to sit inside the edge and clear of the
// ring, `opField` says what the letters are. It carried private copies of all four, which is
// how its fit margin stayed at 2 mm after the shared one moved to the house minimum of 4.
import { textLayer } from '../engine/text';
import type { Shapes } from '@vostok/laser';
import { keyringFields, keyringFrom } from './keyring';
import { blankDetailLayers, blankExtraShapes, blankShapes, blankTextBox, fitText, opField, opOf, shapeFields } from './shared';
import { bool, num, str, type TemplateDef } from './types';

/** The shape this design opens on, and its size. A banner — a plate with a swallowtail cut into
 *  one end — rather than the rounded rectangle it used to open on: the blurb promises a shape
 *  library and the gallery card is the only picture most visitors ever see, so the default has to
 *  be one of the shapes, not the plain silhouette that fails as a default.
 *  It is also asymmetric by construction (notch at one end, hole at the other), which is what
 *  a tag should be. */
const WIDTH = 65;
const HEIGHT = 24;

/** The corner slider's ends, from this design's own proportions rather than one constant for
 *  every part (G25): 45 % of the short side is where a rounded rectangle becomes a pill, and the
 *  default is about a tenth of it — the band that reads as "considered". */
const CORNER = +(HEIGHT * 0.1).toFixed(1);
const CORNER_MAX = Math.floor(HEIGHT * 0.45 * 2) / 2;

/** The size sliders' own ends. The floor is where "Annie" stops running off the edge — under it
 *  the name is clipped rather than merely cramped. The ceiling is the biggest blank the picker
 *  offers (the bookmark is 50 × 150), because a slider that cannot reach the shape the picker
 *  just chose is a slider that lies about the part. */
const MIN_WIDTH = 20;
const MAX_WIDTH = 110;
const MAX_HEIGHT = 150;

/** How far the pads may push the name or the ring, mm: half the part's own longest side, so
 *  either can reach any point ON the tag and nowhere else (G25). The shipped ±60 emptied the
 *  plate, and the ring's shared ±250 grew a 247 mm cantilever on a one-island "success". */
const REACH = Math.round(WIDTH / 2);

/** Faces that read engraved at a tag's 7–12 mm cap height: chunky display first, one clean sans
 *  at the end for a plainer tag. Each was built here as the default "Annie" on the default
 *  banner and looked at before it went on the list (G2) — the scripts are deliberately absent,
 *  because their thin connecting strokes mush at this size. */
const ENGRAVES_WELL = ['luckiest-guy', 'bangers', 'lilita-one', 'anton', 'titan-one', 'righteous', 'bebas-neue', 'montserrat'];

export const nameTag: TemplateDef = {
  id: 'name-tag',
  name: 'Name tag',
  blurb: 'Lettering on a classic shape: a banner, a heart, a disc, a bone…',
  tags: ['tag', 'engrave + cut'],
  batch: { key: 'text', noun: 'tag' },
  fields: [
    { kind: 'text', key: 'text', label: 'Text', panel: 'right', section: 'Text', value: 'Annie', placeholder: 'A name', maxLength: 18, symbols: true },
    { kind: 'text', key: 'line2', label: 'Second line', panel: 'right', section: 'Text', value: '', placeholder: 'Optional', maxLength: 18, help: 'Prints smaller than the first line, about 70% of its size.' },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'luckiest-guy', recommended: ENGRAVES_WELL },
    ...shapeFields({ value: 'banner', categories: ['keychains', 'tags', 'shapes'], width: WIDTH, height: HEIGHT, corner: CORNER, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH, maxHeight: MAX_HEIGHT, maxCorner: CORNER_MAX }),
    { kind: 'number', key: 'size', label: 'Text size', section: 'Lettering', value: 10, min: 4, max: 60, step: 0.5, unit: 'mm', help: 'Shrinks the name until it fits the shape.' },
    { kind: 'toggle', key: 'fit', label: 'Shrink long names to fit', section: 'Lettering', value: true, help: 'Off cuts the name at the edge instead of shrinking it.' },
    // Opens at 0: the build finds the shape's own optical middle (below), so the pad is "away from
    // where it looks centred", on every blank. It opened at +4 when the banner's hole sat INSIDE
    // the left end and the name had to dodge it; the ring is a tab outside the edge now, and the
    // +4 pushed "Annie" towards the swallowtail — 8 mm right of the body's middle, with a
    // squeezed "Alexandrina" nearly touching the notch and a blank strip at the tab end.
    { kind: 'position', key: 'offsetX', keyY: 'offsetY', label: 'Text position', section: 'Lettering', value: 0, valueY: 0, max: REACH, step: 0.5, unit: 'mm', help: 'The hole stays fixed, drag it if it crowds the text.' },
    opField('Lettering'),
    { kind: 'number', key: 'letterSpacing', label: 'Letter spacing', section: 'Lettering', value: 0, min: -0.1, max: 0.5, step: 0.02, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}` },
    { kind: 'number', key: 'lineSpacing', label: 'Line spacing', section: 'Lettering', value: 1, min: 0.5, max: 1.8, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, visibleWhen: (v) => str(v, 'line2').trim() !== '' },
    // A loop tab, not a hole (2026-09-21 — the Hole option is gone). It rests on the LEFT
    // edge because that is the end the default banner hangs from: its swallowtail is bitten out
    // of the right end, so the tab grows off the blunt one.
    ...keyringFields('outside', { nudge: REACH, side: 'left', along: 50 }),
  ],
  async build(v) {
    const shapes = blankShapes(v, 'banner');
    const op = opOf(v);
    const keyring = keyringFrom(v);
    const warnings: string[] = [];
    const details = blankDetailLayers(v, op === 'score' ? { score: 'score' } : { engrave: 'engrave' });
    // What the name has to keep off as well as the edge: the marks the shape is drawn with, and
    // any opening it carries by nature.
    const avoid: Shapes = [...details.flatMap((l) => l.shapes), ...blankExtraShapes(v, 'banner')];
    // The banner's swallowtail bites 35 % of its height out of the right end, so the material's
    // middle is left of the bounding box's. A quarter of the notch is where the name looks centred
    // between the tab end and the V (half of it hugs the tab end); every other blank is symmetric
    // along its width and needs nothing.
    const opticalX = (str(v, 'blank') || 'banner') === 'banner' ? -0.35 * num(v, 'height') / 4 : 0;
    const spec = { symbols: readSymbols(v), text: str(v, 'text'), line2: str(v, 'line2'), font: str(v, 'font'), size: num(v, 'size'), letterSpacing: num(v, 'letterSpacing'), lineSpacing: num(v, 'lineSpacing'), x: num(v, 'offsetX') + opticalX, y: num(v, 'offsetY') };
    const layers = bool(v, 'fit')
      ? await fitText(spec, op, shapes, keyring, 'design', 'Text', { avoid, warnings, home: blankTextBox(v, 'banner') })
      : await textLayer(spec, op);
    return { blank: { kind: 'shape', shapes }, keyring, layers: [...layers, ...details], ...(warnings.length ? { warnings } : {}) };
  },
  fileName: (v) => `${str(v, 'text') || 'name'}-tag`,
};

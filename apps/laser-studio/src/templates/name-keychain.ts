import { readSymbols } from '../symbols/model';
// The name keychain: lettering on a base, with a loop tab. The one everyone starts with. Right
// panel: the text. Left: size & shape, the font, the lettering, the keyring.
//
// THE BASE is what the name sits on, and it is one choice of three:
//   OUTLINE  a plate that hugs the letters at `outline` mm, rounded by `smoothing`.
//   SHAPE    a blank from the shape library (a tag, a heart, a bone…) with the name fitted inside
//            it — the same shared fit the name tag uses, so a long name shrinks rather than
//            running off the edge.
//   NONE     no plate at all: the letters are welded into ONE body and that body IS the piece,
//            its counters its holes, the junctions scored so the word still reads as letters
//            (G33). The border and the rounded corners belong to the other two bases.
//
// THE LETTERS on a base are engraved, scored, or CUT OUT — punched through the base as a stencil,
// the middles of o, a, e kept on small bridges. That is what "Cut out" means on every other design
// in the studio; for a while here it meant the welded piece, which now lives under Base: None.
import { MIN_COUNTER, textLayer } from '../engine/text';
import { keyringFields, keyringFrom } from './keyring';
import {
  blankDetailLayers, blankExtraShapes, blankShapes, blankTextBox, bridgeField, bridgeModeOf, connectSpec, countersTooTight,
  fitText, letterScoreField, onlyWhen, opField, opOf, shapeFields,
} from './shared';
import { bool, num, str, type TemplateDef, type Values } from './types';

/** The letter height this design opens at. Everything below that has to stay in proportion to a
 *  letter is written as a share of it rather than as a millimetre count of its own. */
const SIZE = 12;

/** How far the strokes may be fattened. Measured on the shipped face at the shipped size: at
 *  2.5 % of the letter height "OLIVIA" still reads letter by letter; at 3.3 % (the 0.4 mm the
 *  review proposed) the L and the I have already fused into one shape, and at the 1 mm the
 *  slider used to reach the whole name is a single dark mass. G30: a boldness ceiling is
 *  computed from the letter height, never a constant. */
const BOLD_MAX = +(SIZE * 0.025).toFixed(2);

/** Faces that read engraved at keychain size and hug without razor-thin joins: chunky and
 *  rounded first, one clean sans at the end. Each was built here in "Olivia" at the defaults —
 *  one island, no warnings — before it went on the list (G2). */
const ENGRAVES_WELL = ['luckiest-guy', 'fredoka', 'baloo-2', 'lilita-one', 'titan-one', 'concert-one', 'chewy', 'montserrat'];

/** The shape the Shape base opens on: the library's rounded tag, sized for a name rather than
 *  for its own square-ish default, so "Olivia" at the opening letter size fits without a shrink. */
const SHAPE = { value: 'tag', width: 60, height: 24, corner: 6 };

/** The bar that holds an i's dot to its stem when the piece is the lettering, mm: enough to
 *  survive being lifted off the bed, never so wide it reads as part of the letter. */
const bridgeFor = (size: number) => Math.min(3, Math.max(1.5, 0.12 * size));

type Base = 'outline' | 'shape' | 'none';
/** What the name sits on. A project saved before the base existed carries none, and opens on the
 *  outline it was built with (`coerceValues` maps an old welded "Cut out" to `none`). */
const baseOf = (v: Values): Base => {
  const b = str(v, 'base');
  return b === 'shape' || b === 'none' ? b : 'outline';
};
const onOutline = (v: Values) => baseOf(v) === 'outline';
const onShape = (v: Values) => baseOf(v) === 'shape';
const lettersAlone = (v: Values) => baseOf(v) === 'none';

export const nameKeychain: TemplateDef = {
  id: 'name-keychain',
  name: 'Name keychain',
  blurb: 'A name with an outline that follows the letters and a loop for the ring.',
  tags: ['keychain', 'engrave + cut'],
  batch: { key: 'text', noun: 'keychain' },
  fields: [
    { kind: 'text', key: 'text', label: 'Text', panel: 'right', section: 'Text', value: 'Olivia', placeholder: 'A name', maxLength: 18, symbols: true },
    { kind: 'text', key: 'line2', label: 'Second line', panel: 'right', section: 'Text', value: '', placeholder: 'Optional', maxLength: 18, help: 'Prints smaller than the first line, about 70% of its size.' },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'luckiest-guy', recommended: ENGRAVES_WELL },

    // ----------------------------------------------------------- LEFT: "Size & shape" --
    { kind: 'number', key: 'size', label: 'Size', section: 'Size & shape', value: SIZE, min: 6, max: 40, step: 0.5, unit: 'mm', help: 'Letter height, long names shrink to fit on a shape.' },
    {
      kind: 'select', key: 'base', label: 'Base', section: 'Size & shape', value: 'outline',
      options: [{ value: 'outline', label: 'Outline' }, { value: 'shape', label: 'Shape' }, { value: 'none', label: 'None' }],
      help: 'Outline hugs the letters, Shape is a tag, None is letters only.',
    },
    // The border round the letters, on the outline base only. Hidden, never greyed.
    { kind: 'number', key: 'outline', label: 'Outline', section: 'Size & shape', value: 3, min: 1, max: 12, step: 0.5, unit: 'mm', help: 'How much material sticks out around the letters, at least 3 mm to stay sturdy.', visibleWhen: onOutline },
    { kind: 'number', key: 'smoothing', label: 'Rounded corners', section: 'Size & shape', value: 2, min: 0, max: 8, step: 0.5, unit: 'mm', help: 'Rounds corners and closes small gaps, raise it if pieces separate.', visibleWhen: onOutline },
    ...onlyWhen(shapeFields({ ...SHAPE, categories: ['keychains', 'tags', 'shapes', 'silhouettes'], section: 'Size & shape' }), onShape),
    // Engrave, score, or punch the name through the base — the shared control and its own words.
    // With no base there is nothing to engrave the letters ON: the letters are the piece.
    { ...opField('Size & shape', 'engrave', 'Letters'), visibleWhen: (v) => !lettersAlone(v) },

    // -------------------------------------------------------------- LEFT: "Lettering" --
    // Every knob that sets the WORD, whatever it sits on — so the rail reads Size · Font ·
    // Lettering · Keyring, the same order Connected text has.
    {
      kind: 'toggle', key: 'fit', label: 'Shrink long names to fit', section: 'Lettering', value: true, visibleWhen: onShape,
      help: 'Off cuts the name at the edge instead of shrinking it.',
    },
    { kind: 'number', key: 'boldness', label: 'Boldness', section: 'Lettering', value: 0, min: -0.3, max: BOLD_MAX, step: 0.05, unit: 'mm', help: 'Fattens or thins the strokes, past about 0.25 mm the letters merge together.' },
    { kind: 'number', key: 'letterSpacing', label: 'Letter spacing', section: 'Lettering', value: 0, min: -0.1, max: 0.5, step: 0.02, format: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`, help: 'Air between the letters, as a share of their height.' },
    { kind: 'number', key: 'lineSpacing', label: 'Line spacing', section: 'Lettering', value: 1, min: 0.5, max: 1.8, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, visibleWhen: (v) => str(v, 'line2').trim() !== '' },
    // The seams and the joining bars belong to the welded piece alone — the one base where the
    // letters ARE the piece. On a plate, the plate is what joins them.
    { ...letterScoreField('Lettering'), visibleWhen: lettersAlone },
    { ...bridgeField('Lettering'), visibleWhen: lettersAlone },
    ...keyringFields('outside'),
  ],
  async build(v) {
    const base = baseOf(v);
    const text = str(v, 'text').trim();
    const line2 = str(v, 'line2').trim();
    const size = num(v, 'size');
    const font = str(v, 'font');
    const keyring = keyringFrom(v);
    const spec = {
      symbols: readSymbols(v), text: str(v, 'text'), line2: str(v, 'line2'), font, size,
      letterSpacing: num(v, 'letterSpacing'), lineSpacing: num(v, 'lineSpacing'), boldness: num(v, 'boldness'),
    };
    const empty = !text && !line2 ? ['Type a name to see it on the keychain — this is just the blank outline.'] : [];

    if (base === 'none') {
      // The weld (G33). The letters are walked into each other a little, the union is the piece,
      // the counters are its holes and the junctions carry a score so the word still reads letter
      // by letter.
      const drawn = await textLayer({ ...spec, connect: connectSpec(font, size) }, 'off');
      // Material, not a line: the letters shape the outline and are never lasered themselves.
      const layers = drawn.map((l) => ({ ...l, op: 'off' as const, hugOnly: true }));
      // A second copy of the same islands, scored only where one letter meets the next.
      const seams = str(v, 'letterLines') === 'score'
        ? drawn.map((l) => ({ ...l, id: `${l.id}-seam`, label: 'Letter seams', op: 'score' as const, seams: true }))
        : [];
      const warnings = empty.length ? empty : countersTooTight(drawn.flatMap((l) => l.shapes));
      return {
        // `minHole` is the same floor the thicken is capped by, so nothing is warned about at
        // 1 mm and then quietly sealed at 1.2 by the engine's general-purpose default.
        // `bridges` from the toggle, which opens OFF: a welded name that comes off the bed in two
        // pieces is the product — it gets glued — and the bars the engine used to add ran across
        // the letters themselves. The count goes in the status line, not in a warning.
        blank: { kind: 'hug', margin: 0, smoothing: 0, counters: 'open', bridge: bridgeFor(size), minHole: MIN_COUNTER, bridges: bridgeModeOf(v) },
        keyring,
        layers: [...layers, ...seams],
        ...(warnings.length ? { warnings } : {}),
      };
    }

    // On a plate the letters keep exactly the spacing the type designer asked for: a cut-out
    // letter is a HOLE, and welded windows merge into one void ("Olivia" read OLIVA when they
    // were), so the pillar of material between each pair is what tells them apart.
    const op = opOf(v) as 'engrave' | 'score' | 'cut';
    const warnings = [...empty];
    if (base === 'shape') {
      const shapes = blankShapes(v, SHAPE.value);
      // The shape's own marks (a football's laces) follow the letters' operation, and the name
      // keeps off them and off any opening the shape carries by nature — the name tag's rule.
      const details = blankDetailLayers(v, op === 'score' ? { score: 'score' } : { engrave: 'engrave' });
      const avoid = [...details.flatMap((l) => l.shapes), ...blankExtraShapes(v, SHAPE.value)];
      const layers = bool(v, 'fit')
        ? await fitText(spec, op, shapes, keyring, 'design', 'Text', { avoid, warnings, home: blankTextBox(v, SHAPE.value) })
        : await textLayer(spec, op);
      return { blank: { kind: 'shape', shapes }, keyring, layers: [...layers, ...details], ...(warnings.length ? { warnings } : {}) };
    }
    return {
      blank: { kind: 'hug', margin: num(v, 'outline'), smoothing: num(v, 'smoothing') },
      keyring,
      layers: await textLayer(spec, op),
      ...(warnings.length ? { warnings } : {}),
    };
  },
  fileName: (v) => str(v, 'text') || 'name',
};

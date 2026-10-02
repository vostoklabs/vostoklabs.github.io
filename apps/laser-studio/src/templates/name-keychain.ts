import { readSymbols } from '../symbols/model';
// The name keychain: lettering with an outline hugging it and a loop tab. The one everyone
// starts with. Right panel: the text and the font. Left: size & outline, font tuning, keyring.
//
// 2026-09-21 (G33): "Cut out" is weld-and-score now. It used to punch the letters THROUGH the
// hugged plate — a stencil — and the piece that came off the bed read fine but was not the thing
// wanted. Cut out is now weld-and-score: the letters are welded
// into ONE body, that body IS the piece, the counters are its holes, and the junctions are
// scored so the word still reads as letters. The border and the rounded corners belong to the
// other two modes and are not shown in this one — a jacket round a welded word is the blob G31
// exists to stop.
import { MIN_COUNTER, textLayer } from '../engine/text';
import { keyringFields, keyringFrom } from './keyring';
import { bridgeField, bridgeModeOf, connectSpec, countersTooTight, letterScoreField, opField } from './shared';
import { num, str, type TemplateDef } from './types';

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

/** What "Cut out" does here, in the customer's words. It replaces the shared stencil sentence,
 *  which describes the mode this template no longer has. */
const CUT_OUT_WELDS = 'Cut out welds the letters into one piece and scores where they meet.';

/** The bar that holds an i's dot to its stem when the piece is the lettering, mm: enough to
 *  survive being lifted off the bed, never so wide it reads as part of the letter. */
const bridgeFor = (size: number) => Math.min(3, Math.max(1.5, 0.12 * size));

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
    { kind: 'number', key: 'size', label: 'Size', section: 'Size & outline', value: SIZE, min: 6, max: 40, step: 0.5, unit: 'mm', help: 'Letter height, so longer names make the keychain wider.' },
    // Both of these describe the border round the letters, and in Cut out there is none: the
    // letters ARE the piece. Hidden, never greyed.
    { kind: 'number', key: 'outline', label: 'Outline', section: 'Size & outline', value: 3, min: 1, max: 12, step: 0.5, unit: 'mm', help: 'How much material sticks out around the letters, at least 3 mm to stay sturdy.', visibleWhen: (v) => str(v, 'op') !== 'cut' },
    { kind: 'number', key: 'smoothing', label: 'Rounded corners', section: 'Size & outline', value: 2, min: 0, max: 8, step: 0.5, unit: 'mm', help: 'Rounds corners and closes small gaps, raise it if pieces separate.', visibleWhen: (v) => str(v, 'op') !== 'cut' },
    opField('Size & outline', 'engrave', 'Letters', { help: CUT_OUT_WELDS }),
    { ...letterScoreField('Size & outline'), visibleWhen: (v) => str(v, 'op') === 'cut' },
    // LETTERING, not Font: letter spacing belongs under Lettering.
    // The three of them shape the setting of the word, and the Font category is the picker alone —
    // which is what `form.ts` reads a non-font field in the font's own section as saying it is NOT:
    // it sweeps those into "More options", so Letter spacing was two folds from the name it moves.
    // Declared here, after Size & outline, so the rail reads Font · Size & outline · Lettering ·
    // Keyring — the same order Connected text has.
    { kind: 'number', key: 'boldness', label: 'Boldness', section: 'Lettering', value: 0, min: -0.3, max: BOLD_MAX, step: 0.05, unit: 'mm', help: 'Fattens or thins the strokes, past about 0.25 mm the letters merge together.' },
    { kind: 'number', key: 'letterSpacing', label: 'Letter spacing', section: 'Lettering', value: 0, min: -0.1, max: 0.5, step: 0.02, format: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`, help: 'Air between the letters, as a share of their height.' },
    { kind: 'number', key: 'lineSpacing', label: 'Line spacing', section: 'Lettering', value: 1, min: 0.5, max: 1.8, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, visibleWhen: (v) => str(v, 'line2').trim() !== '' },
    // The joining bars, off — and only asked about in Cut out, the one mode
    // where the letters ARE the piece. The other two modes hang the word on a plate with a
    // border, and the border is what joins them.
    { ...bridgeField('Lettering'), visibleWhen: (v) => str(v, 'op') === 'cut' },
    ...keyringFields('outside'),
  ],
  async build(v) {
    const op = str(v, 'op') as 'engrave' | 'score' | 'cut';
    const text = str(v, 'text').trim();
    const line2 = str(v, 'line2').trim();
    const size = num(v, 'size');
    const font = str(v, 'font');
    // Cut out IS the weld (G33). The letters are walked into each other a little, the union is
    // the piece, the counters are its holes and the junctions carry a score so the word still
    // reads letter by letter. Every other mode draws the name ON a hugged plate and the letters
    // keep exactly the spacing the type designer asked for.
    const welded = op === 'cut';
    const spec = {
      symbols: readSymbols(v), text: str(v, 'text'), line2: str(v, 'line2'), font, size,
      letterSpacing: num(v, 'letterSpacing'), lineSpacing: num(v, 'lineSpacing'), boldness: num(v, 'boldness'),
      ...(welded ? { connect: connectSpec(font, size) } : {}),
    };
    const drawn = await textLayer(spec, welded ? 'off' : op);
    // Material, not a line: the letters shape the outline and are never lasered themselves.
    const layers = welded ? drawn.map((l) => ({ ...l, op: 'off' as const, hugOnly: true })) : drawn;
    // A second copy of the same islands, scored only where a later letter buries an earlier one.
    const seams = welded && str(v, 'letterLines') === 'score'
      ? drawn.map((l) => ({ ...l, id: `${l.id}-seam`, label: 'Letter seams', op: 'score' as const, seams: true }))
      : [];
    const ink = drawn.flatMap((l) => l.shapes);
    const warnings = !text && !line2
      ? ['Type a name to see it on the keychain — this is just the blank outline.']
      : welded ? countersTooTight(ink) : [];
    return {
      blank: welded
        // `minHole` is the same floor the thicken is capped by, so nothing is warned about at
        // 1 mm and then quietly sealed at 1.2 by the engine's general-purpose default.
        // `bridges` from the toggle, which opens OFF: a welded name that comes off the bed in two
        // pieces is the product — it gets glued — and the bars the engine used to add ran across
        // the letters themselves. The count goes in the status line, not in a warning.
        ? { kind: 'hug' as const, margin: 0, smoothing: 0, counters: 'open' as const, bridge: bridgeFor(size), minHole: MIN_COUNTER, bridges: bridgeModeOf(v) }
        : { kind: 'hug' as const, margin: num(v, 'outline'), smoothing: num(v, 'smoothing') },
      keyring: keyringFrom(v),
      layers: [...layers, ...seams],
      ...(warnings.length ? { warnings } : {}),
    };
  },
  fileName: (v) => str(v, 'text') || 'name',
};

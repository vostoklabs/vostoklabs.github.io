import { readSymbols } from '../symbols/model';
// The pet tag: a name on the front, a phone number under it, a hole for the collar clip.
// Two lines of different weight rather than one, because that is what the thing says — the
// name is read across a room and the number is read up close.
//
// The bone's SHAFT is the only place two lines can live (a bone's waist is 0.4 × its height),
// and at the shipped 45 × 26 mm that shaft is 10.4 mm tall. The fit therefore bottoms out on
// its own readable floor — a 3 mm name cap — and settles about 1.8 mm from the shaft's edge
// rather than the house's 3–4 mm. That is a KNOWN, accepted exemption for this silhouette:
// reaching 4 mm of clearance on a 26 mm bone
// would need a name under 2.4 mm tall, which is below what survives a burn. It is the reason
// `fitText` is not handed a `warnings` array here — the floor is the design, not a fault, and a
// warning on the shipped default is noise. Raise Height and the clearance grows with the waist.
import { applyCase, textLayer } from '../engine/text';
import { hangHoleFields, hangingHoleCentre, NO_KEYRING } from './keyring';
import { blankDetailLayers, blankShapes, blankTextBox, fitText, letteringFields, opField, opOf, shapeFields, stem } from './shared';
import type { KeyringSpec } from '../engine/types';
import { bool, num, str, type TemplateDef } from './types';

/** Faces whose DIGITS survive a phone number engraved at the 3 mm floor this tag fits to.
 *  Each was built here as "555 0100" at a 3 mm cap and its narrowest counter measured: a
 *  counter under about 0.45 mm chars shut on ply, which is how a 0 becomes an 8. Anton (0.30),
 *  Titan One (0.34), Sigmar One (0.53) and Bebas Neue (0.49) are off the list for that reason;
 *  the eight below run 0.69–1.77 mm. Luckiest Guy, the default, is first. */
const READS_AT_3MM = ['luckiest-guy', 'russo-one', 'righteous', 'bangers', 'dela-gothic-one', 'oswald', 'archivo-black', 'montserrat'];

export const petIdTag: TemplateDef = {
  id: 'pet-id-tag',
  name: 'Pet ID tag',
  blurb: 'A pet’s name and your phone number, on a bone, a dog tag, a heart or a disc.',
  tags: ['tag', 'engrave + cut'],
  batch: { key: 'text', noun: 'tag' },
  fields: [
    { kind: 'text', key: 'text', label: 'Pet name', panel: 'right', section: 'Text', value: 'Biscuit', placeholder: 'Their name', maxLength: 14, symbols: true },
    { kind: 'text', key: 'line2', label: 'Phone number', panel: 'right', section: 'Text', value: '555 0100', placeholder: 'Or “If lost, call…”', maxLength: 22 },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'luckiest-guy', recommended: READS_AT_3MM },
    // Tags and keychains only. The Shapes shelf duplicated the Heart under the same word in a
    // second tab at a second size, and added a 50 × 150 mm bookmark to a pet-tag picker.
    // Corner radius tops out at 45 % of this design's own short side (G25), not a flat 30 mm.
    ...shapeFields({ value: 'bone', categories: ['tags', 'keychains'], width: 45, height: 26, corner: 4, minWidth: 35, maxWidth: 90, minHeight: 18, maxHeight: 90, maxCorner: 11 }),
    { kind: 'number', key: 'size', label: 'Name size', section: 'Lettering', value: 7, min: 3, max: 24, step: 0.5, unit: 'mm', help: 'Raise Height to make more room for a bigger name.' },
    { kind: 'number', key: 'line2Scale', label: 'Phone size', section: 'Lettering', value: 0.6, min: 0.3, max: 0.85, step: 0.05, format: (v) => `${Math.round(v * 100)}% of the name`, help: 'Check the preview at low values so numbers stay readable.' },
    { kind: 'toggle', key: 'fit', label: 'Shrink long names to fit', section: 'Lettering', value: true, help: 'Off cuts the name at the edge instead of shrinking it.' },
    // The pad reaches half the tag's own longest side, so the name can be nudged to any point ON
    // the tag and nowhere else. It used to reach 45 mm — one drag off a 45 mm-wide tag erased
    // every letter and left a blank bone (G25).
    { kind: 'position', key: 'offsetX', keyY: 'offsetY', label: 'Text position', section: 'Lettering', value: 2, valueY: 0, max: 22, step: 0.5, unit: 'mm', help: 'Moves the name and phone number together as one block.' },
    opField('Lettering'),
    ...letteringFields('Lettering'),
    // The hole IS the product here, so it is the DESIGN's, not the shared Ring control
    // (2026-09-21): it is cut where the chosen shape hangs from — a bone's upper-left lobe, a
    // disc's top, a heart's shoulder — and it does not move. A split ring on a collar clip is
    // 5 mm, and the tag gets yanked, hence the 3 mm of wall around it; the hole stops at 6 mm,
    // past which it eats the lobe it sits in and reaches the lettering.
    ...hangHoleFields('Keyring', { dia: 5, maxDia: 6 }),
  ],
  async build(v) {
    const shapes = blankShapes(v, 'bone');
    const op = opOf(v);
    // The hanging hole is the DESIGN's: it goes where the chosen shape hangs from — a bone's
    // upper-left lobe, a disc's top, a heart's shoulder — and it does not move. 3 mm of wall,
    // because a collar clip yanks the tag and the house floor for a loaded web is the material
    // thickness and never under 1 mm.
    //
    // It is still built as the engine's punched hole rather than as a cut layer of this
    // template's own: that is the one path `holdInside` keeps in material at every size, and the
    // one `fitText` already knows to keep the lettering off. What makes it the design's and not
    // a keyring is `rest` — the point comes from the blank, and with no `ringMode` field on the
    // form the preview gives it no drag handle.
    const dia = num(v, 'holeDia');
    const keyring: KeyringSpec = v.hangHole === false
      ? NO_KEYRING
      : { ...NO_KEYRING, enabled: true, mode: 'inside', dia, ring: 3, rest: hangingHoleCentre(v, 'bone', shapes, dia, 3) };
    // The marks the chosen silhouette is drawn with. They follow the lettering's own channel and
    // are never cut, and the fit is told to keep the name off them (G24).
    const marks = blankDetailLayers(v, op === 'score' ? { score: 'score' } : { engrave: 'engrave' });
    const avoid = marks.flatMap((l) => l.shapes);
    const spec = {
      symbols: readSymbols(v),
      text: applyCase(str(v, 'text'), str(v, 'textCase')),
      line2: applyCase(str(v, 'line2'), str(v, 'textCase')),
      line2Scale: num(v, 'line2Scale'),
      font: str(v, 'font'),
      size: num(v, 'size'),
      // `letteringFields` is a percentage of the letter height; `TextSpec` wants the fraction.
      letterSpacing: num(v, 'letterSpacing') / 100,
      x: num(v, 'offsetX'),
      y: num(v, 'offsetY'),
    };
    const layers = bool(v, 'fit')
      ? await fitText(spec, op, shapes, keyring, 'design', 'Text', { ...(avoid.length ? { avoid } : {}), home: blankTextBox(v, 'bone') })
      : await textLayer(spec, op);
    return { blank: { kind: 'shape', shapes }, keyring, layers: [...marks, ...layers] };
  },
  fileName: (v) => stem(str(v, 'text') || 'pet', 'tag'),
  exportNote: (v) => (v.hangHole === false
    ? 'No hole on this one, rivet or glue it to the collar.'
    : `The hole is cut at ${num(v, 'holeDia')} mm across.`),
};

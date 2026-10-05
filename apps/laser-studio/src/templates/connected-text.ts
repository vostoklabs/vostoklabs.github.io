import { readSymbols } from '../symbols/model';
// Connected text: a name welded into one cut-out piece. The letters are the material — the
// counters of an "o" or an "a" are open holes, a thin border of material wraps every stroke,
// and any letter that does not touch its neighbour (a script capital's swash rarely reaches
// the next letter) is joined by a bridge no thinner than the sheet.
//
// The 2026-09-20 rewrite fixed what the first version got wrong: a real name as the default, not
// "Weld"; a border of real width; bridges of real width; nothing scored unless asked — a score
// 0.6 mm inside the cut is a second burn on the weakest line of the piece.
//
// The review pass that evening added the other half: Border, Rounded corners and Thicken are
// SHARES of the letter height, not flat millimetres. Tuned for a 30 mm word, 0.5 mm of border
// drowned a 10 mm one, and at 1.5 mm — a quarter of the slider — "Sophia" melted into a blob at
// the shipped size. A percentage is the same decision at every size.
//
// 2026-09-21 (G31/G32): the piece is the LETTERS' own union, not a hug with a margin. Border and
// Rounded corners both open at zero, so "Camila" is cut on Pacifico's outlines instead of coming
// out as the chunky blob the review photographed; a face that does not connect gets each letter
// walked into the one before it and the buried edge scored — "weld and score".
import { MIN_COUNTER, textLayer } from '../engine/text';
import { keyringFields, keyringFrom } from './keyring';
import { WELDING_SCRIPTS, bridgeModeOf, connectSpec, connectWarning, connectedTextFields, countersTooTight, joinDots, weldOverlap } from './shared';
import { bool, num, str, type Field, type TemplateDef } from './types';

/** A share of the letter height, in millimetres. Border, Rounded corners and Boldness are all
 *  fractions of `size` rather than flat millimetres: 0.5 mm of border is a hair round a 30 mm
 *  script and a drowning at 10 mm, which is how the shipped sliders melted the word well inside
 *  their own advertised range (review finding 1). A percentage is the same decision at every
 *  size, so both ends of every slider stay legible. */
const share = (size: number, pct: number) => (size * pct) / 100;

/** The faces this design is FOR: the ones whose lowercase writes as one connected line, so the
 *  piece is the letters themselves and not a word in a jacket (G31). The list is measured and
 *  shared — `shared.ts`'s `WELDING_SCRIPTS`, which says which words it was measured on and which
 *  script-looking faces failed. Chunky first, formal last.
 *
 *  Sacramento is on it again. It was dropped because 1.2 % of a 30 mm size closed one of the
 *  a-counters of "Camila"; the engine now caps the thicken at what the narrowest counter can
 *  spare, so the face comes out as drawn instead of as a blob. */
const RECOMMENDED = WELDING_SCRIPTS;

export const connectedText: TemplateDef = {
  id: 'connected-text',
  name: 'Connected text',
  blurb: 'A name welded into one cut-out piece — script letters joined, counters open, bridges as thick as the sheet.',
  tags: ['sign', 'cut'],
  batch: { key: 'text', noun: 'piece' },
  fields: [
    { kind: 'text', key: 'text', label: 'Word or name', panel: 'right', section: 'Text', value: 'Camila', placeholder: 'A name', maxLength: 24 },
    { kind: 'toggle', key: 'twoLines', label: 'Add a second line', panel: 'right', section: 'Text', value: false },
    { kind: 'text', key: 'line2', label: 'Second line', panel: 'right', section: 'Text', value: '', placeholder: 'Optional', maxLength: 24, visibleWhen: (v) => bool(v, 'twoLines') },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'pacifico', recommended: RECOMMENDED },
    { kind: 'number', key: 'size', label: 'Size', section: 'Size & border', value: 30, min: 20, max: 120, step: 1, unit: 'mm', help: 'Letter height, the whole piece scales with it.' },
    // Zero: the outline IS the letters (G31). Anything above it is a jacket round the word, and
    // the blob seen in testing was that jacket at 1.7 % with a smoothing pass on top of it.
    { kind: 'number', key: 'border', label: 'Border', section: 'Size & border', value: 0, min: 0, max: 3, step: 0.1, unit: '%', format: (v) => `${v ? `${v.toFixed(1)}% of the size` : 'none — cut on the letters'}`, help: 'Stay under half the stroke width or letters merge into a blob.' },
    { kind: 'number', key: 'smoothing', label: 'Rounded corners', section: 'Size & border', value: 0, min: 0, max: 4, step: 0.1, unit: '%', format: (v) => `${v.toFixed(1)}% of the size`, help: 'Rounds the inside corner where two letters meet, zero keeps original curves.' },
    { kind: 'number', key: 'letterSpacing', label: 'Letter spacing', section: 'Lettering', value: 0, min: -0.2, max: 0.3, step: 0.01, format: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`, help: 'Negative pulls letters together, any gap left is overlapped or bridged.' },
    { kind: 'number', key: 'lineSpacing', label: 'Line spacing', section: 'Lettering', value: 1, min: 0.5, max: 1.8, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, visibleWhen: (v) => bool(v, 'twoLines') && str(v, 'line2').trim() !== '' },
    // Thicken, Connect and Letter lines — the three every connected-text design shares. Thicken
    // replaces the old Boldness: one control, named the way the thing is named, and the same
    // percentage-of-the-size decision at every letter height.
    //
    // How WIDE a joining bar is, which is a question only once there are bars: it sits right
    // under the "Join loose letters" switch that makes them, and is hidden until that is on —
    // hidden, never greyed.
    ...connectedTextFields('Lettering').flatMap((f): Field[] => (f.key !== 'bridges' ? [f] : [f, {
      kind: 'number', key: 'bridge', label: 'Bridge width', section: 'Lettering', value: 3, min: 1, max: 6, step: 0.5, unit: 'mm',
      help: 'Match this to your material, about 3 mm for plywood or acrylic.', visibleWhen: (v) => bool(v, 'bridges'),
    }])),
    ...keyringFields('none'),
  ],
  async build(v) {
    // The letters shape the outline either way; scored or engraved, they are drawn too. Off +
    // hugOnly is the engine's word for "material, not a line".
    const op = ['off', 'score', 'engrave'].includes(str(v, 'letterLines')) ? (str(v, 'letterLines') as 'off' | 'score' | 'engrave') : 'off';
    const size = num(v, 'size');
    const font = str(v, 'font');
    const text = str(v, 'text').trim();
    const line2 = bool(v, 'twoLines') ? str(v, 'line2').trim() : '';
    // One connected body, whichever way the face gets there (G31/G32): a script that joins on
    // its own is left exactly as the type designer spaced it, and anything else has each letter
    // walked into the one before it until they are really welded.
    const connect = connectSpec(font, size, share(size, num(v, 'thicken')));
    const drawn = await textLayer(
      {
        symbols: readSymbols(v), text: str(v, 'text'), line2: bool(v, 'twoLines') ? str(v, 'line2') : '',
        font, size, letterSpacing: num(v, 'letterSpacing'), lineSpacing: num(v, 'lineSpacing'),
        connect,
      },
      op === 'score' ? 'off' : op,
    );
    // Every i's and j's dot dropped onto its stem: the word is cut in ONE piece, and with Score on
    // the junction is scored like any other weld — without it "Paisley" came off the bed as
    // three pieces with nothing said.
    const layers = joinDots(drawn, weldOverlap(size));
    // Score means the SEAMS, not the letters: the material still follows the letters, and a
    // second copy of the same per-glyph islands is scored only where one letter is buried in the
    // next. Tracing the whole edge put a second burn along the cut — the weakest line on the
    // piece — and the inset version of that left a scratch off every letter.
    const material = op === 'engrave' ? layers : layers.map((l) => ({ ...l, op: 'off' as const, hugOnly: true }));
    // Only a WELDED word has seams. A connecting script's letters were drawn joined by the type
    // designer, and a line burnt at every join is a line across a script that is meant to read as
    // one stroke — so the seams belong to the faces the overlap walk had to weld, and Score is a
    // no-op on a face that needs no welding.
    const seams = op === 'score' && (connect.overlap ?? 0) > 0
      ? layers.map((l) => ({ ...l, id: `${l.id}-seam`, label: 'Letter seams', op: 'score' as const, seams: true }))
      : [];
    // Nothing typed is not a design: the engine's placeholder plate is a bare rounded rectangle,
    // and shown with no explanation a beginner who cleared the field to retype believes that IS
    // their piece.
    const empty = !text && !line2;
    // Two things a customer needs to hear before they cut, and never more than one of each: the
    // face does not join on its own (so the letters were overlapped and the seams scored), and
    // its counters are already under a millimetre at this size (the one thing thinning the
    // thicken cannot fix — the engine has already reduced it as far as it goes).
    const warnings = empty
      ? ['Type a word or name to see your design — this is a placeholder shape.']
      : [...connectWarning(font), ...countersTooTight(layers.flatMap((l) => l.shapes))];
    return {
      blank: {
        kind: 'hug',
        margin: share(size, num(v, 'border')),
        smoothing: share(size, num(v, 'smoothing')),
        bridge: Math.max(1, num(v, 'bridge')),
        counters: 'open',
        // One floor for the counters, not two. The engine's default seals any hole under 1.2 mm,
        // and on THIS design a counter is not a speck the border trapped — it is the hole in the
        // customer's "a", the whole reason the piece reads as a word. `MIN_COUNTER` is the number
        // the thicken is already capped by, so a face whose a's clear it by a hair keeps them
        // instead of having them filled in one step later.
        minHole: MIN_COUNTER,
        bridges: bridgeModeOf(v),
      },
      keyring: keyringFrom(v),
      layers: [...material, ...seams],
      ...(warnings.length ? { warnings } : {}),
    };
  },
  fileName: (v) => `${str(v, 'text') || 'text'}-connected`,
};

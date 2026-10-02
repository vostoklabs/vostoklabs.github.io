// QR table tent: two panels leaning on each other, two braces holding them apart, and the code on
// both faces — the Wi-Fi card for a café table, read from either side.
//
// One of four QR templates. Everything about the CODE — the payload, the four module styles, the
// symbol in the middle, the title/code/caption stack, the frame rule — is `qr-shared.ts`;
// everything about the TENT — the lean, the two slot levels, the brace spacing, the feet, the
// grip, whether it stands up — is `engine/tent.ts`, the facility the table sign is cut from.
//
// The old `aFrame` braced only one edge, so the pair scissored shut; the tent facility
// (engine/tent.ts) braces both.
//
// What is this file's own is where the code may go. The panel's clear rectangle already dodges
// the grip, the feet and the four brace slots, so the frame rule is drawn at exactly the inset
// that box implies — 9.9 mm at the shipped size, well past the house 6.5 %, because at the usual
// inset the rule would be cut into pieces by the slots (which is what the old build did).
//
// The facility's own header carries the arithmetic.
import { tentGeometry, tentPieces, type TentGeometry } from '../engine/tent';
import type { KeyringSpec } from '../engine/types';
import {
  clamp, composeFace, faceInset, fitOf, qrAssemblyFields, qrBorderField, qrCodeFields,
  qrContentFields, qrFontField, qrLetteringFields, qrTemplate, qrTextFields,
} from './qr-shared';
import { num, type Values } from './types';

/** A tent stands; it does not hang. The fit still wants to know there is no hole to dodge. */
const noRing = (): KeyringSpec => ({ enabled: false, mode: 'outside', side: 'top', along: 0.5, dia: 4, ring: 2.5, position: -1 });

/**
 * The lean, in degrees from the TABLE.
 *
 * The old build had `lean` = how far each panel leaned from VERTICAL (0–25°, default 12) and
 * opened the frame by twice it. The facility's `angle` is measured from the TABLE instead — the
 * same vocabulary as the table sign — so the key is new and an old project opens at the default.
 */
const angleOf = (v: Values): number => {
  const a = num(v, 'angle');
  return a >= 60 && a <= 82 ? a : 72;
};

const tent = (v: Values): TentGeometry => tentGeometry({
  panelW: clamp(num(v, 'width'), 40, 400),
  panelH: clamp(num(v, 'height'), 40, 400),
  t: clamp(num(v, 'thickness'), 0.5, 20),
  kerf: clamp(num(v, 'kerf'), 0, 2),
  clearance: fitOf(v),
  angle: angleOf(v),
});

export const qrTableTent = qrTemplate({
  id: 'qr-table-tent',
  name: 'QR table tent',
  blurb: 'A tent that stands on the table with the code on both sides.',
  tags: ['qr', 'sign', 'engrave + cut'],
  slug: 'tent',
  exportNote: 'Push each panel onto the braces’ four tabs, engraved faces outward.',
  fields: [
    ...qrContentFields(),
    ...qrTextFields('SCAN THE MENU', 'Drinks · Food'),
    ...qrCodeFields({ key: 'qrSize', value: 45, min: 15, max: 120 }),
    qrFontField(),
    ...qrLetteringFields(),
    qrBorderField(),

    // ------------------------------------------------------- LEFT: "Tent" (opens first) --
    { kind: 'number', key: 'width', label: 'Width', section: 'Tent', value: 95, min: 60, max: 200, step: 1, unit: 'mm' },
    {
      kind: 'number', key: 'height', label: 'Height', section: 'Tent', value: 130, min: 80, max: 250, step: 1, unit: 'mm',
      help: 'The panels lean, so the tent stands a little lower.',
    },

    // ------------------------------------------------------------------ LEFT: "More" --
    {
      kind: 'number', key: 'angle', label: 'Angle', section: 'Tent', value: 72, min: 60, max: 82, step: 1, unit: '°', advanced: true,
      help: 'How steeply each panel leans off the table.',
    },

    // -------------------------------------------- LEFT: "Assembly" (above "More options") --
    // Four slots and eight notches are cut to these three, and they were under More options with
    // no Fit at all. Declared last, which is what puts the category directly
    // above More options.
    ...qrAssemblyFields({ help: 'Measure your sheet, the joints are cut to match it.' }),
  ],

  face(v) {
    const g = tent(v);
    // The frame rule sits where the facility's clear box ends: any further out and the four
    // brace slots cut it into pieces.
    const margin = g.panelW / 2 - g.content.maxX;
    return {
      ring: g.panel,
      sizeKey: 'qrSize',
      plate: { w: g.panelW, h: g.panelH, corner: 0, arch: 0 },
      inset: Math.max(faceInset(g.panelW, g.panelH), margin),
      frameTop: g.content.maxY,
      frameBottom: g.content.minY,
      bareTop: g.content.maxY,
      bareBottom: g.content.minY,
      bareMargin: margin,
    };
  },

  assemble(v, _face, content) {
    const g = tent(v);
    // Both faces carry the same code: a tent read from the wrong side of the table is a sign that
    // does not work. The composer puts the content on the primary, so the FRONT set is empty here
    // and panel B takes the copy.
    const pieces = tentPieces(g, { front: [], back: content.layers, batched: v.__batch === true });
    return {
      label: pieces.label,
      blank: pieces.blank,
      keyring: noRing(),
      cuts: pieces.layers,
      parts: pieces.parts,
      pose: pieces.pose,
      warnings: g.warnings,
    };
  },
});

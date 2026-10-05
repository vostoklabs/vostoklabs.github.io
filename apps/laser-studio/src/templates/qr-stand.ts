// QR stand: a plate that leans back on two feet crossing under it, the code big and centred on
// its face — a counter sign, and the shape this
// template had before the evening of 2026-09-21.
//
// One of four QR templates. Everything about the CODE — the payload, the four module styles, the
// symbol in the middle, the title/code/caption stack, the frame rule — is `qr-shared.ts`;
// everything about the STAND — the half-lap, the feet, the balance, whether it stands up — is
// `engine/foot-stand.ts`.
//
// 2026-09-22: the crossing-planks build this replaces made no sense as a shape or a structure for
// a QR stand — two planks in an X with the code on a
// narrow diagonal blade. That construction is `engine/cross-stand.ts` and it is a PHONE stand: a
// phone leans in the V between the planks and the V is the product. Nothing leans on a QR code,
// so all the V does is turn the face into a strip 45 mm across — which is why this template's
// defaults had shrunk to one-word lines and a 30 mm code.
//
// WHAT THIS FILE DECIDES, and it is the whole file:
//
// 1. THE PLATE IS THE PRODUCT. It is the primary piece, the only one with anything on it, and
//    the only one the reader sees: the two feet run front to back, edge-on, and disappear behind
//    it. So the plate gets the shipped proportions of a countertop sign — 100 × 140 mm, a 45 mm
//    code centred on it with two full lines of type — and the facility's content box is a
//    rectangle the whole width of the plate rather than a strip.
//
// 2. The feet are cut from the SAME sheet and are one part cut twice, so the sheet is the plate
//    plus two humps beside it and the assembly is "slide a foot onto each slot".
//
// The facility's own header carries the arithmetic and the numbers it stands on.
import { footStandGeometry, footStandPieces, type FootStandGeometry } from '../engine/foot-stand';
import type { KeyringSpec } from '../engine/types';
import {
  clamp, composeFace, faceInset, fitOf, qrAssemblyFields, qrBorderField, qrCodeFields,
  qrContentFields, qrFontField, qrLetteringFields, qrTemplate, qrTextFields,
} from './qr-shared';
import { num, type Values } from './types';

/** A stand is free-standing: nothing here hangs from a ring. */
const noRing = (): KeyringSpec => ({ enabled: false, mode: 'outside', side: 'top', along: 0.5, dia: 4, ring: 2.5, position: -1 });

/**
 * The lean, in degrees from VERTICAL.
 *
 * The same key and the same meaning as the plate-and-feet build this restores (0–25°, default
 * 12). In between, for one day, `lean` was the crossing planks' angle from the TABLE (60–75°) —
 * so a project saved under that build would open lying nearly flat. Anything outside the range
 * the form offers is therefore an old file, and takes the default.
 */
const leanOf = (v: Values): number => {
  const a = num(v, 'lean');
  return a >= 0 && a <= 25 ? a : 12;
};

const stand = (v: Values): FootStandGeometry => footStandGeometry({
  width: clamp(num(v, 'width'), 60, 250),
  height: clamp(num(v, 'height'), 90, 320),
  t: clamp(num(v, 'thickness'), 0.5, 20),
  kerf: clamp(num(v, 'kerf'), 0, 2),
  clearance: fitOf(v),
  lean: leanOf(v),
  corner: clamp(num(v, 'corner'), 0, 40),
});

export const qrStand = qrTemplate({
  id: 'qr-stand',
  name: 'QR stand',
  blurb: 'A code people can actually scan, on a plate that stands on two feet.',
  tags: ['qr', 'sign', 'engrave + cut'],
  slug: 'stand',
  exportNote: 'Slide a foot onto each of the plate’s two slots from below.',
  fields: [
    ...qrContentFields(),
    ...qrTextFields('SCAN THE MENU', 'Drinks · Food · Allergens'),
    // 45 mm on a 100 mm plate: a vCard at the shipped toughness is 49 modules, so even the
    // longest of the four sample payloads engraves at 0.92 mm a module — half again over the
    // 0.6 mm burn floor — and the code and its quiet zone still leave 20 mm of plate either side.
    ...qrCodeFields({ key: 'qrSize', value: 45, min: 20, max: 120 }),
    qrFontField(),
    ...qrLetteringFields(),

    // ------------------------------------------------------ LEFT: "Stand" (the product) --
    { kind: 'number', key: 'width', label: 'Plate width', section: 'Stand', value: 100, min: 60, max: 250, step: 1, unit: 'mm' },
    {
      kind: 'number', key: 'height', label: 'Plate height', section: 'Stand', value: 140, min: 90, max: 320, step: 1, unit: 'mm',
      help: 'It leans, so the stand stands a little lower.',
    },
    {
      kind: 'number', key: 'lean', label: 'Lean', section: 'Stand', value: 12, min: 0, max: 25, step: 1, unit: '°',
      help: 'How far back the plate leans off vertical.',
    },
    { kind: 'number', key: 'corner', label: 'Corner radius', section: 'Stand', value: 9, min: 0, max: 30, step: 0.5, unit: 'mm' },
    qrBorderField('Stand'),

    // -------------------------------------------------------------- LEFT: "Assembly" --
    // Declared last, which is what puts the category at the end of the rail.
    ...qrAssemblyFields({ help: 'Measure your sheet, the slots are cut to match it.' }),
  ],

  face(v) {
    const g = stand(v);
    const margin = g.width / 2 - g.content.maxX;
    return {
      ring: g.plate,
      sizeKey: 'qrSize',
      // The plate really is the piece, so the composer measures its half-width in closed form.
      plate: { w: g.width, h: g.height, corner: 0, arch: 0 },
      // Never inside the plinth the two foot slots need: at the house 6.5 % the frame rule would
      // be cut into three pieces by the slots, which is what the first build of this did.
      inset: Math.max(faceInset(g.width, g.height), margin),
      frameTop: g.content.maxY,
      frameBottom: g.content.minY,
      bareTop: g.content.maxY,
      bareBottom: g.content.minY,
      bareMargin: margin,
    };
  },

  assemble(v) {
    const g = stand(v);
    // `qrTemplate` has already put the composed content on the primary and appends `cuts` after
    // it, so the facility is asked for the pieces with an empty face and its `layers` ARE the
    // plate's own cuts — the two foot slots.
    const pieces = footStandPieces(g, { face: [], batched: v.__batch === true });
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

// QR slot stand: an upright leaning back out of a flat base, with the code on its own plate
// glued to the front — a counter-top stand.
//
// One of four QR templates. Everything about the CODE — the payload, the four module styles, the
// symbol in the middle, the title/code/caption stack, the frame rule — is `qr-shared.ts`;
// everything about the JOINT — the tongue, the base's slot, where that slot has to sit for the
// thing to stand — is `engine/slot-stand.ts`, written for this template and the next sign that
// needs an upright.
//
// The previous geometry did not stand; rebuilt on engine/slot-stand.ts (2026-09-21).
// The old build (`slotBase` in engine/stands.ts) dropped a tongue into a base and then glued a
// separate LIP along the front to stop it falling over; this one has no lip, because a base
// that reaches in front of AND behind the upright does not need one.
//
// WHAT THIS FILE OWNS, and it is only two things:
//
// 1. The code is its own piece. The reference's code sits on a square plate mounted proud of the
//    upright, which is how a two-tone stand is made and how a shop gets a crisp code on light
//    stock over a dark body. "Raised" cuts that plate, scores where it glues and poses it on the
//    face; "Engrave" burns the code straight onto the upright instead. Because the composer puts
//    everything it lays out on the primary piece, this template drives `composeFace` itself and
//    moves the two code layers across — which is the whole reason it is not a `qrTemplate`.
//
// 2. The plate is a LOAD. It hangs off the upright's front face, which leans back, so the stand's
//    centre of mass moves with it; the facility takes its area and its height and solves the
//    slot's position from them. Switching to Engrave really does move the base's slot.
//
// The facility's own header carries the arithmetic.
import { bboxOf, placeShapes, roundedRectRing } from '@vostok/laser';
import { slotStandGeometry, slotStandPieces, type SlotStandGeometry } from '../engine/slot-stand';
import type { BuildInput, DesignLayer, KeyringSpec, PartInput } from '../engine/types';
import {
  QUIET, clamp, composeFace, faceInset, fitOf, qrAssemblyFields, qrBorderField, qrCodeFields,
  qrContentFields, qrFontField, qrLetteringFields, qrTextFields, round1,
} from './qr-shared';
import { lightPieceFields, stem } from './shared';
import { bool, num, str, type TemplateDef, type Values } from './types';

/** A stand is free-standing: nothing here hangs from a ring. */
const noRing = (): KeyringSpec => ({ enabled: false, mode: 'outside', side: 'top', along: 0.5, dia: 4, ring: 2.5, position: -1 });

/** Air round the code on its own plate, mm — never less than the code's own quiet zone, which
 *  has to be ON the plate or a scanner reads the upright's edge as a module. */
const PLATE_PAD = 3;
/** Air between the pieces on the sheet, mm. */
const SHEET_GAP = 8;

/**
 * The lean, in degrees from VERTICAL.
 *
 * The same key and the same meaning as the plate-and-base build this replaces (0–25°, default
 * 12), so an old project opens at the angle it was saved at; only the geometry under it changed.
 */
const leanOf = (v: Values): number => clamp(num(v, 'lean'), 0, 25);

const geometry = (v: Values, load: { area: number; y: number; t: number } | null): SlotStandGeometry =>
  slotStandGeometry({
    width: clamp(num(v, 'width'), 40, 300),
    height: clamp(num(v, 'height'), 60, 400),
    t: clamp(num(v, 'thickness'), 0.5, 20),
    kerf: clamp(num(v, 'kerf'), 0, 2),
    clearance: fitOf(v),
    lean: leanOf(v),
    corner: clamp(num(v, 'corner'), 0, 40),
    load,
  });

export const qrSlotStand: TemplateDef = {
  id: 'qr-slot-stand',
  name: 'QR slot stand',
  blurb: 'An upright that leans back in its base, with the code on a plate you glue on.',
  tags: ['qr', 'sign', 'engrave + score + cut'],
  fields: [
    ...qrContentFields(),
    ...qrTextFields('SCAN THE MENU', 'Drinks · Food'),
    ...qrCodeFields({ key: 'qrSize', value: 45, min: 15, max: 120 }),
    qrFontField(),
    ...qrLetteringFields(),
    qrBorderField(),

    // ------------------------------------------------------ LEFT: "Stand" (opens first) --
    { kind: 'number', key: 'width', label: 'Width', section: 'Stand', value: 90, min: 50, max: 250, step: 1, unit: 'mm' },
    {
      kind: 'number', key: 'height', label: 'Height', section: 'Stand', value: 120, min: 70, max: 300, step: 1, unit: 'mm',
      help: 'It leans, so the stand stands a little lower.',
    },
    // The shared control's own "Glue guide" tooltip is two clauses joined by a semicolon, which
    // the house copy rule does not allow (G22); said in one here. The real fix is in
    // `shared.ts`'s `lightPieceFields`.
    ...lightPieceFields('Stand', 'raised', { help: 'Raised cuts the code as a plate to glue on.' })
      .map((f) => (f.key === 'glue' ? { ...f, help: 'Scores where the code plate glues on.' } : f)),

    // ------------------------------------------------------------------ LEFT: "More" --
    { kind: 'number', key: 'corner', label: 'Corner radius', section: 'Stand', value: 10, min: 0, max: 30, step: 0.5, unit: 'mm', advanced: true, help: 'Rounds the upright’s two top corners.' },
    {
      kind: 'number', key: 'lean', label: 'Lean', section: 'Stand', value: 10, min: 0, max: 25, step: 1, unit: '°', advanced: true,
      help: 'How far back the upright leans off vertical.',
    },

    // -------------------------------------------- LEFT: "Assembly" (above "More options") --
    // The tongue and the base's slot are cut to these three, and they were scattered under More
    // options with no Fit at all. Declared last, which is what puts the
    // category directly above More options.
    ...qrAssemblyFields({ help: 'Measure your sheet, the slot is cut to match it.' }),
  ],

  async build(v): Promise<BuildInput> {
    const raised = str(v, 'lightOp') !== 'engrave';
    const t = clamp(num(v, 'thickness'), 0.5, 20);

    // The load is not known until the code is laid out, and the layout does not depend on the
    // load — the content box is the same either way — so the geometry is solved twice and only
    // the second one is used for the joint.
    const draft = geometry(v, null);
    const box = draft.content;
    const margin = draft.width / 2 - (box.maxX - box.minX) / 2;
    const content = await composeFace(v, {
      ring: draft.upright,
      sizeKey: 'qrSize',
      plate: { w: draft.width, h: draft.height, corner: 0, arch: 0 },
      inset: Math.max(faceInset(draft.width, draft.height), margin),
      frameTop: box.maxY,
      frameBottom: box.minY,
      bareTop: box.maxY,
      bareBottom: box.minY,
      bareMargin: margin,
    });

    // ------------------------------------------------------------------ the code's plate --
    const codeLayers = content.layers.filter((l) => l.id === 'code' || l.id === 'code-symbol');
    const cb = codeLayers.length ? bboxOf(codeLayers.flatMap((l) => l.shapes)) : null;
    // Inverted, the burnt panel already carries the quiet zone; upright, it has to be added.
    const quiet = bool(v, 'invert') ? 0 : QUIET * (content.qr?.cell ?? 0);
    const pad = Math.max(quiet, PLATE_PAD);
    const side = cb ? Math.max(cb.maxX - cb.minX, cb.maxY - cb.minY) + 2 * pad : 0;
    const at: [number, number] = cb ? [(cb.minX + cb.maxX) / 2, (cb.minY + cb.maxY) / 2] : [0, 0];
    const plateRing = roundedRectRing(side, side, Math.min(3, side / 6));
    const plate = raised && side > 4 && codeLayers.length > 0;

    const g = geometry(v, plate ? { area: side * side, y: at[1], t } : null);
    const m = g.metrics;

    // ------------------------------------------------------------------ the pieces --
    const face: DesignLayer[] = content.layers.filter((l) => !plate || !codeLayers.includes(l));
    const parts: PartInput[] = [];
    if (plate) {
      // Scored where it glues, so the plate goes on square instead of by eye.
      if (str(v, 'glue') === 'score') {
        face.push({
          id: 'glue', label: 'Glue guide', op: 'score', kind: 'guide',
          shapes: [[plateRing.map(([x, y]) => [x + at[0], y + at[1]] as [number, number])]],
        });
      }
      parts.push({
        id: 'code-plate',
        label: 'Code plate',
        blank: { kind: 'shape', shapes: [[plateRing]] },
        layers: codeLayers.map((l) => ({
          ...l,
          shapes: placeShapes(l.shapes, -at[0], -at[1], 0),
          ...(l.minus ? { minus: placeShapes(l.minus, -at[0], -at[1], 0) } : {}),
        })),
        keyring: 'none',
        material: 'light',
        ...(v.__batch === true ? {} : { at: { x: g.width / 2 + SHEET_GAP + side / 2, y: at[1] } }),
        assembledAt: { x: at[0], y: at[1] },
        z: 2,
        pose: g.facePose(at[0], at[1], t),
      });
    }

    const pieces = slotStandPieces(g, { face, raised: parts, batched: v.__batch === true });

    // ------------------------------------------------------------------ what to say --
    // The facility's own sentences first: whether the thing stands up outranks the type on it.
    const warnings = [...g.warnings, ...content.warnings];
    if (plate && side > g.width - 2 * margin + 0.01) {
      warnings.push(`The code plate is ${round1(side)} mm across and the upright gives ${round1(g.width - 2 * margin)} — shrink the code or widen the stand.`);
    }
    if (m.tipAngle < 20) warnings.push('This stand goes over easily — a deeper base or a shorter upright is steadier.');

    return {
      ...pieces,
      keyring: noRing(),
      ...(warnings.length ? { warnings } : {}),
    };
  },

  fileName: (v) => stem('qr', 'slot-stand', (str(v, 'title') || str(v, 'kind')).toLowerCase()),

  exportNote: (v) => (str(v, 'lightOp') === 'engrave'
    ? 'Drop the upright’s tongue through the base; it leans back on its own.'
    : 'Drop the upright’s tongue through the base, then glue the code plate on the scored square.'),
};

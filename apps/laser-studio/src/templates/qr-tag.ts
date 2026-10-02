// QR tag: one hanging piece — a title, the code, a caption, and a loop tab at the top.
//
// One of four QR templates, and the only one with no joint at all. The code, the payload, the
// four module styles, the symbol in the middle and the composition are `qr-shared.ts`.
//
// 2026-09-21: the tag is limited to a few shapes that can actually carry a code. At the FISH
// silhouette, 95 × 75, the code was invisible and "SCAN THE" ran off the body. A QR needs a square
// of clear material with four blank modules round it and two lines of type above and below; a
// fish, a heart and a paw do not have one. So the shape is not the whole library behind a "Change
// shape…" dialog any more: it is SEVEN tiles you can see, every one of which has a usable
// rectangular interior.
//
//   Rounded tag · Rectangle · Rounded rectangle · Arch · Swing tag · Shield · Circle
//
// The default is the rounded tag at 75 × 100 with a loop tab.
import { bboxOf, blankById, blankSilhouette } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import type { BuildInput } from '../engine/types';
import { keyringFields, keyringFrom } from './keyring';
import {
  faceMargin, qrBorderField, qrCodeFields, qrContentFields,
  qrFontField, qrLetteringFields, qrTemplate, qrTextFields,
} from './qr-shared';
import { blankShapes } from './shared';
import { str, type Values } from './types';

/**
 * The shapes a code fits on, in the order they read as products.
 *
 * Every one is a library blank whose interior is a rectangle or nearly one, so `composeFace`'s
 * inset outline gives the code and its quiet zone real room at every size. The circle is last
 * because it is the tightest: a square inside a disc is 0.71 of its diameter.
 */
const SHAPES: { id: string; label: string }[] = [
  { id: 'tag', label: 'Rounded tag' },
  { id: 'swing-tag', label: 'Swing tag' },
  { id: 'arch-tag', label: 'Arch' },
  { id: 'rounded', label: 'Rounded rect' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'shield', label: 'Shield' },
  { id: 'circle', label: 'Circle' },
];
const SHAPE_IDS = SHAPES.map((s) => s.id);
/** Only these three take a corner radius; the others have no corner to round. */
const HAS_CORNER = ['tag', 'rounded', 'rect'];

const shapeOf = (v: Values) => (SHAPE_IDS.includes(str(v, 'blank')) ? str(v, 'blank') : 'tag');

/** The tag's inset for the frame rule: a fixed 5 mm, not a fraction — a tag is small enough
 *  that the proportional rule puts the border on top of the lettering. */
const TAG_INSET = 5;

export const qrTag = qrTemplate({
  id: 'qr-tag',
  name: 'QR tag',
  blurb: 'A hanging tag with a code, two lines and a loop.',
  tags: ['qr', 'tag', 'engrave + cut'],
  slug: 'tag',
  exportNote: 'Scan the code off the screen with your phone before cutting a batch.',
  fields: [
    ...qrContentFields(),
    ...qrTextFields(),
    // 36 mm, not the 24 it shipped at. A vCard is the longest of the four sample payloads — 49
    // modules at the default toughness — and at 24 mm across that is a 0.49 mm module, under the
    // 0.6 mm burn floor: picking Contact used to hand you a code the laser cannot cut. At 36 the
    // same vCard is a 0.73 mm module, every payload clears its floor, and the code finally looks
    // like the thing the tag is FOR.
    ...qrCodeFields({ key: 'tagQrSize', value: 36, min: 12, max: 60 }),
    qrFontField(),
    ...qrLetteringFields(),
    qrBorderField(),
    // Seven tiles, not the shape library: the picker IS the restriction. `thumbs` shows
    // each silhouette at 40 × 40, which is how you pick a shape — by looking at it.
    {
      kind: 'thumbs', key: 'blank', label: 'Shape', section: 'Shape & size', value: 'tag', columns: 4,
      options: SHAPES.map((s) => ({ value: s.id, label: s.label, svgPath: silhouette(s.id) })),
      // Measured at the shipped default: the four rectangular shapes and the swing tag hold the
      // whole composition at 75 × 100; the arch loses 2 mm off the title, the shield squeezes
      // the caption where its lower field tapers, and a disc needs about 110 mm across. All of
      // that is said out loud on the status line as it happens — this is the one-line warning.
      help: 'The shield and the circle need a bigger tag.',
    },
    { kind: 'number', key: 'width', label: 'Width', section: 'Shape & size', value: 75, min: 55, max: 150, step: 1, unit: 'mm' },
    // A circle is as wide as it is tall by construction, so its height is not a control.
    { kind: 'number', key: 'height', label: 'Height', section: 'Shape & size', value: 100, min: 75, max: 200, step: 1, unit: 'mm', visibleWhen: (v) => shapeOf(v) !== 'circle' },
    { kind: 'number', key: 'corner', label: 'Corner radius', section: 'Shape & size', value: 8, min: 0, max: 30, step: 0.5, unit: 'mm', visibleWhen: (v) => HAS_CORNER.includes(shapeOf(v)) },
    // The loop tab, never a punched hole: the shared Ring control is Loop tab | None since
    // 2026-09-21. The nudge is half the
    // tag's own longest side, so the loop can reach any point ON the tag and nowhere else.
    ...keyringFields('outside', { dia: 4, ring: 3, side: 'top', along: 50, nudge: 50, maxDia: 8, maxRing: 6 }),
  ],

  face(v) {
    const shapes = blankShapes(v, 'tag');
    const ring = shapes[0]?.[0] ?? [];
    const box = bbox(ring);
    const margin = faceMargin(box.maxX - box.minX);
    const keyring = ringOf(v);
    // Only a punched hole eats into the face: a loop tab's hole sits outside the outline, so it
    // costs the composition nothing. (A later change maps every saved 'inside' to 'outside', so
    // this branch only ever fires on a file saved before tonight and opened before that lands.)
    const hardTop = keyring.enabled && keyring.mode === 'inside'
      ? box.maxY - (keyring.ring + keyring.dia + 2.5)
      : box.maxY - margin;
    return {
      ring,
      sizeKey: 'tagQrSize',
      inset: TAG_INSET,
      frameTop: box.maxY - TAG_INSET,
      frameBottom: box.minY + TAG_INSET,
      bareTop: box.maxY - margin,
      bareBottom: box.minY + margin,
      bareMargin: margin,
      hardTop,
    };
  },

  assemble(v) {
    const blank: BuildInput['blank'] = { kind: 'shape', shapes: blankShapes(v, 'tag') };
    return { blank, keyring: ringOf(v) };
  },
});

/** The ring spec, with 'inside' kept out of this design whatever a saved file says. */
function ringOf(v: Values) {
  const k = keyringFrom(v);
  return { ...k, enabled: str(v, 'ringMode') !== 'none' };
}

function silhouette(id: string): string | undefined {
  const def = blankById(id);
  return def ? blankSilhouette(def) : undefined;
}

const bbox = (ring: CutRing) => (ring.length > 2 ? bboxOf([[ring]]) : { minX: 0, minY: 0, maxX: 0, maxY: 0 });

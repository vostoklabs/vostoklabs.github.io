// Monogram: the initials, huge, carved into the front and running off its top-right corner on
// purpose. The card under the face's top layers prints in the accent, so the carving shows it: a
// two-colour monogram cut through a skin, which ink on paper cannot do. The name stands beside the
// initials, the contact lines run along the foot under them. The back, which that accent body shows
// through, carries the mark, the company and the QR on it.
import type { Box, Shapes } from '@vostok/shapes';
import type { Template } from '../build';
import { GUTTER } from '../layout';
import { GROUP_GAP, TITLE_RATIO, type LockupSlot } from '../lockup';
import { front, standardBack } from './common';
import { contactRoles, detailCap, EDGE, heightOf, nameWidth, pocketSpot } from './print-cards';

/** The initials' capital height at most, mm, and the share of them the edges crop: off the right
 *  edge, of the last letter's width (more and an S reads as a C), and off the top, of their height. */
const MONO_MAX = 34;
const CROP_RIGHT = 0.32;
const CROP_TOP = 0.16;

export const monogram: Template = {
  id: 'monogram',
  name: 'Monogram',
  group: 'clean',
  line: 'Your initials carved through to a second colour.',
  async front(ctx) {
    const { w, h } = ctx;
    const left = -w / 2 + EDGE;
    const right = w / 2 - EDGE;
    const top = h / 2 - EDGE;
    const bottom = -h / 2 + EDGE;
    const cap = detailCap(ctx);

    // The contact lines along the foot, across the card.
    const footRoles = contactRoles(ctx);
    const footTop = bottom + heightOf(ctx, footRoles, right - left);

    // The name's group at the top left, as wide as it is set.
    const titleW = ctx.measure(ctx.text.title) * Math.max(cap, TITLE_RATIO * ctx.s.nameSize);
    const groupRight = Math.min(right, left + Math.max(nameWidth(ctx, ctx.s.nameSize), titleW));

    // The initials in the corner the lettering leaves: as big as that room allows once the edges
    // have cropped them, never bigger than MONO_MAX.
    const initials = ctx.initials();
    const per = initials ? ctx.measure(initials) : 0;
    const crop = initials ? CROP_RIGHT * ctx.measure(Array.from(initials).pop()!) : 0;
    const roomW = w / 2 - (groupRight + GUTTER);
    const roomH = h / 2 - (footTop + GUTTER);
    const monoCap = per > 0 ? Math.min(MONO_MAX, roomW / (per - crop), roomH / (1 - CROP_TOP)) : 0;
    let carved: Box | null = null;
    let shapes: Shapes = [];
    if (monoCap > 8) {
      const width = per * monoCap;
      const x1 = w / 2 + crop * monoCap;
      const base = h / 2 + CROP_TOP * monoCap - monoCap;
      const mono = ctx.label(initials, { minX: x1 - 2 * width, maxX: x1, minY: base, maxY: base + monoCap }, { cap: monoCap, align: 'right', paint: 'logo' });
      if (mono) {
        shapes = mono.shapes;
        carved = { minX: x1 - width, maxX: x1, minY: base, maxY: base + monoCap };
      }
    }

    const nameRight = carved ? Math.min(right, carved.minX - GUTTER) : right;
    const slots: LockupSlot[] = [
      { box: { minX: left, maxX: nameRight, minY: footTop + GROUP_GAP * cap, maxY: top }, roles: front(ctx, ['name', 'rule', 'title', 'company']), align: 'left', valign: 'top' },
      { box: { minX: left, maxX: right, minY: bottom, maxY: top }, roles: footRoles, align: 'left', valign: 'bottom' },
    ];
    const lettering = ctx.lettering(slots);
    // A one-sided card's mark is the monogram itself; its QR has no room beside it (the build turns
    // this into its one sentence: print the back too, or turn the QR off).
    if (ctx.qrHere) ctx.warn('No room for the QR code on the front of this card.');

    // A tag behind the open space under the initials, right of the shorter contact lines.
    const pocket = pocketSpot(ctx, lettering.ink, [shapes], [w / 4 - 1, (footTop + (carved?.minY ?? top)) / 2 - 3]);
    return { ink: lettering.ink, carved: shapes, reveal: true, pocket };
  },
  async back(ctx) {
    // Under a reveal the whole body below the front's skin is the accent, the back's face with it:
    // the back is laid out on that colour.
    return standardBack(ctx, { fields: [[ctx.outline]], on: 'shapes' });
  },
};

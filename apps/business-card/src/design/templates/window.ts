// Window: a round hole right through the card, ringed in the accent: something a paper card cannot
// do. The name stands beside the window, the contact lines run under both, and a logo on the front
// takes the corner they leave.
//
// On the back the same window has its ring, and what the back carries stands in the middle of the
// card the window leaves: the mark over the back's line, or the QR over it. With both a QR and a mark
// the mark goes under the window, its foot level with the QR's block, so neither is squeezed.
import type { Box, Pt } from '@vostok/shapes';
import type { Ctx, Template } from '../build';
import { annulus, boxAt, boxW, disc, GUTTER } from '../layout';
import { CONTACTS, cornerLogoBox, FRONT_LOGO, NAME_GROUP, front, frontExtras, frontQrBox, standardBack } from './common';
import { heightOf } from './print-cards';

const MARGIN = 5.5;
const FOOT = 4.5;
/** The window's radius, and the ring round it: the gap, then its stroke, mm. A short card (50 mm)
 *  gets a smaller window, so the contact lines under it keep their room. */
const holeOf = (ctx: Ctx) => (ctx.h < 52 ? 5.5 : 6.5);
const GAP = 1.2;
const STROKE = 1.4;
/** The back's mark under the window, at its largest, mm. */
const BACK_MARK = 16;

/** The window's centre, on the front. */
const centre = (ctx: Ctx): Pt => [-ctx.w / 2 + MARGIN + holeOf(ctx) + GAP + STROKE + 1, ctx.h / 2 - MARGIN - holeOf(ctx) - GAP - STROKE - 0.5];

export const window_: Template = {
  id: 'window',
  name: 'Window',
  group: 'clean',
  line: 'A round window cut right through the card.',
  async front(ctx) {
    const { w, h } = ctx;
    const c = centre(ctx);
    const reach = holeOf(ctx) + GAP + STROKE;
    const qr = frontQrBox(ctx, MARGIN);
    // A logo on the front stands in the bottom-right corner, the contact lines keeping to its left;
    // where a QR on the front takes that corner, the logo goes to the top right, beside the name.
    const logo = !ctx.markHere ? null : qr ? cornerLogoBox(ctx, MARGIN) : boxAt(w / 2 - MARGIN - FRONT_LOGO / 2, -h / 2 + FOOT + FRONT_LOGO / 2, FRONT_LOGO, FRONT_LOGO);
    const contacts: Box = {
      minX: -w / 2 + MARGIN,
      maxX: qr ? qr.minX - GUTTER + 1.5 : logo ? logo.minX - GUTTER : w / 2 - MARGIN,
      minY: -h / 2 + FOOT,
      maxY: c[1] - reach - GUTTER,
    };
    // Beside the window the name's lines fill its height. With the company to set as well they are
    // a line taller than the window, so their slot reaches down to the contact lines' top and they
    // hang from its top.
    const company = !!ctx.text.company.trim();
    const foot = company ? Math.min(c[1] - reach, contacts.minY + heightOf(ctx, CONTACTS, boxW(contacts)) + GUTTER) : c[1] - reach;
    const lettering = ctx.lettering([
      { box: { minX: c[0] + reach + GUTTER, maxX: qr && logo ? logo.minX - GUTTER : w / 2 - MARGIN, minY: foot, maxY: h / 2 - MARGIN }, roles: front(ctx, NAME_GROUP), align: 'left', ...(company ? { valign: 'top' as const } : {}) },
      { box: contacts, roles: CONTACTS, align: 'left', valign: 'bottom' },
    ]);
    return {
      cutouts: [[disc(c[0], c[1], holeOf(ctx), 96)]],
      fields: annulus(c[0], c[1], reach, STROKE, 120),
      ink: [...lettering.ink, ...frontExtras(ctx, { qr, logo })],
      pocket: [w / 4, c[1] - reach / 2],
    };
  },
  async back(ctx) {
    const { w, h } = ctx;
    // From behind, the window is on the right.
    const [x, y] = centre(ctx);
    const c: Pt = [-x, y];
    const reach = holeOf(ctx) + GAP + STROKE;
    const fields = annulus(c[0], c[1], reach, STROKE, 120);
    // The card the window leaves: its margin all round, and the gutter and a millimetre off the ring.
    const free: Box = { minX: -w / 2 + MARGIN, maxX: c[0] - reach - GUTTER - 1, minY: -h / 2 + MARGIN, maxY: h / 2 - MARGIN };
    if (!ctx.qrHere || !ctx.markHere) {
      // The mark over the line, the QR over the line, or one of them alone: one block in the
      // middle of the card the window leaves.
      return { ...standardBack(ctx, { area: free }), fields };
    }
    // With a QR there is no room for the mark beside it: the QR (over the line) keeps the middle of
    // the card the window leaves, and the mark stands under the window, its foot on the block's.
    const ink = [...(standardBack({ ...ctx, markHere: false }, { area: free }).ink ?? [])];
    const foot = Math.min(...ink.flatMap((i) => i.shapes.flat(2).map(([, py]) => py)), c[1] - reach - GUTTER - BACK_MARK);
    const size = Math.min(BACK_MARK, 2 * reach, c[1] - reach - GUTTER - foot);
    const mark = size > 0 ? ctx.mark(boxAt(c[0], foot + size / 2, size, size)) : null;
    if (mark) ink.push(mark);
    return { fields, ink };
  },
};


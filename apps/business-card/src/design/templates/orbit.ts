// Orbit: a fine accent ring swings round the top-right corner, half of it off the card, with one
// small solid disc riding on it. The name sits beside the ring and the contact lines run under it.
// On the back the ring comes round whole, centred on the mark.
import type { Pt, Shapes } from '@vostok/shapes';
import type { Ctx, Template } from '../build';
import { annulus, boxAt, disc, GUTTER } from '../layout';
import { CONTACTS, NAME_GROUP, front, frontExtras, frontQrBox, standardBack } from './common';

const MARGIN = 5.5;
/** The ring's stroke and the riding disc's radius, mm. */
const STROKE = 1.4;
const MOON = 2.3;

/** The ring and its moon: centred at `c`, radius `r`, the moon at `deg` round it. */
function orbit(c: Pt, r: number, deg: number): Shapes {
  const a = (deg * Math.PI) / 180;
  const mr = r - STROKE / 2;
  return [...annulus(c[0], c[1], r, STROKE, 160), [disc(c[0] + mr * Math.cos(a), c[1] + mr * Math.sin(a), MOON, 48)]];
}

/** The front's ring: about a third of the card's height across, centred near the top-right corner. */
const frontRing = (ctx: Ctx) => {
  const r = 0.27 * ctx.h;
  return { c: [ctx.w / 2 - 0.15 * ctx.w, ctx.h / 2 - 0.15 * ctx.h] as Pt, r };
};

export const orbit_: Template = {
  id: 'orbit',
  name: 'Orbit',
  group: 'shapes',
  line: 'A ring circles your logo.',
  async front(ctx) {
    const { w, h } = ctx;
    const { c, r } = frontRing(ctx);
    const left = c[0] - r - MOON;
    const bottom = c[1] - r - MOON;
    const qr = frontQrBox(ctx, MARGIN);
    // A logo on a one-sided card sits in the ring, on the card.
    const logoSize = Math.min(13, r);
    const logo = ctx.markHere ? boxAt(Math.min(c[0], w / 2 - MARGIN - logoSize / 2), Math.min(c[1], h / 2 - MARGIN - logoSize / 2), logoSize, logoSize) : null;
    const lettering = ctx.lettering([
      { box: { minX: -w / 2 + MARGIN, maxX: left - GUTTER, minY: bottom, maxY: h / 2 - MARGIN }, roles: front(ctx, NAME_GROUP), align: 'left', valign: 'top' },
      { box: { minX: -w / 2 + MARGIN, maxX: qr ? qr.minX - GUTTER + 1.5 : w / 2 - MARGIN, minY: -h / 2 + 4.5, maxY: bottom - GUTTER }, roles: CONTACTS, align: 'left', valign: 'bottom' },
    ]);
    return { fields: orbit(c, r, 205), ink: [...lettering.ink, ...frontExtras(ctx, { qr, logo })], pocket: [-w / 6, -h / 8] };
  },
  async back(ctx) {
    const { w, h } = ctx;
    const margin = 4.5;
    // The ring round the mark, on the left when the QR takes the right.
    const r = Math.min(0.36 * h, ctx.qrHere ? w / 4 - 6.5 : 0.4 * h);
    const c: Pt = ctx.qrHere ? [-w / 2 + margin + r, 2] : [0, 2];
    const markSize = r * 1.05;
    const mark = ctx.markHere ? ctx.mark(boxAt(c[0], c[1], markSize, markSize)) : null;
    const rest = standardBack(ctx, {
      area: ctx.qrHere ? { minX: c[0] + r + GUTTER, maxX: w / 2 - margin, minY: -h / 2 + margin, maxY: h / 2 - margin } : { minX: -w / 2 + margin, maxX: w / 2 - margin, minY: -h / 2 + 4, maxY: c[1] - r - 1 },
      mark: false,
    });
    return { fields: orbit(c, r, 205), ink: [...(mark ? [mark] : []), ...(rest.ink ?? [])] };
  },
};

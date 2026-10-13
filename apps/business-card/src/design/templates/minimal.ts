// Minimal: the name, a short accent rule, the title and the company, then the contact lines with
// their icons, in one left-aligned block at the card's optical centre. Nothing else on the front:
// the space is the design. The back carries the mark, the company and the QR.
import type { Template } from '../build';
import { GUTTER } from '../layout';
import { ALL, cornerLogoBox, front, frontExtras, frontQrBox, logoOnFront, standardBack } from './common';

const MARGIN = 5.5;

export const minimal: Template = {
  id: 'minimal',
  name: 'Minimal',
  group: 'clean',
  line: 'Your name and details, and nothing else.',
  async front(ctx) {
    const { w, h } = ctx;
    const qr = frontQrBox(ctx, MARGIN);
    const logo = logoOnFront(ctx) ? cornerLogoBox(ctx, MARGIN) : null;
    const right = qr ? qr.minX - GUTTER + 1.5 : logo ? logo.minX - GUTTER : w / 2 - MARGIN;
    const lettering = ctx.lettering([{ box: { minX: -w / 2 + MARGIN, maxX: right, minY: -h / 2 + MARGIN, maxY: h / 2 - MARGIN }, roles: front(ctx, ALL), align: 'left' }]);
    return { ink: [...lettering.ink, ...frontExtras(ctx, { qr, logo })], pocket: [w / 2 - 15, h / 2 - 15] };
  },
  async back(ctx) {
    return standardBack(ctx);
  },
};

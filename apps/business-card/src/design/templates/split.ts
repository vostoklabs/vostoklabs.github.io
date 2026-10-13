// Split: the top of the card is an accent band with a soft wave for its lower edge, and the name,
// the title and the company (when it is on the front) stand on it in the colour that reads best
// there (dark letters raised on a light accent, or knocked out of it on a flush card); short of
// room, title and company share a line. The contact lines sit on the plain card below. The back
// is all accent: the mark, the back's line and the QR in the card's own colour.
import type { Pt, Ring } from '@vostok/shapes';
import type { Ctx, Template } from '../build';
import { GUTTER } from '../layout';
import { front, frontExtras, frontQrBox, logoOnFront, standardBack } from './common';

const MARGIN = 5.5;
/** The band's depth, as a share of the card's height, and its wave: height and length, mm. */
const BAND = 0.42;
const WAVE = 1.6;
const WAVELENGTH = 0.95;
/** The height the contact lines need under the band, mm. */
const CONTACTS_ROOM = 18;

/** The band as one ring: the wave across, closed above the card (the worker keeps the part on it). */
function band(ctx: Ctx): { ring: Ring; low: number; high: number } {
  const { w, h } = ctx;
  // On a short card the band gives up depth before the contact lines below it give up their room.
  const base = Math.max(h / 2 - BAND * h, -h / 2 + MARGIN + CONTACTS_ROOM + GUTTER + WAVE);
  const steps = 96;
  const wave: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = -w / 2 - 1 + ((w + 2) * i) / steps;
    wave.push([x, base + WAVE * Math.sin((2 * Math.PI * x) / (WAVELENGTH * w) + 0.6)]);
  }
  // Anticlockwise: along the wave left to right, then back across above the card.
  const ring: Ring = [...wave, [w / 2 + 1, h / 2 + 1], [-w / 2 - 1, h / 2 + 1]];
  return { ring, low: base - WAVE, high: base + WAVE };
}

export const split: Template = {
  id: 'split',
  name: 'Split',
  group: 'clean',
  line: 'A wave of colour across the top holds your name.',
  async front(ctx) {
    const { w, h } = ctx;
    const { ring, low, high } = band(ctx);
    const qr = frontQrBox(ctx, MARGIN);
    // A logo on the front takes the card's foot corner beside the contact lines, leaving the band's
    // width to the name's group; when the QR has that corner, the logo stands on the band.
    const LOGO = 11;
    const onBand = !!qr;
    const logo = !logoOnFront(ctx) ? null : onBand
      ? { minX: w / 2 - MARGIN - LOGO, maxX: w / 2 - MARGIN, minY: high + 2.5, maxY: high + 2.5 + LOGO }
      : { minX: w / 2 - MARGIN - LOGO, maxX: w / 2 - MARGIN, minY: -h / 2 + MARGIN, maxY: -h / 2 + MARGIN + LOGO };
    const lettering = ctx.lettering([
      {
        box: { minX: -w / 2 + MARGIN, maxX: logo && onBand ? logo.minX - GUTTER : w / 2 - MARGIN, minY: high + 2.5, maxY: h / 2 - 4 },
        roles: front(ctx, ['name', 'title', 'company']),
        align: 'left',
        on: 'shapes',
      },
      {
        box: { minX: -w / 2 + MARGIN, maxX: qr ? qr.minX - GUTTER + 1.5 : logo ? logo.minX - GUTTER : w / 2 - MARGIN, minY: -h / 2 + MARGIN, maxY: low - GUTTER },
        roles: ['phone', 'email', 'web'],
        align: 'left',
      },
    ], { rule: false });
    const mark = logo ? ctx.mark(logo, { on: onBand ? 'shapes' : 'card' }) : null;
    return { fields: [[ring]], ink: [...lettering.ink, ...frontExtras(ctx, { qr, logo: null }), ...(mark ? [mark] : [])], pocket: [w / 4, -h / 5] };
  },
  async back(ctx) {
    return standardBack(ctx, { fields: [[ctx.outline]], on: 'shapes' });
  },
};

// Swoosh: a broad accent curve sweeps in from the right edge, a thin line of card echoing its edge
// inside it, and the lettering stands in the space it leaves. On the back the curve comes in from
// the other side and holds the mark; the QR sits on the plain card beside it.
import type { Box, Ring, Shapes } from '@vostok/shapes';
import type { Ctx, Template } from '../build';
import { annulus, boxAt, disc, GUTTER } from '../layout';
import { ALL, front, FRONT_LOGO, frontExtras, frontQrBox, logoOnFront, standardBack } from './common';

const MARGIN = 5.5;
/** How far into the card the curve reaches: at its middle, and where it meets the top and bottom
 *  edges, as a share of the card's width. */
const REACH_MID = 0.25;
const REACH_EDGE = 0.12;
/** The line of card inside the curve: how far in from its edge, and how wide, mm. */
const ECHO_IN = 2.4;
const ECHO_W = 0.8;

/** The circle whose part on the card is the curve: through the mid point and the two edge points. */
function curve(ctx: Ctx): { cx: number; r: number; left: number } {
  const left = ctx.w / 2 - REACH_MID * ctx.w;
  const edge = ctx.w / 2 - REACH_EDGE * ctx.w;
  const half = ctx.h / 2;
  const d = edge - left;
  const r = (half * half + d * d) / (2 * d);
  return { cx: left + r, r, left };
}

/** A one-sided card's logo: inside the curve's echo line, by the right margin, as large (up to the
 *  front's logo size) and as high as the line lets a square stand clear of it. */
function logoInCurve(ctx: Ctx): Box {
  const { cx, r } = curve(ctx);
  const inside = r - ECHO_IN - ECHO_W - 1;
  for (let side = FRONT_LOGO; side > 6; side -= 0.5) {
    const x = ctx.w / 2 - MARGIN - side / 2;
    const reach = inside - side / Math.SQRT2;
    if (reach > cx - x) return boxAt(x, Math.min(ctx.h / 2 - MARGIN - side / 2, Math.sqrt(reach * reach - (cx - x) ** 2)), side, side);
  }
  return boxAt(ctx.w / 2 - MARGIN - 3, 0, 6, 6);
}

function sweep(ctx: Ctx, side: 1 | -1): { fields: Shapes; gaps: Shapes; left: number } {
  const { cx, r, left } = curve(ctx);
  const field: Ring = disc(side * cx, 0, r, 160);
  return { fields: [[field]], gaps: annulus(side * cx, 0, r - ECHO_IN, ECHO_W, 160), left };
}

export const swoosh: Template = {
  id: 'swoosh',
  name: 'Swoosh',
  group: 'shapes',
  line: 'A curve of colour sweeps in from the edge.',
  async front(ctx) {
    const { w, h } = ctx;
    const { fields, gaps, left } = sweep(ctx, 1);
    // On a one-sided card the QR and the logo sit on the curve.
    const qr = frontQrBox(ctx, MARGIN);
    const logo = logoOnFront(ctx) ? logoInCurve(ctx) : null;
    const lettering = ctx.lettering([{ box: { minX: -w / 2 + MARGIN, maxX: left - GUTTER, minY: -h / 2 + MARGIN, maxY: h / 2 - MARGIN }, roles: front(ctx, ALL), align: 'left' }]);
    return { fields, gaps, ink: [...lettering.ink, ...frontExtras(ctx, { qr, logo, on: 'shapes' })], pocket: [-w / 6, 0] };
  },
  async back(ctx) {
    const { w, h } = ctx;
    const { fields, gaps, left } = sweep(ctx, -1);
    // The mark stands in the curve, clear of its echo line; the company and the QR on the card.
    const inner = -(left + ECHO_IN + ECHO_W) - 2;
    const outer = -w / 2 + 3;
    const markSize = Math.min(16, inner - outer);
    const mark = ctx.markHere ? ctx.mark(boxAt((inner + outer) / 2, 0, markSize, markSize), { on: 'shapes' }) : null;
    const rest = standardBack(ctx, { area: { minX: -left + GUTTER + 2, maxX: w / 2 - 6, minY: -h / 2 + 4.5, maxY: h / 2 - 4.5 }, mark: false });
    return { fields, gaps, ink: [...(mark ? [mark] : []), ...(rest.ink ?? [])] };
  },
};

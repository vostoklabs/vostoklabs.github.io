// Sash: a band runs corner to corner across the front, with a thin stripe running beside it, and
// the lettering keeps to the two triangles it leaves: the name in the top-right one, the contact
// lines in the bottom-left, their longest line at the foot where the triangle is widest. The band
// is fitted to the lettering once it is set, so it never comes nearer the letters than the gutter.
// On the back the same band crosses the top-left corner, and the mark, the company and the QR take
// the rest.
import type { Pt, Ring, Shapes } from '@vostok/shapes';
import type { Ctx, Template } from '../build';
import { clipConvex, GUTTER } from '../layout';
import type { LockupSlot } from '../lockup';
import type { Ink } from '../types';
import { standardBack } from './common';
import { contactRoles, EDGE, inkIn, pocketSpot, pointsOf } from './print-cards';

/** The band and its stripe, mm across: the band as wide as it may be and no narrower than it may
 *  be; the card line between band and stripe; the stripe. */
const BAND_MAX = 9;
const BAND_MIN = 3;
const LINE = 1.1;
const STRIPE = 1.4;
/** The back's band, mm across, and how far in from the top-left corner its middle crosses the
 *  corner's diagonal, a share of that diagonal. */
const BACK_BAND = 7;
const BACK_IN = 0.1;

/** A band along the line y = s·x + c, from `from` to `to` across it (measured along its normal
 *  from the line), as one ring long enough to cross the card. */
function bandRing(s: number, c: number, from: number, to: number, reach: number): Ring {
  const n = Math.hypot(1, s);
  const nx = -s / n;
  const ny = 1 / n;
  const at = (x: number, d: number): Pt => [x + nx * d, s * x + c + ny * d];
  return [at(-reach, from), at(reach, from), at(reach, to), at(-reach, to)];
}

/** The band and its stripe as fields on the card: the band `band` across, centred on y = s·x + c,
 *  and the stripe beside it on the side `stripeSide` (+1 the side the normal points to, -1 the
 *  other). */
function sash(ctx: Ctx, s: number, c: number, band: number, stripeSide: 1 | -1): Shapes {
  const reach = ctx.w;
  const half = band / 2;
  const rings: Ring[] = [bandRing(s, c, -half, half, reach)];
  const a = stripeSide * (half + LINE);
  const b = stripeSide * (half + LINE + STRIPE);
  rings.push(bandRing(s, c, Math.min(a, b), Math.max(a, b), reach));
  // Wound anticlockwise and kept to the card (the worker clips again; the picture wants it too).
  return rings.map((r) => clipConvex(ccw(r), ctx.outline)).filter((r) => r.length >= 3).map((r): Ring[] => [r]);
}

const ccw = (r: Ring): Ring => {
  let a = 0;
  for (let i = 0; i < r.length; i++) a += r[i]![0] * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * r[i]![1];
  return a < 0 ? r.slice().reverse() : r;
};

/** The widest band (and where its centre line runs) that clears both sets of points by the gutter:
 *  `above` must lie on the side the normal points to, `below` on the other. */
function fit(above: Pt[], below: Pt[], s: number): { c: number; room: number } {
  // The distance along the normal of a point from the line y = s·x (the normal points up-right
  // for a falling band, up-left for a rising one).
  const n = Math.hypot(1, s);
  const d = ([x, y]: Pt) => (y - s * x) / n;
  // With nothing on one side the band keeps to the corners' line, or clear of the other side.
  const free = BAND_MAX + LINE + STRIPE + 2 * GUTTER;
  const lo = below.length ? Math.max(...below.map(d)) : Math.min(-free / 2, (above.length ? Math.min(...above.map(d)) : free / 2) - free);
  const hi = above.length ? Math.min(...above.map(d)) : Math.max(free / 2, lo + free);
  const room = hi - lo - 2 * GUTTER;
  return { c: ((hi + lo) / 2) * n, room };
}

export const sash_: Template = {
  id: 'sash',
  name: 'Sash',
  group: 'shapes',
  line: 'A band of colour runs corner to corner.',
  async front(ctx) {
    const { w, h } = ctx;
    const left = -w / 2 + EDGE;
    const right = w / 2 - EDGE;
    const top = h / 2 - EDGE;
    const bottom = -h / 2 + EDGE;

    // The lettering first, pushed into the two corners the band leaves free.
    const name: LockupSlot = { box: { minX: left, maxX: right, minY: bottom, maxY: top }, roles: ['name', 'title', ...(ctx.text.company.trim() ? (['company'] as const) : [])], align: 'right', valign: 'top' };
    const contacts: LockupSlot = { box: { minX: left, maxX: right, minY: bottom, maxY: top }, roles: contactRoles(ctx), align: 'left', valign: 'bottom' };
    const lettering = ctx.lettering([name, contacts], { rule: false });
    const [nameBlock, contactBlock] = lettering.blocks;
    const above = pointsOf(inkIn(lettering.ink, nameBlock!));
    const below = pointsOf(inkIn(lettering.ink, contactBlock!));

    // The band from the top-left corner to the bottom-right one, as wide as the lettering allows;
    // flatter only if the lettering leaves it no room at the corners' slope.
    let s = -h / w;
    let best = fit(above, below, s);
    for (let k = 0.9; best.room < BAND_MIN + LINE + STRIPE && k > 0.3; k -= 0.1) {
      const f = fit(above, below, (-h / w) * k);
      if (f.room > best.room) [best, s] = [f, (-h / w) * k];
    }
    const band = Math.max(0, Math.min(BAND_MAX, best.room - LINE - STRIPE));
    const ink: Ink[] = [...lettering.ink];
    // A one-sided card has no room for its QR or its mark: the QR is said (the build turns it into
    // its one sentence), the mark left out, as the band is the card's mark here.
    if (ctx.qrHere) ctx.warn('No room for the QR code on the front of this card.');
    if (band < 0.8) return { ink };
    // The stripe on the contact lines' side, the band centred in what is left.
    const total = band + LINE + STRIPE;
    const c = best.c + ((total / 2 - band / 2) * Math.hypot(1, s));
    const fields = sash(ctx, s, c, band, -1);
    // A tag behind open card, clear of the band and the lettering.
    return { fields, ink, pocket: pocketSpot(ctx, ink, [fields], [w / 4, -h / 6]) };
  },
  async back(ctx) {
    const { w, h } = ctx;
    // From behind, the band rises; it crosses the top-left corner, clear of what the back lays out.
    const s = h / w;
    const total = BACK_BAND + LINE + STRIPE;
    // Its middle crosses the corner's diagonal BACK_IN of the way in, the stripe on the corner's side.
    const p: Pt = [-w / 2 + BACK_IN * w, h / 2 - BACK_IN * h];
    const c = p[1] - s * p[0];
    const fields = sash(ctx, s, c, BACK_BAND, 1);
    // The area starts where the band's lower edge, and the gutter, leave the top margin.
    const n = Math.hypot(1, s);
    const margin = 5;
    const x0 = Math.max(-w / 2 + margin, (h / 2 - margin - (c - (total / 2 + GUTTER) * n)) / s);
    return standardBack(ctx, { area: { minX: x0, maxX: w / 2 - margin, minY: -h / 2 + margin, maxY: h / 2 - margin }, fields });
  },
};

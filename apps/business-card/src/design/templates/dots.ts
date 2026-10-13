// Dots: a big quarter disc fills the bottom-right corner with the mark standing in it, and two
// smaller discs climb the right-hand side away from it, a medium one rolling off the right edge and
// a small one off the top: three sizes, one rhythm. The lettering stands in one block on the plain
// card, top left, and the big disc is as big as that block leaves room for. On the back the discs
// climb the other side, round the QR.
import type { Pt, Shapes } from '@vostok/shapes';
import type { Template } from '../build';
import { boxAt, disc, GUTTER } from '../layout';
import type { Role } from '../lockup';
import type { Ink } from '../types';
import { front, standardBack } from './common';
import { contactRoles, EDGE, pocketSpot, pointsOf } from './print-cards';

/** The big disc's radius at most, as a share of the card's height; the back's. */
const BIG = 0.62;
const BACK = 0.44;
/** The medium and the small disc's radii, as a share of the big one's; the air between the big
 *  disc and the medium one, mm; how far past the edge their middles sit, a share of their radius. */
const MID = 0.27;
const SMALL = 0.12;
const AIR = 2.6;
const OFF = 0.25;
/** Where along the top edge the small disc rolls off, in from the side the discs climb, a share of
 *  the card's width. */
const SMALL_IN = 0.17;
/** The mark's square against the big disc's radius. */
const MARK = 0.46;

interface Discs {
  fields: Shapes;
  /** The mark's square inside the big disc. */
  mark: { c: Pt; size: number };
  /** The medium disc, for what the lettering keeps clear of. */
  mid: { c: Pt; r: number };
  small: { c: Pt; r: number };
}

/** The discs climbing the side `side` (+1 right, -1 left) of a `w` × `h` card, the big one of
 *  radius `R` in that side's bottom corner. */
function discs(w: number, h: number, R: number, side: 1 | -1): Discs {
  const cx = (side * w) / 2;
  const corner: Pt = [cx, -h / 2];
  const midR = MID * R;
  const mid: Pt = [cx + side * OFF * midR, -h / 2 + R + AIR + midR];
  const smallR = SMALL * R;
  const small: Pt = [cx - side * SMALL_IN * w, h / 2 + OFF * smallR];
  const k = 0.45 * R;
  return {
    fields: [[disc(corner[0], corner[1], R, 160)], [disc(mid[0], mid[1], midR, 96)], [disc(small[0], small[1], smallR, 64)]],
    mark: { c: [cx - side * k, -h / 2 + k], size: MARK * R },
    mid: { c: mid, r: midR },
    small: { c: small, r: smallR },
  };
}

/** How far the nearest of `pts` is from `c`, mm. */
const nearest = (pts: Pt[], c: Pt) => pts.reduce((m, [x, y]) => Math.min(m, Math.hypot(x - c[0], y - c[1])), Infinity);

export const dots: Template = {
  id: 'dots',
  name: 'Dots',
  group: 'shapes',
  line: 'Circles rise from the corner.',
  async front(ctx) {
    const { w, h } = ctx;
    const left = -w / 2 + EDGE;
    const right = w / 2 - EDGE;
    const top = h / 2 - EDGE;
    const bottom = -h / 2 + EDGE;

    // The lettering in one block, top left, the longest contact line in the middle where the disc
    // curves away from it.
    const roles: Role[] = [...front(ctx, ['name', 'title', 'company']), ...contactRoles(ctx, ['phone', 'email', 'web'])];
    const lettering = ctx.lettering([{ box: { minX: left, maxX: right, minY: bottom, maxY: top }, roles, align: 'left', valign: 'top' }], { rule: false });

    // The big disc as big as the lettering leaves room for, the smaller ones clear of it too.
    const pts = pointsOf(lettering.ink);
    const clear = (c: Pt, r: number) => !pts.length || nearest(pts, c) - GUTTER >= r;
    let R = BIG * h;
    for (; R > 10; R -= 0.5) {
      const d = discs(w, h, R, 1);
      if (clear([w / 2, -h / 2], R) && clear(d.mid.c, d.mid.r) && clear(d.small.c, d.small.r)) break;
    }
    const d = discs(w, h, R, 1);
    const ink: Ink[] = [...lettering.ink];
    if (ctx.hasMark) {
      const m = ctx.mark(boxAt(d.mark.c[0], d.mark.c[1], d.mark.size, d.mark.size), { on: 'shapes' });
      if (m) ink.push(m);
    }
    // A one-sided card's QR has no room here (the build turns this into its one sentence).
    if (ctx.qrHere) ctx.warn('No room for the QR code on the front of this card.');
    // A tag behind the open card between the lettering and the big disc.
    const pocket = pocketSpot(ctx, ink, [d.fields], [w / 2 - R - 6, -h / 2 + R * 0.55]);
    return { fields: d.fields, ink, pocket };
  },
  async back(ctx) {
    const { w, h } = ctx;
    // From behind, the discs climb the left side; the QR and the company take the rest, and the
    // mark too when there is no QR (with one, the mark is the front's).
    const R = BACK * h;
    const d = discs(w, h, R, -1);
    const margin = 5;
    const minX = -w / 2 + Math.max(R, d.mid.c[0] + w / 2 + d.mid.r, d.small.c[0] + w / 2 + d.small.r) + GUTTER;
    const area = { minX, maxX: w / 2 - margin, minY: -h / 2 + margin, maxY: h / 2 - margin };
    return standardBack(ctx, { area, fields: d.fields, mark: !ctx.qrHere });
  },
};

// Split Name: the card is two colours, split by a straight slanting edge, and the name runs across
// the split and changes colour as it crosses: light on the dark side, dark on the light, from two
// filaments and no knockout tricks. The edge is set from the lettering: it cuts the name about its
// middle, then slants away down the card clear of the contact lines, which keep to the plain side,
// their longest line at the foot where the field is narrowest. On the back the field comes round
// from the other side, holding the mark, and the QR and the company stand on the plain card.
import type { Pt, Ring, Shapes } from '@vostok/shapes';
import { contrastRatio } from '@vostok/ui-kit';
import type { Ctx, Template } from '../build';
import { boxAt, clipConvex, GUTTER } from '../layout';
import type { Ink, Role } from '../types';
import { standardBack } from './common';
import { contactRoles, EDGE, inkIn, pocketSpot, pointsOf } from './print-cards';

/** The least slant of the edge, mm across per mm down, and the most. */
const SLANT_MIN = 0.35;
const SLANT_MAX = 2.2;
/** Where the edge cuts the name, a share of its width. */
const CUT = 0.5;
/** The back's mark on its field, mm at most, and a one-sided front's mark on its field. */
const MARK = 15;
const SMALL_MARK = 11;
/** The straight edge the field's edge keeps past a rounded corner, mm. */
const SLIVER = 2.5;

/** The edge as x = x1 + k·(y1 − y): through (x1, y1), slanting right as it goes down by k. */
interface Edge {
  x1: number;
  y1: number;
  k: number;
}
const xAt = (e: Edge, y: number) => e.x1 + e.k * (e.y1 - y);

/** The part of the card right of the edge (`side` +1) or left of it (−1). */
function fieldOf(ctx: Ctx, e: Edge, side: 1 | -1): Shapes {
  const yT = ctx.h;
  const yB = -ctx.h;
  const far = side * ctx.w;
  const quad: Ring = [[xAt(e, yB), yB], [far, yB], [far, yT], [xAt(e, yT), yT]];
  const ring = clipConvex(side > 0 ? quad : quad.slice().reverse(), ctx.outline);
  return ring.length >= 3 ? [[ring]] : [];
}

/** The colour a piece takes on the field: the one picked for it there, unless that reads worse
 *  than the card's own colour or the piece's own does. */
function onField(ctx: Ctx, paint: Role): string {
  const field = ctx.colour('shapes');
  const choices = [ctx.colour(paint, 'shapes'), ctx.colour('card'), ctx.colour(paint)];
  return choices.reduce((a, b) => (contrastRatio(b, field) > contrastRatio(a, field) + 0.01 ? b : a));
}

export const splitName: Template = {
  id: 'split-name',
  name: 'Split name',
  group: 'shapes',
  line: 'Your name changes colour across a diagonal.',
  async front(ctx) {
    const { w, h } = ctx;
    const left = -w / 2 + EDGE;
    const right = w / 2 - EDGE;
    const top = h / 2 - EDGE;
    const bottom = -h / 2 + EDGE;

    // The lettering first: the name's group top left, the contact lines at the foot.
    const lettering = ctx.lettering([
      { box: { minX: left, maxX: right, minY: bottom, maxY: top }, roles: ['name', 'title', ...(ctx.text.company.trim() ? (['company'] as const) : [])], align: 'left', valign: 'top' },
      { box: { minX: left, maxX: right, minY: bottom, maxY: top }, roles: contactRoles(ctx), align: 'left', valign: 'bottom' },
    ], { rule: false });
    const [groupBlock, contactBlock] = lettering.blocks;
    const group = inkIn(lettering.ink, groupBlock!);
    const contacts = pointsOf(inkIn(lettering.ink, contactBlock!));
    const name = group.find((i) => i.role === 'name');

    // The edge: through the name's middle, slanting as little as clears every contact line by the
    // gutter (measured square to the edge).
    const nb = name ? bounds(pointsOf([name])) : groupBlock!;
    const e: Edge = { x1: nb.minX + CUT * (nb.maxX - nb.minX), y1: (nb.minY + nb.maxY) / 2, k: SLANT_MIN };
    const clears = (k: number) => contacts.every(([x, y]) => xAt({ ...e, k }, y) - x >= GUTTER * Math.hypot(1, k));
    if (!clears(e.k)) {
      let lo = SLANT_MIN;
      let hi = SLANT_MAX;
      for (let i = 0; i < 30; i++) {
        const m = (lo + hi) / 2;
        if (clears(m)) hi = m;
        else lo = m;
      }
      e.k = hi;
    }
    // The edge leaves the card through a straight edge, never through a rounded corner, where the
    // field would taper to a sliver no nozzle prints: at the foot it slants on until it leaves
    // through the right edge; at the head it moves right (which only clears the lines more).
    const zone = Math.max(ctx.s.corner, 1) + SLIVER;
    const footY = (k: number) => e.y1 - (w / 2 - e.x1) / k;
    if (xAt(e, -h / 2) > w / 2 - zone && footY(e.k) < -h / 2 + zone) {
      while (e.k < 6 && footY(e.k) < -h / 2 + zone) e.k *= 1.05;
    }
    const head = xAt(e, h / 2);
    if (head < -w / 2 + zone) e.x1 += -w / 2 + zone - head;
    const fields = fieldOf(ctx, e, 1);

    // The name's group changes colour where it crosses onto the field.
    const ink: Ink[] = lettering.ink.map((i) => (group.includes(i) ? { ...i, onFields: onField(ctx, i.role) } : i));
    // A logo on the front: on the field, top right; a QR has no room (on a one-sided card the build
    // turns this into its one sentence).
    if (ctx.markHere || ctx.qrHere) {
      const box = boxAt(right - SMALL_MARK / 2, top - SMALL_MARK / 2, SMALL_MARK, SMALL_MARK);
      const onTheField = xAt(e, box.minY) + GUTTER < box.minX;
      const clearOfName = pointsOf(group).every(([x, y]) => x < box.minX - GUTTER || y < box.minY - GUTTER);
      if (ctx.markHere && onTheField && clearOfName) {
        const m = ctx.mark(box, { on: 'shapes' });
        if (m) ink.push(m);
      }
      if (ctx.qrHere) ctx.warn('No room for the QR code on the front of this card.');
    }
    // A tag behind the plain card between the name's group and the contact lines.
    const pocket = pocketSpot(ctx, ink, [fields], [left + 14, (groupBlock!.minY + contactBlock!.maxY) / 2]);
    return { fields, ink, pocket };
  },
  async back(ctx) {
    const { w, h } = ctx;
    const margin = 5;
    // From behind, the field comes round on the left, slanting the other way, and holds the mark;
    // the QR and the company stand on the plain card, clear of the edge.
    const want = ctx.qrHere ? ctx.qrNeed(3) * 1.08 : 0;
    const areaW = Math.max(want, 0.42 * w);
    const x0 = w / 2 - margin - areaW;
    // The edge passes the gutter left of the area's top-left corner and leaves through the foot
    // just clear of the rounded corner.
    const y1 = h / 2 - margin;
    const foot = -w / 2 + Math.max(ctx.s.corner, 1) + SLIVER + 1;
    let k = 0.8;
    for (let i = 0; i < 4; i++) k = Math.max(0.3, (x0 - GUTTER * Math.hypot(1, k) - foot) / (y1 + h / 2));
    const e: Edge = { x1: x0 - GUTTER * Math.hypot(1, k), y1, k: -k };
    const fields = fieldOf(ctx, e, -1);
    const rest = standardBack(ctx, { area: { minX: x0, maxX: w / 2 - margin, minY: -h / 2 + margin, maxY: h / 2 - margin }, mark: false });
    const ink = [...(rest.ink ?? [])];
    // The mark where the field is widest, at the top left.
    const size = Math.min(MARK, xAt(e, h / 2 - margin - MARK) - GUTTER - (-w / 2 + margin));
    if (ctx.markHere && size >= 8) {
      const m = ctx.mark(boxAt(-w / 2 + margin + size / 2, h / 2 - margin - size / 2, size, size), { on: 'shapes' });
      if (m) ink.push(m);
    }
    return { fields, ink };
  },
};

function bounds(pts: Pt[]) {
  return { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])) };
}

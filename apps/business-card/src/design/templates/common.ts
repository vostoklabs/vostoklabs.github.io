// What the templates share: the order of the lines, where the QR and the logo go on a one-sided
// card, and the back most templates print.
import type { Box, Shapes } from '@vostok/shapes';
import type { Ctx, On, Side } from '../build';
import { boxAt, boxH, boxW, GUTTER } from '../layout';
import { FLOORS, type Role } from '../lockup';
import type { Ink } from '../types';

/** Every line, top to bottom. */
export const ALL: Role[] = ['name', 'rule', 'title', 'company', 'phone', 'email', 'web'];
export const NAME_GROUP: Role[] = ['name', 'rule', 'title', 'company'];
export const CONTACTS: Role[] = ['phone', 'email', 'web'];

/** The roles a face sets, less the company when it has no line to set: a two-sided card's
 *  company is on the back unless the back says something else, and the front gives its line to the
 *  others, which at a size a nozzle prints is a line the front needs. */
export const front = (ctx: Ctx, roles: Role[]): Role[] => (ctx.text.company.trim() ? roles : roles.filter((r) => r !== 'company'));

/** Clear modules round a QR on the front of a one-sided card: two, as the card's own margin
 *  carries the rest of the standard's four. */
export const FRONT_QUIET = 2;
/** The logo's square on the front of a one-sided card, mm. */
export const FRONT_LOGO = 11;
/** The smallest a back's company line is set, mm of cap: a flat face's details floor (a back is
 *  always laid into the face). */
const LABEL_MIN = FLOORS.flush.detail;
/** The smallest a back's mark is drawn beside a QR, mm. */
const MARK_MIN = 12;
/** Clear modules round a back's QR inside its square: three, as the blank card round it and the
 *  gutter to its neighbours carry the standard's fourth. */
const BACK_QUIET = 3;

/** A square in the card's bottom-right corner as big as the code needs, its quiet zone reaching
 *  into the margin; null when there is no QR. */
export function cornerQrBox(ctx: Ctx, margin: number): Box | null {
  const side = ctx.qrNeed(FRONT_QUIET);
  if (!side) return null;
  const m = margin - 1.5;
  const s = Math.min(side, ctx.h - 2 * m);
  return { minX: ctx.w / 2 - m - s, maxX: ctx.w / 2 - m, minY: -ctx.h / 2 + m, maxY: -ctx.h / 2 + m + s };
}

/** A square in the card's top-right corner. */
export function cornerLogoBox(ctx: Ctx, margin: number, side = FRONT_LOGO): Box {
  return { minX: ctx.w / 2 - margin - side, maxX: ctx.w / 2 - margin, minY: ctx.h / 2 - margin - side, maxY: ctx.h / 2 - margin };
}

/** On a one-sided card the QR and the logo go on the front: where the template says. */
export function frontExtras(ctx: Ctx, at: { qr?: Box | null; logo?: Box | null; on?: On }): Ink[] {
  const ink: Ink[] = [];
  if (at.qr && ctx.qrHere) {
    const q = ctx.qr(at.qr, at.on, FRONT_QUIET);
    if (q) ink.push(q.ink);
  }
  if (at.logo && ctx.markHere) {
    const m = ctx.mark(at.logo, { on: at.on ?? 'card' });
    if (m) ink.push(m);
  }
  return ink;
}

/** Whether a one-sided card puts its QR on the front (and so a template must leave room for it). */
export const qrOnFront = (ctx: Ctx) => ctx.qrHere;
/** The bottom-right QR square of a one-sided card, or null. */
export const frontQrBox = (ctx: Ctx, margin: number): Box | null => (qrOnFront(ctx) ? cornerQrBox(ctx, margin) : null);
export const logoOnFront = (ctx: Ctx) => ctx.markHere;

export interface BackOpts {
  /** Where the mark, the company and the QR are laid out. Default: the card less a 6 mm margin. */
  area?: Box;
  /** An accent field across the back, and thin card lines inside it. */
  fields?: Shapes;
  gaps?: Shapes;
  /** What the mark, the company and the QR sit on. Default: the card. */
  on?: On;
  /** False where the template draws the mark itself: only the company and the QR are laid out. */
  mark?: boolean;
}

/**
 * The back most templates print: the mark (the logo, or the initials) with the company under it,
 * and the QR code beside them when there is one. Drawn as seen from behind.
 */
export function standardBack(ctx: Ctx, o: BackOpts = {}): Side {
  const margin = 5;
  const area = o.area ?? { minX: -ctx.w / 2 + margin, maxX: ctx.w / 2 - margin, minY: -ctx.h / 2 + margin, maxY: ctx.h / 2 - margin };
  const on = o.on ?? 'card';
  const ink: Ink[] = [];
  // The mark when this face carries it and the template has not drawn it; the line under it is
  // whatever the back says (the company, the customer's name, or nothing).
  const drawMark = o.mark !== false && ctx.markHere;
  const company = ctx.text.company.trim();
  const labelH = company ? 7.5 : 0;

  // The mark and its label, centred in `box`, the mark as big as `markMax` allows.
  const markAndLabel = (box: Box, markMax: number) => {
    const size = drawMark ? Math.min(markMax, boxW(box), boxH(box) - labelH) : 0;
    const top = (box.minY + box.maxY) / 2 + (size + labelH) / 2;
    const mark = size > 0 ? ctx.mark(boxAt((box.minX + box.maxX) / 2, top - size / 2, size, size), { on }) : null;
    if (mark) ink.push(mark);
    if (company) {
      const label = ctx.label(company, { minX: box.minX, maxX: box.maxX, minY: top - size - labelH, maxY: top - size - 2 }, { cap: 3.4, on, upper: true });
      if (label) ink.push(label);
    }
  };

  // The code as big as it needs at its floor and a little more, as the room allows.
  const want = ctx.qrNeed(BACK_QUIET) * 1.08;
  if (ctx.qrHere && !drawMark) {
    // No mark here, or the template drew it: the QR in the middle of the area, the line under it.
    const side = Math.min(want, boxH(area) - labelH, boxW(area));
    const top = (area.minY + area.maxY) / 2 + (side + labelH) / 2;
    const q = ctx.qr(boxAt((area.minX + area.maxX) / 2, top - side / 2, side, side), on, BACK_QUIET);
    if (q) ink.push(q.ink);
    if (company) {
      const label = ctx.label(company, { minX: area.minX, maxX: area.maxX, minY: top - side - labelH, maxY: top - side - 2 }, { cap: 3.4, on, upper: true });
      if (label) ink.push(label);
    }
  } else if (ctx.qrHere) {
    // The company stands under the mark when it fits there at the details' size, else under both.
    // The code takes what it needs; the mark makes do with what is left, never under MARK_MIN.
    const side = Math.min(want, boxH(area), boxW(area) - GUTTER - MARK_MIN);
    const beside = boxW(area) - side - GUTTER;
    const fitsBeside = !company || Math.min(ctx.measure(company, true), ctx.measure(company)) * LABEL_MIN <= beside;
    const qrH = fitsBeside ? boxH(area) : boxH(area) - labelH;
    const qrSide = Math.min(side, qrH);
    const qrBox = boxAt(area.maxX - side / 2, area.maxY - qrH / 2, qrSide, qrSide);
    const q = ctx.qr(qrBox, on, BACK_QUIET);
    if (q) ink.push(q.ink);
    if (fitsBeside) markAndLabel({ ...area, maxX: area.maxX - side - GUTTER }, 20);
    else {
      const markBox = { minX: area.minX, maxX: area.maxX - side - GUTTER, minY: area.maxY - qrH, maxY: area.maxY };
      const size = drawMark ? Math.min(20, boxW(markBox), boxH(markBox)) : 0;
      const mark = size > 0 ? ctx.mark(boxAt((markBox.minX + markBox.maxX) / 2, (markBox.minY + markBox.maxY) / 2, size, size), { on }) : null;
      if (mark) ink.push(mark);
      const label = ctx.label(company, { minX: area.minX, maxX: area.maxX, minY: area.minY, maxY: area.minY + labelH - 2 }, { cap: 3.4, on, upper: true });
      if (label) ink.push(label);
    }
  } else {
    markAndLabel(area, 24);
  }
  return { ...(o.fields ? { fields: o.fields } : {}), ...(o.gaps ? { gaps: o.gaps } : {}), ink };
}

/** A contact card's code: its square from the card's edges, and the nearest it comes when it needs
 *  the room, mm; the clear modules round it inside its square (the card round it is the rest). */
const CONTACT_EDGE = 2.5;
const CONTACT_EDGE_MIN = 1;
const CONTACT_QUIET = 2;
/** The mark over the column beside it, at most, and the line at its foot, at most, mm. */
const CONTACT_MARK = 16;
const CONTACT_LABEL = 3.4;

/**
 * The back a QR code takes when a template's own back cannot hold it (a contact card: all of it):
 * the code as big
 * as the card's short side allows (a vCard is three times a link, and nothing smaller scans), at
 * the right of a landscape card or the foot of a portrait one; beside or above it the mark and the
 * back's line (the company, or the name), the line broken between words when it is too wide for
 * its room on one line. `holes` (in the back's frame) are what goes through the card, a window or a
 * pattern cut through: the code takes the other side from them and the column keeps off them.
 * Drawn as seen from behind.
 */
export function qrBack(ctx: Ctx, holes: Shapes = []): Side {
  const { w, h } = ctx;
  const ink: Ink[] = [];
  const portrait = h > w;
  const short = Math.min(w, h);
  const side = Math.min(short - 2 * CONTACT_EDGE_MIN, Math.max(short - 2 * CONTACT_EDGE, ctx.qrNeed(CONTACT_QUIET)));
  const gaps = holes.map((island) => {
    const pts = island.flat();
    return { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])) };
  });
  const meets = (a: Box, b: Box) => a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY;
  // At the right, or the foot of a portrait card; the other side when a hole is there.
  const at = (far: boolean): Box => portrait
    ? (far ? { minX: -side / 2, maxX: side / 2, minY: h / 2 - CONTACT_EDGE - side, maxY: h / 2 - CONTACT_EDGE } : { minX: -side / 2, maxX: side / 2, minY: -h / 2 + CONTACT_EDGE, maxY: -h / 2 + CONTACT_EDGE + side })
    : (far ? { minX: -w / 2 + CONTACT_EDGE, maxX: -w / 2 + CONTACT_EDGE + side, minY: -side / 2, maxY: side / 2 } : { minX: w / 2 - CONTACT_EDGE - side, maxX: w / 2 - CONTACT_EDGE, minY: -side / 2, maxY: side / 2 });
  const far = gaps.some((g) => meets(g, at(false))) && !gaps.some((g) => meets(g, at(true)));
  const qrBox = at(far);
  const q = ctx.qr(qrBox, 'card', CONTACT_QUIET);
  if (q) ink.push(q.ink);
  const inner = q ? q.module * CONTACT_QUIET : 0;
  const code = q ? q.box : qrBox;
  const col: Box = portrait
    ? (far ? { minX: -w / 2 + 5, maxX: w / 2 - 5, minY: -h / 2 + 6, maxY: code.minY - GUTTER } : { minX: -w / 2 + 5, maxX: w / 2 - 5, minY: code.maxY + GUTTER, maxY: h / 2 - 6 })
    : (far ? { minX: code.maxX + GUTTER, maxX: w / 2 - 5, minY: code.minY + inner, maxY: code.maxY - inner } : { minX: -w / 2 + 5, maxX: code.minX - GUTTER, minY: code.minY + inner, maxY: code.maxY - inner });
  // The column gives up the part of its height a hole crosses, from the end the hole is nearer.
  for (const g of gaps) {
    if (!meets(g, col)) continue;
    if ((g.minY + g.maxY) / 2 > (col.minY + col.maxY) / 2) col.maxY = Math.min(col.maxY, g.minY - GUTTER);
    else col.minY = Math.max(col.minY, g.maxY + GUTTER);
  }
  const align = portrait ? 'centre' : 'left';
  // The line in as few pieces as the column takes at the details' floor, every piece one size.
  const words = ctx.text.company.trim().split(/\s+/).filter(Boolean);
  const pieces: string[] = [];
  for (const word of words) {
    const last = pieces[pieces.length - 1];
    if (last && Math.min(ctx.measure(`${last} ${word}`, true), ctx.measure(`${last} ${word}`)) * LABEL_MIN <= boxW(col)) pieces[pieces.length - 1] = `${last} ${word}`;
    else pieces.push(word);
  }
  const widest = Math.max(0, ...pieces.map((t) => Math.min(ctx.measure(t, true), ctx.measure(t))));
  const cap = pieces.length ? Math.max(LABEL_MIN, Math.min(CONTACT_LABEL, boxW(col) / Math.max(1e-9, widest))) : 0;
  const step = cap * 1.45;
  const labelH = pieces.length ? cap + (pieces.length - 1) * step : 0;
  pieces.forEach((text, i) => {
    const y = col.minY + (pieces.length - 1 - i) * step;
    const l = ctx.label(text, { minX: col.minX, maxX: col.maxX, minY: y, maxY: y + cap }, { cap, align, upper: true });
    if (l) ink.push(l);
  });
  const mark = Math.min(CONTACT_MARK * (portrait ? 1.4 : 1), boxW(col), boxH(col) - labelH - 2 * GUTTER);
  if (ctx.markHere && mark >= 8) {
    const x = portrait ? 0 : col.minX + mark / 2;
    const m = ctx.mark(boxAt(x, col.maxY - mark / 2, mark, mark));
    if (m) ink.push(m);
  }
  return { ink };
}

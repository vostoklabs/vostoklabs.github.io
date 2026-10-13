// Scan Back: a statement front and a back that is one big QR code. The front sets the name large,
// the title and the company under it, and one contact line at the foot (the one the code does not
// already carry); with the code off, every contact line. The back is the code as big as the card's
// height allows, a short label beside it saying what scanning does, and the mark over the label.
import type { Box } from '@vostok/shapes';
import { luminance } from '@vostok/ui-kit';
import type { Ctx, Template } from '../build';
import { boxAt, boxH, boxW, GUTTER, shrinkBox } from '../layout';
import { TITLE_RATIO, type LockupSlot, type Role } from '../lockup';
import { applyCase, scaleMove } from '../text';
import type { Ink } from '../types';
import { cornerLogoBox, FRONT_LOGO, FRONT_QUIET, frontQrBox } from './common';
import { backWithoutQr, contactRoles, detailCap, EDGE, heightOf, pocketSpot } from './print-cards';

/** The name against the size asked for it, and the most it is set at, mm of capital. */
const NAME_SCALE = 1.5;
const NAME_MAX = 11;
/** The air under the name, and between the name's group and the contact line, in the name's
 *  capitals and in the details' capitals. */
const UNDER_NAME = 0.3;
const BEFORE_CONTACT = 1.6;
/** The back's code: its square from the card's edges, and the nearest it may come when a long
 *  code needs it (a contact card), mm. Clear modules round it inside its square. */
const QR_EDGE = 2.5;
const QR_EDGE_MIN = 1;
const QUIET = 2;
/** The back's label: the size it is set at, at most (fitted to its column), and the mark over it. */
const LABEL_CAP = 4.6;
const MARK_MAX = 16;

/** Whether a code on `on` prints as a light tile with its modules left open. */
const tiled = (ctx: Ctx) => luminance(ctx.colour('qr')) > luminance(ctx.colour('card'));

/** The one contact line the front keeps when the code carries the rest: the email, else the phone,
 *  else the website (not the website while the code opens it and there is another line). Never
 *  swapped for a shorter one: a line too long to print here is said, not quietly dropped. */
function oneLine(ctx: Ctx): Role[] {
  const all = contactRoles(ctx, ['email', 'phone', 'web']);
  const pick = all.find((r) => !(r === 'web' && ctx.s.qrKind === 'website' && all.length > 1));
  return pick ? [pick] : [];
}

/** What the back's label says. */
const labelLines = (ctx: Ctx): string[] => (ctx.s.qrKind === 'contact' ? ['Save my', 'contact'] : ['Scan me']);

/** Ink moved by (dx, dy). */
const moved = (i: Ink, dx: number, dy: number): Ink => ({ ...i, shapes: scaleMove(i.shapes, 1, dx, dy), ...(i.minus ? { minus: scaleMove(i.minus, 1, dx, dy) } : {}) });

function boundsOf(ink: Ink[]): Box | null {
  const pts = ink.flatMap((i) => i.shapes.flat(2));
  if (!pts.length) return null;
  return { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])) };
}

export const scanBack: Template = {
  id: 'scan-back',
  name: 'Scan back',
  group: 'qr',
  line: 'Your name large, a big QR code on the back.',
  qrSide: 'back',
  async front(ctx) {
    const { w, h } = ctx;
    const left = -w / 2 + EDGE;
    const right = w / 2 - EDGE;
    const top = h / 2 - EDGE;
    const bottom = -h / 2 + EDGE;
    const ink: Ink[] = [];

    // A one-sided card keeps the code and the mark on the front: the code in the bottom-right
    // corner and the mark over it, or with no code the mark in that corner, by the foot's lines.
    const qrBox = frontQrBox(ctx, EDGE + 0.5);
    let qrClear: Box | null = null;
    if (qrBox) {
      const q = ctx.qr(qrBox, 'card', FRONT_QUIET);
      if (q) {
        ink.push(q.ink);
        qrClear = tiled(ctx) ? q.box : shrinkBox(q.box, FRONT_QUIET * q.module);
      }
    }
    const logoBox = !ctx.markHere ? null
      : qrBox ? cornerLogoBox(ctx, EDGE)
        : { minX: right - FRONT_LOGO, maxX: right, minY: bottom, maxY: bottom + FRONT_LOGO };
    if (logoBox) {
      const m = ctx.mark(logoBox);
      if (m) ink.push(m);
    }
    const logoAtFoot = !!logoBox && !qrBox;

    // The contact line (or, with no code anywhere, every line) at the foot.
    const footRight = qrClear ? qrClear.minX - GUTTER : logoAtFoot ? logoBox!.minX - GUTTER : right;
    const lines = ctx.qrOn ? oneLine(ctx) : contactRoles(ctx, ['phone', 'email', 'web']);
    const cap = detailCap(ctx);
    const footH = heightOf(ctx, lines, footRight - left, { rule: false });

    // The name, large, and under it the title and the company on one line where they fit there (on
    // two where not), in the middle of what is left.
    const groupRight = logoBox && !logoAtFoot ? logoBox.minX - GUTTER : right;
    const nameCap = Math.min(NAME_MAX, NAME_SCALE * ctx.s.nameSize);
    const name = ctx.text.name.trim()
      ? ctx.label(applyCase(ctx.text.name, ctx.s.nameCase), { minX: left, maxX: groupRight, minY: 0, maxY: nameCap }, { cap: nameCap, align: 'left', paint: 'name' })
      : null;
    const nb = name ? boundsOf([name]) : null;
    const titleLine = [ctx.text.title.trim(), ctx.text.company.trim()].filter(Boolean).join(' · ');
    const titleCap = Math.max(cap, TITLE_RATIO * ctx.s.nameSize);
    const oneLine_ = !!titleLine && ctx.measure(titleLine) * cap <= groupRight - left;
    const title = oneLine_ ? ctx.label(titleLine, { minX: left, maxX: groupRight, minY: 0, maxY: titleCap }, { cap: titleCap, align: 'left' }) : null;
    const tb = title ? boundsOf([title]) : null;
    const under = oneLine_ ? [] : (['title', 'company'] as Role[]);
    const underH = tb ? tb.maxY - tb.minY : heightOf(ctx, under, groupRight - left, { rule: false });
    const gap = nb && underH ? UNDER_NAME * nameCap : 0;
    const groupH = (nb ? nb.maxY - nb.minY : 0) + gap + underH;
    // The group sits at the optical middle of the room above the foot.
    const roomTop = top;
    const roomBottom = lines.length ? bottom + footH + BEFORE_CONTACT * cap : bottom;
    const mid = (roomTop + roomBottom) / 2 + 0.04 * (roomTop - roomBottom);
    const groupTop = Math.min(roomTop, mid + groupH / 2);
    if (name && nb) ink.push(moved(name, 0, groupTop - nb.maxY));
    const underTop = groupTop - (nb ? nb.maxY - nb.minY + gap : 0);
    if (title && tb) ink.push(moved(title, 0, underTop - tb.maxY));

    const slots: LockupSlot[] = [
      { box: { minX: left, maxX: groupRight, minY: roomBottom, maxY: underTop }, roles: under, align: 'left', valign: 'top' },
      { box: { minX: left, maxX: footRight, minY: bottom, maxY: top }, roles: lines, align: 'left', valign: 'bottom' },
    ];
    const lettering = ctx.lettering(slots, { rule: false });
    // A tag behind the open band between the name's group and the foot.
    const all = [...lettering.ink, ...ink];
    const pocket = pocketSpot(ctx, all, [], [w / 4, (groupTop - groupH + bottom + footH) / 2]);
    return { ink: all, pocket };
  },
  async back(ctx) {
    if (!ctx.qrHere) return backWithoutQr(ctx);
    const { w, h } = ctx;
    const ink: Ink[] = [];
    // The code as tall as the card, its square a little further in when it has the room.
    const need = ctx.qrNeed(QUIET);
    const side = Math.min(h - 2 * QR_EDGE_MIN, Math.max(h - 2 * QR_EDGE, need));
    const qrBox: Box = { minX: w / 2 - QR_EDGE - side, maxX: w / 2 - QR_EDGE, minY: -side / 2, maxY: side / 2 };
    const q = ctx.qr(qrBox, 'card', QUIET);
    if (q) ink.push(q.ink);
    const clear = q ? (tiled(ctx) ? q.box : shrinkBox(q.box, QUIET * q.module)) : qrBox;
    const modules = q ? shrinkBox(q.box, QUIET * q.module) : qrBox;

    // The column beside it: the mark at the top, the label at the foot, on the code's own lines.
    const col: Box = { minX: -w / 2 + EDGE, maxX: clear.minX - GUTTER, minY: modules.minY, maxY: modules.maxY };
    // Every line of the label at one size: the widest fitted to the column.
    const lines = labelLines(ctx);
    const widest = Math.max(...lines.map((t) => ctx.measure(t)));
    const labelCap = Math.min(LABEL_CAP, boxW(col) / Math.max(1e-9, widest));
    const step = labelCap * 1.45;
    const labelH = labelCap + (lines.length - 1) * step;
    lines.forEach((text, i) => {
      const y = col.minY + (lines.length - 1 - i) * step;
      const l = ctx.label(text, { minX: col.minX, maxX: col.maxX, minY: y, maxY: y + labelCap }, { cap: labelCap, align: 'left', paint: 'icons' });
      if (l) ink.push(l);
    });
    const markSize = Math.min(MARK_MAX, boxW(col), boxH(col) - labelH - 2 * GUTTER);
    if (ctx.markHere && markSize >= 8) {
      const m = ctx.mark(boxAt(col.minX + markSize / 2, col.maxY - markSize / 2, markSize, markSize));
      if (m) ink.push(m);
    }
    return { ink };
  },
};

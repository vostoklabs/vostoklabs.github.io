// Corner QR: the code is the front's anchor, in its bottom-right corner on either kind of card, as
// big as its link needs and no smaller (a Large code as big as the lettering leaves room for). The
// name and title stand beside it at the foot, on its bottom line; the contact lines run across the
// top, a line too long to pass the code above it, across the card. With the code off, the mark
// takes the corner. The back carries the mark and the company.
import type { Box } from '@vostok/shapes';
import { luminance } from '@vostok/ui-kit';
import { QR_LARGE, type Ctx, type Template } from '../build';
import { boxRing, GUTTER, shrinkBox } from '../layout';
import { FLOORS, GROUP_GAP, LINE_GAP, TITLE_RATIO, type LockupSlot, type LockupText } from '../lockup';
import type { Ink } from '../types';
import { applyCase } from '../text';
import { front } from './common';
import { backWithoutQr, contactRoles, detailCap, EDGE, heightOf, pocketSpot, splitRows } from './print-cards';

/** The code's square, its quiet zone included, from the card's right and bottom edges, mm. */
const QR_EDGE = 2.4;
/** The lettering's margin at the top, mm: the long line over the code needs every tenth. */
const TOP = 4.5;
/** Clear modules round the code inside its square. */
const QUIET = 2;
/** The least quiet zone inside the square, mm: two modules at the smallest module. */
const QUIET_MIN = 2;
/** The mark in the corner when there is no code, and over the code on a one-sided card, mm. */
const MARK = 19;
const SMALL_MARK = 11;
/** The steps the corner gives a Large code back in when the lettering needs the room. */
const STEP = 0.5;

/** Whether the code prints as a light tile with its modules left open (light ink on a dark card):
 *  the tile is then what the lettering keeps clear of, not just the modules. */
const tiled = (ctx: Ctx) => luminance(ctx.colour('qr')) > luminance(ctx.colour('card'));

export const cornerQr: Template = {
  id: 'corner-qr',
  name: 'Corner QR',
  group: 'qr',
  line: 'A QR code in the corner of the front.',
  qrSide: 'front',
  async front(ctx) {
    const { w, h } = ctx;
    const left = -w / 2 + EDGE;
    const right = w / 2 - EDGE;
    const top = h / 2 - TOP;
    const bottom = -h / 2 + EDGE;
    const ink: Ink[] = [];

    const cap = detailCap(ctx);
    const roles = contactRoles(ctx, ['phone', 'email', 'web']);
    const tile = tiled(ctx);

    // The code's size: what its link needs, or a Large code given back step by step until every
    // line passes beside it or over it at a size that prints (the name at its floor, the contact
    // lines without their icons at worst), never under what it needs.
    const want = ctx.qrHere ? ctx.qrNeed(QUIET) : 0;
    const least = ctx.s.qrSize === 'large' ? want / QR_LARGE : want;
    const nameFloor = FLOORS[ctx.s.raise > 1e-6 ? 'raised' : 'flush'].name;
    const passes = (side: number) => {
      const edge = w / 2 - QR_EDGE - side + (tile ? 0 : QUIET_MIN) - GUTTER;
      const roof = -h / 2 + QR_EDGE + side - (tile ? 0 : QUIET_MIN) + GUTTER;
      const col = edge - left;
      const group = front(ctx, ['title', 'company']).map((r) => ctx.measure(ctx.text[r as keyof LockupText]) * Math.max(cap, TITLE_RATIO * nameFloor));
      if (ctx.measure(applyCase(ctx.text.name, ctx.s.nameCase)) * nameFloor > col || group.some((g) => g > col)) return false;
      const split = splitRows(ctx, roles, col, (rows, icons) => top - heightOf(ctx, rows, right - left, { rule: false, icons }) >= roof - 1e-6);
      return split.beside.every((r) => ctx.measure(ctx.text[r as keyof LockupText]) * cap <= col + 1e-6);
    };
    let side = want;
    while (side > least + 1e-6 && !passes(side)) side = Math.max(least, side - STEP);

    // The corner: the code at that size, or the mark when there is no code.
    let corner: Box | null = null;
    if (side) {
      const box = { minX: w / 2 - QR_EDGE - side, maxX: w / 2 - QR_EDGE, minY: -h / 2 + QR_EDGE, maxY: -h / 2 + QR_EDGE + side };
      const q = ctx.qr(box, 'card', QUIET);
      if (q) {
        ink.push(q.ink);
        corner = tile ? q.box : shrinkBox(q.box, QUIET_MIN);
      }
    } else if (ctx.hasMark) {
      corner = { minX: right - MARK, maxX: right, minY: bottom, maxY: bottom + MARK };
      const m = ctx.mark(corner);
      if (m) ink.push(m);
    }
    // A one-sided card's mark stands over the code where the code leaves it room.
    const topMark = side && corner && ctx.markHere && top - SMALL_MARK >= corner.maxY + GUTTER
      ? { minX: right - SMALL_MARK, maxX: right, minY: top - SMALL_MARK, maxY: top } : null;
    if (topMark) {
      const m = ctx.mark(topMark);
      if (m) ink.push(m);
    }
    const colRight = corner ? corner.minX - GUTTER : right;
    const headRight = topMark ? topMark.minX - GUTTER : right;
    const headBottom = corner ? corner.maxY + GUTTER : bottom;

    // The contact lines across the top: those too long to pass the corner first, over it, as many
    // as its room holds; then the rest, beside it.
    const { beside, full, icons } = corner
      ? splitRows(ctx, roles, colRight - left, (rows, icons) => top - heightOf(ctx, rows, headRight - left, { rule: false, icons }) >= headBottom - 1e-6)
      : { beside: [], full: roles, icons: true };
    const headH = heightOf(ctx, full, headRight - left, { rule: false, icons });
    const besideTop = full.length ? top - headH - LINE_GAP * cap : top;
    const contactsBottom = besideTop - heightOf(ctx, beside, colRight - left, { rule: false, icons });

    // The name's group at the foot, beside the corner.
    const slots: LockupSlot[] = [
      { box: { minX: left, maxX: colRight, minY: bottom, maxY: roles.length ? contactsBottom - GROUP_GAP * cap : top }, roles: front(ctx, ['name', 'title', 'company']), align: 'left', valign: 'bottom' },
      { box: { minX: left, maxX: headRight, minY: headBottom, maxY: top }, roles: full, align: 'left', valign: 'top' },
      { box: { minX: left, maxX: colRight, minY: bottom, maxY: besideTop }, roles: beside, align: 'left', valign: 'top' },
    ];
    const lettering = ctx.lettering(slots, { rule: false, icons });

    // A tag behind the space between the contact lines and the name, as they were set; with the tap
    // mark printed over it, wherever the face is most open.
    const [nameBlock, headBlock, besideBlock] = lettering.blocks;
    const above = beside.length ? besideBlock!.minY : full.length ? headBlock!.minY : top;
    const below = nameBlock!.maxY > nameBlock!.minY ? nameBlock!.maxY : bottom;
    const all = [...lettering.ink, ...ink];
    const pocket = pocketSpot(ctx, all, corner ? [[[boxRing(corner, 0)]]] : [], [(left + colRight) / 2, (above + below) / 2]);
    return { ink: all, pocket };
  },
  async back(ctx) {
    return backWithoutQr(ctx);
  },
};

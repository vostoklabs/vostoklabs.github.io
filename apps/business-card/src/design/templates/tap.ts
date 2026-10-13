// Tap: an NFC card. A large tap mark stands over the hidden tag, on the right, so whoever holds the
// card knows where to touch a phone to it; the tag's pocket is part of the design whether or not the
// NFC switch is on. The name and the contact lines stand on the left, and a line too long to pass
// the mark runs along the foot of the card, under it. The back carries the mark, the company and the
// QR, for a phone without NFC.
import type { Box } from '@vostok/shapes';
import { NFC_TAGS, type Ctx, type Template } from '../build';
import { BORDER, boxAt, GUTTER } from '../layout';
import { GROUP_GAP, LINE_GAP, type LockupSlot } from '../lockup';
import { front, standardBack } from './common';
import { contactRoles, detailCap, EDGE, heightOf, splitRows } from './print-cards';

/** The tap mark's square, mm: big enough to read as the thing to touch. */
const TAP = 17;
/** A one-sided card's mark over the tap mark: at most, and the least worth printing, mm. */
const SMALL_MARK = 11;
const MIN_MARK = 7;

/** The tag's radius in its pocket, mm (the build adds the same clearance). */
const tagRadius = (ctx: Ctx) => (NFC_TAGS[ctx.s.nfcTag] ?? NFC_TAGS['25']!).dia / 2 + 0.3;

export const tap: Template = {
  id: 'tap',
  name: 'NFC',
  group: 'qr',
  line: 'An NFC tag inside: tap the card on a phone.',
  nfc: true,
  async front(ctx) {
    const { w, h } = ctx;
    const left = -w / 2 + EDGE;
    const right = w / 2 - EDGE;
    const top = h / 2 - EDGE;
    const bottom = -h / 2 + EDGE;
    const r = tagRadius(ctx) + 0.2;

    // The mark's column on the right: as far over as the tag's pocket keeps its border of card.
    const cx = Math.min(right - TAP / 2, w / 2 - BORDER / 2 - r);
    const colRight = cx - TAP / 2 - GUTTER;

    // The contact lines: those that pass the mark beside it, the rest along the foot.
    const cap = detailCap(ctx);
    const roles = contactRoles(ctx);
    const yMax = Math.min(h / 2 - BORDER / 2 - r, top - TAP / 2);
    const footH = (rows: typeof roles, icons: boolean) => heightOf(ctx, rows, right - left, { rule: false, icons });
    const { beside, full, icons } = splitRows(ctx, roles, colRight - left, (rows, icons) => bottom + footH(rows, icons) + GUTTER + TAP / 2 <= yMax + 1e-6);
    const foot = full.length ? footH(full, icons) : 0;

    // The mark at the card's middle height, lifted only as far as the foot's lines need.
    const cy = Math.min(yMax, Math.max(0, full.length ? bottom + foot + GUTTER + TAP / 2 : 0));
    const markBox: Box = boxAt(cx, cy, TAP, TAP);
    const mark = ctx.tap(markBox);

    // The name's group at the top, the contact lines at the foot, the long ones last.
    const besideBottom = full.length ? bottom + foot + LINE_GAP * cap : bottom;
    const contactsTop = besideBottom + heightOf(ctx, beside, colRight - left, { rule: false, icons });
    const slots: LockupSlot[] = [
      { box: { minX: left, maxX: colRight, minY: roles.length ? contactsTop + GROUP_GAP * cap : bottom, maxY: top }, roles: front(ctx, ['name', 'rule', 'title', 'company']), align: 'left', valign: 'top' },
      { box: { minX: left, maxX: colRight, minY: besideBottom, maxY: top }, roles: beside, align: 'left', valign: 'bottom' },
      { box: { minX: left, maxX: right, minY: bottom, maxY: top }, roles: full, align: 'left', valign: 'bottom' },
    ];
    const lettering = ctx.lettering(slots, { icons });
    const ink = [...lettering.ink, ...(mark ? [mark] : [])];
    // A logo on the front stands over the tap mark where there is room; a QR has none here (on a
    // one-sided card the build turns this into its one sentence: print the back too, or turn the QR
    // off).
    const room = Math.min(SMALL_MARK, top - (markBox.maxY + GUTTER));
    if (ctx.markHere && room >= MIN_MARK) {
      const m = ctx.mark(boxAt(cx, top - room / 2, room, room));
      if (m) ink.push(m);
    }
    if (ctx.qrHere) ctx.warn('No room for the QR code on the front of this card.');
    return { ink, pocket: [cx, cy] };
  },
  async back(ctx) {
    return standardBack(ctx);
  },
};

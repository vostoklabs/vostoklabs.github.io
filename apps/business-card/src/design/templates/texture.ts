// Texture: a third of the front, on the right, carries a fine texture from the pattern engine, in
// colour by default; carved, it is tone-on-tone and shows by light and touch, what paper only gets
// from letterpress. The lettering stands on the smooth rest of the card; a contact
// line too long to pass the texture runs along the foot, under it. An NFC tag's printed mark sits in
// the middle of the texture, which keeps clear of it. The back carries the mark, the company and
// the QR.
import type { Pt, Ring } from '@vostok/shapes';
import { NFC_TAGS, type Template } from '../build';
import { BORDER, clipX, clipY, disc, GUTTER } from '../layout';
import { GROUP_GAP, LINE_GAP, type LockupSlot } from '../lockup';
import { front, standardBack } from './common';
import { contactRoles, detailCap, EDGE, heightOf, pocketAt, splitRows } from './print-cards';

/** The textured share of the card's width (what shows, inside its smooth border). */
const SHARE = 0.3;
/** The clear radius round an NFC tag's printed mark, mm: its 9 mm and the build's 1.5 round it. */
const MARK_CLEAR = 6;

export const texture: Template = {
  id: 'texture',
  name: 'Texture',
  group: 'patterns',
  line: 'A strip of honeycomb you can see and feel.',
  // A fine honeycomb: 3.2 mm cells and 0.8 mm walls at this zoom, both wider than a nozzle's line.
  pattern: { value: 'honeycomb', zoom: 40 },
  async front(ctx) {
    const { w, h } = ctx;
    const left = -w / 2 + EDGE;
    const right = w / 2 - EDGE;
    const top = h / 2 - EDGE;
    const bottom = -h / 2 + EDGE;

    // Where the texture shows from, and the column the lettering keeps to beside it.
    const texLeft = w / 2 - BORDER - SHARE * w;
    const colRight = texLeft - GUTTER;

    // The contact lines: those that pass the texture beside it, the rest along the foot, under it,
    // as many as leave the texture at least half the card's height.
    const cap = detailCap(ctx);
    const roles = contactRoles(ctx);
    const footOf = (rows: typeof roles, icons: boolean) => heightOf(ctx, rows, right - left, { rule: false, icons });
    const { beside, full, icons } = splitRows(ctx, roles, colRight - left, (rows, icons) => bottom + footOf(rows, icons) + GUTTER <= -h / 2 + 0.5 * h);
    const footH = full.length ? footOf(full, icons) : 0;

    // The textured region: the card right of the column and above the foot's lines; the pattern
    // keeps its border inside it, so the texture shows from `texLeft` and the gutter over the foot.
    const x0 = texLeft - BORDER;
    const y0 = full.length ? bottom + footH + GUTTER - BORDER : -h;
    let region: Ring = clipX(ctx.outline, x0, 'right');
    if (full.length) region = clipY(region, y0, 'above');
    // With the tap mark printed, the tag goes in the middle of the texture, the one open place on
    // the face. The pattern keeps its border off a reserve too: round the mark, a clear ring as
    // wide as the build's own; cut through the card, the whole pocket and the build's margin round
    // it. Without the mark the tag is hidden under the smooth card.
    const tag = (NFC_TAGS[ctx.s.nfcTag] ?? NFC_TAGS['25']!).dia / 2 + 0.3;
    const marked = ctx.s.nfc && ctx.s.nfcMark;
    const middle: Pt = pocketAt(ctx, [(texLeft + w / 2 - BORDER) / 2, ((full.length ? y0 + BORDER : -h / 2 + BORDER) + h / 2 - BORDER) / 2]);
    const keep = ctx.s.patternMode === 'cut' ? tag + 1.2 : Math.max(0.5, MARK_CLEAR - BORDER);
    const reserve = marked ? [disc(middle[0], middle[1], keep, 64).reverse()] : [];
    const pattern = await ctx.pattern([[region, ...reserve]], { inset: BORDER });

    // The lettering: the name's group at the top, the contact lines at the foot, the long ones last.
    const besideBottom = full.length ? bottom + footH + LINE_GAP * cap : bottom;
    const contactsTop = besideBottom + heightOf(ctx, beside, colRight - left, { rule: false, icons });
    const slots: LockupSlot[] = [
      { box: { minX: left, maxX: colRight, minY: roles.length ? contactsTop + GROUP_GAP * cap : bottom, maxY: top }, roles: front(ctx, ['name', 'rule', 'title', 'company']), align: 'left', valign: 'top' },
      { box: { minX: left, maxX: colRight, minY: besideBottom, maxY: top }, roles: beside, align: 'left', valign: 'bottom' },
      { box: { minX: left, maxX: right, minY: bottom, maxY: top }, roles: full, align: 'left', valign: 'bottom' },
    ];
    const lettering = ctx.lettering(slots, { icons });
    // A one-sided card has no room for its QR and its mark beside the texture (the build turns
    // the QR into its one sentence).
    if (ctx.qrHere) ctx.warn('No room for the QR code on the front of this card.');
    const [nameBlock] = lettering.blocks;
    const pocket = marked ? middle : pocketAt(ctx, [Math.min((left + colRight) / 2, texLeft - tag - 1), (nameBlock!.minY + contactsTop) / 2]);
    return { pattern, ink: lettering.ink, pocket };
  },
  async back(ctx) {
    const { w, h } = ctx;
    // A texture cut right through the card shows on the back too, on the left from behind: the
    // mark, the company and the QR then keep to the rest. Carved or in colour, it does not.
    if (ctx.s.patternMode !== 'cut') return standardBack(ctx);
    const texLeft = w / 2 - BORDER - SHARE * w;
    const margin = 5;
    return standardBack(ctx, { area: { minX: -texLeft + GUTTER, maxX: w / 2 - margin, minY: -h / 2 + margin, maxY: h / 2 - margin } });
  },
};

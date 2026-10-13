// Half: Laser Studio's half card, for a print. A burst of petals opens from the card's edge, the
// Dahlia by default, in colour; the lettering takes the rest of the card.
//
// The laser card gives the burst the right half and sets four short lines in the left; a print's
// details are bigger and longer (an email needs 60 mm at the floor), so the burst opens from the
// top-right corner instead: a quarter of the flower, as big as the name above and the contact lines
// below leave it, its edge an arc as on the laser card, its petals bleeding off the card's edges.
//
// On the back the burst lies where it lies on the front, in colour: a burst cut through the card is
// cut through the back too, so the back's lies on its struts and nothing else of the back is set
// inside it. The mark stands under it, the QR and the company take the right.
import type { Box, Pt, Shapes } from '@vostok/shapes';
import { NFC_TAGS, type Ctx, type Template } from '../build';
import { BORDER, boxAt, clipConvex, disc, GUTTER } from '../layout';
import type { Ink, PatternPart } from '../types';
import { CONTACTS, front, frontExtras, frontQrBox, NAME_GROUP, standardBack } from './common';
import { dahliaFit } from './laser-cards';

const MARGIN = 5.5;
const FOOT = 4.5;
/** The room the template keeps for the name's line and for the contact block, mm: a name at the
 *  size asked, and an email with its icon at the details' floor. The burst is as big as leaves both. */
const NAME_ROOM = 44;
const CONTACT_ROOM = 61;
const CONTACTS_H = 19;
/** How far a line of the pattern reaches past its region's edge: half the band a line is printed
 *  as, rounded up. The lettering keeps GUTTER off that. */
const EDGE = 0.4;
/** The burst never reaches further than this share of the card's width; the heart it would like,
 *  mm; and the least it is drawn at (a one-sided card's QR can leave it less). */
const MAX_REACH = 0.4;
const HEART = 6.5;
const MIN_REACH = 8;
/** The logo of a one-sided card, mm: in the corner the burst leaves free. */
const LOGO = 10;
/** The back: its margin, the mark at its largest, the clear modules round the QR (as
 *  `standardBack`), and the company's line under the QR with the air above it, mm. */
const BACK_MARGIN = 5;
const BACK_MARK = 16;
const BACK_QUIET = 3;
const LABEL_H = 7.5;
const LABEL_CAP = 3.4;

/** Where a circle of radius `r` round `c` crosses the line y = `y`, on its left; `fallback` when
 *  the line passes clear of it. */
const arcX = (c: Pt, r: number, y: number, fallback: number) => {
  const dy = Math.abs(c[1] - y);
  return dy < r ? c[0] - Math.sqrt(r * r - dy * dy) : fallback;
};

/** How high a point at x = `x` may stand and stay outside a circle of radius `r` round `c` above it. */
const belowArc = (c: Pt, r: number, x: number) => {
  const dx = Math.abs(x - c[0]);
  return dx < r ? c[1] - Math.sqrt(r * r - dx * dx) : Infinity;
};

/** The front's layout: the burst's centre and reach, and the two lettering boxes it leaves. */
function frontLayout(ctx: Ctx, keep: Box | null) {
  const { w, h } = ctx;
  const c: Pt = [w / 2, h / 2];
  const left = -w / 2 + MARGIN;
  const top = h / 2 - MARGIN;
  const contactsTop = -h / 2 + FOOT + CONTACTS_H;
  // As big as the name's line and the contact block leave it, never past MAX_REACH.
  let reach = Math.min(
    MAX_REACH * w,
    Math.hypot(c[0] - (left + NAME_ROOM), c[1] - top) - GUTTER - EDGE,
    Math.hypot(c[0] - (left + CONTACT_ROOM), c[1] - contactsTop) - GUTTER - EDGE,
  );
  // A one-sided card's QR in the bottom-right corner: the burst gives way to it.
  if (keep) reach = Math.min(reach, c[1] - keep.maxY - GUTTER - EDGE);
  const clear = reach + GUTTER + EDGE;
  const name: Box = { minX: left, maxX: arcX(c, clear, top, w / 2 - MARGIN), minY: contactsTop + 2, maxY: top };
  const contacts: Box = { minX: left, maxX: Math.min(w / 2 - MARGIN, arcX(c, clear, contactsTop, w / 2 - MARGIN)), minY: -h / 2 + FOOT, maxY: contactsTop };
  return { c, reach, name, contacts };
}

/**
 * The burst round the corner `c` (this side's frame): the card inside a disc of radius `reach`,
 * filled with the pattern centred on `c`, the Dahlia fitted so its edge is a row of petal tips. It
 * bleeds off the card's edges like a colour field (a cut keeps the engine's own web along them): a
 * flower trimmed by the card reads as one, where one stopped short of a border shows every line it
 * cut. A back's region goes to the pattern turned over, so its slide is turned too.
 */
async function burst(ctx: Ctx, c: Pt, reach: number): Promise<PatternPart | null> {
  if (reach < MIN_REACH) return null;
  const params = dahliaFit(ctx, HEART, reach, 3);
  const outer = clipConvex(ctx.outline, disc(c[0], c[1], reach, 160));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of outer) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const dx = c[0] - (minX + maxX) / 2;
  const region: Shapes = [[outer]];
  return ctx.pattern(region, { inset: 0, dx: ctx.side === 'back' ? -dx : dx, dy: c[1] - (minY + maxY) / 2, ...(params ? { params } : {}) });
}

export const half: Template = {
  id: 'half',
  name: 'Half',
  group: 'patterns',
  line: 'A flower of petals opens from the corner.',
  pattern: { value: 'bc-dahlia' },
  async front(ctx) {
    const { w, h } = ctx;
    const qr = frontQrBox(ctx, MARGIN);
    const { c, reach, name, contacts } = frontLayout(ctx, qr);
    // The tag sits in the bottom-right corner, where its tap mark has the card to itself; the
    // contact lines keep clear of the mark.
    const tag = NFC_TAGS[ctx.s.nfcTag] ?? NFC_TAGS['25']!;
    const r = tag.dia / 2 + 0.3;
    const pocket: Pt = [w / 2 - BORDER / 2 - r - 0.6, -h / 2 + BORDER / 2 + r + 0.6];
    if (ctx.s.nfc && ctx.s.nfcMark) contacts.maxX = Math.min(contacts.maxX, pocket[0] - 4.5 - GUTTER);
    // A one-sided card's logo stands in the corner under the burst, right of the contact lines; its
    // QR takes that corner, and the contact lines give it room (and say so when they cannot).
    const logo = !ctx.qrHere && ctx.markHere ? boxAt(w / 2 - MARGIN - LOGO / 2, -h / 2 + FOOT + LOGO / 2, LOGO, LOGO) : null;
    if (logo) contacts.maxX = Math.min(contacts.maxX, logo.minX - GUTTER);
    if (qr) contacts.maxX = Math.min(contacts.maxX, qr.minX - GUTTER + 1.5);

    const pattern = await burst(ctx, c, reach);
    const lettering = ctx.lettering([
      { box: name, roles: front(ctx, NAME_GROUP), align: 'left', valign: 'top' },
      { box: contacts, roles: CONTACTS, align: 'left', valign: 'bottom' },
    ]);
    return { pattern, ink: [...lettering.ink, ...frontExtras(ctx, { qr, logo })], pocket };
  },
  async back(ctx) {
    const { w, h } = ctx;
    const m = BACK_MARGIN;
    // The front's burst turned over: from behind, its corner is the top-left.
    const { reach } = frontLayout(ctx, null);
    const c: Pt = [-w / 2, h / 2];
    const clear = reach + GUTTER + EDGE;
    const pattern = await burst(ctx, c, reach);
    const foot = -h / 2 + m;
    if (!ctx.qrHere) {
      // The mark over the company, centred in the card right of the burst.
      const left = c[0] + Math.sqrt(Math.max(0, clear * clear - m * m));
      const area: Box = { minX: Math.max(left, -w / 2 + m), maxX: w / 2 - m, minY: foot, maxY: h / 2 - m };
      return { pattern, ink: standardBack(ctx, { area }).ink ?? [] };
    }

    // Two columns: the burst over the mark on the left, the QR over the company on the right, the
    // mark's foot on the company's baseline.
    const ink: Ink[] = [];
    const company = ctx.text.company.trim();
    const labelH = company ? LABEL_H : 0;
    const side = Math.min(ctx.qrNeed(BACK_QUIET) * 1.08, h / 2 - m - (foot + labelH));
    const qrBox: Box = { minX: w / 2 - m - side, maxX: w / 2 - m, minY: foot + labelH, maxY: foot + labelH + side };
    const q = ctx.qr(qrBox, 'card', BACK_QUIET);
    if (q) ink.push(q.ink);
    // `label` centres a line's capitals in its box: this is its baseline.
    const base = company ? foot + (labelH - 2) / 2 - LABEL_CAP / 2 : foot;
    let markRight = -w / 2 + m;
    if (ctx.markHere) {
      // As far left as the burst lets it stand (its top-left corner is the one nearest the burst),
      // smaller only where no place left of the QR holds it.
      const right = qrBox.minX - GUTTER;
      place: for (let size = BACK_MARK; size >= 10; size -= 0.5) {
        for (let x = -w / 2 + m; x + size <= right; x += 0.25) {
          if (base + size > belowArc(c, clear, x)) continue;
          const mk = ctx.mark({ minX: x, maxX: x + size, minY: base, maxY: base + size });
          if (mk) {
            ink.push(mk);
            markRight = x + size + GUTTER;
          }
          break place;
        }
      }
    }
    if (company) {
      const label = ctx.label(company, { minX: markRight, maxX: w / 2 - m, minY: foot, maxY: foot + labelH - 2 }, { cap: LABEL_CAP, align: 'right', upper: true });
      if (label) ink.push(label);
    }
    return { pattern, ink };
  },
};

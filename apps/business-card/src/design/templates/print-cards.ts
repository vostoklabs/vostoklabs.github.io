// What the print-first templates share: the size the contact lines start at, how wide a line and
// how tall a block of them will stand (to arrange them round a QR, a tap mark or a texture before
// the lockup sets them), the split of the lines into those that pass beside something and those
// that need the card's width, the open spot for an NFC tag's printed mark, and a back without a QR.
import type { Box, Pt, Ring, Shapes } from '@vostok/shapes';
import { NFC_TAGS, type Ctx, type Side } from '../build';
import { BORDER } from '../layout';
import { FLOORS, ICON_GAP, ICON_RATIO, type LockupText, type Role } from '../lockup';
import { applyCase } from '../text';
import type { Ink } from '../types';
import { standardBack, type BackOpts } from './common';

/** The lettering's margin from the card's edge, mm (the floor is 4). */
export const EDGE = 5;

/** A contact line's icon and the air after it, in capitals of the line, as the lockup sets them. */
const ICON_W = ICON_RATIO + ICON_GAP;

/** The contact lines a template sets, in its order, the blank ones left out. Email comes last by
 *  default: it is usually the longest line, and the last line is the one with the room. */
export function contactRoles(ctx: Ctx, order: Role[] = ['phone', 'web', 'email']): Role[] {
  return order.filter((r) => ctx.text[r as keyof LockupText]?.trim());
}

/** The capital height the lockup starts the contact lines at on this side: the size asked, never
 *  under the finish's floor (raised only on a raised card's front). */
export function detailCap(ctx: Ctx): number {
  const raised = ctx.side === 'front' && ctx.s.raise > 1e-6;
  return Math.max(raised ? FLOORS.raised.detail : FLOORS.flush.detail, ctx.s.detailSize);
}

/** How wide a contact line stands at `cap`, its icon included when the card shows icons. Exact for
 *  the text (the lockup lays it out the same way), generous for the icon. */
function rowWidth(ctx: Ctx, role: Role, cap: number): number {
  const text = ctx.text[role as keyof LockupText] ?? '';
  return ctx.measure(text) * cap + (ctx.s.iconStyle !== 'none' ? ICON_W * cap : 0);
}

/**
 * How tall `roles` stand stacked in one slot `width` wide, as the lockup sets them on this side, mm
 * (0 for none). A probe: the slot is as tall as anything could need, so it overflows only where the
 * real slot, as wide, would too, and then the warning is the same one.
 */
export function heightOf(ctx: Ctx, roles: Role[], width: number, o: { rule?: boolean; icons?: boolean } = {}): number {
  if (!roles.length) return 0;
  const l = ctx.lettering([{ box: { minX: 0, maxX: width, minY: -500, maxY: 500 }, roles, align: 'left', valign: 'top' }], o);
  const b = l.blocks[0]!;
  return b.maxY - b.minY;
}

/** How wide the name stands at `cap`, as the card sets it. */
export function nameWidth(ctx: Ctx, cap: number): number {
  return ctx.measure(applyCase(ctx.text.name, ctx.s.nameCase)) * cap;
}

/**
 * The contact lines split round something on the right: those that pass beside it (no wider than
 * `beside`), and those that need the card's whole width and so go above or below it, as many as
 * `fits` accepts (it is handed the long lines chosen and whether they keep their icons, and measures
 * their room). The narrowest of the long lines give way first: set beside it after all, they are the
 * likeliest to pass without their icons. `icons` says whether the lines keep their icons: not when
 * one set beside it only passes without (the lockup would drop every icon then, so the heights are
 * measured that way).
 */
export function splitRows(ctx: Ctx, roles: Role[], beside: number, fits: (full: Role[], icons: boolean) => boolean = () => true): { beside: Role[]; full: Role[]; icons: boolean } {
  const cap = detailCap(ctx);
  const wide = (r: Role) => rowWidth(ctx, r, cap) > beside + 1e-6;
  let full = roles.filter(wide).sort((a, b) => rowWidth(ctx, b, cap) - rowWidth(ctx, a, cap));
  let icons = ctx.s.iconStyle !== 'none';
  for (;;) {
    const rest = roles.filter((r) => !full.includes(r));
    icons = ctx.s.iconStyle !== 'none' && !rest.some(wide);
    if (!full.length || fits(roles.filter((r) => full.includes(r)), icons)) break;
    full = full.slice(0, -1);
  }
  return { beside: roles.filter((r) => !full.includes(r)), full: roles.filter((r) => full.includes(r)), icons };
}

/** The back with the mark and the company and no QR (a template whose QR is on the front). */
export function backWithoutQr(ctx: Ctx, o: BackOpts = {}): Side {
  return standardBack({ ...ctx, qrHere: false }, o);
}

/** How far from the middle the NFC tag's centre may go, mm, so its pocket keeps a border of card. */
function pocketReach(ctx: Ctx): { mx: number; my: number } {
  const tag = NFC_TAGS[ctx.s.nfcTag] ?? NFC_TAGS['25']!;
  const r = tag.dia / 2 + 0.5;
  return { mx: Math.max(0, ctx.w / 2 - BORDER / 2 - r), my: Math.max(0, ctx.h / 2 - BORDER / 2 - r) };
}

/** Where the NFC tag may sit, clamped so the pocket keeps its border of solid card. */
export function pocketAt(ctx: Ctx, at: Pt): Pt {
  const { mx, my } = pocketReach(ctx);
  return [Math.max(-mx, Math.min(mx, at[0])), Math.max(-my, Math.min(my, at[1]))];
}

/** The spacing the search for open card samples at, and the outlines it measures from, mm. */
const SPOT_STEP = 1.5;
const SPOT_SAMPLE = 0.8;

/**
 * Where the NFC tag goes on a card that prints the small tap mark over it: of the places its pocket
 * may take (inside `within`, when given), the one with the most open card round it, so the mark lands
 * clear of the lettering, the QR and the colour fields. Ink is measured to each island's box, as the
 * build checks the spot it is handed (a spot that fails there is moved to a corner); `areas` (fields,
 * carving, a pattern's region) are kept off by their outline. Without the mark the tag is hidden and
 * goes at `fallback`.
 */
export function pocketSpot(ctx: Ctx, ink: Ink[], areas: Shapes[], fallback: Pt, within?: Box): Pt {
  if (!(ctx.s.nfc && ctx.s.nfcMark)) return pocketAt(ctx, fallback);
  const { mx, my } = pocketReach(ctx);
  const x0 = Math.max(-mx, within?.minX ?? -mx);
  const x1 = Math.min(mx, within?.maxX ?? mx);
  const y0 = Math.max(-my, within?.minY ?? -my);
  const y1 = Math.min(my, within?.maxY ?? my);
  if (x0 > x1 || y0 > y1) return pocketAt(ctx, fallback);

  const boundsOf = (rings: Ring[]): Box => {
    const pts = rings.flat();
    return { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])) };
  };
  const boxes = ink.flatMap((i) => i.shapes.filter((island) => island.length && island[0]!.length).map(boundsOf));
  // The areas' outlines sampled along their edges, and each island kept whole for the inside test.
  const pts: Pt[] = [];
  const islands = areas.flatMap((shapes) => shapes.filter((island) => island.length && island[0]!.length).map((ring) => ({ ring, box: boundsOf(ring) })));
  for (const { ring } of islands) {
    for (const r of ring) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i]!;
        const b = r[(i + 1) % r.length]!;
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / SPOT_SAMPLE));
        for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
    }
  }
  if (!boxes.length && !pts.length) return pocketAt(ctx, fallback);
  const inside = ([x, y]: Pt) => islands.some(({ ring, box }) => {
    if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) return false;
    let odd = false;
    for (const r of ring) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i]!;
        const [xj, yj] = r[j]!;
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
      }
    }
    return odd;
  });

  // The open spot: the most room to the nearest ink box (square, as the mark is) and area outline,
  // outside every area; nearer the fallback on a tie.
  let best: Pt = pocketAt(ctx, fallback);
  let bestScore = -Infinity;
  for (let x = x0; x <= x1 + 1e-9; x += SPOT_STEP) {
    for (let y = y0; y <= y1 + 1e-9; y += SPOT_STEP) {
      if (inside([x, y])) continue;
      const bias = 0.01 * Math.hypot(x - fallback[0], y - fallback[1]);
      let room = Infinity;
      for (const b of boxes) room = Math.min(room, Math.max(b.minX - x, x - b.maxX, b.minY - y, y - b.maxY));
      if (room - bias <= bestScore) continue;
      // The nearest outline, given up on as soon as it is nearer than the best spot's room.
      const floor = bestScore + bias;
      const floor2 = floor > 0 ? floor * floor : 0;
      let d2 = room > 0 ? room * room : 0;
      for (const p of pts) {
        const dx = p[0] - x;
        const dy = p[1] - y;
        const q = dx * dx + dy * dy;
        if (q < d2) {
          d2 = q;
          if (d2 < floor2) break;
        }
      }
      const score = Math.min(room, Math.sqrt(d2)) - bias;
      if (score > bestScore) [best, bestScore] = [[x, y], score];
    }
  }
  return best;
}

/** Every point of some ink, for measuring what stands where once the lockup has set it. */
export function pointsOf(ink: Ink[]): Pt[] {
  return ink.flatMap((i) => i.shapes.flat(2));
}

/** The inks of a lettering that lie in a box (a slot's block), within a hair. */
export function inkIn(ink: Ink[], box: { minX: number; maxX: number; minY: number; maxY: number }): Ink[] {
  const e = 0.05;
  return ink.filter((i) => i.shapes.flat(2).every(([x, y]) => x >= box.minX - e && x <= box.maxX + e && y >= box.minY - e && y <= box.maxY + e));
}

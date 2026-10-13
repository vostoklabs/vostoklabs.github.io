// The card itself and the geometry templates are drawn with: sizes, the outline, a convex outline
// cut by a line or another convex outline, boxes and rings. Adapted from Laser Studio's card
// helpers (the same clips, the same boxes), with the shapes core's types.
import { circleRing, roundedRectRing, type Pt, type Ring, type Shapes } from '@vostok/shapes';
import type { Box } from '@vostok/shapes';

/** The real business-card sizes, mm, landscape: ISO/EU, US, the 90 × 50 common across Europe, and
 *  Japan's. A portrait template turns them on end. */
export const CARD_SIZES: Record<string, { w: number; h: number; label: string }> = {
  '85x55': { w: 85, h: 55, label: '85 × 55' },
  '89x51': { w: 89, h: 51, label: '89 × 51' },
  '90x50': { w: 90, h: 50, label: '90 × 50' },
  '91x55': { w: 91, h: 55, label: '91 × 55' },
};
export const DEFAULT_SIZE = '85x55';

export function cardSize(id: string, portrait = false): { w: number; h: number } {
  const s = CARD_SIZES[id] ?? CARD_SIZES[DEFAULT_SIZE]!;
  return portrait ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
}

/** The solid margin every template keeps clear round the card: nothing is printed into it but the
 *  colour fields that run off the edge on purpose. */
export const BORDER = 4;
/** Air between lettering and anything else on the face, mm. */
export const GUTTER = 3;
/** Card kept between an NFC pocket and anything cut through the card, mm. */
export const POCKET_WALL = 1.2;

/** The card's outline, centred, anticlockwise. */
export const cardRing = (w: number, h: number, corner: number): Ring => roundedRectRing(w, h, Math.max(0, Math.min(corner, w / 2, h / 2)), 16);

/**
 * A convex ring cut by the line `x = at`, keeping the side `keep` says (Sutherland–Hodgman against
 * one edge). The card is convex, so a part of it is one ring, and a region built this way follows
 * the card's own rounded corners instead of poking past them.
 */
export function clipX(ring: Ring, at: number, keep: 'left' | 'right'): Ring {
  const inside = (p: Pt) => (keep === 'left' ? p[0] <= at : p[0] >= at);
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = (at - a[0]) / (b[0] - a[0]);
      out.push([at, a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

/** The same cut along `y = at`, keeping the part above or below it. */
export function clipY(ring: Ring, at: number, keep: 'above' | 'below'): Ring {
  const swap = (r: Ring): Ring => r.map(([x, y]): Pt => [y, x]);
  // Swapping the axes mirrors the ring; the swap back restores the winding.
  return swap(clipX(swap(ring), at, keep === 'above' ? 'right' : 'left'));
}

/** A convex ring clipped by another convex ring (both anticlockwise): what the two share. */
export function clipConvex(subject: Ring, clip: Ring): Ring {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const [ax, ay] = clip[i]!;
    const [bx, by] = clip[(i + 1) % clip.length]!;
    const side = ([x, y]: Pt) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const next: Ring = [];
    for (let j = 0; j < out.length; j++) {
      const p = out[j]!;
      const q = out[(j + 1) % out.length]!;
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) next.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        next.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    out = next;
  }
  return out;
}

/** Shapes mirrored left ↔ right, winding kept. */
export const mirrorShapes = (shapes: Shapes): Shapes => shapes.map((island) => island.map((r) => r.map(([x, y]): Pt => [-x, y]).reverse()));
export const mirrorBox = (b: Box): Box => ({ minX: -b.maxX, maxX: -b.minX, minY: b.minY, maxY: b.maxY });
export const mirrorPt = ([x, y]: Pt): Pt => [-x, y];

/** A box from its centre and size. */
export const boxAt = (cx: number, cy: number, w: number, h: number): Box => ({ minX: cx - w / 2, maxX: cx + w / 2, minY: cy - h / 2, maxY: cy + h / 2 });
/** A box shrunk by `d` on every side. */
export const shrinkBox = (b: Box, d: number): Box => ({ minX: b.minX + d, maxX: b.maxX - d, minY: b.minY + d, maxY: b.maxY - d });
export const boxW = (b: Box) => b.maxX - b.minX;
export const boxH = (b: Box) => b.maxY - b.minY;

/** A box as a rounded-rectangle ring, `r` clamped to fit, anticlockwise. */
export const boxRing = (b: Box, r: number): Ring => {
  const w = boxW(b);
  const h = boxH(b);
  return roundedRectRing(w, h, Math.max(0, Math.min(r, w / 2, h / 2)), 8).map(([x, y]): Pt => [x + (b.minX + b.maxX) / 2, y + (b.minY + b.maxY) / 2]);
};

/** A disc, anticlockwise. */
export const disc = (cx: number, cy: number, r: number, seg = 96): Ring => circleRing(cx, cy, r, seg);

/** A ring (annulus) as one island: the outer disc and the inner one as its hole. */
export const annulus = (cx: number, cy: number, r: number, width: number, seg = 120): Shapes =>
  [[disc(cx, cy, r, seg), disc(cx, cy, r - width, seg).reverse()]];

/** The part of the card a disc covers (both convex): a corner disc, a swoosh's edge. */
export const cardPart = (outline: Ring, clip: Ring): Ring => clipConvex(outline, clip);

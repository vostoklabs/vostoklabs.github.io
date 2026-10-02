// Where a keyring hole lands on a shape. The keyring is a property (mode, side, how far along),
// so it stays editable and the hole can be dragged along the edge; the CSG that bakes it into
// the outline lives in `csg2d.ts` (`applyKeyring`) and runs wherever manifold does.
import type { Keyring, Shapes } from './types';
import { bboxOf, type Pt } from './rings';

type Side = Keyring['side'];

const OUTWARD: Record<Side, Pt> = { left: [-1, 0], right: [1, 0], top: [0, 1], bottom: [0, -1] };

/**
 * The point on the outline where a line through `along` on `side` leaves the shape — a
 * ray-cast against the outer rings, so a heart's top edge is the lobe, not the bbox. Falls
 * back to the bbox edge where the line misses (a gap between two islands).
 */
export function edgePoint(shapes: Shapes, side: Side, along: number): Pt {
  const b = bboxOf(shapes);
  const t = Math.max(0, Math.min(1, along));
  const vertical = side === 'top' || side === 'bottom';
  const at = vertical ? b.minX + t * (b.maxX - b.minX) : b.minY + t * (b.maxY - b.minY);
  let best: number | null = null;
  for (const island of shapes) {
    const outer = island[0];
    if (!outer) continue;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const [x1, y1] = outer[j]!;
      const [x2, y2] = outer[i]!;
      const a1 = vertical ? x1 : y1;
      const a2 = vertical ? x2 : y2;
      if (a1 === a2 || at < Math.min(a1, a2) || at > Math.max(a1, a2)) continue;
      const u = (at - a1) / (a2 - a1);
      const v = vertical ? y1 + u * (y2 - y1) : x1 + u * (x2 - x1);
      if (best === null) best = v;
      else if (side === 'top' || side === 'right') best = Math.max(best, v);
      else best = Math.min(best, v);
    }
  }
  if (best === null) best = side === 'top' ? b.maxY : side === 'bottom' ? b.minY : side === 'right' ? b.maxX : b.minX;
  return vertical ? [at, best] : [best, at];
}

/** Where the hole's centre lands, in the shape's own frame. */
export function holeCentre(shapes: Shapes, k: Keyring): Pt {
  const e = edgePoint(shapes, k.side, k.along);
  const [ox, oy] = OUTWARD[k.side];
  // Inside: the hole sits `ring` in from the edge. Outside: the lug's centre sits half a ring
  // past the edge, so the lug overlaps the body by half a ring and the close blends the neck.
  const d = k.mode === 'inside' ? -(k.ring + k.dia / 2) : k.dia / 2 + k.ring / 2;
  return [e[0] + ox * d, e[1] + oy * d];
}

/** From a point in the shape's frame (a drag), the side it is nearest and how far along. */
export function nearestEdge(shapes: Shapes, p: Pt): { side: Side; along: number } {
  const b = bboxOf(shapes);
  const w = Math.max(b.maxX - b.minX, 1e-6);
  const h = Math.max(b.maxY - b.minY, 1e-6);
  const dist: Record<Side, number> = { left: p[0] - b.minX, right: b.maxX - p[0], bottom: p[1] - b.minY, top: b.maxY - p[1] };
  const side = (Object.keys(dist) as Side[]).reduce((a, s) => (dist[s] < dist[a] ? s : a));
  const along = side === 'top' || side === 'bottom' ? (p[0] - b.minX) / w : (p[1] - b.minY) / h;
  return { side, along: Math.round(Math.max(0, Math.min(1, along)) * 100) / 100 };
}

// Small ring builders the box features use: doorways and edge notches. Pure, millimetres, Y up,
// counter-clockwise. Rectangles and rounded rectangles are the shapes core's (`rectRing`,
// `roundedRectRing`), circles the shelf's `circleRing`.
import type { Pt, Ring } from './types';

/**
 * A cut-out rising from a bottom edge at y = `y0`: square shoulders on the edge, the top two
 * corners rounded by `r`. It starts a little BELOW the edge so the boolean that takes it away
 * leaves no hair of material along the bottom.
 */
export function doorwayRing(x0: number, x1: number, y0: number, height: number, r: number, seg = 10): Ring {
  const rr = Math.max(0, Math.min(r, height, (x1 - x0) / 2));
  const under = y0 - 1;
  const top = y0 + height;
  const out: Ring = [[x0, under], [x1, under]];
  if (rr < 1e-6) {
    out.push([x1, top], [x0, top]);
    return out;
  }
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2);
    out.push([x1 - rr + rr * Math.cos(a), top - rr + rr * Math.sin(a)]);
  }
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI / 2 + (i / seg) * (Math.PI / 2);
    out.push([x0 + rr + rr * Math.cos(a), top - rr + rr * Math.sin(a)]);
  }
  return out;
}

/** A half-disc bitten out of an edge: centre on the edge at (cx, y0), opening downward into
 *  the piece when `down` (a notch in a top edge) — it overshoots the edge by 1 mm. */
export function edgeNotchRing(cx: number, y0: number, r: number, down: boolean, seg = 24): Ring {
  const out: Ring = [];
  const s = down ? -1 : 1;
  out.push([cx + r, y0 - s * 1]);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI;
    out.push([cx + r * Math.cos(a), y0 + s * r * Math.sin(a)]);
  }
  out.push([cx - r, y0 - s * 1]);
  return down ? out.reverse() : out;
}

/** Translate a ring. */
export const moveRing = (r: Ring, dx: number, dy: number): Ring => r.map(([x, y]) => [x + dx, y + dy] as Pt);

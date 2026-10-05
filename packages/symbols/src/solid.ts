import type { Ring, Shapes } from './outline';

/*
  Whether a symbol prints as ONE solid blob.

  Most symbols are drawn to read at 16 px: a bicycle is two hoops and a frame, a face is a disc
  with three holes. As a filled silhouette a few millimetres across — a charm on a hook, one
  colour, bevelled — almost none of that survives. So a product that can only make a silhouette
  offers only the symbols that are one blob:

    - one outline, with nothing else of consequence inside or beside it (no hole, no second
      piece above 6 % of its area);
    - it fills at least 40 % of its own bounding box (a bare outline or a thin bar does not);
    - it fills at least 62 % of its convex hull (spiky or spidery shapes do not);
    - it is not a sliver (aspect under 3:1).

  Measured on clean islands (contract.ts), never on raw font contours. Material Symbols' filled
  glyphs draw some contours twice, wound against each other, and lay others over each other;
  read raw, a copy is a hole the size of the glyph and an overlap a second piece, and only 17 of
  1,487 glyphs passed. Every set is stored as the union of its drawing, so none of that is left.
*/

function area(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return Math.abs(a) / 2;
}

/** Area of the convex hull (monotone chain). */
function hullArea(ring: Ring): number {
  const pts = [...ring].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return 0;
  const cross = (o: Ring[number], a: Ring[number], b: Ring[number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Ring): Ring => {
    const out: Ring = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return area([...half(pts), ...half([...pts].reverse())]);
}

/** True when the shapes are one solid blob, by the rules above. */
export function isSolidShape(shapes: Shapes): boolean {
  const rings = shapes.flat().filter((r) => r.length >= 3);
  if (!rings.length) return false;
  const areas = rings.map(area);
  const outerIdx = areas.indexOf(Math.max(...areas));
  const outer = rings[outerIdx]!;
  const outerArea = areas[outerIdx]!;
  if (outerArea <= 0) return false;
  for (let i = 0; i < rings.length; i++) if (i !== outerIdx && areas[i]! > outerArea * 0.06) return false;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outer) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < 1e-9 || h < 1e-9) return false;
  if (Math.max(w / h, h / w) > 3) return false;
  if (outerArea / (w * h) < 0.4) return false;
  const hull = hullArea(outer);
  return !(hull > 0 && outerArea / hull < 0.62);
}

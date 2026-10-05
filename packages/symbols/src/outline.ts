/*
  A symbol's outline as text, and back.

  Every symbol is held in one frame: centred on its bounding box, its longest side 1, Y up.
  Shapes are islands: one outer ring followed by its holes, each ring a closed polygon whose
  first point is not repeated — the contract `buildCutSvg` and the 3D builders already take.

  The data files store an outline as SVG path data, so the same string can be drawn as it is:
  integers in a box whose longest side is `OUTLINE_BOX`, centred on 0, Y down (SVG's way), every
  ring an `m` followed by relative line steps and a `z`. An outer ring is wound anticlockwise
  (with Y up) and is followed by its own holes, wound clockwise, so the islands come back from
  the winding alone, with no geometry at load time.
*/

export type Ring = [number, number][];
/** Islands: each is an outer ring and then its holes. */
export type Shapes = Ring[][];

/** The longest side of a stored outline, in its own integer units. */
export const OUTLINE_BOX = 1000;

function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return a / 2;
}

/** Stored path data to shapes in the symbol frame. */
export function decodeOutline(d: string): Shapes {
  const nums = d.match(/[mz]|-?\d+/g) ?? [];
  const rings: Ring[] = [];
  let startX = 0;
  let startY = 0;
  let ring: Ring | null = null;
  let x = 0;
  let y = 0;
  for (let i = 0; i < nums.length; ) {
    const t = nums[i++]!;
    if (t === 'm') {
      // After a `z` the pen is back at the start of the ring it closed, so a move is relative
      // to that point.
      x = startX + Number(nums[i++]);
      y = startY + Number(nums[i++]);
      startX = x;
      startY = y;
      ring = [[x, y]];
    } else if (t === 'z') {
      if (ring && ring.length >= 3) rings.push(ring);
      ring = null;
      x = startX;
      y = startY;
    } else {
      x += Number(t);
      y += Number(nums[i++]);
      ring?.push([x, y]);
    }
  }
  const k = 1 / OUTLINE_BOX;
  const islands: Shapes = [];
  for (const r of rings) {
    const up: Ring = r.map(([px, py]) => [px * k, -py * k]);
    if (signedArea(up) > 0 || !islands.length) islands.push([up]);
    else islands[islands.length - 1]!.push(up);
  }
  return islands;
}

/**
 * Shapes in the symbol frame to stored path data: rounded to the box, outers anticlockwise
 * and each followed by its holes. Rings that round away to nothing are dropped, and an island
 * whose outer goes takes its holes with it.
 */
export function encodeOutline(shapes: Shapes): string {
  const MIN_AREA = 4; // square units of the box: well under a tenth of a millimetre on any print
  let out = '';
  let px = 0;
  let py = 0;
  for (const island of shapes) {
    const rings: Ring[] = [];
    island.forEach((ring, n) => {
      let q: Ring = ring.map(([x, y]) => [Math.round(x * OUTLINE_BOX), Math.round(y * OUTLINE_BOX)]);
      q = q.filter((p, i) => {
        const prev = q[(i + q.length - 1) % q.length]!;
        return i === 0 ? p[0] !== q[q.length - 1]![0] || p[1] !== q[q.length - 1]![1] : p[0] !== prev[0] || p[1] !== prev[1];
      });
      const a = q.length >= 3 ? signedArea(q) : 0;
      if (Math.abs(a) < MIN_AREA) {
        if (n === 0) rings.length = 0;
        return;
      }
      if (n > 0 && !rings.length) return;
      const outer = n === 0;
      if (outer !== a > 0) q.reverse();
      rings.push(q);
    });
    for (const q of rings) {
      // Stored Y down.
      const pts = q.map(([x, y]) => [x, -y] as [number, number]);
      let s = `m${pts[0]![0] - px} ${pts[0]![1] - py}`;
      let lx = pts[0]![0];
      let ly = pts[0]![1];
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i]![0] - lx;
        const dy = pts[i]![1] - ly;
        s += `${dx < 0 ? '' : ' '}${dx}${dy < 0 ? '' : ' '}${dy}`;
        lx = pts[i]![0];
        ly = pts[i]![1];
      }
      out += `${s}z`;
      px = pts[0]![0];
      py = pts[0]![1];
    }
  }
  return out;
}

/** Shapes in the symbol frame as SVG path data for a `viewBox="-0.5 -0.5 1 1"` (Y down). Draw
 *  it with the non-zero rule, SVG's default: the windings are the font's or the stored ones, so
 *  two overlapping pieces of one glyph stay solid where an even-odd fill would cut them apart. */
export function outlinePath(shapes: Shapes): string {
  const f = (v: number) => String(Math.round(v * 10000) / 10000);
  return shapes
    .flat()
    .map((r) => `M${r.map(([x, y]) => `${f(x)} ${f(-y)}`).join('L')}Z`)
    .join('');
}

/** Shapes in the symbol frame scaled so the longest side is `size` (millimetres, say). */
export function scaleShapes(shapes: Shapes, size: number): Shapes {
  return shapes.map((island) => island.map((ring) => ring.map(([x, y]): [number, number] => [x * size, y * size])));
}

/** Shapes centred on their bounding box with the longest side 1: the symbol frame. */
export function toSymbolFrame(shapes: Shapes): Shapes {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const island of shapes) {
    for (const ring of island) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!Number.isFinite(minX)) return [];
  const k = 1 / Math.max(maxX - minX, maxY - minY, 1e-9);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return shapes.map((island) => island.map((ring) => ring.map(([x, y]): [number, number] => [(x - cx) * k, (y - cy) * k])));
}

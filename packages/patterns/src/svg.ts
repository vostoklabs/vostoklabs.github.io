// Pictures of a fill: a standalone SVG in laser colours for previews and contact sheets, and
// a tiny path for a picker tile. Both flip Y, because the engine is Y up and SVG is not.
import { fillShape } from './fill';
import { bboxOfShapes } from './geom';
import type { FillResult, Params, PatternDef, Pt, Shapes } from './types';

export const OP_COLOUR = { cut: '#e11d48', score: '#2563eb', engrave: '#111111' } as const;

const mm = (v: number): string => (Math.abs(v) < 5e-4 ? '0' : String(Math.round(v * 1000) / 1000));

function ringD(ring: Pt[], flip: (p: Pt) => Pt, close: boolean): string {
  return ring.map((p, i) => `${i ? 'L' : 'M'}${mm(flip(p)[0])} ${mm(flip(p)[1])}`).join('') + (close ? 'Z' : '');
}

/** An outer wound counter-clockwise (positive area, Y up), a hole clockwise. */
function oriented(ring: Pt[], outer: boolean): Pt[] {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return (a > 0) === outer ? ring : [...ring].reverse();
}

export interface SvgOptions {
  /** Draw the region as a tan plate under the pattern (a preview) or leave it as an outline. */
  plate?: boolean;
  /** Hairline width in mm for cut/score strokes. */
  hairline?: number;
  /** Air around the region, mm. */
  margin?: number;
  /** Pixel width; the height follows the region. Absent: 1 px per mm. */
  width?: number;
}

/** One fill drawn over its region. */
export function fillSvg(region: Shapes, fills: FillResult[], opts: SvgOptions = {}): string {
  const box = bboxOfShapes(region);
  const margin = opts.margin ?? 2;
  const w = box.maxX - box.minX + 2 * margin;
  const h = box.maxY - box.minY + 2 * margin;
  const flip = (p: Pt): Pt => [p[0] - box.minX + margin, box.maxY - p[1] + margin];
  const hair = opts.hairline ?? 0.25;
  const plateD = region.map((island) => island.map((r) => ringD(r, flip, true)).join('')).join('');
  const parts: string[] = [];
  parts.push(
    opts.plate === false
      ? `<path d="${plateD}" fill="none" stroke="${OP_COLOUR.cut}" stroke-width="${hair}" fill-rule="evenodd"/>`
      : `<path d="${plateD}" fill="#d9b98a" stroke="#8a6d3b" stroke-width="${hair}" fill-rule="evenodd"/>`,
  );
  for (const f of fills) {
    const colour = OP_COLOUR[f.op];
    if (f.op === 'engrave') {
      // Nonzero, with every outer wound one way and every hole the other: islands that overlap
      // (a tile's wrap-around copies, the bands of an engraved line) union instead of cancelling,
      // and the counters still punch. What a laser's raster fill does with the same shapes.
      const d = f.shapes.map((island) => island.map((r, i) => ringD(oriented(r, i === 0), flip, true)).join('')).join('');
      if (d) parts.push(`<path d="${d}" fill="${colour}" fill-rule="nonzero"/>`);
    } else {
      const d = f.shapes.map((island) => island.map((r) => ringD(r, flip, true)).join('')).join('');
      if (d) parts.push(`<path d="${d}" fill="${f.op === 'cut' && opts.plate !== false ? '#f3f4f6' : 'none'}" stroke="${colour}" stroke-width="${hair}" fill-rule="evenodd"/>`);
    }
    const pd = f.paths.map((p) => ringD(p, flip, false)).join('');
    if (pd) parts.push(`<path d="${pd}" fill="none" stroke="${colour}" stroke-width="${f.op === 'engrave' ? hair * 1.6 : hair}" stroke-linecap="round"/>`);
  }
  const px = opts.width ?? w;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${mm(px)}" height="${mm((px * h) / w)}" viewBox="0 0 ${mm(w)} ${mm(h)}">${parts.join('')}</svg>`;
}

/**
 * A picker tile: the pattern over a square of `box` units as ONE path `d` in SVG orientation,
 * meant to be FILLED (the kit's picker tiles fill `currentColor` and know nothing of strokes).
 * Regions come through as regions; lines and scored outlines are widened into thin filled
 * strokes, so a lattice reads as a lattice in a tile that cannot stroke. `periods` says how
 * many cells show across the tile, so dots read as dots and a lattice as a lattice.
 */
export function thumbPath(def: PatternDef, params?: Partial<Params>, box = 40, periods = def.thumb?.periods ?? 3, strokeWidth = box / 45): { d: string; filled: boolean } {
  const square: Shapes = [[[[0, 0], [box, 0], [box, box], [0, box]]]];
  const op = def.ops[0] ?? 'score';
  const merged: Partial<Params> = { ...def.thumb?.params, ...params };
  // Scale the pattern so `periods` cells span the tile — a field pattern says its own scale.
  let scale = def.thumb?.scale ?? 1;
  if (def.cell) {
    const resolved: Params = {};
    for (const s of def.params) resolved[s.key] = merged[s.key] ?? s.value;
    const c = def.cell(resolved);
    const span = Math.max(c.w, c.h);
    if (span > 1e-6) scale = box / (periods * span);
  }
  const r = fillShape(square, def, { op, params: merged, scale, web: 0, inset: 0, partial: op === 'cut' ? 'drop' : 'clip' });
  const flip = (p: Pt): Pt => [p[0], box - p[1]];
  const regions = op === 'score' ? [] : r.shapes;
  const outlines: Pt[][] = op === 'score' ? r.shapes.flatMap((island) => island.map((ring) => [...ring, ring[0]!])) : [];
  const strokes = [...r.paths, ...outlines].flatMap((line) => strokeQuads(line, strokeWidth));
  const d = regions.map((island) => island.map((ring) => ringD(ring, flip, true)).join('')).join('') + strokes.map((q) => ringD(q, flip, true)).join('');
  return { d, filled: true };
}

/** A polyline as thin filled quads, one per segment, with square-ish ends. */
function strokeQuads(line: Pt[], width: number): Pt[][] {
  const out: Pt[][] = [];
  const h = width / 2;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = (-dy / len) * h;
    const ny = (dx / len) * h;
    // Extend each end by half the width so consecutive quads overlap at the joins.
    const ex = (dx / len) * h;
    const ey = (dy / len) * h;
    out.push([[a[0] + nx - ex, a[1] + ny - ey], [b[0] + nx + ex, b[1] + ny + ey], [b[0] - nx + ex, b[1] - ny + ey], [a[0] - nx - ex, a[1] - ny - ey]]);
  }
  return out;
}

// The pieces on sheets: MaxRects packing, each piece tried both ways round, the best of several
// scorings and orders kept (`packSheets`).
// Not a true-shape nesting solver: a box is a handful of near-rectangles, and their boxes packed
// well is what a person would do by hand. (Shelves — the first version — put a 120 × 90 × 70
// box on two 300 mm sheets; this puts it on one.)
//
// Sheet coordinates are millimetres, Y up, (0, 0) the sheet's bottom-left corner. A piece is
// placed by turning its own frame by `rot` (0 or 90, counter-clockwise) and moving the corner of
// its turned box to (x, y).
import type { Pt, Shapes } from './types';

export interface SheetSize {
  width: number;
  height: number;
}

export interface Placement {
  id: string;
  sheet: number;
  rot: 0 | 90;
  x: number;
  y: number;
}

/** Clear border round the sheet, mm — what the machine's clamps and a warped edge need. */
export const SHEET_MARGIN = 5;
/** Air between two pieces, mm. */
export const PIECE_GAP = 3;

export function boxOf(shapes: Shapes): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const island of shapes) for (const ring of island) for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** A point of a piece's own frame, on the sheet. */
export function placePoint(p: Pt, pl: Placement, box: { minX: number; minY: number; maxX: number; maxY: number }): Pt {
  if (pl.rot === 0) return [pl.x + (p[0] - box.minX), pl.y + (p[1] - box.minY)];
  // Turned 90° CCW: (x, y) → (−y, x); the turned box's min corner is (−maxY, minX).
  return [pl.x + (-p[1] + box.maxY), pl.y + (p[0] - box.minX)];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How a free rectangle is scored for a box: best short side, best long side, best area, or
 *  bottom-left. Each wins on some boxes, so every one is tried (`packSheets`). */
type Heuristic = 'bssf' | 'blsf' | 'baf' | 'bl';

/** One sheet's free space, as the maximal empty rectangles. */
class Bin {
  free: Rect[];
  constructor(w: number, h: number) {
    this.free = [{ x: 0, y: 0, w, h }];
  }

  /** The best spot for a w × h box by `how` (lower scores win). Null when it fits nowhere. */
  find(w: number, h: number, how: Heuristic): { r: Rect; score: [number, number] } | null {
    let best: { r: Rect; score: [number, number] } | null = null;
    for (const f of this.free) {
      if (w > f.w + 1e-6 || h > f.h + 1e-6) continue;
      const a = f.w - w;
      const b = f.h - h;
      const score: [number, number] =
        how === 'bssf' ? [Math.min(a, b), Math.max(a, b)]
          : how === 'blsf' ? [Math.max(a, b), Math.min(a, b)]
            : how === 'baf' ? [f.w * f.h - w * h, Math.min(a, b)]
              : [f.y + h, f.x];
      if (!best || score[0] < best.score[0] - 1e-9 || (Math.abs(score[0] - best.score[0]) < 1e-9 && score[1] < best.score[1] - 1e-9)) best = { r: { x: f.x, y: f.y, w, h }, score };
    }
    return best;
  }

  place(used: Rect): void {
    const next: Rect[] = [];
    for (const f of this.free) {
      if (used.x >= f.x + f.w || used.x + used.w <= f.x || used.y >= f.y + f.h || used.y + used.h <= f.y) {
        next.push(f);
        continue;
      }
      if (used.x > f.x) next.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h });
      if (used.x + used.w < f.x + f.w) next.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - (used.x + used.w), h: f.h });
      if (used.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y });
      if (used.y + used.h < f.y + f.h) next.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - (used.y + used.h) });
    }
    // Drop any free rectangle another one holds.
    this.free = next.filter((a, i) => !next.some((b, j) => j !== i && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (j < i || a.w !== b.w || a.h !== b.h || a.x !== b.x || a.y !== b.y)));
  }
}

interface Item {
  id: string;
  w: number;
  h: number;
}

/** One packing: `order` placed in turn, every free spot scored by `how`; pieces turned 90° only
 *  when `turn` (or when one fits no other way). */
function packOnce(order: Item[], W: number, H: number, how: Heuristic, turn: boolean) {
  const bins: Bin[] = [];
  /** How high each sheet is used, mm: the tie-break between packings with as many sheets. */
  const tops: number[] = [];
  const placements = new Map<string, Placement>();
  const tooBig: string[] = [];
  const better = (p: [number, number], q: [number, number]) => p[0] < q[0] - 1e-9 || (Math.abs(p[0] - q[0]) < 1e-9 && p[1] <= q[1]);
  for (const it of order) {
    const fits = (it.w <= W && it.h <= H) || (it.h <= W && it.w <= H);
    if (!fits) {
      // On a sheet of its own, from the corner: the file is still whole, and the status says why.
      tooBig.push(it.id);
      bins.push(new Bin(0, 0));
      tops.push(H);
      placements.set(it.id, { id: it.id, sheet: bins.length - 1, rot: 0, x: SHEET_MARGIN, y: SHEET_MARGIN });
      continue;
    }
    let done = false;
    for (let s = 0; s < bins.length && !done; s++) {
      const bin = bins[s]!;
      const a = bin.find(it.w, it.h, how);
      const b = turn || !(it.w <= W && it.h <= H) ? bin.find(it.h, it.w, how) : null;
      const pick = a && (!b || better(a.score, b.score)) ? { hit: a, rot: 0 as const } : b ? { hit: b, rot: 90 as const } : null;
      if (!pick) continue;
      bin.place(pick.hit.r);
      tops[s] = Math.max(tops[s]!, pick.hit.r.y + pick.hit.r.h);
      placements.set(it.id, { id: it.id, sheet: s, rot: pick.rot, x: SHEET_MARGIN + pick.hit.r.x, y: SHEET_MARGIN + pick.hit.r.y });
      done = true;
    }
    if (!done) {
      const bin = new Bin(W, H);
      bins.push(bin);
      const rot: 0 | 90 = it.w <= W && it.h <= H ? 0 : 90;
      const r = { x: 0, y: 0, w: rot ? it.h : it.w, h: rot ? it.w : it.h };
      bin.place(r);
      tops.push(r.h);
      placements.set(it.id, { id: it.id, sheet: bins.length - 1, rot, x: SHEET_MARGIN, y: SHEET_MARGIN });
    }
  }
  return { placements, sheets: Math.max(1, bins.length), tooBig, tops, turned: [...placements.values()].filter((p) => p.rot === 90).length };
}

/**
 * The pieces on as few sheets as will hold them. MaxRects, tried every way that matters — four
 * ways of scoring a free spot, five orders to place the pieces in, each piece both ways round —
 * and the packing with the fewest sheets kept; between those, the one whose last sheet is used
 * least, so the clear material is one piece. A box is ten pieces; twenty packings cost nothing.
 * (One scoring in one order put a 120 × 80 × 60 drawer on two 300 mm sheets, two pieces on the
 * second.)
 */
export function packSheets(pieces: { id: string; shapes: Shapes }[], sheet: SheetSize, opts: { upright?: boolean } = {}): { placements: Placement[]; sheets: number; tooBig: string[] } {
  // Every box is padded by the gap on its right and top, and the sheet by the same, so two
  // pieces are always a gap apart and the last one still clears the margin.
  const W = sheet.width - 2 * SHEET_MARGIN + PIECE_GAP;
  const H = sheet.height - 2 * SHEET_MARGIN + PIECE_GAP;
  // Sizes to a hundredth: a pattern's boolean moves an outline by 1e-9, and two walls that tie
  // must tie every time, or changing a pattern would reshuffle the sheet.
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const items: Item[] = pieces.map((p) => {
    const b = boxOf(p.shapes);
    return { id: p.id, w: r2(b.maxX - b.minX + PIECE_GAP), h: r2(b.maxY - b.minY + PIECE_GAP) };
  });
  const orders: ((a: Item, b: Item) => number)[] = [
    (a, b) => b.w * b.h - a.w * a.h || Math.max(b.w, b.h) - Math.max(a.w, a.h),
    (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
    (a, b) => b.w + b.h - (a.w + a.h) || b.w * b.h - a.w * a.h,
    (a, b) => b.h - a.h || b.w - a.w,
    (a, b) => b.w - a.w || b.h - a.h,
  ];
  // Plywood's face grain runs one way down the sheet: on a sheet as few pieces as possible are
  // turned, so the walls' grain runs the same way round the box (06 §3.7) — but never at the
  // cost of a sheet.
  let best: ReturnType<typeof packOnce> | null = null;
  const last = (x: ReturnType<typeof packOnce>) => x.tops[x.tops.length - 1] ?? 0;
  const better = (a: ReturnType<typeof packOnce>, b: ReturnType<typeof packOnce>) => {
    if (a.sheets !== b.sheets) return a.sheets < b.sheets;
    if (opts.upright && a.turned !== b.turned) return a.turned < b.turned;
    return last(a) < last(b) - 1e-6;
  };
  for (const order of orders) {
    const sorted = [...items].sort((a, b) => order(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const how of ['bssf', 'blsf', 'baf', 'bl'] as const) {
      for (const turn of opts.upright ? [false, true] : [true]) {
        const got = packOnce(sorted, W, H, how, turn);
        if (!best || better(got, best)) best = got;
      }
    }
  }
  return { placements: pieces.map((p) => best!.placements.get(p.id)!), sheets: best!.sheets, tooBig: best!.tooBig };
}

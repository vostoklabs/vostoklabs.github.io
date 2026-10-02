// Repeating one period across a box. A tiled pattern draws its cell once; this lays copies
// down over the box plus one cell of margin on every side, because a tile is allowed to draw
// past its own edges (a hexagon on the corner belongs to four cells).
import type { Box, Island, PatternDef, PatternGeometry, Params, Polyline } from './types';

/** More cells than this and something is wrong with the scale — refuse rather than hang. */
export const MAX_CELLS = 60000;

export interface Tiled {
  geo: PatternGeometry;
  cells: number;
  /** Set when the cell count blew the cap and nothing was drawn. */
  overflow: boolean;
}

export function tileGeometry(def: PatternDef, p: Params, box: Box, originAtCellCentre: boolean): Tiled {
  const cell = def.cell?.(p);
  const tile = def.tile?.(p);
  const empty: PatternGeometry = { holes: [], lines: [], slits: [] };
  if (!cell || !tile || !(cell.w > 1e-6) || !(cell.h > 1e-6)) return { geo: empty, cells: 0, overflow: false };
  const { w, h } = cell;
  // The cell (i, j) covers [i·w + ox, (i+1)·w + ox] × [j·h + oy, (j+1)·h + oy].
  const ox = originAtCellCentre ? -w / 2 : 0;
  const oy = originAtCellCentre ? -h / 2 : 0;
  const i0 = Math.floor((box.minX - ox) / w) - 1;
  const i1 = Math.ceil((box.maxX - ox) / w) + 1;
  const j0 = Math.floor((box.minY - oy) / h) - 1;
  const j1 = Math.ceil((box.maxY - oy) / h) + 1;
  const count = (i1 - i0 + 1) * (j1 - j0 + 1);
  if (count > MAX_CELLS) return { geo: empty, cells: count, overflow: true };
  const holes: Island[] = [];
  const lines: Polyline[] = [];
  const slits: Polyline[] = [];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const dx = i * w + ox;
      const dy = j * h + oy;
      for (const island of tile.holes) holes.push(island.map((r) => r.map(([x, y]) => [x + dx, y + dy])));
      for (const line of tile.lines) lines.push(line.map(([x, y]) => [x + dx, y + dy]));
      for (const line of tile.slits) slits.push(line.map(([x, y]) => [x + dx, y + dy]));
    }
  }
  return { geo: { holes, lines, slits }, cells: count, overflow: false };
}

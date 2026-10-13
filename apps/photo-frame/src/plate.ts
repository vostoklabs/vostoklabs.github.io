// The parts on the build plate: the shelf's shelf-packer, tried in every order and with each part
// turned or not, keeping the layout that takes the fewest plates. Three parts at most, so that is
// 48 tries of a trivial function. What this returns is exactly what the 3MF holds.
import { packShelf } from '@vostok/plates';
import type { MeshOut } from './geometry/build';

const MARGIN = 6;
const GAP = 3;

export interface PlateLayout {
  parts: MeshOut[];
  /** How many plates the parts need, laid out as well as they go. */
  plates: number;
  /** Parts too big for the plate whichever way they are turned: their slicer object and size. */
  tooBig: { group: string; w: number; d: number }[];
}

interface Group {
  name: string;
  parts: MeshOut[];
  x0: number;
  y0: number;
  w: number;
  d: number;
}

function groupsOf(parts: MeshOut[]): Group[] {
  const map = new Map<string, Group>();
  for (const p of parts) {
    let g = map.get(p.group);
    if (!g) {
      g = { name: p.group, parts: [], x0: Infinity, y0: Infinity, w: -Infinity, d: -Infinity };
      map.set(p.group, g);
    }
    g.parts.push(p);
  }
  for (const g of map.values()) {
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of g.parts) {
      const v = p.vertProperties;
      for (let i = 0; i < v.length; i += p.numProp) {
        g.x0 = Math.min(g.x0, v[i]!);
        g.y0 = Math.min(g.y0, v[i + 1]!);
        x1 = Math.max(x1, v[i]!);
        y1 = Math.max(y1, v[i + 1]!);
      }
    }
    g.w = x1 - g.x0;
    g.d = y1 - g.y0;
  }
  return [...map.values()];
}

function permutations<T>(list: T[]): T[][] {
  if (list.length <= 1) return [list];
  return list.flatMap((item, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [item, ...rest]));
}

export function layoutOnPlate(parts: MeshOut[], plate: [number, number]): PlateLayout {
  const groups = groupsOf(parts);
  const usable: [number, number] = [plate[0] - 2 * MARGIN, plate[1] - 2 * MARGIN];
  const fits = (w: number, d: number) => (w <= usable[0] && d <= usable[1]) || (w <= usable[1] && d <= usable[0]);
  const tooBig = groups.filter((g) => !fits(g.w, g.d)).map((g) => ({ group: g.name, w: g.w, d: g.d }));

  let best: { order: Group[]; turns: boolean[]; plates: number; area: number; at: { x: number; y: number }[] } | null = null;
  for (const order of permutations(groups)) {
    for (let mask = 0; mask < 1 << order.length; mask++) {
      const turns = order.map((_, i) => !!(mask & (1 << i)));
      const items = order.map((g, i) => (turns[i] ? { w: g.d, d: g.w } : { w: g.w, d: g.d }));
      const placed = packShelf(items, { plate, margin: MARGIN, gap: GAP });
      const plates = Math.max(...placed.map((p) => p.plate)) + 1;
      let x1 = -Infinity;
      let y0 = Infinity;
      placed.forEach((p, i) => {
        x1 = Math.max(x1, p.x + items[i]!.w);
        y0 = Math.min(y0, p.y);
      });
      const area = (x1 + usable[0] / 2) * (usable[1] / 2 - y0);
      if (!best || plates < best.plates || (plates === best.plates && area < best.area - 1e-6)) {
        best = { order, turns, plates, area, at: placed.map((p) => ({ x: p.x, y: p.y })) };
      }
    }
  }
  if (!best) return { parts, plates: 1, tooBig };

  // The packer fills from the back left; on one plate the set is centred, as the 3MF writer
  // centres it on the plate anyway, so the preview shows the plate the file will show.
  let sx = 0;
  let sy = 0;
  if (best.plates === 1) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    best.order.forEach((g, i) => {
      const w = best!.turns[i] ? g.d : g.w;
      const d = best!.turns[i] ? g.w : g.d;
      const at = best!.at[i]!;
      x0 = Math.min(x0, at.x); y0 = Math.min(y0, at.y);
      x1 = Math.max(x1, at.x + w); y1 = Math.max(y1, at.y + d);
    });
    sx = -(x0 + x1) / 2;
    sy = -(y0 + y1) / 2;
  }
  const out: MeshOut[] = [];
  best.order.forEach((g, i) => {
    const turn = best!.turns[i]!;
    const x = best!.at[i]!.x + sx;
    const y = best!.at[i]!.y + sy;
    for (const p of g.parts) {
      const v = new Float32Array(p.vertProperties);
      for (let k = 0; k < v.length; k += p.numProp) {
        const u = v[k]! - g.x0;
        const w = v[k + 1]! - g.y0;
        // A quarter turn counter-clockwise, then the part's corner to its place.
        v[k] = x + (turn ? g.d - w : u);
        v[k + 1] = y + (turn ? u : w);
      }
      out.push({ ...p, vertProperties: v });
    }
  });
  return { parts: out, plates: best.plates, tooBig };
}

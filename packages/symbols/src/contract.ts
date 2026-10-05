import { OUTLINE_BOX, signedArea, type Ring, type Shapes } from './outline';

/*
  The islands contract, as a check. Every symbol `symbolShapes` hands out keeps it, so a consumer
  can take each island on its own (fill the outer, cut its holes) and get exactly what the tile
  shows:

    - an outer ring winds anticlockwise (Y up) and each of its holes clockwise;
    - every ring encloses an area and is simple: it never crosses, runs along or touches itself;
    - no two rings cross or run along each other. Two may meet at one point, as the corners of a
      QR code's squares do;
    - a hole lies inside its own outer, and the holes of one island lie apart;
    - islands lie apart: none sits on another's material (one may sit in another's hole).

  Read on the stored grid (OUTLINE_BOX to the longest side), where every coordinate is a whole
  number and every test below is exact. Nothing at runtime needs it: the fetch script writes no
  outline that fails it, and the test holds every stored symbol to it.
*/

export type ContractRule = 'grid' | 'winding' | 'zero-area' | 'self-intersection' | 'crossing' | 'hole' | 'overlap';

export interface ContractProblem {
  rule: ContractRule;
  /** Where, in words: "island 2 hole 1 crosses island 2 outer". */
  at: string;
}

type Pt = [number, number];

const orient = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const within = (p: Pt, a: Pt, b: Pt) =>
  Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);

/** How two segments meet: through each other, along a stretch, at one point, or not at all. */
function meet(a: Pt, b: Pt, c: Pt, d: Pt): 'cross' | 'along' | 'point' | '' {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  if (o1 === 0 && o2 === 0) {
    const k = a[0] !== b[0] ? 0 : 1;
    const lo = Math.max(Math.min(a[k], b[k]), Math.min(c[k], d[k]));
    const hi = Math.min(Math.max(a[k], b[k]), Math.max(c[k], d[k]));
    return hi > lo ? 'along' : hi === lo ? 'point' : '';
  }
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 'cross';
  if ((o1 === 0 && within(c, a, b)) || (o2 === 0 && within(d, a, b)) || (o3 === 0 && within(a, c, d)) || (o4 === 0 && within(b, c, d))) return 'point';
  return '';
}

/** Even-odd; only ever asked of a point well clear of every edge. */
function inRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function distance(p: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t);
}

/** A point just inside `ring` (a hundredth of a grid unit in from the middle of one of its edges)
 *  and well clear of every edge of `rings`, so even-odd says truly which rings hold it. */
function probeOf(ring: Pt[], rings: Pt[][]): Pt | null {
  const step = signedArea(ring) > 0 ? 0.01 : -0.01;
  for (let n = 0; n < ring.length; n++) {
    const a = ring[n]!;
    const b = ring[(n + 1) % ring.length]!;
    const k = step / Math.hypot(b[0] - a[0], b[1] - a[1]);
    const p: Pt = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * k, (a[1] + b[1]) / 2 + (b[0] - a[0]) * k];
    if (rings.every((g) => g.every((c, m) => (g === ring && m === n) || distance(p, c, g[(m + 1) % g.length]!) > 0.02))) return p;
  }
  return null;
}

const toGrid = (r: Ring): Pt[] => r.map(([x, y]): Pt => [Math.round(x * OUTLINE_BOX), Math.round(y * OUTLINE_BOX)]);

interface Held {
  ring: Pt[];
  island: number;
  /** 0 for the outer, then the holes from 1. */
  k: number;
  area: number;
  name: string;
}

/** Everything in `shapes` (the symbol frame, longest side 1) that breaks the contract; empty
 *  when nothing does. */
export function contractProblems(shapes: Shapes): ContractProblem[] {
  const out: ContractProblem[] = [];
  const say = (rule: ContractRule, at: string) => {
    if (!out.some((p) => p.rule === rule && p.at === at)) out.push({ rule, at });
  };
  const rings: Held[] = [];
  shapes.forEach((island, i) => {
    if (!island.length) say('zero-area', `island ${i} has no rings`);
    island.forEach((r, k) => {
      const name = `island ${i} ${k ? `hole ${k}` : 'outer'}`;
      const ring = toGrid(r);
      if (ring.some(([x, y], n) => Math.abs(x - r[n]![0] * OUTLINE_BOX) > 1e-6 || Math.abs(y - r[n]![1] * OUTLINE_BOX) > 1e-6)) say('grid', `${name} is off the stored grid`);
      rings.push({ ring, island: i, k, area: signedArea(ring), name });
    });
  });
  if (!shapes.length) say('zero-area', 'no islands');
  if (out.length) return out;

  for (const { ring, k, area, name } of rings) {
    if (ring.length < 3 || area === 0) say('zero-area', `${name} encloses nothing`);
    else if (k === 0 ? area < 0 : area > 0) say('winding', `${name} winds ${area > 0 ? 'anticlockwise' : 'clockwise'}`);
    for (let n = 0; n < ring.length; n++) {
      const p = ring[n]!;
      const q = ring[(n + 1) % ring.length]!;
      const s = ring[(n + 2) % ring.length]!;
      if (p[0] === q[0] && p[1] === q[1]) say('self-intersection', `${name} repeats a point`);
      else if (ring.length > 2 && orient(p, q, s) === 0 && (q[0] - p[0]) * (s[0] - q[0]) + (q[1] - p[1]) * (s[1] - q[1]) < 0) {
        say('self-intersection', `${name} folds back on itself`);
      }
    }
  }

  // Every two edges of the symbol that come near each other, swept along x.
  const edges = rings.flatMap((h, ri) =>
    h.ring.map((p, n) => {
      const q = h.ring[(n + 1) % h.ring.length]!;
      return { ri, n, p, q, x0: Math.min(p[0], q[0]), x1: Math.max(p[0], q[0]), y0: Math.min(p[1], q[1]), y1: Math.max(p[1], q[1]) };
    }),
  );
  edges.sort((e, f) => e.x0 - f.x0);
  let active: typeof edges = [];
  for (const e of edges) {
    active = active.filter((f) => f.x1 >= e.x0);
    for (const f of active) {
      if (f.y0 > e.y1 || e.y0 > f.y1) continue;
      const len = rings[e.ri]!.ring.length;
      if (e.ri === f.ri && ((e.n + 1) % len === f.n || (f.n + 1) % len === e.n)) continue;
      const how = meet(e.p, e.q, f.p, f.q);
      if (!how) continue;
      const a = rings[e.ri]!;
      const b = rings[f.ri]!;
      if (e.ri === f.ri) say('self-intersection', `${a.name} ${how === 'cross' ? 'crosses' : how === 'along' ? 'runs along' : 'touches'} itself`);
      else if (how !== 'point') say('crossing', `${a.name} ${how === 'cross' ? 'crosses' : 'runs along'} ${b.name}`);
    }
    active.push(e);
  }
  if (out.length) return out;

  // No two edges cross, so one point inside a ring tells where all of it lies.
  const all = rings.map((h) => h.ring);
  const probes = new Map<Held, Pt>();
  const islands = new Map<number, Held[]>();
  for (const h of rings) {
    const p = probeOf(h.ring, all);
    if (p) probes.set(h, p);
    else say('hole', `${h.name} has no point clear of the other rings`);
    islands.set(h.island, [...(islands.get(h.island) ?? []), h]);
  }
  if (out.length) return out;
  for (const [, [outer, ...holes]] of islands) {
    for (const h of holes) {
      if (!inRing(probes.get(h)!, outer!.ring)) say('hole', `${h.name} is not inside its outer`);
      for (const g of holes) if (g !== h && inRing(probes.get(h)!, g.ring)) say('hole', `${h.name} lies in ${g.name}`);
    }
  }
  for (const [i, [outer, ...holes]] of islands) {
    for (const [j, [other]] of islands) {
      if (i === j) continue;
      const p = probes.get(other!)!;
      if (inRing(p, outer!.ring) && !holes.some((h) => inRing(p, h.ring))) say('overlap', `island ${j} lies on island ${i}`);
    }
  }
  return out;
}

/**
 * Rings the way manifold winds them, gathered into islands: each anticlockwise ring an outer,
 * each clockwise one a hole of the smallest outer around it. Meant for rings (in the symbol
 * frame) that neither cross nor run along each other, as manifold hands them back. A ring that
 * encloses nothing is left out, and so is a clockwise ring no outer holds: filled by the rule
 * manifold winds for, where outers count and holes cut, it is no material at all.
 */
export function islandsOfRings(rings: Ring[]): Shapes {
  const grid = rings.map((r) => r.map(([x, y]): Pt => [x * OUTLINE_BOX, y * OUTLINE_BOX]));
  const outers = grid
    .map((ring, i) => ({ ring, i, area: signedArea(ring), holes: [] as number[] }))
    .filter((o) => o.area > 0)
    .sort((a, b) => a.area - b.area);
  grid.forEach((ring, i) => {
    const area = signedArea(ring);
    if (area >= 0) return;
    const p = probeOf(ring, grid);
    const owner = p ? outers.find((o) => o.area > -area && inRing(p, o.ring)) : undefined;
    owner?.holes.push(i);
  });
  return outers.sort((a, b) => b.area - a.area).map((o) => [rings[o.i]!, ...o.holes.map((h) => rings[h]!)]);
}

// A jigsaw blank's seams (2026-09-27): an outline — a rectangle, a square, a circle or
// a heart — cut into a grid of classic round-knob pieces. Pure and main-thread: what comes out is
// the outline ring and the seams as OPEN polylines, one per run of a grid line, which a cut layer
// hands to the engine to clip to the plate and burn once each (build.ts).
//
// Why lines and not pieces. Two neighbouring pieces share their edge. Drawn as closed outlines
// that edge is cut twice, on top of itself: the second pass scorches the wood and widens the kerf,
// and a puzzle's whole feel is the fit. So every shared edge is one line, and the laser crosses it
// once.
//
// The construction.
//  1. A grid of `cols` × `rows` cells: a rectangle's own box cut into the factor pair of the
//     count with the squarest cells; a circle or a heart square cells centred on it, at the pitch
//     and phase whose real count (step 2) lands nearest the one asked for. With irregularity on,
//     every inner vertex strays up to 7 % of a cell (a rectangle's border vertices slide along
//     the border only), so the rows do not read as ruled.
//  2. Each cell keeps what of the outline falls in it (a Sutherland–Hodgman clip against its
//     quad). On a circle or a heart the boundary cells are partial: one under 35 % of a full cell
//     is merged into the whole neighbour it shares the longest edge with, repeatedly, and the
//     edge between them is dropped. The heart always gets an EVEN number of columns with the
//     centre line held on x = 0, because each half of the heart is convex — so every cell's share
//     of it is one connected region, and no "piece" is secretly two lobes' tops — and nothing is
//     merged across that line while there is anywhere else to go, so it runs down to the tip.
//  3. Every surviving edge between two different pieces gets a knob at its middle: a round head
//     on a waisted neck (two cubics a side and a half circle on top), its head `knob` of the edge
//     wide. Its direction is a coin toss per edge (seeded, so Shuffle deals a new set and the same
//     number always deals the same one) — except that a piece under 60 % of a cell always grows
//     its knobs outward, so a small boundary piece gains wood rather than losing it.
//  4. A knob must stand ≥ 2 mm clear of the outline and ≥ 2 mm clear of every other seam (1.5 mm
//     of wood once the kerf has had its share, §2.5). One that does not is tried the other way
//     round, slid along its edge, then smaller down to the floor; failing all of those, a knob
//     round it that it meets is moved instead. Only a stub at a circle's or a heart's rim is ever
//     cut straight: one too short for a knob ¾ the size of the rest, since a pimple beside full
//     heads reads as a glitch. Every edge between two whole cells has a knob.
//  5. The surviving edges are chained along their grid lines, so a 4 × 6 puzzle is eight runs,
//     not thirty-eight: every run is a pierce, and the head lifts between them.
//
// The numbers. Cells never under `MIN_CELL` = 16 mm. The head is `knob` × √(cell area) across
// (25 % by default: 7.7 mm on a 5 × 7 in, 24-piece puzzle), overhangs its neck by 0.38 of its
// radius a side — that overhang is the lock — and stands 2.35 head-radii proud of its edge (9 mm,
// 29 % of the edge, at the default). The neck is 1.24 head-radii across and never under
// `NECK_MIN` = 3 mm (§2.1's tab width, 1× the stock): on the smallest cells the Knob size slider's
// low end asks for less, and gets the floor — a 16 mm cell at 18 % would be a 1.8 mm neck.
import { circleRing, heartRing, roundedRectRing, type Pt } from '@vostok/laser';
import { pointInRing } from '@vostok/shapes';

type Ring = Pt[];

export type JigsawOutline = 'rect' | 'square' | 'circle' | 'heart';

export interface JigsawSpec {
  outline: JigsawOutline;
  /** The outline's box, mm. A circle uses `width`; a heart is `width` × `height`. */
  width: number;
  height: number;
  /** Corner radius, mm — rectangles and squares only. */
  corner: number;
  /** How many pieces the customer asked for. */
  pieces: number;
  /** The knob head's width as a share of the piece's edge (the slider's 0.18–0.32). */
  knob: number;
  /** 0..1: how far the pieces stray from a perfect grid. */
  wobble: number;
  /** The Shuffle number. */
  seed: number;
}

export interface JigsawPlan {
  /** The outline, centred on the origin, CCW. */
  outline: Ring;
  cols: number;
  rows: number;
  /** The pieces the plan makes: grid cells less the ones merged into a neighbour. */
  pieces: number;
  /** How many cells were folded into a neighbour (a circle's or a heart's slivers). */
  merged: number;
  /** The seams, one open polyline per run of a grid line. Not yet clipped to the outline. */
  paths: Pt[][];
  /** The nominal cell, mm. */
  cell: { w: number; h: number };
  /** False when the asked count needs cells under `MIN_CELL` — `pieces` is then the most that fit. */
  fits: boolean;
}

/** The smallest cell side the grid may use, mm. */
export const MIN_CELL = 16;
/** A piece under this share of a full cell is merged into a neighbour. */
export const MERGE_SHARE = 0.35;
/** A knob keeps at least this much wood between itself and the outline, mm. */
export const KNOB_CLEAR = 2;
/** And at least this much between itself and any other seam, mm: §2.5's 1.5 mm floor for a web
 *  that carries anything, measured AFTER a 0.18 mm kerf has taken its half from either side. */
export const SEAM_GAP = 2;
/** A piece under this share of a cell grows its knobs outward. */
const SMALL_SIDE = 0.6;
/** A knob's shoulder stays this far from either end of its edge, mm. */
const END_CLEAR = 3;
/** How far an inner vertex may stray, as a share of the cell, at full irregularity. */
const JITTER = 0.07;
/** How far the outer grid vertices sit past the outline's box, mm — so every seam that runs to
 *  the edge crosses it and the engine's clip ends it exactly on the outline. */
const OVER = 1;
/** A heart's row line that would pass under its cleft closer than this, mm, is lifted to cross the
 *  notch `CLEFT_LIFT` above the cleft instead: a seam 0.4–1.8 mm under the notch, tied to it by a
 *  stub of the centre line, reads as a cut that just missed (review 2, 2026-09-27). */
const CLEFT_CLEAR = 3;
const CLEFT_LIFT = 0.5;

// ------------------------------------------------------------------------ primitives --

/** A small deterministic generator per (seed, keys): the same edge always deals the same knob,
 *  whatever else changed. FNV-1a over the keys, then mulberry32. */
function rng(seed: number, ...keys: number[]): () => number {
  let h = (2166136261 ^ Math.imul(seed | 0, 2654435761)) >>> 0;
  for (const k of keys) h = Math.imul(h ^ (k | 0), 16777619) >>> 0;
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** −1..1 from a generator. */
const sym = (r: () => number) => r() * 2 - 1;

function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % r.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 1e-18 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Distance from `p` to an open polyline (`closed` adds the closing step). */
function lineDist(p: Pt, line: Pt[], closed = false): number {
  let d = Infinity;
  const n = line.length;
  for (let i = 0; i + 1 < n + (closed ? 1 : 0); i++) d = Math.min(d, segDist(p, line[i]!, line[(i + 1) % n]!));
  return d;
}

/**
 * The outline clipped to a CONVEX quad (Sutherland–Hodgman), for its area only. The outline may
 * be concave — the clip then leaves zero-width runs along the quad's sides, which add no area.
 */
function clipToQuad(subject: Ring, quad: Ring): Ring {
  let out = subject;
  const ccw = ringArea(quad) > 0;
  for (let i = 0; i < quad.length && out.length; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % quad.length]!;
    const side = (p: Pt) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * (ccw ? 1 : -1);
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const p = input[k]!;
      const q = input[(k + 1) % input.length]!;
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  return out;
}

/** The stretches of the segment a→b inside the ring, as [t0, t1] along it. */
function insideRuns(a: Pt, b: Pt, ring: Ring): [number, number][] {
  const ts = [0, 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  for (let i = 0; i < ring.length; i++) {
    const c = ring[i]!;
    const d = ring[(i + 1) % ring.length]!;
    const ex = d[0] - c[0];
    const ey = d[1] - c[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
    const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const runs: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if (t1 - t0 < 1e-9) continue;
    const m = (t0 + t1) / 2;
    if (!pointInRing([a[0] + m * dx, a[1] + m * dy], ring)) continue;
    const last = runs[runs.length - 1];
    if (last && Math.abs(last[1] - t0) < 1e-9) last[1] = t1;
    else runs.push([t0, t1]);
  }
  return runs;
}

// ------------------------------------------------------------------------ the outline --

/** A heart's height for its width: the library heart's own proportion (44 × 40). */
export const HEART_RATIO = 40 / 44;

/** The outline ring, centred on the origin, CCW. */
export function jigsawOutline(kind: JigsawOutline, width: number, height: number, corner: number): Ring {
  if (kind === 'circle') return circleRing(0, 0, width / 2, 180);
  if (kind === 'heart') return heartRing(width, height, 72);
  return roundedRectRing(width, height, Math.max(0, corner), 12);
}

// ---------------------------------------------------------------------- the grid --

interface GridEdge {
  /** Horizontal (between a cell and the one above it) or vertical (between left and right). */
  dir: 'h' | 'v';
  /** The grid line it lies on and its place along it. */
  line: number;
  at: number;
  a: Pt;
  b: Pt;
  len: number;
  /** [the cell on the right of a→b, the cell on its left]: a knob that grows to the LEFT of
   *  a→b grows into `cells[1]`. A horizontal edge runs +x (left = above); a vertical one runs +y
   *  (left = the cell to the left). */
  cells: [number, number];
  /** The stretches of a→b inside the outline, as [t0, t1]; and their total length, mm. */
  runs: [number, number][];
  inLen: number;
  /** On the heart's centre line: the seam that splits it into its halves, which a sliver is only
   *  merged across when it has nowhere else to go — so the line always runs down to the tip. */
  spine: boolean;
}

interface Layout {
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  /** The outline's share of each cell, mm², by `j * cols + i`. */
  area: number[];
  /** Horizontal edges by [line j − 1][i], vertical by [line i − 1][j]. */
  h: GridEdge[][];
  v: GridEdge[][];
}

/** A grid: `cols` × `rows` cells of `cw` × `ch`, centred on the origin. A rectangle's grid is its
 *  own box; a circle's or a heart's is square cells and may run past the shape. */
interface Grid {
  cols: number;
  rows: number;
  cw: number;
  ch: number;
}

function layout(outline: Ring, kind: JigsawOutline, grid: Grid, wobble: number, seed: number): Layout {
  const { cols, rows, cw, ch } = grid;
  // The heart's cleft: the higher of the two outline points on its centre line (the other is the tip).
  const cleft = kind === 'heart' ? Math.max(...outline.filter((p) => Math.abs(p[0]) < 1e-9).map((p) => p[1])) : Infinity;
  const V: Pt[][] = [];
  for (let i = 0; i <= cols; i++) {
    const column: Pt[] = [];
    for (let j = 0; j <= rows; j++) {
      const r = rng(seed, 1, i, j);
      const jx = wobble * JITTER * cw * sym(r);
      const jy = wobble * JITTER * ch * sym(r);
      let x = (i - cols / 2) * cw;
      let y = (j - rows / 2) * ch;
      // A border vertex slides ALONG its border only, so a rectangle's edge stays straight; the
      // heart's centre line stays on x = 0, where it splits the heart into its two convex halves.
      if (i > 0 && i < cols && !(kind === 'heart' && 2 * i === cols)) x += jx;
      if (j > 0 && j < rows) y += jy;
      // On the centre line, a row just under the cleft goes through the notch instead, where the
      // lobes part: the row's two halves then end in the notch and the centre line at the cleft.
      if (2 * i === cols && j > 0 && j < rows && y < cleft && y > cleft - CLEFT_CLEAR) y = cleft + CLEFT_LIFT;
      if (i === 0) x -= OVER;
      if (i === cols) x += OVER;
      if (j === 0) y -= OVER;
      if (j === rows) y += OVER;
      column.push([x, y]);
    }
    V.push(column);
  }
  const at = (i: number, j: number) => V[i]![j]!;
  const area: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      area.push(Math.abs(ringArea(clipToQuad(outline, [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]))));
    }
  }
  const edge = (dir: 'h' | 'v', line: number, pos: number, a: Pt, b: Pt, cells: [number, number]): GridEdge => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const runs = insideRuns(a, b, outline);
    const spine = kind === 'heart' && dir === 'v' && 2 * line === cols;
    return { dir, line, at: pos, a, b, len, cells, runs, inLen: runs.reduce((s, [t0, t1]) => s + (t1 - t0) * len, 0), spine };
  };
  const h: GridEdge[][] = [];
  for (let j = 1; j < rows; j++) {
    const row: GridEdge[] = [];
    for (let i = 0; i < cols; i++) row.push(edge('h', j, i, at(i, j), at(i + 1, j), [(j - 1) * cols + i, j * cols + i]));
    h.push(row);
  }
  const v: GridEdge[][] = [];
  for (let i = 1; i < cols; i++) {
    const col: GridEdge[] = [];
    for (let j = 0; j < rows; j++) col.push(edge('v', i, j, at(i, j), at(i, j + 1), [j * cols + i, j * cols + i - 1]));
    v.push(col);
  }
  return { cols, rows, cw, ch, area, h, v };
}

/** A cell with any of the outline in it — anything at all is wood some piece has to own. */
const LIVE = 1e-6;

interface Merged {
  /** Each cell's piece, as the index of the cell at its root. */
  root: (cell: number) => number;
  /** A piece's area, by its root. */
  area: Map<number, number>;
  pieces: number;
  merged: number;
}

/**
 * Fold every piece under `MERGE_SHARE` of a full cell into the neighbour it shares the most
 * INSIDE edge with (ties to the smaller neighbour), smallest first, until none is left under it
 * or the one left has nowhere to go. Only a shared stretch INSIDE the outline counts: two cells
 * whose common side lies outside the shape (the heart's two lobes above the cleft) are not
 * neighbours, so a piece is never two separate bits of wood.
 */
function merge(lay: Layout): Merged {
  const n = lay.cols * lay.rows;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; }
    return x;
  };
  const area = new Map<number, number>();
  for (let c = 0; c < n; c++) if (lay.area[c]! > LIVE) area.set(c, lay.area[c]!);
  const full = lay.cw * lay.ch;
  const edges = [...lay.h.flat(), ...lay.v.flat()].filter((e) => e.inLen > 1e-6 && area.has(e.cells[0]) && area.has(e.cells[1]));
  let merged = 0;
  const stuck = new Set<number>();
  for (;;) {
    let g = -1;
    for (const [root, a] of area) if (a < MERGE_SHARE * full && !stuck.has(root) && (g < 0 || a < area.get(g)!)) g = root;
    if (g < 0) break;
    const neighbours = (spine: boolean) => {
      const shared = new Map<number, number>();
      for (const e of edges) {
        if (e.spine && !spine) continue;
        const p = find(e.cells[0]);
        const q = find(e.cells[1]);
        if (p === q || (p !== g && q !== g)) continue;
        const other = p === g ? q : p;
        shared.set(other, (shared.get(other) ?? 0) + e.inLen);
      }
      return shared;
    };
    let shared = neighbours(false);
    if (!shared.size) shared = neighbours(true);
    // A whole piece before another sliver: two slivers merged sideways first (the heart's tip is
    // two of them, split by the centre line) become one piece that can only join ONE of the cells
    // above it, and the seam left to the other is a stub cut straight across the tip.
    let to = -1;
    for (const [h, len] of shared) {
      if (to < 0) { to = h; continue; }
      const big = area.get(h)! >= MERGE_SHARE * full;
      const bigTo = area.get(to)! >= MERGE_SHARE * full;
      const best = shared.get(to)!;
      if (big !== bigTo ? big : len > best + 1e-6 || (Math.abs(len - best) <= 1e-6 && area.get(h)! < area.get(to)!)) to = h;
    }
    if (to < 0) { stuck.add(g); continue; }
    parent[g] = to;
    area.set(to, area.get(to)! + area.get(g)!);
    area.delete(g);
    merged++;
  }
  return { root: find, area, pieces: area.size, merged };
}

// ------------------------------------------------------------------------ the knob --

interface Knob {
  /** Centre along the edge, 0..1. */
  t: number;
  /** Head radius, mm. */
  R: number;
  /** Head centre above the edge, in head radii. */
  lift: number;
  /** The head's lean along the edge, in head radii. */
  skew: number;
  /** +1 grows to the LEFT of a→b (into `cells[1]`), −1 to the right. */
  side: 1 | -1;
}

/** Neck half-width, shoulder half-width and the neck's narrowest height, in head radii: the head
 *  overhangs its neck by 0.38 R a side, which is the lock. */
const NECK = 0.62;
const SHOULDER = 1.15;
const NECK_Y = 0.5;
/** Head centre height at the nominal lift, in head radii — the knob stands LIFT + 1 proud. */
const LIFT = 1.35;
/** The thinnest neck a knob is cut with, mm: §2.1's tab width, 1× the 3 mm stock — 2.8 mm of wood
 *  once a 0.18 mm kerf has had its share. The neck is what carries the lock, and it is the first
 *  thing to snap. */
export const NECK_MIN = 3;
/** So the smallest head, radius mm (2.42). Every knob is at least this big, whatever the Knob size
 *  slider asks: on small cells the slider's low end is simply the floor. */
export const R_MIN = NECK_MIN / (2 * NECK);
/** A stub (an edge the outline cuts short, at a circle's or a heart's rim) carries a knob at least
 *  this share of the design's, or none. The neck floor alone let a rim stub take a 5 mm head
 *  beside 20 mm ones, and a pimple that size reads as a glitch, not a knob (review 2, 2026-09-27). */
export const STUB_SHARE = 0.75;
const SEG = 8;
const ARC = 18;

function cubic(out: Pt[], p0: Pt, p1: Pt, p2: Pt, p3: Pt): void {
  for (let s = 1; s <= SEG; s++) {
    const t = s / SEG;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
}

/** The knob in its edge's own frame — x along the edge from `a`, y across it towards the side it
 *  grows into — shoulder to shoulder: a fillet off the edge into the neck, the neck flaring out
 *  to the head's widest point, a half circle over the top, and the same back down. Every join is
 *  tangent, so the cut never stops and turns. */
function knobLocal(k: Knob, L: number): Pt[] {
  const c = k.t * L;
  const R = k.R;
  const n = NECK * R;
  const wb = SHOULDER * R;
  const yn = NECK_Y * R;
  const hc = k.lift * R;
  const hx = c + k.skew * R;
  const f = 0.55 * (wb - n);
  const d = 0.5 * (hc - yn);
  const out: Pt[] = [[c - wb, 0]];
  cubic(out, [c - wb, 0], [c - wb + f, 0], [c - n, 0.45 * yn], [c - n, yn]);
  cubic(out, [c - n, yn], [c - n, yn + d], [hx - R, hc - d], [hx - R, hc]);
  for (let s = 1; s <= ARC; s++) {
    const a = Math.PI - (Math.PI * s) / ARC;
    out.push([hx + R * Math.cos(a), hc + R * Math.sin(a)]);
  }
  cubic(out, [hx + R, hc], [hx + R, hc - d], [c + n, yn + d], [c + n, yn]);
  cubic(out, [c + n, yn], [c + n, 0.45 * yn], [c + wb - f, 0], [c + wb, 0]);
  return out;
}

interface Built {
  e: GridEdge;
  knob: Knob | null;
  /** The smallest head this edge may carry, mm: `R_MIN`, or a stub's `STUB_SHARE` of the design. */
  floor: number;
  /** A gentle bow of the whole edge, mm at its middle — irregularity on an inner edge only. */
  bow: number;
  poly: Pt[];
  /** The knob's own points, for the clearance checks. */
  bump: Pt[];
  box: { minX: number; minY: number; maxX: number; maxY: number };
}

function draw(e: GridEdge, knob: Knob | null, bow: number): Pick<Built, 'poly' | 'bump' | 'box'> {
  const L = e.len;
  const ux = (e.b[0] - e.a[0]) / L;
  const uy = (e.b[1] - e.a[1]) / L;
  const world = (x: number, y: number): Pt => {
    const yy = y + bow * Math.sin((Math.PI * x) / L);
    return [e.a[0] + ux * x - uy * yy, e.a[1] + uy * x + ux * yy];
  };
  // A straight run needs no points in between; a bowed one is walked every 3 mm.
  const flat = (x0: number, x1: number, out: Pt[]) => {
    const steps = bow ? Math.max(1, Math.ceil((x1 - x0) / 3)) : 1;
    for (let s = 1; s <= steps; s++) out.push(world(x0 + ((x1 - x0) * s) / steps, 0));
  };
  const poly: Pt[] = [world(0, 0)];
  let bump: Pt[] = [];
  if (!knob) flat(0, L, poly);
  else {
    const local = knobLocal(knob, L);
    bump = local.map(([x, y]) => world(x, y * knob.side));
    flat(0, local[0]![0], poly);
    poly.push(...bump.slice(1));
    flat(local[local.length - 1]![0], L, poly);
  }
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of poly) {
    box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y); box.maxY = Math.max(box.maxY, y);
  }
  return { poly, bump, box };
}

/** Does this knob stand clear of the outline and of every other seam? */
function clear(bump: Pt[], self: Built, all: Built[], outline: Ring): boolean {
  const near = all.filter((o) => o !== self);
  for (const p of bump) {
    if (!pointInRing(p, outline) || lineDist(p, outline, true) < KNOB_CLEAR) return false;
    for (const o of near) {
      const b = o.box;
      if (p[0] < b.minX - SEAM_GAP || p[0] > b.maxX + SEAM_GAP || p[1] < b.minY - SEAM_GAP || p[1] > b.maxY + SEAM_GAP) continue;
      if (lineDist(p, o.poly) < SEAM_GAP) return false;
    }
  }
  return true;
}

/** The longest stretch of an edge inside the outline, as [t0, t1]. */
function longest(e: GridEdge): [number, number] {
  return e.runs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
}

/** How far a knob that meets something is slid along its edge, as a share of the edge. */
const SLIDE = 0.12;

/**
 * A knob, then what to try in its place when it does not stand clear, in the order of how little
 * each changes: the other way round; slid along its edge either way — two knobs grown into one
 * small cell from neighbouring sides meet at the corner between them, and a slide parts them —
 * then smaller, down to the edge's floor. Every one keeps its shoulders END_CLEAR inside its stretch.
 */
function alternatives(e: GridEdge, k: Knob, floor: number): Knob[] {
  const run = longest(e);
  const out: Knob[] = [k];
  const flip = -k.side as 1 | -1;
  for (const R of [k.R, Math.max(0.8 * k.R, floor), floor]) {
    const margin = (END_CLEAR + SHOULDER * R) / e.len;
    const lo = run[0] + margin;
    const hi = run[1] - margin;
    for (const t of [k.t, k.t + SLIDE, k.t - SLIDE].map((x) => Math.min(hi, Math.max(lo, x)))) {
      for (const side of [k.side, flip]) {
        if (!out.some((o) => o.R === R && Math.abs(o.t - t) < 1e-6 && o.side === side)) out.push({ ...k, R, t, side });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------------ the seams --

/** Every edge between two different pieces, with its knob dealt, fitted and checked. */
function buildEdges(lay: Layout, m: Merged, spec: JigsawSpec, outline: Ring): Built[] {
  const full = lay.cw * lay.ch;
  // The head the slider asks for — but never one that irregularity's ±10 % could take under the
  // floor: a small cell at a low Knob size is cut with the smallest knob that holds, not with none.
  const R0 = Math.max((spec.knob * Math.sqrt(full)) / 2, R_MIN / (1 - 0.1 * spec.wobble));
  const stubMin = Math.max(R_MIN, STUB_SHARE * R0);
  const round = spec.outline === 'circle' || spec.outline === 'heart';
  const cut =[...lay.h.flat(), ...lay.v.flat()].filter((e) => {
    if (e.inLen <= 1e-6 || lay.area[e.cells[0]]! <= LIVE || lay.area[e.cells[1]]! <= LIVE) return false;
    return m.root(e.cells[0]) !== m.root(e.cells[1]);
  });
  const built: Built[] = cut.map((e) => {
    const r = rng(spec.seed, e.dir === 'h' ? 2 : 3, e.line, e.at);
    const R = R0 * (1 + spec.wobble * 0.1 * sym(r));
    const lift = LIFT * (1 + spec.wobble * 0.08 * sym(r));
    const skew = spec.wobble * 0.12 * sym(r);
    const jitter = sym(r);
    let side: 1 | -1 = r() < 0.5 ? 1 : -1;
    const bowing = sym(r);
    const run = longest(e);
    const whole = e.runs.length === 1 && run[0] < 1e-9 && run[1] > 1 - 1e-9;
    const t = whole ? 0.5 + spec.wobble * 0.05 * jitter : (run[0] + run[1]) / 2;
    // A small piece grows its knobs outward: it gains wood instead of losing a knob's worth.
    const a0 = m.area.get(m.root(e.cells[0]))!;
    const a1 = m.area.get(m.root(e.cells[1]))!;
    if (Math.min(a0, a1) < SMALL_SIDE * full && Math.abs(a0 - a1) > 1e-6) side = a1 > a0 ? 1 : -1;
    // Only an edge wholly inside bows, and never the heart's centre line (it must stay on x = 0).
    const centre = spec.outline === 'heart' && e.dir === 'v' && 2 * e.line === lay.cols;
    const bow = whole && !centre ? spec.wobble * 0.02 * e.len * bowing : 0;
    // The shoulders fit inside the stretch of edge that is inside, END_CLEAR from either end. A
    // stretch too short for its floor is cut straight: a whole edge's floor is the smallest knob
    // that holds, so only a stub is ever straight. A rectangle has no stubs — its border edges run
    // OVER past its box and no further, whole cell sides, and a corner piece has no others.
    const floor = round && !whole ? stubMin : R_MIN;
    const room = Math.min(t - run[0], run[1] - t) * e.len - END_CLEAR;
    const fitR = Math.min(R, room / SHOULDER);
    const knob: Knob | null = fitR >= floor ? { t, R: fitR, lift, skew, side } : null;
    return { e, knob, floor, bow, ...draw(e, knob, bow) };
  });
  // The clearances, one edge at a time against the others as they stand. Each change is checked
  // against everything current, so one pass leaves every pair checked in its final state.
  const set = (x: Built, k: Knob | null) => Object.assign(x, { knob: k, ...draw(x.e, k, x.bow) });
  const fits = (x: Built) => clear(x.bump, x, built, outline);
  const near = (p: Built, q: Built) => p.box.minX - SEAM_GAP < q.box.maxX && q.box.minX - SEAM_GAP < p.box.maxX
    && p.box.minY - SEAM_GAP < q.box.maxY && q.box.minY - SEAM_GAP < p.box.maxY;
  // When nothing fits beside the knobs round it as they stand — on the smallest cells both pieces
  // either side can already be full of knobs from their other sides — one of THOSE knobs is moved
  // to one of its own alternatives instead, if that lets both stand clear.
  const relieve = (b: Built): boolean => {
    for (const o of built) {
      if (o === b || !o.knob || !near(o, b)) continue;
      const was = o.knob;
      for (const t of alternatives(o.e, was, o.floor).slice(1)) {
        set(o, t);
        if (fits(o) && fits(b)) return true;
      }
      set(o, was);
    }
    return false;
  };
  for (const b of built) {
    const k = b.knob;
    if (!k) continue;
    const alts = alternatives(b.e, k, b.floor);
    if (alts.some((t) => fits(set(b, t)))) continue;
    // Only the full-size ones for the harder search: a smaller knob is the easier thing to give.
    if (alts.filter((t) => t.R === k.R).some((t) => (set(b, t), relieve(b)))) continue;
    // Cut straight only when neither this knob nor any knob round it can move.
    set(b, null);
  }
  return built;
}

/** The edges chained along their grid lines: one run per unbroken stretch of cut edges. */
function chain(lay: Layout, built: Built[]): Pt[][] {
  const of = new Map<GridEdge, Built>(built.map((b) => [b.e, b]));
  const paths: Pt[][] = [];
  for (const line of [...lay.h, ...lay.v]) {
    let run: Pt[] | null = null;
    for (const e of line) {
      const b = of.get(e);
      if (!b) {
        if (run) paths.push(run);
        run = null;
      } else if (run) run.push(...b.poly.slice(1));
      else run = [...b.poly];
    }
    if (run) paths.push(run);
  }
  return paths;
}

// ------------------------------------------------------------------------- the grid --

interface GridPick extends Grid {
  count: number;
  score: number;
}

/**
 * A rectangle's grid: the factor pair of the count with the squarest cells, over the rectangle's
 * own box. An exact count beats squarer cells until the cells run past about 1 : 2 (a 36 on a
 * 5 × 7 is 6 × 6 at 21 × 30 mm, not 5 × 7 at 35). A single row is allowed: a long custom strip
 * asked for 4 is four pieces side by side, not ten because no two-row grid had square enough cells.
 */
function rectGrid(N: number, W: number, H: number, minCell: number): GridPick | null {
  let best: GridPick | null = null;
  for (let cols = 1; cols <= 16; cols++) {
    for (let rows = cols === 1 ? 2 : 1; rows <= 16; rows++) {
      const cw = W / cols;
      const ch = H / rows;
      const skew = Math.abs(Math.log(cw / ch));
      if (Math.min(cw, ch) < minCell || skew > Math.log(2.2)) continue;
      const count = cols * rows;
      const score = Math.abs(count - N) + 1.5 * skew;
      if (!best || score < best.score - 1e-9) best = { cols, rows, cw, ch, count, score };
    }
  }
  return best;
}

/** Pitches tried across the band of square cells worth laying out. */
const PITCHES = 16;

/**
 * A circle's or a heart's grid: SQUARE cells, centred on the shape, running past it. The shape
 * takes the corners and the merge takes the slivers, so the count is not cols × rows: every pitch
 * in the band that could land near N (the shape's area over 1.5 N to 0.7 N cells) is laid out in
 * both phases (a line through the centre, or a cell on it) and merged, and the REAL count nearest
 * N wins — then the evenest pieces, then the fewest merges. A heart is only ever the
 * line-through-the-centre phase across (its halves). Laid out against a coarse copy of the
 * outline: the count cannot tell 72 points from 180, and the search runs on every keystroke.
 */
function roundGrid(spec: JigsawSpec, N: number, W: number, H: number, minCell: number): GridPick | null {
  const coarse = spec.outline === 'heart' ? heartRing(W, H, 20) : circleRing(0, 0, W / 2, 72);
  const A = Math.abs(ringArea(coarse));
  const lo = Math.max(minCell, Math.sqrt(A / (1.5 * N)));
  // When the smallest cell is what binds, the band is the few pitches just over it: the most
  // pieces this size can hold.
  const hi = Math.max(Math.sqrt(A / (0.7 * N)), 1.25 * lo);
  let best: GridPick | null = null;
  for (let k = 0; k <= PITCHES && lo <= hi; k++) {
    const s = lo * Math.pow(hi / lo, k / PITCHES);
    const c0 = Math.ceil(W / s - 1e-9);
    const r0 = Math.ceil(H / s - 1e-9);
    for (const cols of [c0, c0 + 1]) {
      if (spec.outline === 'heart' && cols % 2) continue;
      for (const rows of [r0, r0 + 1]) {
        if (cols < 2 || rows < 2 || cols > 18 || rows > 18) continue;
        const m = merge(layout(coarse, spec.outline, { cols, rows, cw: s, ch: s }, spec.wobble, spec.seed));
        // Then the evenest: a sliver merged into a cell makes it bigger, and a grid whose rim
        // pieces come out at 1.6 cells reads as two sizes of piece in one puzzle.
        const biggest = Math.max(...m.area.values()) / (s * s);
        const score = Math.abs(m.pieces - N) + 0.8 * Math.max(0, biggest - 1.25) + 0.01 * m.merged;
        if (!best || score < best.score - 1e-9) best = { cols, rows, cw: s, ch: s, count: m.pieces, score };
      }
    }
  }
  return best;
}

function pickGrid(spec: JigsawSpec, W: number, H: number, minCell: number): GridPick | null {
  const N = Math.max(2, Math.round(spec.pieces));
  return spec.outline === 'circle' || spec.outline === 'heart' ? roundGrid(spec, N, W, H, minCell) : rectGrid(N, W, H, minCell);
}

/** The outline and its seams. */
export function planJigsaw(input: JigsawSpec): JigsawPlan {
  const spec: JigsawSpec = {
    ...input,
    wobble: Math.min(1, Math.max(0, input.wobble)),
    knob: Math.min(0.4, Math.max(0.1, input.knob)),
    pieces: Math.max(2, Math.round(input.pieces)),
  };
  const W = Math.max(1, spec.width);
  const H = spec.outline === 'circle' || spec.outline === 'square' ? W : Math.max(1, spec.height);
  // Past the smallest cell the size is what limits the count; with nothing at all over it, the
  // grid falls back to four pieces at whatever size they come to.
  const pick = pickGrid(spec, W, H, MIN_CELL) ?? pickGrid({ ...spec, pieces: 4 }, W, H, 0) ?? { cols: 2, rows: 2, cw: W / 2, ch: H / 2, count: 4, score: 0 };
  // A corner bigger than half a cell would round a corner piece into a crescent.
  const outline = jigsawOutline(spec.outline, W, H, Math.min(spec.corner, 0.5 * Math.min(pick.cw, pick.ch)));
  const lay = layout(outline, spec.outline, pick, spec.wobble, spec.seed);
  const m = merge(lay);
  const paths = chain(lay, buildEdges(lay, m, spec, outline));
  // Did the size hold the count back? Only if a grid of smaller cells would have come nearer.
  let fits = true;
  if (m.pieces < spec.pieces) {
    const free = pickGrid(spec, W, H, 0);
    if (free && Math.abs(free.count - spec.pieces) < Math.abs(m.pieces - spec.pieces)) fits = false;
  }
  return { outline, cols: pick.cols, rows: pick.rows, pieces: m.pieces, merged: m.merged, paths, cell: { w: pick.cw, h: pick.ch }, fits };
}

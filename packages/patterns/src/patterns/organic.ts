// Organic, generative and single-path engrave fills: a Voronoi lattice and its Delaunay dual,
// the Hilbert and serpentine space-filling curves an engraver can run in one continuous pass,
// a halftone gradient, seeded wood grain, noise contours, and the op-art moiré.
//
// The seeded ones hash the GRID CELL and the seed, never the call order, so sliding the region
// about never reshuffles the field. Hilbert, serpentine, halftone and moiré carry no seed
// because there is nothing random in them.
import { GAP, SIZE, SPACING, num, number, select, str, toggle } from '../params';
import { TAU, circle } from '../geom';
import { rng } from './fields';
import type { Box, Island, PatternDef, PatternGeometry, Polyline, Pt, Ring } from '../types';

const geo = (holes: Ring[] = [], lines: Polyline[] = []): PatternGeometry => ({ holes: holes.map((r): Island => [r]), lines, slits: [] });

/** How far the box reaches from the origin. */
const reach = (b: Box): number => Math.max(Math.hypot(b.minX, b.minY), Math.hypot(b.maxX, b.minY), Math.hypot(b.maxX, b.maxY), Math.hypot(b.minX, b.maxY));

// ---- the seeded point set --------------------------------------------------------------------

interface Site { x: number; y: number }
interface Grid { sites: Site[]; cols: number; rows: number }

/** One jittered site per grid cell, hashed from the cell index and the seed. The grid doubles
 *  as the bucket index: with the jitter capped at half a pitch, every Voronoi neighbour of a
 *  site lies in the 5 × 5 block around it. */
function siteGrid(box: Box, pitch: number, jitter: number, seed: number): Grid {
  const pad = 4;
  const i0 = Math.floor(box.minX / pitch) - pad;
  const i1 = Math.ceil(box.maxX / pitch) + pad;
  const j0 = Math.floor(box.minY / pitch) - pad;
  const j1 = Math.ceil(box.maxY / pitch) + pad;
  const cols = i1 - i0 + 1;
  const rows = j1 - j0 + 1;
  const s = Math.round(seed);
  const sites: Site[] = new Array<Site>(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rand = rng(s * 7919 + (i0 + c) * 104729 + (j0 + r) * 1299709 + 12345);
      sites[c + r * cols] = { x: (i0 + c + 0.5 + (rand() - 0.5) * jitter) * pitch, y: (j0 + r + 0.5 + (rand() - 0.5) * jitter) * pitch };
    }
  }
  return { sites, cols, rows };
}

/** Sutherland–Hodgman against one half-plane: keep ax·x + ay·y ≤ c. */
function clipHalf(poly: Pt[], ax: number, ay: number, c: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const da = ax * a[0] + ay * a[1] - c;
    const db = ax * b[0] + ay * b[1] - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/**
 * Each site's cell: the box clipped by the perpendicular bisector against every neighbour in
 * the 5 × 5 block. `gap` slides each bisector `gap/2` toward the site — exact for a convex
 * cell, so neighbouring cells end up exactly `gap` apart and the web is the number asked for.
 */
function voronoiCells(box: Box, pitch: number, jitter: number, seed: number, gap: number): { grid: Grid; cells: Ring[] } {
  const grid = siteGrid(box, pitch, jitter, seed);
  const rect: Ring = [[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]];
  const cells: Ring[] = new Array<Ring>(grid.sites.length);
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const s = grid.sites[c + r * grid.cols]!;
      let poly: Pt[] = rect;
      for (let dr = -2; dr <= 2; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= grid.rows || poly.length < 3) continue;
        for (let dc = -2; dc <= 2; dc++) {
          const cc = c + dc;
          if ((dr === 0 && dc === 0) || cc < 0 || cc >= grid.cols) continue;
          const n = grid.sites[cc + rr * grid.cols]!;
          const dx = n.x - s.x;
          const dy = n.y - s.y;
          const d = Math.hypot(dx, dy);
          if (d < 1e-9) continue;
          poly = clipHalf(poly, 2 * dx, 2 * dy, n.x * n.x + n.y * n.y - s.x * s.x - s.y * s.y - d * gap);
          if (poly.length < 3) break;
        }
      }
      cells[c + r * grid.cols] = poly.length >= 3 ? poly : [];
    }
  }
  return { grid, cells };
}

export const voronoi: PatternDef = {
  id: 'voronoi',
  name: 'Voronoi',
  family: 'organic',
  tags: ['holes', 'organic', 'cells', 'crack', 'vent', 'generative'],
  blurb: 'Cracked-stone cells round a seeded scatter of points — the organic vent, and the one every laser maker posts.',
  ops: ['cut', 'score', 'engrave'],
  params: [
    SPACING(9, 3, 80),
    number('jitter', 'Irregularity', 0.7, 0, 1, 0.05, '', 'How far each point wanders from its grid cell. 0 is a plain honeycomb.'),
    GAP(1.5, 0, 30),
    number('seed', 'Seed', 9, 1, 9999, 1, ''),
    toggle('edges', 'Cell walls only', false, 'Score the walls as single lines instead of cutting the cells out.'),
  ],
  generate: (box, p) => {
    const walls = p.edges === true;
    const { cells } = voronoiCells(box, num(p, 'spacing'), num(p, 'jitter'), num(p, 'seed'), walls ? 0 : num(p, 'gap'));
    const live = cells.filter((c) => c.length >= 3);
    // Walls: every cell drawn whole — the engine's merge collapses the two copies of each
    // shared wall into one line.
    return walls ? geo([], live.map((c) => [...c, c[0]!])) : geo(live);
  },
  web: (p) => num(p, 'gap'),
  thumb: { params: { spacing: 6, gap: 0.8 } },
};

export const delaunay: PatternDef = {
  id: 'delaunay',
  name: 'Delaunay',
  family: 'organic',
  tags: ['lines', 'organic', 'triangles', 'low poly', 'generative'],
  blurb: 'The low-poly triangle mesh over the same seeded points the Voronoi cells come from.',
  ops: ['score', 'engrave'],
  params: [SPACING(9, 3, 80), number('jitter', 'Irregularity', 0.7, 0, 1, 0.05, ''), number('seed', 'Seed', 9, 1, 9999, 1, '')],
  generate: (box, p) => {
    // Delaunay is the Voronoi dual: two sites are joined exactly when their cells share a wall,
    // so the cells already computed hand the triangulation back without a second algorithm.
    const { grid, cells } = voronoiCells(box, num(p, 'spacing'), num(p, 'jitter'), num(p, 'seed'), 0);
    const lines: Polyline[] = [];
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const id = c + r * grid.cols;
        const cell = cells[id]!;
        if (cell.length < 3) continue;
        const s = grid.sites[id]!;
        for (let dr = -2; dr <= 2; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= grid.rows) continue;
          for (let dc = -2; dc <= 2; dc++) {
            const cc = c + dc;
            const other = cc + rr * grid.cols;
            if (other <= id || cc < 0 || cc >= grid.cols) continue;
            const n = grid.sites[other]!;
            const dx = n.x - s.x;
            const dy = n.y - s.y;
            const d = Math.hypot(dx, dy);
            if (d < 1e-9) continue;
            // Two cell corners on the bisector means the wall is real, so the sites are neighbours.
            const k = (n.x * n.x + n.y * n.y - s.x * s.x - s.y * s.y) / (2 * d);
            let on = 0;
            for (const q of cell) if (Math.abs((q[0] * dx + q[1] * dy) / d - k) < 1e-6 && ++on === 2) break;
            if (on >= 2) lines.push([[s.x, s.y], [n.x, n.y]]);
          }
        }
      }
    }
    return geo([], lines);
  },
};

// ---- space-filling engrave fills ---------------------------------------------------------------

/** The Hilbert curve's d-th cell, order by order (the standard d2xy). */
function hilbertCell(order: number, d: number): Pt {
  let t = d;
  let x = 0;
  let y = 0;
  for (let s = 1; s < 1 << order; s <<= 1) {
    const rx = 1 & (t >> 1);
    const ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const swap = x;
      x = y;
      y = swap;
    }
    x += s * rx;
    y += s * ry;
    t >>= 2;
  }
  return [x, y];
}

export const hilbert: PatternDef = {
  id: 'hilbert',
  name: 'Hilbert curve',
  family: 'engrave',
  tags: ['lines', 'engrave', 'fill', 'maze', 'continuous', 'space-filling'],
  blurb: 'One unbroken line that visits every part of the piece and never crosses itself — a single-pass engrave, or a maze.',
  ops: ['engrave', 'score'],
  params: [SPACING(3, 0.4, 40)],
  generate: (box, p) => {
    const side = Math.max(box.maxX - box.minX, box.maxY - box.minY);
    // Order 6 is 4096 cells; past that the path is more points than a laser wants in one run.
    const order = Math.max(1, Math.min(6, Math.round(Math.log2(Math.max(2, side / num(p, 'spacing'))))));
    const n = 1 << order;
    const cell = side / n;
    const x0 = (box.minX + box.maxX) / 2 - side / 2 + cell / 2;
    const y0 = (box.minY + box.maxY) / 2 - side / 2 + cell / 2;
    const line: Polyline = new Array<Pt>(n * n);
    for (let d = 0; d < n * n; d++) {
      const [x, y] = hilbertCell(order, d);
      line[d] = [x0 + x * cell, y0 + y * cell];
    }
    return geo([], [line]);
  },
};

export const serpentine: PatternDef = {
  id: 'serpentine',
  name: 'Serpentine',
  family: 'engrave',
  tags: ['lines', 'engrave', 'fill', 'continuous', 'boustrophedon', 'raster'],
  blurb: 'A hatch joined end to end — one continuous back-and-forth pass, the way a raster engraver actually moves.',
  ops: ['engrave', 'score'],
  params: [SPACING(2, 0.2, 40)],
  generate: (box, p) => {
    const s = num(p, 'spacing');
    const x0 = box.minX - s;
    const x1 = box.maxX + s;
    const rows = Math.max(1, Math.ceil((box.maxY - box.minY + 2 * s) / s));
    const line: Polyline = [];
    for (let k = 0; k <= rows; k++) {
      const y = box.minY - s + k * s;
      const [a, b] = k % 2 ? [x1, x0] : [x0, x1];
      line.push([a, y], [b, y]);
    }
    return geo([], [line]);
  },
};

// ---- halftone ----------------------------------------------------------------------------------

export const halftone: PatternDef = {
  id: 'halftone',
  name: 'Halftone',
  family: 'engrave',
  tags: ['holes', 'dots', 'gradient', 'engrave', 'fade', 'pop art'],
  blurb: 'Dots that swell across the piece — the printer\'s gradient. Dot AREA follows the tone, which is what the eye reads.',
  ops: ['engrave', 'cut', 'score'],
  params: [
    select('direction', 'Fades', 'radial', [
      { value: 'radial', label: 'Out from the centre' },
      { value: 'radial-in', label: 'In toward the centre' },
      { value: 'x', label: 'Left to right' },
      { value: 'y', label: 'Bottom to top' },
    ]),
    SPACING(5, 1, 40),
    SIZE(3.5, 0.5, 40, 'Largest dot'),
    number('min', 'Smallest dot', 0.6, 0, 20, 0.1),
    number('contrast', 'Contrast', 1, 0.5, 4, 0.1, '', 'Steepens the tone response; over 1 the dots reach full size before the far end.'),
    GAP(1.5, 0, 20),
    toggle('stagger', 'Stagger rows', true),
  ],
  generate: (box, p) => {
    const pitch = num(p, 'spacing');
    const big = Math.min(num(p, 'size'), pitch - num(p, 'gap'));
    const small = Math.min(num(p, 'min'), big);
    if (big < 0.1) return geo();
    const dir = str(p, 'direction', 'radial');
    const contrast = num(p, 'contrast');
    const stagger = p.stagger === true;
    const rowH = stagger ? (pitch * Math.sqrt(3)) / 2 : pitch;
    const w = Math.max(1e-6, box.maxX - box.minX);
    const h = Math.max(1e-6, box.maxY - box.minY);
    const rmax = Math.max(1e-6, Math.min(w, h) / 2);
    const tone = (x: number, y: number): number => {
      if (dir === 'x') return (x - box.minX) / w;
      if (dir === 'y') return (y - box.minY) / h;
      const v = Math.hypot(x, y) / rmax;
      return dir === 'radial-in' ? 1 - v : v;
    };
    const holes: Ring[] = [];
    let row = 0;
    for (let y = box.minY - rowH; y <= box.maxY + rowH; y += rowH, row++) {
      const off = stagger && row % 2 ? pitch / 2 : 0;
      for (let x = Math.floor((box.minX - pitch) / pitch) * pitch + off; x <= box.maxX + pitch; x += pitch) {
        // Dot AREA linear in the tone: the radius goes as its square root.
        const v = Math.max(0, Math.min(1, contrast * tone(x, y)));
        const d = Math.max(small, big * Math.sqrt(v));
        if (d < 0.1) continue;
        holes.push(circle(x, y, d / 2, 16));
      }
    }
    return geo(holes);
  },
  web: (p) => num(p, 'gap'),
};

// ---- seeded noise ------------------------------------------------------------------------------

/** A band-limited 1-D field: three sines, normalised to ±1. */
function grainField(wave: number, seed: number): { f: (x: number) => number; s: (y: number) => number; shortest: number } {
  const rand = rng(seed);
  const p0 = rand() * TAU;
  const p1 = rand() * TAU;
  const p2 = rand() * TAU;
  const p3 = rand() * TAU;
  return {
    f: (x) => 0.5 * Math.sin((TAU * x) / wave + p0) + 0.32 * Math.sin((TAU * x) / (wave * 0.55) + p1) + 0.18 * Math.sin((TAU * x) / (wave * 0.32) + p2),
    s: (y) => 0.6 * Math.sin((TAU * y) / (wave * 0.8) + p3) + 0.4 * Math.sin((TAU * y) / (wave * 0.33) + p1),
    shortest: wave * 0.32,
  };
}

export const woodGrain: PatternDef = {
  id: 'wood-grain',
  name: 'Wood grain',
  family: 'organic',
  tags: ['lines', 'organic', 'grain', 'flow', 'texture', 'generative'],
  blurb: 'Flowing near-parallel lines that bunch and spread the way grain does — never crossing, whatever the seed.',
  ops: ['score', 'engrave'],
  params: [
    SPACING(3, 0.4, 30),
    number('wave', 'Wave length', 70, 5, 300, 1),
    number('amp', 'Wave depth', 3.5, 0, 30, 0.1),
    number('bunch', 'Bunching', 0.7, 0, 0.9, 0.05, '', 'How much the spacing between lines varies.'),
    number('seed', 'Seed', 4, 1, 9999, 1, ''),
  ],
  generate: (box, p) => {
    const gap = num(p, 'spacing');
    const amp = num(p, 'amp');
    const bunch = num(p, 'bunch');
    const field = grainField(num(p, 'wave'), num(p, 'seed'));
    const step = Math.max(0.6, field.shortest / 6);
    const x0 = box.minX - step;
    const x1 = box.maxX + step;
    const cols = Math.max(2, Math.ceil((x1 - x0) / step));
    const lines: Polyline[] = [];
    // The line spacing is stretched by a slowly varying field, so lines bunch without ever
    // meeting; the wave that makes them flow is a shared shift, sheared a little per line.
    for (let y = box.minY - gap; y <= box.maxY + gap; ) {
      const line: Polyline = new Array<Pt>(cols + 1);
      for (let i = 0; i <= cols; i++) {
        const x = x0 + ((x1 - x0) * i) / cols;
        line[i] = [x, y + amp * field.f(x + y * 0.12)];
      }
      lines.push(line);
      y += gap * (1 + bunch * field.s(y));
    }
    return geo([], lines);
  },
};

/** Marching squares, one segment per case as the pair of cell edges it crosses (0 bottom,
 *  1 right, 2 top, 3 left). The two saddles, 5 and 10, are decided by the cell's centre. */
const MS_CASES: number[][] = [[], [3, 0], [0, 1], [3, 1], [1, 2], [], [0, 2], [3, 2], [2, 3], [2, 0], [], [2, 1], [1, 3], [1, 0], [0, 3], []];

/** Where the level crosses cell edge `e`, by linear interpolation between its two corners. */
function isoPoint(e: number, x: number, y: number, hx: number, hy: number, a: number, b: number, c: number, d: number, iso: number): Pt {
  if (e === 0) return [x + hx * ((iso - a) / (b - a)), y];
  if (e === 1) return [x + hx, y + hy * ((iso - b) / (c - b))];
  if (e === 2) return [x + hx * ((iso - d) / (c - d)), y + hy];
  return [x, y + hy * ((iso - a) / (d - a))];
}

export const contours: PatternDef = {
  id: 'contours',
  name: 'Contours',
  family: 'organic',
  tags: ['lines', 'organic', 'topographic', 'noise', 'level set', 'generative'],
  blurb: 'Closed level lines through a seeded noise field — the topographic map look.',
  ops: ['score', 'engrave'],
  params: [
    number('scale', 'Feature size', 40, 5, 300, 1),
    number('levels', 'Lines', 6, 2, 40, 1, ''),
    number('detail', 'Detail', 3, 0.4, 10, 0.1, 'mm', 'The grid the level lines are traced on. Finer is smoother and slower; 1 mm is as smooth as a laser can cut.'),
    number('seed', 'Seed', 6, 1, 9999, 1, ''),
  ],
  generate: (box, p) => {
    const scale = num(p, 'scale');
    const levels = Math.round(num(p, 'levels'));
    const rand = rng(num(p, 'seed'));
    // Three plane waves at seeded angles: band-limited noise with no table and no library.
    // The shortest is half the feature size, so a grid of `detail` never aliases it.
    const waves: { kx: number; ky: number; ph: number; a: number }[] = [];
    for (const [f, a] of [[1, 0.45], [0.7, 0.33], [0.5, 0.22]] as [number, number][]) {
      const th = rand() * TAU;
      const k = TAU / (scale * f);
      waves.push({ kx: k * Math.cos(th), ky: k * Math.sin(th), ph: rand() * TAU, a });
    }
    const at = (x: number, y: number): number => {
      let v = 0;
      for (const w of waves) v += w.a * Math.sin(w.kx * x + w.ky * y + w.ph);
      return v;
    };
    // The grid lands exactly on the box, so an open contour end is always on its boundary.
    const cols = Math.max(2, Math.ceil((box.maxX - box.minX) / num(p, 'detail'))) + 1;
    const rows = Math.max(2, Math.ceil((box.maxY - box.minY) / num(p, 'detail'))) + 1;
    const hx = (box.maxX - box.minX) / (cols - 1);
    const hy = (box.maxY - box.minY) / (rows - 1);
    const v = new Float64Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) v[i + j * cols] = at(box.minX + i * hx, box.minY + j * hy);
    const isos: number[] = [];
    for (let l = 0; l < levels; l++) isos.push(-1 + (2 * (l + 0.5)) / levels);
    const lines: Polyline[] = [];
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = v[i + j * cols]!;
        const b = v[i + 1 + j * cols]!;
        const c = v[i + 1 + (j + 1) * cols]!;
        const d = v[i + (j + 1) * cols]!;
        // Most cells cross no level at all: one comparison skips them.
        const lo = Math.min(a, b, c, d);
        const hi = Math.max(a, b, c, d);
        const x = box.minX + i * hx;
        const y = box.minY + j * hy;
        for (const iso of isos) {
          if (iso <= lo || iso >= hi) continue;
          const code = (a > iso ? 1 : 0) | (b > iso ? 2 : 0) | (c > iso ? 4 : 0) | (d > iso ? 8 : 0);
          if (code === 0 || code === 15) continue;
          if (code === 5 || code === 10) {
            // The saddle: the cell's own centre says which pair of corners is joined.
            const split = ((a + b + c + d) / 4 > iso) === (code === 5);
            const pair = split ? [0, 1, 2, 3] : [3, 0, 1, 2];
            lines.push([isoPoint(pair[0]!, x, y, hx, hy, a, b, c, d, iso), isoPoint(pair[1]!, x, y, hx, hy, a, b, c, d, iso)]);
            lines.push([isoPoint(pair[2]!, x, y, hx, hy, a, b, c, d, iso), isoPoint(pair[3]!, x, y, hx, hy, a, b, c, d, iso)]);
            continue;
          }
          const pair = MS_CASES[code]!;
          lines.push([isoPoint(pair[0]!, x, y, hx, hy, a, b, c, d, iso), isoPoint(pair[1]!, x, y, hx, hy, a, b, c, d, iso)]);
        }
      }
    }
    return geo([], lines);
  },
  thumb: { params: { scale: 16, detail: 1, levels: 7 } },
};

// ---- moiré ---------------------------------------------------------------------------------

export const moire: PatternDef = {
  id: 'moire',
  name: 'Moiré',
  family: 'radial',
  tags: ['lines', 'op art', 'interference', 'concentric', 'radial'],
  blurb: 'Two sets of concentric rings side by side — the interference pattern between them is the drawing, not the rings.',
  ops: ['score', 'engrave'],
  params: [
    SPACING(3, 0.5, 40),
    number('offset', 'Centres apart', 8, 0, 200, 0.5),
    number('ratio', 'Second pitch ÷ first', 1, 0.5, 2, 0.01, '', 'Leave it at 1 and move the centres apart; change it for the concentric moiré.'),
  ],
  generate: (box, p) => {
    const s = num(p, 'spacing');
    const off = num(p, 'offset');
    const R = reach(box) + off;
    const lines: Polyline[] = [];
    for (const [cx, pitch] of [[-off / 2, s], [off / 2, s * num(p, 'ratio')]] as [number, number][]) {
      if (pitch < 0.05) continue;
      for (let r = pitch; r <= R + pitch; r += pitch) {
        // A big ring is sampled by its sagitta, not its chord: 96 points keep a 200 mm circle
        // inside 0.11 mm of true — under the kerf — and the pattern is hundreds of rings deep.
        const c = circle(cx, 0, r, Math.max(24, Math.min(96, Math.ceil((TAU * r) / 0.5))));
        lines.push([...c, c[0]!]);
      }
    }
    return geo([], lines);
  },
};

export const ORGANIC: PatternDef[] = [voronoi, delaunay, hilbert, serpentine, halftone, woodGrain, contours, moire];

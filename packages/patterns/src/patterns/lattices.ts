// Line lattices: scored or engraved, and cut as lattices — the lines kept as struts, the spaces
// between cut out (lattice.ts; cut THROUGH, a lattice of lines would be a bag of loose
// triangles). Each tile draws only what its own cell owns where it can — a lattice line is
// drawn as one diagonal per cell and the engine's merge joins the diagonals into one long
// line — and where a whole polygon is easier to read (a hexagon), the shared edges are drawn
// twice and the merge drops the duplicate.
//
// The hex-lattice family here is what Pattern Monster's "Japanese Pattern 1–4" and "Hexagon 8"
// are, by construction rather than by tile: kikkō (tortoise shell), asanoha (hemp leaf), cubes
// (tumbling blocks), kagome (basket weave) and the striped hexagon weave.
import { SQRT3, circle, hexagon, seg } from '../geom';
import { SIZE, SPACING, bool, num, number, toggle } from '../params';
import type { PatternDef, PatternGeometry, Polyline, Pt } from '../types';

const linesOnly = (lines: Polyline[]): PatternGeometry => ({ holes: [], lines, slits: [] });
const closed = (ring: Pt[]): Polyline => [...ring, ring[0]!];

export const grid: PatternDef = {
  id: 'grid',
  name: 'Grid',
  family: 'lines',
  tags: ['lines', 'squares', 'graph', 'kōshi'],
  blurb: 'Plain square grid lines — kōshi, the Japanese lattice.',
  ops: ['score', 'engrave'],
  params: [SPACING(5, 0.5, 60)],
  cell: (p) => ({ w: num(p, 'spacing'), h: num(p, 'spacing') }),
  tile: (p) => {
    const s = num(p, 'spacing');
    return linesOnly([seg([0, 0], [s, 0]), seg([0, 0], [0, s])]);
  },
};

export const diamondLattice: PatternDef = {
  id: 'diamond-lattice',
  name: 'Diamond lattice',
  family: 'lines',
  tags: ['lines', 'rhombus', 'hishi', 'trellis', 'argyle'],
  blurb: 'Two families of diagonal lines — a trellis; the argyle and hishi ground.',
  ops: ['score', 'engrave'],
  params: [number('width', 'Width', 8, 1, 80), number('height', 'Height', 12, 1, 80)],
  cell: (p) => ({ w: num(p, 'width'), h: num(p, 'height') }),
  tile: (p) => {
    const w = num(p, 'width');
    const h = num(p, 'height');
    return linesOnly([seg([0, 0], [w, h]), seg([w, 0], [0, h])]);
  },
};

export const triangleLattice: PatternDef = {
  id: 'triangle-lattice',
  name: 'Triangle lattice',
  family: 'lines',
  tags: ['lines', 'triangles', 'isometric'],
  blurb: 'Three families of lines at 60° — the isometric grid every hex pattern is built on.',
  ops: ['score', 'engrave'],
  params: [SIZE(8, 1, 80, 'Side')],
  cell: (p) => ({ w: num(p, 'size'), h: num(p, 'size') * SQRT3 }),
  tile: (p) => triangleLines(num(p, 'size')),
};

function triangleLines(a: number): PatternGeometry {
  const h = (a * SQRT3) / 2;
  return linesOnly([seg([0, 0], [a, 2 * h]), seg([a, 0], [0, 2 * h]), seg([0, 0], [a, 0]), seg([0, h], [a, h])]);
}

export const kikko: PatternDef = {
  id: 'kikko',
  name: 'Kikkō (tortoise shell)',
  family: 'japanese',
  tags: ['lines', 'hexagon', 'honeycomb', 'japanese', 'wagara'],
  blurb: 'Hexagons edge to edge — kikkō, the tortoise-shell hex; doubled, each hexagon carries an inner one.',
  ops: ['score', 'engrave'],
  params: [SIZE(10, 2, 80), toggle('double', 'Double line', false, 'An inner hexagon inside each cell.'), number('inner', 'Inner size', 0.7, 0.3, 0.95, 0.05, '×')],
  cell: (p) => ({ w: num(p, 'size'), h: num(p, 'size') * SQRT3 }),
  tile: (p) => {
    const s = num(p, 'size');
    const lines: Polyline[] = [closed(hexagon(s / 2, (s * SQRT3) / 2, s)), closed(hexagon(0, 0, s))];
    if (bool(p, 'double')) {
      const k = num(p, 'inner');
      lines.push(closed(hexagon(s / 2, (s * SQRT3) / 2, s * k)), closed(hexagon(0, 0, s * k)));
    }
    return linesOnly(lines);
  },
};

export const asanoha: PatternDef = {
  id: 'asanoha',
  name: 'Asanoha (hemp leaf)',
  family: 'japanese',
  tags: ['lines', 'hexagon', 'star', 'japanese', 'wagara', 'kumiko'],
  blurb: 'The hemp-leaf star: every triangle of the lattice joined to its own centre. The best-known kumiko pattern.',
  ops: ['score', 'engrave'],
  params: [SIZE(10, 2, 80, 'Star size')],
  cell: (p) => ({ w: num(p, 'size'), h: num(p, 'size') * SQRT3 }),
  tile: (p) => {
    const a = num(p, 'size');
    const h = (a * SQRT3) / 2;
    const lines = triangleLines(a).lines;
    // Four triangles per cell: two pointing up, two down; spokes from each centroid.
    const tris: [Pt, Pt, Pt][] = [
      [[0, 0], [a, 0], [a / 2, h]],
      [[a / 2, h], [(3 * a) / 2, h], [a, 0]],
      [[a / 2, h], [(3 * a) / 2, h], [a, 2 * h]],
      [[0, 2 * h], [a, 2 * h], [a / 2, h]],
    ];
    for (const t of tris) {
      const c: Pt = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
      for (const v of t) lines.push(seg(c, v));
    }
    return linesOnly(lines);
  },
};

export const cubes: PatternDef = {
  id: 'cubes',
  name: 'Cubes (tumbling blocks)',
  family: 'japanese',
  tags: ['lines', 'hexagon', 'rhombille', 'isometric', 'japanese'],
  blurb: 'Hexagons split into three rhombi — tumbling blocks, the isometric cube illusion.',
  ops: ['score', 'engrave'],
  params: [SIZE(10, 2, 80, 'Cube size')],
  cell: (p) => ({ w: num(p, 'size'), h: num(p, 'size') * SQRT3 }),
  tile: (p) => {
    const s = num(p, 'size');
    const r = s / SQRT3;
    const lines: Polyline[] = [];
    for (const [cx, cy] of [[s / 2, (s * SQRT3) / 2], [0, 0]] as Pt[]) {
      lines.push(closed(hexagon(cx, cy, s)));
      for (const ang of [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3]) {
        lines.push(seg([cx, cy], [cx + r * Math.cos(ang), cy + r * Math.sin(ang)]));
      }
    }
    return linesOnly(lines);
  },
};

export const kagome: PatternDef = {
  id: 'kagome',
  name: 'Kagome (basket weave)',
  family: 'japanese',
  tags: ['lines', 'trihexagonal', 'basket', 'japanese', 'wagara'],
  blurb: 'The bamboo-basket weave: triangles and hexagons from three families of lines.',
  ops: ['score', 'engrave'],
  params: [SIZE(6, 1, 60, 'Hexagon side')],
  cell: (p) => ({ w: 2 * num(p, 'size'), h: 2 * num(p, 'size') * SQRT3 }),
  tile: (p) => {
    const s = num(p, 'size');
    const d = s * SQRT3;
    return linesOnly([seg([0, 0], [2 * s, 2 * d]), seg([2 * s, 0], [0, 2 * d]), seg([0, d / 2], [2 * s, d / 2]), seg([0, (3 * d) / 2], [2 * s, (3 * d) / 2])]);
  },
};

export const hexWeave: PatternDef = {
  id: 'hex-weave',
  name: 'Hexagon weave',
  family: 'japanese',
  tags: ['lines', 'hexagon', 'stripes', 'weave', 'bishamon'],
  blurb: 'Hexagons striped in three directions, one per third — the woven look of Pattern Monster\'s Hexagon 8.',
  ops: ['score', 'engrave'],
  params: [SIZE(12, 3, 80), number('stripes', 'Stripes per third', 3, 1, 8, 1, '')],
  cell: (p) => ({ w: num(p, 'size'), h: num(p, 'size') * SQRT3 }),
  tile: (p) => {
    const s = num(p, 'size');
    const n = Math.round(num(p, 'stripes'));
    const r = s / SQRT3;
    const lines: Polyline[] = [];
    for (const [cx, cy] of [[s / 2, (s * SQRT3) / 2], [0, 0]] as Pt[]) {
      const hex = hexagon(cx, cy, s);
      lines.push(closed(hex));
      // Three rhombi (the cube's faces); each striped parallel to one of its own edges.
      for (let k = 0; k < 3; k++) {
        const a = Math.PI / 2 + (k * 2 * Math.PI) / 3;
        const v1: Pt = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
        const v2: Pt = [cx + r * Math.cos(a + Math.PI / 3), cy + r * Math.sin(a + Math.PI / 3)];
        const v3: Pt = [cx + r * Math.cos(a + (2 * Math.PI) / 3), cy + r * Math.sin(a + (2 * Math.PI) / 3)];
        // Rhombus centre, v1, v2, v3: stripes run parallel to centre→v2, stepping from centre→v1 towards v3→v2.
        for (let i = 1; i <= n; i++) {
          const t = i / (n + 1);
          const a0: Pt = [cx + (v1[0] - cx) * t, cy + (v1[1] - cy) * t];
          const a1: Pt = [v3[0] + (v2[0] - v3[0]) * t, v3[1] + (v2[1] - v3[1]) * t];
          lines.push(seg(a0, a1));
        }
      }
    }
    return linesOnly(lines);
  },
};

export const shippo: PatternDef = {
  id: 'shippo',
  name: 'Shippō (seven treasures)',
  family: 'japanese',
  tags: ['lines', 'circles', 'overlapping', 'japanese', 'wagara', 'quatrefoil'],
  blurb: 'Circles overlapping their four neighbours, leaving four-petal stars between — shippō.',
  ops: ['score', 'engrave'],
  params: [SIZE(12, 2, 80, 'Circle size')],
  cell: (p) => {
    const pitch = (num(p, 'size') / 2) * Math.SQRT2;
    return { w: pitch, h: pitch };
  },
  tile: (p) => {
    const r = num(p, 'size') / 2;
    const pitch = r * Math.SQRT2;
    return linesOnly([closed(circle(pitch / 2, pitch / 2, r))]);
  },
};

export const seigaiha: PatternDef = {
  id: 'seigaiha',
  name: 'Seigaiha (waves)',
  family: 'japanese',
  tags: ['lines', 'scales', 'waves', 'fan', 'japanese', 'wagara'],
  blurb: 'Fans of concentric arcs, each row peeking over the one in front — seigaiha, the blue sea waves.',
  ops: ['score', 'engrave'],
  params: [SIZE(16, 4, 100, 'Fan width'), number('rings', 'Rings', 4, 1, 8, 1, ''), number('overlap', 'Row overlap', 0.5, 0.25, 0.9, 0.05, '×')],
  cell: (p) => {
    const R = num(p, 'size') / 2;
    return { w: 2 * R, h: 2 * R * num(p, 'overlap') };
  },
  tile: (p) => {
    const R = num(p, 'size') / 2;
    const v = R * num(p, 'overlap');
    const n = Math.round(num(p, 'rings'));
    // Rows in front of a fan at the origin: (±R, −v), (0, −2v), (±R, −3v)… until a disc that
    // low cannot reach the origin's outer circle any more.
    const front: Pt[] = [];
    for (let j = 1; j * v < 2 * R + 1e-9; j++) {
      const xs = j % 2 ? [-R, R] : [0, -2 * R, 2 * R];
      for (const x of xs) front.push([x, -j * v]);
    }
    const hidden = ([x, y]: Pt): boolean => front.some(([fx, fy]) => Math.hypot(x - fx, y - fy) < R - 1e-6);
    const arcs: Polyline[] = [];
    for (let k = 1; k <= n; k++) {
      const r = (R * k) / n;
      const steps = Math.max(24, Math.ceil((2 * Math.PI * r) / 0.4));
      let run: Pt[] | null = null;
      for (let i = 0; i <= steps; i++) {
        const t = Math.PI / 2 + (2 * Math.PI * i) / steps;
        const q: Pt = [r * Math.cos(t), r * Math.sin(t)];
        if (hidden(q)) {
          if (run && run.length > 1) arcs.push(run);
          run = null;
        } else (run ??= []).push(q);
      }
      if (run && run.length > 1) arcs.push(run);
    }
    // Two fans per cell: one at the corner, one at the centre.
    const shifted = arcs.map((a) => a.map(([x, y]): Pt => [x + R, y + v]));
    return linesOnly([...arcs, ...shifted]);
  },
};

export const waves: PatternDef = {
  id: 'waves',
  name: 'Waves',
  family: 'lines',
  tags: ['lines', 'sine', 'ripple', 'water'],
  blurb: 'Rows of smooth sine waves.',
  ops: ['score', 'engrave'],
  params: [number('wavelength', 'Wavelength', 12, 2, 100), number('amplitude', 'Amplitude', 2, 0.2, 40, 0.1), SPACING(6, 1, 60)],
  cell: (p) => ({ w: num(p, 'wavelength'), h: num(p, 'spacing') }),
  tile: (p) => {
    const L = num(p, 'wavelength');
    const A = num(p, 'amplitude');
    const y0 = num(p, 'spacing') / 2;
    const n = Math.max(8, Math.ceil(L / 0.5));
    const line: Polyline = [];
    for (let i = 0; i <= n; i++) {
      const x = (L * i) / n;
      line.push([x, y0 + A * Math.sin((2 * Math.PI * x) / L)]);
    }
    return linesOnly([line]);
  },
};

export const chevron: PatternDef = {
  id: 'chevron',
  name: 'Chevron',
  family: 'lines',
  tags: ['lines', 'zigzag', 'herringbone'],
  blurb: 'Rows of zigzag lines.',
  ops: ['score', 'engrave'],
  params: [number('width', 'Width', 10, 2, 100), number('height', 'Height', 5, 0.5, 60), SPACING(6, 1, 60)],
  cell: (p) => ({ w: num(p, 'width'), h: num(p, 'spacing') }),
  tile: (p) => {
    const w = num(p, 'width');
    const h = num(p, 'height');
    const y0 = num(p, 'spacing') / 2;
    return linesOnly([[[0, y0 - h / 2], [w / 2, y0 + h / 2], [w, y0 - h / 2]]]);
  },
};

export const LATTICES: PatternDef[] = [grid, diamondLattice, triangleLattice, kikko, asanoha, cubes, kagome, hexWeave, shippo, seigaiha, waves, chevron];

// Japanese wagara (和柄) and kumiko, by construction rather than by trace. The hex-lattice half
// of the family already lives in lattices.ts — kikkō, asanoha, kagome, shippō, seigaiha, cubes,
// ichimatsu (as `checkerboard`) — so this file is the rest: the key fret, the arrow feathers,
// the two kikkō elaborations, the rising-steam bands, the fish scales, the quartered diamond and
// two kumiko infills.
//
// Every motif sits on its cell's centre, Y is up, and a pattern made only of lines says so by
// leaving `holes` empty — a cut then keeps its lines as struts and cuts the spaces (lattice.ts).
import { SQRT3, hexagon, seg, shrinkRing } from '../geom';
import { GAP, SIZE, num, number } from '../params';
import type { Island, PatternDef, PatternGeometry, Polyline, Pt, Ring } from '../types';

const linesOnly = (lines: Polyline[]): PatternGeometry => ({ holes: [], lines, slits: [] });
const closed = (ring: Pt[]): Polyline => [...ring, ring[0]!];
const holesOnly = (holes: Ring[]): PatternGeometry => ({ holes: holes.map((r): Island => [r]), lines: [], slits: [] });

// ---------------------------------------------------------------------------------------------
// Sayagata (紗綾形) — the key fret, properly: interlocking manji (卍), not a meandering band.
// A manji of arm `a` is a cross of two 2a bars with an L-hook of length a at every tip, and the
// hook ends land exactly on the neighbouring manji's hook ends. Put one manji per cell turned
// 45° — the way it lies on cloth — and the manji lattice becomes a plain square lattice of pitch
// 2√2·a, with each pair of hooks merging into one straight 2a bridge. The voids left between
// them are the H-shapes sayagata is known by.
export const sayagata: PatternDef = {
  id: 'sayagata',
  name: 'Sayagata (key fret)',
  family: 'japanese',
  tags: ['lines', 'manji', 'key fret', 'meander', 'japanese', 'wagara'],
  blurb: 'Manji locked arm to arm on the diagonal — sayagata, the key fret behind a thousand kimono linings.',
  ops: ['score', 'engrave'],
  params: [SIZE(4, 1, 30, 'Arm length')],
  cell: (p) => {
    const w = 2 * Math.SQRT2 * num(p, 'size');
    return { w, h: w };
  },
  tile: (p) => {
    const a = num(p, 'size');
    const half = Math.SQRT2 * a; // half the cell: the manji sits on the cell's centre
    const k = Math.SQRT1_2;
    const turn = ([x, y]: Pt): Pt => [half + (x - y) * k, half + (x + y) * k];
    const manji: Polyline[] = [
      [[-a, 0], [a, 0]],
      [[0, -a], [0, a]],
      [[a, 0], [a, a]],
      [[0, a], [-a, a]],
      [[-a, 0], [-a, -a]],
      [[0, -a], [a, -a]],
    ];
    return linesOnly(manji.map((l) => l.map(turn)));
  },
};

// ---------------------------------------------------------------------------------------------
// Yagasuri (矢絣) — arrow feathers. Columns of chevron barbs, every other column flighted the
// other way. Each barb is the band between two parallel chevrons, so consecutive barbs nest with
// a constant groove; the columns are held apart by the same groove. Engrave-only: the barbs are
// shallow slivers that would be ugly as cut-outs, and the bands' tips are far too acute.
export const yagasuri: PatternDef = {
  id: 'yagasuri',
  name: 'Yagasuri (arrow feathers)',
  family: 'japanese',
  tags: ['engrave', 'arrow', 'chevron', 'kasuri', 'japanese', 'wagara'],
  blurb: 'Columns of arrow fletching pointing up, then down, then up — yagasuri, the kasuri weave every schoolgirl kimono wears.',
  ops: ['engrave', 'score'],
  params: [
    number('width', 'Column width', 8, 3, 60),
    number('height', 'Barb pitch', 6.5, 1.5, 40),
    number('rise', 'Barb rise', 0.8, 0.2, 3, 0.05, '×', 'The chevron\'s rise as a multiple of half the column — 1 is a 45° feather.'),
    number('gap', 'Groove', 2.2, 0.2, 12, 0.1, 'mm', 'Material left between one barb and the next.'),
  ],
  cell: (p) => ({ w: 2 * num(p, 'width'), h: num(p, 'height') }),
  tile: (p) => {
    const W = num(p, 'width');
    const H = num(p, 'height');
    const g = Math.min(num(p, 'gap'), H - 0.3);
    const t = H - g;
    const A = (num(p, 'rise') * W) / 2;
    const y0 = H / 2 - A - t / 2;
    const barb = (x0: number, mirror: boolean): Ring => {
      const xa = x0 + g / 2;
      const xb = x0 + W - g / 2;
      const xm = x0 + W / 2;
      const ring: Ring = [[xa, y0], [xm, y0 + A], [xb, y0], [xb, y0 + t], [xm, y0 + A + t], [xa, y0 + t]];
      return mirror ? ring.map(([x, y]): Pt => [x, H - y]) : ring;
    };
    return holesOnly([barb(0, false), barb(W, true)]);
  },
  // The groove is measured square to a barb's arms, and the arm only runs half the column less
  // half the groove — so it is steeper than `rise` alone suggests, and the gap is tighter.
  web: (p) => {
    const W = num(p, 'width');
    const H = num(p, 'height');
    const g = Math.min(num(p, 'gap'), H - 0.3);
    const run = Math.max(0.1, W / 2 - g / 2);
    return (g * run) / Math.hypot(run, (num(p, 'rise') * W) / 2);
  },
};

// ---------------------------------------------------------------------------------------------
// Bishamon-kikkō (毘沙門亀甲) — Bishamonten's crest: kikkō hexagons taken three at a time round a
// shared vertex into a trefoil. Three mutually-touching hexagons partition the hex tiling exactly
// (one vertex in six carries a group), so the trefoils tile with no remainder; the lattice they
// sit on is generated by (3s/2, ±s√3/2), i.e. two trefoils per 3s × s√3 cell.
//
// Every trefoil vertex is a hexagon corner: the nine convex ones bisect toward their own hexagon
// centre, the three reflex ones toward the shared vertex, and all of them inset by 2d/√3 — which
// is the whole offset routine for this shape, in one line. The Y inside each trefoil is the three
// hexagon edges the group swallowed.
const HEX_ANGLES = [30, 90, 150, 210, 270, 330].map((d) => (d * Math.PI) / 180);

export const bishamonKikko: PatternDef = {
  id: 'bishamon-kikko',
  name: 'Bishamon-kikkō',
  family: 'japanese',
  tags: ['hexagon', 'trefoil', 'kikko', 'japanese', 'wagara', 'crest'],
  blurb: 'Tortoise-shell hexagons banded three at a time into a trefoil — Bishamonten\'s armour crest.',
  ops: ['score', 'engrave', 'cut'],
  params: [SIZE(7.5, 3, 60, 'Hexagon size'), GAP(1.8)],
  cell: (p) => ({ w: 3 * num(p, 'size'), h: num(p, 'size') * SQRT3 }),
  tile: (p) => {
    const s = num(p, 'size');
    const R = s / SQRT3;
    const d = Math.min(num(p, 'gap'), s / 2) / 2;
    const holes: Island[] = [];
    const lines: Polyline[] = [];
    // The two trefoils of the cell: one centred, one on the corner.
    for (const [vx, vy] of [[(3 * s) / 2, (s * SQRT3) / 2], [3 * s, s * SQRT3]] as Pt[]) {
      const c0: Pt = [vx - s / 2, vy - (s * SQRT3) / 6];
      const centres: Pt[] = [c0, [c0[0] + s, c0[1]], [c0[0] + s / 2, c0[1] + (s * SQRT3) / 2]];
      const v: Pt = [vx, vy];
      const corner = (i: number, k: number): Pt => {
        const c = centres[i]!;
        const a = HEX_ANGLES[k]!;
        return [c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)];
      };
      // Walking the union: each hexagon gives up the two edges it shares, leaving four apiece.
      const order: [number, number][] = [
        [0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
        [1, 4], [1, 5], [1, 0], [1, 1],
        [2, 0], [2, 1], [2, 2],
      ];
      // The three junctions between one hexagon's run and the next are reflex (240°) and bisect
      // toward the shared vertex; the other nine are ordinary 120° hexagon corners.
      const reflex = new Set(['0,1', '0,5', '1,1']);
      const ring: Ring = order.map(([i, k]) => {
        const q = corner(i, k);
        const t: Pt = reflex.has(`${i},${k}`) ? v : centres[i]!;
        const f = (2 * d) / SQRT3 / R;
        return [q[0] + (t[0] - q[0]) * f, q[1] + (t[1] - q[1]) * f];
      });
      holes.push([ring]);
      // The three swallowed edges, trimmed back to the inset outline.
      const arm = R - (2 * d) / SQRT3;
      for (const deg of [30, 150, 270]) {
        const a = (deg * Math.PI) / 180;
        lines.push(seg(v, [v[0] + arm * Math.cos(a), v[1] + arm * Math.sin(a)]));
      }
    }
    return { holes, lines, slits: [] };
  },
  web: (p) => Math.min(num(p, 'gap'), num(p, 'size') / 2),
};

// ---------------------------------------------------------------------------------------------
// Kikkō-hanabishi (亀甲花菱) — the tortoise shell with a hanabishi, the four-petal diamond
// flower, sitting in every hexagon. Each petal is a rhombus running from the hex centre out to a
// point; the pointy-top hexagon is taller than it is wide, so the vertical pair reaches the
// circumradius and the horizontal pair the inradius. Lines throughout — nothing to cut.
export const kikkoHanabishi: PatternDef = {
  id: 'kikko-hanabishi',
  name: 'Kikkō-hanabishi',
  family: 'japanese',
  tags: ['lines', 'hexagon', 'flower', 'kikko', 'japanese', 'wagara'],
  blurb: 'A four-petal diamond flower in the belly of every tortoise-shell hexagon.',
  ops: ['score', 'engrave'],
  params: [
    SIZE(14, 5, 80, 'Hexagon size'),
    number('flower', 'Flower size', 0.78, 0.3, 1, 0.02, '×'),
    number('petal', 'Petal width', 0.36, 0.1, 0.8, 0.02, '×'),
  ],
  cell: (p) => ({ w: num(p, 'size'), h: num(p, 'size') * SQRT3 }),
  tile: (p) => {
    const s = num(p, 'size');
    const f = num(p, 'flower');
    const k = num(p, 'petal');
    const lines: Polyline[] = [];
    for (const [cx, cy] of [[s / 2, (s * SQRT3) / 2], [0, 0]] as Pt[]) {
      lines.push(closed(hexagon(cx, cy, s)));
      const lv = f * (s / SQRT3);
      const lh = f * (s / 2);
      // Four rhombus petals: tip out, tail on the flower's centre.
      for (const [ux, uy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as Pt[]) {
        const L = ux === 0 ? lv : lh;
        const halfW = (k * L) / 2;
        lines.push(closed([
          [cx, cy],
          [cx + (ux * L) / 2 - uy * halfW, cy + (uy * L) / 2 + ux * halfW],
          [cx + ux * L, cy + uy * L],
          [cx + (ux * L) / 2 + uy * halfW, cy + (uy * L) / 2 - ux * halfW],
        ]));
      }
    }
    return linesOnly(lines);
  },
};

// ---------------------------------------------------------------------------------------------
// Tatewaku (立涌) — rising steam. A band whose two edges swell away from each other and then
// pinch back: half-width W/2 + A·cos(2πy/λ), mirrored about the band's axis. Every band runs in
// phase, which is what makes the gaps between them bulge where the bands pinch — draw the bands
// in antiphase instead and the gaps come out dead straight, which is the usual way to get this
// pattern wrong.
export const tatewaku: PatternDef = {
  id: 'tatewaku',
  name: 'Tatewaku (rising steam)',
  family: 'japanese',
  tags: ['lines', 'wavy', 'bands', 'steam', 'japanese', 'wagara'],
  blurb: 'Pairs of wavy verticals swelling apart and pinching back — tatewaku, rising steam.',
  ops: ['score', 'engrave'],
  params: [
    number('width', 'Band width', 9, 2, 60),
    number('wavelength', 'Swell period', 20, 4, 120),
    number('amplitude', 'Swell', 3, 0.2, 20, 0.1),
  ],
  cell: (p) => ({ w: 2 * num(p, 'width'), h: num(p, 'wavelength') }),
  tile: (p) => {
    const W = num(p, 'width');
    const L = num(p, 'wavelength');
    const A = Math.min(num(p, 'amplitude'), W / 2 - 0.1);
    const n = Math.max(16, Math.ceil(L / 0.5));
    const edge = (sign: number): Polyline => {
      const out: Polyline = [];
      for (let i = 0; i <= n; i++) {
        const y = (L * i) / n;
        out.push([W + sign * (W / 2 + A * Math.cos((2 * Math.PI * (y - L / 2)) / L)), y]);
      }
      return out;
    };
    return linesOnly([edge(-1), edge(1)]);
  },
};

// ---------------------------------------------------------------------------------------------
// Uroko (鱗) — fish scales: the only proper two-colouring of the triangular tiling, which is
// every up-pointing triangle filled and every down-pointing one left bare. Engrave or score
// only. Cut it and the "web" is a row of points: two filled triangles meet at a vertex and
// nowhere else, so every scale would hang on a corner the kerf eats first. `triangles`, which
// carries a real gap on all four sides, is the cuttable relative.
export const uroko: PatternDef = {
  id: 'uroko',
  name: 'Uroko (fish scales)',
  family: 'japanese',
  tags: ['engrave', 'triangles', 'scales', 'japanese', 'wagara'],
  blurb: 'Every other triangle filled — uroko, the fish-scale check that wards off bad luck.',
  ops: ['engrave', 'score'],
  params: [SIZE(11, 3, 80, 'Scale width'), number('gap', 'Groove', 0, 0, 10, 0.1, 'mm', 'A groove round each scale. Zero is the traditional look, where scales touch corner to corner.')],
  cell: (p) => ({ w: num(p, 'size'), h: num(p, 'size') * SQRT3 }),
  tile: (p) => {
    const a = num(p, 'size');
    const g = num(p, 'gap');
    const h = (a * SQRT3) / 2;
    const rIn = a / (2 * SQRT3);
    const k = Math.max(0.05, (rIn - g / 2) / rIn);
    const scale = (pts: Ring): Ring => (g > 0 ? shrinkRing(pts, k) : pts);
    return holesOnly([
      scale([[0, 0], [a, 0], [a / 2, h]]),
      scale([[a / 2, h], [(3 * a) / 2, h], [a, 2 * h]]),
    ]);
  },
  web: (p) => num(p, 'gap'),
};

// ---------------------------------------------------------------------------------------------
// Hishi-yotsu (四つ割菱) — the quartered diamond crest, tiled. A rhombus splits into four
// half-scale rhombi exactly, so the grouping only reads if the gap between groups is wider than
// the gap inside one: shrink the big diamond by `group`, then each quarter by `gap`.
export const hishiYotsu: PatternDef = {
  id: 'hishi-yotsu',
  name: 'Hishi-yotsu (quartered diamond)',
  family: 'japanese',
  tags: ['holes', 'diamond', 'rhombus', 'hishi', 'japanese', 'wagara', 'crest'],
  blurb: 'Four small diamonds packed into a big one — the quartered-hishi crest as an all-over.',
  ops: ['cut', 'engrave', 'score'],
  params: [
    number('width', 'Diamond width', 16, 5, 90),
    number('ratio', 'Height ÷ width', 1.45, 0.4, 3, 0.05, ''),
    GAP(1.6),
    number('group', 'Gap between groups', 3, 0.2, 20, 0.1),
  ],
  cell: (p) => ({ w: num(p, 'width'), h: num(p, 'width') * num(p, 'ratio') }),
  tile: (p) => {
    const w = num(p, 'width');
    const h = w * num(p, 'ratio');
    const g1 = num(p, 'gap');
    const g2 = num(p, 'group');
    const rBig = (w * h) / (2 * Math.hypot(w, h));
    const kBig = Math.max(0.1, (rBig - g2 / 2) / rBig);
    const W = kBig * w;
    const H = kBig * h;
    const rSmall = (rBig * kBig) / 2;
    const kSmall = Math.max(0.1, (rSmall - g1 / 2) / rSmall);
    const quarter = (cx: number, cy: number): Ring =>
      shrinkRing([[cx, cy - H / 4], [cx + W / 4, cy], [cx, cy + H / 4], [cx - W / 4, cy]], kSmall);
    const group = (cx: number, cy: number): Ring[] => [
      quarter(cx + W / 4, cy),
      quarter(cx - W / 4, cy),
      quarter(cx, cy + H / 4),
      quarter(cx, cy - H / 4),
    ];
    return holesOnly([...group(w / 2, h / 2), ...group(0, 0)]);
  },
  web: (p) => Math.min(num(p, 'gap'), num(p, 'group')),
};

// ---------------------------------------------------------------------------------------------
// Asanoha-in-hex — the kumiko infill: one complete hemp-leaf star inside every kikkō hexagon
// instead of asanoha's endless lattice. The hexagon is cut into its six triangles and each gets
// the asanoha treatment (centroid joined to all three corners), so the star closes at the hex
// centre and stops at the hexagon's edge, which is how a shoji panel is actually divided.
export const asanohaInHex: PatternDef = {
  id: 'asanoha-in-hex',
  name: 'Asanoha in hex (kumiko)',
  family: 'japanese',
  tags: ['lines', 'hexagon', 'asanoha', 'kumiko', 'japanese', 'shoji'],
  blurb: 'One whole hemp-leaf star per tortoise-shell hexagon — the kumiko infill, not the endless lattice.',
  ops: ['score', 'engrave'],
  params: [SIZE(16, 5, 90, 'Hexagon size')],
  cell: (p) => ({ w: num(p, 'size'), h: num(p, 'size') * SQRT3 }),
  tile: (p) => {
    const s = num(p, 'size');
    const R = s / SQRT3;
    const lines: Polyline[] = [];
    for (const [cx, cy] of [[s / 2, (s * SQRT3) / 2], [0, 0]] as Pt[]) {
      const v: Pt[] = HEX_ANGLES.map((a): Pt => [cx + R * Math.cos(a), cy + R * Math.sin(a)]);
      lines.push(closed(v));
      for (let i = 0; i < 6; i++) {
        const a = v[i]!;
        const b = v[(i + 1) % 6]!;
        lines.push(seg([cx, cy], a));
        const gx = (cx + a[0] + b[0]) / 3;
        const gy = (cy + a[1] + b[1]) / 3;
        lines.push(seg([gx, gy], [cx, cy]), seg([gx, gy], a), seg([gx, gy], b));
      }
    }
    return linesOnly(lines);
  },
};

// ---------------------------------------------------------------------------------------------
// Kaku-asa (角麻) — asanoha's construction moved onto a square lattice: join every cell's centre
// to its corners, exactly as asanoha joins every triangle's centroid to its vertices. On squares
// the spokes line up across neighbours into full diagonals, so the star at each lattice point is
// four-fold rather than asanoha's six, and eight rays counting the grid itself.
export const kakuAsa: PatternDef = {
  id: 'kaku-asa',
  name: 'Kaku-asa (square hemp leaf)',
  family: 'japanese',
  tags: ['lines', 'squares', 'asanoha', 'kumiko', 'japanese', 'shoji'],
  blurb: 'Asanoha rebuilt on squares: every cell crossed corner to corner, an eight-ray star at each junction.',
  ops: ['score', 'engrave'],
  params: [SIZE(9, 2, 60, 'Cell size')],
  cell: (p) => ({ w: num(p, 'size'), h: num(p, 'size') }),
  tile: (p) => {
    const g = num(p, 'size');
    return linesOnly([seg([0, 0], [g, 0]), seg([0, 0], [0, g]), seg([0, 0], [g, g]), seg([g, 0], [0, g])]);
  },
};

export const JAPANESE: PatternDef[] = [
  sayagata,
  yagasuri,
  bishamonKikko,
  kikkoHanabishi,
  tatewaku,
  uroko,
  hishiYotsu,
  asanohaInHex,
  kakuAsa,
];

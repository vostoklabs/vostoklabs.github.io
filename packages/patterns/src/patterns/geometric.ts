// Closed-shape lattices: the patterns that CUT OUT (each shape a hole, the web between them a
// parameter) and, unchanged, engrave as fills or score as outlines.
//
// Every one of these places its motif on a cell whose centre is the motif's centre, so a
// centred fill puts one motif dead on the region's centre — a coaster gets a hole in the
// middle, not a web.
import { SQRT3, circle, hexagon, regularPolygon, roundedRect, shrinkRing, slot, star } from '../geom';
import { GAP, SIZE, bool, num, number, toggle } from '../params';
import type { Island, PatternDef, PatternGeometry, Params, Ring } from '../types';

const holesOnly = (holes: Ring[]): PatternGeometry => ({ holes: holes.map((r): Island => [r]), lines: [], slits: [] });

/** Square lattice or hex packing of one motif drawn by `motif(cx, cy)`, pitch `p`. */
function packed(p: Params, pitch: number, motif: (cx: number, cy: number) => Ring): { cell: { w: number; h: number }; tile: PatternGeometry } {
  if (bool(p, 'stagger')) {
    const h = pitch * SQRT3;
    return { cell: { w: pitch, h }, tile: holesOnly([motif(pitch / 2, h / 2), motif(0, 0)]) };
  }
  return { cell: { w: pitch, h: pitch }, tile: holesOnly([motif(pitch / 2, pitch / 2)]) };
}

export const dots: PatternDef = {
  id: 'dots',
  name: 'Dots',
  family: 'geometric',
  tags: ['holes', 'perforated', 'grille', 'polka'],
  blurb: 'Round holes on a grid or in a honeycomb pack — a speaker grille, a perforated panel, polka dots.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(4, 1, 40, 'Hole size'), GAP(2), toggle('stagger', 'Stagger rows', true, 'Rows offset by half a pitch pack tighter and read as a honeycomb.')],
  cell: (p) => packed(p, num(p, 'size') + num(p, 'gap'), () => []).cell,
  tile: (p) => {
    const d = num(p, 'size');
    return packed(p, d + num(p, 'gap'), (cx, cy) => circle(cx, cy, d / 2)).tile;
  },
  web: (p) => num(p, 'gap'),
};

export const squares: PatternDef = {
  id: 'squares',
  name: 'Squares',
  family: 'geometric',
  tags: ['holes', 'grid', 'lattice', 'window'],
  blurb: 'Square holes with softened corners — a lattice screen, a window grille.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(6, 1, 60), GAP(2), number('corner', 'Corner radius', 1, 0, 20, 0.25), toggle('stagger', 'Stagger rows', false)],
  cell: (p) => packed(p, num(p, 'size') + num(p, 'gap'), () => []).cell,
  tile: (p) => {
    const s = num(p, 'size');
    return packed(p, s + num(p, 'gap'), (cx, cy) => roundedRect(cx, cy, s, s, num(p, 'corner'))).tile;
  },
  web: (p) => num(p, 'gap'),
};

export const diamonds: PatternDef = {
  id: 'diamonds',
  name: 'Diamonds',
  family: 'geometric',
  tags: ['holes', 'rhombus', 'lattice', 'argyle', 'hishi'],
  blurb: 'A field of diamond holes — the harlequin lattice; taller than wide is hishi, the Japanese water-chestnut diamond.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(8, 2, 60, 'Width'), number('ratio', 'Height ÷ width', 1.4, 0.4, 3, 0.05, ''), GAP(2)],
  cell: (p) => ({ w: num(p, 'size') + num(p, 'gap') * 0, h: num(p, 'size') * num(p, 'ratio') }),
  tile: (p) => {
    const w = num(p, 'size');
    const h = w * num(p, 'ratio');
    const g = num(p, 'gap');
    // The lattice rhombus is (w, h); the hole is it shrunk so the web between neighbours is g.
    const rIn = (w * h) / (2 * Math.hypot(w, h));
    const k = Math.max(0.05, (rIn - g / 2) / rIn);
    const rhombus = (cx: number, cy: number): Ring => shrinkRing([[cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy]], k);
    return holesOnly([rhombus(w / 2, h / 2), rhombus(0, 0)]);
  },
  web: (p) => num(p, 'gap'),
};

export const honeycomb: PatternDef = {
  id: 'honeycomb',
  name: 'Honeycomb',
  family: 'geometric',
  tags: ['holes', 'hexagon', 'hex', 'kikko', 'vent'],
  blurb: 'Hexagonal holes leaving a honeycomb web — the classic vent panel and lamp shade.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(8, 2, 80, 'Hole size'), GAP(2)],
  cell: (p) => {
    const pitch = num(p, 'size') + num(p, 'gap');
    return { w: pitch, h: pitch * SQRT3 };
  },
  tile: (p) => {
    const s = num(p, 'size');
    const pitch = s + num(p, 'gap');
    return holesOnly([hexagon(pitch / 2, (pitch * SQRT3) / 2, s), hexagon(0, 0, s)]);
  },
  web: (p) => num(p, 'gap'),
};

export const triangles: PatternDef = {
  id: 'triangles',
  name: 'Triangles',
  family: 'geometric',
  tags: ['holes', 'triangle', 'lattice', 'uroko'],
  blurb: 'Triangles pointing up and down in turn — the uroko fish-scale lattice when engraved, a triangle grille when cut.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(10, 2, 80, 'Side'), GAP(2)],
  cell: (p) => {
    const a = num(p, 'size') + num(p, 'gap') * SQRT3;
    return { w: a, h: a * SQRT3 };
  },
  tile: (p) => {
    const g = num(p, 'gap');
    const a = num(p, 'size') + g * SQRT3;
    const h = (a * SQRT3) / 2;
    const k = num(p, 'size') / a;
    const tri = (pts: Ring): Ring => shrinkRing(pts, k);
    return holesOnly([
      tri([[0, 0], [a, 0], [a / 2, h]]),
      tri([[a / 2, h], [a, 0], [(3 * a) / 2, h]]),
      tri([[a / 2, h], [(3 * a) / 2, h], [a, 2 * h]]),
      tri([[0, 2 * h], [a / 2, h], [a, 2 * h]]),
    ]);
  },
  web: (p) => num(p, 'gap'),
};

function bond(p: Params, corner: number): { cell: { w: number; h: number }; tile: PatternGeometry } {
  const L = num(p, 'length');
  const H = num(p, 'height');
  const g = num(p, 'gap');
  const w = L + g;
  const h = H + g;
  const brick = (cx: number, cy: number) => roundedRect(cx, cy, L, H, corner);
  return { cell: { w, h: 2 * h }, tile: holesOnly([brick(w / 2, h / 2), brick(0, (3 * h) / 2)]) };
}

export const bricks: PatternDef = {
  id: 'bricks',
  name: 'Bricks',
  family: 'geometric',
  tags: ['holes', 'running bond', 'brick', 'wall'],
  blurb: 'Rectangles in running bond — a brick wall engraved, a staggered slot screen cut.',
  ops: ['cut', 'engrave', 'score'],
  params: [number('length', 'Length', 12, 2, 80), number('height', 'Height', 6, 1, 40), GAP(2), number('corner', 'Corner radius', 0.5, 0, 10, 0.25)],
  cell: (p) => bond(p, 0).cell,
  tile: (p) => bond(p, num(p, 'corner')).tile,
  web: (p) => num(p, 'gap'),
};

export const slots: PatternDef = {
  id: 'slots',
  name: 'Slots',
  family: 'geometric',
  tags: ['holes', 'grille', 'vent', 'speaker'],
  blurb: 'Staggered rounded slots — the speaker grille and the ventilation panel.',
  ops: ['cut', 'engrave', 'score'],
  params: [number('length', 'Length', 10, 2, 80), number('height', 'Width', 3, 0.8, 30, 0.1), GAP(2)],
  cell: (p) => bond(p, 0).cell,
  tile: (p) => bond(p, num(p, 'height') / 2).tile,
  web: (p) => num(p, 'gap'),
};

export const crosses: PatternDef = {
  id: 'crosses',
  name: 'Crosses',
  family: 'geometric',
  tags: ['holes', 'plus', 'cross', 'lattice'],
  blurb: 'Plus-shaped holes on a grid — a Moroccan-flavoured screen.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(8, 2, 60), number('arm', 'Arm width', 2.5, 0.5, 30, 0.25), GAP(2), toggle('stagger', 'Stagger rows', true)],
  cell: (p) => packed(p, num(p, 'size') + num(p, 'gap'), () => []).cell,
  tile: (p) => {
    const s = num(p, 'size');
    const a = Math.min(num(p, 'arm'), s);
    const plus = (cx: number, cy: number): Ring => [
      [cx - a / 2, cy - s / 2], [cx + a / 2, cy - s / 2], [cx + a / 2, cy - a / 2], [cx + s / 2, cy - a / 2],
      [cx + s / 2, cy + a / 2], [cx + a / 2, cy + a / 2], [cx + a / 2, cy + s / 2], [cx - a / 2, cy + s / 2],
      [cx - a / 2, cy + a / 2], [cx - s / 2, cy + a / 2], [cx - s / 2, cy - a / 2], [cx - a / 2, cy - a / 2],
    ];
    return packed(p, s + num(p, 'gap'), plus).tile;
  },
  web: (p) => num(p, 'gap'),
};

export const stars: PatternDef = {
  id: 'stars',
  name: 'Stars',
  family: 'geometric',
  tags: ['holes', 'star', 'night', 'christmas'],
  blurb: 'A sky of star-shaped holes.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(8, 2, 60), number('points', 'Points', 5, 3, 12, 1, ''), number('inner', 'Inner radius', 0.45, 0.2, 0.9, 0.05, '×'), GAP(2), toggle('stagger', 'Stagger rows', true)],
  cell: (p) => packed(p, num(p, 'size') + num(p, 'gap'), () => []).cell,
  tile: (p) => {
    const s = num(p, 'size');
    return packed(p, s + num(p, 'gap'), (cx, cy) => star(cx, cy, Math.round(num(p, 'points')), s / 2, (s / 2) * num(p, 'inner'))).tile;
  },
  web: (p) => num(p, 'gap'),
};

export const octagons: PatternDef = {
  id: 'octagons',
  name: 'Octagons & squares',
  family: 'geometric',
  tags: ['holes', 'octagon', 'tiles', 'floor'],
  blurb: 'Octagon holes with a small square hole between — the Victorian floor tile.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(10, 2, 80, 'Octagon size'), GAP(2)],
  cell: (p) => {
    const pitch = num(p, 'size') + num(p, 'gap');
    return { w: pitch, h: pitch };
  },
  tile: (p) => {
    const s = num(p, 'size');
    const g = num(p, 'gap');
    const pitch = s + g;
    // A regular octagon across flats s: circumradius s / (2 cos 22.5°). The square between four
    // octagons has a diagonal equal to the octagon's gap-side length.
    const r = s / (2 * Math.cos(Math.PI / 8));
    const side = 2 * r * Math.sin(Math.PI / 8);
    const sq = Math.max(0, side - g * SQRT3 * 0) ;
    const half = Math.max(0.2, sq / 2 - g / 2);
    return holesOnly([
      regularPolygon(pitch / 2, pitch / 2, r, 8, Math.PI / 8),
      [[0, -half], [half, 0], [0, half], [-half, 0]],
    ]);
  },
  web: (p) => num(p, 'gap'),
};

export const checkerboard: PatternDef = {
  id: 'checkerboard',
  name: 'Checkerboard',
  family: 'geometric',
  tags: ['engrave', 'ichimatsu', 'chess', 'squares'],
  blurb: 'Alternate squares filled — ichimatsu, the Japanese checkerboard. An engrave; cut, the squares would only touch at their corners.',
  ops: ['engrave', 'score'],
  params: [SIZE(6, 1, 60)],
  cell: (p) => ({ w: 2 * num(p, 'size'), h: 2 * num(p, 'size') }),
  tile: (p) => {
    const s = num(p, 'size');
    const sq = (cx: number, cy: number): Ring => [[cx - s / 2, cy - s / 2], [cx + s / 2, cy - s / 2], [cx + s / 2, cy + s / 2], [cx - s / 2, cy + s / 2]];
    return holesOnly([sq(s / 2, s / 2), sq((3 * s) / 2, (3 * s) / 2)]);
  },
};

export const GEOMETRIC: PatternDef[] = [dots, honeycomb, squares, diamonds, triangles, slots, bricks, crosses, stars, octagons, checkerboard];

// Used by the slot-shaped hinge and radial slots as well.
export { slot };

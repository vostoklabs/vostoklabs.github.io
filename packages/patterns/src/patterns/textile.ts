// Textile and ornament: the fills a laser gets asked for by their cloth names — parquet,
// basketweave, dogtooth, argyle, gingham — plus the three ornament lattices that share their
// logic (ogee, quatrefoil, scallop) and the two that are really just joints drawn in (chain,
// brick mortar).
//
// Each one is the real construction, not a lookalike: herringbone is rectangular planks at ±45°
// on the lattice they actually tile on, houndstooth is the fourteen-point dogtooth polygon, and
// ogee's S-curves are arcs shared edge for edge with the neighbour.
import { rect, roundedRect, seg } from '../geom';
import { GAP, SIZE, SPACING, num, number } from '../params';
import type { Island, PatternDef, PatternGeometry, Polyline, Pt, Ring } from '../types';

const linesOnly = (lines: Polyline[]): PatternGeometry => ({ holes: [], lines, slits: [] });
const closed = (ring: Pt[]): Polyline => [...ring, ring[0]!];
const holesOnly = (holes: Ring[]): PatternGeometry => ({ holes: holes.map((r): Island => [r]), lines: [], slits: [] });

/** A rectangle turned about its own centre — the one primitive parquet needs. */
function turnedRect(cx: number, cy: number, w: number, h: number, deg: number): Ring {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return rect(0, 0, w, h).map(([x, y]): Pt => [cx + x * c - y * s, cy + x * s + y * c]);
}

interface Circ {
  ox: number;
  oy: number;
  r: number;
}

/** The circle of the arc from p to q that bows `sag` mm clear of the chord, always toward −y.
 *  Which way it bows follows from the chord's direction and nothing else, so two tiles sharing
 *  an edge bow it the same way and still meet along it. */
function bowCircle(p: Pt, q: Pt, sag: number): Circ | null {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const c = Math.hypot(dx, dy);
  if (c < 1e-9 || sag < 1e-6) return null;
  const s = Math.min(sag, 0.45 * c);
  let nx = -dy / c;
  let ny = dx / c;
  if (ny > 0 || (Math.abs(ny) < 1e-12 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  const r = (s * s + (c * c) / 4) / (2 * s);
  return { ox: (p[0] + q[0]) / 2 + nx * (s - r), oy: (p[1] + q[1]) / 2 + ny * (s - r), r };
}

/** Where two circles cross, taking the crossing nearest `hint`. */
function meet(a: Circ, b: Circ, hint: Pt): Pt | null {
  const dx = b.ox - a.ox;
  const dy = b.oy - a.oy;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9 || d > a.r + b.r || d < Math.abs(a.r - b.r)) return null;
  const t = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const hsq = a.r * a.r - t * t;
  if (hsq < 0) return null;
  const hh = Math.sqrt(hsq);
  const mx = a.ox + (t * dx) / d;
  const my = a.oy + (t * dy) / d;
  const p1: Pt = [mx + (hh * dy) / d, my - (hh * dx) / d];
  const p2: Pt = [mx - (hh * dy) / d, my + (hh * dx) / d];
  return Math.hypot(p1[0] - hint[0], p1[1] - hint[1]) <= Math.hypot(p2[0] - hint[0], p2[1] - hint[1]) ? p1 : p2;
}

/** The short way round `c` from p to q, sampled. */
function arcRun(c: Circ, p: Pt, q: Pt): Pt[] {
  const a0 = Math.atan2(p[1] - c.oy, p[0] - c.ox);
  let span = Math.atan2(q[1] - c.oy, q[0] - c.ox) - a0;
  while (span > Math.PI) span -= 2 * Math.PI;
  while (span < -Math.PI) span += 2 * Math.PI;
  const steps = Math.max(4, Math.ceil((Math.abs(span) * c.r) / 0.4));
  const out: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const t = a0 + (span * i) / steps;
    out.push([c.ox + c.r * Math.cos(t), c.oy + c.r * Math.sin(t)]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Herringbone — real parquet: L × w rectangular planks, no shearing. Laid square, the planks
// tile on the lattice ⟨(−w, w), (2L, 0)⟩, which is only rectangular for a whole number of plank
// widths; turn the whole floor 45° and that lattice collapses to a plain w√2 × L√2 cell holding
// exactly two planks, one at +45° and one at +135°, offset by half the cell each way. Lines
// only — cut, a parquet is a bag of loose planks.
export const herringbone: PatternDef = {
  id: 'herringbone',
  name: 'Herringbone',
  family: 'textile',
  tags: ['lines', 'parquet', 'planks', 'floor', 'chevron', 'weave'],
  blurb: 'Rectangular planks butted end to side at ±45° — the parquet floor, drawn as its joints.',
  ops: ['score', 'engrave'],
  params: [
    number('width', 'Plank width', 6, 1, 40),
    number('ratio', 'Length ÷ width', 2, 2, 6, 1, '', 'Whole numbers only — 2 and 3 are the classic parquets, and a fraction would not tile.'),
  ],
  cell: (p) => {
    const w = num(p, 'width');
    return { w: w * Math.SQRT2, h: Math.round(num(p, 'ratio')) * w * Math.SQRT2 };
  },
  tile: (p) => {
    const w = num(p, 'width');
    const L = Math.round(num(p, 'ratio')) * w;
    const cw = w * Math.SQRT2;
    const ch = L * Math.SQRT2;
    return linesOnly([
      closed(turnedRect(cw / 2, ch / 2, L, w, 45)),
      closed(turnedRect(0, 0, L, w, 135)),
    ]);
  },
};

// ---------------------------------------------------------------------------------------------
// Basketweave — pairs of slats, 2s long and s wide, laid two to a block, with the blocks
// alternating horizontal and vertical on a checkerboard: a 4s × 4s super-cell of four blocks.
// The groove is a real gap on every side, so this one cuts as well as it engraves.
export const basketweave: PatternDef = {
  id: 'basketweave',
  name: 'Basketweave',
  family: 'textile',
  tags: ['holes', 'weave', 'wicker', 'slats', 'parquet'],
  blurb: 'Slats in pairs, every block turned across its neighbour — the over-under of a woven basket.',
  ops: ['engrave', 'score', 'cut'],
  params: [SIZE(6, 1.5, 40, 'Slat width'), GAP(1.6)],
  cell: (p) => {
    const s = 4 * num(p, 'size');
    return { w: s, h: s };
  },
  tile: (p) => {
    const s = num(p, 'size');
    const g = Math.min(num(p, 'gap'), s * 0.8);
    const lengthways = (cx: number, cy: number): Ring[] => [
      rect(cx, cy - s / 2, 2 * s - g, s - g),
      rect(cx, cy + s / 2, 2 * s - g, s - g),
    ];
    const upright = (cx: number, cy: number): Ring[] => [
      rect(cx - s / 2, cy, s - g, 2 * s - g),
      rect(cx + s / 2, cy, s - g, 2 * s - g),
    ];
    return holesOnly([
      ...lengthways(s, s),
      ...upright(3 * s, s),
      ...upright(s, 3 * s),
      ...lengthways(3 * s, 3 * s),
    ]);
  },
  web: (p) => Math.min(num(p, 'gap'), num(p, 'size') * 0.8),
};

// ---------------------------------------------------------------------------------------------
// Houndstooth — the dogtooth proper, not a sheared check. One motif per 4u × 4u repeat, a
// fourteen-vertex polygon of exactly half the cell's area, so the light ground is the same shape
// turned through 180°. Engrave or score only: neighbouring teeth meet at their points and
// nowhere else, so a cut would hang every tooth on a corner.
const TOOTH: Pt[] = [
  [2, 4], [2, 5], [3, 4], [4, 4], [6, 2], [5, 2], [4, 3],
  [4, 2], [3, 2], [4, 1], [4, 0], [2, 2], [2, 3], [1, 4],
];

export const houndstooth: PatternDef = {
  id: 'houndstooth',
  name: 'Houndstooth',
  family: 'textile',
  tags: ['engrave', 'dogtooth', 'pied-de-poule', 'check', 'tweed'],
  blurb: 'The four-pointed dogtooth, interlocking point to point — houndstooth, half dark and half light by construction.',
  ops: ['engrave', 'score'],
  params: [SIZE(13, 4, 80, 'Repeat')],
  cell: (p) => {
    const s = num(p, 'size');
    return { w: s, h: s };
  },
  tile: (p) => {
    const u = num(p, 'size') / 4;
    // The motif's own bounding box spans 5u × 5u; slide it so that box sits on the cell's centre.
    const ox = (2 - 3.5) * u;
    const oy = (2 - 2.5) * u;
    return holesOnly([TOOTH.map(([x, y]): Pt => [x * u + ox, y * u + oy])]);
  },
};

// ---------------------------------------------------------------------------------------------
// Argyle — the diamond lattice two-toned, plus the thin over-lines. Alternate rhombi of a
// rhombic tiling are exactly the two rhombi of one w × h cell, so engraving the centred one and
// leaving the corner one bare gives the check with no extra bookkeeping; the over-lines run
// parallel to the rhombus edges through every rhombus centre, which is where argyle crosses them.
export const argyle: PatternDef = {
  id: 'argyle',
  name: 'Argyle',
  family: 'textile',
  tags: ['engrave', 'diamond', 'rhombus', 'check', 'knit', 'tartan'],
  blurb: 'Two-tone diamonds with thin lines crossing at their centres — the golf-sock argyle.',
  ops: ['engrave', 'score'],
  params: [number('width', 'Diamond width', 13, 5, 90), number('ratio', 'Height ÷ width', 1.5, 0.5, 3, 0.05, '')],
  cell: (p) => ({ w: num(p, 'width'), h: num(p, 'width') * num(p, 'ratio') }),
  tile: (p) => {
    const w = num(p, 'width');
    const h = w * num(p, 'ratio');
    const diamond: Ring = [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
    return {
      holes: [[diamond]],
      lines: [seg([0, 0], [w, h]), seg([w, 0], [0, h])],
      slits: [],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Gingham — two stripe sets crossing, which on cloth gives three tones: ground, single stripe,
// and the crossing where both threads land. A laser has one tone per pass, so the decision here
// is to get all three in one: FILL the crossings solid and rule the single-stripe bands with a
// few hairlines, which burn as a mid grey. The band edges are the outer two rules, so a host
// that would rather do two passes at two powers has them already.
export const gingham: PatternDef = {
  id: 'gingham',
  name: 'Gingham',
  family: 'textile',
  tags: ['engrave', 'check', 'stripes', 'plaid', 'picnic'],
  blurb: 'Stripes crossing stripes: the crossings solid, the single stripes ruled — three tones in one pass.',
  ops: ['engrave', 'score'],
  params: [
    SPACING(9, 2, 60),
    number('stripe', 'Stripe width', 0.5, 0.15, 0.85, 0.05, '×'),
    number('rules', 'Rules per stripe', 4, 2, 10, 1, '', 'Hairlines across each single-stripe band — more rules, darker mid tone.'),
  ],
  cell: (p) => {
    const s = num(p, 'spacing');
    return { w: s, h: s };
  },
  tile: (p) => {
    const s = num(p, 'spacing');
    const t = s * num(p, 'stripe');
    const n = Math.max(2, Math.round(num(p, 'rules')));
    const lines: Polyline[] = [];
    for (let i = 0; i < n; i++) {
      const u = s / 2 - t / 2 + (t * i) / (n - 1);
      lines.push(seg([u, 0], [u, s]), seg([0, u], [s, u]));
    }
    return { holes: [[rect(s / 2, s / 2, t, t)]], lines, slits: [] };
  },
  web: (p) => num(p, 'spacing') * (1 - num(p, 'stripe')),
};

// ---------------------------------------------------------------------------------------------
// Ogee — the onion-dome lattice. Take the rhombic tiling and bow each of the four edges the same
// way, always toward −y: the two lower edges then bulge out of the tile and the two upper ones
// bulge into it, so each side reads convex from the foot, inflects at the widest point and
// closes concave on a spire — the ogee arch, not a fish scale. Because every edge is bowed by
// its direction alone, the neighbour bows the shared edge identically and the tiles still meet.
//
// `gap` is a real offset, not a shrink: each arc is replaced by the concentric one half a gap
// further into the tile, and the corners are put back where consecutive offset circles cross.
// Scaling the tile about its centre would look the same and lie about the web — the two arcs
// either side of a shared edge would end up sliding along it as well as apart, and come out a
// third closer than asked.
export const ogee: PatternDef = {
  id: 'ogee',
  name: 'Ogee',
  family: 'textile',
  tags: ['holes', 'damask', 'onion', 'arches', 'lattice', 'moroccan'],
  blurb: 'Onion domes tiled head to foot — the damask ogee, its S-curves shared edge for edge.',
  ops: ['score', 'engrave', 'cut'],
  params: [
    number('width', 'Tile width', 15, 5, 90),
    number('ratio', 'Height ÷ width', 1.6, 0.6, 3, 0.05, ''),
    number('bulge', 'Bulge', 0.13, 0.02, 0.4, 0.01, '×', 'How far each edge bows, as a fraction of its own length. Past about 0.25 the spire blunts and it starts to read as fish scales.'),
    GAP(1.5),
  ],
  cell: (p) => ({ w: num(p, 'width'), h: num(p, 'width') * num(p, 'ratio') }),
  tile: (p) => {
    const w = num(p, 'width');
    const h = w * num(p, 'ratio');
    const bw = w / 2;
    const bh = h / 2;
    const d = Math.min(num(p, 'gap') / 2, 0.3 * Math.min(bw, bh));
    const sag = num(p, 'bulge') * Math.hypot(bw, bh);
    const v: Pt[] = [[0, -bh], [bw, 0], [0, bh], [-bw, 0]];
    // Each edge's circle, pushed half a gap toward the tile's middle: outward when the middle
    // lies outside that circle, inward when it lies inside.
    const circles = v.map((a, i) => {
      const c = bowCircle(a, v[(i + 1) % 4]!, sag);
      if (!c) return null;
      return { ...c, r: Math.hypot(c.ox, c.oy) > c.r ? c.r + d : c.r - d };
    });
    const corners = v.map((a, i) => (circles[(i + 3) % 4] && circles[i] ? meet(circles[(i + 3) % 4]!, circles[i]!, a) : null));
    const ring: Ring = [];
    for (let i = 0; i < 4; i++) {
      const c = circles[i];
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      if (!c || !a || !b) return holesOnly([]);
      ring.push(...arcRun(c, a, b));
    }
    const at = (cx: number, cy: number): Ring => ring.map(([x, y]): Pt => [x + cx, y + cy]);
    return holesOnly([at(w / 2, h / 2), at(0, 0)]);
  },
  web: (p) => 2 * Math.min(num(p, 'gap') / 2, 0.3 * Math.min(num(p, 'width') / 2, (num(p, 'width') * num(p, 'ratio')) / 2)),
};

// ---------------------------------------------------------------------------------------------
// Quatrefoil — the Moroccan screen: a square with a semicircular lobe on each side, so the lobes
// reach a full square-width clear of the centre and the notches between them stay sharp. Pitched
// at size + gap, the lobes of neighbouring foils face each other across exactly `gap`.
export const quatrefoil: PatternDef = {
  id: 'quatrefoil',
  name: 'Quatrefoil',
  family: 'textile',
  tags: ['holes', 'moroccan', 'trellis', 'clover', 'screen', 'lattice'],
  blurb: 'Four-lobed clover holes on a square pitch — the Moroccan trellis screen.',
  ops: ['cut', 'engrave', 'score'],
  params: [SIZE(11, 4, 90, 'Foil width'), GAP(2)],
  cell: (p) => {
    const s = num(p, 'size') + num(p, 'gap');
    return { w: s, h: s };
  },
  tile: (p) => {
    const size = num(p, 'size');
    const pitch = size + num(p, 'gap');
    const a = size / 2; // the inner square's side; each lobe is a semicircle of radius a/2
    const cx = pitch / 2;
    const cy = pitch / 2;
    const r = a / 2;
    const ring: Ring = [];
    const lobe = (ox: number, oy: number, from: number): void => {
      // Even, so the lobe's tip is a real vertex rather than a chord across it.
      const n = 2 * Math.max(4, Math.ceil((Math.PI * r) / 0.7));
      for (let i = 0; i < n; i++) {
        const t = from + (Math.PI * i) / n;
        ring.push([cx + ox + r * Math.cos(t), cy + oy + r * Math.sin(t)]);
      }
    };
    lobe(a / 2, 0, -Math.PI / 2);
    lobe(0, a / 2, 0);
    lobe(-a / 2, 0, Math.PI / 2);
    lobe(0, -a / 2, Math.PI);
    return holesOnly([ring]);
  },
  web: (p) => num(p, 'gap'),
};

// ---------------------------------------------------------------------------------------------
// Scallops — the single-ring cousin of seigaiha, and the name most people search for. One circle
// per scale on a half-drop lattice, with every part of it that a scale in front would cover
// dropped before it is drawn, so what is left is the shingle arc and nothing else.
export const scallops: PatternDef = {
  id: 'scallops',
  name: 'Scallops',
  family: 'textile',
  tags: ['lines', 'fish scale', 'shingle', 'seigaiha', 'arcs', 'mermaid'],
  blurb: 'One row of fish-scale arcs peeking over the next — seigaiha with a single ring.',
  ops: ['score', 'engrave'],
  params: [SIZE(16, 4, 100, 'Scale width'), number('overlap', 'Row overlap', 0.45, 0.2, 0.9, 0.05, '×')],
  cell: (p) => {
    const R = num(p, 'size') / 2;
    return { w: 2 * R, h: 2 * R * num(p, 'overlap') };
  },
  tile: (p) => {
    const R = num(p, 'size') / 2;
    const v = R * num(p, 'overlap');
    // The scales in front of one at the origin, row by row, until none can reach it any more.
    const front: Pt[] = [];
    for (let j = 1; j * v < 2 * R + 1e-9; j++) {
      const xs = j % 2 ? [-R, R] : [0, -2 * R, 2 * R];
      for (const x of xs) front.push([x, -j * v]);
    }
    const hidden = ([x, y]: Pt): boolean => front.some(([fx, fy]) => Math.hypot(x - fx, y - fy) < R - 1e-6);
    const arcs: Polyline[] = [];
    const steps = Math.max(32, Math.ceil((2 * Math.PI * R) / 0.4));
    let run: Pt[] | null = null;
    for (let i = 0; i <= steps; i++) {
      const t = Math.PI / 2 + (2 * Math.PI * i) / steps;
      const q: Pt = [R * Math.cos(t), R * Math.sin(t)];
      if (hidden(q)) {
        if (run && run.length > 1) arcs.push(run);
        run = null;
      } else (run ??= []).push(q);
    }
    if (run && run.length > 1) arcs.push(run);
    const shifted = arcs.map((a) => a.map(([x, y]): Pt => [x + R, y + v]));
    return linesOnly([...arcs, ...shifted]);
  },
};

// ---------------------------------------------------------------------------------------------
// Chain — links threaded through links. Every lattice point carries the end of one upright link
// and the ends of the two lengthways links either side of it, which is how a flat chain reads;
// each link is drawn as its outer and inner stadium, so the ring has a wall you can see. Lines
// only: the links overlap on purpose, and overlapping outlines are not holes.
export const chain: PatternDef = {
  id: 'chain',
  name: 'Chain',
  family: 'textile',
  tags: ['lines', 'links', 'chainmail', 'rings', 'fence'],
  blurb: 'Oval links threaded end through end — a flat chain mesh.',
  ops: ['score', 'engrave'],
  params: [
    number('size', 'Link length', 14, 5, 90),
    number('width', 'Link width', 7, 2, 50),
    number('thickness', 'Ring wall', 1.4, 0.3, 10, 0.1),
  ],
  cell: (p) => {
    const s = num(p, 'size');
    return { w: s, h: s };
  },
  tile: (p) => {
    const L = num(p, 'size');
    const wd = Math.min(num(p, 'width'), L * 0.9);
    const t = Math.min(num(p, 'thickness'), wd / 2 - 0.15);
    const link = (cx: number, cy: number, upright: boolean): Polyline[] => {
      const outer = upright ? roundedRect(cx, cy, wd, L, wd / 2) : roundedRect(cx, cy, L, wd, wd / 2);
      const iw = wd - 2 * t;
      const il = L - 2 * t;
      const inner = upright ? roundedRect(cx, cy, iw, il, iw / 2) : roundedRect(cx, cy, il, iw, iw / 2);
      return [closed(outer), closed(inner)];
    };
    // The crossing sits on the cell's centre: lengthways links either side of it, upright below.
    return linesOnly([...link(0, L / 2, false), ...link(L / 2, 0, true)]);
  },
};

// ---------------------------------------------------------------------------------------------
// Brick mortar — running bond drawn the way a brick pattern is actually used: the joints as
// open lines, no material removed. `bricks` is the version that cuts the bricks out.
export const brickLines: PatternDef = {
  id: 'brick-lines',
  name: 'Brick mortar',
  family: 'textile',
  tags: ['lines', 'brick', 'running bond', 'wall', 'mortar', 'subway'],
  blurb: 'The mortar joints of a running-bond wall, scored — no brick removed.',
  ops: ['score', 'engrave'],
  params: [
    number('length', 'Brick length', 18, 4, 100),
    number('height', 'Brick height', 8, 2, 50),
    number('offset', 'Course offset', 0.5, 0, 1, 0.05, '×', 'How far each second course slides. 0.5 is running bond, 0 is stack bond.'),
  ],
  cell: (p) => ({ w: num(p, 'length'), h: 2 * num(p, 'height') }),
  tile: (p) => {
    const L = num(p, 'length');
    const H = num(p, 'height');
    const o = num(p, 'offset') * L;
    return linesOnly([
      seg([0, 0], [L, 0]),
      seg([0, H], [L, H]),
      seg([0, 0], [0, H]),
      seg([o, H], [o, 2 * H]),
    ]);
  },
};

export const TEXTILE: PatternDef[] = [
  herringbone,
  basketweave,
  houndstooth,
  argyle,
  gingham,
  ogee,
  quatrefoil,
  scallops,
  chain,
  brickLines,
];

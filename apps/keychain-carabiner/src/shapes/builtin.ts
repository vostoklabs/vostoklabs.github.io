/*
  The built-in silhouettes: the shapes the reference photo has, the ones the clicker's shape
  library has (ported formula for formula), and a few a carabiner wants — a D-ring, a pear, a
  skull.

  Each one is authored UPRIGHT (the way it hangs) and hands back three markers as angles from
  the centroid — eye (where the hook hangs its chain from, the bottom) and top (where a charm
  hangs FROM). The gate is found on the outline: left side, mid-height, on the straightest run
  there, the same rule an SVG asset without a gate marker gets.

  Ian's own SVG assets go through `svgShape.ts` instead, and end up as the same `ShapeDef`.
*/
import { bestCutT, fillet, normalize, rotateRing, tAtAngle, type Pt, type Ring } from './ring';

/** Where a shape sits in the picker. */
export type ShapeGroup = 'basic' | 'fun' | 'seasonal';

export interface ShapeDef {
  /** Stable id — saved in projects, never rename one. */
  id: string;
  name: string;
  /** Normalised, counter-clockwise, long side = 1. */
  ring: Ring;
  /** Perimeter fractions. */
  gate: number;
  eye: number;
  top: number;
  /** Where it came from — built-in formula or an SVG asset file. */
  source: 'builtin' | 'svg';
  /** True when an SVG placed the gate itself; a guessed gate is re-placed on the hung outline. */
  gateFixed?: boolean;
  group: ShapeGroup;
}

function polar(n: number, f: (theta: number) => number): Ring {
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const th = (Math.PI * 2 * i) / n;
    const r = f(th);
    out.push([Math.cos(th) * r, Math.sin(th) * r]);
  }
  return out;
}

/** Points along an arc, inclusive of both ends. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps: number, rx = r): Ring {
  const out: Ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push([cx + rx * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

const D = Math.PI / 180;

// ---- basic ---------------------------------------------------------------------------------

function circle(): Ring {
  return polar(72, () => 1);
}

/** Stadium, taller than wide — the classic oval link and the oval snap hook. */
function oval(aspect = 0.64): Ring {
  const r = aspect / 2;
  const straight = 1 - aspect;
  const out: Ring = [];
  const per = 24;
  // Bottom cap left to right, straight up the right side, top cap right to left, straight
  // down the left side — counter-clockwise.
  for (let i = 0; i <= per; i++) {
    const a = Math.PI + (Math.PI * i) / per;
    out.push([Math.cos(a) * r, -straight / 2 + Math.sin(a) * r]);
  }
  for (let i = 0; i <= per; i++) {
    const a = (Math.PI * i) / per;
    out.push([Math.cos(a) * r, straight / 2 + Math.sin(a) * r]);
  }
  return out;
}

/**
 * The standard carabiner: a straight spine on one side, a bow on the other, rounded ends.
 * Authored with the spine on the RIGHT so the gate lands on the bow at the left, where a
 * carabiner's gate is.
 */
function dring(): Ring {
  const spineX = 0.31;
  const cornerR = 0.18;
  const cornerX = spineX - cornerR;
  const cornerY = 0.5 - cornerR;
  const bowX = -0.05;
  return [
    ...arc(cornerX, -cornerY, cornerR, -90 * D, 0, 6), // bottom-right corner
    [spineX, cornerY], // up the spine
    ...arc(cornerX, cornerY, cornerR, 0, 90 * D, 6), // top-right corner
    [bowX, 0.5], // along the top
    ...arc(bowX, 0, 0.5, 90 * D, 270 * D, 40, 0.26), // the bow, down the left
    [cornerX, -0.5], // along the bottom
  ];
}

/** Round head, tapering to a rounded point at the bottom — the swivel-hook silhouette. */
function teardrop(): Ring {
  const R = 0.42;
  const cy = 0.22;
  const tip: [number, number] = [0, -0.9];
  const d = Math.hypot(tip[0], tip[1] - cy);
  const alpha = Math.acos(R / d);
  const base = Math.atan2(tip[1] - cy, tip[0]);
  const aR = base + alpha;
  const aL = base - alpha;
  const out: Ring = [tip];
  const per = 60;
  const start = aR;
  const end = aL + Math.PI * 2;
  for (let i = 0; i <= per; i++) {
    const a = start + ((end - start) * i) / per;
    out.push([Math.cos(a) * R, cy + Math.sin(a) * R]);
  }
  return fillet(normalize(out), 0.09, 150, 8);
}

/** The teardrop the other way up: narrow at the top, round below — an HMS carabiner. */
function pear(): Ring {
  return normalize(rotateRing(teardrop(), Math.PI));
}

function squircle(): Ring {
  const out: Ring = [];
  const n = 96;
  for (let i = 0; i < n; i++) {
    const th = (Math.PI * 2 * i) / n;
    const c = Math.cos(th), s = Math.sin(th);
    const k = 4;
    out.push([Math.sign(c) * Math.pow(Math.abs(c), 2 / k), Math.sign(s) * Math.pow(Math.abs(s), 2 / k)]);
  }
  return out;
}

/** A rounded rectangle, taller than wide. The clicker's `roundedRectRing`. */
function rect(w = 0.62, h = 1, cornerPct = 0.22, perCorner = 8): Ring {
  const r = cornerPct * Math.min(w, h);
  const ix = w / 2 - r;
  const iy = h / 2 - r;
  const pts: Ring = [];
  const corners: [number, number, number][] = [
    [ix, iy, 0], [-ix, iy, Math.PI / 2], [-ix, -iy, Math.PI], [ix, -iy, -Math.PI / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = a0 + (Math.PI / 2) * (i / perCorner);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
}

/** A regular polygon with a flat at the bottom, corners softened. */
function ngon(sides: number, radiusFillet = 0.08): Ring {
  const out: Ring = [];
  // A vertex at the top for odd counts (triangle, pentagon); a flat at the bottom either way
  // by starting the vertices half a step off the vertical for even counts.
  const offset = sides % 2 === 0 ? Math.PI / sides : 0;
  for (let i = 0; i < sides; i++) {
    const a = Math.PI / 2 + offset + (Math.PI * 2 * i) / sides;
    out.push([Math.cos(a), Math.sin(a)]);
  }
  return fillet(normalize(out), radiusFillet, 170, 6);
}

/** A square on its point. */
function diamond(): Ring {
  const out: Ring = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / 2;
    out.push([Math.cos(a) * 0.72, Math.sin(a)]);
  }
  return fillet(normalize(out), 0.06, 170, 6);
}

// ---- fun -----------------------------------------------------------------------------------

/** Two round lobes over a diamond — the clicker's heart, which is the one Ian calls clean. */
function heart(): Ring {
  const h = 1 / Math.SQRT2;
  const lobeR = 0.5;
  const lobeX = h / 2;
  const lobeY = 1.5 * h;
  const steps = 32;
  const pts: Ring = [];
  pts.push([0, 0]);
  pts.push([h, h]);
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 4 + (Math.PI * 1.25 * i) / steps;
    pts.push([lobeX + lobeR * Math.cos(a), lobeY + lobeR * Math.sin(a)]);
  }
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 4 + (Math.PI * 1.25 * (steps - i)) / steps;
    pts.push([-(lobeX + lobeR * Math.cos(a)), lobeY + lobeR * Math.sin(a)]);
  }
  pts.push([-h, h]);
  return fillet(normalize(pts), 0.05, 120);
}

function star(points = 5, inner = 0.5): Ring {
  const out: Ring = [];
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / points;
    const r = i % 2 === 0 ? 1 : inner;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return fillet(normalize(out), 0.07, 170, 8);
}

function flower(petals = 5): Ring {
  return polar(120, (th) => 0.78 + 0.22 * Math.cos(petals * (th - Math.PI / 2)));
}

/** A round cranium over a narrower jaw. The band round it reads as a skull at a glance, which
 *  is all a silhouette has to do. */
function skull(): Ring {
  const cx = 0, cy = 0.14, r = 0.5;
  const jawX = 0.3;
  const jawBottom = -0.62;
  const jawTop = cy - Math.sqrt(r * r - jawX * jawX); // where the jaw's sides meet the cranium
  const aR = Math.atan2(jawTop - cy, jawX);
  const pts: Ring = [
    [-jawX, jawBottom],
    [jawX, jawBottom],
    [jawX, jawTop],
    ...arc(cx, cy, r, aR, Math.PI - aR, 48).slice(1, -1),
    [-jawX, jawTop],
  ];
  return fillet(normalize(pts), 0.05, 175, 5);
}

/** The clicker's egg: narrow end up. */
function egg(): Ring {
  const width = 0.74;
  const taper = 0.26;
  const out: Ring = [];
  const steps = 96;
  for (let i = 0; i < steps; i++) {
    const t = (Math.PI * 2 * i) / steps;
    out.push([width * Math.cos(t) * (1 - taper * Math.sin(t)), Math.sin(t)]);
  }
  return out;
}

/** The clicker's heraldic shield: flat top, square shoulders, a point at the bottom. */
function shield(): Ring {
  const steps = 20;
  const bezier = (p0: Pt, p1: Pt, p2: Pt): Ring => {
    const out: Ring = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
    return out;
  };
  const shoulderL: Pt = [-1, 0.95];
  const shoulderR: Pt = [1, 0.95];
  const tip: Pt = [0, -1.35];
  return fillet(normalize([shoulderL, shoulderR, ...bezier(shoulderR, [1.02, -0.35], tip), ...bezier(tip, [-1.02, -0.35], shoulderL)]), 0.05, 175, 5);
}

/** A luggage tag, hanging by its point. */
function tag(): Ring {
  return fillet(normalize([[0, -0.5], [0.31, -0.2], [0.31, 0.5], [-0.31, 0.5], [-0.31, -0.2]]), 0.05, 175, 5);
}

/** An arch: flat bottom and sides, a semicircular top. */
function archShape(): Ring {
  const w = 0.5, h = 0.45;
  return normalize([[-w, -h], [w, -h], ...arc(0, h, w, 0, Math.PI, 40)]);
}

/** A plus / Greek cross, corners softened. */
function cross(arm = 0.34): Ring {
  const a = arm;
  return fillet(normalize([
    [a, 1], [a, a], [1, a], [1, -a], [a, -a], [a, -1],
    [-a, -1], [-a, -a], [-1, -a], [-1, a], [-a, a], [-a, 1],
  ]), 0.05, 175, 5);
}

// ---- the directory -------------------------------------------------------------------------

function def(id: string, name: string, group: ShapeGroup, ring: Ring, eyeDeg = 270, topDeg = 90): ShapeDef {
  const r = normalize(ring);
  return { id, name, group, ring: r, gate: bestCutT(r, 0.1, 0.6), eye: tAtAngle(r, eyeDeg), top: tAtAngle(r, topDeg), source: 'builtin' };
}

export const BUILTIN_SHAPES: ShapeDef[] = [
  def('oval', 'Oval', 'basic', oval()),
  def('dring', 'Carabiner', 'basic', dring()),
  def('circle', 'Circle', 'basic', circle()),
  def('pear', 'Pear', 'basic', pear()),
  def('teardrop', 'Teardrop', 'basic', teardrop()),
  def('rect', 'Rectangle', 'basic', rect()),
  def('squircle', 'Rounded square', 'basic', squircle()),
  def('hexagon', 'Hexagon', 'basic', ngon(6)),
  def('octagon', 'Octagon', 'basic', ngon(8)),
  def('triangle', 'Triangle', 'basic', ngon(3, 0.1)),
  def('diamond', 'Diamond', 'basic', diamond()),
  def('heart', 'Heart', 'fun', heart()),
  def('star', 'Star', 'fun', star()),
  def('flower', 'Flower', 'fun', flower()),
  def('skull', 'Skull', 'fun', skull()),
  def('egg', 'Egg', 'fun', egg()),
  def('shield', 'Shield', 'fun', shield()),
  def('tag', 'Tag', 'fun', tag()),
  def('arch', 'Arch', 'fun', archShape()),
  def('cross', 'Cross', 'fun', cross()),
];

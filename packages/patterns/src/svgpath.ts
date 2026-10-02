// SVG path data → polylines and rings. The whole `d` grammar (absolute and relative M L H V
// C S Q T A Z), curves flattened to a tolerance, arcs through the endpoint-to-centre
// conversion in the SVG spec's implementation notes. This is what lets an MIT tile library or
// a customer's own Inkscape tile become a pattern.
import type { Polyline, Pt, Ring } from './types';

export interface FlatPath {
  /** Subpaths that ended in Z. */
  rings: Ring[];
  /** Subpaths that did not. */
  polylines: Polyline[];
}

const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

interface Tok {
  cmd: string;
  args: number[];
}

function tokenize(d: string): Tok[] {
  const out: Tok[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const cmd = m[1]!;
    const body = m[2]!;
    // Arc flags can be glued to the numbers that follow ("1 0 0 1 10 10" or "10010 10"), so
    // arcs are read flag by flag; everything else is a plain number list.
    const args: number[] = cmd === 'A' || cmd === 'a' ? arcArgs(body) : (body.match(NUMBER) ?? []).map(Number);
    out.push({ cmd, args });
  }
  return out;
}

function arcArgs(body: string): number[] {
  const out: number[] = [];
  let i = 0;
  const s = body;
  const skip = () => {
    while (i < s.length && /[\s,]/.test(s[i]!)) i++;
  };
  const readNum = (): number | null => {
    skip();
    NUMBER.lastIndex = 0;
    const re = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/;
    const m = re.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const readFlag = (): number | null => {
    skip();
    const ch = s[i];
    if (ch !== '0' && ch !== '1') return null;
    i++;
    return Number(ch);
  };
  for (;;) {
    const rx = readNum();
    if (rx === null) break;
    const ry = readNum();
    const rot = readNum();
    const large = readFlag();
    const sweep = readFlag();
    const x = readNum();
    const y = readNum();
    if (ry === null || rot === null || large === null || sweep === null || x === null || y === null) break;
    out.push(rx, ry, rot, large, sweep, x, y);
  }
  return out;
}

/**
 * Flatten path data. `tol` is the chord error in the path's own units; curves get enough
 * segments that no chord strays further than that from the curve.
 */
export function flattenPathData(d: string, tol = 0.1): FlatPath {
  const rings: Ring[] = [];
  const polylines: Polyline[] = [];
  let cur: Pt[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCtrl: Pt | null = null;
  let lastCmd = '';
  const flush = (closed: boolean) => {
    // A closed subpath of two points encloses nothing: it is a line drawn there and back
    // ("M0 10h20z" is how some tile libraries write a plain stroke), so it stays a line.
    if (closed && cur.length >= 3) rings.push(cur);
    else if (cur.length >= 2) polylines.push(cur);
    cur = [];
  };
  const moveTo = (nx: number, ny: number) => {
    flush(false);
    x = startX = nx;
    y = startY = ny;
    cur = [[x, y]];
  };
  const lineTo = (nx: number, ny: number) => {
    x = nx;
    y = ny;
    cur.push([x, y]);
  };
  const cubicTo = (x1: number, y1: number, x2: number, y2: number, nx: number, ny: number) => {
    const n = curveSteps([x, y], [x1, y1], [x2, y2], [nx, ny], tol);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const mt = 1 - t;
      cur.push([
        mt * mt * mt * x + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * nx,
        mt * mt * mt * y + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * ny,
      ]);
    }
    x = nx;
    y = ny;
    lastCtrl = [x2, y2];
  };
  const quadTo = (x1: number, y1: number, nx: number, ny: number) => {
    // A quadratic is the cubic with control points 2/3 of the way to its one control point.
    const c1x = x + (2 / 3) * (x1 - x);
    const c1y = y + (2 / 3) * (y1 - y);
    const c2x = nx + (2 / 3) * (x1 - nx);
    const c2y = ny + (2 / 3) * (y1 - ny);
    cubicTo(c1x, c1y, c2x, c2y, nx, ny);
    lastCtrl = [x1, y1];
  };
  const arcTo = (rx: number, ry: number, rotDeg: number, large: number, sweep: number, nx: number, ny: number) => {
    for (const p of arcPoints([x, y], rx, ry, rotDeg, large !== 0, sweep !== 0, [nx, ny], tol)) cur.push(p);
    x = nx;
    y = ny;
  };

  for (const { cmd, args } of tokenize(d)) {
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    let k = 0;
    const take = (n: number): number[] | null => {
      if (k + n > args.length) return null;
      const out = args.slice(k, k + n);
      k += n;
      return out;
    };
    if (C === 'Z') {
      if (cur.length) {
        flush(true);
        x = startX;
        y = startY;
        cur = [];
      }
      lastCmd = C;
      continue;
    }
    let first = true;
    for (;;) {
      let a: number[] | null;
      if (C === 'M') {
        a = take(2);
        if (!a) break;
        const nx = rel ? x + a[0]! : a[0]!;
        const ny = rel ? y + a[1]! : a[1]!;
        // After the first pair, an M's extra pairs are line-tos.
        if (first) moveTo(nx, ny);
        else lineTo(nx, ny);
        if (first && !cur.length) cur = [[x, y]];
      } else if (C === 'L') {
        a = take(2);
        if (!a) break;
        lineTo(rel ? x + a[0]! : a[0]!, rel ? y + a[1]! : a[1]!);
      } else if (C === 'H') {
        a = take(1);
        if (!a) break;
        lineTo(rel ? x + a[0]! : a[0]!, y);
      } else if (C === 'V') {
        a = take(1);
        if (!a) break;
        lineTo(x, rel ? y + a[0]! : a[0]!);
      } else if (C === 'C') {
        a = take(6);
        if (!a) break;
        const o = rel ? [x, y, x, y, x, y] : [0, 0, 0, 0, 0, 0];
        cubicTo(a[0]! + o[0]!, a[1]! + o[1]!, a[2]! + o[2]!, a[3]! + o[3]!, a[4]! + o[4]!, a[5]! + o[5]!);
      } else if (C === 'S') {
        a = take(4);
        if (!a) break;
        const ox = rel ? x : 0;
        const oy = rel ? y : 0;
        const refl: Pt = lastCmd === 'C' || lastCmd === 'S' ? [2 * x - (lastCtrl?.[0] ?? x), 2 * y - (lastCtrl?.[1] ?? y)] : [x, y];
        cubicTo(refl[0], refl[1], a[0]! + ox, a[1]! + oy, a[2]! + ox, a[3]! + oy);
      } else if (C === 'Q') {
        a = take(4);
        if (!a) break;
        const ox = rel ? x : 0;
        const oy = rel ? y : 0;
        quadTo(a[0]! + ox, a[1]! + oy, a[2]! + ox, a[3]! + oy);
      } else if (C === 'T') {
        a = take(2);
        if (!a) break;
        const ox = rel ? x : 0;
        const oy = rel ? y : 0;
        const refl: Pt = lastCmd === 'Q' || lastCmd === 'T' ? [2 * x - (lastCtrl?.[0] ?? x), 2 * y - (lastCtrl?.[1] ?? y)] : [x, y];
        quadTo(refl[0], refl[1], a[0]! + ox, a[1]! + oy);
      } else if (C === 'A') {
        a = take(7);
        if (!a) break;
        arcTo(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, rel ? x + a[5]! : a[5]!, rel ? y + a[6]! : a[6]!);
      } else break;
      lastCmd = C;
      first = false;
      if (k >= args.length) break;
    }
  }
  flush(false);
  return { rings, polylines };
}

function curveSteps(p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number): number {
  // Wang's bound on the number of segments needed for a flatness of `tol`.
  const ddx = Math.max(Math.abs(p0[0] - 2 * p1[0] + p2[0]), Math.abs(p1[0] - 2 * p2[0] + p3[0]));
  const ddy = Math.max(Math.abs(p0[1] - 2 * p1[1] + p2[1]), Math.abs(p1[1] - 2 * p2[1] + p3[1]));
  const dd = Math.hypot(ddx, ddy);
  const n = Math.ceil(Math.sqrt((dd * 6) / (8 * Math.max(tol, 1e-6))));
  return Math.max(1, Math.min(96, n || 1));
}

/** The points of an SVG arc after its start point, per the spec's F.6.5 conversion. */
function arcPoints(from: Pt, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, to: Pt, tol: number): Pt[] {
  if (rx === 0 || ry === 0) return [to];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx2 = (from[0] - to[0]) / 2;
  const dy2 = (from[1] - to[1]) / 2;
  const x1p = cosP * dx2 + sinP * dy2;
  const y1p = -sinP * dx2 + cosP * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (from[0] + to[0]) / 2;
  const cy = sinP * cxp + cosP * cyp + (from[1] + to[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const r = Math.max(rx, ry);
  const n = Math.max(2, Math.min(180, Math.ceil(Math.abs(delta) / (2 * Math.acos(Math.max(0, 1 - tol / Math.max(r, tol)))))));
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = theta1 + (delta * i) / n;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    out.push([cosP * ex - sinP * ey + cx, sinP * ex + cosP * ey + cy]);
  }
  out[out.length - 1] = to;
  return out;
}

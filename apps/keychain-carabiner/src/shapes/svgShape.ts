/*
  Ian's SVG assets → ShapeDef.

  The asset contract, in full:

    <svg viewBox="…">
      <path id="outline" d="…"/>          one closed path, the silhouette (required; or the
                                          first <path> if nothing carries the id)
      <line id="gate" x1 y1 x2 y2/>       where the gate opening goes (optional)
      <circle id="eye" cx cy r/>          where a charm hangs from this shape (optional)
      <circle id="top" cx cy r/>          where this shape hangs from, as a charm (optional)
    </svg>

  Markers are snapped to the nearest outline point and stored as perimeter fractions, so
  they only need to be NEAR the edge. A missing gate lands on the left, a missing eye at
  the bottom, a missing top at the top — the same defaults as the built-ins.

  Deliberately narrow: no transforms, no nested groups, no strokes. Flatten before export.
  Needs DOMParser, so this runs on the main thread; the worker only ever sees rings.
*/
import { bestCutT, normalize, tAtAngle, tNearest, type Pt, type Ring } from './ring';
import type { ShapeDef, ShapeGroup } from './builtin';

const CURVE_STEPS = 10;

/** SVG path data → the first closed polygon it draws. Absolute and relative M L H V C S Q T A Z. */
export function pathToRing(d: string): Ring {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const rings: Ring[] = [];
  let cur: Ring = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  let lastCtrl: Pt | null = null;
  let cmd = '';
  let i = 0;
  const num = () => parseFloat(tokens[i++] ?? '0');
  const isNum = () => i < tokens.length && /^-?[\d.]/.test(tokens[i]!);

  const close = () => {
    if (cur.length > 2) rings.push(cur);
    cur = [];
  };

  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (/^[A-Za-z]$/.test(tok)) { cmd = tok; i++; }
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        const nx = num(), ny = num();
        x = rel ? x + nx : nx; y = rel ? y + ny : ny;
        close();
        cur.push([x, y]); sx = x; sy = y; lastCtrl = null;
        // Subsequent pairs are implicit lineto.
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': { const nx = num(), ny = num(); x = rel ? x + nx : nx; y = rel ? y + ny : ny; cur.push([x, y]); lastCtrl = null; break; }
      case 'H': { const nx = num(); x = rel ? x + nx : nx; cur.push([x, y]); lastCtrl = null; break; }
      case 'V': { const ny = num(); y = rel ? y + ny : ny; cur.push([x, y]); lastCtrl = null; break; }
      case 'C': case 'S': {
        let x1: number, y1: number;
        if (cmd.toUpperCase() === 'C') { const a = num(), b = num(); x1 = rel ? x + a : a; y1 = rel ? y + b : b; }
        else { x1 = lastCtrl ? 2 * x - lastCtrl[0] : x; y1 = lastCtrl ? 2 * y - lastCtrl[1] : y; }
        const a2 = num(), b2 = num(), a3 = num(), b3 = num();
        const x2 = rel ? x + a2 : a2, y2 = rel ? y + b2 : b2;
        const x3 = rel ? x + a3 : a3, y3 = rel ? y + b3 : b3;
        for (let k = 1; k <= CURVE_STEPS; k++) {
          const t = k / CURVE_STEPS, mt = 1 - t;
          cur.push([
            mt * mt * mt * x + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
            mt * mt * mt * y + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
          ]);
        }
        lastCtrl = [x2, y2]; x = x3; y = y3;
        break;
      }
      case 'Q': case 'T': {
        let x1: number, y1: number;
        if (cmd.toUpperCase() === 'Q') { const a = num(), b = num(); x1 = rel ? x + a : a; y1 = rel ? y + b : b; }
        else { x1 = lastCtrl ? 2 * x - lastCtrl[0] : x; y1 = lastCtrl ? 2 * y - lastCtrl[1] : y; }
        const a2 = num(), b2 = num();
        const x2 = rel ? x + a2 : a2, y2 = rel ? y + b2 : b2;
        for (let k = 1; k <= CURVE_STEPS; k++) {
          const t = k / CURVE_STEPS, mt = 1 - t;
          cur.push([mt * mt * x + 2 * mt * t * x1 + t * t * x2, mt * mt * y + 2 * mt * t * y1 + t * t * y2]);
        }
        lastCtrl = [x1, y1]; x = x2; y = y2;
        break;
      }
      case 'A': {
        const rx = Math.abs(num()), ry = Math.abs(num()), rot = num() * Math.PI / 180;
        const large = num() !== 0, sweep = num() !== 0;
        const a2 = num(), b2 = num();
        const x2 = rel ? x + a2 : a2, y2 = rel ? y + b2 : b2;
        arcPoints(cur, x, y, rx, ry, rot, large, sweep, x2, y2);
        x = x2; y = y2; lastCtrl = null;
        break;
      }
      case 'Z': { x = sx; y = sy; close(); lastCtrl = null; i += isNum() ? 0 : 0; break; }
      default: i++;
    }
    if (cmd.toUpperCase() === 'Z') cmd = '';
  }
  close();
  // The largest polygon is the silhouette; anything smaller is a hole or a stray.
  rings.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  return rings[0] ?? [];
}

function area(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j]![0] * r[i]![1] - r[i]![0] * r[j]![1];
  return a / 2;
}

/** SVG elliptical arc → points, per the W3C implementation notes (F.6.5). */
function arcPoints(out: Ring, x1: number, y1: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x2: number, y2: number) {
  if (rx === 0 || ry === 0) { out.push([x2, y2]); return; }
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = coef * (rx * y1p) / ry, cyp = coef * -(ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
  const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const d = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return d;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= Math.PI * 2;
  if (sweep && dth < 0) dth += Math.PI * 2;
  const steps = Math.max(2, Math.ceil(Math.abs(dth) / (Math.PI / 12)));
  for (let k = 1; k <= steps; k++) {
    const th = th1 + (dth * k) / steps;
    const ex = rx * Math.cos(th), ey = ry * Math.sin(th);
    out.push([cp * ex - sp * ey + cx, sp * ex + cp * ey + cy]);
  }
}

/** Parse one asset. Throws with a readable message when the file has no usable outline. */
export function shapeFromSvg(id: string, name: string, svgText: string, group: ShapeGroup = 'seasonal'): ShapeDef {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error(`${id}: not valid SVG`);
  const path = (doc.getElementById('outline') ?? doc.querySelector('path')) as SVGPathElement | null;
  if (!path) throw new Error(`${id}: no <path> to use as the outline`);
  const raw = pathToRing(path.getAttribute('d') ?? '');
  if (raw.length < 3) throw new Error(`${id}: the outline has fewer than three points`);

  // SVG is y-down; the geometry is y-up. Flip before anything is measured.
  const flipped: Ring = raw.map(([x, y]) => [x, -y]);
  const ring = normalize(flipped);

  // Markers are snapped on the same normalised ring, so transform them identically.
  const b = boundsOf(flipped);
  const s = 1 / Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const toRing = (x: number, y: number): Pt => [(x - cx) * s, (-y - cy) * s];

  const gateEl = doc.getElementById('gate');
  const eyeEl = doc.getElementById('eye');
  const topEl = doc.getElementById('top');
  const lineMid = (e: Element): Pt => {
    const g = (a: string) => parseFloat(e.getAttribute(a) ?? '0');
    return [(g('x1') + g('x2')) / 2, (g('y1') + g('y2')) / 2];
  };
  const circleAt = (e: Element): Pt => [parseFloat(e.getAttribute('cx') ?? '0'), parseFloat(e.getAttribute('cy') ?? '0')];
  const markerT = (e: Element | null, fallbackDeg: number): number => {
    if (!e) return tAtAngle(ring, fallbackDeg);
    const q = e.tagName.toLowerCase() === 'line' ? lineMid(e) : circleAt(e);
    return tNearest(ring, toRing(q[0], q[1]));
  };

  return {
    id,
    name,
    ring,
    gate: gateEl ? markerT(gateEl, 180) : bestCutT(ring, 0.1, 0.6),
    gateFixed: !!gateEl,
    eye: markerT(eyeEl, 270),
    top: markerT(topEl, 90),
    source: 'svg',
    group,
  };
}

function boundsOf(r: Ring) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of r) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minX, maxX, minY, maxY };
}

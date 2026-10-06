// Pure ring maths, no DOM and no WASM, so every rule here can be asserted headless.
// A ring is a closed polygon, first point NOT repeated. Islands are `Ring[][]`: one outer
// ring plus its holes, in any order and either winding — the contract `buildCutSvg` takes.
import { pointInRing, windingNumber } from './geom';
import type { Box, Pt, Ring, SizedBox } from './types';

export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function bboxOf(shapes: Ring[][]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const island of shapes) {
    for (const ring of island) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * The box round some rings, with its width and height: `{ minX, minY, maxX, maxY, w, h }`.
 * One ring is `ringBox([ring])`. With no points at all the box is empty, not zero: its min is
 * +Infinity and its max -Infinity, so `Number.isFinite(b.minX)` says whether there was anything.
 */
export function ringBox(rings: readonly (readonly Pt[])[]): SizedBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function mapShapes(shapes: Ring[][], fn: (p: Pt) => Pt): Ring[][] {
  return shapes.map((island) => island.map((ring) => ring.map((p) => fn(p))));
}

/** Translate so the bounding box is centred on the origin. Returns the offset applied. */
export function centreShapes(shapes: Ring[][]): { shapes: Ring[][]; dx: number; dy: number } {
  const b = bboxOf(shapes);
  const dx = -(b.minX + b.maxX) / 2;
  const dy = -(b.minY + b.maxY) / 2;
  return { shapes: mapShapes(shapes, ([x, y]) => [x + dx, y + dy]), dx, dy };
}

/** Local → sheet: rotate about the local origin, then translate. */
export function placeShapes(shapes: Ring[][], x: number, y: number, rotationDeg: number): Ring[][] {
  const r = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return mapShapes(shapes, ([px, py]) => [px * c - py * s + x, px * s + py * c + y]);
}

/** Mirror across the local Y axis. Ring order is reversed so the winding stays consistent. */
export function mirrorX(shapes: Ring[][]): Ring[][] {
  return shapes.map((island) => island.map((ring) => ring.map(([x, y]): Pt => [-x, y]).reverse()));
}

/** Ramer–Douglas–Peucker on a closed ring. `tol` in the ring's own units. */
export function simplifyRing(ring: Ring, tol: number): Ring {
  if (ring.length < 4 || tol <= 0) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  // Split at the point farthest from the first, so the closed ring becomes two open runs.
  let far = 0;
  let farD = -1;
  const p0 = ring[0]!;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i]![0] - p0[0], ring[i]![1] - p0[1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, ring.length]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = ring[a]!;
    const pb = ring[b % ring.length]!;
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = pointLineDist(ring[i]!, pa, pb);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i]!);
  return out.length >= 3 ? out : ring;
}

function pointLineDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// ------------------------------------------------------------------ primitives --

export function circleRing(cx: number, cy: number, r: number, n = 64): Ring {
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

/**
 * A rectangle from two opposite corners: (x0, y0), (x1, y0), (x1, y1), (x0, y1), in that order,
 * so with x0 < x1 and y0 < y1 it runs counter-clockwise from the lower-left corner. The corners
 * are used as given, nothing is worked out from them, so a box's own numbers land exactly.
 */
export function rectRing(x0: number, y0: number, x1: number, y1: number): Ring {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/**
 * Rounded rectangle, centred on the origin, or on `at`. `r` is clamped to half the shorter side.
 *
 * The edges are worked out first and every corner from them, so a rectangle placed by its
 * centre lands on the numbers a corner-to-corner builder writes: with `at = [w/2, h/2]` its
 * edges are exactly 0 and `w`, and its first corner is centred on exactly `w - r`.
 */
export function roundedRectRing(w: number, h: number, r: number, seg = 10, at?: Pt): Ring {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const hw = w / 2;
  const hh = h / 2;
  const [x0, x1, y0, y1] = at ? [at[0] - hw, at[0] + hw, at[1] - hh, at[1] + hh] : [-hw, hw, -hh, hh];
  if (rr === 0) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const out: Ring = [];
  const corner = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= seg; i++) {
      const t = from + (i / seg) * (Math.PI / 2);
      out.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]);
    }
  };
  corner(x1 - rr, y0 + rr, -Math.PI / 2);
  corner(x1 - rr, y1 - rr, 0);
  corner(x0 + rr, y1 - rr, Math.PI / 2);
  corner(x0 + rr, y0 + rr, Math.PI);
  return out;
}

/** A teardrop, point up: the classic dangle-earring blank. Width `w`, height `h`.
 *
 *  The arc is sampled on a fixed angular grid (n divisible by 4) plus the two exact tangent
 *  points, so the bulb always reaches the full width and depth the user typed — a uniform
 *  sweep from tangent to tangent lands a hair short of both, and a blank must be its size. */
export function teardropRing(w: number, h: number, n = 72): Ring {
  const r = w / 2;
  const cy = -h / 2 + r;
  const apexY = h / 2;
  const d = apexY - cy;
  if (d <= r) return circleRing(0, 0, r, n);
  const a = Math.acos(r / d); // half-angle between the centre→apex axis and each tangent point
  const tR = Math.PI / 2 - a; // right tangent point
  const tL = Math.PI / 2 + a; // left tangent point
  const out: Ring = [[0, apexY]];
  const at = (t: number): Pt => [r * Math.cos(t), cy + r * Math.sin(t)];
  out.push(at(tR));
  // Clockwise from the right tangent, through the bottom, to the left tangent.
  const step = (2 * Math.PI) / n;
  for (let t = Math.floor(tR / step) * step; t > tL - 2 * Math.PI; t -= step) {
    if (t < tR - 1e-9 && t > tL - 2 * Math.PI + 1e-9) out.push(at(t));
  }
  out.push(at(tL));
  // Walked clockwise for the arithmetic; handed out CCW like every other blank here.
  return out.reverse();
}

/** A military dog tag: a rounded rectangle whose ends are full semicircles. */
export function dogTagRing(w: number, h: number): Ring {
  return roundedRectRing(w, h, h / 2, 14);
}

// --------------------------------------------------- contours → islands --

/** A point genuinely inside a ring — never a vertex.
 *
 *  The first vertex is not a safe probe: where a glyph's crossbar meets its legs the two
 *  contours touch, so the bar's first vertex sits exactly on (or just inside) the leg. Testing
 *  that point is what made a Montserrat "A" lose its bar. The centroid is right for the convex
 *  counters that fonts are mostly made of; a concave ring falls back to a nudged edge midpoint. */
function interiorPoint(ring: Ring): [number, number] {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) { cx += x / ring.length; cy += y / ring.length; }
  if (pointInRing([cx, cy], ring)) return [cx, cy];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const step = Math.max(1e-4, Math.hypot(b[0] - a[0], b[1] - a[1]) * 1e-3);
    for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]] as [number, number][]) {
      const q: [number, number] = [mx + dx, my + dy];
      if (pointInRing(q, ring)) return q;
    }
  }
  return [cx, cy];
}

/**
 * Contours drawn twice cancel, as they do under SVG's even-odd fill rule.
 *
 * Some bundled icon glyphs trace the same circle twice, once each way — the Material Symbols
 * smileys (`mood`, `sentiment_*`) draw their face as a ring whose inner circle appears in both
 * directions. Two coincident contours enclose nothing between them, so the pair is noise; left
 * in, the second copy wins the containment race by a floating-point hair and the eyes and mouth
 * are re-parented into a region that is itself a hole, which is why a smiley engraved as a bare
 * ring and cut out as two pieces.
 *
 * Rings are matched on their points, not their direction or their starting vertex, and an odd
 * copy survives (two cancel, three leave one) — the same rule the SVG rasteriser applies.
 *
 * It is not only the outermost pair, either. Material Symbols' FILLED icons draw the shape twice
 * INSIDE the outline — the heart (`favorite`) carries two coincident inner contours wound against
 * each other — and until they annihilate, containment reads the second as a hole of the first and
 * manifold resolves an annulus: a bold outline of a heart where the customer asked for a heart.
 *
 * A font fills by the NON-ZERO rule instead, `{ fill: 'nonzero' }`, and there a contour drawn twice
 * the SAME way round winds twice. Copies are then read by the winding they add: with w the winding
 * of every other contour at a point inside them and n their own net direction, the region inside
 * them winds w + n and the one around them w. They are an edge of the ink where exactly one of the
 * two is 0, and then one copy stays, wound as n; otherwise they all go, a pair wound against each
 * other as before, and copies lying in the ink, which add nothing to it. w is read at points all
 * round the inside of the copies, because another contour can cross them: Jura's "+" draws its
 * bar twice across the stem, where the bar adds nothing, and only its ends are an edge of the ink.
 * Material Symbols' `biotech` draws its eyepiece twice inside the body's counter, and the font
 * fills it.
 */
export function cancelCoincidentRings(rings: Ring[], opts: { fill?: 'evenodd' | 'nonzero' } = {}): Ring[] {
  if (rings.length < 2) return rings;
  const q = (v: number) => Math.round(v * 1e6);
  // Only rings that could possibly coincide are keyed, and the key may only use quantities that
  // are a function of the POINT SET — vertex count and bounding box. |area| was in here too, and
  // it is the one thing that is not: `signedArea` sums in ring order, so the same polygon walked
  // backwards from a different vertex adds its terms in a different order and lands a float's
  // last bit away. On the heart that was 220.857334|4999 against 220.857334|5000 — one rounded
  // down, one up, two different buckets, and a pair whose points are bit-for-bit identical was
  // never even compared. A candidate filter that can exclude a true match is not a filter.
  const bucket = new Map<string, number[]>();
  const boxes = rings.map((r) => bboxOf([[r]]));
  rings.forEach((r, i) => {
    const b = boxes[i]!;
    const k = `${r.length}|${q(b.minX)},${q(b.minY)},${q(b.maxX)},${q(b.maxY)}`;
    bucket.set(k, [...(bucket.get(k) ?? []), i]);
  });
  const drop = new Set<number>();
  for (const group of bucket.values()) {
    if (group.length < 2) continue;
    if (opts.fill === 'nonzero') {
      const copies = new Map<string, number[]>();
      for (const i of group) {
        const key = ringKey(rings[i]!, q);
        copies.set(key, [...(copies.get(key) ?? []), i]);
      }
      for (const same of copies.values()) {
        if (same.length < 2) continue;
        const n = same.reduce((s, i) => s + Math.sign(signedArea(rings[i]!)), 0);
        let keep = -1;
        if (n !== 0) {
          // Read at a point inside the copies, and a hair in from the middle of their edges (all
          // of them, or 32 to 63 spread evenly round a long copy). Only a contour whose box spans
          // a point's height can wind round it, so the others are not walked (a font that draws
          // every contour twice has hundreds).
          const copy = rings[same[0]!]!;
          const box = boxes[same[0]!]!;
          const s = Math.sign(signedArea(copy));
          const inset = 1e-6 * (box.maxX - box.minX + box.maxY - box.minY);
          const probes: Pt[] = [interiorPoint(copy)];
          const step = Math.max(1, Math.floor(copy.length / 32));
          for (let k = 0; k < copy.length; k += step) {
            const a = copy[k]!;
            const b = copy[(k + 1) % copy.length]!;
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            // Inward: left of the edge on a counter-clockwise ring, right on a clockwise one.
            if (len > 0) probes.push([(a[0] + b[0]) / 2 - ((b[1] - a[1]) / len) * s * inset, (a[1] + b[1]) / 2 + ((b[0] - a[0]) / len) * s * inset]);
          }
          const others = rings.flatMap((_, j) => (same.includes(j) ? [] : [j]));
          for (const p of probes) {
            const w = windingNumber(p, others.filter((j) => boxes[j]!.minY <= p[1] && p[1] < boxes[j]!.maxY).map((j) => rings[j]!));
            if ((w === 0) !== (w + n === 0)) {
              keep = same.find((i) => Math.sign(signedArea(rings[i]!)) === Math.sign(n))!;
              break;
            }
          }
        }
        for (const i of same) if (i !== keep) drop.add(i);
      }
      continue;
    }
    const seen = new Map<string, number>();
    for (const i of group) {
      const key = ringKey(rings[i]!, q);
      const first = seen.get(key);
      if (first === undefined) seen.set(key, i);
      else { drop.add(first); drop.add(i); seen.delete(key); }
    }
  }
  return drop.size ? rings.filter((_, i) => !drop.has(i)) : rings;
}

/** A ring's identity, independent of where it starts and which way it is wound. */
function ringKey(ring: Ring, q: (v: number) => number): string {
  const pts = ring.map(([x, y]) => `${q(x)},${q(y)}`);
  if (pts.length > 1 && pts[0] === pts[pts.length - 1]) pts.pop();
  const rotated = (p: string[]) => {
    const min = p.reduce((a, b) => (b < a ? b : a), p[0]!);
    let best = '';
    for (let i = 0; i < p.length; i++) {
      if (p[i] !== min) continue;
      const s = p.slice(i).concat(p.slice(0, i)).join(';');
      if (!best || s < best) best = s;
    }
    return best;
  };
  const forward = rotated(pts);
  const back = rotated([...pts].reverse());
  return forward < back ? forward : back;
}

/**
 * Group font contours into islands: an outer is a contour inside no other; a hole belongs to
 * the smallest outer that contains it. A glyph's counter (the hole of an "o") lands with its
 * glyph, so an engrave fill keeps the hole and a weld treats each letter as one piece.
 *
 * Containment alone cannot decide this, because a glyph is not a tree of nested rings. Fonts
 * fill by the NON-ZERO rule: a contour wound against its container is a hole, and a contour
 * wound WITH it is more material. Reading nesting alone turns Montserrat's "A" into a bare
 * lambda (its crossbar is a separate contour, wound the same way) and eats the top bowl of an
 * "8". So winding decides, and containment only says whose hole it is.
 */
export function islandsFromContours(contours: number[][][]): Ring[][] {
  // A font fills by the non-zero rule, so a contour it draws twice counts by its winding.
  const rings = cancelCoincidentRings(contours.filter((c) => c.length >= 3).map((c) => c.map(([x, y]) => [x!, y!] as [number, number])), { fill: 'nonzero' });
  const signed = rings.map((r) => signedArea(r));
  const areas = signed.map((a) => Math.abs(a));
  const probes = rings.map((r) => interiorPoint(r));
  // The smallest ring that actually contains this one, by a point that is really inside it.
  const container = rings.map((_, i) => {
    let best = -1;
    let bestArea = Infinity;
    for (let j = 0; j < rings.length; j++) {
      if (j === i || areas[j]! <= areas[i]!) continue;
      if (pointInRing(probes[i]!, rings[j]!) && areas[j]! < bestArea) {
        best = j;
        bestArea = areas[j]!;
      }
    }
    return best;
  });
  // A hole is a contained ring wound against whatever contains it. Everything else is material,
  // even when it sits inside another ring — overlapping strokes are unioned downstream.
  const isHole = rings.map((_, i) => {
    const c = container[i]!;
    return c >= 0 && Math.sign(signed[i]!) !== Math.sign(signed[c]!);
  });
  // A hole belongs to the nearest containing ring that is itself material.
  const ownerOf = (i: number): number => {
    let c = container[i]!;
    while (c >= 0 && isHole[c]!) c = container[c]!;
    return c;
  };
  const islands = new Map<number, Ring[]>();
  const put = (owner: number, ring: Ring, outer: boolean) => {
    const isl = islands.get(owner) ?? [];
    if (outer) isl.unshift(ring); else isl.push(ring);
    islands.set(owner, isl);
  };
  rings.forEach((r, i) => {
    if (!isHole[i]!) { put(i, r, true); return; }
    const owner = ownerOf(i);
    if (owner < 0) put(i, r, true); else put(owner, r, false);
  });
  return [...islands.values()];
}


// ---------------------------------------------------------------- rounding a corner --

/*
 * Rounding the corners of a ring you built yourself.
 *
 * `roundedRectRing` above covers a rectangle; this covers everything else — an L, a notched
 * plank, any polygon where each vertex wants its own radius. It lived in the laser studio's
 * cross-stand engine until a second caller appeared (the keychain phone stand, 2026-09-22),
 * which is this repo's rule for when something moves into the package.
 */
/** The arc that replaces vertex `p` between `a` and `b`, tangent to both edges, radius `r`.
 *  Falls back to the bare vertex where the corner is too tight for the radius asked for. */
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function cornerArc(a: Pt, p: Pt, b: Pt, r: number, segs = 8): Pt[] {
  if (r <= 0) return [p];
  const u: Pt = [a[0] - p[0], a[1] - p[1]];
  const v: Pt = [b[0] - p[0], b[1] - p[1]];
  const lu = Math.hypot(u[0], u[1]);
  const lv = Math.hypot(v[0], v[1]);
  if (lu < 1e-9 || lv < 1e-9) return [p];
  const un: Pt = [u[0] / lu, u[1] / lu];
  const vn: Pt = [v[0] / lv, v[1] / lv];
  const cosA = clamp(un[0] * vn[0] + un[1] * vn[1], -1, 1);
  const half = Math.acos(cosA) / 2;
  if (half < 1e-4 || half > Math.PI / 2 - 1e-4) return [p];
  // Cut back the same distance along both edges, never past half of either one.
  const d = Math.min(r / Math.tan(half), 0.45 * lu, 0.45 * lv);
  const rr = d * Math.tan(half);
  const bis: Pt = [un[0] + vn[0], un[1] + vn[1]];
  const lb = Math.hypot(bis[0], bis[1]);
  if (lb < 1e-9) return [p];
  const c: Pt = [p[0] + (bis[0] / lb) * (rr / Math.sin(half)), p[1] + (bis[1] / lb) * (rr / Math.sin(half))];
  const s: Pt = [p[0] + un[0] * d, p[1] + un[1] * d];
  const e: Pt = [p[0] + vn[0] * d, p[1] + vn[1] * d];
  const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
  let a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
  while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
  while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI;
  const out: Pt[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = a0 + ((a1 - a0) * i) / segs;
    out.push([c[0] + rr * Math.cos(t), c[1] + rr * Math.sin(t)]);
  }
  return out;
}

/** Round every vertex of a closed polygon, each by its own radius. */
export function filletRing(pts: Pt[], radii: number[]): Ring {
  return pts.flatMap((p, i) => cornerArc(pts[(i + pts.length - 1) % pts.length]!, p, pts[(i + 1) % pts.length]!, radii[i] ?? 0));
}

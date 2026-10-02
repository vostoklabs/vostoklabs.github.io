/*
  Ring arithmetic — closed outlines as plain point arrays.

  No manifold, no DOM: everything here runs in the worker, on the main thread and in a node
  harness alike, which is the point. A ring is counter-clockwise, closed implicitly, and
  NORMALISED before it is used: bounding box centred on the origin, long side exactly 1. The
  size slider then multiplies it, so every feature the builder adds (bar, gate, eye) is in real
  millimetres while the silhouette stays homogeneous — `shape(k·s) == k·shape(s)` by construction.

  Positions on an outline are perimeter fractions `t ∈ [0, 1)` measured from the ring's first
  point. That is what the markers (gate, eye, top) are stored as, because a fraction survives
  scaling and rotation and a millimetre coordinate does not.
*/

export type Pt = [number, number];
export type Ring = Pt[];

export interface Frame {
  /** The point on the outline, in the ring's units. */
  p: Pt;
  /** Unit tangent in the ring's direction of travel. */
  u: Pt;
  /** Unit OUTWARD normal. */
  n: Pt;
}

export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  }
  return a / 2;
}

export function ccw(ring: Ring): Ring {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

export function bounds(ring: Ring): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

export function centroid(ring: Ring): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
    a += cross;
    cx += (ring[j]![0] + ring[i]![0]) * cross;
    cy += (ring[j]![1] + ring[i]![1]) * cross;
  }
  if (Math.abs(a) < 1e-12) {
    const b = bounds(ring);
    return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Drop points that repeat their neighbour (including around the wrap). A repeated point is
 *  a zero-length edge, and a zero-length edge has no tangent. */
export function weld(ring: Ring, eps = 1e-6): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev[0] - p[0]) < eps && Math.abs(prev[1] - p[1]) < eps) continue;
    out.push([p[0], p[1]]);
  }
  while (out.length > 1) {
    const f = out[0]!, l = out[out.length - 1]!;
    if (Math.abs(f[0] - l[0]) < eps && Math.abs(f[1] - l[1]) < eps) out.pop();
    else break;
  }
  return out;
}

/** Centre the bounding box on the origin and scale the LONG side to 1. */
export function normalize(ring: Ring): Ring {
  const r = ccw(weld(ring));
  const b = bounds(r);
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const s = 1 / Math.max(w, h, 1e-9);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  return r.map(([x, y]) => [(x - cx) * s, (y - cy) * s]);
}

export function scaleRing(ring: Ring, s: number): Ring {
  return ring.map(([x, y]) => [x * s, y * s]);
}

export function rotateRing(ring: Ring, rad: number): Ring {
  const c = Math.cos(rad), s = Math.sin(rad);
  return ring.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

export function perimeter(ring: Ring): number {
  let len = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    len += Math.hypot(ring[i]![0] - ring[j]![0], ring[i]![1] - ring[j]![1]);
  }
  return len;
}

/** Point, tangent and outward normal at perimeter fraction `t`. The normal is the tangent
 *  turned clockwise, which points outward on a counter-clockwise ring. */
export function frameAt(ring: Ring, t: number): Frame {
  const total = perimeter(ring);
  let target = ((t % 1) + 1) % 1 * total;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!, b = ring[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (target <= len || i === n - 1) {
      const k = len > 0 ? Math.min(1, target / len) : 0;
      const ux = len > 0 ? (b[0] - a[0]) / len : 1;
      const uy = len > 0 ? (b[1] - a[1]) / len : 0;
      // Average the tangent over a small window so a marker sitting exactly on a polygon
      // vertex does not pick one of its two edges at random.
      const tangent = smoothTangent(ring, i, k);
      return {
        p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k],
        u: tangent ?? [ux, uy],
        n: tangent ? [tangent[1], -tangent[0]] : [uy, -ux],
      };
    }
    target -= len;
  }
  const a = ring[0]!;
  return { p: [a[0], a[1]], u: [1, 0], n: [0, -1] };
}

function smoothTangent(ring: Ring, i: number, k: number): Pt | null {
  const n = ring.length;
  // Neighbouring edges, weighted toward the one the point is on.
  const e = (idx: number): Pt => {
    const a = ring[((idx % n) + n) % n]!, b = ring[(((idx + 1) % n) + n) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return len > 0 ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len] : [0, 0];
  };
  const cur = e(i), prev = e(i - 1), next = e(i + 1);
  const wPrev = k < 0.5 ? 0.5 - k : 0;
  const wNext = k > 0.5 ? k - 0.5 : 0;
  const x = cur[0] + prev[0] * wPrev + next[0] * wNext;
  const y = cur[1] + prev[1] * wPrev + next[1] * wNext;
  const len = Math.hypot(x, y);
  return len > 1e-9 ? [x / len, y / len] : null;
}

/** Perimeter fraction of the outline point whose direction from the centroid is nearest to
 *  `angleDeg` (0 = +x, counter-clockwise). How the built-in shapes state where their markers
 *  go: "the gate is on the left" survives a re-sampled outline, an index does not. */
export function tAtAngle(ring: Ring, angleDeg: number): number {
  const c = centroid(ring);
  const want = (angleDeg * Math.PI) / 180;
  let best = 0, bestErr = Infinity;
  const total = perimeter(ring);
  let acc = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!, b = ring[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Sample the edge midpoint as well as its start, so a long straight side can be hit
    // in its middle rather than only at its ends.
    for (const k of [0, 0.5]) {
      const x = a[0] + (b[0] - a[0]) * k - c[0];
      const y = a[1] + (b[1] - a[1]) * k - c[1];
      let d = Math.atan2(y, x) - want;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const err = Math.abs(d);
      if (err < bestErr) {
        bestErr = err;
        best = (acc + len * k) / total;
      }
    }
    acc += len;
  }
  return best;
}

/** Perimeter fraction of the outline point nearest to `q`. How an SVG marker becomes a `t`. */
export function tNearest(ring: Ring, q: Pt): number {
  const total = perimeter(ring);
  let acc = 0, best = 0, bestD = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!, b = ring[(i + 1) % n]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let k = len2 > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2 : 0;
    k = Math.max(0, Math.min(1, k));
    const d = Math.hypot(q[0] - (a[0] + dx * k), q[1] - (a[1] + dy * k));
    if (d < bestD) {
      bestD = d;
      best = (acc + Math.sqrt(len2) * k) / total;
    }
    acc += Math.sqrt(len2);
  }
  return best;
}

/** Perimeter distance between two fractions, in the ring's units, the short way round. */
export function tDistance(ring: Ring, a: number, b: number): number {
  let d = Math.abs(((a - b) % 1 + 1) % 1);
  d = Math.min(d, 1 - d);
  return d * perimeter(ring);
}

/** Round every corner sharper than `minAngleDeg` with an arc of radius `r` (ring units).
 *  Star tips and heart points come out of a formula razor-sharp, and a razor-sharp tip on a
 *  band is a sliver that snaps; a real moulded star has a radius there. */
export function fillet(ring: Ring, r: number, minAngleDeg = 150, arcSteps = 6): Ring {
  const n = ring.length;
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const p = ring[i]!, a = ring[(i - 1 + n) % n]!, b = ring[(i + 1) % n]!;
    const v1: Pt = [a[0] - p[0], a[1] - p[1]];
    const v2: Pt = [b[0] - p[0], b[1] - p[1]];
    const l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
    if (l1 < 1e-9 || l2 < 1e-9) { out.push(p); continue; }
    const u1: Pt = [v1[0] / l1, v1[1] / l1], u2: Pt = [v2[0] / l2, v2[1] / l2];
    const cosA = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
    const ang = Math.acos(cosA);
    if (ang * 180 / Math.PI > minAngleDeg) { out.push(p); continue; }
    // Tangent length for a fillet of radius r in a corner of angle `ang`.
    let tl = r / Math.tan(ang / 2);
    const maxTl = Math.min(l1, l2) * 0.45;
    let rr = r;
    if (tl > maxTl) { tl = maxTl; rr = tl * Math.tan(ang / 2); }
    const t1: Pt = [p[0] + u1[0] * tl, p[1] + u1[1] * tl];
    const t2: Pt = [p[0] + u2[0] * tl, p[1] + u2[1] * tl];
    // Fillet centre lies along the bisector, at distance rr / sin(ang/2).
    const bis: Pt = [u1[0] + u2[0], u1[1] + u2[1]];
    const bl = Math.hypot(bis[0], bis[1]);
    if (bl < 1e-9) { out.push(p); continue; }
    const cd = rr / Math.sin(ang / 2);
    const c: Pt = [p[0] + (bis[0] / bl) * cd, p[1] + (bis[1] / bl) * cd];
    const a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    let a2 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
    // Sweep the short way.
    let sweep = a2 - a1;
    sweep = Math.atan2(Math.sin(sweep), Math.cos(sweep));
    for (let k = 0; k <= arcSteps; k++) {
      const th = a1 + sweep * (k / arcSteps);
      out.push([c[0] + Math.cos(th) * rr, c[1] + Math.sin(th) * rr]);
    }
    void a2;
  }
  return weld(out);
}

/** SVG path `d` for a ring in a 40×40 tile — the picker thumbnail, drawn from the same
 *  points the geometry uses so a tile can never show a shape the model does not make. */
export function ringToThumbPath(ring: Ring, box = 40, pad = 4): string {
  const r = normalize(ring);
  const s = box - pad * 2;
  const d = r.map(([x, y], i) => `${i ? 'L' : 'M'}${(box / 2 + x * s).toFixed(2)} ${(box / 2 - y * s).toFixed(2)}`);
  return d.join(' ') + ' Z';
}

/** How much the outline turns, in radians, within `window` (ring units along the perimeter)
 *  of the point at `t`. Near zero on a straight or gently curved run; a right angle or more
 *  at a heart's point or a star's valley. */
export function turnNear(ring: Ring, t: number, window: number): number {
  const n = ring.length;
  const total = perimeter(ring);
  let acc = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n]!, p = ring[i]!, b = ring[(i + 1) % n]!;
    if (tDistance(ring, acc / total, t) <= window) {
      const a1 = Math.atan2(p[1] - a[1], p[0] - a[0]);
      const a2 = Math.atan2(b[1] - p[1], b[0] - p[0]);
      let d = a2 - a1;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      sum += Math.abs(d);
    }
    acc += Math.hypot(b[0] - p[0], b[1] - p[1]);
  }
  return sum;
}

/** Unit direction from the centroid to the outline point at `t` — the "radial" of a marker.
 *  Used to orient a shape, because a hanging thing hangs with its centroid under the pivot,
 *  and because at a tip the local edge normal is whichever edge the marker happened to land
 *  on while the radial is the tip's own axis. */
export function radialAt(ring: Ring, t: number): Pt {
  const c = centroid(ring);
  const { p } = frameAt(ring, t);
  const len = Math.hypot(p[0] - c[0], p[1] - c[1]);
  return len > 1e-9 ? [(p[0] - c[0]) / len, (p[1] - c[1]) / len] : [0, -1];
}

/**
 * Where a cut should go when nobody said: the middle of the straightest convex run.
 *
 * Every edge midpoint is scored by how much the outline turns within `window` of it along
 * the perimeter, with a concave turn counting many times over — a cut that starts outside a
 * concave corner clips the neighbouring lobe and leaves a loose sliver, which is what the
 * star link did. Ties (a circle turns the same everywhere) go to the point facing left.
 */
export function bestCutT(ring: Ring, window: number, leftPull = 0.02): number {
  const n = ring.length;
  const total = perimeter(ring);
  const c = centroid(ring);
  const edgeLen: number[] = [];
  const cum: number[] = [0];
  for (let i = 0; i < n; i++) {
    const a = ring[i]!, b = ring[(i + 1) % n]!;
    edgeLen.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
    cum.push(cum[i]! + edgeLen[i]!);
  }
  // Signed turn at each vertex: positive = convex on a counter-clockwise ring.
  const turn: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n]!, p = ring[i]!, b = ring[(i + 1) % n]!;
    const a1 = Math.atan2(p[1] - a[1], p[0] - a[0]);
    const a2 = Math.atan2(b[1] - p[1], b[0] - p[0]);
    let d = a2 - a1;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    turn.push(d);
  }
  let best = 0, bestScore = Infinity;
  for (let i = 0; i < n; i++) {
    const mid = cum[i]! + edgeLen[i]! / 2;
    let score = 0;
    for (let j = 0; j < n; j++) {
      let d = Math.abs(cum[j]! - mid);
      d = Math.min(d, total - d);
      if (d > window) continue;
      const w = 1 - d / window;
      score += (turn[j]! < 0 ? 12 : 1) * Math.abs(turn[j]!) * (0.5 + 0.5 * w);
    }
    // Pull toward the left: a whisper for a tie-break, or strong enough to put a hook's gate
    // at mid-height on the side even when the bottom flank is straighter.
    const a = ring[i]!, b = ring[(i + 1) % n]!;
    const mx = (a[0] + b[0]) / 2 - c[0], my = (a[1] + b[1]) / 2 - c[1];
    let da = Math.atan2(my, mx) - Math.PI;
    da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
    score += da * leftPull;
    if (score < bestScore) {
      bestScore = score;
      best = mid / total;
    }
  }
  return best;
}

/**
 * Where a HOOK's gate goes: the point on the outline farthest from any real corner, with a
 * mild pull toward the left at mid-height. `bestCutT` is the link's rule and weights a concave
 * valley twelve times a convex corner — right for a slit that must not sever an arm, wrong for
 * a gate, which it drove out of a star's valleys and into the arm tips. A "real corner" is a
 * run of turns within 1.5 mm adding up to more than 30°, so a filleted corner counts once.
 * `clear` is how far from a corner is far enough (the cut's own footprint plus a little).
 */
export function hookGateT(ring: Ring, clear: number): number {
  const n = ring.length;
  const c = centroid(ring);
  const total = perimeter(ring);
  const turn: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n]!, q = ring[i]!, b = ring[(i + 1) % n]!;
    let d = Math.atan2(b[1] - q[1], b[0] - q[0]) - Math.atan2(q[1] - a[1], q[0] - a[0]);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    turn.push(Math.abs(d));
  }
  const corners: Pt[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) if (Math.hypot(ring[j]![0] - ring[i]![0], ring[j]![1] - ring[i]![1]) < 1.5) sum += turn[j]!;
    if (sum > (30 * Math.PI) / 180) corners.push(ring[i]!);
  }
  let best = 0, bestScore = Infinity, cum = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!, b = ring[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    let d = clear;
    for (const q of corners) d = Math.min(d, Math.hypot(q[0] - mx, q[1] - my));
    let da = Math.atan2(my - c[1], mx - c[0]) - Math.PI;
    da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
    const score = 3 * (clear - d) + 0.6 * da;
    if (score < bestScore) { bestScore = score; best = (cum + len / 2) / total; }
    cum += len;
  }
  return best;
}

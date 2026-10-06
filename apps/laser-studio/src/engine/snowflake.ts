// A six-fold snowflake the way a gift tag cuts one: a HUB drawn in thin lines round a star of
// windows, and six long, thin
// arms growing out of it, each with V branches at 60° and a small ornament on the end. It reads as
// lace because almost all of it is air: every line is as thin as the wood allows and no thicker.
//
// It is built for a tag it is laid on, and that is why it comes in pieces. `islands` is the
// wood — the hub, a solid polygon round the windows; the spines, branches and ornaments; and a
// small fillet in every inside corner — and `windows` is what is cut through it. The same wood
// comes split, `hubWood` and one `arms[k]` per arm, and every arm comes a second time as a
// CUT-OUT (`cutouts[k]`): the arm as the hole a stencil cuts, its ends round and its corners
// soft, its spine starting a web clear of the windows. The gift tag
// (snowflake-gift-tag.ts) crosses its bottom edge through the flake's centre: above
// the edge the arms are cut out of the tag, below it they hang off as wood, and the hub's
// windows go through both — the photo's flake turning from a hole into a silhouette at the edge.
//
// THE DRAWING. Every design is a line drawing in one arm's frame (spine along +Y), turned k·60°,
// and every branch comes as a mirrored pair, so it is D6-symmetric by construction. The hub is a
// closed outline (`grow`: the centre line offset by half a web, round on its points, filleted in
// its valleys) and each window is a cell of that drawing inset by half of every line round it
// (`cell`), so the wood between two windows is exactly one line wide — never a frame of its own.
// (The build before this one framed each window separately; its hub read as a thick saw-toothed
// wheel and its arms as short square stubs, "chunky" beside the photo.)
//
// THE NUMBERS (mm, flat — a bigger flake gets lighter, not heavier):
//   web = spine = 1.5   every line that bounds a window, and every spine: they carry the arms
//                       that hang off the tag (house rule: 1.5 mm where a web carries something)
//   branch = 1.2        a free branch end: nothing hangs on it, so it may be the 1.2 mm floor
//   JOIN = 0.3          radius of every inside corner — the windows' corners, the hub's valleys
//                       and a fillet (`joins`) wherever two pieces of wood cross (against a
//                       ball, the true circle)
// Air is ≥ 1 mm everywhere at 35 mm, the smallest flake the tag offers: two V's on one side sit
// 0.866·Δs·R − 1.2 apart, so Δs ≥ 0.15; a V's tip sits (s − L)·R from the next arm's across the
// bisector. On the tag (0.42·R inside both edges) no V starts between 0.32 and 0.6 of the reach:
// there its branches would run along the top edge or the end a hair off it. So the arms carry
// one or two V's from 0.6 out, and a hub's points on the arms sit either well inside those edges
// (≤ 0.34) or well past them (≥ 0.48), never on them.
// `tests/node/snowflake.test.mjs` measures all of it on the welded outline.
import { circleRing, type Pt, type Shapes } from '@vostok/laser';
import { pointInRing } from '@vostok/shapes';

type Ring = Pt[];

/** The designs, in picker order. The first is the default and the gallery card. */
export const FLAKES = [
  { id: 'classic', label: 'Classic' },
  { id: 'fern', label: 'Fern' },
  { id: 'star', label: 'Star' },
  { id: 'plate', label: 'Plate' },
  { id: 'crystal', label: 'Crystal' },
  { id: 'berry', label: 'Berry' },
] as const;

export type FlakeId = (typeof FLAKES)[number]['id'];

/** Designs an earlier build offered, and the one each opens as now, so a saved tag keeps a
 *  snowflake close to the one it had. */
const RETIRED: Record<string, FlakeId> = { fir: 'fern', petal: 'fern', spark: 'star', frost: 'classic' };

export const isFlakeId = (id: string): id is FlakeId => FLAKES.some((f) => f.id === id);

/** The design `id` names: itself, what a retired id became, or the default. */
export const flakeId = (id: string): FlakeId => (isFlakeId(id) ? id : RETIRED[id] ?? FLAKES[0].id);

/** A snowflake ready to place: centred on the origin, one arm pointing straight up. */
export interface Flake {
  /** The wood: overlapping islands (outer rings only) to union into one — SOLID, every hole of
   *  the union filled, before the windows go through. */
  islands: Shapes;
  /** The windows, cut through the wood and through whatever the flake lies on. */
  windows: Shapes;
  /** The hub's wood alone: the solid round the windows (the berry's is seven discs). */
  hubWood: Shapes;
  /** Each arm's wood, no fillets, `k` = 0…5 counter-clockwise from the one pointing up (arm k
   *  points 90° + k·60°). `joins` over the hub and the arms a design keeps rounds their corners. */
  arms: Shapes[];
  /** Each arm as a cut-out, the same `k`: the hole a stencil cuts for it, its own joins filled.
   *  Strokes end round, every convex corner is rounded to `JOIN` (cut out, those are the wood's
   *  inside corners), and the spine starts a web clear of every window. */
  cutouts: Shapes[];
  /** Centre to arm tip, mm. */
  reach: number;
  /** How far from the centre any window reaches, mm — what shows of the flake inside a tag. */
  hub: number;
  /** The widths it was drawn with, mm. */
  spine: number;
  branch: number;
  web: number;
}

/** Line widths, mm. Flat: the floors are what makes it lace, and a big flake needs no more. */
export const WIDTHS = { spine: 1.5, branch: 1.2, web: 1.5 } as const;
/** Radius of every inside corner, mm. */
export const JOIN = 0.3;

// ------------------------------------------------------------------ primitives --

const area = (r: Ring) => r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]!; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const ccw = (r: Ring): Ring => (area(r) < 0 ? [...r].reverse() : r);
const turn = ([x, y]: Pt, a: number): Pt => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const rad = (deg: number) => (deg * Math.PI) / 180;
/** A unit vector `deg` degrees clockwise from +Y — the arm frame's way of naming a direction. */
const dir = (deg: number): Pt => [Math.sin(rad(deg)), Math.cos(rad(deg))];
/** The point `r` out along `deg`. */
const polar = (deg: number, r: number): Pt => { const d = dir(deg); return [d[0] * r, d[1] * r]; };
const add = (a: Pt, b: Pt, k = 1): Pt => [a[0] + b[0] * k, a[1] + b[1] * k];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

/** Points on the arc round `c`, radius `r`, from angle `a0` to `a1` (radians, the short way),
 *  both ends included, no step over ~10°. */
function arc(c: Pt, r: number, a0: number, a1: number): Pt[] {
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(d) / rad(10)));
  return Array.from({ length: n + 1 }, (_, i) => { const t = a0 + (d * i) / n; return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)] as Pt; });
}
const angleOf = (v: Pt) => Math.atan2(v[1], v[0]);

/** A stroke from `a` to `b`, `w` wide, square at both ends — the start buried in what it grows
 *  from, the far end the crisp square end a laser-cut branch has in the photo. */
function stroke(a: Pt, b: Pt, w: number): Ring {
  const n = unit([-(b[1] - a[1]), b[0] - a[0]]);
  const h = w / 2;
  return ccw([add(a, n, h), add(a, n, -h), add(b, n, -h), add(b, n, h)]);
}

/** The same stroke as a cut-out: its far end round, the cap inside the square end's footprint so
 *  the branch is no longer — or square, `end` false, where a tip buries it — and with `start`, its
 *  start round too, the cap's back point on `a`. */
function capsule(a: Pt, b: Pt, w: number, start = false, end = true): Ring {
  const d = unit(sub(b, a));
  const n: Pt = [-d[1], d[0]];
  const h = w / 2;
  const back: Pt = [-d[0], -d[1]], right: Pt = [-n[0], -n[1]];
  const out: Pt[] = [];
  // Two quarter arcs, never one half: `arc` goes the short way, and half a circle has none.
  if (start) {
    const s = add(a, d, h);
    out.push(...arc(s, h, angleOf(n), angleOf(back)), ...arc(s, h, angleOf(back), angleOf(right)).slice(1));
  } else {
    out.push(add(a, n, h), add(a, n, -h));
  }
  if (end) {
    const e = add(b, d, -h);
    out.push(...arc(e, h, angleOf(right), angleOf(d)), ...arc(e, h, angleOf(d), angleOf(n)).slice(1));
  } else {
    out.push(add(b, n, -h), add(b, n, h));
  }
  return out;
}

/** The ring with every convex corner rounded to `r` (less where an edge is too short to hold it).
 *  Cut out, a tip's points are the inside corners of the wood round it; its concave corners
 *  (an arrow's notch) are the wood's own points and stay. */
function soft(ring: Ring, r = JOIN): Ring {
  const P = ccw(ring);
  const n = P.length;
  return P.flatMap((p, i) => {
    const a = P[(i + n - 1) % n]!, b = P[(i + 1) % n]!;
    const e0 = unit(sub(p, a)), e1 = unit(sub(b, p));
    if (cross(e0, e1) <= 1e-9) return [p];
    const half = (Math.PI - Math.acos(Math.max(-1, Math.min(1, dot(e0, e1))))) / 2;
    const t = Math.min(r / Math.tan(half), 0.45 * Math.min(len(sub(p, a)), len(sub(b, p))));
    const rr = t * Math.tan(half);
    const T1 = add(p, e0, -t), T2 = add(p, e1, t);
    const o = add(T1, [-e0[1], e0[0]], rr);
    return arc(o, rr, angleOf(sub(T1, o)), angleOf(sub(T2, o)));
  });
}

/** A branch, drawn as wood or as a cut-out as the context asks. */
const line = (c: Ctx, a: Pt, b: Pt, w: number): Ring => (c.cut ? capsule(a, b, w) : stroke(a, b, w));

/** A kite along direction `d` (unit), widest at `c`: `front` ahead, `back` behind, `hw` either
 *  side. front = back is a diamond. */
function kite(c: Pt, d: Pt, front: number, back: number, hw: number): Ring {
  const n: Pt = [-d[1], d[0]];
  return ccw([add(c, d, front), add(c, n, hw), add(c, d, -back), add(c, n, -hw)]);
}

/** Where the line through `p` along `d` meets the line through `q` along `e`. */
function meet(p: Pt, d: Pt, q: Pt, e: Pt): Pt {
  const t = cross(sub(q, p), e) / cross(d, e);
  return add(p, d, t);
}

// ------------------------------------------------------------------ lines into wood --

/**
 * A window: the convex cell whose corners are `pts` (centres of the lines round it), each side
 * pulled in by `hs[i]`, the half-width of the line along side i (pts[i] → pts[i + 1]), and its
 * corners rounded to `r`. So the wood left between two windows is exactly the line between them.
 */
function cell(pts: Pt[], hs: number[], r = JOIN): Ring {
  const n = pts.length;
  const flip = area(pts) < 0;
  const P = flip ? [...pts].reverse() : pts;
  const H = flip ? P.map((_, j) => hs[(2 * n - 2 - j) % n]!) : hs;
  const d = P.map((p, i) => unit(sub(P[(i + 1) % n]!, p)));
  const inward = d.map(([x, y]): Pt => [-y, x]);
  // Each side's line moved in by its half-width plus the rounding; the corners are where they meet.
  const on = P.map((p, i) => add(p, inward[i]!, H[i]! + r));
  const V = P.map((_, i) => { const j = (i + n - 1) % n; return meet(on[j]!, d[j]!, on[i]!, d[i]!); });
  V.forEach((v, i) => {
    if (dot(sub(V[(i + 1) % n]!, v), d[i]!) <= 0) throw new Error('snowflake: a window closed up — its lines are wider than the cell');
  });
  return V.flatMap((v, i) => {
    const j = (i + n - 1) % n;
    return arc(v, r, angleOf([-inward[j]![0], -inward[j]![1]]), angleOf([-inward[i]![0], -inward[i]![1]]));
  });
}

/**
 * The hub: the closed centre line `pts` grown outward by `h` (half a web) into one solid polygon —
 * round on its points (the round join a drawn line has there) and filleted to `r` in its valleys,
 * the inside corners where two of its lines meet.
 */
function grow(pts: Pt[], h: number, r = JOIN): Ring {
  const P = ccw(pts);
  const n = P.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = P[i]!;
    const e0 = unit(sub(p, P[(i + n - 1) % n]!)), e1 = unit(sub(P[(i + 1) % n]!, p));
    const m0: Pt = [e0[1], -e0[0]], m1: Pt = [e1[1], -e1[0]];
    const c = cross(e0, e1);
    if (Math.abs(c) < 1e-9) { out.push(add(p, m0, h)); continue; }
    if (c > 0) { out.push(...arc(p, h, angleOf(m0), angleOf(m1))); continue; }
    // A valley: the two grown sides meet at X; round the corner there.
    const X = add(p, add(m0, m1), h / (1 + dot(m0, m1)));
    const half = Math.acos(Math.max(-1, Math.min(1, dot([-e0[0], -e0[1]], e1)))) / 2;
    const t = r / Math.tan(half);
    const T1 = add(X, e0, -t), T2 = add(X, e1, t);
    const o = add(X, unit(sub(e1, e0)), r / Math.sin(half));
    out.push(...arc(o, r, angleOf(sub(T1, o)), angleOf(sub(T2, o))));
  }
  return out;
}

/**
 * Fillets: wherever an edge of one ring crosses an edge of another and the corner is really on
 * the outline (no third ring covers it), a sliver of wood that rounds the inside corner to `r`.
 * A laser cuts a sharp inside corner, but it is where a branch snaps and where char collects,
 * and the photo's joins are soft. With `base`, only its crossings with `rings` — the tag's edge
 * where the arms run into it. Every ring is taken as the wood it bounds (orientation ignored).
 * `straight` is for rings that are CUT OUT: there a fillet only softens a point of the wood
 * between two slots, so it fits itself to the straight run at the crossing and is left out where
 * there is none — laid on round a slot's soft corner it would leave a kink in the cut.
 */
export function joins(rings: Ring[], r = JOIN, base?: Ring, straight = false): Ring[] {
  const all = (base ? [base, ...rings] : rings).map(ccw);
  const box = all.map((q) => q.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]));
  const hit = (k: number, [x, y]: Pt) => x > box[k]![0] && x < box[k]![2] && y > box[k]![1] && y < box[k]![3];
  const round = all.map(circleOf);
  const covered = (p: Pt, i: number, j: number) => all.some((q, k) => k !== i && k !== j && hit(k, p) && pointInRing(p, q));
  const out: Ring[] = [];
  for (let i = 0; i < (base ? 1 : all.length); i++) {
    for (let j = i + 1; j < all.length; j++) {
      const bi = box[i]!, bj = box[j]!;
      if (bi[0] > bj[2] || bj[0] > bi[2] || bi[1] > bj[3] || bj[1] > bi[3]) continue;
      const A = all[i]!, B = all[j]!;
      // A ball against a straight edge is filleted against the true circle — its short chords
      // would each bend a fillet laid along them. Two balls never meet in the open here (the
      // berry's petals cross under a spine or the heart), so that pair is left alone.
      const ball = round[i] ?? round[j];
      if (round[i] && round[j]) continue;
      if (ball) {
        const [L, K] = round[i] ? [B, A] : [A, B];
        for (let e = 0; e < L.length; e++) {
          for (const { p, t } of cuts(L[e]!, L[(e + 1) % L.length]!, ball)) {
            if (covered(p, i, j)) continue;
            const f = ballFillet(p, L, e, t, K, ball, r, straight);
            if (f) out.push(f);
          }
        }
        continue;
      }
      for (let a = 0; a < A.length; a++) {
        const a0 = A[a]!, da = sub(A[(a + 1) % A.length]!, a0);
        for (let b = 0; b < B.length; b++) {
          const b0 = B[b]!, db = sub(B[(b + 1) % B.length]!, b0);
          const den = cross(da, db);
          if (Math.abs(den) < 1e-12) continue;
          const t = cross(sub(b0, a0), db) / den, u = cross(sub(b0, a0), da) / den;
          if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) continue;
          const p = add(a0, da, t);
          if (covered(p, i, j)) continue;
          const f = fillet(p, A, a, t, B, b, u, r, straight);
          if (f) out.push(f);
        }
      }
    }
  }
  return out;
}

/** The fillet at `p`, where edge `a` of ring A (at `t` along it) crosses edge `b` of ring B (at
 *  `u`), both CCW: the corner between the two edges' runs OUT of the other ring is the air, and
 *  the fillet fills its point — smaller where an edge runs out before it fits. It reaches a hair
 *  into the wood either side so the union welds it. */
function fillet(p: Pt, A: Ring, a: number, t: number, B: Ring, b: number, u: number, r: number, straight = false): Ring | null {
  const ua = unit(sub(A[(a + 1) % A.length]!, A[a]!)), ub = unit(sub(B[(b + 1) % B.length]!, B[b]!));
  const out = cross(ub, ua) < 0;
  const u1: Pt = out ? ua : [-ua[0], -ua[1]], u2: Pt = out ? [-ub[0], -ub[1]] : ub;
  const room = Math.min(run(A, a, t, out, straight), run(B, b, u, !out, straight));
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
  if (theta > rad(175) || theta < rad(2)) return null;
  const rr = Math.min(r, 0.9 * room * Math.tan(theta / 2));
  if (straight && rr < 0.05) return null;
  const s = rr / Math.tan(theta / 2);
  const bis = unit(add(u1, u2));
  const o = add(p, bis, rr / Math.sin(theta / 2));
  const T1 = add(p, u1, s), T2 = add(p, u2, s);
  const m1: Pt = dot([-u1[1], u1[0]], u2) < 0 ? [-u1[1], u1[0]] : [u1[1], -u1[0]];
  const m2: Pt = dot([-u2[1], u2[0]], u1) < 0 ? [-u2[1], u2[0]] : [u2[1], -u2[0]];
  const d = 0.02;
  return ccw([add(p, bis, -d), add(T1, m1, d), ...arc(o, rr, angleOf(sub(T1, o)), angleOf(sub(T2, o))), add(T2, m2, d)]);
}

/** How far a ring's edge runs on from the point `t` along its edge `i` — forward, or back —
 *  carrying on round later edges while they bend less than 20° from it in all: a ball's many
 *  short chords are one smooth edge to a fillet, a branch's square end is not. `straight`: only
 *  while they bend under 1°, the straight run itself. */
function run(ring: Ring, i: number, t: number, forward: boolean, straight = false): number {
  const n = ring.length;
  const edge = (k: number) => sub(ring[(k + 1) % n]!, ring[k]!);
  const d0 = unit(edge(i));
  let total = (forward ? 1 - t : t) * len(edge(i));
  for (let s = 1; s < n && total < 3; s++) {
    const e = edge(((forward ? i + s : i - s) % n + n) % n);
    if (dot(unit(e), d0) < Math.cos(rad(straight ? 1 : 20))) break;
    total += len(e);
  }
  return total;
}

interface Circle {
  c: Pt;
  r: number;
}

/** The circle a ring was drawn from, if it is one (a ball, a berry, a petal). */
function circleOf(ring: Ring): Circle | null {
  if (ring.length < 16) return null;
  const c: Pt = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  const d = ring.map((p) => len(sub(p, c)));
  const r = d.reduce((s, x) => s + x, 0) / d.length;
  return d.every((x) => Math.abs(x - r) < 1e-6 * Math.max(1, r)) ? { c, r } : null;
}

/** Where the segment `a`–`b` crosses the circle: the points, and how far along the segment. */
function cuts(a: Pt, b: Pt, k: Circle): { p: Pt; t: number }[] {
  const d = sub(b, a), w = sub(a, k.c);
  const A = dot(d, d), B = 2 * dot(w, d), C = dot(w, w) - k.r * k.r;
  const q = B * B - 4 * A * C;
  if (q <= 0) return [];
  return [(-B - Math.sqrt(q)) / (2 * A), (-B + Math.sqrt(q)) / (2 * A)].filter((t) => t > 1e-9 && t < 1 - 1e-9).map((t) => ({ p: add(a, d, t), t }));
}

/** Where the ray from `c` through `q` leaves the ring `K` — `q` moved onto the polygon a circle
 *  was drawn as, so a fillet ends on the cut line and not a few microns off it. */
function onRing(K: Ring, c: Pt, q: Pt): Pt {
  const u = unit(sub(q, c));
  let best = q, gap = Infinity;
  for (let i = 0; i < K.length; i++) {
    const a = K[i]!, dk = sub(K[(i + 1) % K.length]!, a);
    const den = cross(u, dk);
    if (Math.abs(den) < 1e-12) continue;
    const s = cross(sub(a, c), dk) / den, v = cross(sub(a, c), u) / den;
    if (s > 0 && v >= 0 && v <= 1) { const x = add(c, u, s); const g = len(sub(x, q)); if (g < gap) { gap = g; best = x; } }
  }
  return best;
}

/** The fillet where edge `e` of the CCW ring `L` (at `t` along it) runs into the ball `k` (drawn
 *  as the ring `K`): the circle of radius `r` touching the edge's line from outside `L` and the
 *  ball from outside it. */
function ballFillet(p: Pt, L: Ring, e: number, t: number, K: Ring, k: Circle, r: number, straight = false): Ring | null {
  const ua = unit(sub(L[(e + 1) % L.length]!, L[e]!));
  const fwd = dot(ua, sub(p, k.c)) > 0;
  const u1: Pt = fwd ? ua : [-ua[0], -ua[1]];
  const air: Pt = [ua[1], -ua[0]];
  const room = run(L, e, t, fwd, straight);
  for (let rr = r; rr >= 0.05; rr *= 0.8) {
    const w = sub(add(p, air, rr), k.c);
    const b = dot(w, u1), q = b * b - (dot(w, w) - (k.r + rr) ** 2);
    if (q < 0) return null;
    const x = -b + Math.sqrt(q);
    if (x <= 0 || x > 0.9 * room) continue;
    const T1 = add(p, u1, x), o = add(T1, air, rr);
    const T2 = add(k.c, unit(sub(o, k.c)), k.r);
    const d = 0.02;
    const rim = arc(k.c, k.r - d, angleOf(sub(T2, k.c)), angleOf(sub(p, k.c)));
    return ccw([add(T1, air, -d), ...arc(o, rr, angleOf(sub(T1, o)), angleOf(sub(T2, o))).slice(0, -1), onRing(K, k.c, T2), ...rim, add(add(p, air, -d), unit(sub(p, k.c)), -d)]);
  }
  return null;
}

// ------------------------------------------------------------------ hubs --
//
// Each hub is a star of windows round the heart, every window one line from the next — on a tag
// the arms vanish into the wood and only the windows show, so a window on its own would read as a
// stray punched hole. Stations are fractions of R.

interface Ctx {
  R: number;
  ws: number;
  wb: number;
  web: number;
  /** Drawing an arm as a cut-out: round ends, soft corners. */
  cut?: boolean;
}

/** A hub: the centre line of its outline all the way round (or its wood ready drawn, `solid`),
 *  the windows in one arm's sector (turned with the arm), the windows drawn once (a centre), and
 *  the station the spine leaves it from. */
interface Hub {
  outline?: Pt[];
  solid?: Ring[];
  cells: Ring[];
  centre?: Ring[];
  from: number;
}

const O: Pt = [0, 0];
/** One sector's points, counter-clockwise, turned round all six arms. */
const around = (sector: Pt[]): Pt[] => [0, 1, 2, 3, 4, 5].flatMap((k) => sector.map((p) => turn(p, (k * Math.PI) / 3)));

/** A hexagon cut in six: its corners on the arms at `rho`, the spines running through it from the
 *  heart, a triangle window between every two. */
function pie(c: Ctx, rho: number): Hub {
  const { R, ws, web } = c;
  const A = polar(0, rho * R), B = polar(-60, rho * R);
  return { outline: around([A]), cells: [cell([O, A, B], [ws / 2, web / 2, ws / 2])], from: rho };
}

/** Six broad kites, one between every two arms, pointing out along the bisector to `p`; the
 *  spines run between them to the valleys at `a`. */
function kites6(c: Ctx, a: number, p: number): Hub {
  const { R, ws, web } = c;
  const S = polar(0, a * R), P = polar(-30, p * R), S2 = polar(-60, a * R);
  return { outline: around([S, P]), cells: [cell([O, S, P, S2], [ws / 2, web / 2, web / 2, ws / 2])], from: a };
}

/** Six long diamonds, one on every arm, pointing out to `p` where the spine begins; a web on each
 *  bisector between them to the valley at `v`. */
function diamonds6(c: Ctx, v: number, p: number): Hub {
  const { R, web } = c;
  const T = polar(0, p * R), V1 = polar(30, v * R), V2 = polar(-30, v * R);
  return { outline: around([T, V2]), cells: [cell([O, V1, T, V2], [web / 2, web / 2, web / 2, web / 2])], from: p };
}

/** The open six-pointed star: two triangles' outlines, points at `p` on the arms. The hexagon
 *  they cross in is one window and each point another, so the heart is open. */
function hexagram(c: Ctx, p: number): Hub {
  const { R, web } = c;
  const v = p / Math.sqrt(3);
  const T = polar(0, p * R), V1 = polar(30, v * R), V2 = polar(-30, v * R);
  const h = web / 2;
  return { outline: around([T, V2]), cells: [cell([V1, T, V2], [h, h, h])], centre: [cell(around([V2]), [h, h, h, h, h, h])], from: p };
}

/** A hexagonal plate with an open heart: an inner hexagon ring at `r1` round a hexagonal window,
 *  an outer one at `r2`, the spokes along the arms between them, a window in every bay. */
function hexRing(c: Ctx, r1: number, r2: number): Hub {
  const { R, ws, web } = c;
  const A1 = polar(0, r1 * R), A2 = polar(0, r2 * R), B2 = polar(-60, r2 * R), B1 = polar(-60, r1 * R);
  const h = web / 2;
  return {
    outline: around([A2]),
    cells: [cell([A1, A2, B2, B1], [ws / 2, h, ws / 2, h])],
    centre: [cell(around([A1]), [h, h, h, h, h, h])],
    from: r2,
  };
}

/** Seven round windows, one in the heart and six round it on the bisectors `rho` out, each a web
 *  from the next; the wood a scalloped flower — a disc a web wider round each — and the spines
 *  from the cusps where two petals cross, just under which they start. (Seven discs cover the
 *  middle whole while a window is under 8 mm across, which it is at every size the tag offers.) */
function flower(c: Ctx, rho: number): Hub {
  const { R, web } = c;
  const d = rho * R;
  const rw = (d - web) / 2;
  const rd = rw + web;
  const cusp = 0.5 * Math.sqrt(3) * d + Math.sqrt(rd * rd - (d * d) / 4);
  const disc = (p: Pt, r: number) => ccw(circleRing(p[0], p[1], r, 96));
  const m = polar(-30, d);
  return {
    solid: [disc(O, rd), ...[0, 1, 2, 3, 4, 5].map((k) => disc(turn(m, (k * Math.PI) / 3), rd))],
    cells: [disc(m, rw)],
    centre: [disc(O, rw)],
    from: (cusp - 0.3) / R,
  };
}

// ------------------------------------------------------------------ arms --

/** A mirrored pair of branches leaving the spine at station `s`, `L` long, `deg`° off it (60°:
 *  the angle ice grows at), `w` wide; `end` hangs an ornament on each branch's end, and then the
 *  branch carries it and must be a web wide. */
function vee(c: Ctx, s: number, L: number, o: { w?: number; deg?: number; end?: (at: Pt) => Ring } = {}): Ring[] {
  const out: Ring[] = [];
  for (const side of [1, -1]) {
    const a: Pt = [0, s * c.R];
    const b = add(a, dir(side * (o.deg ?? 60)), L * c.R);
    out.push(line(c, a, b, o.w ?? c.wb));
    if (o.end) out.push(o.end(b));
  }
  return out;
}

/** A pair of branches that branch again: from station `s`, `L` long and a web wide (they carry
 *  a twig each), the twig `f` of the way out and running outward beside the spine, `l` long. (A
 *  second twig, back toward the heart, ended a hair from the tag's edge wherever the arm crossed
 *  it; it went.) */
function branched(c: Ctx, s: number, L: number, f: number, l: number): Ring[] {
  const out: Ring[] = [];
  for (const side of [1, -1]) {
    const a: Pt = [0, s * c.R];
    const d = dir(side * 60);
    const m = add(a, d, f * L * c.R);
    out.push(line(c, a, add(a, d, L * c.R), c.web), line(c, m, add(m, dir(0), l * c.R), c.wb));
  }
  return out;
}

/** An arm's end: the ornament and how far up the spine runs to meet it, mm. Every ornament's far
 *  point is exactly on the reach. */
interface Tip {
  rings: Ring[];
  at: number;
}

/** A tip's polygon as the context draws it: as wood, sharp; as a cut-out, its points soft. */
const tipRing = (c: Ctx, ring: Ring): Ring => (c.cut ? soft(ring) : ring);

/** A small diamond, `hl` each way along the arm and `hw` either side of it. */
function diamondTip(c: Ctx, hl: number, hw: number): Tip {
  const at = c.R - hl * c.R;
  return { rings: [tipRing(c, kite([0, at], [0, 1], hl * c.R, hl * c.R, Math.max(hw * c.R, c.ws / 2 + 0.45)))], at };
}

/** The spine drawn out to a point over its last `L` — a spear, nothing wider than the spine. */
function pointTip(c: Ctx, L: number): Tip {
  const at = c.R - L * c.R;
  // Cut out, the spear's base corners would round off where it meets the spine's end and leave a
  // step in the slot; drawn a spine's width down into the spine, only its point is exposed — and
  // the spine stops half a width short, inside it, so its square corners never touch the edge.
  if (c.cut) return { rings: [soft([[-c.ws / 2, at - c.ws], [c.ws / 2, at - c.ws], [c.ws / 2, at], [0, c.R], [-c.ws / 2, at]])], at: at - c.ws / 2 };
  return { rings: [ccw([[-c.ws / 2, at], [c.ws / 2, at], [0, c.R]])], at };
}

/** A small square block, `a` across (never under the spine + 0.8 mm, so its shoulders take a
 *  fillet), its far corners on the reach — the photo's square tips. */
function blockTip(c: Ctx, a: number): Tip {
  const s = Math.max(a * c.R, c.ws + 0.8);
  const far = Math.sqrt(c.R ** 2 - (s / 2) ** 2);
  return { rings: [tipRing(c, ccw([[-s / 2, far - s], [s / 2, far - s], [s / 2, far], [-s / 2, far]]))], at: far - s / 2 };
}

/** An arrowhead, `L` long and `hw` either side, its back notched so the barbs read. */
function arrowTip(c: Ctx, L: number, hw: number): Tip {
  const { R } = c;
  // The barbs stand clear of the spine by more than the 1 mm of air a pocket under them needs.
  const l = L * R, w = Math.max(hw * R, c.ws / 2 + 1.2);
  const notch = R - 0.75 * l;
  return { rings: [tipRing(c, ccw([[0, R], [-w, R - l], [0, notch], [w, R - l]]))], at: notch + 0.3 };
}

/** A ball, `r` in radius — never so small it does not read as a ball on its stem. */
function ballTip(c: Ctx, r: number): Tip {
  const rr = Math.max(r * c.R, c.ws / 2 + 0.5);
  return { rings: [ccw(circleRing(0, c.R - rr, rr, 96))], at: c.R - rr };
}

/** A berry on a branch's end. */
const berry = (c: Ctx, r: number) => (at: Pt): Ring => ccw(circleRing(at[0], at[1], Math.max(r * c.R, c.web / 2 + 0.4), 96));

// ------------------------------------------------------------------ the designs --
//
// Six that differ where it shows: in the hub (all a tag shows of the flake) and in the arms (all
// that breaks out past its edge). Set by eye beside the photo, held by the suite at every size.

interface Design {
  hub: Hub;
  tip: Tip;
  arm: Ring[];
}

const DESIGNS: Record<FlakeId, (c: Ctx) => Design> = {
  /** The photo's: a bold star of six diamonds, a long V and a short one, a small diamond on
   *  the end — the classic dendrite. */
  classic: (c) => ({ hub: diamonds6(c, 0.26, 0.48), tip: diamondTip(c, 0.06, 0.05), arm: [...vee(c, 0.62, 0.3), ...vee(c, 0.78, 0.17)] }),
  /** A frond on every arm: six broad kites in the heart between the arms, two short V's and the
   *  spine drawn out to a spear point. */
  fern: (c) => ({ hub: kites6(c, 0.26, 0.39), tip: pointTip(c, 0.12), arm: [...vee(c, 0.6, 0.2), ...vee(c, 0.75, 0.15)] }),
  /** The open six-pointed star in the heart, one long V, arrowheads on the ends. */
  star: (c) => ({ hub: hexagram(c, 0.56), tip: arrowTip(c, 0.16, 0.09), arm: vee(c, 0.66, 0.26) }),
  /** A hexagonal plate with an open heart and a ring of bays; one wide V and a small square block
   *  on each arm — the plate crystal. (A crossbar read as a cross on the up arm; it went.) */
  plate: (c) => ({ hub: hexRing(c, 0.14, 0.34), tip: blockTip(c, 0.07), arm: vee(c, 0.68, 0.17, { deg: 70 }) }),
  /** A hexagon cut in six, and branches that branch again, a diamond on the end. */
  crystal: (c) => ({ hub: pie(c, 0.34), tip: diamondTip(c, 0.07, 0.05), arm: branched(c, 0.6, 0.34, 0.55, 0.17) }),
  /** Seven round windows in a scalloped heart, berries on fine stems. */
  berry: (c) => ({ hub: flower(c, 0.24), tip: ballTip(c, 0.065), arm: vee(c, 0.64, 0.22, { w: c.web, end: berry(c, 0.06) }) }),
};

// ------------------------------------------------------------------ the flake --

/** Design `id` at `diameter` mm, drawn: its hub, its six arms (no fillets yet) and its windows.
 *  With `cut`, the arms are drawn as cut-outs. */
function drawn(id: string, diameter: number, cut = false) {
  const R = diameter / 2;
  const c: Ctx = { R, ws: WIDTHS.spine, wb: WIDTHS.branch, web: WIDTHS.web, cut };
  const d = DESIGNS[flakeId(id)](c);
  const hub = d.hub.solid ?? [grow(d.hub.outline!, c.web / 2)];
  const windows: Ring[] = [...(d.hub.centre ?? [])];
  for (let k = 0; k < 6; k++) windows.push(...d.hub.cells.map((r) => r.map((p) => turn(p, (k * Math.PI) / 3))));
  // As wood the spine grows out of the hub; cut out, it starts where a web of wood is left
  // between it and every window, that end round. Its far end stays square, buried in the tip as
  // the wood's is: a round one would show between the tip's back edges as a bulge.
  const spine = cut
    ? capsule([0, clearStart(windows, d.hub.from * R, d.tip.at, c)], [0, d.tip.at], c.ws, true, false)
    : stroke([0, d.hub.from * R], [0, d.tip.at], c.ws);
  const arm = [spine, ...d.tip.rings, ...d.arm];
  const arms = [0, 1, 2, 3, 4, 5].map((k) => arm.map((r) => r.map((p) => turn(p, (k * Math.PI) / 3))));
  return { R, hub, arms, wood: arms.flat(), windows };
}

/** The distance from the segment `a`–`b` to the ring's outline (0 where they cross). */
function segRingGap(a: Pt, b: Pt, ring: Ring): number {
  const toSeg = (p: Pt, q: Pt, r: Pt) => {
    const d = sub(r, q);
    const t = Math.max(0, Math.min(1, dot(sub(p, q), d) / (dot(d, d) || 1)));
    return len(sub(p, add(q, d, t)));
  };
  return ring.reduce((m, q, i) => {
    const r = ring[(i + 1) % ring.length]!;
    const s1 = cross(sub(b, a), sub(q, a)), s2 = cross(sub(b, a), sub(r, a));
    const s3 = cross(sub(r, q), sub(a, q)), s4 = cross(sub(r, q), sub(b, q));
    if (s1 > 0 !== s2 > 0 && s3 > 0 !== s4 > 0) return 0;
    return Math.min(m, toSeg(a, q, r), toSeg(b, q, r), toSeg(q, a, b), toSeg(r, a, b));
  }, Infinity);
}

/** The lowest station from `from` (mm up the arm) at which a cut-out spine running to `at` leaves
 *  at least a web of wood between itself and every window — halved down to a micron. */
function clearStart(windows: Ring[], from: number, at: number, c: Ctx): number {
  const ok = (y: number) => windows.every((w) => segRingGap([0, y + c.ws / 2], [0, at - c.ws / 2], w) >= c.web + c.ws / 2 - 1e-6);
  if (ok(from)) return from;
  let lo = from, hi = at - c.ws;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
  return hi;
}

const far = (r: Ring) => r.reduce((m, p) => Math.max(m, Math.hypot(p[0], p[1])), 0);

/**
 * Design `id` at `diameter` mm across its arm tips, centred on the origin, one arm up — drawn at
 * `drawnAt` mm in the widths above and scaled to `diameter`. Drawn at its own size it is lace; drawn
 * smaller and scaled up it is the same design in bolder lines, every gap, window and corner grown
 * in proportion, so whatever held where it was drawn holds bigger.
 */
export function snowflake(id: string, diameter: number, drawnAt = diameter): Flake {
  const { hub, arms, wood, windows } = drawn(id, drawnAt);
  const cut = drawn(id, drawnAt, true).arms;
  const all = [...hub, ...wood];
  const k = diameter / drawnAt;
  const islands = (rings: Ring[]): Shapes => rings.map((r) => [k === 1 ? r : r.map(([x, y]): Pt => [x * k, y * k])]);
  return {
    islands: islands([...all, ...joins(all)]),
    windows: islands(windows),
    hubWood: islands(hub),
    arms: arms.map(islands),
    cutouts: cut.map((rings) => islands([...rings, ...joins(rings, JOIN, undefined, true)])),
    reach: k * all.reduce((m, r) => Math.max(m, far(r)), 0),
    hub: k * windows.reduce((m, r) => Math.max(m, far(r)), 0),
    spine: k * WIDTHS.spine,
    branch: k * WIDTHS.branch,
    web: k * WIDTHS.web,
  };
}

/** Shapes turned `deg` degrees counter-clockwise and moved to `(x, y)`. */
export function placeFlake(shapes: Shapes, x: number, y: number, deg: number): Shapes {
  const a = rad(deg);
  return shapes.map((island) => island.map((r) => r.map((p): Pt => { const q = turn(p, a); return [q[0] + x, q[1] + y]; })));
}

/**
 * The picker tile: the design at the tag's default 40 mm in a 40 × 40 box. The kit fills a tile
 * with the non-zero rule, so the hub is drawn solid — one ring, or the berry's discs, each window
 * inside exactly one — and the windows reversed inside it (winding 1 − 1 = 0: open); nothing else
 * crosses a window. The fillets are left out —
 * at a pixel a millimetre they are invisible, and they are most of the numbers.
 */
export function flakeThumb(id: string): string {
  const { R, hub, wood, windows } = drawn(id, 40);
  const k = 18.5 / R;
  const n = (v: number) => v.toFixed(2);
  const path = (r: Ring) => `M${r.map(([x, y]) => `${n(20 + x * k)} ${n(20 - y * k)}`).join('L')}Z`;
  const cw = (r: Ring): Ring => (area(r) > 0 ? [...r].reverse() : r);
  return [...hub.map((r) => path(ccw(r))), ...wood.map((r) => path(ccw(r))), ...windows.map((r) => path(cw(r)))].join('');
}

import { bboxOf, holeCentre, signedArea, type Box, type Shapes, type Keyring } from '@vostok/laser';
// The scan line lives next door (it was written for the topper's word spaces and legs, and it is
// the same primitive a bridge needs): every material interval a row or a column crosses.
import { columnSpans, rowSpans, type Span } from './cake-topper-geom';
import { subdivideShapes } from './warp';

type Pt = [number, number];
export type EditableKeyring = Keyring & { position?: number; rest?: [number, number]; restInside?: boolean };

/** A continuous track around the actual outer contour, with outward vertex normals. */
export function holeTrack(shapes: Shapes, k: EditableKeyring): Pt[] {
  const ring = shapes.reduce<Pt[]>((a, island) => Math.abs(signedArea(island[0] ?? [])) > Math.abs(signedArea(a)) ? island[0]! : a, []);
  const sign = signedArea(ring) >= 0 ? 1 : -1;
  const distance = k.mode === 'inside' ? -(k.ring + k.dia / 2) : k.dia / 2 + k.ring / 2;
  return ring.map((p, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length]!;
    const next = ring[(i + 1) % ring.length]!;
    const normal = (a: Pt, b: Pt): Pt => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [sign * (b[1] - a[1]) / len, -sign * (b[0] - a[0]) / len];
    };
    const a = normal(prev, p), b = normal(p, next);
    const nx = a[0] + b[0], ny = a[1] + b[1];
    const len = Math.hypot(nx, ny) || 1;
    return [p[0] + distance * nx / len, p[1] + distance * ny / len];
  });
}

/** The whole track's length, mm — one nudge step is a fraction of it. */
export function trackLength(track: Pt[]): number {
  return track.reduce((sum, p, i) => sum + Math.hypot(p[0] - track[(i + 1) % track.length]![0], p[1] - track[(i + 1) % track.length]![1]), 0);
}

export function pointOnTrack(track: Pt[], position: number): Pt {
  const lengths = track.map((p, i) => Math.hypot(p[0] - track[(i + 1) % track.length]![0], p[1] - track[(i + 1) % track.length]![1]));
  let at = ((position % 1 + 1) % 1) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < track.length; i++) {
    const len = lengths[i]!;
    if (at <= len || i === track.length - 1) {
      const a = track[i]!, b = track[(i + 1) % track.length]!;
      const t = len ? at / len : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    at -= len;
  }
  return [0, 0];
}

export function keyringCentre(shapes: Shapes, k: EditableKeyring): Pt {
  // A template that knows the natural hanging point names it; the drag and the pad move from there.
  if (k.rest) return k.rest;
  // A tab resting INSIDE rests where a punched hole did: on the inward track, `ring + dia/2` in
  // from the edge, so its border is the part's own material (2026-09-28). Only the resting point
  // is read that way — the tab itself stays `'outside'`, so nothing holds it there.
  const at: EditableKeyring = k.restInside ? { ...k, mode: 'inside' } : k;
  return at.position != null && at.position >= 0 ? pointOnTrack(holeTrack(shapes, at), at.position) : holeCentre(shapes, at);
}

export function closestHole(track: Pt[], p: Pt) {
  let distance = Infinity, travelled = 0, at = 0;
  let centre: Pt = [0, 0];
  for (let i = 0; i < track.length; i++) {
    const a = track[i]!, b = track[(i + 1) % track.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len))) : 0;
    const q: Pt = [a[0] + t * dx, a[1] + t * dy];
    const dist = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (dist < distance) { distance = dist; centre = q; at = travelled + t * len; }
    travelled += len;
  }
  return { centre, position: travelled ? at / travelled : 0 };
}

/**
 * A join laid FLAT along the axis the two pieces are separated on, or null when they are not
 * separated that way.
 *
 * Two words side by side, or two lines of a name stacked, are a deliberate space — and the true
 * nearest pair of points across one is almost never a pair a reader would accept: it runs
 * diagonally through the middle of both letters and reads as a scratch across the piece, not as
 * a join ("Mr & Mrs", "Ava / Rose"). What a signwriter draws instead is a foot along the
 * baseline, or an ascender touching the line above.
 *
 * So the scan line picks the join: the row (or column) where the two pieces come closest with
 * real material either side, preferring the bottom third for a word gap so the bar lands at the
 * feet of the letters rather than across their waists. The ends are buried `bite` mm inside the
 * material they land on, so the bar is a weld and not a tangent.
 */
function axisJoin(
  left: Shapes[number],
  right: Shapes[number],
  axis: 'x' | 'y',
  width: number,
  lo: number,
  hi: number,
  preferLow: boolean,
): { pa: Pt; pb: Pt } | null {
  const spansOf = axis === 'x' ? rowSpans : columnSpans;
  const step = 0.25;
  const bite = Math.max(0.4, Math.min(0.6, width / 2));
  let bestGap = Infinity;
  let found: { pa: Pt; pb: Pt } | null = null;
  // Two passes when the baseline third is preferred: the band the join wants, then the whole
  // overlap if nothing in it has material on both sides.
  const bands: [number, number][] = preferLow && hi - lo > 3 * step ? [[lo, lo + (hi - lo) / 3], [lo, hi]] : [[lo, hi]];
  for (const [from, to] of bands) {
    for (let at = from; at <= to + 1e-9; at += step) {
      const sl: Span[] = spansOf([left], at);
      const sr: Span[] = spansOf([right], at);
      const l = sl[sl.length - 1];
      const r = sr[0];
      if (!l || !r) continue;
      const gap = r[0] - l[1];
      // Thick enough on both sides that burying the ends lands in material, not past it.
      if (gap <= 0.05 || l[1] - l[0] < 2 * bite || r[1] - r[0] < 2 * bite) continue;
      if (gap >= bestGap) continue;
      bestGap = gap;
      found = axis === 'x'
        ? { pa: [l[1] - bite, at], pb: [r[0] + bite, at] }
        : { pa: [at, l[1] - bite], pb: [at, r[0] + bite] };
    }
    if (found) return found;
  }
  return found;
}

/** Connect only disconnected offset islands with short bridges, never a box-wide strip. */
export function nearestBridge(a: Shapes, b: Shapes, width: number): Shapes {
  let pa: Pt = [0, 0], pb: Pt = [0, 0], best = Infinity;
  let ia = 0, ib = 0;
  // EVERY ring of every island, holes included — a hole's edge is material's edge too, and it is
  // routinely the nearest material there is. The case that taught it: the dot of an "i" in a name
  // welded into a frame. The island the dot has to reach is the frame, whose OUTER ring is the
  // ball's circumference; measured against that alone, "Elsie" got a 20 mm diagonal strut across
  // the window and out through the rim, when the stem of the i — the window's own edge, 2 mm
  // below the dot — was what the tittle wanted.
  const sample = (s: Shapes) => s.flatMap((island, index) =>
    island.flatMap((r) => r.filter((_, i) => i % Math.max(1, Math.floor(r.length / 128)) === 0).map((p) => ({ p, index }))));
  // The closest point on an island's EDGES, not its nearest vertex: a straight side has
  // vertices only at its corners, and a bridge anchored to a corner runs diagonally and comes
  // out wider than it was drawn. Both directions are tried, so the answer is the true nearest
  // pair whichever side the corner is on.
  const nearestOnEdge = (p: Pt, s: Shapes): { q: Pt; d: number; index: number } => {
    let q: Pt = p, d = Infinity, index = 0;
    s.forEach((island, i) => {
      for (const r of island) {
        for (let k = 0; k < r.length; k++) {
          const u = r[k]!, v = r[(k + 1) % r.length]!;
          const vx = v[0] - u[0], vy = v[1] - u[1];
          const len2 = vx * vx + vy * vy || 1e-12;
          const t = Math.max(0, Math.min(1, ((p[0] - u[0]) * vx + (p[1] - u[1]) * vy) / len2));
          const c: Pt = [u[0] + t * vx, u[1] + t * vy];
          const dd = Math.hypot(p[0] - c[0], p[1] - c[1]);
          if (dd < d) { d = dd; q = c; index = i; }
        }
      }
    });
    return { q, d, index };
  };
  for (const { p, index: i } of sample(a)) {
    const n = nearestOnEdge(p, b);
    if (n.d < best) { best = n.d; pa = p; pb = n.q; ia = i; ib = n.index; }
  }
  for (const { p: q, index: j } of sample(b)) {
    const n = nearestOnEdge(q, a);
    if (n.d < best) { best = n.d; pa = n.q; pb = q; ia = n.index; ib = j; }
  }
  // A bridge no wider than the smaller of the two pieces it joins: a 3 mm bar would swallow
  // the 1.3 mm dot of an "i" whole. Never under 1 mm — thinner than that is not a bridge.
  const shortSide = (island: Shapes[number] | undefined) => {
    if (!island?.[0]) return Infinity;
    const box = bboxOf([island]);
    return Math.min(box.maxX - box.minX, box.maxY - box.minY);
  };
  width = Math.max(1, Math.min(width, 0.8 * Math.min(shortSide(a[ia]), shortSide(b[ib]))));
  // A word gap or a line break is joined along its own axis, not corner to corner. Neither is
  // the dot of an "i": a dot sits INSIDE its word's box on both axes, so it fails both tests and
  // keeps the short nearest-point bar that already reads as part of the letter.
  const A: Box | null = a[ia] ? bboxOf([a[ia]!]) : null;
  const B: Box | null = b[ib] ? bboxOf([b[ib]!]) : null;
  if (A && B) {
    const ovX = Math.min(A.maxX, B.maxX) - Math.max(A.minX, B.minX);
    const ovY = Math.min(A.maxY, B.maxY) - Math.max(A.minY, B.minY);
    const minW = Math.min(A.maxX - A.minX, B.maxX - B.minX);
    const minH = Math.min(A.maxY - A.minY, B.maxY - B.minY);
    const order = (first: Box) => (first === A ? [a[ia]!, b[ib]!] as const : [b[ib]!, a[ia]!] as const);
    let join: { pa: Pt; pb: Pt } | null = null;
    if (ovY >= 0.5 * minH && ovX < 0.5 * minW) {
      // Side by side: a word space. Flat along the baseline third.
      const [l, r] = order(A.minX + A.maxX <= B.minX + B.maxX ? A : B);
      join = axisJoin(l, r, 'x', width, Math.max(A.minY, B.minY), Math.min(A.maxY, B.maxY), true);
    } else if (ovX >= 0.5 * minW && ovY < 0.5 * minH) {
      // Stacked: a line break. Upright, at the column where the two lines come closest — a stem.
      const [l, r] = order(A.minY + A.maxY <= B.minY + B.maxY ? A : B);
      join = axisJoin(l, r, 'y', width, Math.max(A.minX, B.minX), Math.min(A.maxX, B.maxX), false);
    }
    // Only if it is not a detour: a bar that has to run three times as far to stay level is a
    // worse answer than the diagonal it replaces.
    if (join) {
      const span = Math.hypot(join.pb[0] - join.pa[0], join.pb[1] - join.pa[1]);
      if (span <= Math.max(3 * best, best + 8)) { pa = join.pa; pb = join.pb; best = span; }
    }
  }
  const dx = (pb[0] - pa[0]) / (best || 1), dy = (pb[1] - pa[1]) / (best || 1);
  const r = width / 2;
  return [[[
    [pa[0] - dx * r - dy * r, pa[1] - dy * r + dx * r],
    [pb[0] + dx * r - dy * r, pb[1] + dy * r + dx * r],
    [pb[0] + dx * r + dy * r, pb[1] + dy * r - dx * r],
    [pa[0] - dx * r + dy * r, pa[1] - dy * r - dx * r],
  ]]];
}

export function layerBox(l: { shapes: Shapes; image?: { x: number; y: number; width: number; height: number } }) {
  return l.image ? { minX: l.image.x, minY: l.image.y, maxX: l.image.x + l.image.width, maxY: l.image.y + l.image.height } : bboxOf(l.shapes);
}

/**
 * The ring's final centre: its resting place on the outline, moved by however far it has been
 * dragged or nudged, then held where the part stays whole.
 *
 * A loop tab is free — anywhere outside the edge, straddling it, or right inside the part —
 * because the build welds it on wherever it lands. That includes a tab that RESTS inside
 * (`restInside`): it starts where a hole would, and is still a tab. A hole is not free: it has to
 * keep its border of material, so one that would break the edge is pulled to the nearest place
 * that would not. Since 2026-09-28 no shared Ring control makes one; the designs that punch
 * their own (an ornament's ribbon hole) still do. Shared by the build (what is cut) and the
 * preview (where the handle lands), so the two cannot disagree.
 */
export function finalHoleCentre(shapes: Shapes, k: EditableKeyring & { dx?: number; dy?: number }, base: Pt = keyringCentre(shapes, k)): { centre: Pt; anchor: Pt } {
  let centre: Pt = [base[0] + (k.dx ?? 0), base[1] + (k.dy ?? 0)];
  // A hole must keep its border of material all the way round. A loop tab may go anywhere —
  // the neck welds it back on — so only the hole is held.
  if (k.mode === 'inside') centre = holdInside(shapes, centre, k.ring + k.dia / 2, holeTrack(shapes, k));
  return { centre, anchor: nearestOutlinePoint(shapes, centre) };
}

/** Where a dragged ring snaps, and which of the design's centre lines it snapped to (null: not
 *  that one). `edge` says it also snapped onto the outline. */
export interface RingSnap { at: Pt; x: number | null; y: number | null; edge: boolean }

/**
 * The drag's snaps, in one place so node can hold them to their rules (2026-09-28): guides for
 * snapping to the x or y centre, and nothing more.
 *
 * First the design's two centre lines — the vertical and horizontal lines through the middle of
 * `box`, the body's bounding box: within `within` mm of one, the ring's centre goes onto it. Then
 * the outline, the snap the drag already had: within `within` of the edge, the centre goes ON it,
 * half the ring outside. Both at once — the top-centre of a tag, the middle of a bar's end — is
 * the point where the centre line crosses the outline, so the guide the preview draws runs
 * through the ring it is drawn for; on a slanted edge the plain nearest point would sit beside
 * it. A centre line that crosses no edge within reach lets go, and the edge snap wins.
 *
 * `within` is in mm: the preview passes a few screen pixels at the current zoom. The keyboard and
 * the nudge pad never come through here — a typed number is not a drag.
 */
export function snapRing(p: Pt, body: Shapes, box: Box, within: number): RingSnap {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  let x: number | null = Math.abs(p[0] - cx) <= within ? cx : null;
  let y: number | null = Math.abs(p[1] - cy) <= within ? cy : null;
  const lined: Pt = [x ?? p[0], y ?? p[1]];
  const q = nearestOutlinePoint(body, lined);
  if (!body.length || Math.hypot(q[0] - lined[0], q[1] - lined[1]) > within) return { at: lined, x, y, edge: false };
  // On the edge. Keep a centre line only where it actually crosses the outline near here.
  let at = q;
  if (x !== null && Math.abs(q[0] - x) > 1e-6) {
    const c = nearestCrossing(body, 'x', x, lined[1]);
    if (c !== null && Math.abs(c - lined[1]) <= within) at = [x, c];
    else x = null;
  }
  if (y !== null && Math.abs(at[1] - y) > 1e-6) {
    const c = x === null ? nearestCrossing(body, 'y', y, lined[0]) : null;
    if (c !== null && Math.abs(c - lined[0]) <= within) at = [c, y];
    else y = null;
  }
  return { at, x, y, edge: true };
}

/** Where the line x = `at` (or y = `at`) crosses any outer ring, nearest to `near` along it; null
 *  when it crosses none. */
function nearestCrossing(shapes: Shapes, axis: 'x' | 'y', at: number, near: number): number | null {
  let best: number | null = null;
  const u = axis === 'x' ? 0 : 1;
  const v = 1 - u;
  for (const island of shapes) {
    const ring = island[0] ?? [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      if (a[u] === b[u] || at < Math.min(a[u], b[u]) || at > Math.max(a[u], b[u])) continue;
      const c = a[v] + ((at - a[u]) / (b[u] - a[u])) * (b[v] - a[v]);
      if (best === null || Math.abs(c - near) < Math.abs(best - near)) best = c;
    }
  }
  return best;
}

/** The closest point on any outer ring's edges to a point — the edge itself, not a vertex,
 *  so a straight side answers with the point across from you, not its far corner. */
export function nearestOutlinePoint(shapes: Shapes, p: Pt): Pt {
  let best: Pt = p, d = Infinity;
  for (const island of shapes) {
    const ring = island[0] ?? [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      const q = projectOnSegment(p, a, b);
      const dd = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (dd < d) { d = dd; best = q; }
    }
  }
  return best;
}

export function distanceToOutline(shapes: Shapes, p: Pt): number {
  const q = nearestOutlinePoint(shapes, p);
  return Math.hypot(q[0] - p[0], q[1] - p[1]);
}

/**
 * The distance to the EDGE OF THE UNION — the same measurement, with the seams left out.
 *
 * A blank is not a plate. `buildBlank` hands back its body and every welded-on piece (a cat's
 * ears, a carrot's leaves, a ball's lug) as separate overlapping islands, because the engine's
 * "overlapping outer rings union automatically" rule does the welding later, in manifold. Until
 * then, the stretch of an ear's ring that is buried in the head is not an edge of anything — but
 * `distanceToOutline` measured it, so the fit read a cat as a shape with a cliff through its
 * middle and no size of name ever got clear of it.
 *
 * A candidate point on a ring is skipped when it lies inside ANOTHER island's outer ring, which
 * is exactly the definition of a seam. On a built plate no outer ring is inside another, so this
 * answers the same as `distanceToOutline` — and it costs nothing there, because nothing is
 * skipped.
 */
export function unionOutlineDistance(shapes: Shapes, p: Pt): number {
  const seams = seamsOf(shapes);
  if (!seams) return distanceToOutline(shapes, p);
  let d = Infinity;
  for (let n = 0; n < shapes.length; n++) {
    const ring = shapes[n]![0] ?? [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      const q = projectOnSegment(p, a, b);
      const dd = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (dd >= d) continue;
      let buried = false;
      for (const m of seams.near[n]!) {
        const box = seams.boxes[m]!;
        if (q[0] < box.minX || q[0] > box.maxX || q[1] < box.minY || q[1] > box.maxY) continue;
        if (pointInRing(q, shapes[m]![0]!)) { buried = true; break; }
      }
      if (!buried) d = dd;
    }
  }
  return Number.isFinite(d) ? d : distanceToOutline(shapes, p);
}

interface Seams {
  /** Each island's outer-ring bounding box. */
  boxes: Box[];
  /** For each island, the islands whose box overlaps it — the only ones that can bury its edge. */
  near: number[][];
}

/** Which islands might be welded to which, by bounding box — `null` when none of them overlap,
 *  which is every built plate and most sets of marks. Held against the `shapes` array itself:
 *  one fit asks this thousands of times about the same geometry. */
const seamCache = new WeakMap<object, Seams | null>();

function seamsOf(shapes: Shapes): Seams | null {
  if (shapes.length < 2) return null;
  const hit = seamCache.get(shapes);
  if (hit !== undefined) return hit;
  const boxes = shapes.map((island) => bboxOf([[island[0] ?? []]]));
  const near: number[][] = shapes.map(() => []);
  let any = false;
  for (let i = 0; i < shapes.length; i++) {
    for (let j = 0; j < shapes.length; j++) {
      if (i === j) continue;
      const a = boxes[i]!, b = boxes[j]!;
      if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
      near[i]!.push(j);
      any = true;
    }
  }
  const out: Seams | null = any ? { boxes, near } : null;
  seamCache.set(shapes, out);
  return out;
}

/** Inside any island's outer ring and not in one of its holes (even-odd). */
export function insideShapes(shapes: Shapes, p: Pt): boolean {
  let inside = false;
  for (const island of shapes) for (const ring of island) if (pointInRing(p, ring)) inside = !inside;
  return inside;
}

/** Inside the UNION of the islands: true when any island holds the point (inside its outer
 *  ring, outside its holes). `insideShapes` is even-odd across every ring at once, which is
 *  right for a built plate and wrong for a blank whose ears and leaves still overlap its body —
 *  a point under both the head and an ear would read as outside. */
export function insideUnion(shapes: Shapes, p: Pt): boolean {
  for (const island of shapes) {
    if (!island[0] || !pointInRing(p, island[0])) continue;
    let inHole = false;
    for (let i = 1; i < island.length; i++) if (pointInRing(p, island[i]!)) { inHole = !inHole; }
    if (!inHole) return true;
  }
  return false;
}

function pointInRing(p: Pt, ring: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** How many bands `unionIndex` files a shape's edges into, along each axis. */
const UNION_BANDS = 64;

/** Every ring's edges, filed by the band of one axis they span: per island, per ring, per band, as
 *  flat [xi, yi, xj, yj, …] with i and j paired the way `pointInRing` pairs them. An edge level in
 *  that axis never crosses a line across it and is left out. */
type FiledEdges = number[][][][];

/** A set of overlapping islands asked about many times — the overlap walk asks of every point it
 *  probes, at every step of every letter, whether it is inside the neighbour and how deep. */
export interface UnionIndex {
  /** `insideUnion(shapes, [x, y])`, read from the edges crossing the point's own height only. */
  inside(x: number, y: number): boolean;
  /** How far from (x, y) the islands' union reaches along the four axis directions — the nearest
   *  of the four ends, mm, or 0 when (x, y) is not inside. The union is the one `inside` reads
   *  (each ring even-odd), every end lies on its outline, and so this is never less than the
   *  distance to that outline. */
  exit(x: number, y: number): number;
}

/**
 * The islands' union, indexed once for many questions.
 *
 * `inside` is `insideUnion`: each ring's edges are filed by the heights they span, so a question
 * reads only the edges crossing the point's own height, with `pointInRing`'s crossing test edge for
 * edge and in the same order of operations. An edge that does not span the point's height can
 * never pass that test, so every answer is the one `insideUnion` gives.
 *
 * `exit` is what keeps a depth honest where `unionOutlineDistance` is not. That function skips an
 * edge whose nearest point lies inside another island, and a stroke-built face draws strokes whose
 * outlines COINCIDE — Baloo's n is three — so a point just inside the letter's edge can find every
 * edge near it "buried" and be told it is 2.4 mm deep. The union's extent along the axes through
 * the point is the same union read the plain way: no answer of it is ever shallower than the truth.
 */
export function unionIndex(shapes: Shapes): UnionIndex {
  const box = bboxOf(shapes);
  const h = (box.maxY - box.minY) / UNION_BANDS;
  const w = (box.maxX - box.minX) / UNION_BANDS;
  const row = (y: number) => (h > 0 ? Math.max(0, Math.min(UNION_BANDS - 1, Math.floor((y - box.minY) / h))) : 0);
  const col = (x: number) => (w > 0 ? Math.max(0, Math.min(UNION_BANDS - 1, Math.floor((x - box.minX) / w))) : 0);
  const file = (axis: 0 | 1, band: (v: number) => number): FiledEdges => shapes.map((island) => island.map((ring) => {
    const bands: number[][] = Array.from({ length: UNION_BANDS }, () => []);
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (a[axis] === b[axis]) continue;
      for (let k = band(Math.min(a[axis], b[axis])); k <= band(Math.max(a[axis], b[axis])); k++) bands[k]!.push(a[0], a[1], b[0], b[1]);
    }
    return bands;
  }));
  const rows = file(1, row);
  const cols = file(0, col);
  const crosses = (bands: number[][], x: number, y: number) => {
    const e = bands[row(y)]!;
    let c = false;
    for (let k = 0; k < e.length; k += 4) {
      const xi = e[k]!;
      const yi = e[k + 1]!;
      const xj = e[k + 2]!;
      const yj = e[k + 3]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  /** Along the line {axis = c}, the distance from `at` (a position along the other axis) to the
   *  nearer end of the stretch of the union holding it — 0 if none does. */
  const reach = (filed: FiledEdges, band: number, axis: 0 | 1, c: number, at: number): number => {
    const spans: [number, number][] = [];
    for (const rings of filed) {
      // Where each ring crosses the line, tagged with the ring; even-odd per ring, swept in order.
      const hits: [number, number][] = [];
      rings.forEach((bands, r) => {
        const e = bands[band]!;
        for (let k = 0; k < e.length; k += 4) {
          const ai = axis ? e[k + 1]! : e[k]!;
          const aj = axis ? e[k + 3]! : e[k + 2]!;
          if (ai > c === aj > c) continue;
          const bi = axis ? e[k]! : e[k + 1]!;
          const bj = axis ? e[k + 2]! : e[k + 3]!;
          hits.push([((bj - bi) * (c - ai)) / (aj - ai) + bi, r]);
        }
      });
      hits.sort((p, q) => p[0] - q[0]);
      const parity = rings.map(() => false);
      let from: number | null = null;
      for (const [pos, r] of hits) {
        parity[r] = !parity[r];
        let holes = false;
        for (let i = 1; i < parity.length; i++) if (parity[i]) holes = !holes;
        const covered = parity[0]! && !holes;
        if (covered && from === null) from = pos;
        else if (!covered && from !== null) { spans.push([from, pos]); from = null; }
      }
    }
    spans.sort((p, q) => p[0] - q[0]);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [s, e] of spans) {
      if (s > hi) {
        if (lo <= at && at <= hi) break;
        lo = s;
        hi = e;
      } else hi = Math.max(hi, e);
    }
    return lo <= at && at <= hi ? Math.min(at - lo, hi - at) : 0;
  };
  return {
    inside(x, y) {
      // Outside every ring's box a ray crosses each ring an even number of times, or not at all.
      if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) return false;
      for (const rings of rows) {
        if (!rings[0] || !crosses(rings[0], x, y)) continue;
        let inHole = false;
        for (let i = 1; i < rings.length; i++) if (crosses(rings[i]!, x, y)) inHole = !inHole;
        if (!inHole) return true;
      }
      return false;
    },
    exit(x, y) {
      if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) return 0;
      return Math.min(reach(rows, row(y), 1, y, x), reach(cols, col(x), 0, x, y));
    },
  };
}

function projectOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * Keep a hole's centre where the part survives: inside the outline with `clearance` mm of
 * material all round. A centre that already is stays put; one that is not moves to the nearest
 * point on the hole's own track that IS legal.
 *
 * Nearest-legal rather than nearest-on-track, because the track is a vertex-normal offset: on a
 * wiggly hugging outline (letters, a star's arms) its points are not all `clearance` away from
 * every part of the edge, and snapping blindly put the hole through the border. The candidates
 * are sorted by how far they are from what was asked for and the first legal one wins, so the
 * hole lands where the pointer meant as closely as the shape allows.
 */
export function holdInside(shapes: Shapes, centre: Pt, clearance: number, track: Pt[]): Pt {
  const legal = (p: Pt) => insideShapes(shapes, p) && distanceToOutline(shapes, p) >= clearance - 0.05;
  if (legal(centre)) return centre;
  const byDistance = track
    .map((p) => ({ p, d: Math.hypot(p[0] - centre[0], p[1] - centre[1]) }))
    .sort((x, y) => x.d - y.d);
  for (const { p } of byDistance.slice(0, 160)) if (legal(p)) return p;
  // No VERTEX of the track is legal. The everyday case is a rounded rectangle whose corners are
  // tighter than the clearance (the song keychain's 3 mm corners against 2 + 3 mm): its track
  // has points only on the corner arcs, each nearer than `clearance` to the side beside it, while
  // the straight stretch between two corners — legal along most of its length — has no vertices
  // at all. So walk the track itself every 0.25 mm, nearest first.
  const dense = subdivideShapes([[track]], 0.25)[0]![0]!
    .map((p) => ({ p, d: Math.hypot(p[0] - centre[0], p[1] - centre[1]) }))
    .sort((x, y) => x.d - y.d);
  for (const { p } of dense) if (legal(p)) return p;
  // Nowhere on the track fits (a hole bigger than the part): leave it where the maths put it
  // and let the build's own warning say the part will not survive.
  return byDistance[0]?.p ?? centre;
}

/**
 * The largest scale (<= 1) at which a box centred on `centre` still sits inside `shapes` with
 * `margin` mm to spare and clear of `hole`.
 *
 * A bounding box is not a shape: a name that fits 34 × 34 runs off a star's arms and through
 * its keyring hole, which is what "shrink to fit" was doing. The box's corners, edge midpoints
 * and centre are tested against the real outline, and the scale is halved in on — ten passes
 * is finer than a tenth of a millimetre at any size this app allows.
 *
 * `samples` walks the box's perimeter with that many points instead of the nine above — for a
 * tree's step notches or a snowflake's arm gaps, which sit between corners and midpoints. The
 * default keeps the nine, so no existing caller changes.
 *
 * `avoid` are obstacles ON the shape that the box must also clear by `margin` — a football's
 * laces, a bauble's stripes, anything a blank's `detail()` draws. Tested both ways round: none
 * of their vertices inside the box, and none of the box's own points inside them, which is what
 * catches a mark that crosses the box without either end landing in it.
 */
export function fitBoxInside(
  shapes: Shapes,
  centre: Pt,
  half: Pt,
  margin: number,
  hole: { centre: Pt; radius: number } | null,
  samples = 0,
  avoid: Shapes = [],
): number {
  const fits = (k: number) => {
    const hx = half[0] * k;
    const hy = half[1] * k;
    const pts: Pt[] = [
      [centre[0] - hx, centre[1] - hy], [centre[0], centre[1] - hy], [centre[0] + hx, centre[1] - hy],
      [centre[0] - hx, centre[1]], [centre[0], centre[1]], [centre[0] + hx, centre[1]],
      [centre[0] - hx, centre[1] + hy], [centre[0], centre[1] + hy], [centre[0] + hx, centre[1] + hy],
    ];
    if (samples > 8) {
      const perimeter = 4 * (hx + hy);
      for (let i = 0; i < samples; i++) {
        let d = (i / samples) * perimeter;
        if (d < 2 * hx) pts.push([centre[0] - hx + d, centre[1] - hy]);
        else if ((d -= 2 * hx) < 2 * hy) pts.push([centre[0] + hx, centre[1] - hy + d]);
        else if ((d -= 2 * hy) < 2 * hx) pts.push([centre[0] + hx - d, centre[1] + hy]);
        else pts.push([centre[0] - hx, centre[1] + hy - (d - 2 * hx)]);
      }
    }
    for (const p of pts) {
      // The UNION of the islands, not the even-odd sum of them: a blank's ears and leaves still
      // overlap its body at this point in the pipeline, so a point under both the head and an ear
      // read as outside, and the seam between them read as an edge to keep `margin` away from.
      if (!insideUnion(shapes, p) || unionOutlineDistance(shapes, p) < margin) return false;
      if (hole && Math.hypot(p[0] - hole.centre[0], p[1] - hole.centre[1]) < hole.radius) return false;
      if (avoid.length && (insideUnion(avoid, p) || unionOutlineDistance(avoid, p) < margin)) return false;
    }
    for (const island of avoid) {
      for (const ring of island) {
        for (const [x, y] of ring) {
          if (Math.abs(x - centre[0]) <= hx + margin && Math.abs(y - centre[1]) <= hy + margin) return false;
        }
      }
    }
    return true;
  };
  if (fits(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

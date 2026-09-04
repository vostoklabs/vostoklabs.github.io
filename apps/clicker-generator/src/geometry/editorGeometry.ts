/**
 * The 2-D shape editor's geometry — every part of it that is arithmetic rather than pointers.
 *
 * Nothing here touches the DOM, a canvas, an event or `window`. That is not tidiness: this
 * repo's only test harness is esbuild + node with no DOM (see `tests/*.test.ts`), so a function
 * that mentions a `PointerEvent` is a function nothing can ever check. Every rule the editor
 * enforces — where a handle sits, what dragging it means, what mirroring does, which material
 * is too thin to survive the build — lives in this file so that it can be asserted. `ui/
 * shapeEditor.ts` is the shell that draws these results and forwards pointers into them.
 *
 * Three coordinate spaces, and mixing them up is the bug to watch for:
 *
 *  - **ring units** — what `shapePaths.ts` generates and what `BuildParams.baseShapeRings`
 *    wants: longest side ≈ 1, centred, Y-up. The build scales these itself.
 *  - **editor mm** — ring units × the base's longest side in millimetres. Everything the
 *    *user* is being told about (a 2 mm minimum feature, a 17 mm switch column, a 40 mm base)
 *    is a millimetre, so the editor works here and converts once on the way in and out.
 *  - **screen px** — the canvas only. Never enters this file.
 *
 * The preview is pure JS and manifold is in a worker, so `previewRingFor` is a hand-kept
 * mirror of `buildClicker`'s `genShapeRaw` switch. That duplication is forced — WASM CSG per
 * pointermove is not a thing — and it is the standing risk of this module: a new
 * `BaseShapeKind` added to one and not the other makes the editor draw a shape the build does
 * not produce, which is precisely the failure the heart and the star already cost us.
 * `tests/shape-editor.test.ts` compares the two for every kind, so it fails rather than drifts.
 */
import type { BaseShapeKind, Ring } from '../types';
import {
  archRing, capsuleRing, circleRing, crossRing, eggRing, heartRing, ngonRing,
  roundedRectRing, shieldRing, squircleRing, starRing, tagRing,
} from './shapePaths';

/* ======================================================================================
   The shape's parameters, as the editor holds them.
   ====================================================================================== */

/** Everything a preset shape's outline depends on. A subset of `BuildParams`, by design —
 *  these field names are the ones that get written straight back to the store on commit. */
export interface ShapeParams {
  kind: BaseShapeKind;
  /** Sides / points. Clamped per shape by the ring generators themselves. */
  shapeSides: number;
  /** Corner radius, as a fraction of the short side. */
  shapeCornerPct: number;
  /** Notch depth: a star's valley radius, a cross's arm half-width. */
  shapeArmPct: number;
  /** The base's outer box in mm, when the size handles have been used. Null = the base
   *  follows the design, which is the app's `fixedSize: null`. */
  sizeMm: { w: number; h: number } | null;
}

export type MirrorMode = 'off' | 'vertical' | 'both';

/**
 * Valid ranges for the four handle kinds, exported so the editor's side-panel sliders can read
 * the exact same numbers `previewRingFor` and `dragHandle` clamp to below.
 *
 * Before these existed the bounds were three sets of hand-typed literals — one here, and (in
 * the pass that added labelled sliders beside the on-shape grips) a second set in `ui/
 * shapeEditor.ts`. That is exactly the duplication this file's own header warns about for
 * `previewRingFor` and `genShapeRaw`: two copies of the same rule, checked by nothing, one
 * commit away from disagreeing about how far a slider can go versus how far its grip can drag.
 */
export const COUNT_RANGE: [number, number] = [3, 8];
export const CORNER_RANGE: [number, number] = [0, 0.4];
export const SIZE_RANGE: [number, number] = [24, 120];

/** The `feature` handle's range depends on which shape it is: a star's sharpness runs shallower
 *  than a cross's arm width, because a star at 0.15 stops looking like a star. */
export function featureRange(kind: BaseShapeKind): [number, number] {
  return kind === 'star' ? [0.3, 0.8] : [0.15, 0.45];
}

/* ======================================================================================
   Preview outlines — the pure-JS mirror of buildClicker's genShapeRaw.
   ====================================================================================== */

/**
 * The outline of a preset shape, in RING units.
 *
 * One case per `BaseShapeKind`, matching `genShapeRaw` line for line. `outline` and `custom`
 * are absent on purpose: neither is a generated shape (one follows the artwork, the other IS
 * the rings), and both are handled by the caller before it gets here.
 *
 * `aspect` only reaches `rect`, exactly as it does in the build, where it comes from the
 * artwork's own proportions rather than from a control.
 */
export function previewRingFor(p: ShapeParams, aspect = 1): Ring {
  const sides = (fallback: number): number =>
    Math.max(COUNT_RANGE[0], Math.min(COUNT_RANGE[1], Math.round(p.shapeSides ?? fallback)));
  const feature = (fallback: number): number => {
    const [lo, hi] = featureRange(p.kind);
    return Math.max(lo, Math.min(hi, p.shapeArmPct ?? fallback));
  };
  const corner = Math.min(CORNER_RANGE[1], Math.max(CORNER_RANGE[0], p.shapeCornerPct ?? 0.22));

  switch (p.kind) {
    case 'square': return roundedRectRing(2, 2, corner);
    case 'rect': return roundedRectRing(2 * aspect, 2, corner);
    // `makeHexagon` puts a vertex at 30° + 60°k, which is the same six points `ngonRing(6)`
    // produces from 90° + 60°k. The same hexagon, arrived at from the other end.
    case 'hexagon': return ngonRing(6);
    case 'heart': return heartRing();
    case 'star': return starRing(sides(5), feature(0.56));
    case 'egg': return eggRing();
    case 'ngon': return ngonRing(sides(6));
    case 'cross': return crossRing(feature(0.34));
    case 'squircle': return squircleRing();
    case 'capsule': return capsuleRing();
    case 'shield': return shieldRing();
    case 'tag': return tagRing();
    case 'arch': return archRing();
    case 'circle':
    default: return circleRing();
  }
}

/** Which `BaseShapeKind`s `previewRingFor` can actually draw. The two it cannot are not
 *  shapes: `outline` follows the artwork and `custom` IS the rings. */
export const PREVIEWABLE_KINDS: BaseShapeKind[] = [
  'circle', 'square', 'rect', 'hexagon', 'heart', 'star', 'egg',
  'ngon', 'cross', 'squircle', 'capsule', 'shield', 'tag', 'arch',
];

/* ======================================================================================
   Normalisation — the contract BuildParams.baseShapeRings is documented to require.
   ====================================================================================== */

/** A ring's bounding box, as `[minX, minY, maxX, maxY]`. */
export function bboxOf(ring: Ring): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) return [-0.5, -0.5, 0.5, 0.5];
  return [minX, minY, maxX, maxY];
}

/**
 * Put a ring into the normalised space `baseShapeRings` requires: bbox CENTRE at the origin,
 * both axes divided by the SAME scalar so the longest side is exactly 1, Y up.
 *
 * The same arithmetic `parseSvg` does on an imported file (`logo.ts`), so an editor shape and
 * an imported shape arrive at `makeCustom` in the same state. Note bbox centre and not
 * centroid — the build re-centres onto the switch spot itself, and doing it twice from two
 * different definitions is how a shape ends up off its own middle.
 */
export function normaliseRing(ring: Ring): Ring {
  const [minX, minY, maxX, maxY] = bboxOf(ring);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const k = Math.max(maxX - minX, maxY - minY) || 1;
  return ring.map(([x, y]) => [(x - cx) / k, (y - cy) / k] as [number, number]);
}

/** Scale a NORMALISED ring (longest side 1) up into editor millimetres. */
export function ringToMm(ring: Ring, spanMm: number): Ring {
  return ring.map(([x, y]) => [x * spanMm, y * spanMm] as [number, number]);
}

/**
 * A preset shape's outline in editor millimetres.
 *
 * The one function the editor should call, because the steps are easy to do in the wrong order
 * or to skip. `shapePaths`' generators span roughly ±1, not ±0.5, so scaling one by `spanMm`
 * without normalising first makes a 40 mm base 80 mm wide — which went unnoticed in the first
 * draft of the tests, where it read as a heart with room for a 47 mm switch.
 *
 * And when the size is pinned, the outline is stretched to that box rather than left at
 * `spanMm`: this is `shapeInBox`'s job in the build, and without it the size grips would move
 * while the shape they are attached to stayed exactly where it was.
 */
export function previewRingMm(p: ShapeParams, spanMm: number, aspect = 1): Ring {
  if (!p.sizeMm) return ringToMm(normaliseRing(previewRingFor(p, aspect)), spanMm);
  const { w, h } = p.sizeMm;
  /* The same three special cases `shapeInBox` makes, and for its reason.

     Stretching a rounded square to 60 x 20 takes its corner radius with it and leaves visibly
     ELLIPTICAL corners — on the one shape people pick because it is plain. A capsule stretched
     the same way turns its circular caps into half-ellipses. The build refuses to do either;
     it rebuilds those shapes at the box's own size. An editor that stretched them would be
     showing a shape the build will not produce, which is the whole class of bug this pass
     exists to close. */
  if (p.kind === 'square' || p.kind === 'rect') {
    const corner = Math.min(CORNER_RANGE[1], Math.max(CORNER_RANGE[0], p.shapeCornerPct ?? 0.22));
    return roundedRectRing(w, h, corner);
  }
  if (p.kind === 'capsule') return roundedRectRing(w, h, 0.5, 16);
  const unit = normaliseRing(previewRingFor(p, aspect));
  const [minX, minY, maxX, maxY] = bboxOf(unit);
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  return unit.map(([x, y]) => [
    (x - (minX + maxX) / 2) * (w / bw),
    (y - (minY + maxY) / 2) * (h / bh),
  ] as [number, number]);
}

/**
 * Stretch a ring to fill a `w` x `h` box exactly, centred on the origin.
 *
 * What `shapeInBox` does in the build, for a shape that is already points. A DRAWN outline
 * cannot be regenerated from parameters — it is the only copy — so a size drag has to move the
 * points it has rather than ask a generator for new ones.
 */
export function fitRingToBox(ring: Ring, w: number, h: number): Ring {
  const [minX, minY, maxX, maxY] = bboxOf(ring);
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return ring.map(([x, y]) => [(x - cx) * (w / bw), (y - cy) * (h / bh)] as [number, number]);
}

/* ======================================================================================
   Mirror symmetry.
   ====================================================================================== */

/** Reflect a point through whichever axes `mode` names. */
export function reflect(
  x: number, y: number, mode: MirrorMode,
): [number, number][] {
  if (mode === 'vertical') return [[-x, y]];
  if (mode === 'both') return [[-x, y], [x, -y], [-x, -y]];
  return [];
}

/**
 * Clip a ring to a half-plane, keeping the side where `sd` is negative.
 *
 * Sutherland–Hodgman, which is the whole reason mirroring works on a real shape rather than a
 * convenient one. The first version simply FILTERED the points on the wrong side out, which is
 * correct only if the outline happens to have vertices exactly where it crosses the axis. A
 * lumpy hexagon has one vertex in the lower-left quadrant and five elsewhere, so filtering left
 * a single point and mirroring silently did nothing at all — the toggle said "symmetric" and
 * the shape was not. Clipping adds the crossing points instead of losing them.
 */
function clipHalfPlane(ring: Ring, sd: (p: [number, number]) => number): Ring {
  const out: Ring = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    const da = sd(a);
    const db = sd(b);
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Drop points that repeat the one before them (and the wrap-around repeat). */
function dedupe(ring: Ring): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) continue;
    out.push(p);
  }
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) out.pop();
    else break;
  }
  return out;
}

/**
 * Unfold a ring that has been clipped to one side of an axis into the whole symmetric shape.
 *
 * Walking the clipped polygon forward and then walking its reflection backward traces the union
 * of the two halves — no boolean operation, only the right order. But only if the shared axis
 * edge is the polygon's CLOSING edge, so that the two walks meet along it and it cancels.
 *
 * The clip does not put it there. Sutherland–Hodgman emits vertices in the source ring's own
 * order, so for a shape whose first vertex is already on the kept side the axis edge lands in
 * the middle of the list — and concatenating then traces the correct left half, jumps straight
 * across the shape to the right half, and traces that. It closes, so nothing errors; it is not
 * the outline. Rotating onto the seam first is the whole fix, and the longest axis edge is the
 * seam even when a concave shape crosses the axis more than twice.
 */
function unfold(half: Ring, axis: 'x' | 'y'): Ring {
  if (half.length < 2) return half;
  const c = axis === 'x' ? 0 : 1;
  const eps = 1e-9;
  const n = half.length;
  let seam = -1;
  let seamLen = eps;
  for (let i = 0; i < n; i++) {
    const a = half[i];
    const b = half[(i + 1) % n];
    if (Math.abs(a[c]) > eps || Math.abs(b[c]) > eps) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > seamLen) { seamLen = len; seam = i; }
  }
  // Rotate so the ring STARTS just after the seam, leaving the seam as the closing edge.
  const rotated = seam < 0
    ? half
    : [...half.slice(seam + 1), ...half.slice(0, seam + 1)];
  const refl = ([x, y]: [number, number]): [number, number] =>
    (axis === 'x' ? [-x, y] : [x, -y]);
  return dedupe([...rotated, ...rotated.slice().reverse().map(refl)]);
}

/**
 * Make a ring exactly symmetric: clip it to the primary half (or quadrant) and reflect.
 *
 * Turning mirror ON therefore DISCARDS whatever was on the other side. That is the honest
 * behaviour — averaging two halves mangles both — and it is one undo step in the editor, so it
 * is recoverable. The primary side is x ≤ 0, and for 'both' also y ≤ 0.
 */
export function applyMirror(ring: Ring, mode: MirrorMode): Ring {
  if (mode === 'off' || ring.length < 3) return ring;
  const left = dedupe(clipHalfPlane(ring, ([x]) => x));
  if (left.length < 2) return ring;
  if (mode === 'vertical') {
    const out = unfold(left, 'x');
    return out.length >= 3 ? out : ring;
  }
  const quad = dedupe(clipHalfPlane(left, ([, y]) => y));
  if (quad.length < 2) return ring;
  const out = unfold(unfold(quad, 'y'), 'x');
  return out.length >= 3 ? out : ring;
}

/**
 * For each vertex, which other vertices are its mirror images.
 *
 * **Recomputed from the ring every time rather than cached.** A cached index pairing is
 * correct until the first insert or delete shifts every index after it, and then it is
 * silently wrong — it would drag the wrong point, which reads as the editor being haunted.
 * Recomputing is O(n²) on a ring of at most a few hundred points, which is nothing next to
 * the redraw it happens inside.
 */
export function partnersOf(ring: Ring, i: number, mode: MirrorMode): number[] {
  if (mode === 'off' || i < 0 || i >= ring.length) return [];
  const tol = 1e-6;
  const out: number[] = [];
  for (const [rx, ry] of reflect(ring[i][0], ring[i][1], mode)) {
    let best = -1;
    let bestD = tol;
    for (let j = 0; j < ring.length; j++) {
      if (j === i) continue;
      const d = Math.hypot(ring[j][0] - rx, ring[j][1] - ry);
      if (d < bestD) { bestD = d; best = j; }
    }
    if (best >= 0 && !out.includes(best)) out.push(best);
  }
  return out;
}

/**
 * The same question for every vertex at once.
 *
 * O(n^2), which is why `moveVertex` takes the answer for ONE vertex instead — it runs on every
 * pointermove, and at 200 points this was 40,000 distance computations per mouse event, ahead
 * of the rAF gate that throttles everything else.
 */
export function mirrorPartners(ring: Ring, mode: MirrorMode): number[][] {
  const out: number[][] = ring.map(() => []);
  if (mode === 'off') return out;
  const tol = 1e-6;
  for (let i = 0; i < ring.length; i++) {
    for (const [rx, ry] of reflect(ring[i][0], ring[i][1], mode)) {
      let best = -1;
      let bestD = tol;
      for (let j = 0; j < ring.length; j++) {
        if (j === i) continue;
        const d = Math.hypot(ring[j][0] - rx, ring[j][1] - ry);
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best >= 0 && !out[i].includes(best)) out[i].push(best);
    }
  }
  return out;
}

/**
 * Move vertex `i` to (x, y), taking its mirror images with it.
 *
 * A vertex that sits ON a mirror axis is CONSTRAINED to that axis rather than freed from it:
 * letting it leave breaks the symmetry the user asked for, and does it invisibly — the shape
 * stops being symmetric while the toggle still says it is.
 *
 * The partners are looked up here rather than re-clipping the whole ring, because re-clipping
 * mid-drag would add and remove points as they cross the axis — the point under the cursor
 * could cease to exist halfway through its own drag.
 */
export function moveVertex(
  ring: Ring, i: number, x: number, y: number, mode: MirrorMode, known?: number[],
): Ring {
  if (i < 0 || i >= ring.length) return ring;
  const eps = 1e-6;
  let nx = x;
  let ny = y;
  if (mode !== 'off' && Math.abs(ring[i][0]) <= eps) nx = 0;
  if (mode === 'both' && Math.abs(ring[i][1]) <= eps) ny = 0;

  // `known` is the partner list captured at drag-start. A drag never changes which vertices
  // exist, only where they are, so recomputing it per pointermove is pure waste — and at a few
  // hundred points it is the most expensive thing in the event handler.
  const partners = known ?? partnersOf(ring, i, mode);
  const out: Ring = ring.map(([px, py]) => [px, py] as [number, number]);
  out[i] = [nx, ny];
  // Which reflection each partner WAS: read it off the original positions and apply the same
  // one to the new. Reading the sign of the new position instead would flip a partner the
  // moment the dragged point crossed the axis.
  for (const j of partners) {
    const sx = Math.abs(ring[i][0]) > eps && ring[j][0] * ring[i][0] < 0 ? -1 : 1;
    const sy = Math.abs(ring[i][1]) > eps && ring[j][1] * ring[i][1] < 0 ? -1 : 1;
    out[j] = [nx * sx, ny * sy];
  }
  return out;
}

/**
 * Insert a vertex on the segment from `i` to `i+1`, at parameter `t` along it — and, when
 * mirroring is on, insert its reflections on the corresponding segments too.
 *
 * Without the second half of that sentence, mirroring survives exactly until the first insert:
 * the new point has no partner, `mirrorPartners` finds nothing for it, and dragging it moves
 * one side of a shape the toggle still claims is symmetric. The mirrored segment is found by
 * matching its ENDPOINTS against the reflection of this one, in either order — a reflection
 * through one axis reverses the ring's direction and a reflection through both does not.
 */
export function insertVertex(
  ring: Ring, i: number, t: number, mode: MirrorMode = 'off',
): { ring: Ring; index: number } {
  if (ring.length < 2) return { ring, index: -1 };
  const n = ring.length;
  const seg = ((i % n) + n) % n;
  const a = ring[seg];
  const b = ring[(seg + 1) % n];
  const u = Math.max(0, Math.min(1, t));
  const at = (p: [number, number], q: [number, number], k: number): [number, number] =>
    [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];

  /** Every insertion this call makes, as (segment, t). */
  const jobs: { seg: number; t: number; primary: boolean }[] = [{ seg, t: u, primary: true }];

  if (mode !== 'off') {
    const tol = 1e-6;
    const same = (p: [number, number], q: [number, number]) =>
      Math.abs(p[0] - q[0]) < tol && Math.abs(p[1] - q[1]) < tol;
    const reflA = reflect(a[0], a[1], mode);
    const reflB = reflect(b[0], b[1], mode);
    for (let r = 0; r < reflA.length; r++) {
      const ra = reflA[r];
      const rb = reflB[r];
      for (let k = 0; k < n; k++) {
        if (k === seg) continue;
        const p = ring[k];
        const q = ring[(k + 1) % n];
        if (same(p, ra) && same(q, rb)) { jobs.push({ seg: k, t: u, primary: false }); break; }
        if (same(p, rb) && same(q, ra)) { jobs.push({ seg: k, t: 1 - u, primary: false }); break; }
      }
    }
  }

  // Splice from the back so earlier indices stay valid, and track where the primary landed.
  jobs.sort((x, y) => y.seg - x.seg);
  const out = ring.slice();
  let index = -1;
  for (const job of jobs) {
    const p = out[job.seg];
    const q = out[(job.seg + 1) % out.length];
    out.splice(job.seg + 1, 0, at(p, q, job.t));
    if (job.primary) index = job.seg + 1;
    else if (index >= 0 && job.seg + 1 <= index) index++;
  }
  return { ring: out, index };
}

/**
 * Delete vertex `i`, and its mirror images with it.
 *
 * Refuses below three points, because two points are not a shape and the build would fall
 * back to a circle without saying why. The caller reports the refusal; this just declines.
 */
export function deleteVertex(ring: Ring, i: number, mode: MirrorMode): Ring {
  const doomed = new Set<number>([i, ...(mirrorPartners(ring, mode)[i] ?? [])]);
  if (ring.length - doomed.size < 3) return ring;
  return ring.filter((_, k) => !doomed.has(k));
}

/**
 * Douglas–Peucker: drop vertices that are within `tolMm` of the line they sit on.
 *
 * A traced silhouette — a pack's bat, an imported SVG — arrives with several hundred points
 * because a tracer follows a pixel edge. Those are a perfectly good OUTLINE and a hopeless
 * thing to edit: the vertices sit closer together than a fingertip, so there is nothing to
 * grab. Simplifying on the way into point-editing is what makes "pick one of ours, then change
 * it" mean anything for the shapes that were not generated.
 *
 * Applied only when the user enters Draw mode on such a shape, never on the way to the build —
 * a shape nobody edits keeps every point it came with.
 */
export function simplifyRing(ring: Ring, tolMm: number): Ring {
  if (ring.length < 4 || tolMm <= 0) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;

  const perp = (i: number, a: number, b: number): number => {
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-12) return Math.hypot(ring[i][0] - ax, ring[i][1] - ay);
    return Math.abs((ring[i][0] - ax) * dy - (ring[i][1] - ay) * dx) / len;
  };

  // Iterative rather than recursive: a 4,000-point trace would blow the stack.
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let worstD = tolMm;
    for (let i = a + 1; i < b; i++) {
      const d = perp(i, a, b);
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([a, worst], [worst, b]);
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : ring;
}

/** Which segment a point is nearest, and where along it — for double-click-to-insert. */
export function nearestSegment(
  ring: Ring, x: number, y: number,
): { index: number; t: number; dist: number } {
  let best = { index: 0, t: 0, dist: Infinity };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    let t = len > 0 ? ((x - a[0]) * dx + (y - a[1]) * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
    if (d < best.dist) best = { index: i, t, dist: d };
  }
  return best;
}

/** Nearest vertex to a point, and how far. */
export function nearestVertex(ring: Ring, x: number, y: number): { index: number; dist: number } {
  let index = -1;
  let dist = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - x, ring[i][1] - y);
    if (d < dist) { dist = d; index = i; }
  }
  return { index, dist };
}

/**
 * Snap a dragged point: to a light grid, and harder to a live mirror axis.
 *
 * The axis snap is deliberately stronger than the grid one. A point half a millimetre off the
 * seam leaves a visible nick in a shape the user believes is symmetric, and it is the one
 * error the grid cannot catch — the seam is at 0, which is on every grid.
 */
export function snapPoint(
  x: number, y: number, gridMm: number, mode: MirrorMode, axisTolMm: number,
): [number, number] {
  let nx = x;
  let ny = y;
  if (gridMm > 0) {
    nx = Math.round(nx / gridMm) * gridMm;
    ny = Math.round(ny / gridMm) * gridMm;
  }
  if (mode !== 'off' && Math.abs(x) <= axisTolMm) nx = 0;
  if (mode === 'both' && Math.abs(y) <= axisTolMm) ny = 0;
  return [nx, ny];
}

/* ======================================================================================
   Printability — what the build's morphological open would eat, and whether the switch fits.
   ====================================================================================== */

export interface ThinField {
  /** Grid resolution (cells per side) and the world box it covers. */
  n: number;
  x0: number;
  y0: number;
  cell: number;
  /** 1 where the shape is. */
  inside: Uint8Array;
  /** 1 where the shape is but the open would remove it — the material shaded red. */
  thin: Uint8Array;
  /** Distance from each cell to the nearest edge, mm, 0 outside. The pole falls out of it. */
  clearMm: Float32Array;
  /** Where the build will put the switch, in the same mm space as the ring. */
  switchSpot: [number, number];
  /** Clearance at the switch spot, mm — half the widest column that fits there. */
  switchClearMm: number;
  /** How much of the shape survives the open, 0..1. Near 0 means it eats everything. */
  survivingFrac: number;
}

/**
 * Rasterise the ring, then reproduce `makeCustom`'s morphological open on the raster.
 *
 * The build erodes by `MIN_FEATURE_MM` and dilates back, which deletes every feature narrower
 * than twice that and leaves everything else where it was. Reproducing it needs a distance
 * transform, not vector offsetting — and a raster one is both exact (in the raster's own
 * terms) and O(n²), which is what makes this affordable inside a drag.
 *
 * Three passes:
 *
 *  1. **Scanline fill** — nonzero winding, matching `makeCustom`'s `CrossSection(rings,
 *     'NonZero')` rather than even-odd, so a future hole ring behaves here the way it will
 *     there. O(n · edges).
 *  2. **Distance to the outside**, by exact squared Euclidean distance transform
 *     (Felzenszwalb–Huttenlocher: two 1-D lower-envelope passes). Cells at or beyond `t` are
 *     the erosion; the largest value is the pole of inaccessibility, free.
 *  3. **Distance to the erosion**, by the same transform. Cells within `t` of it are the
 *     dilation. Inside-but-not-dilated is what the build would eat.
 *
 * An earlier draft computed exact signed clearance per cell by walking every edge — correct,
 * and O(n² · edges), which at 96 cells and a 200-point drawn ring is 3.7 million segment
 * distances every frame. Two distance transforms get the same answer for the cost of the
 * rasterisation alone.
 */
export function thinField(
  rings: Ring[], minFeatureMm: number, n = 128,
): ThinField {
  const all = rings.filter((r) => r.length >= 3);
  if (!all.length) {
    return {
      n: 1, x0: 0, y0: 0, cell: 1,
      inside: new Uint8Array(1), thin: new Uint8Array(1), clearMm: new Float32Array(1),
      switchSpot: [0, 0], switchClearMm: 0, survivingFrac: 0,
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of all) {
    const [a, b, c, d] = bboxOf(ring);
    if (a < minX) minX = a;
    if (b < minY) minY = b;
    if (c > maxX) maxX = c;
    if (d > maxY) maxY = d;
  }
  // Pad by more than the dilation radius, so the dilation is never clipped by the grid edge.
  const pad = Math.max(minFeatureMm * 2, (maxX - minX + maxY - minY) * 0.03);
  const span = Math.max(maxX - minX, maxY - minY) + pad * 2 || 1;
  const cell = span / n;
  const x0 = (minX + maxX) / 2 - span / 2;
  const y0 = (minY + maxY) / 2 - span / 2;

  // --- 1. scanline fill, nonzero winding
  const inside = new Uint8Array(n * n);
  const xs: { x: number; w: number }[] = [];
  for (let row = 0; row < n; row++) {
    const y = y0 + (row + 0.5) * cell;
    xs.length = 0;
    for (const ring of all) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j];
        const b = ring[i];
        if ((a[1] > y) === (b[1] > y)) continue;
        const t = (y - a[1]) / (b[1] - a[1]);
        xs.push({ x: a[0] + t * (b[0] - a[0]), w: b[1] > a[1] ? 1 : -1 });
      }
    }
    if (!xs.length) continue;
    xs.sort((p, q) => p.x - q.x);
    let wind = 0;
    let start = 0;
    for (const hit of xs) {
      const prev = wind;
      wind += hit.w;
      if (prev === 0 && wind !== 0) start = hit.x;
      else if (prev !== 0 && wind === 0 && hit.x > start) {
        const c0 = Math.max(0, Math.ceil((start - x0) / cell - 0.5));
        const c1 = Math.min(n - 1, Math.floor((hit.x - x0) / cell - 0.5));
        for (let col = c0; col <= c1; col++) inside[row * n + col] = 1;
      }
    }
  }

  // --- 2. distance from every cell to the nearest OUTSIDE cell (i.e. to the boundary)
  const distToOut = edt(inside, n, /* seedWhere */ 0);
  const clearMm = new Float32Array(n * n);
  let insideCount = 0;
  for (let k = 0; k < clearMm.length; k++) {
    if (!inside[k]) continue;
    insideCount++;
    // A cell centre one cell in from the boundary is half a cell from the true edge; the
    // transform counts whole cells, so subtract the half-cell to land on the real distance.
    clearMm[k] = Math.max(0, (Math.sqrt(distToOut[k]) - 0.5) * cell);
  }

  // --- 3. erode, then dilate back
  const core = new Uint8Array(n * n);
  for (let k = 0; k < core.length; k++) core[k] = clearMm[k] >= minFeatureMm ? 1 : 0;
  const thin = new Uint8Array(n * n);
  let surviving = 0;
  let hasCore = false;
  for (let k = 0; k < core.length; k++) if (core[k]) { hasCore = true; break; }
  if (!hasCore) {
    /* Nothing anywhere is `minFeatureMm` from an edge: the open would delete the whole shape.

       The build skips it in that case rather than handing back nothing (`makeCustom`'s
       `sectionIsEmpty` guard), so nothing is SHADED here either — a solid red shape says
       nothing useful. But `survivingFrac` stays at 0, and it has to: the first cut of this
       counted every inside cell as surviving, which made the worst possible shape — one that
       is too thin from edge to edge — the only one the warning never fired on. The caller
       reads this to say so in words instead. */
    surviving = 0;
  } else {
    const distToCore = edt(core, n, /* seedWhere */ 1);
    /* One cell of slack on the dilation, and it is not a fudge.

       The erosion is measured from a cell CENTRE to the boundary and rounded down by half a
       cell (see `clearMm`), so the raster core is a little smaller than the true one; the
       dilation then measures centre-to-centre, so it starts a little short. Both errors are
       bounded by half a cell and both point the same way, which shows up as a one-cell rim of
       false "too thin" all the way round every healthy shape — 192 cells on a plain 40 mm
       disc, in the first run of this code. Allowing the dilation the cell it lost cancels
       them. It is a discretisation term, so it scales with the grid and vanishes as the grid
       gets finer, unlike a tolerance on the threshold itself. */
    const reach = minFeatureMm + cell;
    for (let k = 0; k < thin.length; k++) {
      if (!inside[k]) continue;
      const dMm = Math.sqrt(distToCore[k]) * cell;
      if (dMm <= reach) surviving++;
      else thin[k] = 1;
    }
  }

  // --- the switch spot, from the SURVIVING material, the way the build does
  const spot = switchSpotFromField(inside, thin, clearMm, n, x0, y0, cell, hasCore);

  return {
    n, x0, y0, cell, inside, thin, clearMm,
    switchSpot: spot.pos,
    switchClearMm: spot.clear,
    survivingFrac: insideCount ? surviving / insideCount : 0,
  };
}

/**
 * Whether a `sizeMm` square centred at (cx, cy) is entirely inside the material that survives
 * the build's minimum-feature pass.
 *
 * Sampled against the raster rather than inferred from the inscribed-circle radius, which is
 * the tempting shortcut and is wrong in both directions: the radius test passes a square whose
 * CORNERS poke out of a round shape, and fails a square that fits comfortably in a long thin
 * one. The switch column is a square, so the honest question is whether that square's cells
 * are all there.
 */
export function columnFits(f: ThinField, cx: number, cy: number, sizeMm: number): boolean {
  const half = sizeMm / 2;
  const step = Math.max(f.cell, sizeMm / 12);
  for (let y = cy - half; y <= cy + half + 1e-9; y += step) {
    for (let x = cx - half; x <= cx + half + 1e-9; x += step) {
      const col = Math.round((x - f.x0) / f.cell - 0.5);
      const row = Math.round((y - f.y0) / f.cell - 0.5);
      if (col < 0 || row < 0 || col >= f.n || row >= f.n) return false;
      const k = row * f.n + col;
      if (!f.inside[k] || f.thin[k]) return false;
    }
  }
  return true;
}

/**
 * Where the build will centre the switch, measured on the raster.
 *
 * The same rule as `switchSpotOf` — start at the area centroid, slide toward the pole of
 * inaccessibility only until clearance reaches 60% of the best available — but computed from
 * the material that SURVIVES the open, because that is what `buildClicker` measures
 * (`switchSpotOfSection` runs on the section `makeCustom` has already opened). Reading the raw
 * ring instead would put the marker somewhere the build does not, on exactly the shapes where
 * it matters: the ones with a spur.
 */
function switchSpotFromField(
  inside: Uint8Array, thin: Uint8Array, clearMm: Float32Array,
  n: number, x0: number, y0: number, cell: number, opened: boolean,
): { pos: [number, number]; clear: number } {
  let sx = 0;
  let sy = 0;
  let count = 0;
  let poleI = -1;
  let poleClear = 0;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const k = row * n + col;
      if (!inside[k]) continue;
      if (opened && thin[k]) continue;
      sx += col;
      sy += row;
      count++;
      if (clearMm[k] > poleClear) { poleClear = clearMm[k]; poleI = k; }
    }
  }
  if (!count || poleI < 0) return { pos: [0, 0], clear: 0 };
  const toWorld = (col: number, row: number): [number, number] =>
    [x0 + (col + 0.5) * cell, y0 + (row + 0.5) * cell];
  const centroid = toWorld(sx / count, sy / count);
  const pole = toWorld(poleI % n, Math.floor(poleI / n));
  const clearAt = (x: number, y: number): number => {
    const col = Math.round((x - x0) / cell - 0.5);
    const row = Math.round((y - y0) / cell - 0.5);
    if (col < 0 || row < 0 || col >= n || row >= n) return 0;
    const k = row * n + col;
    if (!inside[k] || (opened && thin[k])) return 0;
    return clearMm[k];
  };
  const target = poleClear * 0.6;
  let px = centroid[0];
  let py = centroid[1];
  if (clearAt(px, py) < target) {
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      px = centroid[0] + (pole[0] - centroid[0]) * t;
      py = centroid[1] + (pole[1] - centroid[1]) * t;
      if (clearAt(px, py) >= target) break;
    }
  }
  return { pos: [px, py], clear: clearAt(px, py) };
}

/**
 * Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher, 2012).
 *
 * Returns, for every cell, the squared distance IN CELLS to the nearest cell whose mask value
 * is `seedWhere`. Two separable passes of a lower-envelope scan, O(cells), and exact — a
 * chamfer approximation would be the same code length and a few per cent wrong, which on a
 * 1 mm threshold is the difference between shading a feature and not.
 *
 * `BIG` rather than `Infinity` because the parabola intersection divides differences of the
 * cost function, and ∞ − ∞ is NaN — which would silently poison a whole row.
 */
function edt(mask: Uint8Array, n: number, seedWhere: 0 | 1): Float64Array {
  const BIG = 1e12;
  const f = new Float64Array(n * n);
  for (let k = 0; k < f.length; k++) f[k] = mask[k] === seedWhere ? 0 : BIG;

  const line = new Float64Array(n);
  const out = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  const pass = (get: (i: number) => number, set: (i: number, val: number) => void) => {
    for (let i = 0; i < n; i++) line[i] = get(i);
    let k = 0;
    v[0] = 0;
    z[0] = -BIG;
    z[1] = BIG;
    for (let q = 1; q < n; q++) {
      let s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (k > 0 && s <= z[k]) {
        k--;
        s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = BIG;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const d = q - v[k];
      out[q] = d * d + line[v[k]];
    }
    for (let i = 0; i < n; i++) set(i, out[i]);
  };

  for (let row = 0; row < n; row++) {
    pass((i) => f[row * n + i], (i, val) => { f[row * n + i] = val; });
  }
  for (let col = 0; col < n; col++) {
    pass((i) => f[i * n + col], (i, val) => { f[i * n + col] = val; });
  }
  return f;
}

/* ======================================================================================
   Handles — what §2a calls "the shape data drives it".
   ====================================================================================== */

/** The four things a handle can change. A shape declares which of them it has. */
export type HandleKind = 'corner' | 'count' | 'feature' | 'size';

export interface HandleSpec {
  kind: HandleKind;
  /** Shown while dragging, and as the handle's accessible name. */
  label: string;
  /** How the current value reads, for the drag readout. */
  format: (p: ShapeParams) => string;
}

/** One handle, placed. `slot` distinguishes the four `size` grips from one another. */
export interface PlacedHandle {
  kind: HandleKind;
  slot: number;
  x: number;
  y: number;
  label: string;
}

/** What a shape's handles are, by `BaseShapeKind`. The canvas reads this and nothing else —
 *  which is what makes it generic, and what lets a fifteenth shape declare a handle without
 *  the canvas learning about it. */
export const HANDLES: Partial<Record<BaseShapeKind, HandleKind[]>> = {
  circle: ['size'],
  square: ['corner', 'size'],
  rect: ['corner', 'size'],
  squircle: ['size'],
  capsule: ['size'],
  hexagon: ['size'],
  ngon: ['count', 'size'],
  star: ['count', 'feature', 'size'],
  cross: ['feature', 'size'],
  heart: ['size'],
  egg: ['size'],
  shield: ['size'],
  tag: ['size'],
  arch: ['size'],
  custom: ['size'],
  outline: [],
};

const HANDLE_LABEL: Record<HandleKind, string> = {
  corner: 'Corner radius',
  count: 'Points',
  feature: 'Notch',
  size: 'Size',
};

/** What `count` means on this shape, and what `feature` means. Only the wording differs. */
export function handleLabel(kind: HandleKind, shape: BaseShapeKind): string {
  if (kind === 'count') return shape === 'star' ? 'Points' : 'Sides';
  if (kind === 'feature') return shape === 'star' ? 'Sharpness' : 'Arm width';
  return HANDLE_LABEL[kind];
}

/**
 * Where each of a shape's handles sits, in editor mm, given the outline it currently has.
 *
 * Recomputed every frame and never cached: dragging one handle moves another (growing a
 * star's point count shortens the leg the count handle rides on), and a stale position is a
 * handle that jumps out from under the cursor.
 */
export function placeHandles(p: ShapeParams, ring: Ring): PlacedHandle[] {
  const kinds = HANDLES[p.kind] ?? [];
  const [minX, minY, maxX, maxY] = bboxOf(ring);
  const out: PlacedHandle[] = [];
  for (const kind of kinds) {
    const label = handleLabel(kind, p.kind);
    if (kind === 'size') {
      const corners: [number, number][] = [
        [maxX, maxY], [minX, maxY], [minX, minY], [maxX, minY],
      ];
      corners.forEach(([x, y], slot) => out.push({ kind, slot, x, y, label }));
    } else if (kind === 'corner') {
      // On the top-right corner's arc, at 45° — where the roundness is most visible and where
      // a radial pull reads as "make this corner rounder".
      const w = maxX - minX;
      const h = maxY - minY;
      const r = Math.min(0.4, Math.max(0, p.shapeCornerPct)) * Math.min(w, h);
      const ix = maxX - r;
      const iy = maxY - r;
      const k = Math.SQRT1_2;
      out.push({ kind, slot: 0, x: ix + r * k, y: iy + r * k, label });
    } else if (kind === 'count') {
      // On the outline itself, at the top — the point the user will drag round the perimeter.
      const at = pointAtAngle(ring, Math.PI / 2);
      out.push({ kind, slot: 0, x: at[0], y: at[1], label });
    } else {
      // 'feature': on the notch. A star's valley, a cross's inner corner. Both are the
      // outline's nearest approach to the centre in the upper-right quadrant.
      const at = innerPoint(ring);
      out.push({ kind, slot: 0, x: at[0], y: at[1], label });
    }
  }
  return out;
}

/** Where a ray from the origin at `angle` leaves the ring. */
function pointAtAngle(ring: Ring, angle: number): [number, number] {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best: [number, number] = [dx, dy];
  let bestT = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const det = -dx * ey + ex * dy;
    if (Math.abs(det) < 1e-12) continue;
    const t = (-a[0] * ey + ex * a[1]) / det;
    const u = (dx * a[1] - dy * a[0]) / det;
    if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t > bestT) {
      bestT = t;
      best = [dx * t, dy * t];
    }
  }
  return best;
}

/** The outline's nearest approach to the centre, searched in the upper half so the handle
 *  lands somewhere a right-handed drag can reach. */
function innerPoint(ring: Ring): [number, number] {
  let best: [number, number] = ring[0] ?? [0, 0];
  let bestD = Infinity;
  for (const [x, y] of ring) {
    if (y < 0) continue;
    const d = Math.hypot(x, y);
    if (d < bestD) { bestD = d; best = [x, y]; }
  }
  return best;
}

/** Everything a drag needs to remember from the moment the pointer went down. */
export interface DragStart {
  handle: PlacedHandle;
  /** The pointer, in editor mm, at pointerdown. */
  world: [number, number];
  /** The shape's parameters at pointerdown — every delta is measured from these, so a drag
   *  cannot compound its own output and run away. */
  params: ShapeParams;
  /** The outline's half-extents at pointerdown, mm. */
  half: [number, number];
}

/**
 * Turn a live pointer position into new shape parameters.
 *
 * Everything is measured from `start`, never from the current value: a handle whose new value
 * is a function of its own last value accelerates under a steady drag, which feels like the
 * control is fighting you. This is also why `DragStart` carries a whole `ShapeParams` rather
 * than a scalar.
 */
export function dragHandle(start: DragStart, world: [number, number]): ShapeParams {
  const p = { ...start.params };
  const [hx, hy] = start.half;
  switch (start.handle.kind) {
    case 'corner': {
      // Radial pull away from the corner's arc centre. The same 0..0.4 fraction of the short
      // side that `genShapeRaw` clamps to, so the number the editor writes is the number the
      // build reads.
      const short = Math.min(hx, hy) * 2;
      const r0 = Math.min(CORNER_RANGE[1], Math.max(CORNER_RANGE[0], start.params.shapeCornerPct)) * short;
      const cx = hx - r0;
      const cy = hy - r0;
      const d = Math.hypot(world[0] - cx, world[1] - cy);
      p.shapeCornerPct = clamp(short > 0 ? d / short : 0, CORNER_RANGE[0], CORNER_RANGE[1]);
      return p;
    }
    case 'count': {
      // The count follows the ANGLE SWEPT since pointerdown, not the absolute angle — so
      // grabbing the handle never snaps the shape to wherever the cursor happened to be.
      const a0 = Math.atan2(start.world[1], start.world[0]);
      const a1 = Math.atan2(world[1], world[0]);
      let swept = a1 - a0;
      while (swept > Math.PI) swept -= Math.PI * 2;
      while (swept < -Math.PI) swept += Math.PI * 2;
      // A full quarter-turn walks the whole 3..8 range, which is fast enough to feel direct
      // and slow enough that a small wobble does not change the count.
      const step = (Math.PI / 2) / 5;
      p.shapeSides = clamp(Math.round(start.params.shapeSides + swept / step), COUNT_RANGE[0], COUNT_RANGE[1]);
      return p;
    }
    case 'feature': {
      const reach = Math.hypot(hx, hy) || 1;
      const d = Math.hypot(world[0], world[1]) / reach;
      const [lo, hi] = featureRange(start.params.kind);
      p.shapeArmPct = clamp(d, lo, hi);
      return p;
    }
    case 'size':
    default: {
      // Any corner grip sets both, from the pointer's distance to the centre. A base smaller
      // than the switch cannot be built, and the fixed-size sliders stop at 24 mm, so this
      // does too rather than letting the drag reach a value the sliders cannot show.
      const w = clamp(Math.abs(world[0]) * 2, SIZE_RANGE[0], SIZE_RANGE[1]);
      const h = clamp(Math.abs(world[1]) * 2, SIZE_RANGE[0], SIZE_RANGE[1]);
      p.sizeMm = { w: Math.round(w), h: Math.round(h) };
      return p;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

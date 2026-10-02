// The framed two-layer system: a constant-width rim cut OUT of a silhouette, the band a name
// sits in, and where the frame's hanging loop rests.
//
// `buildRim` is the
// only part that needs manifold: a TRUE offset is the only construction that keeps a rim the
// same width all the way round a concave outline (a bone's waist, a house's eaves, a cat's ear
// cleft), and a scaled-down copy of the outline is not one — it moves far-from-centroid edges
// more in millimetres than near ones. So the rim is a `Blank` kind the worker cuts
// (`engine/build.ts`, `{ kind: 'rim' }`), never a helper a template calls. Everything else here
// is trig with no manifold in it, and runs on the main thread inside a template's `build()`.
import {
  buildBlank,
  edgePoint,
  offsetShapes,
  subtractShapes,
  unionShapes,
  type BlankDef,
  type BlankParams,
  type Pt,
  type Shapes,
} from '@vostok/laser';
import type { CutRing } from '@vostok/export';

/** What `buildRim` found: the ring, and whether the rim swallowed the shape and fell back to
 *  the solid silhouette — the one thing the worker has to warn about. */
export interface RimResult {
  shapes: Shapes;
  collapsed: boolean;
}

/**
 * The frame ring: the silhouette minus itself inset by `rimWidth`. `smoothing` rounds the rim's
 * INNER corner only — the outer edge stays exactly whatever the silhouette drew — by eroding a
 * little further and growing back, the same trick the `hug` blank already uses.
 *
 * A rim wider than the shape has room for (`rimWidth` ≥ half the local feature width) erodes to
 * nothing. That is a setting to fix, not a crash: the piece falls back to the solid silhouette
 * and `collapsed` says so.
 */
export function buildRimResult(wasm: any, outer: Shapes, rimWidth: number, smoothing = 0): RimResult {
  const solid = outer.length ? unionShapes(wasm, outer) : [];
  if (!solid.length) return { shapes: solid, collapsed: false };
  if (!(rimWidth > 0)) return { shapes: solid, collapsed: true };
  const s = Math.max(0, smoothing);
  let inner = offsetShapes(wasm, solid, -rimWidth);
  if (s > 0.05 && inner.length) {
    // Rounding the inner corners costs an erosion of `rimWidth + s` before the grow-back, and
    // that extra bite is not free on a narrow shape: a bone's waist corridor pinches shut at
    // 6.75 mm where it survives 5, and the one window comes back as five beads. The design's
    // guard is on `rimWidth` (§1.3), so the smoothing may not spend it — the rounded inset is
    // taken only when it leaves the window in as many pieces as the plain one.
    const bitten = offsetShapes(wasm, solid, -(rimWidth + s));
    const rounded = bitten.length ? offsetShapes(wasm, bitten, s) : [];
    if (rounded.length === inner.length) inner = rounded;
  }
  if (!inner.length) return { shapes: solid, collapsed: true };
  const ring = subtractShapes(wasm, solid, inner);
  if (!ring.length) return { shapes: solid, collapsed: true };
  return { shapes: ring, collapsed: false };
}

/** The frame ring alone — `buildRimResult` for callers with nothing to warn about. */
export function buildRim(wasm: any, outer: Shapes, rimWidth: number, smoothing = 0): Shapes {
  return buildRimResult(wasm, outer, rimWidth, smoothing).shapes;
}

/** Rim width from the silhouette's diameter (its longest span on anything not round):
 *  7 % of it, never under 5 mm (the rim disappears) nor over 14 (it swallows the face). */
export function rimWidthFor(diameter: number): number {
  return Math.min(14, Math.max(5, 0.07 * diameter));
}

/** Chord width of a circle radius `R` at height `y` from its centre — the standard segment
 *  identity (sagitta h = R − |y|, chord = 2·√(h·(2R−h)) = 2·√(R² − y²)). How much room a name
 *  has across a band. */
export function bandChordWidth(R: number, y: number): number {
  return 2 * Math.sqrt(Math.max(0, R * R - y * y));
}

/** The circle's arc below `y = bandY`, closed by the chord: a true circular segment, wound CCW
 *  (left chord end → round the bottom → right chord end → the chord closes it). */
export function circleBandRing(R: number, bandY: number, n = 48): CutRing {
  const r = Math.max(0, R);
  const y = Math.max(-r, Math.min(r, bandY));
  const half = Math.sqrt(Math.max(0, r * r - y * y));
  const end = Math.atan2(y, half); // the right chord end
  const start = -Math.PI - end; // the left chord end, reached the long way round the bottom
  const ring: CutRing = [];
  const steps = Math.max(2, Math.round(n));
  for (let i = 0; i <= steps; i++) {
    const t = start + ((end - start) * i) / steps;
    ring.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return ring;
}

/** The same half-plane clip on a rectangle: a strip `depth` mm deep, flush with one edge of a
 *  `w × h` box centred on the origin. Wound CCW. */
export function stripBandRing(w: number, h: number, side: 'top' | 'bottom', depth: number): CutRing {
  const d = Math.max(0, Math.min(h, depth));
  const lo = side === 'top' ? h / 2 - d : -h / 2;
  const hi = side === 'top' ? h / 2 : -h / 2 + d;
  return [[-w / 2, lo], [w / 2, lo], [w / 2, hi], [-w / 2, hi]];
}

/** Where a frame's loop rests: the blank's own hole point when it names one (a tree's apex, a
 *  house's roof peak), else the top-centre point of its real outline — the ear, not the bbox. */
export function rimLoopAnchor(def: BlankDef, p: BlankParams): Pt {
  return def.holeAt?.(p) ?? edgePoint(buildBlank(def, p), 'top', 0.5);
}

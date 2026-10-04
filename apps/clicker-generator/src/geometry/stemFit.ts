// Switch stem fit: open or close the cross hole in the cap's keycap-mount post by an exact
// clearance, in millimetres.
//
// The previous control scaled the whole post about its centre by a percentage and clipped the
// outside back. The hole did move, but by `percent x distance from the centre`, and the walls
// that grip the switch are only 0.6 mm out: the whole -5%..+5% range moved each of them 0.03 mm.
// That is under what a printer resolves, so every setting printed as the same part. Measured on
// mx-stem.3mf, 2026-09-17: arm width 1.194 mm at 0%, 1.254 mm at +5%.
//
// This is the keycap generator's `stemClearance.js` fast path, for the one stem shape the
// clicker ships. Both of its stems (mx-stem.3mf for the flat clicker, keycap.json's for letter
// blocks) carry the same cross hole, 4.04 mm with 1.19 mm arms, identical at every height from
// one end of the post to the other. So one 2D offset of that contour and one boolean does it:
//
//   looser  (+): cut a ring out of the post around the hole, `fitMm / 2` deep on every wall.
//   tighter (-): add a ring inside the hole, `fitMm / 2` thick on every wall.
//
// Miter joins, so the cross keeps the square corners the switch stem meets. The outer post and
// the post's height are never touched, so everything stacked on `stemBB` stays where it was.
type Wasm = any;
type Solid = any;

/** The control's range and step. The fit test ladder snaps to the same step, so every number
 *  printed on a tile is one the stepper can show. */
export const STEM_FIT_MIN_MM = -0.4;
export const STEM_FIT_MAX_MM = 0.4;
export const STEM_FIT_STEP_MM = 0.05;

const MITER_LIMIT = 4;
// A hole must sit at least this far inside the post's outline to count as the socket.
const NESTED_MARGIN_MM = 0.02;
// Heights sampled to confirm the hole is the same all the way through.
const PROBE_COUNT = 5;
const CONSTANT_EPS_MM = 0.01;
// The ring's inner edge would otherwise sit exactly on the existing hole wall, and a boolean
// between two coincident faces is where sliver bodies come from. Moving that one edge a hair
// further into space the op leaves alone costs nothing: the other edge is still the true one.
const NUDGE_MM = 0.02;
// A subtracted ring overshoots the post's ends (cutting air is free). An added ring stops a hair
// short of them so it can never make the post taller.
const OVERSHOOT_MM = 0.05;
const INSET_MM = 0.002;

type Poly = [number, number][];

function signedArea(p: Poly): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function bboxOf(p: Poly) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of p) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

/** The holes in one slice of the post, largest first. */
function holesAt(stem: Solid, z: number): { poly: Poly; w: number; h: number }[] {
  const cs = stem.slice(z);
  const polys: Poly[] = cs.toPolygons();
  cs.delete();
  const items = polys
    .map((poly) => ({ poly, area: Math.abs(signedArea(poly)), box: bboxOf(poly) }))
    .sort((a, b) => b.area - a.area);
  const outer = items[0];
  if (!outer) return [];
  const m = NESTED_MARGIN_MM;
  return items
    .slice(1)
    .filter(({ box }) =>
      box.minX > outer.box.minX + m && box.maxX < outer.box.maxX - m &&
      box.minY > outer.box.minY + m && box.maxY < outer.box.maxY - m)
    .map(({ poly, box }) => ({ poly, w: box.w, h: box.h }));
}

/**
 * The stem with its cross hole opened (`fitMm` > 0) or closed (`fitMm` < 0) by `fitMm` in
 * total, `fitMm / 2` per wall.
 *
 * `solid` is always a new object the caller owns, including when there is nothing to do.
 * `applied` is false only when a non-zero fit was asked for and the post has no hole that runs
 * straight through it; `solid` is then the stem as authored, and the caller says so.
 */
export function applyStemFit(wasm: Wasm, stem: Solid, fitMm: number): { solid: Solid; applied: boolean } {
  const asAuthored = () => stem.translate([0, 0, 0]);
  if (!(Math.abs(fitMm) > 1e-4)) return { solid: asAuthored(), applied: true };

  const { CrossSection, Manifold } = wasm;
  const bb = stem.boundingBox();
  const zMin: number = bb.min[2];
  const zMax: number = bb.max[2];
  if (!(zMax - zMin > 1e-3)) return { solid: asAuthored(), applied: false };

  const probes = Array.from({ length: PROBE_COUNT }, (_, i) =>
    holesAt(stem, zMin + ((i + 0.5) / PROBE_COUNT) * (zMax - zMin)));
  const mid = probes[Math.floor(PROBE_COUNT / 2)];
  const straightThrough = mid.length > 0 && probes.every((holes) =>
    holes.length === mid.length && holes.every((h, i) =>
      Math.abs(h.w - mid[i].w) < CONSTANT_EPS_MM && Math.abs(h.h - mid[i].h) < CONSTANT_EPS_MM));
  if (!straightThrough) return { solid: asAuthored(), applied: false };

  const trash: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(o: T): T => {
    trash.push(o);
    return o;
  };
  const opening = fitMm > 0;
  let out: Solid = stem;
  try {
    for (const { poly } of mid) {
      // `toPolygons` winds a hole opposite its outline; as a shape of its own it wants CCW.
      const contour = signedArea(poly) < 0 ? poly.slice().reverse() : poly;
      const hole = track(new CrossSection([contour], 'Positive'));
      const moved = track(hole.offset(fitMm / 2, 'Miter', MITER_LIMIT));
      const nudged = track(hole.offset(opening ? -NUDGE_MM : NUDGE_MM, 'Miter', MITER_LIMIT));
      const ring = track(opening ? moved.subtract(nudged) : nudged.subtract(moved));
      if (ring.isEmpty()) continue;
      const z0 = opening ? zMin - OVERSHOOT_MM : zMin + INSET_MM;
      const z1 = opening ? zMax + OVERSHOOT_MM : zMax - INSET_MM;
      const prism = track(track(Manifold.extrude(ring, z1 - z0)).translate([0, 0, z0]));
      const next = opening ? out.subtract(prism) : out.add(prism);
      if (out !== stem) track(out);
      out = next;
    }
    if (out === stem) return { solid: asAuthored(), applied: false };
    const parts = out.decompose();
    const oneBody = parts.length === 1;
    for (const p of parts) p.delete();
    if (out.status() !== 'NoError' || out.isEmpty() || !oneBody) {
      out.delete();
      return { solid: asAuthored(), applied: false };
    }
    return { solid: out, applied: true };
  } finally {
    for (const o of trash) {
      try { o.delete(); } catch { /* already gone */ }
    }
  }
}

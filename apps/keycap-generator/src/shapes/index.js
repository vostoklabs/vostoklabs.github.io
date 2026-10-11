/**
 * Keycap shapes made from numbers rather than loaded from the owner's CAD: round with straight
 * walls, round tapered (typewriter style), and square with straight walls, each at any width
 * (`sizeMM`) within its range (dimensions.js).
 *
 * A generated cap comes back in exactly the shape `loadKeycap` (src/keycap.js) returns, so the
 * app carves, trims, fits and exports it as it would a loaded one: `{ shellGeometry,
 * stemGeometry, meta }`, Z up, the outline centred on the origin, the top flat (caps print face
 * down), `meta.bbox` the shell alone and `meta.stemBbox` the stems alone.
 *
 * THE SIDES COME DOWN FLUSH WITH THE STEM. The rim and the stem's bottom both stand on z = 0, so
 * nothing hangs below the walls. A round cap's inside lets the switch housing's corners in later
 * than a square cap's does, so its rim is thinned at the bottom edge (`RIM_WALL_MM`, flaring back
 * to the full wall over `RIM_FLARE_MM`) to press as far as it can; `meta.travelMM` says how far
 * that is (clearance.js), which on a round 1u is short of the switch's full 4 mm.
 *
 * CAP HEIGHT AND STEM RECESS (src/capHeight.js) rebuild a generated cap rather than cut it, with
 * `lowerMM` and `recessMM` here: the same rim, flare and all, with the top `lowerMM` lower, and
 * the stem starting `recessMM` above the rim. So a lower cap keeps its width and its travel (a
 * tapered one, cut from below, would come in with its lean and lose both), and the travel is
 * worked out for the cap as it now is, a recess included.
 *
 * HOW A CAP IS BUILT. Every outline here is convex: a stadium (a circle at 1u) or a rounded
 * rectangle, and every height of the cap is that outline inset by some distance. So the outer
 * solid is the convex hull of a handful of inset rings stacked at their heights (the rim, then
 * the top edge's round-over, ring by ring, up to the flat top), and the cavity is the hull of two
 * more, inset by the wall, with a second hull for the flare at the rim. Insetting a rounded
 * rectangle by d is exact as another rounded rectangle (corner radius less d), and the hull
 * between two insets of one outline is every inset between, so the walls come out straight or
 * evenly tapered with no boolean but the ones that hollow the cap. Hulls of a few hundred points
 * keep even a 6.5u spacebar to a few thousand triangles.
 */
import { roundedRectRing } from '@vostok/laser/rings';
import { withScope } from '@vostok/manifold';
import { buildStems, STEM_FUSE_MM } from './stems.js';
import { geometryOf } from './mesh.js';
import {
  CAP_HEIGHT_MM, TOP_THICKNESS_MM, TOP_ROUND_OVER_MM, RIM_FLARE_MM, capOutline, insideInset, wallAcross,
} from './dimensions.js';
import { FULL_TRAVEL_MM, capTravelMM } from './clearance.js';

export {
  KEY_PITCH_MM, DEFAULT_SIZE_MM, SIZE_RANGE_MM, ROUND_TAPER_LEAN, SQUARE_CORNER_R_MM, TOP_ROUND_OVER_MM, WALL_MM,
  RIM_WALL_MM, RIM_FLARE_MM, TOP_THICKNESS_MM, CAP_HEIGHT_MM, SHAPES, shapeSizes, sizeRangeMM,
} from './dimensions.js';
export { FULL_TRAVEL_MM, ACTUATION_MM, travelBeforeContact } from './clearance.js';
export { swapToLowProfileStems } from './lowProfile.js';

/** Facets per 90° of an outline's corner. On a round cap's r = 9.07 a chord sags 0.01 mm; the
 *  square's r = 1.5 needs far fewer for the same. */
const CORNER_SEGMENTS = { round: 16, 'round-tapered': 16, square: 6 };
/** Rings in the top edge's round-over: 0.8 mm of arc, under 0.01 mm of sag at 6. */
const ROUND_OVER_STEPS = 6;
/** The cavity runs this far below the rim, so hollowing never leaves a face on the rim's plane. */
const CAVITY_PAD_MM = 1;

/**
 * Build one cap.
 *
 * The side profile, as an inset `d` from the rim's outline against height `z`: the wall runs from
 * d = 0 at the rim along d = s z, with s = 0 for a straight wall; near the top it turns into the
 * round-over's arc, tangent to the wall and to the top plane. The arc's centre sits R below the
 * top and R in from the wall line, and where it meets the top plane is the edge of the flat face,
 * which is the legend's room. A lower tapered cap leans in over less height, so its top is bigger.
 *
 * @param {object} api  the initialised Manifold module
 * @param {{ shape: string, sizeId: string, sizeMM?: number, lowerMM?: number, recessMM?: number }} which
 *   a `SHAPES` id, a `shapeSizes` id; optionally the width at the rim (clamped to `sizeRangeMM`),
 *   how far the cap is cut down from below (Cap height) and how far the stem's bottom sits above
 *   the rim (Stem recess). capHeight.js keeps the last two within the socket.
 * @returns {{ shellGeometry: THREE.BufferGeometry, stemGeometry: THREE.BufferGeometry, meta: object }}
 */
export function buildShapeCap(api, { shape, sizeId, sizeMM, lowerMM = 0, recessMM = 0, wallMM = null }) {
  const o = capOutline(shape, sizeId, sizeMM);
  const { L, W, r, lean: s } = o;
  const topZ = CAP_HEIGHT_MM - lowerMM;
  const ceilZ = topZ - TOP_THICKNESS_MM;
  // Wall height: how far the walls come down from the top, null for all the way. They end no
  // higher than the ceiling, so the stem still hangs from the top plate.
  const cutZ = wallMM == null ? 0 : Math.min(ceilZ, Math.max(0, topZ - wallMM));
  const k = Math.hypot(1, s); // 1 / cos of the wall's lean
  const seg = CORNER_SEGMENTS[shape];
  const ring = (d, z) => roundedRectRing(L - 2 * d, W - 2 * d, r - d, seg).map(([x, y]) => [x, y, z]);

  // The round-over's centre, and the arc from the wall's tangent point (pointing along the
  // wall's outward normal, angle pi - atan s) to the top's (straight up, pi / 2).
  const R = TOP_ROUND_OVER_MM;
  const zc = topZ - R;
  const dc = s * zc + R * k;
  const a0 = Math.PI - Math.atan(s);
  const outer = ring(0, 0);
  for (let i = 0; i <= ROUND_OVER_STEPS; i++) {
    const a = a0 + ((Math.PI / 2 - a0) * i) / ROUND_OVER_STEPS;
    outer.push(...ring(dc + R * Math.cos(a), zc + R * Math.sin(a)));
  }
  // The cavity, from below the rim up to the ceiling, inset by the wall's thickness across; on a
  // flared rim, a second hull from the thin bottom edge (straight down below the rim) up to the
  // full wall. Below the flare's top the first lies inside the second, so the two together are
  // exactly the inside `insideInset` describes, which is what clearance.js measures.
  const wallInset = (z) => wallAcross(s) + s * z;
  const cavities = [[...ring(wallInset(-CAVITY_PAD_MM), -CAVITY_PAD_MM), ...ring(wallInset(ceilZ), ceilZ)]];
  if (o.flared) {
    const rim = insideInset(o, 0);
    cavities.push([...ring(rim, -CAVITY_PAD_MM), ...ring(rim, 0), ...ring(insideInset(o, RIM_FLARE_MM), RIM_FLARE_MM)]);
  }
  const travel = capTravelMM(o, { ceilingMM: ceilZ, recessMM, fromMM: cutZ });

  return withScope((keep) => {
    let shell = keep(api.Manifold.hull(outer));
    for (const c of cavities) shell = keep(shell.subtract(keep(api.Manifold.hull(c))));
    if (cutZ > 0) shell = keep(shell.trimByPlane([0, 0, 1], cutZ));
    const stems = keep(buildStems(api, 'mx', o.centres, recessMM, ceilZ + STEM_FUSE_MM - recessMM));
    const sb = shell.boundingBox();
    const tb = stems.boundingBox();
    return {
      shellGeometry: geometryOf(shell),
      stemGeometry: geometryOf(stems),
      meta: {
        generatedFrom: `${o.shapeInfo.label} · ${o.size.label}`,
        triangles: shell.numTri() + stems.numTri(),
        vertices: shell.numVert() + stems.numVert(),
        bbox: { min: [...sb.min], max: [...sb.max] },
        center: [0, 0],
        topZ: sb.max[2],
        dishBottomZ: sb.max[2],
        topExtent: [L - 2 * dc, W - 2 * dc],
        hasStem: true,
        stemBbox: { min: [...tb.min], max: [...tb.max] },
        // The stems run STEM_FUSE_MM into the top plate, so the socket is that much shallower
        // than the stem is tall: said here for capHeight.js, which would otherwise read the stem.
        socketDepthMM: ceilZ - recessMM,
        // The width built, after clamping, so the control can show it.
        sizeMM: o.sizeMM,
        // How far the key goes down before the cap meets the switch, and so how far the stem
        // could still be recessed before that is short of full travel.
        travelMM: travel,
        safeRecessMM: Math.max(0, travel - FULL_TRAVEL_MM),
        // What capHeight.js rebuilds this cap from.
        shapeCap: { shape, sizeId, sizeMM: o.sizeMM, lowerMM, recessMM, ...(cutZ > 0 ? { wallMM: topZ - cutZ } : {}) },
      },
    };
  });
}

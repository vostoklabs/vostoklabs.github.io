/**
 * Cap height and stem recess: how far a cap sits down on its switch.
 *
 * A cap rests on the switch by the bottom of its stem, which stands on the switch's slider. Cut
 * the stem shorter from below and the cap sits that much lower. Two settings do it:
 *
 *   lowerMM   "Cap height": the stem AND the walls are cut by the same amount, so their bottoms
 *             stay flush. The whole cap sits lower and the rim keeps its place relative to the
 *             slider, so it cannot reach the plate any sooner than before.
 *   wallMM    "Wall height": how far the walls come down from the top (null: all the way). Only
 *             the walls are cut, from below, and never above the ceiling, so the stem still hangs
 *             from the top plate and the cap still sits where it did; the shortest is the top
 *             plate alone. The walls then end above the stem, which needs supports to print.
 *   recessMM  "Stem recess": only the stem is cut, so its bottom sits that far above the rim.
 *             The cap sits lower and the rim drops with it, towards the switch: at full travel
 *             the slider's shoulder is 2.6 mm above the plate and the switch's flange (15.6 mm
 *             square, 15.9 with its ears) stands 1.0 mm above it. A Standard skirt is 15.67 mm
 *             inside, so it barely clears the flange, and the rim can come down about 1.1 mm
 *             with a 0.5 mm margin. Past that (`safeRecess`) it may touch the switch when the key
 *             is pressed all the way; the app says so rather than refusing, because a board
 *             without a plate or a cap that is only decorative may want it.
 *
 * Both only work while the switch's cross still fits in the socket: once the cross reaches the
 * socket's floor, the cap rests on the cross instead and goes no lower. So the limit is the
 * socket's depth (the stem's own height, the socket being a through-hole up to the ceiling) less
 * the cross and a margin. On Standard that is about 6 mm, on a generated shape 5.5; Low profile
 * and Thocky already rest on the cross, so `capTrimLimits` gives them nothing and the controls stay
 * hidden.
 *
 * The result is moved down by `lowerMM`, so the rim is back on z = 0 and everything that reads the
 * cap's metadata (the legend's top, the homing bump, the camera) sees the cap as it now is.
 *
 * A generated shape (src/shapes/, `meta.shapeCap`) is rebuilt to the same settings rather than
 * cut: a round one's rim is thinned at its bottom edge to let the switch in further, which a cut
 * from below would take off, and a tapered one would come in with its lean. Rebuilt, it keeps its
 * rim and says how far it now travels (`meta.travelMM`), a recess included.
 *
 * No DOM. Takes the initialised Manifold module like stemClearance.js, so a node test runs it.
 */
import * as THREE from 'three';
import { capTrimLimits, clampCapTrim, cutFromBelow } from '@vostok/keycaps';
import { weldPositions } from './meshUtils.js';
import { buildShapeCap } from './shapes/index.js';

// The limits, the clamp and the cut are the shelf's ("Keycap trim", @vostok/keycaps), shared with
// the clicker's letter blocks; re-exported so the rest of the app keeps importing them from here.
export { MIN_SOCKET_MM, MAX_RECESS_MM, SAFE_RECESS_MM, capTrimLimits, clampCapTrim } from '@vostok/keycaps';

/** A loaded shell keeps the STEP tessellation's split vertices, so it is welded first, as the
 *  carve does (manifold.js `geomToManifold`). */
function toManifold(api, geom) {
  const g = weldPositions(geom);
  return api.Manifold.ofMesh(new api.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(g.getAttribute('position').array),
    triVerts: Uint32Array.from(g.getIndex().array),
  }));
}

function toGeometry(man) {
  const m = man.getMesh();
  const pos = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) {
    pos[i * 3] = m.vertProperties[i * m.numProp];
    pos[i * 3 + 1] = m.vertProperties[i * m.numProp + 1];
    pos[i * 3 + 2] = m.vertProperties[i * m.numProp + 2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

/** Keep what is above `cutZ`, then move it down by `dropZ`, on a geometry. Frees what it makes. */
function cutGeometryFromBelow(api, geom, cutZ, dropZ) {
  const whole = toManifold(api, geom);
  const moved = cutFromBelow(whole, cutZ, dropZ);
  const out = toGeometry(moved);
  whole.delete(); moved.delete();
  return out;
}

/**
 * The cap with its stem and walls cut from below.
 *
 * Takes and returns the shape `loadKeycap` returns. The geometries handed in are not changed (the
 * caller keeps the cap as loaded, to trim again from it when a setting moves); with both settings
 * at 0 the same objects come back. Both are welded here before Manifold reads them.
 *
 * Each part is cut from its OWN bottom: the walls from the rim, the stem from the stem's bottom.
 * So the two keep the relation they were made with, plus the recess. A generated shape is built
 * again instead, the trim added to any it already has (see the top of this file).
 *
 * @param {object} api  the initialised Manifold module
 * @param {{ shellGeometry: THREE.BufferGeometry, stemGeometry: THREE.BufferGeometry|null, meta: object }} cap
 * @param {{ lowerMM?: number, recessMM?: number }} settings  clamped to `capTrimLimits` here
 * @param {{ stubs?: boolean }} [kind]  as `capTrimLimits`
 */
export function trimCap(api, cap, settings, kind) {
  const { lowerMM, recessMM, wallMM } = clampCapTrim(settings, capTrimLimits(cap.meta, kind), cap.meta.topZ);
  if (!lowerMM && !recessMM && wallMM == null) return cap;
  const made = cap.meta.shapeCap;
  if (made) {
    const out = buildShapeCap(api, { ...made, lowerMM: made.lowerMM + lowerMM, recessMM: made.recessMM + recessMM, wallMM: wallMM ?? made.wallMM ?? null });
    out.meta.trim = { lowerMM, recessMM, wallMM };
    return restOnPlate(out);
  }
  const rimZ = cap.meta.bbox.min[2];
  const stemZ = cap.meta.stemBbox.min[2];
  let shellGeometry = lowerMM ? cutGeometryFromBelow(api, cap.shellGeometry, rimZ + lowerMM, lowerMM) : cap.shellGeometry.clone();
  const stemGeometry = cap.stemGeometry ? cutGeometryFromBelow(api, cap.stemGeometry, stemZ + lowerMM + recessMM, lowerMM) : null;

  const m = cap.meta;
  const down = (v) => [v[0], v[1], v[2] - lowerMM];
  const topZ = m.topZ - lowerMM;
  let bboxMin = [...m.bbox.min];
  // Short walls: the shell alone, cut where the walls now end. The stem is not touched.
  if (wallMM != null) {
    const cutZ = topZ - wallMM;
    const cut = cutGeometryFromBelow(api, shellGeometry, cutZ, 0);
    shellGeometry.dispose();
    shellGeometry = cut;
    bboxMin = [m.bbox.min[0], m.bbox.min[1], cutZ];
  }
  const meta = {
    ...m,
    triangles: shellGeometry.getIndex().count / 3,
    bbox: { min: bboxMin, max: down(m.bbox.max) },
    topZ,
    dishBottomZ: m.dishBottomZ - lowerMM,
    stemBbox: m.stemBbox && { min: [m.stemBbox.min[0], m.stemBbox.min[1], m.stemBbox.min[2] + recessMM], max: down(m.stemBbox.max) },
    ...(m.socketDepthMM != null ? { socketDepthMM: m.socketDepthMM - lowerMM - recessMM } : {}),
    trim: { lowerMM, recessMM, wallMM },
  };
  return restOnPlate({ shellGeometry, stemGeometry, meta });
}

/**
 * Walls cut short AND a stem shortened: neither reaches z = 0 any more, and a file would float the
 * cap above the plate. The whole cap moves down onto its lowest point, which changes nothing about
 * how it sits on a switch (that is the stem's bottom against the cap's ceiling). A cap that
 * already touches z = 0 is returned as it is.
 */
function restOnPlate(cap) {
  const m = cap.meta;
  const floor = Math.min(m.bbox.min[2], m.stemBbox ? m.stemBbox.min[2] : Infinity);
  if (!(floor > 1e-6)) return cap;
  cap.shellGeometry.translate(0, 0, -floor);
  cap.stemGeometry?.translate(0, 0, -floor);
  const down = (v) => [v[0], v[1], v[2] - floor];
  cap.meta = {
    ...m,
    bbox: { min: down(m.bbox.min), max: down(m.bbox.max) },
    topZ: m.topZ - floor,
    dishBottomZ: m.dishBottomZ - floor,
    ...(m.stemBbox ? { stemBbox: { min: down(m.stemBbox.min), max: down(m.stemBbox.max) } } : {}),
  };
  return cap;
}

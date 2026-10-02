import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Weld coincident vertices by POSITION ONLY.
 *
 * The keycap tessellation (and three's ExtrudeGeometry) store per-face vertices with
 * per-face normals/uvs, so the stock mergeVertices won't fuse shared edges — the seams
 * differ in normal/uv. Stripping to position first lets us recover a watertight,
 * manifold solid, which is what CSG and the 3MF need. 1e-3 mm matches the tessellator's
 * precision without over-welding real detail.
 */
export function weldPositions(geom, tol = 1e-3) {
  const p = new THREE.BufferGeometry();
  p.setAttribute('position', geom.getAttribute('position').clone());
  if (geom.index) p.setIndex(geom.index.clone());
  return mergeVertices(p, tol);
}

/**
 * The transform that lays a profile out the way it has to be PRINTED, or null when the way
 * it's modelled is already the way it prints.
 *
 * Model space is always Z-up so the legend pipeline can rely on it, but some profiles can't be
 * printed that way — a Choc cap stands on its bottom rib, because its two stub stems won't
 * survive printing flat. Keeping this in one place is what stops the preview (which rotates a
 * group) and the exports (which bake it into the geometry) from disagreeing about where the
 * cap sits.
 *
 * `rotateXDeg` overrides the profile's own orientation, for the one place the user gets to
 * choose: a Choc board can be laid out face down (180°) instead of standing (90°), trading the
 * supports for a much more fragile pair of stems. Pass nothing and the profile decides.
 *
 * The drop onto the plate is computed from the ROTATED bounding box rather than from a
 * hardcoded axis. At 90° that is the same `-bbox.min[1]` it always was; at 180° the axis that
 * ends up lowest is a different one, and an axis baked into this function is exactly the kind of
 * thing that goes unnoticed until a plate of caps is floating in the slicer.
 */
export function printMatrix(profile, meta, rotateXDeg) {
  const rotDeg = rotateXDeg ?? profile?.printRotateX ?? 0;
  if (!rotDeg) return null;
  const rot = new THREE.Matrix4().makeRotationX((rotDeg * Math.PI) / 180);
  const box = new THREE.Box3(
    new THREE.Vector3(...meta.bbox.min),
    new THREE.Vector3(...meta.bbox.max),
  ).applyMatrix4(rot);
  return new THREE.Matrix4().makeTranslation(0, 0, -box.min.z).multiply(rot);
}

/**
 * Grow/shrink a switch stem's cross-section for fit tolerance, scaling each stem in XY
 * about ITS OWN centre so a multi-stem body (2u, spacebars) keeps every stem locked to its
 * 19.05 mm switch spacing — only the local cross gets looser (+) or tighter (−).
 *
 * `tolMM` is the change in the stem's footprint across its widest XY dimension: +0.1 opens
 * the cross ~0.1 mm (easier to press onto the switch), −0.1 grips harder. Z is untouched so
 * the cap seats at the same height. Connected triangles are treated as one stem (the welded
 * Manifold solid has no shared vertices between separate stems), so the split is exact.
 *
 * Returns a NEW indexed geometry; the input is left untouched.
 */
export function scaleStemComponentsXY(geom, tolMM) {
  const src = geom.index ? geom : weldPositions(geom);
  const pos = src.getAttribute('position').array;
  const idx = src.getIndex().array;
  const nv = pos.length / 3;

  // Union-find over triangle vertices → one set per disconnected stem.
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  for (let i = 0; i < idx.length; i += 3) { union(idx[i], idx[i + 1]); union(idx[i + 1], idx[i + 2]); }

  // Per-stem XY bounds → centre + scale factor from its widest dimension.
  const groups = new Map();
  for (let v = 0; v < nv; v++) {
    const r = find(v);
    let g = groups.get(r);
    if (!g) { g = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }; groups.set(r, g); }
    const x = pos[v * 3], y = pos[v * 3 + 1];
    if (x < g.minX) g.minX = x; if (x > g.maxX) g.maxX = x;
    if (y < g.minY) g.minY = y; if (y > g.maxY) g.maxY = y;
  }
  for (const g of groups.values()) {
    g.cx = (g.minX + g.maxX) / 2;
    g.cy = (g.minY + g.maxY) / 2;
    // Per axis, not one factor taken from the widest side. A Cherry cross is square
    // (7.8955 × 7.8955 on the Standard 1u), so one shared factor happened to open both axes
    // by exactly tolMM — which is why this went unnoticed. A Kailh Choc stub is 1.60 × 3.40,
    // and the shared factor gave its NARROW axis only 47% of the requested clearance, on the
    // axis that actually grips the switch. Same arithmetic on a square stem, correct on a
    // rectangular one.
    const sx = g.maxX - g.minX;
    const sy = g.maxY - g.minY;
    g.fx = sx > 0.1 ? Math.max(0.5, (sx + tolMM) / sx) : 1;
    g.fy = sy > 0.1 ? Math.max(0.5, (sy + tolMM) / sy) : 1;
  }

  const out = src.clone();
  const op = out.getAttribute('position');
  for (let v = 0; v < nv; v++) {
    const g = groups.get(find(v));
    op.setX(v, g.cx + (pos[v * 3] - g.cx) * g.fx);
    op.setY(v, g.cy + (pos[v * 3 + 1] - g.cy) * g.fy);
  }
  op.needsUpdate = true;
  out.computeVertexNormals();
  return out;
}

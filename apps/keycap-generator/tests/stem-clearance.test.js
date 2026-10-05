/*
  Proves applyStemClearance (../src/stemClearance.js) against the REAL authored stems shipped in
  public/keycaps/**, using the REAL manifold-3d WASM build (no mocking of Manifold).

  Part of pnpm test. By hand, from the repo root:

    node_modules/.bin/esbuild apps/keycap-generator/tests/stem-clearance.test.js \
      --bundle --platform=node --format=esm --external:manifold-3d \
      --outfile=apps/keycap-generator/tests/.stem-clearance.test.mjs \
      && node apps/keycap-generator/tests/.stem-clearance.test.mjs

  `manifold-3d` stays external so node loads the npm WASM build itself, same recipe
  tests/fit-test.test.js already uses.

  Checks per profile per tol in [-0.4, -0.2, 0, +0.2, +0.4]:
    - watertight (Manifold status NoError, decomposes into exactly as many pieces as stems)
    - genus unchanged per stem (topology — the through-hole tunnel count — never changes, only
      its size does)
    - Z extent unchanged (the cap must still seat at the same height)
    - the grip dimension at MID-height changes by tol, within +/-0.02mm:
        socket (female cross recess): hole bbox width grows/shrinks by tol
        stub   (male Choc peg):       outer bbox width shrinks/grows by tol (mirrored sign)
    - runtime per call, since this runs on every stepper click
*/
import Module from 'manifold-3d';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { applyStemClearance } from '../src/stemClearance.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (!ok) failures++;
};

const api = await Module();
api.setup();

// ---------------------------------------------------------------- exactly the real pipeline
// setKeycap() (src/mount.js) runs the authored stem through Manifold once before ever storing
// it as baseStemGeometry (src/manifold.js's geomToManifold/manifoldToGeom) — reproduce that
// exactly so this test exercises the same object the app itself builds.
// Weld coincident vertices by POSITION ONLY — same effect as src/meshUtils.js's own
// weldPositions (occt-import-js's raw tessellation keeps split per-face vertices even though
// it's already indexed; the app's own setKeycap() welds before ever storing baseStemGeometry).
function weldPositions(geom, tol = 1e-3) {
  const p = new THREE.BufferGeometry();
  p.setAttribute('position', geom.getAttribute('position').clone());
  if (geom.index) p.setIndex(geom.index.clone());
  return mergeVertices(p, tol);
}
function geomToManifold(geom) {
  const g = weldPositions(geom);
  const mesh = new api.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(g.getAttribute('position').array),
    triVerts: new Uint32Array(g.getIndex().array),
  });
  return api.Manifold.ofMesh(mesh);
}
function manifoldToGeom(man) {
  const m = man.getMesh();
  const np = m.numProp;
  const vp = m.vertProperties;
  const pos = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) {
    pos[i * 3] = vp[i * np]; pos[i * 3 + 1] = vp[i * np + 1]; pos[i * 3 + 2] = vp[i * np + 2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1));
  g.computeVertexNormals();
  return g;
}
function makeGeom(body) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(body.positions, 3));
  geometry.setIndex(body.indices);
  geometry.computeVertexNormals();
  return geometry;
}
function loadBaseStemGeometry(jsonPath) {
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const raw = makeGeom(data.stem);
  const m = geomToManifold(raw);
  const base = manifoldToGeom(m);
  m.delete();
  return { baseStemGeometry: base, meta: data.meta };
}

// ---------------------------------------------------------------- independent measurement
// (deliberately NOT reusing stemClearance.js's own slice/classify code — this is meant to
// verify that module's output from the outside)
function polyBBox(poly) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
function scanX(poly, Y) {
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    if ((y1 <= Y && y2 > Y) || (y2 <= Y && y1 > Y)) xs.push(x1 + ((Y - y1) / (y2 - y1)) * (x2 - x1));
  }
  return xs.sort((a, b) => a - b);
}
function scanY(poly, X) {
  const ys = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    if ((x1 <= X && x2 > X) || (x2 <= X && x1 > X)) ys.push(y1 + ((X - x1) / (x2 - x1)) * (y2 - y1));
  }
  return ys.sort((a, b) => a - b);
}
function spanWidthContaining(coords, at) {
  for (let i = 0; i + 1 < coords.length; i += 2) {
    if (at >= coords[i] - 1e-6 && at <= coords[i + 1] + 1e-6) return coords[i + 1] - coords[i];
  }
  return null;
}
/** Classify + measure one Z-slice: a nested [outer, hole] pair -> the socket's own bbox and its
 *  tightest (arm) width; otherwise -> the lone island's own bbox (a stub). */
function measureSlice(polys) {
  const withArea = polys.map((p) => ({ poly: p, area: Math.abs(polyArea(p)), bbox: polyBBox(p) }));
  withArea.sort((a, b) => b.area - a.area);
  const outer = withArea[0];
  const nested = withArea.slice(1).filter((r) => (
    r.bbox.minX > outer.bbox.minX + 0.02 && r.bbox.maxX < outer.bbox.maxX - 0.02
    && r.bbox.minY > outer.bbox.minY + 0.02 && r.bbox.maxY < outer.bbox.maxY - 0.02
  ));
  if (nested.length === 1 && withArea.length === 2) {
    const hole = nested[0].poly;
    const hb = nested[0].bbox;
    const cx = hb.cx, cy = hb.cy;
    const fracs = [0.3, 0.5, 0.7];
    const top = fracs.map((f) => spanWidthContaining(scanX(hole, cy + f * (hb.maxY - cy)), cx)).filter((v) => v != null);
    const bot = fracs.map((f) => spanWidthContaining(scanX(hole, cy - f * (cy - hb.minY)), cx)).filter((v) => v != null);
    const right = fracs.map((f) => spanWidthContaining(scanY(hole, cx + f * (hb.maxX - cx)), cy)).filter((v) => v != null);
    const left = fracs.map((f) => spanWidthContaining(scanY(hole, cx - f * (cx - hb.minX)), cy)).filter((v) => v != null);
    return {
      type: 'socket',
      outerW: outer.bbox.w, outerH: outer.bbox.h,
      holeW: hb.w, holeH: hb.h,
      slotWidthX: Math.min(...top, ...bot), slotWidthY: Math.min(...right, ...left),
    };
  }
  return { type: 'stub', w: outer.bbox.w, h: outer.bbox.h, cx: outer.bbox.cx };
}
function measureManifoldAtMid(man) {
  const bbox = man.boundingBox();
  const zMin = bbox.min[2], zMax = bbox.max[2];
  const zMid = zMin + (zMax - zMin) * 0.5;
  const cs = man.slice(Math.min(zMax - 1e-4, Math.max(zMin + 1e-4, zMid)));
  const polys = cs.toPolygons();
  cs.delete();
  return { zMin, zMax, genus: man.genus(), ...measureSlice(polys) };
}
function geomToManifoldNoWeld(geom) {
  return api.Manifold.ofMesh(new api.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(geom.getAttribute('position').array),
    triVerts: new Uint32Array(geom.getIndex().array),
  }));
}

// ================================================================== profile sweep
const KEYCAPS_DIR = fileURLToPath(new URL('../public/keycaps', import.meta.url));
const TOL_LADDER = [-0.4, -0.2, 0, 0.2, 0.4];

const PROFILES = [
  { name: 'standard-profile/1u', file: `${KEYCAPS_DIR}/standard-profile/1u.json`, expectKind: 'socket', nStems: 1 },
  { name: 'low-profile/1u', file: `${KEYCAPS_DIR}/low-profile/1u.json`, expectKind: 'socket', nStems: 1 },
  { name: 'thocky-profile/1u', file: `${KEYCAPS_DIR}/thocky-profile/1u.json`, expectKind: 'socket', nStems: 1 },
  { name: 'choc-v1/1u', file: `${KEYCAPS_DIR}/choc-v1/1u.json`, expectKind: 'stub', nStems: 2 },
  { name: 'standard-profile/2u-3stem', file: `${KEYCAPS_DIR}/standard-profile/2u-3stem.json`, expectKind: 'socket', nStems: 3 },
];

const summaryRows = [];

for (const { name, file, expectKind, nStems } of PROFILES) {
  console.log(`\n=== ${name} ===`);
  const { baseStemGeometry } = loadBaseStemGeometry(file);

  // Baseline (tol=0): per-stem mid-height measurement + genus, sorted by centroid X so every
  // tol's decomposed pieces can be matched back to the SAME physical stem.
  const baseMan = geomToManifoldNoWeld(baseStemGeometry);
  const baseDecomp = baseMan.decompose();
  check(`${name}: baseline decomposes into ${nStems} stem(s)`, baseDecomp.length === nStems, `got ${baseDecomp.length}`);
  const baseMeasures = baseDecomp
    .map((m) => ({ cx: m.boundingBox().min[0] + (m.boundingBox().max[0] - m.boundingBox().min[0]) / 2, m: measureManifoldAtMid(m) }))
    .sort((a, b) => a.cx - b.cx);
  for (const bm of baseMeasures) check(`${name}: baseline stem kind is ${expectKind}`, bm.m.type === expectKind, bm.m.type);
  const baseZ = { min: baseMan.boundingBox().min[2], max: baseMan.boundingBox().max[2] };
  for (const m of baseDecomp) m.delete();
  baseMan.delete();

  for (const tol of TOL_LADDER) {
    const t0 = performance.now();
    const result = applyStemClearance(api, baseStemGeometry, tol);
    const ms = performance.now() - t0;

    check(`${name} tol=${tol.toFixed(2)}: watertight`, result.watertight, JSON.stringify(result.components));

    const man = geomToManifoldNoWeld(result.geometry);
    const bbox = man.boundingBox();
    check(`${name} tol=${tol.toFixed(2)}: Z extent unchanged`,
      Math.abs(bbox.min[2] - baseZ.min) < 1e-3 && Math.abs(bbox.max[2] - baseZ.max) < 1e-3,
      `Z ${bbox.min[2].toFixed(4)}..${bbox.max[2].toFixed(4)} vs base ${baseZ.min.toFixed(4)}..${baseZ.max.toFixed(4)}`);

    const decomp = man.decompose();
    check(`${name} tol=${tol.toFixed(2)}: decomposes into ${nStems} stem(s) (topology preserved)`,
      decomp.length === nStems, `got ${decomp.length}`);

    const measures = decomp
      .map((m) => ({ cx: m.boundingBox().min[0] + (m.boundingBox().max[0] - m.boundingBox().min[0]) / 2, m: measureManifoldAtMid(m) }))
      .sort((a, b) => a.cx - b.cx);

    let maxGripErr = -Infinity;
    for (let i = 0; i < measures.length; i++) {
      const base = baseMeasures[i].m, now = measures[i].m;
      check(`${name} tol=${tol.toFixed(2)} stem#${i}: genus unchanged`, now.genus === base.genus, `${now.genus} vs ${base.genus}`);

      if (tol === 0) continue; // nothing to compare a delta against
      let actualDelta, label;
      if (now.type === 'socket') {
        actualDelta = now.holeW - base.holeW;
        label = 'holeW';
        const slotDelta = now.slotWidthX - base.slotWidthX;
        check(`${name} tol=${tol.toFixed(2)} stem#${i}: slot width also moves by tol (+/-0.02mm)`,
          Math.abs(slotDelta - tol) < 0.02, `slot Δ=${slotDelta.toFixed(4)} vs tol=${tol}`);
        check(`${name} tol=${tol.toFixed(2)} stem#${i}: outer shell left alone`,
          Math.abs(now.outerW - base.outerW) < 0.005, `outerW Δ=${(now.outerW - base.outerW).toFixed(4)}`);
      } else {
        // male stub: growing clearance (tol>0) SHRINKS the peg -> actualDelta should be -tol
        actualDelta = base.w - now.w;
        label = 'outerW (mirrored)';
      }
      const err = Math.abs(actualDelta - tol);
      maxGripErr = Math.max(maxGripErr, err);
      check(`${name} tol=${tol.toFixed(2)} stem#${i}: grip dimension (${label}) moves by tol (+/-0.02mm)`,
        err < 0.02, `Δ=${actualDelta.toFixed(4)} vs tol=${tol}`);
    }

    for (const m of decomp) m.delete();
    man.delete();

    summaryRows.push({
      profile: name, tol, watertight: result.watertight, ms,
      kind: result.components[0]?.kind ?? '(unmodified)',
      bandsUsed: result.components[0]?.bandsUsed ?? 0,
      isConstant: result.components[0]?.isConstant ?? true,
      maxGripErr: tol === 0 ? 0 : maxGripErr,
    });
  }
}

// ================================================================== synthetic taper case
// Exercises the adaptive multi-band fallback: a real profile's grip contour is Z-constant
// (single-band fast path, above), but a future profile's might not be — build a male stub that
// tapers 1.0mm -> 2.0mm over its height (a linear draft, like a real switch peg's own molding
// draft) and confirm the fallback still gets the mid-height delta right and stays watertight.
{
  console.log('\n=== synthetic: tapered stub (adaptive multi-band fallback) ===');
  const TALL = 6, W0 = 1.0, W1 = 2.0;
  const taperMan = api.Manifold.extrude(
    [[[-W0 / 2, -W0 / 2], [W0 / 2, -W0 / 2], [W0 / 2, W0 / 2], [-W0 / 2, W0 / 2]]],
    TALL, 0, 0, [W1 / W0, W1 / W0],
  );
  const taperGeom = manifoldToGeom(taperMan);
  taperMan.delete();

  const base = geomToManifoldNoWeld(taperGeom);
  const baseMeasure = measureManifoldAtMid(base);
  const baseZ = base.boundingBox();
  base.delete();

  for (const tol of [-0.2, 0.2]) {
    const t0 = performance.now();
    const result = applyStemClearance(api, taperGeom, tol);
    const ms = performance.now() - t0;
    check(`taper tol=${tol}: detected as a stub`, result.components[0]?.kind === 'stub', result.components[0]?.kind);
    check(`taper tol=${tol}: used the multi-band fallback (not Z-constant)`, result.components[0]?.isConstant === false, JSON.stringify(result.components));
    check(`taper tol=${tol}: watertight`, result.watertight);
    const man = geomToManifoldNoWeld(result.geometry);
    const bbox = man.boundingBox();
    check(`taper tol=${tol}: Z extent unchanged`,
      Math.abs(bbox.min[2] - baseZ.min[2]) < 1e-3 && Math.abs(bbox.max[2] - baseZ.max[2]) < 1e-3);
    const now = measureManifoldAtMid(man);
    const actualDelta = baseMeasure.w - now.w; // stub: growing clearance shrinks the peg
    check(`taper tol=${tol}: mid-height width moves by tol (+/-0.02mm) despite the taper`,
      Math.abs(actualDelta - tol) < 0.02, `Δ=${actualDelta.toFixed(4)} vs tol=${tol}`);
    man.delete();
    console.log(`  tol=${tol}  ${ms.toFixed(2)}ms  bandsUsed=${result.components[0]?.bandsUsed}`);
  }
}

// ================================================================== summary table
console.log('\n\n########## SUMMARY ##########');
console.log('profile'.padEnd(28), 'tol'.padStart(6), 'watertight', 'kind'.padEnd(8), 'bands', 'constZ', 'maxGripErr(mm)', 'ms');
for (const r of summaryRows) {
  console.log(
    r.profile.padEnd(28), r.tol.toFixed(2).padStart(6), String(r.watertight).padEnd(10),
    r.kind.padEnd(8), String(r.bandsUsed).padStart(5), String(r.isConstant).padEnd(6),
    r.maxGripErr.toFixed(4).padStart(14), r.ms.toFixed(2).padStart(6),
  );
}

console.log(failures ? `\n${failures} FAILED` : '\nall stemClearance checks passed');
process.exit(failures ? 1 : 0);

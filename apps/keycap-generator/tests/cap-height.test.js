/**
 * Cap height and stem recess (src/capHeight.js), on the shipped caps and on the generated shapes.
 *
 * Bundle and run (as the root `test` script does):
 *   esbuild apps/keycap-generator/tests/cap-height.test.js --bundle --platform=node --format=esm \
 *     --external:manifold-3d --outfile=apps/keycap-generator/tests/.cap-height.test.mjs
 *   node apps/keycap-generator/tests/.cap-height.test.mjs
 *
 * Measured from the outside: Manifold's own status and volume, the slice of the socket, the
 * bounding boxes. Not reusing capHeight.js's code to check capHeight.js.
 */
import Module from 'manifold-3d';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { trimCap, capTrimLimits, clampCapTrim, MIN_SOCKET_MM } from '../src/capHeight.js';
import { applyStemClearance } from '../src/stemClearance.js';
import { buildShapeCap, swapToLowProfileStems, RIM_WALL_MM, WALL_MM, ROUND_TAPER_LEAN, FULL_TRAVEL_MM } from '../src/shapes/index.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (!ok) failures++;
};
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

const api = await Module();
api.setup();

const KEYCAPS = fileURLToPath(new URL('../public/keycaps/', import.meta.url));

function makeGeom(body) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(body.positions, 3));
  g.setIndex(body.indices);
  return g;
}
/** As loadKeycap gives it, with the stem welded through Manifold as setKeycap does. */
function loadCap(file) {
  const data = JSON.parse(fs.readFileSync(KEYCAPS + file, 'utf8'));
  const stemRaw = data.stem ? makeGeom(data.stem) : null;
  let stemGeometry = null;
  if (stemRaw) {
    const m = toManifold(stemRaw);
    stemGeometry = toGeom(m);
    m.delete();
  }
  return { shellGeometry: makeGeom(data), stemGeometry, meta: data.meta };
}
function toManifold(geom) {
  const p = new THREE.BufferGeometry();
  p.setAttribute('position', geom.getAttribute('position').clone());
  p.setIndex(geom.index.clone());
  const g = mergeVertices(p, 1e-3);
  return api.Manifold.ofMesh(new api.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(g.getAttribute('position').array),
    triVerts: Uint32Array.from(g.getIndex().array),
  }));
}
function toGeom(man) {
  const m = man.getMesh();
  const pos = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = m.vertProperties[i * m.numProp + k];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1));
  return g;
}
function zRange(geom) {
  geom.computeBoundingBox();
  return [geom.boundingBox.min.z, geom.boundingBox.max.z];
}
/** Status, volume and body count of a geometry, as Manifold reads it. */
function solid(geom) {
  const m = toManifold(geom);
  const out = { status: m.status(), volume: m.volume(), bodies: m.decompose().length };
  m.delete();
  return out;
}
/** Width of the socket hole of the stem nearest x = cx, sliced at height z. */
function socketWidth(stem, z, cx) {
  const m = toManifold(stem);
  const cs = m.slice(z);
  const polys = cs.toPolygons();
  cs.delete(); m.delete();
  // A hole is the smallest polygon whose bbox sits around cx.
  const boxes = polys.map((p) => {
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }).filter((b) => b.minX < cx && b.maxX > cx);
  boxes.sort((a, b) => (a.maxX - a.minX) - (b.maxX - b.minX));
  return boxes[0] ? boxes[0].maxX - boxes[0].minX : NaN;
}

// ---------------------------------------------------------------- the limits
const S1 = loadCap('standard-profile/1u.json');
const limS = capTrimLimits(S1.meta);
check('Standard 1u can be lowered by its socket less the cross', near(limS.maxLower, Math.floor((S1.meta.stemBbox.max[2] - MIN_SOCKET_MM) * 10) / 10, 1e-9), JSON.stringify(limS));
check('Standard 1u: stem recess capped at 3 mm', limS.maxRecess === 3, JSON.stringify(limS));
check('Standard 1u: past 1.1 mm the rim may touch the switch', limS.safeRecess === 1.1, JSON.stringify(limS));
check('a cap that states its own safe recess is believed', capTrimLimits({ ...S1.meta, safeRecessMM: 0.8 }).safeRecess === 0.8);
check('…and its own socket depth, over the height of its stem', capTrimLimits({ ...S1.meta, socketDepthMM: 6 }).maxLower === 2);
for (const f of ['low-profile/1u.json', 'thocky-profile/1u.json']) {
  const lim = capTrimLimits(loadCap(f).meta);
  check(`${f}: already rests on the cross: no control`, lim.maxLower === 0 && lim.maxRecess === 0, JSON.stringify(lim));
}
const chocLim = capTrimLimits(loadCap('choc-v1/1u.json').meta, { stubs: true });
check('Choc v1 (stubs): no control', chocLim.maxLower === 0 && chocLim.maxRecess === 0 && chocLim.safeRecess === 0, JSON.stringify(chocLim));
check('clamp: the two together never use more than the socket',
  JSON.stringify(clampCapTrim({ lowerMM: 5, recessMM: 3 }, { maxLower: 6, maxRecess: 3 })) === JSON.stringify({ lowerMM: 5, recessMM: 1, wallMM: null }));
check('clamp: negatives become 0', JSON.stringify(clampCapTrim({ lowerMM: -1, recessMM: -2 }, limS)) === JSON.stringify({ lowerMM: 0, recessMM: 0, wallMM: null }));

// ---------------------------------------------------------------- nothing asked, nothing made
const same = trimCap(api, S1, { lowerMM: 0, recessMM: 0 });
check('0 / 0 hands back the cap it was given', same === S1);
const lowCap = loadCap('low-profile/1u.json');
check('a cap with no range is handed back untouched', trimCap(api, lowCap, { lowerMM: 2 }) === lowCap);

// ---------------------------------------------------------------- the trims, on 1u and a 3-stem 2u
const S2 = loadCap('standard-profile/2u-3stem.json');
for (const [name, cap, stemXs] of [['Standard 1u', S1, [S1.meta.center[0]]], ['Standard 2u (3 stems)', S2, [S2.meta.center[0] - 11.95, S2.meta.center[0], S2.meta.center[0] + 11.95]]]) {
  const before = { shell: solid(cap.shellGeometry), stem: solid(cap.stemGeometry), stemZ: zRange(cap.stemGeometry), shellZ: zRange(cap.shellGeometry) };
  const holeBefore = socketWidth(cap.stemGeometry, 5, stemXs[0]);
  for (const asked of [[2, 0], [0, 1.5], [2, 1.5], [5, 1]]) {
    // [5, 1] asks for more than the socket has: the recess is clamped to what is left.
    const { lowerMM, recessMM } = clampCapTrim({ lowerMM: asked[0], recessMM: asked[1] }, capTrimLimits(cap.meta));
    const tag = `${name} lower ${asked[0]} recess ${asked[1]}`;
    if (asked[0] === 5) check(`${tag}: the recess is clamped to the socket left (${(limS.maxLower - 5).toFixed(1)} mm)`, near(recessMM, limS.maxLower - 5, 1e-9), `${recessMM}`);
    const t = trimCap(api, cap, { lowerMM: asked[0], recessMM: asked[1] });
    const shell = solid(t.shellGeometry), stem = solid(t.stemGeometry);
    check(`${tag}: shell and stem are closed solids`, shell.status === 'NoError' && stem.status === 'NoError', `${shell.status}/${stem.status}`);
    check(`${tag}: the stems are all still there`, stem.bodies === before.stem.bodies, `${stem.bodies} vs ${before.stem.bodies}`);
    const [s0, s1] = zRange(t.shellGeometry), [t0, t1] = zRange(t.stemGeometry);
    check(`${tag}: rim back on z = 0, top ${lowerMM} mm lower`, near(s0, 0) && near(s1, before.shellZ[1] - lowerMM), `shell z ${s0.toFixed(3)}..${s1.toFixed(3)}`);
    check(`${tag}: stem bottom ${recessMM} mm above the rim, top ${lowerMM} mm lower`, near(t0, recessMM) && near(t1, before.stemZ[1] - lowerMM), `stem z ${t0.toFixed(3)}..${t1.toFixed(3)}`);
    check(`${tag}: meta follows (topZ, stem box, bbox)`, near(t.meta.topZ, cap.meta.topZ - lowerMM, 1e-6) && near(t.meta.stemBbox.min[2], cap.meta.stemBbox.min[2] + recessMM, 1e-6)
      && near(t.meta.bbox.max[2], cap.meta.bbox.max[2] - lowerMM, 1e-6) && near(t.meta.dishBottomZ, cap.meta.dishBottomZ - lowerMM, 1e-6));
    if (lowerMM) check(`${tag}: the shell lost material`, shell.volume < before.shell.volume - 1, `${before.shell.volume.toFixed(1)} -> ${shell.volume.toFixed(1)}`);
    check(`${tag}: the stem lost (lower + recess) of its length`, stem.volume < before.stem.volume, `${before.stem.volume.toFixed(1)} -> ${stem.volume.toFixed(1)}`);
    for (const x of stemXs) {
      const w = socketWidth(t.stemGeometry, t0 + 1, x);
      check(`${tag}: the socket at x=${(x - cap.meta.center[0]).toFixed(2)} is the same hole 1 mm into the stem`, near(w, holeBefore, 0.02), `${w.toFixed(3)} vs ${holeBefore.toFixed(3)}`);
    }
    check(`${tag}: the cap handed in is not changed`, near(zRange(cap.stemGeometry)[0], before.stemZ[0]) && near(zRange(cap.shellGeometry)[1], before.shellZ[1]));
    // The fit stepper runs on the trimmed stem as on the loaded one.
    const fit = applyStemClearance(api, t.stemGeometry, 0.2);
    const wFit = socketWidth(fit.geometry, t0 + 1, stemXs[0]);
    check(`${tag}: stem fit +0.2 still opens the socket by 0.2`, fit.watertight && near(wFit - holeBefore, 0.2, 0.03), `${wFit.toFixed(3)} (${(wFit - holeBefore).toFixed(3)})`);
  }
}

// ---------------------------------------------------------------- asked for more than fits
const big = trimCap(api, S1, { lowerMM: 50, recessMM: 50 });
check('a request past the limits is clamped to them', near(big.meta.trim.lowerMM, limS.maxLower, 1e-9) && near(big.meta.trim.recessMM, 0, 1e-9), JSON.stringify(big.meta.trim));
const [b0, b1] = zRange(big.stemGeometry);
const told = trimCap(api, S1, { lowerMM: 1, recessMM: 0.5 });
check('a trimmed cap that stated its socket depth states it less the trim',
  trimCap(api, { ...S1, meta: { ...S1.meta, socketDepthMM: 9 } }, { lowerMM: 1, recessMM: 0.5 }).meta.socketDepthMM === 7.5 && !('socketDepthMM' in told.meta));
check('…and leaves a socket of at least the minimum depth', b1 - b0 >= MIN_SOCKET_MM - 0.01, `${(b1 - b0).toFixed(3)} mm`);

// ---------------------------------------------------------------- on a generated shape
//
// A shape is built again to the trim rather than cut: its rim keeps its width and a round one's
// thin bottom edge, which a cut from below would take off, and it says how far it now travels.

/** Outside width and wall across (along y) of a shell sliced at height z. */
function rimAt(geom, z) {
  const m = toManifold(geom);
  const cs = m.slice(z);
  const hs = cs.toPolygons().map((p) => { const ys = p.map((q) => q[1]); return Math.max(...ys) - Math.min(...ys); }).sort((a, b) => b - a);
  cs.delete(); m.delete();
  return { width: hs[0], wall: (hs[0] - hs[1]) / 2 };
}
const f3 = (v) => v.toFixed(3);
const shape = (s, sizeId = '1u') => buildShapeCap(api, { shape: s, sizeId });
const R1 = shape('round'), T1 = shape('round-tapered'), Q1 = shape('square');

for (const [name, cap, safe] of [['round 1u', R1, 0], ['round tapered 1u', T1, 0], ['square 1u', Q1, 1.6]]) {
  const lim = capTrimLimits(cap.meta);
  check(`${name}: lowered up to 5.5 (a 4 mm socket left over the cross), stem recessed up to 3, ${safe} of it before the key stops short`,
    lim.maxLower === 5.5 && lim.maxRecess === 3 && near(lim.safeRecess, safe, 1e-9), JSON.stringify(lim));
}

{
  const before = { pos: Float32Array.from(R1.shellGeometry.getAttribute('position').array), meta: JSON.stringify(R1.meta) };
  check('a shape at 0 / 0 is handed back as it is', trimCap(api, R1, { lowerMM: 0, recessMM: 0 }) === R1);

  const low = trimCap(api, R1, { lowerMM: 2 });
  const [s0, s1] = zRange(low.shellGeometry), [t0, t1] = zRange(low.stemGeometry);
  const rim = rimAt(low.shellGeometry, 0.002);
  const cut = rimAt(R1.shellGeometry, 2.002); // what a cut from below would leave as the rim
  check('round 1u lowered 2: rim on z = 0, top 2 lower, stem flush and 2 shorter', near(s0, 0) && near(s1, R1.meta.topZ - 2) && near(t0, 0) && near(t1, R1.meta.stemBbox.max[2] - 2),
    `shell ${f3(s0)}..${f3(s1)}, stem ${f3(t0)}..${f3(t1)}`);
  check(`…its rim still ${RIM_WALL_MM} thin at the bottom edge (a cut would leave ${f3(cut.wall)}), so it presses as far as before`,
    near(rim.wall, RIM_WALL_MM, 0.005) && near(cut.wall, WALL_MM, 0.01) && near(low.meta.travelMM, R1.meta.travelMM, 1e-9), `${f3(rim.wall)}, travel ${f3(low.meta.travelMM)}`);
  check('…meta: the trim, a socket 2 shallower, and what to rebuild it from', JSON.stringify(low.meta.trim) === '{"lowerMM":2,"recessMM":0,"wallMM":null}' && near(low.meta.socketDepthMM, R1.meta.socketDepthMM - 2, 1e-9)
    && low.meta.shapeCap.lowerMM === 2 && low.meta.shapeCap.recessMM === 0, JSON.stringify(low.meta.shapeCap));

  const rec = trimCap(api, R1, { recessMM: 0.5 });
  const [r0] = zRange(rec.stemGeometry), [rs0, rs1] = zRange(rec.shellGeometry);
  check('round 1u stem recessed 0.5: stem bottom 0.5 above the rim, the rest where it was', near(r0, 0.5) && near(rs0, 0) && near(rs1, R1.meta.topZ), `stem ${f3(r0)}, shell ${f3(rs0)}..${f3(rs1)}`);
  check('…the rim is 0.5 nearer the switch, so the key presses 0.5 less, and the socket is 0.5 shallower',
    near(rec.meta.travelMM, R1.meta.travelMM - 0.5, 0.01) && near(rec.meta.socketDepthMM, R1.meta.socketDepthMM - 0.5, 1e-9), `${f3(R1.meta.travelMM)} -> ${f3(rec.meta.travelMM)}`);

  const both = trimCap(api, trimCap(api, R1, { lowerMM: 1 }), { lowerMM: 1, recessMM: 0.5 });
  const once = trimCap(api, R1, { lowerMM: 2, recessMM: 0.5 });
  check('trimming a trimmed shape adds to its trim', both.meta.shapeCap.lowerMM === 2 && both.meta.shapeCap.recessMM === 0.5
    && near(both.meta.topZ, once.meta.topZ, 1e-9) && near(both.meta.stemBbox.min[2], 0.5, 1e-6) && near(both.meta.travelMM, once.meta.travelMM, 1e-9), JSON.stringify(both.meta.shapeCap));

  const most = trimCap(api, R1, { lowerMM: 50, recessMM: 50 });
  const [m0, m1] = zRange(most.stemGeometry);
  check('a shape asked for more than fits is clamped to its socket: 5.5 lower, no recess left, the socket 4 deep',
    most.meta.trim.lowerMM === 5.5 && most.meta.trim.recessMM === 0 && near(most.meta.socketDepthMM, MIN_SOCKET_MM, 1e-9) && near(m0, 0),
    `${JSON.stringify(most.meta.trim)}, stem ${f3(m0)}..${f3(m1)}`);
  check('the shape handed in is not changed', R1.shellGeometry.getAttribute('position').array.every((v, i) => v === before.pos[i]) && JSON.stringify(R1.meta) === before.meta);

  const solidOk = [low, rec, both, most].every((c) => {
    const a = solid(c.shellGeometry), b = solid(c.stemGeometry);
    return a.status === 'NoError' && a.bodies === 1 && b.status === 'NoError' && b.bodies === 1 && c.meta.stemBbox.min[2] >= c.meta.bbox.min[2] - 1e-6;
  });
  check('every trimmed shape is a closed shell and a closed stem, the stem never below the rim', solidOk);
  const fit = applyStemClearance(api, rec.stemGeometry, 0.2);
  const w0 = socketWidth(rec.stemGeometry, 3, 0), w1 = socketWidth(fit.geometry, 3, 0);
  check('the fit stepper opens a trimmed shape\'s socket by 0.2', fit.watertight && near(w1 - w0, 0.2, 0.03), `${f3(w0)} -> ${f3(w1)}`);
}

{
  // A tapered shape keeps its rim when lowered: the lean runs over less height, so its top grows.
  const low = trimCap(api, T1, { lowerMM: 3 });
  const rim0 = rimAt(T1.shellGeometry, 0.01), rim1 = rimAt(low.shellGeometry, 0.01);
  const grown = low.meta.topExtent[0] - T1.meta.topExtent[0];
  check('round tapered 1u lowered 3: the rim keeps its width and its thin edge, the top grows by the lean over 3 mm a side, the travel is kept',
    near(rim1.width, rim0.width, 0.01) && near(rim1.wall, rim0.wall, 0.005) && near(grown, 2 * ROUND_TAPER_LEAN * 3, 0.01) && near(low.meta.travelMM, T1.meta.travelMM, 1e-9),
    `rim ${f3(rim0.width)} -> ${f3(rim1.width)}, top +${f3(grown)}, travel ${f3(low.meta.travelMM)}`);

  // A square cap has travel to spare: 1.6 mm of recess before the key stops short of 4.
  const q1 = trimCap(api, Q1, { recessMM: 1 }), q2 = trimCap(api, Q1, { recessMM: 2 });
  check('square 1u: a 1 mm recess still goes all the way down, 2 mm stops the key short',
    near(q1.meta.travelMM, Q1.meta.travelMM - 1, 1e-9) && q1.meta.travelMM >= FULL_TRAVEL_MM && q2.meta.travelMM < FULL_TRAVEL_MM && near(rimAt(q1.shellGeometry, 0.002).wall, WALL_MM, 0.005),
    `${f3(q1.meta.travelMM)} / ${f3(q2.meta.travelMM)}`);

  // Low-profile stems cut a shape down for good: it is no longer a shape to rebuild, and has no range.
  const lp = swapToLowProfileStems(api, R1);
  check('a shape on low-profile stems has no cap height control, and is left as it is', capTrimLimits(lp.meta).maxLower === 0 && trimCap(api, lp, { lowerMM: 2 }) === lp);
}

// ---------------------------------------------------------------- Wall height: the walls alone
{
  const lim = capTrimLimits(S1.meta);
  const [stemLo, stemHi] = zRange(S1.stemGeometry);
  check('Standard 1u: the shortest wall is the top plate above the ceiling (the stem top)',
    near(lim.minWall, Math.ceil((S1.meta.topZ - stemHi) * 10) / 10, 1e-9) && lim.minWall > 1 && lim.minWall < 3, String(lim.minWall));
  check('clamp: a wall that reaches the cap is no cut, and none is shorter than the top plate',
    clampCapTrim({ wallMM: S1.meta.topZ }, lim, S1.meta.topZ).wallMM === null
    && clampCapTrim({ wallMM: 0.2 }, lim, S1.meta.topZ).wallMM === lim.minWall
    && clampCapTrim({ wallMM: 4 }, lim, S1.meta.topZ).wallMM === 4);
  const w = trimCap(api, S1, { wallMM: 4 });
  const [shLo, shHi] = zRange(w.shellGeometry);
  const [st2Lo, st2Hi] = zRange(w.stemGeometry);
  check('Standard 1u, walls 4 mm: the shell ends 4 mm under the top, the top stays where it was',
    near(shLo, S1.meta.topZ - 4, 0.02) && near(shHi, zRange(S1.shellGeometry)[1], 1e-6), `${f3(shLo)}..${f3(shHi)}`);
  check('…the stem is untouched, so the cap still sits where it did', near(st2Lo, stemLo, 1e-6) && near(st2Hi, stemHi, 1e-6));
  check('…meta: the rim is lifted to the cut, the trim says so', near(w.meta.bbox.min[2], S1.meta.topZ - 4, 1e-9) && w.meta.trim.wallMM === 4 && w.meta.topZ === S1.meta.topZ);
  const shell = solid(w.shellGeometry);
  check('…the shell is one watertight body', shell.status === 'NoError' && shell.bodies === 1, JSON.stringify(shell));
  const both = trimCap(api, S1, { lowerMM: 2, wallMM: 4 });
  check('lowered 2 and walls 4: the walls are 4 under the lowered top',
    near(zRange(both.shellGeometry)[0], both.meta.topZ - 4, 0.02) && near(both.meta.topZ, S1.meta.topZ - 2, 1e-9));
  check('walls back to full: the cap as loaded', trimCap(api, S1, { wallMM: S1.meta.topZ }) === S1);

  const rw = trimCap(api, R1, { wallMM: 3 });
  const [rLo] = zRange(rw.shellGeometry);
  check('round 1u, walls 3 mm: rebuilt with its walls ending 3 under the top, stem from z = 0',
    near(rLo, R1.meta.topZ - 3, 0.02) && near(zRange(rw.stemGeometry)[0], 0, 1e-6) && rw.meta.shapeCap.wallMM === 3, f3(rLo));
  check('…so far above the switch it presses all the way', rw.meta.travelMM >= FULL_TRAVEL_MM, f3(rw.meta.travelMM));
  check('…and the shortest wall on a shape is its top plate', near(capTrimLimits(R1.meta).minWall, 1.5, 1e-9), String(capTrimLimits(R1.meta).minWall));
}

if (failures) { console.error(`${failures} cap height check(s) failed`); process.exit(1); }
console.log('all cap height checks passed');

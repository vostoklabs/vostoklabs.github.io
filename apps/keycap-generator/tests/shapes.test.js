/**
 * The keycap shape engine (src/shapes/): every shape in every size, at the default width and at
 * others, lowered and with its stem recessed (Cap height, src/capHeight.js); the switch clearance
 * model; and the low-profile stem swap.
 *
 * Bundle and run (as the root `test` script does):
 *   esbuild apps/keycap-generator/tests/shapes.test.js --bundle --platform=node --format=esm \
 *     --external:manifold-3d --outfile=apps/keycap-generator/tests/.shapes.test.mjs
 *   node apps/keycap-generator/tests/.shapes.test.mjs
 *
 * Measured from the outside: Manifold's own status, genus, slices and booleans on the geometry
 * handed back, and the owner's shipped caps for the socket and the stem positions. Nothing here
 * reuses src/shapes' code to check it; its constants are imported only as the numbers the caps
 * were asked to have. The flat top's size is worked out here a different way (the round-over as
 * a corner fillet, set back R / tan(half the corner angle)), and the clearance model is checked
 * against a solid switch housing built here, by sliding the cap down onto it until they touch.
 */
import Module from 'manifold-3d';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import {
  SHAPES, shapeSizes, buildShapeCap, swapToLowProfileStems, sizeRangeMM, travelBeforeContact,
  KEY_PITCH_MM, DEFAULT_SIZE_MM, SIZE_RANGE_MM, ROUND_TAPER_LEAN, SQUARE_CORNER_R_MM, TOP_ROUND_OVER_MM, WALL_MM,
  RIM_WALL_MM, RIM_FLARE_MM, TOP_THICKNESS_MM, CAP_HEIGHT_MM, FULL_TRAVEL_MM, ACTUATION_MM,
} from '../src/shapes/index.js';
import {
  HOUSING_FLANGE_MM, HOUSING_FLANGE_R_MM, HOUSING_FLANGE_TOP_MM, HOUSING_BODY_MM, HOUSING_TAPER_FROM_MM,
  HOUSING_TOP_MM, HOUSING_TOP_Z_MM, HOUSING_BODY_R_MM, SLIDER_REST_MM, SIDE_MARGIN_MM,
} from '../src/shapes/clearance.js';
import { MX_STEM_DIAMETER_MM, STEM_FUSE_MM, LP_STEM_SPAN_MM, LP_ARM_WIDTH_MM } from '../src/shapes/stems.js';
import { LP_SOCKET_DEPTH_MM } from '../src/shapes/lowProfile.js';
import { applyStemClearance } from '../src/stemClearance.js';
import { capTrimLimits, trimCap } from '../src/capHeight.js';

let failures = 0;
let checks = 0;
const check = (name, ok, detail = '') => {
  checks++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (!ok) failures++;
};
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const f3 = (v) => v.toFixed(3);

const api = await Module();
api.setup();

const KEYCAPS = fileURLToPath(new URL('../public/keycaps/', import.meta.url));

// ---------------------------------------------------------------- reading geometry, as the app does

function makeGeom(body) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(body.positions, 3));
  g.setIndex(body.indices);
  return g;
}
/** Welded by position, as setKeycap / the carve read a cap. */
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
/** An owner's cap as loadKeycap gives it, with the stem welded through Manifold as setKeycap does. */
function loadCap(file) {
  const data = JSON.parse(fs.readFileSync(KEYCAPS + file, 'utf8'));
  const m = toManifold(makeGeom(data.stem));
  const stemGeometry = toGeom(m);
  m.delete();
  return { shellGeometry: makeGeom(data), stemGeometry, meta: data.meta };
}

// ---------------------------------------------------------------- measuring

function polyBox(poly) {
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
function slicePolys(man, z) {
  const cs = man.slice(z);
  const polys = cs.toPolygons();
  cs.delete();
  return polys;
}
/** The biggest ring of a slice (the outside) and the rest (holes, other islands). */
function sliceParts(man, z) {
  const polys = slicePolys(man, z).map((p) => ({ p, area: Math.abs(polyArea(p)), box: polyBox(p) }));
  polys.sort((a, b) => b.area - a.area);
  return { outer: polys[0], rest: polys.slice(1), count: polys.length };
}
/** The wall across (horizontally) at height z, along y: outside width less the hole's, halved. */
function wallAcrossAt(shell, z) {
  const s = sliceParts(shell, z);
  const hole = s.rest[0]?.box;
  return hole ? (s.outer.box.h - hole.h) / 2 : NaN;
}
/** The socket around (cx, cy) at height z: the smallest ring of the slice whose box holds the point. */
function socketAt(man, z, cx, cy) {
  const boxes = slicePolys(man, z).map(polyBox).filter((b) => b.minX < cx && b.maxX > cx && b.minY < cy && b.maxY > cy);
  boxes.sort((a, b) => a.w - b.w);
  return boxes[0] ?? null;
}
/** Each body of a solid with its box, sorted along x. The caller frees `piece`. */
function bodies(man) {
  return man.decompose().map((piece) => {
    const b = piece.boundingBox();
    return { piece, b, cx: (b.min[0] + b.max[0]) / 2, cy: (b.min[1] + b.max[1]) / 2 };
  }).sort((a, b) => a.cx - b.cx);
}
/** How many separate bodies a solid is. */
function bodyCount(man) {
  const pieces = man.decompose();
  for (const p of pieces) p.delete();
  return pieces.length;
}
/** The inner ceiling: the lowest height at which a slice of the shell has no hole, by bisection. */
function ceilingOf(shell, lo, hi) {
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (slicePolys(shell, mid).length > 1) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
/** Volume of the stems inside the shell, below `z` and in all. */
function overlap(stem, shell, z) {
  const both = stem.intersect(shell);
  const below = both.trimByPlane([0, 0, -1], -z);
  const out = { below: below.volume(), all: both.volume() };
  both.delete(); below.delete();
  return out;
}

// ---------------------------------------------------------------- a switch housing, as a solid

/** A rounded square ring at height z, as 3D points. */
function squareRing(half, rc, z) {
  const pts = [];
  for (const [sx, sy, a0] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]]) {
    for (let i = 0; i <= 32; i++) {
      const t = ((a0 + (90 * i) / 32) * Math.PI) / 180;
      pts.push([sx * (half - rc) + rc * Math.cos(t), sy * (half - rc) + rc * Math.sin(t), z]);
    }
  }
  return pts;
}
/** The housing, grown sideways by the margin (a rounded square grown by m is half + m, corner + m),
 *  from the plate's top face (z = 0) up: flange, straight body, taper, and a solid top. */
const housing = (() => {
  const m = SIDE_MARGIN_MM;
  const part = (rings) => api.Manifold.hull(rings.flat());
  const flange = part([squareRing(HOUSING_FLANGE_MM / 2 + m, HOUSING_FLANGE_R_MM + m, 0), squareRing(HOUSING_FLANGE_MM / 2 + m, HOUSING_FLANGE_R_MM + m, HOUSING_FLANGE_TOP_MM)]);
  const body = part([squareRing(HOUSING_BODY_MM / 2 + m, HOUSING_BODY_R_MM + m, HOUSING_FLANGE_TOP_MM - 0.01), squareRing(HOUSING_BODY_MM / 2 + m, HOUSING_BODY_R_MM + m, HOUSING_TAPER_FROM_MM),
    squareRing(HOUSING_TOP_MM / 2 + m, HOUSING_BODY_R_MM + m, HOUSING_TOP_Z_MM)]);
  const all = flange.add(body);
  flange.delete(); body.delete();
  return all;
})();
/**
 * How far a cap travels before its shell touches the housing, found by sliding it: the stem's
 * bottom starts on the slider (SLIDER_REST_MM above the plate) and goes down until the shell and
 * the housing share volume, or the rim reaches the plate. The stems are left out: they go into
 * the switch.
 */
function slideTravel(cap) {
  const shell = toManifold(cap.shellGeometry);
  const stemZ = cap.meta.stemBbox.min[2], rimZ = cap.meta.bbox.min[2];
  const touches = (h) => { // h: the stem's bottom above the plate
    const moved = shell.translate([0, 0, h - stemZ]);
    const both = moved.intersect(housing);
    const v = both.volume();
    moved.delete(); both.delete();
    return v > 1e-6;
  };
  let lo = stemZ - rimZ, hi = SLIDER_REST_MM; // rim on the plate .. at rest
  if (!touches(lo)) { shell.delete(); return SLIDER_REST_MM - lo; }
  for (let i = 0; i < 30; i++) {
    const h = (lo + hi) / 2;
    if (touches(h)) lo = h; else hi = h;
  }
  shell.delete();
  return SLIDER_REST_MM - hi;
}

// ---------------------------------------------------------------- the owner's caps, for reference

const index = JSON.parse(fs.readFileSync(KEYCAPS + 'index.json', 'utf8'));
const standard = index.profiles.find((p) => p.id === 'standard-profile');

/** The owner's socket: sliced mid-height out of the shipped Standard 1u stem. */
const ownerSocket = (() => {
  const cap = loadCap('standard-profile/1u.json');
  const m = toManifold(cap.stemGeometry);
  const s = socketAt(m, 5, cap.meta.center[0], cap.meta.center[1]);
  m.delete();
  return s;
})();
check('owner Standard 1u socket measures 4.039 x 4.039', near(ownerSocket.w, 4.039, 0.005) && near(ownerSocket.h, 4.039, 0.005), `${f3(ownerSocket.w)} x ${f3(ownerSocket.h)}`);

/** The owner's stem positions per size: x of every stem, from the middle one. */
const ownerStems = {};
for (const k of standard.keycaps) {
  const cap = loadCap(`standard-profile/${k.id}.json`);
  const m = toManifold(cap.stemGeometry);
  const list = bodies(m);
  const mid = list[Math.floor(list.length / 2)].cx;
  ownerStems[k.id] = list.map((s) => s.cx - mid);
  for (const s of list) s.piece.delete();
  m.delete();
}

// ---------------------------------------------------------------- the registry

check('three shapes: round, round tapered, square', JSON.stringify(SHAPES.map((s) => s.id)) === '["round","round-tapered","square"]');
for (const { id } of SHAPES) {
  const got = shapeSizes(id).map(({ id: i, label, unit }) => ({ id: i, label, unit }));
  const want = standard.keycaps.map(({ id: i, label, unit }) => ({ id: i, label, unit }));
  check(`${id}: sizes are index.json's Standard sizes, in order`, JSON.stringify(got) === JSON.stringify(want));
}
check('every shape defaults to Ø18.136, an MX cap\'s width', SHAPES.every(({ id }) => DEFAULT_SIZE_MM[id] === 18.136), JSON.stringify(DEFAULT_SIZE_MM));
let threw = false;
try { shapeSizes('hexagon'); } catch { threw = true; }
check('an unknown shape is refused', threw);
threw = false;
try { buildShapeCap(api, { shape: 'round', sizeId: '7u' }); } catch { threw = true; }
check('an unknown size is refused', threw);

// ---------------------------------------------------------------- one cap, measured

const META_KEYS = ['generatedFrom', 'triangles', 'vertices', 'bbox', 'center', 'topZ', 'dishBottomZ', 'topExtent', 'hasStem', 'stemBbox',
  'socketDepthMM', 'sizeMM', 'travelMM', 'safeRecessMM', 'shapeCap'];
let maxTris = { n: 0 };
let maxMs = 0;

/**
 * Every measurement of one generated cap against what it was asked to be: `W` its width at the
 * rim, `lower` how far Cap height took its top down, `recess` how far its stem's bottom sits
 * above the rim. Returns the shell's flat top.
 */
function checkCap(tag, cap, { shape, sizeId, W, lower = 0, recess = 0 }) {
  const shapeLabel = SHAPES.find((s) => s.id === shape).label;
  const unit = shapeSizes(shape).find((s) => s.id === sizeId);
  const tapered = shape === 'round-tapered';
  const round = shape !== 'square';
  // What was asked for, from the constants: the gap to the next key is the pitch less the width.
  const L = unit.unit * KEY_PITCH_MM - (KEY_PITCH_MM - W);
  const cr = round ? W / 2 : SQUARE_CORNER_R_MM;
  const topZ = CAP_HEIGHT_MM - lower;
  const ceilZ = topZ - TOP_THICKNESS_MM;
  const lean = Math.atan(tapered ? ROUND_TAPER_LEAN : 0); // wall from vertical
  const wallAcross = WALL_MM / Math.cos(lean);
  // The flat top: the sharp top outline (in by the lean over the whole height), less the
  // round-over's setback at a corner of angle 90° + lean, R / tan(half of it).
  const setback = TOP_ROUND_OVER_MM / Math.tan((Math.PI / 2 + lean) / 2);
  const sharpInset = Math.tan(lean) * topZ;
  const flat = [L - 2 * (sharpInset + setback), W - 2 * (sharpInset + setback)];

  const shell = toManifold(cap.shellGeometry);
  const stem = toManifold(cap.stemGeometry);
  const sb = shell.boundingBox(), tb = stem.boundingBox();

  check(`${tag}: shell is one closed solid, a cup (genus 0)`, shell.status() === 'NoError' && bodyCount(shell) === 1 && shell.genus() === 0, `${shell.status()} genus ${shell.genus()}`);
  const stems = bodies(stem);
  const want = ownerStems[sizeId];
  check(`${tag}: stems closed, ${want.length} of them, as the owner's cap`, stem.status() === 'NoError' && stems.length === want.length, `${stem.status()} ${stems.length}`);

  // Heights: the walls come down to z = 0, the stem never below them.
  check(`${tag}: rim on z = 0, top at ${f3(topZ)}`, near(sb.min[2], 0) && near(sb.max[2], topZ), `shell z ${f3(sb.min[2])}..${f3(sb.max[2])}`);
  check(`${tag}: stem bottom ${recess ? `${recess} above the rim` : 'flush with the rim'}, never below it; fused ${STEM_FUSE_MM} into the top plate`,
    near(tb.min[2], recess) && tb.min[2] >= sb.min[2] - 1e-6 && near(tb.max[2], ceilZ + STEM_FUSE_MM), `stem z ${f3(tb.min[2])}..${f3(tb.max[2])}, rim ${f3(sb.min[2])}`);
  check(`${tag}: outline centred on the origin`, near(sb.min[0], -sb.max[0], 1e-4) && near(sb.min[1], -sb.max[1], 1e-4));

  // The rim's outline: size, and its area says the corners (a stadium's are its ends).
  const base = sliceParts(shell, 0.01);
  const baseArea = L * W - (4 - Math.PI) * cr * cr;
  check(`${tag}: rim ${f3(L)} x ${f3(W)} (gap to the next key ${f3(KEY_PITCH_MM - W)})`, near(base.outer.box.w, L, 0.05) && near(base.outer.box.h, W, 0.05), `${f3(base.outer.box.w)} x ${f3(base.outer.box.h)}`);
  check(`${tag}: rim corners r ${f3(cr)} (area within 0.3%)`, Math.abs(base.outer.area / baseArea - 1) < 0.003, `${base.outer.area.toFixed(2)} vs ${baseArea.toFixed(2)}`);

  // The wall: thinned at a round cap's rim and back to full over the flare; full everywhere on a square.
  const atRim = wallAcrossAt(shell, 0.002);
  const midFlare = wallAcrossAt(shell, RIM_FLARE_MM / 2);
  if (round) {
    check(`${tag}: wall ${RIM_WALL_MM} across at the rim's bottom edge`, near(atRim, RIM_WALL_MM, 0.005), f3(atRim));
    // Half way up the flare the inside is half way between, while the outside has leant in by the
    // lean that far: across, half the rim's wall and half the full wall's.
    check(`${tag}: half way up the flare, half way to the full wall`, near(midFlare, (RIM_WALL_MM + wallAcross) / 2, 0.01), `${f3(midFlare)} vs ${f3((RIM_WALL_MM + wallAcross) / 2)}`);
  } else {
    check(`${tag}: wall ${WALL_MM} right down to the rim (no flare)`, near(atRim, WALL_MM, 0.005) && near(midFlare, WALL_MM, 0.005), `${f3(atRim)}, ${f3(midFlare)}`);
  }
  // Above the flare: straight or on the taper line, WALL_MM thick square to itself.
  const zm = (RIM_FLARE_MM + ceilZ) / 2;
  const mid = sliceParts(shell, zm);
  const outerW = W - 2 * Math.tan(lean) * zm;
  const wall = wallAcrossAt(shell, zm) * Math.cos(lean);
  check(`${tag}: wall above the flare ${tapered ? 'on the taper' : 'straight'}, width ${f3(outerW)}`, near(mid.outer.box.h, outerW, 0.05), f3(mid.outer.box.h));
  check(`${tag}: wall above the flare ${WALL_MM} thick`, near(wall, WALL_MM, 0.03), f3(wall));
  const ceil = ceilingOf(shell, 0.1, topZ - 0.01);
  check(`${tag}: inner ceiling ${TOP_THICKNESS_MM} below the top`, near(ceil, ceilZ, 0.01), f3(ceil));

  const pos = cap.shellGeometry.getAttribute('position');
  const top = [];
  for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > topZ - 1e-4) top.push([pos.getX(i), pos.getY(i)]);
  const flatBox = polyBox(top);
  check(`${tag}: flat top ${f3(flat[0])} x ${f3(flat[1])}`, near(flatBox.w, flat[0], 0.05) && near(flatBox.h, flat[1], 0.05), `${f3(flatBox.w)} x ${f3(flatBox.h)}`);

  // Stems: where the owner puts them, the owner's socket, a through-hole.
  check(`${tag}: stems where the owner's are`, stems.every((s, i) => near(s.cx, want[i], 0.01) && near(s.cy, 0, 0.01)),
    stems.map((s) => f3(s.cx)).join(', '));
  const midSocket = (recess + ceilZ) / 2;
  let socketsOk = true, socketDetail = '';
  for (const s of stems) {
    if (s.piece.genus() !== 1) { socketsOk = false; socketDetail += `genus ${s.piece.genus()} `; }
    if (!near(s.b.max[0] - s.b.min[0], MX_STEM_DIAMETER_MM, 0.01)) { socketsOk = false; socketDetail += `od ${f3(s.b.max[0] - s.b.min[0])} `; }
    for (const z of [recess + 0.5, midSocket, ceilZ - 0.5]) {
      const k = socketAt(s.piece, z, s.cx, s.cy);
      if (!k || !near(k.w, ownerSocket.w, 0.005) || !near(k.h, ownerSocket.h, 0.005) || !near(k.cx, s.cx, 0.01)) {
        socketsOk = false; socketDetail += `z ${z}: ${k ? `${f3(k.w)} x ${f3(k.h)}` : 'none'} `;
      }
    }
  }
  check(`${tag}: every stem Ø${MX_STEM_DIAMETER_MM} with the owner's socket at 3 heights, a through-hole`, socketsOk, socketDetail);

  // The fit stepper opens it by exactly what it is asked.
  const fit = applyStemClearance(api, cap.stemGeometry, 0.2);
  const fitM = toManifold(fit.geometry);
  const fitStems = bodies(fitM);
  const widened = fitStems.map((s) => socketAt(s.piece, midSocket, s.cx, s.cy)?.w - ownerSocket.w);
  check(`${tag}: stem fit +0.2 widens every socket by 0.2 and stays watertight`,
    fit.watertight && fitM.status() === 'NoError' && fitStems.length === stems.length && widened.every((d) => near(d, 0.2, 0.03)),
    widened.map(f3).join(', '));
  for (const s of fitStems) s.piece.delete();
  fitM.delete();

  // Inside the cap: no stem in a wall, every stem fused into the top plate.
  const ov = overlap(stem, shell, ceilZ - 0.01);
  const section = stems.reduce((a, s) => {
    const p = sliceParts(s.piece, midSocket);
    return a + p.outer.area - p.rest.reduce((h, r) => h + r.area, 0);
  }, 0);
  check(`${tag}: no stem inside a wall below the ceiling`, ov.below < 1e-3, `${ov.below.toFixed(5)} mm³`);
  check(`${tag}: stems fused ${STEM_FUSE_MM} into the top plate`, near(ov.all, section * STEM_FUSE_MM, 0.02 * ov.all), `${ov.all.toFixed(2)} vs ${(section * STEM_FUSE_MM).toFixed(2)} mm³`);

  // What the app reads.
  const m = cap.meta;
  const tris = cap.shellGeometry.getIndex().count / 3 + cap.stemGeometry.getIndex().count / 3;
  check(`${tag}: meta has every field a loaded cap has, and the shape's own; no side height`, META_KEYS.every((k) => k in m) && !('skirtMM' in m) && m.hasStem === true && m.center[0] === 0 && m.center[1] === 0,
    META_KEYS.filter((k) => !(k in m)).join(', '));
  check(`${tag}: meta boxes are the shell's and the stems' own`, [0, 1, 2].every((a) => near(m.bbox.min[a], sb.min[a], 1e-4) && near(m.bbox.max[a], sb.max[a], 1e-4)
    && near(m.stemBbox.min[a], tb.min[a], 1e-4) && near(m.stemBbox.max[a], tb.max[a], 1e-4)));
  check(`${tag}: meta top flat at ${f3(topZ)}, top extent the flat top`, near(m.topZ, topZ, 1e-4) && m.dishBottomZ === m.topZ
    && near(m.topExtent[0], flatBox.w, 0.05) && near(m.topExtent[1], flatBox.h, 0.05), `${m.topExtent.map(f3).join(' x ')}`);
  check(`${tag}: meta triangles, label, the width built`, m.triangles === tris && m.generatedFrom === `${shapeLabel} · ${unit.label}` && near(m.sizeMM, W, 1e-9),
    `${m.triangles} "${m.generatedFrom}" ${m.sizeMM}`);
  check(`${tag}: meta says what to rebuild it from`, JSON.stringify(m.shapeCap) === JSON.stringify({ shape, sizeId, sizeMM: W, lowerMM: lower, recessMM: recess }), JSON.stringify(m.shapeCap));
  check(`${tag}: meta socket depth: stem bottom to ceiling`, near(m.socketDepthMM, ceilZ - recess, 1e-4), f3(m.socketDepthMM));
  check(`${tag}: meta safe recess is the travel past full travel`, near(m.safeRecessMM, Math.max(0, m.travelMM - FULL_TRAVEL_MM), 1e-9), `travel ${f3(m.travelMM)}, recess ${f3(m.safeRecessMM)}`);
  if (!lower && !recess) {
    const lim = capTrimLimits(m);
    check(`${tag}: cap height can take 5.5 off (a 4 mm socket left), the stem 3`, lim.maxLower === 5.5 && lim.maxRecess === 3, JSON.stringify(lim));
  }
  if (tris > maxTris.n) maxTris = { n: tris, tag };
  check(`${tag}: ${tris} triangles, under 20k`, tris < 20000);

  for (const s of stems) s.piece.delete();
  shell.delete(); stem.delete();
  return { flatBox };
}

// ---------------------------------------------------------------- every shape, every size, defaults

/** How far each shape's default 1u presses: the circles short of the switch's full 4 mm but well
 *  past where it registers, the square all the way (it stops on the flange). */
const FLUSH_TRAVEL_1U = { round: 2.695, 'round-tapered': 2.695, square: SLIDER_REST_MM - HOUSING_FLANGE_TOP_MM };

for (const { id: shape } of SHAPES) {
  for (const size of shapeSizes(shape)) {
    const tag = `${shape} ${size.id}`;
    const t0 = performance.now();
    const cap = buildShapeCap(api, { shape, sizeId: size.id });
    maxMs = Math.max(maxMs, performance.now() - t0);
    checkCap(tag, cap, { shape, sizeId: size.id, W: DEFAULT_SIZE_MM[shape] });
    const t = cap.meta.travelMM;
    if (size.id === '1u') {
      check(`${tag}: presses ${FLUSH_TRAVEL_1U[shape]} mm${shape === 'square' ? ', all the way' : `, ${f3(FLUSH_TRAVEL_1U[shape] - ACTUATION_MM)} past where it registers`}`,
        near(t, FLUSH_TRAVEL_1U[shape], 0.01) && (shape === 'square' ? t >= FULL_TRAVEL_MM : t >= 2.6), f3(t));
    } else {
      check(`${tag}: goes all the way down`, t >= FULL_TRAVEL_MM, f3(t));
    }
  }
}
console.log(`most triangles: ${maxTris.n} (${maxTris.tag}); slowest build ${maxMs.toFixed(0)} ms`);

// ---------------------------------------------------------------- widths asked for

// A wider cap: the outline follows, and the gap to the next key closes.
checkCap('round 1u at Ø18.6', buildShapeCap(api, { shape: 'round', sizeId: '1u', sizeMM: 18.6 }), { shape: 'round', sizeId: '1u', W: 18.6 });
checkCap('round 2u (3 stems) at 18.6', buildShapeCap(api, { shape: 'round', sizeId: '2u-3stem', sizeMM: 18.6 }), { shape: 'round', sizeId: '2u-3stem', W: 18.6 });
checkCap('square 1.5u at 16.5', buildShapeCap(api, { shape: 'square', sizeId: '1_5u', sizeMM: 16.5 }), { shape: 'square', sizeId: '1_5u', W: 16.5 });
checkCap('round tapered 1u at Ø15', buildShapeCap(api, { shape: 'round-tapered', sizeId: '1u', sizeMM: 15 }), { shape: 'round-tapered', sizeId: '1u', W: 15 });

// Clamps: width to SIZE_RANGE_MM, nonsense to the default; a side height (no longer a setting) is ignored.
for (const [ask, W] of [[{ sizeMM: 10 }, SIZE_RANGE_MM.min], [{ sizeMM: 30 }, SIZE_RANGE_MM.max], [{ sizeMM: NaN }, DEFAULT_SIZE_MM.square], [{ skirtMM: 4 }, DEFAULT_SIZE_MM.square]]) {
  const cap = buildShapeCap(api, { shape: 'square', sizeId: '1u', ...ask });
  const shell = toManifold(cap.shellGeometry);
  const b = shell.boundingBox();
  shell.delete();
  check(`square 1u asked ${JSON.stringify(ask)}: built ${W} wide, flush`, near(b.max[1] - b.min[1], W, 0.01) && near(b.min[2], 0, 1e-6) && near(cap.meta.stemBbox.min[2], 0, 1e-6)
    && cap.meta.sizeMM === W, `${f3(b.max[1] - b.min[1])} wide, rim ${f3(b.min[2])}`);
}

// A tapered pill with stabilisers: the inside narrows onto the outer stems at the ceiling, so a
// narrow one would put them through the side. Its range starts where they fit.
{
  // The outer stem's far side, kept 0.1 mm clear of the wall.
  const stemEnd = 12 + MX_STEM_DIAMETER_MM / 2 + 0.1;
  const endAt = (W) => (W + KEY_PITCH_MM) / 2 - ROUND_TAPER_LEAN * (CAP_HEIGHT_MM - TOP_THICKNESS_MM) - WALL_MM * Math.hypot(1, ROUND_TAPER_LEAN);
  const range = sizeRangeMM('round-tapered', '2u-3stem');
  check('round tapered 2u (3 stems): narrower than 17.4 the outer stems would come within 0.1 of the side, so the range starts there',
    range.min === 17.4 && range.max === SIZE_RANGE_MM.max && endAt(17.3) < stemEnd && endAt(17.4) >= stemEnd,
    `range ${range.min}..${range.max}; cavity end at 17.3 ${f3(endAt(17.3))}, at 17.4 ${f3(endAt(17.4))} vs stem ${f3(stemEnd)}`);
  const cap = buildShapeCap(api, { shape: 'round-tapered', sizeId: '2u-3stem', sizeMM: 15 });
  checkCap('round tapered 2u (3 stems) asked Ø15: built at 17.4', cap, { shape: 'round-tapered', sizeId: '2u-3stem', W: 17.4 });
  check('…a 6u spacebar starts at 15.2; every other tapered size, and every straight one, takes the whole range',
    sizeRangeMM('round-tapered', '6u-spacebar').min === 15.2
    && SHAPES.every(({ id }) => shapeSizes(id).every((z) => (id === 'round-tapered' && ['2u-3stem', '6u-spacebar'].includes(z.id))
      || JSON.stringify(sizeRangeMM(id, z.id)) === JSON.stringify(SIZE_RANGE_MM))));
}

// ---------------------------------------------------------------- lowered and recessed (Cap height)

// The app trims a shape as it trims a loaded cap (capHeight.js), which builds it again: the rim
// keeps its width and its flare, the top comes down, the stem starts above the rim.
for (const [shape, sizeId, lowerMM, recessMM] of [
  ['round', '1u', 3, 1], ['round-tapered', '1_5u', 2, 0], ['square', '2_25u', 0, 1.5], ['round', '2u-3stem', 5.5, 0], ['round-tapered', '1u', 3, 0],
]) {
  const cap = trimCap(api, buildShapeCap(api, { shape, sizeId }), { lowerMM, recessMM });
  checkCap(`${shape} ${sizeId} lowered ${lowerMM}, stem recessed ${recessMM}`, cap, { shape, sizeId, W: DEFAULT_SIZE_MM[shape], lower: lowerMM, recess: recessMM });
}

// ---------------------------------------------------------------- the switch clearance model

{
  /** The inside at the rim, from the constants, with a wall `t` across there. */
  const innerOf = (shape, sizeId, W, t) => {
    const unit = shapeSizes(shape).find((s) => s.id === sizeId).unit;
    const L = W + (unit - 1) * KEY_PITCH_MM;
    const r = shape === 'square' ? SQUARE_CORNER_R_MM : W / 2;
    return { a: L / 2 - t, b: W / 2 - t, r: Math.max(0, r - t) };
  };
  // A square cap flush with its stem: 15.34 inside passes the body and stops on the flange.
  const sq = travelBeforeContact(innerOf('square', '1u', 18.136, WALL_MM), 0);
  check('square 18.136 flush: inside 15.34 clears the body, stops on the flange, past full travel', near(sq, SLIDER_REST_MM - HOUSING_FLANGE_TOP_MM, 1e-6) && sq >= FULL_TRAVEL_MM, f3(sq));
  // A round one does not: the housing's corners come up inside it and stop it early.
  const plain = travelBeforeContact(innerOf('round', '1u', 18.136, WALL_MM), 0);
  const thin = travelBeforeContact(innerOf('round', '1u', 18.136, RIM_WALL_MM), 0);
  check(`round 18.136 flush with a plain ${WALL_MM} wall would never register; ${RIM_WALL_MM} at the rim presses 2.7`,
    near(plain, 1.458, 0.01) && plain < ACTUATION_MM && near(thin, 2.695, 0.01), `${f3(plain)} / ${f3(thin)}`);
  check('a bigger round cap travels further', travelBeforeContact(innerOf('round', '1u', 16, RIM_WALL_MM), 0) < thin && thin < travelBeforeContact(innerOf('round', '1u', 18.8, RIM_WALL_MM), 0));
  check('a 1.25u pill travels further than the 1u circle', travelBeforeContact(innerOf('round', '1_25u', 18.136, RIM_WALL_MM), 0) > thin);
  const wide = travelBeforeContact({ a: 20, b: 20, r: 1 }, 2);
  check('an inside wider than the flange: down to the plate', near(wide, SLIDER_REST_MM + 2, 1e-9), f3(wide));
  // A recess puts the rim below the stem's bottom: travel lost mm for mm.
  const t0 = travelBeforeContact(innerOf('round', '1u', 18.136, RIM_WALL_MM), 0), t1 = travelBeforeContact(innerOf('round', '1u', 18.136, RIM_WALL_MM), -1);
  check('travel gives up what the rim drops, mm for mm', near(t0 - t1, 1, 1e-9), f3(t0 - t1));

  // The model against a solid housing: slide each cap down until its shell touches. Some meet it
  // with the rim's bottom edge, some higher up the flare (a small tapered pill), some with the
  // ceiling on the housing's top (a square cut right down).
  const slid = [
    ['round', '1u', {}], ['round', '1u', { sizeMM: 18.8 }], ['round', '1u', { sizeMM: 15 }], ['round', '1u', { sizeMM: 16.5 }],
    ['round', '1_25u', {}], ['round', '2_25u', {}], ['round-tapered', '1u', {}], ['round-tapered', '1_5u', { sizeMM: 17 }],
    ['round-tapered', '2u-3stem', {}], ['square', '1u', {}], ['square', '1u', { sizeMM: 16 }],
    ['round', '1u', {}, { recessMM: 1 }], ['round-tapered', '1u', {}, { lowerMM: 3 }], ['square', '1u', {}, { recessMM: 2 }], ['square', '1u', {}, { lowerMM: 5.5 }],
  ];
  for (const [shape, sizeId, ask, trim] of slid) {
    let cap = buildShapeCap(api, { shape, sizeId, ...ask });
    if (trim) cap = trimCap(api, cap, trim);
    const s = slideTravel(cap);
    check(`${shape} ${sizeId} Ø${cap.meta.sizeMM}${trim ? ` ${JSON.stringify(trim)}` : ''}: travel ${f3(cap.meta.travelMM)} as a solid cap slid onto a solid housing`,
      near(s, cap.meta.travelMM, 0.05), `slid ${f3(s)}`);
  }
  const pill = buildShapeCap(api, { shape: 'round-tapered', sizeId: '1_5u', sizeMM: 17 });
  const edgeOnly = travelBeforeContact(innerOf('round-tapered', '1_5u', 17, RIM_WALL_MM), 0);
  check('round tapered 1.5u at 17: the inside meets the housing above the rim\'s edge, and the travel says so', pill.meta.travelMM < edgeOnly - 0.1,
    `${f3(pill.meta.travelMM)} vs ${f3(edgeOnly)} at the edge alone`);
  const deep = trimCap(api, buildShapeCap(api, { shape: 'square', sizeId: '1u' }), { lowerMM: 5.5 });
  check('square 1u cut 5.5 lower: its ceiling meets the housing\'s top before the rim meets the flange',
    near(deep.meta.travelMM, SLIDER_REST_MM + deep.meta.socketDepthMM - HOUSING_TOP_Z_MM, 1e-6) && deep.meta.travelMM < SLIDER_REST_MM - HOUSING_FLANGE_TOP_MM, f3(deep.meta.travelMM));
}

// ---------------------------------------------------------------- low-profile stems on the Low profile caps

for (const file of ['low-profile/1u.json', 'low-profile/2u-3stem.json']) {
  const cap = loadCap(file);
  const before = { shell: toManifold(cap.shellGeometry), stem: toManifold(cap.stemGeometry) };
  const sb0 = before.shell.boundingBox();
  const rim = sb0.min[2];
  const ceil0 = ceilingOf(before.shell, rim + 0.1, sb0.max[2] - 0.01);
  const oldStems = bodies(before.stem);
  const drop = ceil0 - rim - LP_SOCKET_DEPTH_MM;
  const shellBefore = Float32Array.from(cap.shellGeometry.getAttribute('position').array);
  const stemBefore = Float32Array.from(cap.stemGeometry.getAttribute('position').array);
  const metaBefore = JSON.stringify(cap.meta);

  const out = swapToLowProfileStems(api, cap);
  const shell = toManifold(out.shellGeometry);
  const stem = toManifold(out.stemGeometry);
  const sb = shell.boundingBox(), tb = stem.boundingBox();
  const stems = bodies(stem);
  const ceil = ceilingOf(shell, rim + 0.1, sb.max[2] - 0.01);
  const tag = `mx-lp on ${file}`;

  check(`${tag}: shell and stems closed, ${oldStems.length} stem(s) as before`, shell.status() === 'NoError' && bodyCount(shell) === 1 && stem.status() === 'NoError' && stems.length === oldStems.length,
    `${shell.status()}/${stem.status()} ${stems.length}`);
  check(`${tag}: rim kept, inner ceiling ${LP_SOCKET_DEPTH_MM} above it`, near(sb.min[2], rim) && near(ceil - rim, LP_SOCKET_DEPTH_MM, 0.01), `rim ${f3(sb.min[2])}, ceiling ${f3(ceil)} (was ${f3(ceil0)})`);
  // Cut from below, not squashed: the new rim is the old cap's outline at the cut.
  const cutBefore = sliceParts(before.shell, rim + drop + 0.01).outer.box;
  const rimAfter = sliceParts(shell, rim + 0.01).outer.box;
  check(`${tag}: the cap is cut ${f3(drop)} from below: top that much lower, rim the old outline at the cut`,
    near(sb.max[2], sb0.max[2] - drop, 0.01) && near(rimAfter.w, cutBefore.w, 0.01) && near(rimAfter.h, cutBefore.h, 0.01),
    `top ${f3(sb.max[2])} (was ${f3(sb0.max[2])}), rim ${f3(rimAfter.w)} x ${f3(rimAfter.h)} vs ${f3(cutBefore.w)} x ${f3(cutBefore.h)}`);
  check(`${tag}: every stem centre kept`, stems.every((s, i) => near(s.cx, oldStems[i].cx, 0.01) && near(s.cy, oldStems[i].cy, 0.01)),
    stems.map((s, i) => `${f3(s.cx - oldStems[i].cx)},${f3(s.cy - oldStems[i].cy)}`).join(' '));
  check(`${tag}: stems flush with the rim, fused ${STEM_FUSE_MM} into the top plate`, near(tb.min[2], rim) && near(tb.max[2], ceil + STEM_FUSE_MM), `stem z ${f3(tb.min[2])}..${f3(tb.max[2])}`);

  let plusOk = true, plusDetail = '';
  for (const s of stems) {
    const p = sliceParts(s.piece, rim + LP_SOCKET_DEPTH_MM / 2).outer.p;
    const radii = p.map(([x, y]) => Math.hypot(x - s.cx, y - s.cy));
    const rMax = Math.max(...radii), rMin = Math.min(...radii);
    // Across an arm, between the end of the socket's bar and where the circle starts to trim the
    // arm's corners: the arm's own width.
    const X = s.cx + (ownerSocket.w / 2 + Math.sqrt((LP_STEM_SPAN_MM / 2) ** 2 - (LP_ARM_WIDTH_MM / 2) ** 2)) / 2;
    const ys = [];
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
      if ((x1 <= X && x2 > X) || (x2 <= X && x1 > X)) ys.push(y1 + ((X - x1) / (x2 - x1)) * (y2 - y1));
    }
    ys.sort((a, b) => a - b);
    const armW = ys.length === 2 ? ys[1] - ys[0] : NaN;
    // A plus: the arm ends reach the circle, the corners between the arms come in to half the
    // arm width times root 2.
    const inner = (LP_ARM_WIDTH_MM / 2) * Math.SQRT2;
    if (!(rMax <= LP_STEM_SPAN_MM / 2 + 0.002 && rMax > LP_STEM_SPAN_MM / 2 - 0.01 && near(rMin, inner, 0.02) && near(armW, LP_ARM_WIDTH_MM, 0.02))) {
      plusOk = false;
    }
    plusDetail += `r ${f3(rMin)}..${f3(rMax)} arm ${f3(armW)}; `;
    if (s.piece.genus() !== 1) { plusOk = false; plusDetail += `genus ${s.piece.genus()} `; }
    for (const z of [rim + 0.3, rim + LP_SOCKET_DEPTH_MM / 2, rim + LP_SOCKET_DEPTH_MM - 0.3]) {
      const k = socketAt(s.piece, z, s.cx, s.cy);
      if (!k || !near(k.w, ownerSocket.w, 0.005) || !near(k.h, ownerSocket.h, 0.005)) { plusOk = false; plusDetail += `socket z ${f3(z)}: ${k ? f3(k.w) : 'none'} `; }
    }
  }
  check(`${tag}: each stem a plus inside Ø${LP_STEM_SPAN_MM}, arms ${LP_ARM_WIDTH_MM} wide, the owner's socket through it`, plusOk, plusDetail);

  const fit = applyStemClearance(api, out.stemGeometry, 0.2);
  const fitM = toManifold(fit.geometry);
  const fitStems = bodies(fitM);
  const widened = fitStems.map((s) => socketAt(s.piece, rim + LP_SOCKET_DEPTH_MM / 2, s.cx, s.cy)?.w - ownerSocket.w);
  check(`${tag}: stem fit +0.2 widens every socket by 0.2 and stays watertight`,
    fit.watertight && fitStems.length === stems.length && widened.every((d) => near(d, 0.2, 0.03)), widened.map(f3).join(', '));
  for (const s of fitStems) s.piece.delete();
  fitM.delete();

  const ov = overlap(stem, shell, ceil - 0.01);
  const section = stems.reduce((a, s) => {
    const p = sliceParts(s.piece, rim + LP_SOCKET_DEPTH_MM / 2);
    return a + p.outer.area - p.rest.reduce((h, r) => h + r.area, 0);
  }, 0);
  check(`${tag}: no stem inside a wall below the ceiling, all fused ${STEM_FUSE_MM} into the top plate`, ov.below < 1e-3 && near(ov.all, section * STEM_FUSE_MM, 0.02 * ov.all),
    `${ov.below.toFixed(5)} below; ${ov.all.toFixed(2)} vs ${(section * STEM_FUSE_MM).toFixed(2)} mm³ fused`);

  const m = out.meta, m0 = cap.meta;
  check(`${tag}: meta follows (boxes, top, centre and top extent kept)`, [0, 1, 2].every((a) => near(m.bbox.min[a], sb.min[a], 1e-4) && near(m.bbox.max[a], sb.max[a], 1e-4)
    && near(m.stemBbox.min[a], tb.min[a], 1e-4) && near(m.stemBbox.max[a], tb.max[a], 1e-4))
    && near(m.topZ, sb.max[2], 1e-3) && near(m.dishBottomZ, m0.dishBottomZ - drop, 0.01) && m.center === m0.center && m.topExtent === m0.topExtent
    && m.triangles === out.shellGeometry.getIndex().count / 3 + out.stemGeometry.getIndex().count / 3);
  check(`${tag}: meta: no recess called safe, no travel claimed`, m.safeRecessMM === 0 && !('travelMM' in m));
  check(`${tag}: the cap handed in is not changed`, cap.shellGeometry.getAttribute('position').array.every((v, i) => v === shellBefore[i])
    && cap.stemGeometry.getAttribute('position').array.every((v, i) => v === stemBefore[i]) && JSON.stringify(cap.meta) === metaBefore);

  for (const s of [...stems, ...oldStems]) s.piece.delete();
  shell.delete(); stem.delete(); before.shell.delete(); before.stem.delete();
}

// A generated cap through the same swap: its own width and travel do not survive the cut, and it
// is no longer a shape for Cap height to rebuild.
{
  const out = swapToLowProfileStems(api, buildShapeCap(api, { shape: 'round', sizeId: '1u' }));
  const shell = toManifold(out.shellGeometry), stem = toManifold(out.stemGeometry);
  check('mx-lp on a generated round 1u: closed, stems not below the rim, and no width, travel or shape to rebuild claimed', shell.status() === 'NoError' && stem.status() === 'NoError'
    && out.meta.stemBbox.min[2] >= out.meta.bbox.min[2] - 1e-6
    && out.meta.safeRecessMM === 0 && !['travelMM', 'skirtMM', 'sizeMM', 'shapeCap'].some((k) => k in out.meta), `${shell.status()}/${stem.status()}`);
  shell.delete(); stem.delete();
}

housing.delete();
if (failures) { console.error(`${failures} of ${checks} keycap shape check(s) failed`); process.exit(1); }
console.log(`all ${checks} keycap shape checks passed`);

/*
  The letter-block body, now generated (src/geometry/keyBody.ts) instead of six CAD shells, so
  that blocks can be laid out in any shape (a grid, a WASD cluster), with or without a wall
  between the keys, and with a texture on the outside.

  What has to hold, and why each one is here:
   - every layout × style × texture is ONE closed solid (a slicer will not print anything else);
   - the default body is the CAD block it replaced, measured: same wall, well, floor, pocket and
     height, so a block set made before this prints the same;
   - the switch pocket is still 13.93 mm, the CAD shells' opening — a print that fitted still fits;
   - a WASD cluster keeps its empty corners empty, and a ring of keys gets a solid middle, not a
     hole through the body;
   - 'open' really has no wall between keys, and 'walls' really has one;
   - a texture only ever ADDS material: the wall is never thinner than the plain one.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/blocks-body.test.ts \
      --bundle --platform=node --format=esm --external:manifold-3d \
      --outfile=apps/clicker-generator/.blocks-body-test.mjs \
      && node apps/clicker-generator/.blocks-body-test.mjs
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Module from 'manifold-3d';
import { parse3MF } from '../src/geometry/threemfImport.ts';
import { buildBlocks, BLOCK_POCKET_MM } from '../src/geometry/buildBlocks.ts';
import { BODY_DIMS, buildKeyBody, keyPitch, wellSize, type KeyCell } from '../src/geometry/keyBody.ts';
import type { BlockStyle, BlockTexture, BuildParams, BuildRegion, ClickerPart } from '../src/types.ts';

const A = (p: string) =>
  readFileSync(join(process.cwd(), 'apps/clicker-generator/public/assets', p)).buffer as ArrayBuffer;

const wasm: any = await Module();
wasm.setup();

function normalisedSocket(buf: ArrayBuffer) {
  const raw = parse3MF(buf);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.vertProperties, triVerts: raw.triVerts });
  mesh.merge();
  const s = wasm.Manifold.ofMesh(mesh);
  const bb = s.boundingBox();
  const out = s.translate([-(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, -bb.max[2]]);
  s.delete();
  return out;
}
const socket = normalisedSocket(A('switch/mx/mx-socket.3mf'));
const keycapJson = JSON.parse(
  readFileSync(join(process.cwd(), 'apps/clicker-generator/public/assets/keycap.json'), 'utf-8'),
);
const keycapAsset = { shell: { positions: keycapJson.positions, indices: keycapJson.indices }, stem: keycapJson.stem ?? null, meta: keycapJson.meta };

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

/** Every edge shared by exactly two triangles. */
const closed = (p: { triVerts: Uint32Array }): boolean => {
  const edges = new Map<string, number>();
  const t = p.triVerts;
  for (let i = 0; i < t.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = t[i + e], b = t[i + ((e + 1) % 3)];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  return [...edges.values()].every((c) => c === 2);
};
const solidOfPart = (p: ClickerPart) => {
  const mesh = new wasm.Mesh({ numProp: p.numProp, vertProperties: p.vertProperties, triVerts: p.triVerts });
  mesh.merge();
  return wasm.Manifold.ofMesh(mesh);
};
/** Is there material at (x, y, z)? A 0.2 mm cube, intersected. */
const solidAt = (s: any, x: number, y: number, z: number): boolean => {
  const probe = wasm.Manifold.cube([0.2, 0.2, 0.2], true).translate([x, y, z]);
  const hit = s.intersect(probe);
  const v = hit.volume();
  probe.delete(); hit.delete();
  return v > 0.004;
};
const bboxOfRings = (rings: number[][][]) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const r of rings) for (const [x, y] of r) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return { w: c - a, h: d - b };
};

// ---------------------------------------------------------------------------------------------
// The default body is the CAD block it replaced.
// ---------------------------------------------------------------------------------------------
{
  const one = buildKeyBody(wasm, [{ row: 0, col: 0 }], { style: 'walls', texture: 'smooth', dims: { cap: 18.135 } });
  const s = one.solid;
  const bb = s.boundingBox();
  const W = bb.max[0] - bb.min[0];
  const H = bb.max[2] - bb.min[2];
  // The CAD block: 23.93 × 23.59 × 17.64, Z −9.73..7.91, well 20.52 × 20.09, floor +0.27.
  check('one key is the CAD block\'s size', Math.abs(W - 23.76) < 0.25 && Math.abs(H - 17.64) < 0.01,
    `${W.toFixed(2)} × ${(bb.max[1] - bb.min[1]).toFixed(2)} × ${H.toFixed(2)} mm, CAD 23.93 × 23.59 × 17.64`);
  check('same underside and rim height', Math.abs(bb.min[2] - BODY_DIMS.bottomZ) < 1e-3 && Math.abs(bb.max[2] - BODY_DIMS.rimZ) < 1e-3,
    `Z ${bb.min[2].toFixed(3)} .. ${bb.max[2].toFixed(3)}`);
  const well = bboxOfRings(s.slice(4).toPolygons().filter((r: number[][]) => bboxOfRings([r]).w < 22));
  check('the keycap well is the CAD well, made square', Math.abs(well.w - wellSize(BODY_DIMS)) < 0.05 && Math.abs(well.w - well.h) < 0.01,
    `${well.w.toFixed(2)} × ${well.h.toFixed(2)} mm, CAD 20.52 × 20.09`);
  const wall = (W - well.w) / 2;
  check('the wall is 1.75 mm, as on the CAD block', Math.abs(wall - 1.75) < 0.1, `${wall.toFixed(2)} mm`);
  one.solid.delete();
}

// ---------------------------------------------------------------------------------------------
// The switch pocket and the well floor through buildBlocks, the way the app builds it.
// ---------------------------------------------------------------------------------------------
const square = (s: number): [number, number][] => [[-s, -s], [s, -s], [s, s], [-s, s]];
const region = (k: number): BuildRegion => ({ filamentRgb: [20, 20, 20], coverage: 1, rings: [square(0.3)], partName: `top-color-${k}-0` });
const hole = (k: number): BuildRegion => ({ filamentRgb: [20, 20, 20], coverage: 1, rings: [], partName: `top-color-${k}-0` });
const base = {
  baseShape: 'square', capWidthMm: 35, topThickness: 1.5, imageDepth: 0.8, imageMargin: 2.5,
  borderWidth: 3.5, capProud: 1.2, tolerance: 0.4, stemFitMm: 0, socketFitPct: 0,
  imageOffset: { x: 0, y: 0 }, colorBleed: 0.05, stepHeight: 0.4, travel: 3.8,
  floorThickness: 1.2, switches: [{ x: 0, y: 0, rotation: 0 }],
  keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
  baseFilamentRgb: [240, 240, 240], bodyColorRgb: [40, 40, 40],
  componentHeights: {}, edgeSettings: [], extrudeChamfer: false,
  blockOrientation: 'horizontal', legendScale: 1, legendBold: 0, keychainEnd: 'left',
} as unknown as BuildParams;
const run = (regions: BuildRegion[], p: Partial<BuildParams>) =>
  buildBlocks(wasm, socket, keycapAsset as never, regions, { ...base, ...p });
const bodyOf = (parts: ClickerPart[]) => parts.filter((p) => p.name.startsWith('block-'));

{
  const out = run([region(0)], {});
  const body = solidOfPart(bodyOf(out.parts)[0]);
  const ring = body.slice(-0.7).toPolygons().map((r: number[][]) => bboxOfRings([r])).sort((a: any, b: any) => a.w - b.w)[0];
  check('the switch opening is still the CAD shells\' 13.93 mm', Math.abs(ring.w - BLOCK_POCKET_MM) < 0.02 && Math.abs(ring.h - BLOCK_POCKET_MM) < 0.02,
    `${ring.w.toFixed(3)} × ${ring.h.toFixed(3)} mm`);
  const opening = body.slice(0.15).toPolygons().map((r: number[][]) => bboxOfRings([r])).sort((a: any, b: any) => a.w - b.w)[0];
  check('and it runs up through the plate to the well floor', Math.abs(opening.w - BLOCK_POCKET_MM) < 0.02,
    `${opening.w.toFixed(3)} mm at Z 0.15`);
  check('the well floor is where the shells had it, so the switch and cap sit the same',
    solidAt(body, 8.5, 8.5, BODY_DIMS.floorZ - 0.15) && !solidAt(body, 8.5, 8.5, BODY_DIMS.floorZ + 0.15)
      && out.switchPlacements[0].z === BODY_DIMS.floorZ,
    `floor top at ${BODY_DIMS.floorZ} mm, switch seated at ${out.switchPlacements[0].z}`);
  body.delete();
}

// ---------------------------------------------------------------------------------------------
// Every layout × style × texture.
// ---------------------------------------------------------------------------------------------
type Lay = { name: string; regions: BuildRegion[]; params: Partial<BuildParams>; keys: number };
const R = (n: number) => Array.from({ length: n }, (_, k) => region(k));
const layouts: Lay[] = [
  { name: 'row of 5', regions: R(5), params: { blockOrientation: 'horizontal' }, keys: 5 },
  { name: 'column of 3', regions: R(3), params: { blockOrientation: 'vertical' }, keys: 3 },
  { name: '3x3', regions: R(9), params: { blockOrientation: 'grid', blockColumns: 3 }, keys: 9 },
  { name: 'WASD', regions: [hole(0), region(1), hole(2), region(3), region(4), region(5)], params: { blockOrientation: 'grid', blockColumns: 3 }, keys: 4 },
  { name: 'ring of 8', regions: [region(0), region(1), region(2), region(3), hole(4), region(5), region(6), region(7), region(8)], params: { blockOrientation: 'grid', blockColumns: 3 }, keys: 8 },
];
const styles: BlockStyle[] = ['walls', 'open'];
const textures: BlockTexture[] = ['smooth', 'knurl', 'ribs', 'flutes', 'dots', 'chevron'];

let slowest = 0;
for (const lay of layouts) {
  for (const style of styles) {
    for (const texture of textures) {
      const t0 = performance.now();
      const out = run(lay.regions, { ...lay.params, blockStyle: style, blockTexture: texture });
      const ms = performance.now() - t0;
      slowest = Math.max(slowest, ms);
      const bodies = bodyOf(out.parts);
      const ok = bodies.length === 1 && closed(bodies[0]) && out.switchPlacements.length === lay.keys
        && out.parts.filter((p) => p.name.startsWith('cap-')).length === lay.keys;
      check(`${lay.name}, ${style}, ${texture}: one closed body, a switch and a cap per key`, ok,
        `${bodies.length} body, ${out.switchPlacements.length} switches, ${(bodies[0]?.triVerts.length ?? 0) / 3} tris, ${ms.toFixed(0)} ms`);
    }
  }
}
check('even a textured 3x3 builds quickly', slowest < 3000, `slowest ${slowest.toFixed(0)} ms (whole buildBlocks, caps and legends included)`);

// ---------------------------------------------------------------------------------------------
// Shapes: WASD's corners, the ring's middle, walls and no walls.
// ---------------------------------------------------------------------------------------------
{
  const wasdRegions = layouts[3].regions;
  for (const style of styles) {
    const out = run(wasdRegions, { blockOrientation: 'grid', blockColumns: 3, blockStyle: style });
    const body = solidOfPart(bodyOf(out.parts)[0]);
    const p = keyPitch(style);
    // Key centres: W at (0, +p/2); A S D at (−p, −p/2), (0, −p/2), (+p, −p/2). The empty
    // corners are (±p, +p/2).
    const emptyCorner = !solidAt(body, p, p / 2, 0) && !solidAt(body, -p, p / 2, 0);
    check(`WASD (${style}): the two empty corners stay empty`, emptyCorner, `pitch ${p.toFixed(2)} mm`);
    body.delete();
  }
  const ringOut = run(layouts[4].regions, { blockOrientation: 'grid', blockColumns: 3, blockStyle: 'open' });
  const ringBody = solidOfPart(bodyOf(ringOut.parts)[0]);
  check('a ring of keys has a solid middle, not a hole through', solidAt(ringBody, 0, 0, -3) && solidAt(ringBody, 0, 0, BODY_DIMS.rimZ - 0.3),
    'material at the centre, under the rim');
  ringBody.delete();

  // Between two keys of a row, half way up the well: a wall with 'walls', air with 'open'.
  for (const style of styles) {
    const out = run(R(2), { blockStyle: style });
    const body = solidOfPart(bodyOf(out.parts)[0]);
    const between = solidAt(body, 0, 0, 4);
    check(style === 'walls' ? "'walls' has a wall between two keys" : "'open' has no wall between two keys",
      style === 'walls' ? between : !between, `material between the keys: ${between}`);
    body.delete();
  }
}

// ---------------------------------------------------------------------------------------------
// A texture only adds material.
// ---------------------------------------------------------------------------------------------
{
  const plain = buildKeyBody(wasm, [{ row: 0, col: 0 }, { row: 0, col: 1 }], { style: 'walls', texture: 'smooth', dims: { cap: 18.135 } });
  for (const texture of ['knurl', 'ribs', 'flutes', 'dots', 'chevron'] as BlockTexture[]) {
    const tex = buildKeyBody(wasm, [{ row: 0, col: 0 }, { row: 0, col: 1 }], { style: 'walls', texture, dims: { cap: 18.135 } });
    const inside = plain.solid.subtract(tex.solid);
    const grew = tex.solid.volume() - plain.solid.volume();
    const bb = tex.solid.boundingBox();
    const pb = plain.solid.boundingBox();
    const out = (bb.max[0] - bb.min[0] - (pb.max[0] - pb.min[0])) / 2;
    check(`${texture}: covers the plain body completely and only adds to it`, inside.volume() < 0.5 && grew > 0,
      `plain − textured = ${inside.volume().toFixed(2)} mm³, +${grew.toFixed(0)} mm³, ${out.toFixed(2)} mm proud per side`);
    inside.delete();
    tex.solid.delete();
  }
  plain.solid.delete();
}

// ---------------------------------------------------------------------------------------------
// The keyring loop still hangs off the side it is asked for.
// ---------------------------------------------------------------------------------------------
{
  const kc = { enabled: true, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 };
  const off = run(R(3), {});
  const offBB = solidOfPart(bodyOf(off.parts)[0]).boundingBox();
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const out = run(R(3), { keychain: kc as never, keychainEnd: side });
    const bb = solidOfPart(bodyOf(out.parts)[0]).boundingBox();
    const grew = side === 'left' ? offBB.min[0] - bb.min[0]
      : side === 'right' ? bb.max[0] - offBB.max[0]
      : side === 'top' ? bb.max[1] - offBB.max[1]
      : offBB.min[1] - bb.min[1];
    check(`keyring on the ${side}: the body reaches out that way`, grew > 5 && closed(bodyOf(out.parts)[0]), `+${grew.toFixed(1)} mm`);
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nthe generated block body holds');
process.exit(failures ? 1 : 0);

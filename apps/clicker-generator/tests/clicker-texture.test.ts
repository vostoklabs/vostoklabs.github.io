/*
  The outside texture on the flat clicker's body.

  The letter blocks have had a textured wall since their body was generated (keyBody.ts); the flat
  clicker builds its body from the same skin (geometry/skin.ts) when `blockTexture` is set. What
  has to hold, and why each one is here:

   - every texture on a circle, a heart and a traced outline is ONE closed solid: a slicer will
     not print anything else, and a traced outline (a bat's wings, the crook where the switch's
     column meets the cap) is exactly where a pushed-out wall folds over itself;
   - the textured body contains the smooth one: the wall is never thinner, only the bevels
     differ (the skin's is an exact offset, the smooth block's an approximation);
   - the cap, the well and so the slip fit are the smooth clicker's, part for part;
   - with a fixed size the crests, not the wall under them, measure the size that was locked;
   - every identity mark still lands (invariant #2), with the base hollowed too, and both tiers:
     the suite is bundled with a test seed (suites.mjs `seed`), so the seeded constellation —
     the one nearer the outside wall — is placed as a release build places its own;
   - the keyring loop still welds on: one solid, reaching out where the loop is;
   - an outline too tight for any closing keeps its smooth wall, says so, and that wall is the
     smooth clicker's exactly;
   - a textured rebuild, and one that falls back, leave nothing behind in manifold's heap.

  Timings and the closing each texture needed are printed, not asserted beyond a generous bound.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs clicker-texture
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { captureHeaps, heapInUse } from '../../../packages/laser/tests/heap-probe.mjs';

// Before manifold loads: the meter finds its heap as the module is made.
const heaps = captureHeaps();
const { default: Module } = await import('manifold-3d');
const { csOf } = await import('@vostok/manifold');
const { processImage } = await import('@vostok/trace');
const { readModel } = await import('@vostok/export/read');
const { buildClicker } = await import('../src/geometry/buildClicker.ts');
const { getMarkSeed, hardcodedVoids, markVoids } = await import('../src/geometry/identityMark.ts');
const { roundCorners } = await import('../src/geometry/shapePaths.ts');
const { skinShell, texturedWall } = await import('../src/geometry/skin.ts');
type BuildParams = import('../src/types.ts').BuildParams;
type BuildRegion = import('../src/types.ts').BuildRegion;
type BlockTexture = import('../src/types.ts').BlockTexture;
type ClickerPart = import('../src/types.ts').ClickerPart;
type Ring = import('../src/types.ts').Ring;
type RgbaImage = import('@vostok/trace').RgbaImage;

const wasm: any = await Module();
wasm.setup();
const heap = heaps[heaps.length - 1];

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

/* ------------------------------------------------------------------ the worker's assets */

const appDir = join(process.cwd(), 'apps/clicker-generator');
const asset = (p: string) => readFileSync(join(appDir, 'public/assets', p)).buffer as ArrayBuffer;
function prep(buf: ArrayBuffer, dropTopToZero: boolean) {
  const raw = readModel(buf, 'asset.3mf');
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.positions, triVerts: raw.indices });
  mesh.merge();
  const solid = wasm.Manifold.ofMesh(mesh);
  const bb = solid.boundingBox();
  const out = solid.translate([
    -(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, dropTopToZero ? -bb.max[2] : 0,
  ]);
  solid.delete();
  return out;
}
const socket = prep(asset('switch/mx/mx-socket.3mf'), true);
const stem = prep(asset('switch/mx/mx-stem.3mf'), false);

/* ------------------------------------------------------------------ designs */

/** The app's own defaults, from mount.ts's store and buildParamsFor, for a picture. */
const DEFAULTS: BuildParams = {
  baseShape: 'outline', capWidthMm: 35, topThickness: 1.5, imageDepth: 0.8,
  imageMargin: 1.2, borderWidth: 2.6, capProud: 4.0, hollowBase: false,
  designScale: 1, shapeSides: 6, shapeCornerPct: 0.22, shapeArmPct: 0.34,
  tolerance: 0.4, stemFitMm: 0, socketFitPct: 0,
  imageOffset: { x: 0, y: 0 }, colorBleed: 0.12, stepHeight: 0.6, travel: 4.0,
  floorThickness: 1.6, switches: [{ x: 0, y: 0, rotation: 0 }],
  keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
  baseFilamentRgb: [247, 247, 245], bodyColorRgb: [240, 240, 240],
  componentHeights: {},
  edgeSettings: [
    { target: 'capTop', style: 'chamfer', radius: 0.5 },
    { target: 'clickerBase', style: 'chamfer', radius: 0.5 },
  ],
  extrudeChamfer: false,
};

function decodePng(buf: Buffer): RgbaImage {
  let p = 8;
  let w = 0, h = 0, bd = 0, ct = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8 || ct !== 6) throw new Error(`expected 8-bit RGBA, got depth ${bd} type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const out = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[o++];
    const line = raw.subarray(o, o + stride);
    o += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? cur[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  return { data: new Uint8ClampedArray(out), width: w, height: h };
}

interface Design { name: string; regions: BuildRegion[]; outline: Ring[]; params: BuildParams }

const square: Ring = [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]];
const squareRegions: BuildRegion[] = [{ filamentRgb: [200, 30, 30], coverage: 1, rings: [square], partName: 'top-color-0-0' }];

/** A Halloween pack design, traced the way the Image tab traces it, on its own outline. */
function traced(file: string): Design {
  const set = processImage(decodePng(readFileSync(join(appDir, 'public/assets/packs/halloween/designs', file))), 4, { removeBg: true, smoothing: 0.1, designMm: 35 });
  const regions: BuildRegion[] = [];
  set.regions.forEach((r, i) => r.components.forEach((c, j) => regions.push({
    filamentRgb: r.quantRgb, coverage: r.coverage, rings: c.rings, partName: `top-color-${i}-${j}`,
  })));
  return { name: `${file.replace('.png', '')} (traced outline)`, regions, outline: set.outline, params: DEFAULTS };
}

const DESIGNS: Design[] = [
  { name: 'circle', regions: squareRegions, outline: [square], params: { ...DEFAULTS, baseShape: 'circle', capWidthMm: 40 } },
  { name: 'heart', regions: squareRegions, outline: [square], params: { ...DEFAULTS, baseShape: 'heart', capWidthMm: 40 } },
  traced('bat.png'),
  traced('witch-hat.png'),
];
const TEXTURES: BlockTexture[] = ['knurl', 'ribs', 'flutes', 'dots', 'chevron'];

/* ------------------------------------------------------------------ measuring */

const build = (d: Design, over: Partial<BuildParams> = {}) => {
  const t0 = performance.now();
  const out = buildClicker(wasm, socket, stem, d.regions, d.outline, { ...d.params, ...over });
  return { ...out, ms: performance.now() - t0 };
};
const bodyOf = (parts: ClickerPart[]) => parts.find((p) => p.name === 'base-body')!;

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
/** The part as a solid, or null when manifold will not take it as one. */
const solidOf = (p: ClickerPart): any => {
  const mesh = new wasm.Mesh({ numProp: p.numProp, vertProperties: p.vertProperties, triVerts: p.triVerts });
  mesh.merge();
  try {
    return wasm.Manifold.ofMesh(mesh);
  } catch {
    return null;
  }
};
const box = (p: ClickerPart) => {
  const v = p.vertProperties;
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += p.numProp) {
    for (let k = 0; k < 3; k++) {
      b[k] = Math.min(b[k], v[i + k]);
      b[k + 3] = Math.max(b[k + 3], v[i + k]);
    }
  }
  return { minX: b[0], minY: b[1], minZ: b[2], maxX: b[3], maxY: b[4], maxZ: b[5], w: b[3] - b[0], h: b[4] - b[1] };
};
const sameMesh = (a: ClickerPart, b: ClickerPart) => a.name === b.name && a.numProp === b.numProp
  && a.vertProperties.length === b.vertProperties.length && a.triVerts.length === b.triVerts.length
  && a.vertProperties.every((v, i) => v === b.vertProperties[i]) && a.triVerts.every((v, i) => v === b.triVerts[i]);
const sameRings = (a: Ring[], b: Ring[]) => JSON.stringify(a) === JSON.stringify(b);

/* "Never thinner", measured where it means something: across the wall, at a run of heights
   between the bevels. The smooth body's slice, less a mesh's worth of slack, has to lie inside the
   textured body's slice. The slack is the skin's sampling — its points sit every 0.3-0.6 mm
   along the outline, so a chord between two of them cuts a polygon corner by a few hundredths —
   and 0.05 mm is far under anything a 0.4 mm nozzle draws. The bevels are left out: the skin's is
   an exact offset of the outline and the smooth block's an approximation, so they differ there by
   construction, not by a thinner wall. */
const SLACK_MM = 0.05;
function thinnerBy(smooth: any, textured: any, zLo: number, zHi: number): { area: number; z: number } {
  let worst = { area: 0, z: zLo };
  for (let k = 0; k <= 8; k++) {
    const z = zLo + ((zHi - zLo) * k) / 8;
    const a = smooth.slice(z);
    const b = textured.slice(z);
    const inset = a.offset(-SLACK_MM, 'Round', 2.0, 32);
    const missing = inset.subtract(b);
    const area = missing.area();
    if (area > worst.area) worst = { area, z };
    a.delete(); b.delete(); inset.delete(); missing.delete();
  }
  return worst;
}

/* ------------------------------------------------------------------ every texture, every outline */

const MARKS = hardcodedVoids().length + markVoids(getMarkSeed()).length;
check('the seeded identity tier is on, as in a release build', getMarkSeed() !== '' && MARKS > hardcodedVoids().length,
  `${MARKS} voids a clicker`);

const timings: string[] = [];
for (const d of DESIGNS) {
  const smooth = build(d);
  const smoothBody = bodyOf(smooth.parts);
  const smoothSolid = solidOf(smoothBody);
  const sb = box(smoothBody);
  const row: string[] = [`${d.name}: smooth ${smooth.ms.toFixed(0)} ms`];
  for (const texture of TEXTURES) {
    const out = build(d, { blockTexture: texture });
    const body = bodyOf(out.parts);
    const solid = solidOf(body);
    const left = out.warnings.find((w) => w.startsWith('Texture left off'));
    check(`${d.name}, ${texture}: the body is one closed solid with its texture on`,
      !!body && closed(body) && !!solid && solid.status() === 'NoError' && !left && out.layout.textureMm > 0,
      `${body ? body.triVerts.length / 3 : 0} tris (smooth ${smoothBody.triVerts.length / 3}), ${out.ms.toFixed(0)} ms`
        + `${left ? `; ${left}` : ''}`);
    if (!solid) continue;

    // Never thinner: between the bevels, nothing of the smooth wall is missing from the textured one.
    const worst = thinnerBy(smoothSolid, solid, sb.minZ + 0.6, sb.maxZ - 0.6);
    const grew = solid.volume() - smoothSolid.volume();
    check(`${d.name}, ${texture}: contains the smooth body (the wall is never thinner)`, worst.area < 1e-3 && grew > 0,
      `${worst.area.toFixed(5)} mm² of the smooth wall more than ${SLACK_MM} mm outside it (worst at z ${worst.z.toFixed(1)}); +${grew.toFixed(0)} mm³`);

    // The cap, the well, the slip fit: untouched.
    const caps = out.parts.filter((p) => p.kind === 'cap');
    const smoothCaps = smooth.parts.filter((p) => p.kind === 'cap');
    check(`${d.name}, ${texture}: the cap and the well are the smooth clicker's`,
      caps.length === smoothCaps.length && caps.every((p, i) => sameMesh(p, smoothCaps[i]))
        && sameRings(out.layout.well, smooth.layout.well) && sameRings(out.layout.cap, smooth.layout.cap),
      `${caps.length} cap parts, well ${out.layout.well.reduce((n, r) => n + r.length, 0)} points`);

    // Counted in the mesh itself, not only by the build: a void is a closed shell of negative
    // volume inside the body, so the textured part must hold one per mark.
    const lost = out.warnings.find((w) => w.startsWith('Provenance:'));
    const shells = solid.decompose();
    const voids = shells.filter((p: any) => p.volume() < 0).length;
    for (const p of shells) p.delete();
    check(`${d.name}, ${texture}: every identity mark lands`, !lost && voids === MARKS, lost ?? `${voids} of ${MARKS} voids in the part`);
    const b = box(body);
    row.push(`${texture} ${out.ms.toFixed(0)} ms (${(b.w - sb.w).toFixed(2)} mm wider)`);
    solid.delete();
  }
  timings.push(row.join(', '));
  smoothSolid.delete();
}

/* ------------------------------------------------------------------ the closing each texture needed */

/* Asked of the wall itself, on the footprint the build drew, so it says what the build did
   without the build having to report it. */
for (const d of DESIGNS.slice(2)) {
  const smooth = build(d);
  const sb = box(bodyOf(smooth.parts));
  const fp = csOf(wasm, smooth.layout.body, 'Positive');
  const used: string[] = [];
  for (const texture of TEXTURES) {
    const wall = texturedWall(wasm, fp, { bottomZ: sb.minZ, rimZ: sb.maxZ, chamferTop: 0.5, chamferBottom: 0.5, texture });
    used.push(`${texture} ${wall ? `${wall.closeMm} mm` : 'none'}`);
    wall?.solid.delete();
  }
  fp.delete();
  timings.push(`${d.name}: closed by ${used.join(', ')}`);
}

/* ------------------------------------------------------------------ the end faces */

/* A long, nearly straight run of outline — a turned design's straight edge, a traced outline's
   flank — leaves Earcut slivers on the wall's top and bottom faces whose winding, in float32, is
   noise. The faces used to be turned to face out triangle by triangle, and a sliver turned on its
   own left the wall open: manifold refused it, and the build climbed the closing ladder for
   nothing (the traced witch hat needed 5.2 mm for Dots that way) or left the texture off. A
   rounded bar tilted by a degree or so is enough to make them, so this fails on the old faces. */
{
  const tilt = (ring: Ring, deg: number): Ring => {
    const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    return ring.map(([x, y]) => [x * c - y * s + 3.21, x * s + y * c - 17.3] as [number, number]);
  };
  const open: string[] = [];
  let walls = 0;
  for (const deg of [0.5, 1.3]) {
    for (const len of [40, 70, 110]) {
      const ring = tilt(roundCorners([[-len / 2, -6], [len / 2, -6], [len / 2, 6], [-len / 2, 6]], 3, 12), deg);
      for (const texture of TEXTURES) {
        walls++;
        try {
          skinShell(wasm, ring, { bottomZ: -9.4, rimZ: 8.3, chamferTop: 0.5, chamferBottom: 0.5, texture }).delete();
        } catch (err) {
          open.push(`${texture} on ${len} mm at ${deg}°: ${(err as Error).message}`);
        }
      }
    }
  }
  check('a wall on a long, slightly tilted straight run closes: its end faces are turned as a whole',
    open.length === 0, open.length ? open.slice(0, 3).join(' | ') : `${walls} walls, all closed`);
}

/* ------------------------------------------------------------------ a fixed size */

/* The lock is a promise about the part: with crests on it, the crests measure the size. */
for (const shape of ['circle', 'square'] as const) {
  for (const texture of TEXTURES) {
    const d: Design = { name: shape, regions: squareRegions, outline: [square], params: { ...DEFAULTS, baseShape: shape } };
    const out = build(d, { blockTexture: texture, bodySize: { w: 50, h: 50 } });
    const b = box(bodyOf(out.parts));
    check(`fixed 50 × 50 mm ${shape}, ${texture}: the finished part measures the locked size`,
      Math.abs(b.w - 50) <= 0.3 && Math.abs(b.h - 50) <= 0.3 && !out.warnings.some((w) => w.startsWith('Texture left off')),
      `${b.w.toFixed(2)} × ${b.h.toFixed(2)} mm`);
  }
}

/* ------------------------------------------------------------------ the keyring loop and the hollow */

{
  const d = DESIGNS[0];
  const kc = { enabled: true, style: 'loop' as const, angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 };
  const plain = box(bodyOf(build(d, { keychain: kc }).parts));
  const out = build(d, { keychain: kc, blockTexture: 'knurl' });
  const body = bodyOf(out.parts);
  const solid = solidOf(body);
  const pieces = solid ? solid.decompose() : [];
  // The identity voids decompose as shells of negative volume: they are cavities, not pieces.
  const solids = pieces.filter((p: any) => p.volume() > 0).length;
  const b = box(body);
  check('a textured body with a keyring loop: one closed solid, the loop where the smooth one has it',
    closed(body) && solids === 1 && Math.abs(b.maxY - plain.maxY) < 0.05 && !!out.layout.loop,
    `${solids} piece(s), reaches y ${b.maxY.toFixed(2)} (smooth ${plain.maxY.toFixed(2)}); hole at `
      + `${out.layout.loop ? `${out.layout.loop.x.toFixed(1)}, ${out.layout.loop.y.toFixed(1)}` : 'none'}`);
  for (const p of pieces) p.delete();
  solid?.delete();

  const hollow = build(DESIGNS[2], { blockTexture: 'ribs', hollowBase: true });
  const hb = bodyOf(hollow.parts);
  const hs = solidOf(hb);
  check('a textured, hollowed base: one closed solid, every identity mark landed',
    closed(hb) && !!hs && !hollow.warnings.some((w) => w.startsWith('Provenance:') || w.includes('hollow')),
    hollow.warnings.join(' | ') || 'no warnings');
  hs?.delete();

  // Everything at once, and the brand mark debossed into the textured underside as deep as into
  // the smooth one: a 10 mm square, 0.6 mm deep.
  const all = { keychain: kc, hollowBase: true, brandMark: { rings: [square.map(([x, y]) => [x * 1.25, y * 1.25] as [number, number])], sizeMm: 10 } };
  const marked = build(d, { ...all, blockTexture: 'chevron' });
  const unmarked = build(d, { ...all, brandMark: undefined, blockTexture: 'chevron' });
  const mb = bodyOf(marked.parts);
  const ms = solidOf(mb);
  const um = solidOf(bodyOf(unmarked.parts));
  const deboss = um && ms ? um.volume() - ms.volume() : 0;
  check('a textured body with a loop, a hollow and a brand mark: one closed solid, the mark 0.6 mm deep',
    closed(mb) && !!ms && Math.abs(deboss - 60) < 1 && !marked.warnings.some((w) => w.startsWith('Provenance:')),
    `${deboss.toFixed(2)} mm³ debossed (10 × 10 × 0.6 = 60); ${marked.warnings.join(' | ') || 'no warnings'}`);
  ms?.delete();
  um?.delete();
}

/* ------------------------------------------------------------------ the fallback */

/* Too tight for any closing: a sharp triangle with the thinnest wall and fit the build allows
   (its corners rounded to 0.45 mm and no more) under a 1.5 mm bevel, which pushes the wall in
   further than those corners are round. Closing rounds inside corners, not outside ones, so
   every step of the ladder folds. The app's own numbers (a 2.6 mm wall, a 0.4 mm fit, a 0.5 mm
   bevel) cannot get here: the outside corners are always rounder than the bevel. */
const TIGHT: Partial<BuildParams> = {
  baseShape: 'ngon', shapeSides: 3, borderWidth: 0.4, tolerance: 0.05,
  edgeSettings: [{ target: 'capTop', style: 'chamfer', radius: 0.5 }, { target: 'clickerBase', style: 'chamfer', radius: 1.5 }],
};
{
  const d = DESIGNS[0];
  const smooth = build(d, TIGHT);
  const out = build(d, { ...TIGHT, blockTexture: 'ribs' });
  const left = out.warnings.filter((w) => w === 'Texture left off: this outline is too tight for it.');
  check('an outline too tight for the texture says so, once', left.length === 1, out.warnings.join(' | '));
  check('and keeps the smooth wall, exactly the smooth clicker\'s',
    sameMesh(bodyOf(out.parts), bodyOf(smooth.parts)) && out.layout.textureMm === 0,
    `${bodyOf(out.parts).triVerts.length / 3} tris (smooth ${bodyOf(smooth.parts).triVerts.length / 3})`);

  // With a fixed size the plate was made smaller for crests that never came, so the smooth wall
  // is that much thicker instead, and the part still measures the size that was locked.
  const locked = build(d, { ...TIGHT, blockTexture: 'ribs', bodySize: { w: 50, h: 50 } });
  const lb = box(bodyOf(locked.parts));
  check('a fixed size whose texture is left off still measures the locked size',
    locked.warnings.includes('Texture left off: this outline is too tight for it.') && Math.abs(lb.w - 50) <= 0.3 && Math.abs(lb.h - 50) <= 0.3,
    `${lb.w.toFixed(2)} × ${lb.h.toFixed(2)} mm; ${locked.warnings.join(' | ')}`);
}

/* ------------------------------------------------------------------ nothing left behind */

/** What a kind of rebuild leaves in the heap, in bytes a rebuild, after two to warm up. */
function leftBehind(run: () => void): number {
  run();
  run();
  const before = heapInUse(heap);
  for (let i = 0; i < 4; i++) run();
  return (heapInUse(heap) - before) / 4;
}
check('the heap can be read', Number.isFinite(heapInUse(heap)), `${heapInUse(heap)} B in use`);
for (const [name, over, d] of [
  ['a knurled bat', { blockTexture: 'knurl' }, DESIGNS[2]],
  ['a dotted witch hat with a keyring loop', { blockTexture: 'dots', keychain: { enabled: true, style: 'loop', angleDeg: 45, holeDiameterMm: 5.2, offsetMm: 0 } }, DESIGNS[3]],
  ['a texture that falls back, after every step of the ladder', { ...TIGHT, blockTexture: 'ribs' }, DESIGNS[0]],
] as [string, Partial<BuildParams>, Design][]) {
  const left = leftBehind(() => void build(d, over));
  check(`${name}: a rebuild leaves nothing behind`, left === 0, `${left} B a rebuild`);
}

console.log('\ntimings (whole buildClicker):');
for (const t of timings) console.log(`  ${t}`);
console.log(failures ? `\n${failures} FAILED` : '\nthe textured clicker holds');
process.exit(failures ? 1 : 0);

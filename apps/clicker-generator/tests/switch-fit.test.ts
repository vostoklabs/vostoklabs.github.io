/*
  The base keeps the shape of the design, whatever the switch needs.

  Ian, with three screenshots: "we need something that would either increase the size or move the
  switch so by default we dont have this box thingy". The box is a rectangular slab bulging out
  of the back of a bat, a slab off one corner of a candy corn, wings either side of a potion.

  Where it comes from: the base follows the artwork, and when the artwork is smaller than the
  switch's 18.5 mm clear column there is nowhere for the column to go — so the build welds a
  rectangular lobe onto the well to make room, and the body traces it.

  The fix is the first of the two things Ian offered: make the artwork big enough. The check
  that used to gate this asked whether the artwork's BOUNDING BOX short side cleared the switch,
  which for anything that is not a rectangle says almost nothing — a bat's bounding box is
  mostly wing-tip and air. It now asks whether the column actually fits inside the plate.

  A first attempt thickened the body's border instead, so the outline stayed the design's shape
  without growing. It was verified from underneath and looked right; the box lives on the TOP
  face, in the well, and was still entirely there. Rendering the wrong face is the whole reason
  that went out as fixed. Hence the assertions below are on the WELL.

  What is asserted:

   1. **The column fits inside the well.** Measured where it shows: the switch's clear column
      must not reach past the well, because that is what makes the base grow a lobe. Reported
      by the build itself as the bulge warning.
   2. **The designs that were already fine are untouched.** The change must be invisible to
      ghost, skull, pumpkin and web, which never bulged.
   3. **Every identity mark still lands.** Invariant #2. The first version of this fix moved the
      switch instead of growing the border, which slid the mark constellation — anchored to
      switch #0 at 10.5-12.5 mm — off the edge of the potion, and it lost one of four.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/switch-fit.test.ts \
      --bundle --platform=node --format=esm --external:manifold-3d \
      --define:import.meta.env='{"BASE_URL":"/"}' \
      --outfile=apps/clicker-generator/.switch-fit-test.mjs \
      && node apps/clicker-generator/.switch-fit-test.mjs
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import Module from 'manifold-3d';

const { processImage } = await import('../src/image/pipeline.ts');
const { parse3MF } = await import('../src/geometry/threemfImport.ts');
const { buildClicker } = await import('../src/geometry/buildClicker.ts');
type BuildParams = import('../src/types.ts').BuildParams;
type BuildRegion = import('../src/types.ts').BuildRegion;
type Ring = import('../src/types.ts').Ring;
type RgbaImage = import('../src/image/decode.ts').RgbaImage;

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
  const bpp = 4;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[o++];
    const line = raw.subarray(o, o + stride);
    o += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
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

const appDir = join(process.cwd(), 'apps/clicker-generator');
const asset = (p: string) => readFileSync(join(appDir, 'public/assets', p)).buffer as ArrayBuffer;
const wasm = await Module();
wasm.setup();
function prep(buf: ArrayBuffer, dropTopToZero: boolean) {
  const raw = parse3MF(buf);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.vertProperties, triVerts: raw.triVerts });
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

/** The app's own defaults, from mount.ts's store and buildParamsFor. */
function defaults(capWidthMm = 35): BuildParams {
  return {
    baseShape: 'outline', capWidthMm, topThickness: 1.5, imageDepth: 0.8,
    imageMargin: 1.2, borderWidth: 2.6, capProud: 4.0, hollowBase: false,
    designScale: 1, shapeSides: 6, shapeCornerPct: 0.22, shapeArmPct: 0.56,
    tolerance: 0.4, stemFitPct: 0, socketFitPct: 0,
    imageOffset: { x: 0, y: 0 }, colorBleed: 0.12, stepHeight: 0.6, travel: 4.0,
    floorThickness: 1.6, switches: [{ x: 0, y: 0, rotation: 0 }],
    keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
    baseFilamentRgb: [240, 240, 240], bodyColorRgb: [40, 40, 40],
    componentHeights: {}, edgeSettings: [], extrudeChamfer: false,
  } as BuildParams;
}

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

const dir = join(appDir, 'public/assets/packs/halloween/designs');
function build(file: string, params: BuildParams) {
  const set = processImage(decodePng(readFileSync(join(dir, file))), 4, { removeBg: true });
  const regions: BuildRegion[] = set.regions.map((r, i) => ({
    filamentRgb: r.quantRgb, coverage: 1,
    rings: r.components.flatMap((c: { rings: Ring[] }) => c.rings),
    partName: `top-color-${i}-0`,
  }));
  const out = buildClicker(wasm, socket, stem, regions, set.outline, params);
  const body = out.parts.find((p) => p.name === 'base-body')!;
  const v = body.vertProperties, t = body.triVerts, n = body.numProp;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;
  for (let i = 0; i < v.length; i += n) {
    if (v[i] < minX) minX = v[i]; if (v[i] > maxX) maxX = v[i];
    if (v[i + 1] < minY) minY = v[i + 1]; if (v[i + 1] > maxY) maxY = v[i + 1];
    if (v[i + 2] < minZ) minZ = v[i + 2];
  }
  // The footprint area, from the triangles lying on the bottom face.
  let area = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * n, b = t[i + 1] * n, c = t[i + 2] * n;
    if (Math.abs(v[a + 2] - minZ) > 1e-3 || Math.abs(v[b + 2] - minZ) > 1e-3 || Math.abs(v[c + 2] - minZ) > 1e-3) continue;
    area += Math.abs((v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[c] - v[a]) * (v[b + 1] - v[a + 1])) / 2;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  return { w, h, area, fill: w * h > 0 ? area / (w * h) : 0, warnings: out.warnings };
}

// ---------------------------------------------------------------- the box

/*
  Asked of the build's own bulge test rather than of the mesh.

  Two mesh statistics were tried first and both were worse than useless. The FILL — the share
  of its bounding box the footprint occupies — does not discriminate at all: the candy corn
  scores 75.1% with the box and without it. The border's distance-spread does discriminate, but
  it measures the wrong thing: it reads the underside, and the box is a lobe in the WELL on the
  top face, so a change that left the box entirely intact scored perfectly on it.

  `buildClicker` already computes the exact quantity — `wellFp.subtract(capFp)` area against
  OVERHANG_OK — and reports it. Asking the thing that knows beats re-deriving it from a mesh,
  and it cannot drift from what the build actually does.
*/
for (const f of ['bat.png', 'candy-corn.png', 'potion.png', 'witch-hat.png']) {
  const r = build(f, defaults());
  check(
    `${f}: the base is not widened around the switch`,
    !r.warnings.some((w) => w.includes('was widened')),
    r.warnings.find((w) => w.includes('was widened')) ?? 'no lobe, no box',
  );
  check(
    `${f}: and the size it actually used is stated`,
    r.warnings.some((w) => w.includes('scaled up to')),
    r.warnings.find((w) => w.includes('scaled up to')) ?? '(no message)',
  );
}

// ---------------------------------------------------------------- no collateral damage

/*
  The four designs that never bulged must be untouched, byte for byte in the footprint. This is
  what stops the fix being a change to every clicker anyone has printed: the growth is behind a
  test that only fires when a column actually pokes out.
*/
for (const [f, w, h] of [
  ['ghost.png', 36.6, 41.0], ['skull.png', 36.3, 41.0],
  ['pumpkin-classic.png', 40.9, 40.1], ['web.png', 39.9, 39.7],
] as [string, number, number][]) {
  const r = build(f, defaults());
  check(
    `${f}: a design that already fitted is unchanged`,
    Math.abs(r.w - w) < 0.15 && Math.abs(r.h - h) < 0.15
      && r.warnings.length === 0,
    `${r.w.toFixed(1)} x ${r.h.toFixed(1)} mm, expected ${w} x ${h}`,
  );
}

// ---------------------------------------------------------------- invariant #2

/*
  Every identity mark still lands. The mark constellation is anchored to switch #0 at a radius
  of 10.5-12.5 mm, so anything that moves the switch toward an edge takes the marks with it —
  which is exactly why the first version of this fix, which moved the switch rather than growing
  the border, was thrown away. It cost the potion one of four marks and nothing but this would
  have caught it.
*/
for (const f of ['bat.png', 'candy-corn.png', 'potion.png', 'witch-hat.png', 'ghost.png']) {
  const r = build(f, defaults());
  const lost = r.warnings.find((w) => w.startsWith('Provenance:'));
  check(`${f}: every identity mark is still buried`, !lost, lost ?? 'all marks landed');
}

console.log(failures ? `\n${failures} FAILED` : '\nthe base keeps the shape of the design');
process.exit(failures ? 1 : 0);

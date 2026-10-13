#!/usr/bin/env node
/*
  node scripts/render-photo-frame.mjs [--out=<dir>] [--only=<name>,...] [--draft]

  The hub's pictures of Photo Frames: the gallery renders in apps/hub/public/media/photo-frame/
  (1200x900 JPEG) and the card's thumbnail, apps/hub/public/thumbs/photo-frame.png (800x600, six
  designs three across).

  Each design is built as the gallery opens it, with the app's own rules, words, pattern and
  buildModel, exactly as the editor composes them for its worker, then posed as the preview's
  Assembled view poses it: standing on its own stand, with the sample photo the preview puts in its
  window (the preview's only; never in a file). Two poses are the picture's own: a fridge frame
  lies on its back, shot from above as it would be seen on the door, and a keychain hangs from a
  key ring, a prop drawn here.

  The pictures come from scripts/product-render.mjs, the sample photo drawn as a texture on the
  preview's own quad, which the build stands 0.2 mm in front of the stand-in print.
  --out writes every picture into one folder instead of the hub's, --only picks pictures by name
  ("thumb" for the thumbnail), --draft renders small and quick for a look.
*/
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { renderScene } from './product-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'photo-frame');
const rootRequire = createRequire(pathToFileURL(join(ROOT, 'package.json')));
const fontsRequire = createRequire(pathToFileURL(join(ROOT, 'packages', 'fonts', 'package.json')));
const { build } = await import(pathToFileURL(rootRequire.resolve('esbuild')).href);

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const outDir = flag('out');
const only = flag('only')?.split(',');
const draft = args.includes('--draft');
const MEDIA = outDir ?? join(ROOT, 'apps', 'hub', 'public', 'media', 'photo-frame');
const THUMB_FILE = outDir ? join(outDir, 'photo-frame.png') : join(ROOT, 'apps', 'hub', 'public', 'thumbs', 'photo-frame.png');
mkdirSync(MEDIA, { recursive: true });

// sharp is in the pnpm store as a dependency of a dependency, linked into no workspace package:
// load it from there, whatever version folder this install made.
const STORE = join(ROOT, 'node_modules', '.pnpm');
const sharpDir = readdirSync(STORE).find((d) => d.startsWith('sharp@'));
if (!sharpDir) throw new Error('sharp is not in node_modules/.pnpm: run pnpm install');
const sharp = createRequire(import.meta.url)(join(STORE, sharpDir, 'node_modules', 'sharp'));

// The app's own code, bundled for node (no DOM is touched on these paths), in a folder of its own
// outside the repo, so nothing is left among the pictures if the script stops half way.
const scratch = mkdtempSync(join(tmpdir(), 'render-photo-frame-'));
const bundle = join(scratch, 'harness.mjs');
await build({
  stdin: {
    contents: [
      "export { DESIGNS, settingsOf } from './src/designs.ts';",
      "export { fitSettings, buildSettingsOf, specOf, patternOf } from './src/rules.ts';",
      "export { composeInk, secondFaceOf } from './src/ink.ts';",
      "export { patternInk } from './src/pattern.ts';",
      "export { frameLayout } from './src/geometry/layout.ts';",
      "export { buildModel } from './src/geometry/build.ts';",
      "export { printOf } from './src/sizes.ts';",
      "export { SAMPLE_PHOTOS } from './src/samples.ts';",
      "export { coverUv } from './src/photoPreview.ts';",
    ].join('\n'),
    resolveDir: APP, sourcefile: 'render-photo-frame-entry.ts', loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error',
  external: ['manifold-3d'],
});
const g = await import(pathToFileURL(bundle).href);
rmSync(scratch, { recursive: true, force: true });
const opentype = fontsRequire('opentype.js');
const wasm = await (await import(pathToFileURL(join(APP, 'node_modules', 'manifold-3d', 'manifold.js')).href)).default();
wasm.setup();

/* ------------------------------------------------------------------ building a design */

const faces = new Map();
function face(id) {
  if (!faces.has(id)) {
    const file = readFileSync(join(ROOT, 'packages', 'fonts', 'src', 'fonts', `${id}.ttf`));
    faces.set(id, opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)));
  }
  return faces.get(id);
}

/** A sample photo as sRGB bytes, drawn from its SVG by librsvg. */
const photos = new Map();
async function samplePhoto(id) {
  if (!photos.has(id)) {
    const p = g.SAMPLE_PHOTOS.find((x) => x.id === id);
    if (!p) throw new Error(`no sample photo ${id}`);
    const { data, info } = await sharp(Buffer.from(p.svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    photos.set(id, { rgb: data, width: info.width, height: info.height });
  }
  return photos.get(id);
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A design as the gallery opens it, built, and its Assembled parts with the stand-in print and a
 *  sample photo (its own unless `sample` names another), as product-render parts. */
async function standing(id, sample) {
  const design = g.DESIGNS.find((d) => d.id === id);
  if (!design) throw new Error(`no design ${id}`);
  // As the editor shows it: inside the rules, the words sized for the room.
  const s = g.fitSettings(g.settingsOf(design)).settings;
  const L = g.frameLayout(g.specOf(s), g.printOf(s));
  const pattern = g.patternOf(s) ? await g.patternInk(L, s.pattern, s.patternSize / 100, s.patternDx, s.patternDy) : null;
  const ink = g.composeInk(s, { main: face(s.font), second: face(g.secondFaceOf(s.font)), symbols: face('icon-fallback') }, pattern);
  const r = g.buildModel(wasm, { s: g.buildSettingsOf(s), ink: ink.rings, pattern: ink.pattern, seed: 'photo-frame/render' });
  const parts = [...r.assembled, r.preview.card].map((m) => ({
    name: m.name, positions: m.vertProperties, indices: m.triVerts, color: m.color, spec: 0.3, gloss: 40,
  }));
  // The preview's photo: its corners go bottom-left, bottom-right, top-right, top-left as the
  // customer sees it, cropped to cover them as the app's photoPart crops it.
  const tex = await samplePhoto(sample ?? design.sample);
  const c = r.preview.photo;
  const { u0, u1, v0, v1 } = g.coverUv(dist(c[0], c[1]) / dist(c[0], c[3]), tex.width / tex.height);
  parts.push({
    name: 'Photo', positions: new Float32Array(c.flat()), indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    uv: new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]), texture: tex, color: [255, 255, 255], spec: 0.12, gloss: 30,
  });
  return { parts, s };
}

/* ------------------------------------------------------------------ poses and props */

function lowestZ(parts) {
  let lo = Infinity;
  for (const p of parts) for (let i = 2; i < p.positions.length; i += 3) lo = Math.min(lo, p.positions[i]);
  return lo;
}

function mapParts(parts, f) {
  return parts.map((p) => {
    const P = p.positions, Q = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      const [x, y, z] = f(P[i], P[i + 1], P[i + 2]);
      Q[i] = x; Q[i + 1] = y; Q[i + 2] = z;
    }
    return { ...p, positions: Q };
  });
}

/** On the fridge: laid on its back, face up, the top of it away from the camera and turned `turn`
 *  degrees about the vertical. Standing is world (x, depth, up) with the face toward -y. */
function laidOnItsBack(parts, turn = 0) {
  const c = Math.cos((turn * Math.PI) / 180), s = Math.sin((turn * Math.PI) / 180);
  return mapParts(parts, (x, y, z) => [x * c - z * s, x * s + z * c, -y]);
}

/** A split ring through a keychain's loop: a steel torus hanging in the plane across the frame
 *  (as a ring hangs), turned `turn` degrees about the vertical, through the hole at the top. */
function keyRing(parts, s, { R = 12, r = 0.95, turn = 35 } = {}) {
  const frame = parts.find((p) => p.name === 'Frame').positions;
  let top = -Infinity, y0 = Infinity;
  for (let i = 0; i < frame.length; i += 3) { top = Math.max(top, frame[i + 2]); y0 = Math.min(y0, frame[i + 1]); }
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < frame.length; i += 3) {
    if (frame[i + 2] > top - 0.5) { x0 = Math.min(x0, frame[i]); x1 = Math.max(x1, frame[i]); }
  }
  // The loop is a disc round the hole, `holeRing` wide; the wire passes through the hole's middle.
  const hole = [(x0 + x1) / 2, y0 + 1.2, top - s.holeRing - s.holeDia / 2];
  const t = (turn * Math.PI) / 180;
  const e1 = [Math.sin(t), Math.cos(t), 0];
  const e2 = [0, 0, 1];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const C = [hole[0], hole[1], hole[2] + R];
  const U = 128, V = 18;
  const P = new Float32Array(U * V * 3);
  const I = [];
  for (let i = 0; i < U; i++) {
    const a = (i / U) * 2 * Math.PI;
    for (let j = 0; j < V; j++) {
      const b = (j / V) * 2 * Math.PI;
      const k = (i * V + j) * 3;
      const rad = R + r * Math.cos(b);
      for (let q = 0; q < 3; q++) P[k + q] = C[q] + rad * (Math.cos(a) * e1[q] + Math.sin(a) * e2[q]) + r * Math.sin(b) * n[q];
      const i2 = (i + 1) % U, j2 = (j + 1) % V;
      I.push(i * V + j, i2 * V + j, i2 * V + j2, i * V + j, i2 * V + j2, i * V + j2);
    }
  }
  return { name: 'Key ring', positions: P, indices: new Uint32Array(I), color: [196, 199, 205], spec: 1.1, gloss: 90, twoSided: true };
}

/* ------------------------------------------------------------------ the pictures */

const STANDING = { azimuth: 24, elevation: 12, fov: 22, light: { azimuth: -40, elevation: 45 }, crease: 40 };
const ABOVE = { azimuth: 0, elevation: 62, fov: 22, light: { azimuth: -35, elevation: 60 }, crease: 40 };
/** A holder a little from above, so its top and the slot the print stands in read. */
const HOLDER = { ...STANDING, elevation: 18 };

/** Each picture: a design, how it is posed, and the camera. */
const GALLERY = [
  { name: 'snapshot-frame-on-its-foot', design: 'snapshot', view: STANDING },
  { name: 'squiggle-fridge-magnet', design: 'squiggle', pose: 'fridge', turn: -8, view: ABOVE },
  { name: 'song-plaque-in-its-base', design: 'song', view: STANDING },
  { name: 'ledge-holder-with-a-print', design: 'ledge', view: HOLDER },
  { name: 'charm-keychain-frame', design: 'charm', pose: 'hanging', view: STANDING },
  { name: 'deco-patterned-frame-on-a-kickstand', design: 'deco', view: STANDING },
];

/** The hub card: six designs three across, each standing as its gallery card shows it, the
 *  sample photos spread so that no two side by side are the same. */
const THUMB = [
  { design: 'arch', sample: 'lake' }, { design: 'song', sample: 'city' }, { design: 'squiggle', sample: 'beach' },
  { design: 'swirl', sample: 'hills' }, { design: 'wedding', sample: 'lake' }, { design: 'pebble', sample: 'city', view: HOLDER },
];

async function scene(c) {
  const { parts, s } = await standing(c.design, c.sample);
  if (c.pose === 'fridge') {
    const laid = laidOnItsBack(parts, c.turn ?? 0);
    return { parts: laid, groundZ: lowestZ(laid) };
  }
  if (c.pose === 'hanging') {
    const all = [...parts, keyRing(parts, s)];
    const lo = lowestZ(parts);
    let hi = -Infinity;
    for (const p of all) for (let i = 2; i < p.positions.length; i += 3) hi = Math.max(hi, p.positions[i]);
    return { parts: all, groundZ: lo - (hi - lo) * 0.18 };
  }
  return { parts, groundZ: lowestZ(parts) };
}

async function writeJpeg(file, rgb, width, height) {
  await sharp(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength), { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(file);
}

const W = draft ? 600 : 1200, H = draft ? 450 : 900;
for (const c of GALLERY) {
  if (only && !only.includes(c.name)) continue;
  const { parts, groundZ } = await scene(c);
  const rgb = renderScene(parts, { width: W, height: H, ss: draft ? 2 : 3, margin: 0.13, groundZ, ...c.view });
  await writeJpeg(join(MEDIA, `${c.name}.jpg`), rgb, W, H);
  console.log(`wrote ${c.name}.jpg`);
}

if (!only || only.includes('thumb')) {
  // 3 x 2 tiles on white with a 2 px gutter, as the other hub cards are laid out.
  const CW = 800, CH = 600, G = 2;
  const colW = [265, 266, 265], rowH = [299, 299];
  const tiles = [];
  for (let k = 0; k < 6; k++) {
    const c = k % 3, r = Math.floor(k / 3);
    const tw = colW[c], th = rowH[r];
    const { parts, groundZ } = await scene(THUMB[k]);
    const rgb = renderScene(parts, { width: tw, height: th, ss: draft ? 2 : 4, margin: 0.07, groundZ, ...(THUMB[k].view ?? STANDING) });
    tiles.push({
      input: Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength), raw: { width: tw, height: th, channels: 3 },
      left: colW.slice(0, c).reduce((a, b) => a + b + G, 0), top: r * (rowH[0] + G),
    });
  }
  const sheet = await sharp({ create: { width: CW, height: CH, channels: 3, background: '#ffffff' } })
    .composite(tiles)
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Composited, the sheet has an alpha channel it does not need: written as plain RGB.
  await sharp(sheet.data, { raw: sheet.info }).removeAlpha().png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(THUMB_FILE);
  console.log('wrote photo-frame.png');
}

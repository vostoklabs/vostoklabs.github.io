#!/usr/bin/env node
/*
  node scripts/render-business-card.mjs [out-dir]

  The hub's pictures of the business card generator: five gallery renders (1200x900 JPEG) in
  apps/hub/public/media/business-card/ and the hub card (800x600 PNG) in
  apps/hub/public/thumbs/business-card.png. With [out-dir], all of them go there instead.

  Every card is the app's own: its settings over DEFAULT_SETTINGS, opened on a template as the
  app opens one, drawn by buildDesign (src/design/build.ts) with the shelf's font files and the
  real contact icons and tap mark from @vostok/symbols, then made solid by buildSolid
  (src/geometry/solid.ts) in manifold-3d with the parameters main.ts passes the worker. The
  solid is built face up with the back laid into its underside, mirrored, so a card shown back
  up is turned over left to right, as a hand turns a card, and its back reads the right way
  round. The pictures come from scripts/product-render.mjs; sharp encodes them.

  ONLY=<name,...> renders just those pictures; SS=<n> sets the supersampling (default 3).
*/
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { renderScene, frameFor } from './product-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'business-card');
const rootRequire = createRequire(pathToFileURL(join(ROOT, 'package.json')));
const fontsRequire = createRequire(pathToFileURL(join(ROOT, 'packages', 'fonts', 'package.json')));
const { build } = await import(pathToFileURL(rootRequire.resolve('esbuild')).href);
// sharp is in the pnpm store as a transitive dependency, not linked into any workspace package.
const PNPM = join(ROOT, 'node_modules', '.pnpm');
const sharpDir = readdirSync(PNPM).find((d) => d.startsWith('sharp@'));
if (!sharpDir) throw new Error('sharp is not in node_modules/.pnpm: run pnpm install');
const sharp = rootRequire(join(PNPM, sharpDir, 'node_modules', 'sharp'));

const outArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const MEDIA = outArg ? resolve(outArg) : join(ROOT, 'apps', 'hub', 'public', 'media', 'business-card');
const THUMB = outArg ? join(resolve(outArg), 'business-card.png') : join(ROOT, 'apps', 'hub', 'public', 'thumbs', 'business-card.png');
mkdirSync(MEDIA, { recursive: true });
mkdirSync(dirname(THUMB), { recursive: true });
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const SS = Number(process.env.SS ?? 3);

// ---- the app's code, bundled for node ---------------------------------------------------------
// Bundled to the temp folder: nothing it imports at run time needs resolving from the repo.
const bundle = join(tmpdir(), `render-business-card-${process.pid}.mjs`);
await build({
  stdin: {
    contents: [
      "export { buildDesign, ICON_IDS, NFC_TAGS } from './src/design/build.ts';",
      "export { TEMPLATES } from './src/design/templates/index.ts';",
      "export { DEFAULT_SETTINGS, raiseOf } from './src/state.ts';",
      "export { CONTACT_ROLES } from './src/design/lockup.ts';",
      "export { buildSolid } from './src/geometry/solid.ts';",
      "export { symbolShapes } from '@vostok/symbols';",
    ].join('\n'),
    resolveDir: APP, sourcefile: 'render-business-card-entry.ts', loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error',
  external: ['manifold-3d'],
  // `import.meta.glob` exists only under Vite; the font URL table it fills stays empty here.
  define: { 'import.meta.glob': 'globalThis.__viteGlob' },
  banner: { js: 'globalThis.__viteGlob = () => ({});' },
});
const g = await import(pathToFileURL(bundle).href);
rmSync(bundle, { force: true });
const wasm = await (await import(pathToFileURL(join(APP, 'node_modules', 'manifold-3d', 'manifold.js')).href)).default();
wasm.setup();

const opentype = fontsRequire('opentype.js');
const faces = new Map();
const face = (id) => {
  if (!faces.has(id)) faces.set(id, opentype.loadSync(join(ROOT, 'packages', 'fonts', 'src', 'fonts', `${id}.ttf`)));
  return faces.get(id);
};
// The contact icons of both families and the tap mark, as main.ts loads them.
const icons = {};
for (const family of Object.keys(g.ICON_IDS)) {
  icons[family] = {};
  for (const role of g.CONTACT_ROLES) icons[family][role] = await g.symbolShapes(g.ICON_IDS[family][role], 1);
}
const tap = await g.symbolShapes('material:contactless', 1);
/** A symbol as the customer's own logo, as the import window hands one over. */
const logo = async (id) => ({ id, label: id, shapes: await g.symbolShapes(id, 1) });

/** A card built as the app builds it: the settings over the defaults, opened on the template. */
async function card(over) {
  const t = g.TEMPLATES.find((x) => x.id === over.template);
  if (!t) throw new Error(`no template ${over.template}`);
  const s = {
    ...g.DEFAULT_SETTINGS,
    ...(t.pattern ? { pattern: t.pattern.value, patternMode: t.pattern.mode ?? 'colour' } : {}),
    ...over,
    colors: { ...(over.colors ?? {}) },
  };
  const d = await g.buildDesign(s, { faces: { main: face(s.font), fallback: face('icon-fallback') }, icons, tap }, t);
  const solid = g.buildSolid(wasm, d, { thickness: s.thickness, raise: g.raiseOf(s), inlay: 0.6, pocketDepth: (g.NFC_TAGS[s.nfcTag] ?? g.NFC_TAGS['25']).depth });
  for (const w of [...d.warnings, ...solid.warnings]) console.log(`  ! ${t.id}: ${w}`);
  return { s, d, solid, top: solid.thickness + g.raiseOf(s) };
}

/**
 * A card's parts placed on the floor: back up (`flip`, turned over left to right), turned
 * `rotZ` degrees and moved. `dz` lifts it onto the cards under it.
 */
function pose(c, { flip = false, rotZ = 0, dx = 0, dy = 0, dz = 0 } = {}) {
  const T = c.solid.thickness;
  const cos = Math.cos((rotZ * Math.PI) / 180), sin = Math.sin((rotZ * Math.PI) / 180);
  return c.solid.parts.map((p) => {
    const P = p.vertProperties, Q = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      const x = flip ? -P[i] : P[i], y = P[i + 1], z = flip ? T - P[i + 2] : P[i + 2];
      Q[i] = x * cos - y * sin + dx;
      Q[i + 1] = x * sin + y * cos + dy;
      Q[i + 2] = z + dz;
    }
    return { positions: Q, indices: p.triVerts, color: p.colour, spec: 0.22, gloss: 36 };
  });
}

/** Part of a card to frame a close-up on: the corners of a box on the card (mm, in the card's own
 *  frame, as `pose` turns it), as a part with no triangles, which frameFor fits and nothing draws. */
const framePart = ([x0, y0], [x1, y1], { rotZ = 0, height = 2 } = {}) => {
  const cos = Math.cos((rotZ * Math.PI) / 180), sin = Math.sin((rotZ * Math.PI) / 180);
  const positions = [];
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    for (const z of [0, height]) positions.push(x * cos - y * sin, x * sin + y * cos, z);
  }
  return { positions, indices: [] };
};

const W = 1200, H = 900;
// The key light lower and softer than the renderer's default: a card is a flat face turned to the
// light, and at full strength a light filament washes out to white.
const LOOK = { fov: 22, light: { azimuth: -35, elevation: 42 }, keyIntensity: 0.85, ambientIntensity: 0.4, crease: 40 };
/** The renderer's RGB bytes as a sharp image. */
const image = (rgb, width, height) => sharp(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.length), { raw: { width, height, channels: 3 } });
async function shot(name, parts, o) {
  if (only && !only.has(name)) return;
  const t0 = Date.now();
  const rgb = renderScene(parts, { ...LOOK, ss: SS, ...o, width: W, height: H });
  await image(rgb, W, H).jpeg({ quality: 88, mozjpeg: true }).toFile(join(MEDIA, `${name}.jpg`));
  console.log(`wrote ${name}.jpg (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

// ---- who is on the cards, and in which filaments ----------------------------------------------
// Made-up people with 555 numbers; John Smith is the app's own sample.
const JOHN = { logo: await logo('material:deployed_code') };
const MAYA = { name: 'Maya Lind', title: 'Architect', company: 'Lind Architects', phone: '+1 555 0187', email: 'maya@lindarch.com', website: 'lindarch.com', logo: await logo('material:architecture'), font: 'manrope' };
const CLARA = { name: 'Clara Weiss', title: 'Florist', company: 'Wild Stem', phone: '+1 555 0119', email: 'clara@wildstem.com', website: 'wildstem.com', logo: await logo('material:local_florist'), font: 'lora' };
const LEO = { name: 'Leo Marchetti', title: 'Head Roaster', company: 'Marchetti Coffee', phone: '+1 555 0163', email: 'leo@marchetti.coffee', website: 'marchetti.coffee', logo: await logo('material:coffee'), font: 'poppins' };
const ANA = { name: 'Ana Ruiz', title: 'Ceramicist', company: 'Ruiz Ceramics', phone: '+1 555 0135', email: 'ana@ruizceramics.com', website: 'ruizceramics.com', logo: await logo('material:spa'), font: 'outfit' };
const DAN = { name: 'Daniel Okafor', title: 'Photographer', company: 'Okafor Studio', phone: '+1 555 0174', email: 'dan@okafor.studio', website: 'okafor.studio', logo: await logo('material:camera'), font: 'montserrat' };

const NAVY = { cardColor: '#1f2a44', inkColor: '#f4f1ea', accentColor: '#c8963c' };
const CREAM_TERRACOTTA = { cardColor: '#efe8da', inkColor: '#25262b', accentColor: '#c0603f' };
const GREEN = { cardColor: '#3d5a4a', inkColor: '#f4f1ea', accentColor: '#d8c3a0' };
const BLACK_GOLD = { cardColor: '#1c1d21', inkColor: '#f7f7f5', accentColor: '#d9a441' };
const WHITE_NAVY = { cardColor: '#f5f5f2', inkColor: '#25262b', accentColor: '#2c4a7a' };
const TERRACOTTA = { cardColor: '#b75a3c', inkColor: '#f6efe4', accentColor: '#2b2622' };

// ---- 1. Minimal, its front and its back -------------------------------------------------------
{
  const c = await card({ template: 'minimal', ...JOHN, ...NAVY });
  await shot('minimal-front-and-back', [
    ...pose(c, { rotZ: 7, dx: -26, dy: 12 }),
    ...pose(c, { flip: true, rotZ: -5, dx: 40, dy: -26, dz: c.top + 0.05 }),
  ], { azimuth: 0, elevation: 46, margin: 0.09 });
}

// ---- 2. Five templates in a cascade, five sets of filaments -------------------------------------
{
  const stack = [
    await card({ template: 'swoosh', ...MAYA, ...GREEN }),
    await card({ template: 'orbit', ...CLARA, ...CREAM_TERRACOTTA }),
    await card({ template: 'half', ...ANA, ...BLACK_GOLD }),
    await card({ template: 'split-name', ...DAN, ...WHITE_NAVY }),
    await card({ template: 'sash', ...LEO, ...TERRACOTTA }),
  ];
  // Each card laid over the one before, lower down the frame, so every name and title shows.
  const down = [0, 21, 46, 67, 88];
  let z = 0;
  const parts = stack.flatMap((c, i) => {
    const out = pose(c, { rotZ: [-5, 3, -2, 4, -1][i], dx: (i - 2) * 8, dy: -down[i], dz: z });
    z += c.top + 0.05;
    return out;
  });
  await shot('five-templates', parts, { azimuth: 0, elevation: 55, margin: 0.1 });
}

// ---- 3. Raised lettering, close up -------------------------------------------------------------
{
  // Monogram: the lettering raised 0.6 mm, the initials carved through the face to the colour
  // under it. The frame holds the card's left two thirds, turned across it, the light raking low.
  const c = await card({ template: 'monogram', ...JOHN, ...CREAM_TERRACOTTA, raised: true, raise: 0.6, iconStyle: 'classic-circle' });
  const rotZ = -14;
  const view = { width: W, height: H, azimuth: 10, elevation: 27, fov: 22, margin: 0.02 };
  await shot('raised-lettering', pose(c, { rotZ }), { ...view, frame: frameFor([framePart([-46, -28], [27, 28], { rotZ })], view) });
}

// ---- 4. Window: a hole right through the card, front over back --------------------------------
{
  const c = await card({ template: 'window', ...CLARA, ...GREEN });
  await shot('window-card', [
    ...pose(c, { flip: true, rotZ: 5, dx: -24, dy: 18 }),
    ...pose(c, { rotZ: -8, dx: 30, dy: -31, dz: c.top + 0.05 }),
  ], { azimuth: 0, elevation: 44, margin: 0.09 });
}

// ---- 5. NFC: a stack of tap cards, and one turned over to its QR code ----------------------------
{
  const c = await card({ template: 'tap', ...DAN, ...BLACK_GOLD });
  const jitter = [[0, 0, 0], [1.2, -0.8, 2.5], [-0.9, 0.6, -1.5], [0.6, 1.1, 1.2], [-0.4, -0.5, -2.2]];
  const stack = jitter.flatMap(([x, y, r], i) => pose(c, { rotZ: -6 + r, dx: -30 + x, dy: 10 + y, dz: i * (c.top + 0.03) }));
  await shot('nfc-card', [...stack, ...pose(c, { flip: true, rotZ: 8, dx: 48, dy: -30 })], { azimuth: 0, elevation: 40, margin: 0.08 });
}

// ---- the hub card: six templates, two across and three down --------------------------------------
// Two across, so each card is drawn twice the size a three-across grid would give it and its name
// still reads on the hub at half size.
if (!only || only.has('thumb')) {
  const six = [
    await card({ template: 'swoosh', ...JOHN, ...NAVY }),
    await card({ template: 'monogram', ...ANA, ...CREAM_TERRACOTTA }),
    await card({ template: 'split-name', ...DAN, ...WHITE_NAVY }),
    await card({ template: 'half', ...CLARA, ...BLACK_GOLD }),
    await card({ template: 'orbit', ...MAYA, ...GREEN }),
    await card({ template: 'corner-qr', ...LEO, ...TERRACOTTA }),
  ];
  const CW = 800, CH = 600, G = 2;
  const colW = [(CW - G) / 2, (CW - G) / 2], rowH = [199, 198, 199];
  const tiles = [];
  for (let k = 0; k < six.length; k++) {
    const c = k % 2, r = Math.floor(k / 2);
    const width = colW[c], height = rowH[r];
    const rgb = renderScene(pose(six[k], { rotZ: c ? 3 : -3 }), { ...LOOK, ss: SS + 1, width, height, azimuth: 0, elevation: 56, margin: 0.07 });
    tiles.push({
      input: await image(rgb, width, height).png().toBuffer(),
      left: c * (colW[0] + G), top: rowH.slice(0, r).reduce((a, b) => a + b + G, 0),
    });
  }
  await sharp({ create: { width: CW, height: CH, channels: 3, background: '#ffffff' } })
    .composite(tiles)
    .png({ compressionLevel: 9, palette: true, quality: 95, effort: 10 })
    .toFile(THUMB);
  console.log(`wrote ${THUMB}`);
}

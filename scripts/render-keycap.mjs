#!/usr/bin/env node
/*
  node scripts/render-keycap.mjs [out-dir]

  Gallery renders of the keycap generator, headless: one 1u cap per profile (same legend, camera,
  colours and light, so they compare side by side) and a staircase of the Standard sizes.

  Same code path as the app: it bundles the app's own keycap.js, letter.js, geometry.js and
  manifold.js (as tests/export-golden.test.mjs does) and carves each cap with buildBodies. The
  pictures come from scripts/product-render.mjs.
*/
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderScene, writePng, frameFor, placed } from './product-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'keycap-generator');
const appRequire = createRequire(join(APP, 'package.json'));
const { build } = await import(pathToFileURL(appRequire.resolve('esbuild')).href);
const { DOMParser, XMLSerializer } = await import(pathToFileURL(appRequire.resolve('@xmldom/xmldom')).href);

const outDir = process.argv[2] ?? join(ROOT, '.render-keycap');
mkdirSync(outDir, { recursive: true });

// ------------------------------------------------------------------ what the browser provides
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const stored = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => void stored.set(k, String(v)), removeItem: (k) => void stored.delete(k) },
});
globalThis.fetch = async (url) => {
  const file = join(APP, 'public', String(url));
  if (!existsSync(file)) return { ok: false, status: 404 };
  const buf = readFileSync(file);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(buf.toString('utf8')),
    text: async () => buf.toString('utf8'),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};

// ------------------------------------------------------------------ the app's modules
const wasm = appRequire.resolve('manifold-3d/manifold.wasm');
const bundle = join(APP, 'node_modules', '.cache', `render-keycap-${process.pid}.mjs`);
mkdirSync(dirname(bundle), { recursive: true });
await build({
  stdin: {
    contents: [
      "export { loadKeycap } from './src/keycap.js';",
      "export { parseLetter, loadBundledFonts } from './src/letter.js';",
      "export { buildBodies } from './src/geometry.js';",
      "export { initManifold, geomToManifold, manifoldToGeom } from './src/manifold.js';",
    ].join('\n'),
    resolveDir: APP,
    sourcefile: 'render-keycap-entry.js',
    loader: 'js',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  logLevel: 'error',
  define: { __KEYCAP_ARTWORK__: 'false' },
  plugins: [{
    name: 'manifold-node',
    setup(b) {
      b.onResolve({ filter: /^manifold-3d\/manifold\.wasm\?url$/ }, () => ({ path: 'wasm', namespace: 'mwasm' }));
      b.onLoad({ filter: /.*/, namespace: 'mwasm' }, () => ({ contents: `export default ${JSON.stringify(wasm)};`, loader: 'js' }));
      b.onResolve({ filter: /^manifold-3d$/ }, () => ({ path: 'manifold-3d', external: true }));
    },
  }],
});
const app = await import(pathToFileURL(bundle).href);
rmSync(bundle, { force: true });
await app.initManifold();
await app.loadBundledFonts();

const index = JSON.parse(readFileSync(join(APP, 'public', 'keycaps', 'index.json'), 'utf8'));
// The panel's defaults (mount.js): a black cap, an off-white legend 0.5 mm deep, Roboto.
const CAP = '#161616', LEGEND = '#f7f7f5', FONT = 'helvetiker-regular';

/** One cap carved with a letter legend, as parts for the renderer: bottom at z 0, centred. */
async function cap(profileId, sizeId, text) {
  const profile = index.profiles.find((p) => p.id === profileId);
  const entry = profile.keycaps.find((k) => k.id === sizeId);
  const kc = await app.loadKeycap(entry.file);
  const meta = kc.meta;
  const parts = [];
  let bodies;
  if (text) {
    const legend = app.parseLetter(text, FONT, Math.max(4, Math.round((entry.unit || 1) * 4)));
    const room = Math.min(meta.topExtent[0], meta.topExtent[1]);
    bodies = await app.buildBodies(kc.shellGeometry, meta, legend, {
      widthMM: Math.round(room * 0.5 * 10) / 10,
      depth: 0.5,
      centerX: meta.center[0],
      centerY: meta.center[1],
      rotationDeg: 0,
      mirror: false,
      through: false,
      singleColor: false,
      homingBump: false,
      homingBumpGeom: null,
    });
  } else {
    bodies = { keycapGeometry: kc.shellGeometry, logoGeometry: null };
  }
  const toPart = (g, color) => ({ positions: g.getAttribute('position').array, indices: g.getIndex().array, color, spec: 0.3, gloss: 45 });
  parts.push(toPart(bodies.keycapGeometry, CAP));
  if (bodies.logoGeometry) parts.push(toPart(bodies.logoGeometry, LEGEND));
  if (kc.stemGeometry) parts.push(toPart(kc.stemGeometry, CAP));
  // Recentre: bottom on the floor, footprint centred on the origin.
  const b = kc.shellGeometry.boundingBox;
  return parts.map((p) => placed(p, { dx: -(b.min.x + b.max.x) / 2, dy: -(b.min.y + b.max.y) / 2, dz: -b.min.z }));
}

const W = 1200, H = 900;
// Brighter than the default light: the cap is near-black plastic.
const LIGHT = { keyIntensity: 2.1, fillIntensity: 0.45, ambientIntensity: 0.55 };
const view = { width: W, height: H, azimuth: 28, elevation: 30, fov: 22, ...LIGHT };

// 1. One 1u per profile, framed on the tallest so every cap is drawn at the same scale.
const PROFILES = [
  ['standard-profile', 'standard'],
  ['low-profile', 'low'],
  ['thocky-profile', 'thocky'],
  ['choc-v1', 'choc-v1'],
];
const caps = [];
for (const [id, slug] of PROFILES) caps.push([slug, await cap(id, '1u', 'A')]);
for (const [slug, parts] of caps) {
  const b = parts.reduce((m, p) => { for (let i = 2; i < p.positions.length; i += 3) m = Math.max(m, p.positions[i]); return m; }, 0);
  console.log(`${slug}: height ${b.toFixed(1)} mm`);
}
// Frame on all four together (overlaid), so the same camera holds each one.
const frame = frameFor(caps.flatMap(([, p]) => p), { ...view, margin: 0.15, target: [0, 0, 5] });
for (const [slug, parts] of caps) {
  const rgb = renderScene(parts, { ...view, frame, groundZ: 0 });
  writePng(join(outDir, `profile-${slug}.png`), rgb, W, H);
  console.log(`wrote profile-${slug}.png`);
}

// 2. The Standard sizes as a staircase, 1u to the spacebar.
const U = 19.05;
const ROWS = [
  [['1u', 'Esc'], ['1_25u', 'Ctrl'], ['1_5u', 'Tab']],
  [['1_75u', 'Caps'], ['2u-1stem', 'Bksp']],
  [['2_25u', 'Enter'], ['2_75u', 'Shift']],
  [['6_25u-spacebar', '']],
];
const UNIT = { '1u': 1, '1_25u': 1.25, '1_5u': 1.5, '1_75u': 1.75, '2u-1stem': 2, '2_25u': 2.25, '2_75u': 2.75, '6_25u-spacebar': 6.25 };
const all = [];
for (let r = 0; r < ROWS.length; r++) {
  let x = 0;
  for (const [id, text] of ROWS[r]) {
    const w = UNIT[id] * U;
    const parts = await cap('standard-profile', id, text);
    all.push(...parts.map((p) => placed(p, { dx: x + w / 2 - 3.25 * U, dy: (ROWS.length / 2 - r - 0.5) * (U + 2) })));
    x += w + 2;
  }
}
const rgb = renderScene(all, { width: W, height: H, azimuth: 18, elevation: 42, fov: 22, margin: 0.07, groundZ: 0, ...LIGHT });
writePng(join(outDir, 'sizes.png'), rgb, W, H);
console.log('wrote sizes.png');

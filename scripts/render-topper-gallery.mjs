#!/usr/bin/env node
/*
  node scripts/render-topper-gallery.mjs [out-dir]

  Gallery renders of the pen topper: a few of the toppers the app makes, standing upright as
  they sit on a pen, floating over a soft shadow.

  Same code path as the app: it bundles src/geometry/harnessEntry.ts and lays the name out with
  the shelf's text layout, as render-topper.mjs does. The pictures come from
  scripts/product-render.mjs.
*/
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { renderScene, writePng } from './product-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'pen-topper');
const rootRequire = createRequire(pathToFileURL(join(ROOT, 'package.json')));
const fontsRequire = createRequire(pathToFileURL(join(ROOT, 'packages', 'fonts', 'package.json')));
const MANIFOLD_JS = join(APP, 'node_modules', 'manifold-3d', 'manifold.js');

const outDir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(ROOT, '.render-topper-gallery');
mkdirSync(outDir, { recursive: true });
const bundle = join(outDir, '_harness.mjs');
execFileSync(process.execPath, [
  rootRequire.resolve('esbuild/bin/esbuild'), join(APP, 'src', 'geometry', 'harnessEntry.ts'),
  '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`, '--log-level=warning',
], { cwd: ROOT, stdio: 'inherit' });
const harness = await import(pathToFileURL(bundle).href);
rmSync(bundle, { force: true });
const opentype = fontsRequire('opentype.js');
const wasm = await (await import(pathToFileURL(MANIFOLD_JS).href)).default();
wasm.setup();

const fontDir = join(ROOT, 'packages', 'fonts', 'src', 'fonts');
const fonts = new Map();
const loadFont = (id) => {
  if (!fonts.has(id)) fonts.set(id, opentype.loadSync(join(fontDir, `${id}.ttf`)));
  return fonts.get(id);
};

const CASES = [
  { name: 'name-plate', s: {} },
  { name: 'two-lines', s: { name: 'MISS', secondLine: 'LEE', size: 9, plateColor: '#5b9dff' } },
  { name: 'three-colour-halo', s: { name: 'Rio', colorScheme: 'plate-halo-text', plateColor: '#f2f4f8', haloColor: '#ff7a59', textColor: '#1d2027' } },
  { name: 'standing-totem', s: { penPath: 'collar', socketAngle: 0, layout: 'vertical', name: 'Ivy', plateColor: '#2f9e6e' } },
  { name: 'letters-only', s: { plateShape: 'none', penPath: 'through', name: 'Mickey', textColor: '#ffcd5c' } },
];

const W = 1200, H = 900;
for (const c of CASES) {
  const s = { ...harness.DEFAULT_SETTINGS, ...c.s };
  const font = loadFont(s.font), fallback = loadFont('icon-fallback');
  const laid = s.layout === 'vertical'
    ? harness.getVerticalContours(font, fallback, s.name, s.size, s.lineSpacing, s.letterSpacing)
    : harness.getHorizontalContours(font, fallback, s.name, s.secondLine, s.size, s.size * s.line2Scale, 0, s.line2Align, 0.62 * s.lineSpacing, s.letterSpacing, { alignMode: 'block' });
  const built = harness.buildTopper(wasm, laid.contours, { ...s, lines: laid.lines });
  if (built.warnings.length) console.log(`  ! ${c.name}: ${built.warnings.join('; ')}`);
  // The topper is modelled face-on in XY with Y up and the face toward +Z; stand it up so the
  // face looks at the camera: world (x, -z, y).
  const parts = built.parts.map((p) => {
    const P = p.positions, Q = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) { Q[i] = P[i]; Q[i + 1] = -P[i + 2]; Q[i + 2] = P[i + 1]; }
    return { positions: Q, indices: p.indices, color: p.color, spec: 0.3, gloss: 40 };
  });
  let lo = Infinity, hi = -Infinity;
  for (const p of parts) for (let i = 2; i < p.positions.length; i += 3) { lo = Math.min(lo, p.positions[i]); hi = Math.max(hi, p.positions[i]); }
  const rgb = renderScene(parts, {
    width: W, height: H, azimuth: 26, elevation: 16, fov: 22, margin: 0.12,
    groundZ: lo - (hi - lo) * 0.18, light: { azimuth: -35, elevation: 50 }, crease: 40,
  });
  writePng(join(outDir, `${c.name}.png`), rgb, W, H);
  console.log(`wrote ${c.name}.png`);
}

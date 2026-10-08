#!/usr/bin/env node
/*
  node scripts/render-name-keychain.mjs [out-dir]

  Gallery renders of the name keychain: a few of the keychains the app makes, lying flat on a
  soft floor. Same code path as the app: it bundles src/geometry/harnessEntry.ts (as the app's
  scripts/harness.mjs does) and lays the name out with the shelf's text layout the way mount.ts
  does. The pictures come from scripts/product-render.mjs.
*/
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { renderScene, writePng } from './product-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'name-keychain');
const rootRequire = createRequire(pathToFileURL(join(ROOT, 'package.json')));
const fontsRequire = createRequire(pathToFileURL(join(ROOT, 'packages', 'fonts', 'package.json')));

const outDir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(ROOT, '.render-name-keychain');
mkdirSync(outDir, { recursive: true });
const bundle = join(outDir, '_harness.mjs');
execFileSync(process.execPath, [
  rootRequire.resolve('esbuild/bin/esbuild'), join(APP, 'src', 'geometry', 'harnessEntry.ts'),
  '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`, '--log-level=warning',
], { cwd: ROOT, stdio: 'inherit' });
const g = await import(pathToFileURL(bundle).href);
rmSync(bundle, { force: true });
const opentype = fontsRequire('opentype.js');
const wasm = await (await import(pathToFileURL(join(APP, 'node_modules', 'manifold-3d', 'manifold.js')).href)).default();
wasm.setup();

const fontDir = join(ROOT, 'packages', 'fonts', 'src', 'fonts');
const fonts = new Map();
const font = (id) => {
  if (!fonts.has(id)) fonts.set(id, opentype.loadSync(join(fontDir, `${id}.ttf`)));
  return fonts.get(id);
};

// mount.ts's state defaults.
const STATE = {
  name: 'Name', secondLine: '', font: 'luckiest-guy', layout: 'horizontal', style: 'raised', plateShape: 'outline',
  size: 18, line2Scale: 1.0, line2Align: 'center', baseThickness: 2.0, textThickness: 1.6, outlineWidth: 2.5,
  smoothing: 2.0, ringStyle: 'loop', holeDia: 4.0, ringThickness: 2.2, ringPosX: 0, ringPosY: 0, ringAngle: 180,
  haloWidth: 1.2, haloThickness: 0.8, plate: '#1d2027', halo: '#5b9dff', text: '#f2f4f8',
  colorScheme: 'plate-halo-text', lineSpacing: 1.0, letterSpacing: 0, boldness: 0, chamfer: 0.4,
  printMode: 'ams', layerHeight: 0.2,
};
const baseLineFactor = (id) => (id === 'vt323' || id === 'press-start-2p' ? 0.44 : id === 'creepster' ? 0.55 : 0.62);

const CASES = [
  { name: 'three-colour', s: { name: 'Emma' } },
  { name: 'script-two-colour', s: { name: 'Sophie', font: 'dancing-script', colorScheme: 'plate-text', plate: '#ff8fb1', text: '#ffffff', size: 20 } },
  { name: 'two-lines', s: { name: 'Max', secondLine: 'Rocket', font: 'bangers', plate: '#2f9e6e', halo: '#ffcd5c', text: '#ffffff' } },
  { name: 'tag-plate', s: { name: 'LEO', font: 'bebas-neue', plateShape: 'rectangle', colorScheme: 'plate-text', plate: '#f2f4f8', text: '#1d2027', size: 20 } },
];

for (const c of CASES) {
  const s = { ...STATE, ...c.s };
  const f = font(s.font), fb = font('icon-fallback');
  const gap = 2 * (s.holeDia / 2 + s.ringThickness) + 2;
  const res = s.layout === 'vertical'
    ? g.getVerticalContours(f, fb, s.name, s.size, s.lineSpacing, s.letterSpacing)
    : g.getHorizontalContours(f, fb, s.name, s.secondLine, s.size, s.size * s.line2Scale, gap, s.line2Align, baseLineFactor(s.font) * s.lineSpacing, s.letterSpacing);
  const out = g.buildKeychain(wasm, res.contours, {
    ...s, plateColor: s.plate, haloColor: s.halo, textColor: s.text, lines: res.lines,
  });
  if (out.warnings.length) console.log(`  ! ${c.name}: ${out.warnings.join('; ')}`);
  const parts = out.parts.map((p) => ({ positions: p.vertProperties, indices: p.triVerts, color: p.colorRgb, spec: 0.3, gloss: 40 }));
  const rgb = renderScene(parts, {
    width: 1200, height: 900, azimuth: 14, elevation: 50, fov: 22, margin: 0.1,
    light: { azimuth: -35, elevation: 55 }, crease: 40,
  });
  writePng(join(outDir, `${c.name}.png`), rgb, 1200, 900);
  console.log(`wrote ${c.name}.png`);
}

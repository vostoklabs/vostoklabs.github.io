#!/usr/bin/env node
/*
  node scripts/render-house-number.mjs [out-dir]

  Gallery renders of the house number sign: the app's own presets, built with its real
  buildSign and the shelf's text layout exactly as main.ts calls them, stood upright as they
  hang on a wall. The pictures come from scripts/product-render.mjs.
*/
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { renderScene, writePng } from './product-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'house-number');
const rootRequire = createRequire(pathToFileURL(join(ROOT, 'package.json')));
const fontsRequire = createRequire(pathToFileURL(join(ROOT, 'packages', 'fonts', 'package.json')));
const { build } = await import(pathToFileURL(rootRequire.resolve('esbuild')).href);

const outDir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(ROOT, '.render-house-number');
mkdirSync(outDir, { recursive: true });
const bundle = join(outDir, '_harness.mjs');
await build({
  stdin: {
    contents: [
      "export { buildSign } from './src/geometry/buildSign.ts';",
      "export { DEFAULTS, atScale } from './src/types.ts';",
      "export { PRESETS } from './src/state.ts';",
      "export { getHorizontalContours, getVerticalContours } from '@vostok/fonts/textLayout';",
    ].join('\n'),
    resolveDir: APP, sourcefile: 'render-house-number-entry.ts', loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error',
  external: ['manifold-3d'],
});
const g = await import(pathToFileURL(bundle).href);
rmSync(bundle, { force: true });
const opentype = fontsRequire('opentype.js');
const wasm = await (await import(pathToFileURL(join(APP, 'node_modules', 'manifold-3d', 'manifold.js')).href)).default();
wasm.setup();
// main.ts opens on the first curated face.
const font = opentype.loadSync(join(ROOT, 'packages', 'fonts', 'src', 'fonts', 'anton.ttf'));

const CASES = [
  { name: 'house', preset: 'house', s: { text: '27' } },
  { name: 'name-in-a-band', preset: 'band', s: { text: '14', text2: 'ELM STREET', plateColor: '#f2f4f8', textColor: '#1d2027', bandColor: '#1d2027' } },
  { name: 'edge-band', preset: 'edgeband', s: { text: '108', plateColor: '#2f5d50', textColor: '#f7f7f5', bandColor: '#d9b77e' } },
  { name: 'inset-panel', preset: 'panel', s: { text: '5', plateColor: '#f7f7f5', textColor: '#161616' } },
];

for (const c of CASES) {
  const preset = g.PRESETS.find((x) => x.id === c.preset);
  const p = g.atScale({ ...g.DEFAULTS, fontId: 'anton', ...preset.patch, ...c.s });
  const lay = p.orientation === 'vertical'
    ? g.getVerticalContours(font, font, p.text, p.textSize, p.stackSpacing, 0)
    : g.getHorizontalContours(font, font, p.text, p.text2.trim(), p.textSize, p.line2Size, 0, p.align, p.lineSpacing, p.letterSpacing,
      { alignMode: 'block', placement: p.linePlacement, vAlign: p.vAlign });
  const res = g.buildSign(wasm, lay.contours, { ...p }, lay.lines);
  if (res.warnings?.length) console.log(`  ! ${c.name}: ${res.warnings.join('; ')}`);
  // Built lying face-up; hang it: world (x, -z, y), the face toward the camera.
  const parts = res.parts.map((q) => {
    const P = q.vertProperties, Q = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) { Q[i] = P[i]; Q[i + 1] = -P[i + 2]; Q[i + 2] = P[i + 1]; }
    return { positions: Q, indices: q.triVerts, color: q.colorRgb, spec: 0.3, gloss: 40 };
  });
  let lo = Infinity, hi = -Infinity;
  for (const q of parts) for (let i = 2; i < q.positions.length; i += 3) { lo = Math.min(lo, q.positions[i]); hi = Math.max(hi, q.positions[i]); }
  const rgb = renderScene(parts, {
    width: 1200, height: 900, azimuth: 28, elevation: 12, fov: 22, margin: 0.12,
    groundZ: lo - (hi - lo) * 0.15, light: { azimuth: -40, elevation: 45 }, crease: 40,
  });
  writePng(join(outDir, `${c.name}.png`), rgb, 1200, 900);
  console.log(`wrote ${c.name}.png`);
}

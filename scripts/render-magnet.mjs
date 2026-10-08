#!/usr/bin/env node
/*
  node scripts/render-magnet.mjs [out-dir]

  Gallery renders of the fridge magnet: the app's own sample pictures run through its real image
  pipeline (processImage: matte, quantise, trace) and its real buildMagnet, with mount.ts's
  default settings, image face up. The pictures are decoded with Python's Pillow (the app does it
  with the browser's decoder; the samples are already at its 1100 px working size, so nothing is
  resampled). The renders come from scripts/product-render.mjs.
*/
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { renderScene, writePng } from './product-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'magnet-generator');
const rootRequire = createRequire(pathToFileURL(join(ROOT, 'package.json')));
const { build } = await import(pathToFileURL(rootRequire.resolve('esbuild')).href);

const outDir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(ROOT, '.render-magnet');
mkdirSync(outDir, { recursive: true });
const bundle = join(outDir, '_harness.mjs');
await build({
  stdin: {
    contents: [
      "export { processImage } from './src/image/pipeline';",
      "export { buildMagnet } from './src/geometry/buildMagnet';",
    ].join('\n'),
    resolveDir: APP, sourcefile: 'render-magnet-entry.ts', loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error',
  external: ['manifold-3d'],
});
const g = await import(pathToFileURL(bundle).href);
rmSync(bundle, { force: true });
const wasm = await (await import(pathToFileURL(join(APP, 'node_modules', 'manifold-3d', 'manifold.js')).href)).default();
wasm.setup();

/** RGBA pixels of a PNG, via Pillow. */
function decode(file) {
  const py = 'import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert("RGBA");sys.stdout.buffer.write(im.width.to_bytes(4,"little")+im.height.to_bytes(4,"little")+im.tobytes())';
  const buf = execFileSync('python', ['-c', py, file], { maxBuffer: 64 << 20 });
  const width = buf.readUInt32LE(0), height = buf.readUInt32LE(4);
  return { width, height, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, width * height * 4).slice() };
}

// mount.ts's DEFAULT_SETTINGS, as buildRequest() hands them to the worker.
const D = {
  colorCount: 4, smoothing: 0.5, removeBg: true,
  baseShape: 'outline', fitSizeMm: 70, thickness: 3, imageMargin: 1.5, cornerRadius: 6,
  edgeStyle: 'bevel', edgeRadius: 0.6, bodyRgb: [232, 232, 236], colorBleed: 0.12, stepHeight: 0.6,
  extrudeChamfer: false, magnetMode: 'glue-on', magnetShape: 'disc', magnetDiameter: 10, magnetX: 20,
  magnetY: 10, magnetDepth: 2, backWall: 0.8, magnetCount: 1, pocketFit: 0.2, pocketProfile: 'round',
  sheetHelperEnabled: false, magnetPlacement: 'auto', magnets: [], productType: 'magnet', sliderLayout: 6,
  sliderMirrorBlank: false, sliderGap: 3, sliderArrayOffset: { x: 0, y: 0 },
};

const CASES = [
  { name: 'dog', file: 'dog.png', s: {} },
  { name: 'cheese-raised', file: 'cheese.png', s: {}, levels: [0, 1, 2, 3] },
  { name: 'radiation-round', file: 'radiation.png', s: { baseShape: 'circle' } },
  { name: 'heart', file: 'heart.png', s: {} },
];

for (const c of CASES) {
  const v = { ...D, ...c.s };
  const img = decode(join(APP, 'public', 'assets', 'media', 'images', c.file));
  const set = g.processImage(img, v.colorCount, { removeBg: v.removeBg, smoothing: v.smoothing });
  const regions = [], componentHeights = {};
  set.regions.forEach((r, i) => {
    r.components.forEach((comp, j) => {
      const partName = `inlay-${i}-${j}`;
      regions.push({ filamentRgb: r.quantRgb, coverage: r.coverage, rings: comp.rings, partName });
      componentHeights[partName] = c.levels?.[i] ?? 0;
    });
  });
  const { magnetX, magnetY, colorCount, smoothing, removeBg, ...params } = v;
  const res = g.buildMagnet(wasm, regions, set.outline, { ...params, magnetX, magnetY, componentHeights });
  if (res.warnings.length) console.log(`  ! ${c.name}: ${res.warnings.join('; ')}`);
  const parts = res.parts.filter((p) => p.group === 'magnet').map((p) => {
    // vertProperties may carry more than xyz per vertex.
    const n = p.numProp ?? 3, P = p.vertProperties;
    const Q = new Float32Array((P.length / n) * 3);
    for (let i = 0; i < P.length / n; i++) { Q[i * 3] = P[i * n]; Q[i * 3 + 1] = P[i * n + 1]; Q[i * 3 + 2] = P[i * n + 2]; }
    return { positions: Q, indices: p.triVerts, color: p.colorRgb, spec: 0.3, gloss: 40 };
  });
  const rgb = renderScene(parts, {
    width: 1200, height: 900, azimuth: 16, elevation: 48, fov: 22, margin: 0.12,
    light: { azimuth: -35, elevation: 55 }, crease: 40,
  });
  writePng(join(outDir, `${c.name}.png`), rgb, 1200, 900);
  console.log(`wrote ${c.name}.png (${set.regions.length} colours)`);
}

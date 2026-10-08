#!/usr/bin/env node
/*
  node scripts/render-foldbox.mjs [out-dir]

  Gallery renders of the fold-up box: a few of its structures folded by the app's own fold rig
  (src/fold/rig.ts, driven the way tests/fold.mts drives it), in the 3D view's card colours.
  The pictures come from scripts/product-render.mjs.
*/
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { renderScene, writePng } from './product-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'foldbox');
const rootRequire = createRequire(pathToFileURL(join(ROOT, 'package.json')));
const { build } = await import(pathToFileURL(rootRequire.resolve('esbuild')).href);

const outDir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(ROOT, '.render-foldbox');
mkdirSync(outDir, { recursive: true });
const bundle = join(outDir, '_harness.mjs');
await build({
  stdin: {
    contents: [
      "export { solve } from './src/geometry/solve';",
      "export { buildRig } from './src/fold/rig';",
      "export { DEFAULT_PARAMS } from './src/types';",
      "export * as THREE from 'three';",
    ].join('\n'),
    resolveDir: APP, sourcefile: 'render-foldbox-entry.ts', loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error',
});
const g = await import(pathToFileURL(bundle).href);
rmSync(bundle, { force: true });
const { THREE } = g;

// mount.ts's CARD_COLORS.
const KRAFT = { color: '#c8a273', edge: '#6d4f2c' };
const WHITE = { color: '#eae6df', edge: '#8d867c' };

const CASES = [
  { name: 'mailer', p: { style: 'mailer' }, skin: KRAFT, t: 0.82, view: { azimuth: 30, elevation: 30 } },
  { name: 'tuck-top', p: { style: 'tuck-top', lengthMm: 60, widthMm: 40, heightMm: 90 }, skin: WHITE, t: 0.9, view: { azimuth: 32, elevation: 26 } },
  { name: 'gable', p: { style: 'gable', lengthMm: 80, widthMm: 50, heightMm: 70 }, skin: KRAFT, t: 1, view: { azimuth: 34, elevation: 22 } },
  { name: 'tray-with-lid', p: { style: 'tray-lid' }, skin: WHITE, t: 0.75, view: { azimuth: 28, elevation: 34 } },
];

for (const c of CASES) {
  const params = { ...g.DEFAULT_PARAMS, ...c.p };
  const r = g.solve(params);
  const rig = g.buildRig(r.net, { ...c.skin, thickness: () => params.caliperMm });
  rig.setProgress(c.t);
  rig.object.updateMatrixWorld(true);
  const parts = [];
  rig.object.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    const pos = geo.getAttribute('position');
    const P = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      // The net lies in XY and folds up toward +Z: already the renderer's Z-up world.
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    }
    const index = geo.getIndex();
    const all = index ? Array.from(index.array) : Array.from({ length: pos.count }, (_, i) => i);
    // An extruded panel: its first group is the faces, the second the cut edges.
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: all.length, materialIndex: 0 }];
    for (const grp of groups) {
      const ids = all.slice(grp.start, grp.start + grp.count);
      if (!ids.length) continue;
      const mat = Array.isArray(o.material) ? o.material[grp.materialIndex] : o.material;
      const color = grp.materialIndex === 1 ? c.skin.edge : mat?.color ? `#${mat.color.getHexString()}` : c.skin.color;
      parts.push({ positions: P, indices: Uint32Array.from(ids), color, spec: 0.06, gloss: 10, twoSided: true });
    }
  });
  rig.dispose();
  const rgb = renderScene(parts, {
    width: 1200, height: 900, fov: 24, margin: 0.12, ...c.view,
    light: { azimuth: -40, elevation: 50 }, crease: 25,
  });
  writePng(join(outDir, `${c.name}.png`), rgb, 1200, 900);
  console.log(`wrote ${c.name}.png (${parts.length} parts)`);
}

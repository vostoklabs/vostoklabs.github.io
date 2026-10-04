// @vostok/manifold held to the glue it replaces, on both manifold builds: the npm one and the
// vendored no-eval one the apps alias.
//
// 1. csOf / ringsOf / extrude give exactly what the glue gives — the same rings, the same mesh
//    to the byte — for every fill rule, a lone ring, {x, y} points, every extrude argument.
// 2. Nothing they make stays in the heap, while the glue's own calls do (so the probe can see
//    a leak at all). Measured by walking the allocator (packages/laser/tests/heap-probe.mjs).
//
// Run: node packages/manifold/tests/manifold.test.mjs   (esbuild bundles the TS source)
// tests/ is gitignored, like every test folder here that is not the clicker's or the keycap's.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureHeaps, heapInUse } from '../../laser/tests/heap-probe.mjs';

const heaps = captureHeaps();

const here = fileURLToPath(new URL('.', import.meta.url));
const root = `${here}..`.split('\\').join('/');
const tmp = `${root}/tests/.tmp`;
mkdirSync(tmp, { recursive: true });
const entry = `${tmp}/entry.mjs`;
writeFileSync(entry, `export * from '${root}/src/index.ts';\n`);
// Paths here contain a space, and `shell: true` on Windows re-splits the argv — so quote them.
execFileSync('npx', ['esbuild', `"${entry}"`, '--bundle', '--format=esm', '--platform=node', `"--outfile=${tmp}/bundle.mjs"`, '--log-level=error'], { shell: true, stdio: 'inherit' });
const M = await import(`file://${tmp}/bundle.mjs`);

const MANIFOLD_NPM = `${root}/../../node_modules/.pnpm/manifold-3d@3.5.1_@gltf-tra_7e18b27e6eb4de4a62c630784cb5a8ef/node_modules/manifold-3d/manifold.js`;
const BUILDS = [
  ['npm', MANIFOLD_NPM],
  ['no-eval', `${root}/../manifold-noeval/manifold.js`],
];

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const circle = (cx, cy, r, n, cw = false) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = ((cw ? -i : i) / n) * 2 * Math.PI;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytesOf = (m) => {
  const mesh = m.getMesh();
  return Buffer.concat([Buffer.from(mesh.vertProperties.buffer), Buffer.from(mesh.triVerts.buffer), Buffer.from(String(mesh.numProp))]).toString('base64');
};

for (const [name, file] of BUILDS) {
  const Module = (await import(pathToFileURL(file).href)).default;
  const wasm = await Module();
  wasm.setup();
  const heap = heaps[heaps.length - 1];
  console.log(`\n== ${name}`);

  // ---- 1. the glue, to the byte ---------------------------------------------
  const rings = [circle(0, 0, 20, 64), circle(0, 0, 12, 48, true), circle(30, 0, 5, 32), circle(5, 0, 10, 40)];
  for (const rule of ['Positive', 'EvenOdd', 'NonZero', 'Negative']) {
    const glue = new wasm.CrossSection(rings, rule);
    const ours = M.csOf(wasm, rings, rule);
    check(`${name}: csOf(${rule}) is the glue's CrossSection`, same(glue.toPolygons(), ours.toPolygons()));
    check(`${name}: ringsOf(${rule}) is the glue's toPolygons()`, same(M.ringsOf(glue), glue.toPolygons()));
    glue.delete();
    ours.delete();
  }
  {
    const lone = circle(3, 4, 7, 40);
    const glue = new wasm.CrossSection(lone, 'NonZero');
    const ours = M.csOf(wasm, lone, 'NonZero');
    check(`${name}: csOf takes one ring on its own, as the glue does`, same(glue.toPolygons(), ours.toPolygons()));
    const objs = M.csOf(wasm, [lone.map(([x, y]) => ({ x, y }))], 'NonZero');
    check(`${name}: csOf takes {x, y} points, as the glue does`, same(glue.toPolygons(), objs.toPolygons()));
    check(`${name}: csOf defaults to the glue's Positive rule`, same(new wasm.CrossSection(rings).toPolygons(), M.csOf(wasm, rings).toPolygons()));
    glue.delete();
    ours.delete();
    objs.delete();
  }
  {
    const cs = M.csOf(wasm, [circle(0, 0, 20, 64), circle(0, 0, 12, 48, true)], 'Positive');
    const argsets = [
      [5],
      [5, 0, 0, [1, 1], false],
      [5, 4, 30],
      [3, 0, 0, [0.5, 0.8]],
      [7, 0, 0, [1, 1], true],
      [2.5, 2, 15, [0.9, 1.1], true],
    ];
    for (const a of argsets) {
      const glue = cs.extrude(...a);
      const ours = M.extrude(wasm, cs, ...a);
      check(`${name}: extrude(${JSON.stringify(a)}) is the glue's solid, to the byte`, bytesOf(glue) === bytesOf(ours));
      const viaStatic = wasm.Manifold.extrude(cs, ...a);
      check(`${name}: … and Manifold.extrude(cs, ${JSON.stringify(a)})'s`, bytesOf(viaStatic) === bytesOf(ours));
      glue.delete();
      ours.delete();
      viaStatic.delete();
    }
    cs.delete();
  }

  // ---- 2. nothing stays in the heap -----------------------------------------
  const big = [circle(0, 0, 20, 1000), circle(0, 0, 12, 600, true)];
  const src = M.csOf(wasm, big, 'Positive');
  const leakOf = (run) => {
    for (let i = 0; i < 3; i++) run();
    const before = heapInUse(heap);
    const N = 20;
    for (let i = 0; i < N; i++) run();
    return (heapInUse(heap) - before) / N;
  };
  const ops = [
    ['csOf', () => M.csOf(wasm, big, 'NonZero').delete(), () => new wasm.CrossSection(big, 'NonZero').delete()],
    ['ringsOf', () => M.ringsOf(src), () => src.toPolygons()],
    ['extrude', () => M.extrude(wasm, src, 4).delete(), () => src.extrude(4).delete()],
    ['extrude, centred', () => M.extrude(wasm, src, 4, 0, 0, [1, 1], true).delete(), () => src.extrude(4, 0, 0, [1, 1], true).delete()],
  ];
  for (const [label, ours, glue] of ops) {
    const g = leakOf(glue);
    check(`${name}: the glue's ${label} leaks (the probe can see it)`, Number.isFinite(g) && g > 0, `${g.toFixed(0)} B a call`);
    const o = leakOf(ours);
    check(`${name}: ${label} leaves nothing in the heap`, Number.isFinite(o) && o <= 0, `${o.toFixed(0)} B a call`);
  }
  src.delete();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(1);
}

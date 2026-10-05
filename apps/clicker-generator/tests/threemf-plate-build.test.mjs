/*
  The clicker's 3MF: centred on the plate the customer picked, and stamped with its build.

    node apps/clicker-generator/tests/threemf-plate-build.test.mjs      (part of pnpm test)

  src/export/threemfExport.ts gives the shelf's writer the two things only the app knows: the
  bed to centre the layout on (`plateSize`, for the plate the picker stored) and the build id
  (`VITE_BUILD_ID`, written into the file as `vl:build`). Leave either out and the file is still
  a valid 3MF, centred on an A1 whatever plate was picked, or calling itself a "dev" build, so
  no other test would notice.

  This bundles the exporter with a build id defined, stores the A1 mini as the picked plate the
  way the picker does, exports a top and a base, and reads the file back. It bundles through
  esbuild's API, not the command line, so the build id's definition is written here rather than
  quoted for whichever shell runs `pnpm test`.
*/
import { build } from 'esbuild';
import { unzipSync, strFromU8 } from 'fflate';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_ID = 'pin-test-build';
const PLATE = 'a1mini';

// The plate picker keeps its choice in localStorage, which node does not have.
const stored = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (stored.has(k) ? stored.get(k) : null),
    setItem: (k, v) => void stored.set(k, String(v)),
    removeItem: (k) => void stored.delete(k),
  },
});

const cacheDir = join(APP, 'node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
const outfile = join(cacheDir, `threemf-plate-build-${process.pid}.mjs`);
await build({
  stdin: {
    contents:
      "export { buildThreeMF } from './src/export/threemfExport.ts';\n" +
      "export { plateSize, savePlateChoice } from '@vostok/plates';\n",
    resolveDir: APP,
    sourcefile: 'threemf-plate-build-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  define: { 'import.meta.env': JSON.stringify({ VITE_BUILD_ID: BUILD_ID }) },
});
const app = await import(pathToFileURL(outfile).href);
rmSync(outfile, { force: true });

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** A tetrahedron with its corner at (x, y, z), as the worker sends a part. */
const tetra = (name, group, colorRgb, [x, y, z], s) => ({
  kind: 'cap',
  group,
  colorRgb,
  name,
  numProp: 3,
  vertProperties: new Float32Array([x, y, z, x + s, y, z, x, y + s, z, x, y, z + s]),
  triVerts: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
});
const parts = [
  tetra('top-base', 'top', [230, 60, 60], [-12, 7, 5], 24),
  tetra('base-body', 'base', [40, 40, 40], [-15, -9, 0], 30),
];

app.savePlateChoice(PLATE);
const files = unzipSync(app.buildThreeMF(parts));
const model = strFromU8(files['3D/3dmodel.model']);

// Where the layout lands on the bed: the XY box of every vertex in the file, moved by the
// build items' transform (one translation, shared by every item).
const xs = [];
const ys = [];
for (const m of model.matchAll(/<vertex x="([^"]+)" y="([^"]+)"/g)) {
  xs.push(Number(m[1]));
  ys.push(Number(m[2]));
}
const transforms = [...new Set([...model.matchAll(/<item [^>]*transform="([^"]+)"/g)].map((m) => m[1]))];
const [tx, ty] = (transforms[0] ?? '').split(' ').slice(9, 11).map(Number);
const centre = [(Math.min(...xs) + Math.max(...xs)) / 2 + tx, (Math.min(...ys) + Math.max(...ys)) / 2 + ty];
const [w, d] = app.plateSize(PLATE);
const want = [w / 2, d / 2];
const [aw] = app.plateSize('a1');

check('the A1 mini is a different bed from the A1, so a missing plate cannot pass unseen', Math.abs(aw - w) > 10, `${w} vs ${aw} mm`);
check('every build item shares one transform', transforms.length === 1, `${transforms.length} distinct`);
check(
  'the layout is centred on the A1 mini, the plate the picker stored',
  Math.abs(centre[0] - want[0]) < 1e-3 && Math.abs(centre[1] - want[1]) < 1e-3,
  `centre (${centre.map((n) => n.toFixed(3)).join(', ')}), plate centre (${want.join(', ')})`,
);
const vlBuild = model.match(/<metadata name="vl:build">([^<]*)<\/metadata>/)?.[1];
check('vl:build is the build id the bundle was given', vlBuild === BUILD_ID, `vl:build = ${JSON.stringify(vlBuild)}`);

console.log(fails.length ? `\n${fails.length} FAILED, ${pass} passed` : `\nall ${pass} plate and build checks pass`);
process.exit(fails.length ? 1 : 0);

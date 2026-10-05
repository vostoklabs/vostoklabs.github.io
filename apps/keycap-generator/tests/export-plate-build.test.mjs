/*
  The keycap's exports: the 3MF centred on the plate the customer picked, and both the 3MF and
  the OBJ stamped with the build they came from.

    node apps/keycap-generator/tests/export-plate-build.test.mjs      (part of pnpm test)

  src/export3mf.js gives the shelf's writer the bed to centre the keycap on (`plateSize`, for the
  plate the picker stored) and the build id (`VITE_BUILD_ID`, written into the file as
  `vl:build`); src/exportObj.js writes the same build id into the OBJ's header. Leave any of them
  out and the file is still valid, centred on an A1 whatever plate was picked, or calling itself
  a "dev" build, so no other test would notice.

  This bundles both writers twice, once with a build id defined and once without, stores the A1
  mini as the picked plate the way the picker does, and reads what they write. It bundles through
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
/** The two writers, the plate preference and three's box, bundled as the app's build would
 *  bundle them; `env` is what the bundle sees as `import.meta.env`, or nothing at all. */
async function load(name, env) {
  const outfile = join(cacheDir, `export-plate-build-${name}-${process.pid}.mjs`);
  await build({
    stdin: {
      contents:
        "export { keycapThreeMF } from './src/export3mf.js';\n" +
        "export { buildObjMtl } from './src/exportObj.js';\n" +
        "export { plateSize, savePlateChoice } from '@vostok/plates';\n" +
        "export { BoxGeometry } from 'three';\n",
      resolveDir: APP,
      sourcefile: 'export-plate-build-entry.js',
      loader: 'js',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'error',
    define: env ? { 'import.meta.env': JSON.stringify(env) } : {},
  });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outfile, { force: true });
  return mod;
}
const stamped = await load('stamped', { VITE_BUILD_ID: BUILD_ID });
const unstamped = await load('unstamped');

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** A keycap and its legend as the app hands them over: indexed three geometries, off-centre. */
const partsOf = (app) => [
  { name: 'Keycap', color: '#e8e4da', extruder: 1, geom: new app.BoxGeometry(18, 18, 8).translate(31, -17, 4) },
  { name: 'Legend', color: '#1d1d1f', extruder: 2, geom: new app.BoxGeometry(6, 9, 0.6).translate(31, -17, 8.3) },
];

// --- The 3MF ---------------------------------------------------------------------------------
stamped.savePlateChoice(PLATE);
const blob = stamped.keycapThreeMF(partsOf(stamped));
const model = strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))['3D/3dmodel.model']);

// Where the keycap lands on the bed: the XY box of every vertex in the file, moved by the
// build item's transform.
const xs = [];
const ys = [];
for (const m of model.matchAll(/<vertex x="([^"]+)" y="([^"]+)"/g)) {
  xs.push(Number(m[1]));
  ys.push(Number(m[2]));
}
const transforms = [...new Set([...model.matchAll(/<item [^>]*transform="([^"]+)"/g)].map((m) => m[1]))];
const [tx, ty] = (transforms[0] ?? '').split(' ').slice(9, 11).map(Number);
const centre = [(Math.min(...xs) + Math.max(...xs)) / 2 + tx, (Math.min(...ys) + Math.max(...ys)) / 2 + ty];
const [w, d] = stamped.plateSize(PLATE);
const want = [w / 2, d / 2];
const [aw] = stamped.plateSize('a1');

check('the A1 mini is a different bed from the A1, so a missing plate cannot pass unseen', Math.abs(aw - w) > 10, `${w} vs ${aw} mm`);
check('the 3MF has one transform for its build items', transforms.length === 1, `${transforms.length} distinct`);
check(
  'the 3MF is centred on the A1 mini, the plate the picker stored',
  Math.abs(centre[0] - want[0]) < 1e-3 && Math.abs(centre[1] - want[1]) < 1e-3,
  `centre (${centre.map((n) => n.toFixed(3)).join(', ')}), plate centre (${want.join(', ')})`,
);
const vlBuild = model.match(/<metadata name="vl:build">([^<]*)<\/metadata>/)?.[1];
check('the 3MF\'s vl:build is the build id the bundle was given', vlBuild === BUILD_ID, `vl:build = ${JSON.stringify(vlBuild)}`);

// --- The OBJ ---------------------------------------------------------------------------------
const buildLine = (app) => app.buildObjMtl(partsOf(app)).obj.split('\n').find((l) => l.startsWith('# Build:'));
const withId = buildLine(stamped);
const withoutId = buildLine(unstamped);
check('the OBJ header names the build id the bundle was given', withId === `# Build: ${BUILD_ID}`, JSON.stringify(withId));
check('the OBJ header says "dev" when no build id was given', withoutId === '# Build: dev', JSON.stringify(withoutId));

console.log(fails.length ? `\n${fails.length} FAILED, ${pass} passed` : `\nall ${pass} plate and build checks pass`);
process.exit(fails.length ? 1 : 0);

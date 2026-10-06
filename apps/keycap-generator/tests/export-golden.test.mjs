/*
  The keycap's export golden: fifty settings and the alphabet set's twenty-six letters, and every
  file the export writes for each one.

    node apps/keycap-generator/tests/export-golden.test.mjs            (part of pnpm test)
    node apps/keycap-generator/tests/export-golden.test.mjs --record   write tests/golden/export-golden.json again

  Each case is a profile, a size, a legend (a Lucide icon, letters in three fonts, an SVG) and the
  options the panel offers: depth, rotation, nudge, mirror, shine-through, single colour, homing
  bump, stem fit, colours and the wall setting. Every case is carved and exported the way the app
  does it, and the test keeps:

  - a hash of every entry in the 3MF (3dmodel.model, project_settings.config and the rest), with
    the build id and the creation date written over, since those change on every build and day;
  - a hash of the OBJ and of the MTL, the files the MakerLab export hands the host, likewise;
  - per part: its triangles and vertices, whether it is watertight (every edge shared by exactly
    two triangles, once each way round), its volume and its box.

  So a change that should not move a file proves it with identical hashes, and one that should
  says which files moved and by how much. Recording is a decision: write down in the commit why
  the files changed. That includes changes made elsewhere that reach these files: the shelf's 3MF
  and OBJ writers, the Bambu profile it embeds, the brand's URLs in the licence lines.

  What it runs is the app's own modules (keycap.js, logo.js, letter.js, geometry.js, manifold.js,
  stemClearance.js, fitTest.js, export3mf.js, exportObj.js), bundled as the app bundles them, and
  the parts and the file names come from exportParts.js, the module the app's exports go through,
  so what is tested is what ships.

  manifold-3d stays external, so node loads the npm build itself, as fit-test.test.js does; the
  `?url` import manifold.js makes for Vite is answered with the path of that build's WASM. A share
  of the cases then runs again on the build the app ships (packages/manifold-noeval, which the
  Vite config aliases in), and must write the same files.
*/
import { build } from 'esbuild';
import { unzipSync, strFromU8 } from 'fflate';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = join(APP, 'tests', 'golden', 'export-golden.json');
const RECORD = process.argv.includes('--record');

// ------------------------------------------------------------------ what the browser provides
// SVGLoader and the SVG style flattener parse markup with the DOM's parser.
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
// The plate picker keeps its choice in localStorage. Nothing stored: the default plate.
const stored = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (stored.has(k) ? stored.get(k) : null),
    setItem: (k, v) => void stored.set(k, String(v)),
    removeItem: (k) => void stored.delete(k),
  },
});
// The caps, the homing bump and the bundled fonts are fetched from public/, as the page does.
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
/* Two manifold builds: npm's manifold-3d, which the golden is recorded on, and the one the app
   ships, the CSP-safe rebuild vite.config.js aliases in (packages/manifold-noeval). The second
   runs a share of the cases below and must write the same files. */
const NOEVAL = resolve(APP, '..', '..', 'packages', 'manifold-noeval');
const MANIFOLD = {
  // npm's stays external, so node loads the package itself; the app's glue is bundled in.
  npm: { glue: null, wasm: createRequire(join(APP, 'package.json')).resolve('manifold-3d/manifold.wasm') },
  app: { glue: join(NOEVAL, 'manifold.js'), wasm: join(NOEVAL, 'manifold.wasm') },
};
const manifoldNode = ({ glue, wasm }) => ({
  name: 'manifold-node',
  setup(b) {
    b.onResolve({ filter: /^manifold-3d\/manifold\.wasm\?url$/ }, () => ({ path: 'wasm', namespace: 'manifold-wasm-url' }));
    b.onLoad({ filter: /.*/, namespace: 'manifold-wasm-url' }, () => ({ contents: `export default ${JSON.stringify(wasm)};`, loader: 'js' }));
    b.onResolve({ filter: /^manifold-3d$/ }, () => (glue ? { path: glue } : { path: 'manifold-3d', external: true }));
  },
});

const cacheDir = join(APP, 'node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
/** The app's modules, bundled as the app bundles them, on one manifold build. */
async function loadApp(which) {
  const outfile = join(cacheDir, `export-golden-${which}-${process.pid}.mjs`);
  await build({
    stdin: {
      contents: [
        "export { loadKeycap } from './src/keycap.js';",
        "export { parseLogo } from './src/logo.js';",
        "export { parseLetter, loadBundledFonts } from './src/letter.js';",
        "export { LUCIDE_ICONS, buildSvg } from './src/lucideIcons.js';",
        "export { buildBodies } from './src/geometry.js';",
        "export { initManifold, getManifoldApi, geomToManifold, manifoldToGeom } from './src/manifold.js';",
        "export { applyStemClearance } from './src/stemClearance.js';",
        "export { buildFitTestRow, computeFitTestLadder, FIT_TEST_STEP_MM, FIT_TEST_FONT_ID } from './src/fitTest.js';",
        "export { keycapThreeMF } from './src/export3mf.js';",
        "export { keycapObjMtl, keycapObjWriter } from './src/exportObj.js';",
        "export { objMaterials, buildMtl } from '@vostok/export';",
        "export { BoxGeometry } from 'three';",
        "export { capParts, orientForPrint, blankParts, fitTestParts, profileTag, capFileName, blankFileName, fitTestFileName, ALPHABET, ALPHABET_MTL } from './src/exportParts.js';",
      ].join('\n'),
      resolveDir: APP,
      sourcefile: 'export-golden-entry.js',
      loader: 'js',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'error',
    plugins: [manifoldNode(MANIFOLD[which])],
    define: { __KEYCAP_ARTWORK__: 'false' },
  });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outfile, { force: true });
  return mod;
}
const app = await loadApp('npm');

// ------------------------------------------------------------------ legends
/** Original drawings for this test. The first is how an illustration program writes a file:
 *  paint in a <style> block and a style attribute (the CSS a strict policy blocks, so it must be
 *  flattened into attributes), a white artboard behind it (dropped), an outline drawn as a stroke
 *  and a filled shape with a hole. The second is plain fills: curves, an arc cut out as a hole,
 *  and a rotated square inside it. */
const SVGS = {
  styled: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><style>.ring{fill:none;stroke:#000;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.ink{fill:#1d1d1f}</style></defs>
  <rect width="64" height="64" fill="#fff"/>
  <g transform="translate(2 2)">
    <circle class="ring" cx="30" cy="30" r="22"/>
    <path class="ink" fill-rule="evenodd" d="M30 14 L44 40 H16 Z M30 25 L36 36 H24 Z"/>
    <path style="fill:none;stroke:#000;stroke-width:3" d="M14 48 Q30 58 46 48"/>
  </g>
</svg>`,
  fills: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <path fill="#000" fill-rule="evenodd" d="M24 4 C35 4 44 13 44 24 C44 35 35 44 24 44 C13 44 4 35 4 24 C4 13 13 4 24 4 Z M24 12 A12 12 0 1 0 24.01 12 Z"/>
  <rect x="20" y="20" width="8" height="8" fill="#000" transform="rotate(45 24 24)"/>
</svg>`,
};

/** The three fonts the letters are cut in: a typeface JSON with a twin on the shelf (Roboto,
 *  still under the id it replaced), one with none (Droid Sans Mono, the fit test's font), and a
 *  bundled TTF (Pacifico, the face whose curves flatten worst). */
const FONTS = { roboto: 'helvetiker-regular', mono: 'droid-sans-mono-regular', pacifico: 'bundled-pacifico' };

const lucide = (name) => ({ kind: 'lucide', name });
const letter = (text, font) => ({ kind: 'letter', text, font });
const svg = (name) => ({ kind: 'svg', name });

// ------------------------------------------------------------------ the fifty settings
// Profiles: S standard, L low, T thocky, C Choc v1 (printed on its side, no homing bump, no
// shine-through, 1 mm deepest). `size` is the legend's mm, or the app's default for the cap
// (half the top's short side). Options left out are the panel's defaults.
const S = 'standard-profile', L = 'low-profile', T = 'thocky-profile', C = 'choc-v1';
const CASES = [
  // Standard 1u: the app as it opens, then one thing at a time.
  { id: 'S-1u-copy', profile: S, size: '1u', legend: lucide('copy') },
  { id: 'S-1u-heart-rot45', profile: S, size: '1u', legend: lucide('heart'), rot: 45 },
  { id: 'S-1u-command-nudged-deep', profile: S, size: '1u', legend: lucide('command'), offx: 1.5, offy: -1, depth: 0.8 },
  { id: 'S-1u-arrow-up-small', profile: S, size: '1u', legend: lucide('arrow-up'), mm: 5 },
  { id: 'S-1u-A-roboto', profile: S, size: '1u', legend: letter('A', 'roboto') },
  { id: 'S-1u-Esc-roboto', profile: S, size: '1u', legend: letter('Esc', 'roboto') },
  { id: 'S-1u-Q-mono', profile: S, size: '1u', legend: letter('Q', 'mono') },
  { id: 'S-1u-Fn-pacifico', profile: S, size: '1u', legend: letter('Fn', 'pacifico') },
  { id: 'S-1u-svg-styled', profile: S, size: '1u', legend: svg('styled') },
  { id: 'S-1u-svg-fills', profile: S, size: '1u', legend: svg('fills') },
  { id: 'S-1u-copy-mirror', profile: S, size: '1u', legend: lucide('copy'), mirror: true },
  { id: 'S-1u-copy-through', profile: S, size: '1u', legend: lucide('copy'), through: true },
  { id: 'S-1u-A-single', profile: S, size: '1u', legend: letter('A', 'roboto'), single: true },
  { id: 'S-1u-copy-homing', profile: S, size: '1u', legend: lucide('copy'), homing: true },
  { id: 'S-1u-F-homing-single', profile: S, size: '1u', legend: letter('F', 'roboto'), homing: true, single: true },
  { id: 'S-1u-copy-stem+0.2', profile: S, size: '1u', legend: lucide('copy'), stemTol: 0.2 },
  { id: 'S-1u-copy-stem-0.1', profile: S, size: '1u', legend: lucide('copy'), stemTol: -0.1 },
  { id: 'S-1u-copy-classic', profile: S, size: '1u', legend: lucide('copy'), walls: 'classic' },
  { id: 'S-1u-copy-same-colours', profile: S, size: '1u', legend: lucide('copy'), capColor: '#f7f7f5', logoColor: '#f7f7f5' },
  { id: 'S-1u-J-colours', profile: S, size: '1u', legend: letter('J', 'mono'), capColor: '#2b6cb0', logoColor: '#f6e05e' },
  // Standard, the other sizes.
  { id: 'S-1.25u-Ctrl-roboto', profile: S, size: '1_25u', legend: letter('Ctrl', 'roboto') },
  { id: 'S-1.5u-Tab-mono', profile: S, size: '1_5u', legend: letter('Tab', 'mono') },
  { id: 'S-1.75u-Caps-pacifico', profile: S, size: '1_75u', legend: letter('Caps', 'pacifico') },
  { id: 'S-2u-1stem-Bksp-roboto', profile: S, size: '2u-1stem', legend: letter('Bksp', 'roboto') },
  { id: 'S-2u-3stem-arrow-left-stem+0.1', profile: S, size: '2u-3stem', legend: lucide('arrow-left'), stemTol: 0.1 },
  { id: 'S-2.25u-Enter-through', profile: S, size: '2_25u', legend: letter('Enter', 'roboto'), through: true },
  { id: 'S-2.75u-Shift-mono', profile: S, size: '2_75u', legend: letter('Shift', 'mono') },
  { id: 'S-6.25u-svg-fills', profile: S, size: '6_25u-spacebar', legend: svg('fills'), mm: 12 },
  { id: 'S-1u-blank', profile: S, size: '1u', blank: true },
  { id: 'S-6.25u-blank', profile: S, size: '6_25u-spacebar', blank: true },
  { id: 'S-1u-fit-test', profile: S, size: '1u', fitTest: true },
  // Low profile.
  { id: 'L-1u-copy', profile: L, size: '1u', legend: lucide('copy') },
  { id: 'L-1u-A-pacifico-shallow', profile: L, size: '1u', legend: letter('A', 'pacifico'), depth: 0.3 },
  { id: 'L-1.5u-svg-styled-rot-90', profile: L, size: '1_5u', legend: svg('styled'), rot: -90 },
  { id: 'L-2u-3stem-Ent-stem-0.2', profile: L, size: '2u-3stem', legend: letter('Ent', 'mono'), stemTol: -0.2 },
  { id: 'L-6u-keyboard', profile: L, size: '6u-spacebar', legend: lucide('keyboard') },
  { id: 'L-1u-Z-single-mirror', profile: L, size: '1u', legend: letter('Z', 'roboto'), single: true, mirror: true },
  // Thocky.
  { id: 'T-1u-copy', profile: T, size: '1u', legend: lucide('copy') },
  { id: 'T-1u-A-homing', profile: T, size: '1u', legend: letter('A', 'roboto'), homing: true },
  { id: 'T-1.25u-svg-fills-through', profile: T, size: '1_25u', legend: svg('fills'), through: true },
  { id: 'T-2.25u-Shift-pacifico-stem+0.4', profile: T, size: '2_25u', legend: letter('Shift', 'pacifico'), stemTol: 0.4 },
  { id: 'T-6.5u-SPACE-roboto', profile: T, size: '6_5u-spacebar', legend: letter('SPACE', 'roboto') },
  // Choc v1: stands on its side on the plate.
  { id: 'C-1u-copy', profile: C, size: '1u', legend: lucide('copy') },
  { id: 'C-1u-A-roboto', profile: C, size: '1u', legend: letter('A', 'roboto') },
  { id: 'C-1u-Q-mono-single-deepest', profile: C, size: '1u', legend: letter('Q', 'mono'), single: true, depth: 1 },
  { id: 'C-1.5u-svg-styled', profile: C, size: '1_5u', legend: svg('styled') },
  { id: 'C-2u-Fn-pacifico-stem-0.2', profile: C, size: '2u', legend: letter('Fn', 'pacifico'), stemTol: -0.2 },
  { id: 'C-1u-heart-stem+0.1-mirror-rot30', profile: C, size: '1u', legend: lucide('heart'), stemTol: 0.1, mirror: true, rot: 30 },
  { id: 'C-1u-blank', profile: C, size: '1u', blank: true },
  { id: 'C-1u-fit-test', profile: C, size: '1u', fitTest: true },
];

/* The full alphabet set: what "Get full alphabet set (A–Z)" carves, a Standard 1u in the panel's
   settings, each letter read one character long. Every letter's 3MF is what the set's zip holds
   (stored as it is), and its OBJ is one of the plates the MakerLab export hands over. */
for (const ch of app.ALPHABET) {
  CASES.push({ id: `AZ-S-1u-roboto-${ch}`, profile: S, size: '1u', legend: { kind: 'alphabet', text: ch, font: 'roboto' } });
}

// ------------------------------------------------------------------ the app's state, per case
const index = JSON.parse(readFileSync(join(APP, 'public', 'keycaps', 'index.json'), 'utf8'));
const DEFAULTS = { depth: 0.5, rot: 0, offx: 0, offy: 0, stemTol: 0, capColor: '#161616', logoColor: '#f7f7f5', walls: 'arachne' };

/**
 * The cases, run on one bundle of the app: its manifold, fonts and caps loaded once. Returns
 * `run(case)`, which carves and exports one case and says what every file it writes is.
 */
async function harnessFor(app) {
  await app.initManifold();
  const api = app.getManifoldApi();
  await app.loadBundledFonts();
  const homingBumpGeom = (await app.loadKeycap('keycaps/homing-bump.json')).shellGeometry;

  /** One cap as mount.js's setKeycap() leaves it: the shell, and the stem run through Manifold
   *  once so it is a clean indexed solid. Cached: the app keeps the loaded cap too. */
  const caps = new Map();
  async function capFor(file) {
    if (caps.has(file)) return caps.get(file);
    const kc = await app.loadKeycap(file);
    let baseStem = null;
    if (kc.stemGeometry) {
      const m = app.geomToManifold(kc.stemGeometry);
      baseStem = app.manifoldToGeom(m);
      m.delete();
    }
    const cap = { shell: kc.shellGeometry, meta: kc.meta, baseStem };
    caps.set(file, cap);
    return cap;
  }

  /** mount.js applyStemTolerance(): the authored stem at 0, else the clearance if it held. */
  function stemAt(baseStem, tol) {
    if (!baseStem || Math.abs(tol) <= 1e-4) return baseStem;
    const r = app.applyStemClearance(api, baseStem, tol);
    return r.watertight ? r.geometry : baseStem;
  }

  async function legendFor(spec, unit) {
    if (spec.kind === 'lucide') {
      const ic = app.LUCIDE_ICONS.find((x) => x.name === spec.name);
      if (!ic) throw new Error(`no lucide icon "${spec.name}"`);
      return { ...app.parseLogo(app.buildSvg(ic.node)), name: ic.name };
    }
    if (spec.kind === 'svg') return { ...app.parseLogo(SVGS[spec.name]), name: spec.name };
    // The alphabet set reads each letter one character long.
    if (spec.kind === 'alphabet') return app.parseLetter(spec.text, FONTS[spec.font], 1);
    // mount.js letterMaxLen(): 4 characters on a 1u, more on a longer cap.
    return app.parseLetter(spec.text, FONTS[spec.font], Math.max(4, Math.round((unit || 1) * 4)));
  }

  /** The parts one case exports, and the MTL its OBJ names: built by src/exportParts.js, the
   *  module the app's own exports go through (the single cap, the blank, the fit test, A-Z). */
  async function exportParts(c) {
    const profile = index.profiles.find((p) => p.id === c.profile);
    const entry = profile.keycaps.find((k) => k.id === c.size);
    const { shell, meta, baseStem } = await capFor(entry.file);
    const o = { ...DEFAULTS, ...c };
    const stem = stemAt(baseStem, o.stemTol);
    const tag = app.profileTag(profile, index.profiles.length);

    if (c.fitTest) {
      const ladder = app.computeFitTestLadder(o.stemTol, app.FIT_TEST_STEP_MM, -0.4, 0.4);
      const pieces = app.buildFitTestRow(
        { api, baseStemGeometry: baseStem, meta, letterContour: (text) => app.parseLetter(text, app.FIT_TEST_FONT_ID, 6) },
        ladder,
      );
      return { parts: app.fitTestParts(pieces, o.capColor), mtlFileName: `${app.fitTestFileName(tag)}.mtl` };
    }

    if (c.blank) {
      return { parts: app.blankParts(shell, stem, o.capColor), mtlFileName: `${app.blankFileName(tag, entry.id)}.mtl` };
    }

    const legend = await legendFor(c.legend, entry.unit);
    const room = Math.min(meta.topExtent[0], meta.topExtent[1]);
    const widthMM = o.mm ?? Math.round(room * 0.5 * 10) / 10;
    const homing = !!o.homing && profile.homingBump !== false;
    const bodies = await app.buildBodies(shell, meta, legend, {
      widthMM,
      depth: o.depth,
      centerX: meta.center[0] + o.offx,
      centerY: meta.center[1] + o.offy,
      rotationDeg: o.rot,
      mirror: !!o.mirror,
      through: !!o.through,
      singleColor: !!o.single,
      homingBump: homing,
      homingBumpGeom: homingBumpGeom,
    });
    const parts = app.orientForPrint(
      app.capParts(bodies, { capColor: o.capColor, logoColor: o.logoColor, through: !!o.through, stem }),
      profile,
      meta,
    );
    const mtlFileName = c.legend.kind === 'alphabet' ? app.ALPHABET_MTL : `${app.capFileName(legend.name, tag)}.mtl`;
    return { parts, mtlFileName, walls: o.walls };
  }

  return async function run(c) {
    const { parts, mtlFileName, walls = 'arachne' } = await exportParts(c);
    // mount.js projectProcess(): Arachne is written as an override, Classic is the preset's own.
    const blob = app.keycapThreeMF(parts, { process: walls === 'classic' ? {} : { wall_generator: walls } });
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const files = {};
    for (const name of Object.keys(zip).sort()) {
      const bytes = zip[name];
      const text = /\.(model|config|txt|xml|rels)$/i.test(name) ? strFromU8(bytes) : null;
      files[name] = hash(text == null ? bytes : steady(text));
    }
    const { obj, mtl } = app.keycapObjMtl(parts, { mtlFileName });
    // The same parts, a part at a time through the writer a keyboard set streams its plates
    // with, must give the same OBJ and MTL.
    const materials = app.objMaterials();
    const writer = app.keycapObjWriter({ mtlFileName, materials });
    for (const p of parts) writer.add(p);
    if (writer.text !== obj || app.buildMtl(materials) !== mtl) streamDiffers.push(c.id);
    return {
      files,
      obj: hash(steady(obj)),
      mtl: hash(mtl),
      parts: parts.map((p) => ({ name: p.name, extruder: p.extruder, color: p.color, ...measure(p.geom) })),
    };
  };
}

/** Cases whose parts, streamed through keycapObjWriter, did not give keycapObjMtl's files. */
const streamDiffers = [];

// ------------------------------------------------------------------ what a file is
const hash = (data) => createHash('sha256').update(data).digest('hex').slice(0, 16);
/** The two things that differ between two runs of the same build: its id and today's date. */
const steady = (text) => text
  .replace(/<metadata name="vl:build">[^<]*<\/metadata>/g, '<metadata name="vl:build">BUILD</metadata>')
  .replace(/<metadata name="CreationDate">[^<]*<\/metadata>/g, '<metadata name="CreationDate">DATE</metadata>')
  .replace(/^(#? ?Build: ).*$/gm, '$1BUILD')
  .replace(/^(#? ?Created: ).*$/gm, '$1DATE');

const round = (n, d = 4) => Number(n.toFixed(d));

/** Triangles, vertices, watertight, volume and box of one part as written. */
function measure(geom) {
  const pos = geom.getAttribute('position').array;
  const idx = geom.getIndex().array;
  const nv = pos.length / 3;
  // Every directed edge exactly once, and its reverse exactly once.
  const edges = new Map();
  let degenerate = 0;
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t + k], b = idx[t + ((k + 1) % 3)];
      if (a === b) degenerate++;
      const key = a * nv + b;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let open = degenerate;
  for (const [key, n] of edges) {
    const a = Math.floor(key / nv), b = key % nv;
    if (n !== 1 || edges.get(b * nv + a) !== 1) open++;
  }
  let vol = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < min[k]) min[k] = pos[i + k];
      if (pos[i + k] > max[k]) max[k] = pos[i + k];
    }
  }
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
      - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
      + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return {
    tris: idx.length / 3,
    verts: nv,
    watertight: open === 0,
    volume: round(vol / 6),
    box: [...min, ...max].map((n) => round(n)),
  };
}

const run = await harnessFor(app);

// ------------------------------------------------------------------ run and compare
const started = Date.now();
const results = {};
for (const c of CASES) {
  const t0 = Date.now();
  results[c.id] = await run(c);
  if (process.env.GOLDEN_TIMES) console.log(`  ${c.id}: ${Date.now() - t0} ms`);
}
const seconds = ((Date.now() - started) / 1000).toFixed(1);

if (RECORD) {
  // One line per file and per part, so a re-recorded golden reads as a diff of what moved.
  const lines = ['{', ' "cases": {'];
  Object.entries(results).forEach(([id, r], i, all) => {
    lines.push(`  ${JSON.stringify(id)}: {`);
    lines.push('   "files": {');
    Object.entries(r.files).forEach(([n, h], j, f) => lines.push(`    ${JSON.stringify(n)}: ${JSON.stringify(h)}${j < f.length - 1 ? ',' : ''}`));
    lines.push('   },');
    lines.push(`   "obj": ${JSON.stringify(r.obj)},`);
    lines.push(`   "mtl": ${JSON.stringify(r.mtl)},`);
    lines.push('   "parts": [');
    r.parts.forEach((p, j) => lines.push(`    ${JSON.stringify(p)}${j < r.parts.length - 1 ? ',' : ''}`));
    lines.push('   ]');
    lines.push(`  }${i < all.length - 1 ? ',' : ''}`);
  });
  lines.push(' }', '}');
  mkdirSync(dirname(GOLDEN), { recursive: true });
  writeFileSync(GOLDEN, lines.join('\n') + '\n');
  console.log(`recorded ${CASES.length} cases in ${seconds} s -> ${GOLDEN}`);
  process.exit(0);
}

let failures = 0;
let pass = 0;
const fail = (msg) => { failures++; console.log(`FAIL ${msg}`); };

/*
  Parts known to leave the app open, which the golden records as they are. The blank export hands
  the writer the cap's shell as loaded: indexed, but with every face of the converted model on
  vertices of its own, so no edge is shared and a slicer sees a shell of loose faces. Take a case
  off this list when its export is welded; a listed part that comes out closed fails, so the list
  cannot outlive the bug.
*/
const KNOWN_OPEN = new Set(['S-1u-blank/Keycap', 'S-6.25u-blank/Keycap', 'C-1u-blank/Keycap']);

// Every other exported part is a closed solid, whatever the golden says.
for (const [id, r] of Object.entries(results)) {
  const wrong = r.parts.filter((p) => p.watertight === KNOWN_OPEN.has(`${id}/${p.name}`));
  if (!wrong.length) { pass++; continue; }
  for (const p of wrong) {
    fail(p.watertight
      ? `${id}: ${p.name} is watertight now; take "${id}/${p.name}" off KNOWN_OPEN`
      : `${id}: ${p.name} is not watertight`);
  }
}

const golden = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')).cases : null;
if (!golden) {
  fail(`no golden at ${GOLDEN}: run with --record`);
} else {
  for (const id of Object.keys(golden)) if (!results[id]) fail(`${id}: in the golden, no longer a case`);
  for (const [id, r] of Object.entries(results)) {
    const g = golden[id];
    if (!g) { fail(`${id}: a new case, not in the golden (--record)`); continue; }
    const moved = [];
    for (const name of new Set([...Object.keys(g.files), ...Object.keys(r.files)])) {
      if (g.files[name] !== r.files[name]) moved.push(name);
    }
    if (g.obj !== r.obj) moved.push('OBJ');
    if (g.mtl !== r.mtl) moved.push('MTL');
    const shape = JSON.stringify(g.parts) !== JSON.stringify(r.parts);
    if (!moved.length && !shape) { pass++; continue; }
    const detail = r.parts.map((p, i) => {
      const q = g.parts[i];
      if (!q) return `${p.name}: new part`;
      const dv = round(p.volume - q.volume);
      const db = Math.max(...p.box.map((v, k) => Math.abs(v - q.box[k])));
      return `${p.name}: volume ${dv >= 0 ? '+' : ''}${dv} mm3, box moved ${round(db)} mm, tris ${q.tris} -> ${p.tris}`;
    });
    if (g.parts.length !== r.parts.length) detail.push(`parts ${g.parts.length} -> ${r.parts.length}`);
    fail(`${id}: ${moved.length ? `files moved (${moved.join(', ')})` : 'parts measure differently'}\n       ${detail.join('\n       ')}`);
  }
}

/* The build the app ships against the one the golden is recorded on: one case of every kind (an
   icon, letters in each font, both drawings, shine-through, single colour, the homing bump, the
   stem fit both ways, each profile, the blank, both fit tests, a letter of the set) must write
   the same files and parts, to the byte, on both. */
const PARITY = [
  'S-1u-copy', 'S-1u-heart-rot45', 'S-1u-A-roboto', 'S-1u-Q-mono', 'S-1u-Fn-pacifico', 'S-1u-svg-styled',
  'S-1u-copy-through', 'S-1u-A-single', 'S-1u-copy-homing', 'S-1u-copy-stem+0.2', 'S-1u-copy-stem-0.1',
  'S-6.25u-svg-fills', 'S-1u-blank', 'S-1u-fit-test', 'L-2u-3stem-Ent-stem-0.2', 'T-2.25u-Shift-pacifico-stem+0.4',
  'C-1u-heart-stem+0.1-mirror-rot30', 'C-1u-fit-test', 'AZ-S-1u-roboto-Q',
];
const parityStarted = Date.now();
const runOnAppBuild = await harnessFor(await loadApp('app'));
const differs = [];
for (const id of PARITY) {
  const c = CASES.find((x) => x.id === id);
  if (!c) { fail(`parity: no case ${id}`); continue; }
  if (JSON.stringify(await runOnAppBuild(c)) !== JSON.stringify(results[id])) differs.push(id);
}
const paritySeconds = ((Date.now() - parityStarted) / 1000).toFixed(1);
if (differs.length) fail(`the app's manifold build writes different files from npm's manifold-3d: ${differs.join(', ')}`);
else {
  pass++;
  console.log(`the app's manifold build and npm's manifold-3d write the same files for ${PARITY.length} cases (${paritySeconds} s)`);
}

// ------------------------------------------------------------------ the keyboard set's writer
// The set streams its plates through keycapObjWriter, cap by cap, on one materials table for the
// whole export. Every case above went through it too and must write keycapObjMtl's files.
if (streamDiffers.length) fail(`streamed through keycapObjWriter, these cases write a different OBJ or MTL: ${streamDiffers.join(', ')}`);
else {
  pass++;
  console.log(`keycapObjWriter, a part at a time, writes keycapObjMtl's OBJ and MTL for every case`);
}
{
  // Two plates on one table: a cap and a legend in the cap's own colour on slots 1 and 2, then a
  // second legend in a third colour on slot 3.
  const box = (x, w) => new app.BoxGeometry(w, w, 2).translate(x, 0, 1);
  const materials = app.objMaterials();
  const plate1 = app.keycapObjWriter({ mtlFileName: 'set.mtl', materials });
  const plate2 = app.keycapObjWriter({ mtlFileName: 'set.mtl', materials });
  const emptyAtFirst = plate1.isEmpty && plate2.isEmpty;
  plate1.add({ name: 'k1_A_cap', color: '#161616', extruder: 1, geom: box(0, 18) });
  plate1.add({ name: 'k1_A_legend', color: '#161616', extruder: 2, geom: box(0, 6) });
  plate2.add({ name: 'k2_B_cap', color: '#161616', extruder: 1, geom: box(30, 18) });
  plate2.add({ name: 'k2_B_legend2', color: '#e53e3e', extruder: 3, geom: box(30, 6) });
  const mtl = app.buildMtl(materials);
  const names = [...mtl.matchAll(/^newmtl (\S+)$/gm)].map((m) => m[1]).join(',');
  const kd = [...mtl.matchAll(/^Kd (.+)$/gm)].map((m) => m[1]);
  const headed = [plate1.text, plate2.text].every((t) => t.startsWith('# Vostok Labs - Keycap') && /^# Build: /m.test(t) && /^mtllib set\.mtl$/m.test(t));
  const ok = emptyAtFirst && !plate1.isEmpty && !plate2.isEmpty
    && names === 'filament1,filament2,filament3' && kd[0] === kd[1] && kd[2] !== kd[0]
    && /usemtl filament1[\s\S]*usemtl filament2/.test(plate1.text) && /usemtl filament1[\s\S]*usemtl filament3/.test(plate2.text)
    && headed;
  if (ok) {
    pass++;
    console.log('two plates on one materials table: a material per filament slot (one colour on two slots stays two), empty until a part lands, each with the provenance header');
  } else {
    fail(`two plates on one materials table: empty at first ${emptyAtFirst}, materials ${names}, Kd ${kd.join(' / ')}, headers ${headed}`);
  }
}

console.log(
  failures
    ? `\n${failures} FAILED, ${pass} passed (${CASES.length} cases, ${seconds} s)`
    : `\nall ${CASES.length} keycap export cases match the golden and are watertight (${seconds} s)`,
);
process.exit(failures ? 1 : 0);

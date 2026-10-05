#!/usr/bin/env node
/*
  pnpm check:layers

  Which code may use which. The shelf is in layers, and imports only point down:

    app        an app: what this product is and how its screen is arranged
    ui         controls, windows and views, including a connector's own UI
    connector  how shapes get made: the laser job, the 3D-print file
    core       what things look like: shapes in millimetres, no machine, no screen

  - a core imports only cores (and @vostok/brand);
  - a connector imports cores and connectors;
  - UI imports anything on the shelf below it;
  - an app imports anything on the shelf, but never another app;
  - nobody reaches into another package or app by a relative path: a package is imported by its
    name, so its public entry is the only door;
  - a worker or a node test loads no font registry, not even through its own app's files (see
    the end of this file).

  ## Why this exists

  A core that learns about one machine, one screen or one app stops being reusable: the pattern
  engine labelling its results with laser operations is why a 3D app could not take it as it
  is. The arrows are cheap to check and expensive to undo, so they are checked on every commit.
  Type-only imports count too: a type is a promise about shape, and a core borrowing its basic
  type from a connector has its foundation in the wrong place.

  Each file's layer comes from LAYERS below: the longest matching path prefix wins. A new
  package gets a line here in the commit that creates it; the check fails until it has one.
*/

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { rel, abs, blankComments, appSourceFiles, packageSourceFiles, testFiles, privateBudgets } from './lib/source.mjs';

const LAYERS = [
  ['config/', 'config'],
  ['apps/', 'app'],
  ['packages/ui-kit/', 'ui'],
  ['packages/viewer/', 'ui'], // the 3D connector's view
  ['packages/plates/src/picker.ts', 'ui'],
  ['packages/plates/src/index.ts', 'ui'], // the front door also hands out the picker
  ['packages/patterns/src/ui/', 'ui'], // the pattern picker
  ['packages/patterns/', 'core'],
  ['packages/fonts/', 'core'],
  ['packages/manifold/', 'core'],
  ['packages/manifold-noeval/', 'core'],
  ['packages/watermark/', 'core'],
  ['packages/trace/', 'core'], // a picture or an SVG file into shapes
  ['packages/laser/src/ops.ts', 'connector'],
  ['packages/laser/src/sheets.ts', 'connector'],
  ['packages/laser/src/burn.ts', 'connector'],
  ['packages/laser/src/material-preview.ts', 'connector'],
  ['packages/laser/src/index.ts', 'connector'], // the front door hands out connector parts too; a core imports a subpath
  ['packages/laser/', 'core'], // shape maths, 2D booleans, blanks, keyring, text
  ['packages/export/', 'connector'],
  ['packages/plates/', 'connector'],
];

const MAY_IMPORT = {
  core: ['core', 'config'],
  connector: ['core', 'connector', 'config'],
  ui: ['core', 'connector', 'ui', 'config'],
  app: ['core', 'connector', 'ui', 'config'],
};

/*
  Already there when this check was written: wrong, unless its note says it is meant. A new one
  is a hard failure; fixing one is a deletion from this list.
*/
const KNOWN = new Set([
  // The ring type every laser core file builds on is defined in the export connector. It moves
  // to the shapes core when laser's and patterns' shape maths merge into one.
  'packages/laser/src/blanks.ts -> packages/export/src/index.ts',
  'packages/laser/src/csg2d.ts -> packages/export/src/index.ts',
  'packages/laser/src/rings.ts -> packages/export/src/index.ts',
  'packages/laser/src/text.ts -> packages/export/src/index.ts',
  'packages/laser/src/types.ts -> packages/export/src/index.ts',
  // Takes FONTS from the registry file directly, past the package's front door. The fix is a
  // './registry' subpath export in @vostok/fonts.
  'apps/foldbox/src/logoFonts.ts -> packages/fonts/src/registry.ts',
  // The font registry (see the end of this file). Laser Studio's geometry worker builds through
  // its engine, whose files take only shape maths from @vostok/laser's root, and the root
  // carries the text module. The fix is the subpaths in those files (@vostok/laser/rings,
  // /csg2d, /blanks, /keyring).
  'apps/laser-studio/src/engine/worker.ts -> ./build',
  // Meant: these tests are about the fonts or the text drawn with them, so they reach the
  // registry through the code they test, and their commands put the glob stand-in in place
  // (packages/fonts/tests/vite-glob-shim.mts).
  'apps/clicker-generator/tests/font-fallback.test.ts -> ../src/image/letter.ts',
  'packages/fonts/tests/coverage.test.mts -> ../src/index',
  'packages/fonts/tests/coverage.test.mts -> ../src/import',
  'packages/fonts/tests/import.test.mts -> ../src/index',
  'packages/fonts/tests/import.test.mts -> ../src/import',
  // Meant too, but the command in its header has no stand-in yet, so its bundle stops at load
  // ("glob is not a function"). font-fallback's header shows the command with it.
  'apps/clicker-generator/tests/text-sizing.test.ts -> ../src/image/letter.ts',
]);

/* Exceptions inside private files are listed privately (scripts/budgets.private.json,
   "layersKnown"), so no public file names a private one. */
const PRIVATE_KNOWN = new Set(privateBudgets().layersKnown ?? []);

function layerOf(relPath) {
  // Repo-level data beside the workspace, such as generators.json: readable from anywhere.
  if (!/^(apps|packages|config)\//.test(relPath)) return 'config';
  let best = null;
  for (const [prefix, layer] of LAYERS) if (relPath.startsWith(prefix) && (!best || prefix.length > best[0].length)) best = [prefix, layer];
  return best?.[1] ?? null;
}

/** The workspace packages by name: name -> { dir, exports }. */
function workspace() {
  const out = new Map();
  const add = (dir) => {
    const pj = join(dir, 'package.json');
    if (!existsSync(pj)) return;
    const meta = JSON.parse(readFileSync(pj, 'utf8'));
    if (meta.name) out.set(meta.name, { dir, exports: meta.exports ?? (meta.main ? { '.': meta.main } : {}) });
  };
  for (const group of ['packages', 'apps']) {
    const g = abs(group);
    if (existsSync(g)) for (const d of readdirSync(g)) add(join(g, d));
  }
  add(abs('config'));
  return out;
}
const WS = workspace();

function resolveFile(base) {
  for (const cand of [base, `${base}.ts`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.js')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  if (/\.js$/.test(base) && existsSync(base.replace(/\.js$/, '.ts'))) return base.replace(/\.js$/, '.ts');
  return null;
}

/** '@vostok/x/sub' -> its file, through the package's exports map. null when not ours or absent. */
function resolvePackage(spec) {
  const m = spec.match(/^(@[^/]+\/[^/]+)(?:\/(.+))?$/);
  if (!m || !WS.has(m[1])) return null;
  const { dir, exports } = WS.get(m[1]);
  const key = m[2] ? `./${m[2]}` : '.';
  const target = typeof exports[key] === 'string' ? exports[key] : exports[key]?.default;
  if (!target) return { dir, file: null };
  const file = join(dir, target);
  return { dir, file: existsSync(file) ? file : null };
}

const ownerOf = (relPath) => relPath.split('/').slice(0, 2).join('/'); // packages/x or apps/y

const IMPORT = /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

const problems = [];
const seenKnown = new Set();
const files = [...appSourceFiles().map((f) => f.file), ...packageSourceFiles().map((f) => f.file)];

for (const file of files) {
  const from = layerOf(file);
  if (!from) {
    problems.push(`${file}: no layer. Add its package to LAYERS in scripts/check-layers.mjs.`);
    continue;
  }
  const src = blankComments(readFileSync(abs(file), 'utf8'));
  for (const m of src.matchAll(IMPORT)) {
    const spec = m[1] ?? m[2];
    let target = null;
    if (spec.startsWith('.')) {
      const hit = resolveFile(resolve(dirname(abs(file)), spec));
      if (!hit) continue;
      target = rel(hit);
      if (ownerOf(target) !== ownerOf(file) && layerOf(target) !== 'config') {
        const key = `${file} -> ${target}`;
        if (KNOWN.has(key) || PRIVATE_KNOWN.has(key)) {
          seenKnown.add(key);
          continue;
        }
        problems.push(`${file}: reaches into ${ownerOf(target)} by a relative path ("${spec}"). Import it by its package name.`);
        continue;
      }
    } else {
      const pkg = resolvePackage(spec);
      if (!pkg) continue; // third-party
      if (!pkg.file) continue; // a private entry that is absent here
      target = rel(pkg.file);
      if (target.startsWith('apps/')) {
        problems.push(`${file}: imports the app ${ownerOf(target)}. Apps share through the shelf, never with each other.`);
        continue;
      }
    }
    const to = layerOf(target);
    if (!to || to === from && ownerOf(target) === ownerOf(file)) continue;
    if (from === 'app' && to === 'app') {
      problems.push(`${file}: imports another app (${target}). Apps share through the shelf, never with each other.`);
      continue;
    }
    if (!MAY_IMPORT[from]?.includes(to)) {
      const key = `${file} -> ${target}`;
      if (KNOWN.has(key) || PRIVATE_KNOWN.has(key)) {
        seenKnown.add(key);
        continue;
      }
      problems.push(`${file} (${from}) imports ${target} (${to}). A ${from} may import only ${MAY_IMPORT[from].join(', ')}.`);
    }
  }
}

/* ------------------------------------------------------------ the font registry */

/*
  A worker or a node test never loads the font registry.

  `@vostok/fonts` loads every font file through Vite's `import.meta.glob`, and the root of
  `@vostok/laser` reaches it through its text module. A worker loading either carries the
  whole registry in its bundle, and a node test cannot run it without a stand-in for the glob;
  the subpaths (`@vostok/laser/csg2d`, `/rings`, `/blanks`...) load none of it. Which entries
  load it is read from the import graph, so a package that starts loading the fonts is caught
  without an edit here. Each of the file's own imports is followed through every file it
  loads, its own app's included: a worker importing `./build`, which imports `@vostok/laser`,
  carries the registry as surely as one importing `@vostok/laser` itself.

  A worker is a `*.worker.*` file, a file in `src/workers/`, or the target of a
  `new Worker(new URL('<path>', import.meta.url))`, which is how Vite is told to bundle one.
  An import that brings in only types (`import type`, or braces holding only `type` names) is
  erased at build, so it loads nothing. (`verbatimModuleSyntax` would keep the second form as
  `import {} from`; no tsconfig here sets it.)

  Exceptions go in KNOWN (or "layersKnown" in the private budgets) as "<file> -> <import>",
  the import being the file's own one that leads to the registry.
*/
const FONT_REGISTRY = resolvePackage('@vostok/fonts')?.file ?? null;
const isCodeFile = (f) => /\.[cm]?[jt]sx?$/.test(f);

/** Whether a statement imports only types (`import type`, or braces holding only `type` names). */
function typeOnly(statement) {
  if (/^(?:import|export)\s+type\b/.test(statement)) return true;
  const braces = statement.match(/^(?:import|export)\s*\{([^}]*)\}\s*from\b/);
  const names = braces ? braces[1].split(',').map((n) => n.trim()).filter(Boolean) : [];
  return names.length > 0 && names.every((n) => /^type\s/.test(n));
}

const importsOf = new Map(); // file -> [spec, target] for each code file it imports for its values
function valueImports(file) {
  if (!importsOf.has(file)) {
    const out = [];
    for (const m of blankComments(readFileSync(file, 'utf8')).matchAll(IMPORT)) {
      if (typeOnly(m[0])) continue;
      const spec = m[1] ?? m[2];
      const target = spec.startsWith('.') ? resolveFile(resolve(dirname(file), spec)) : resolvePackage(spec)?.file;
      if (target && isCodeFile(target)) out.push([spec, target]);
    }
    importsOf.set(file, out);
  }
  return importsOf.get(file);
}

const fontChains = new Map(); // file -> the shortest chain of files from it to the registry, or null
function fontChain(entry) {
  if (!fontChains.has(entry)) {
    const parent = new Map([[entry, null]]);
    const queue = [entry];
    let hit = null;
    while (queue.length && !hit) {
      const file = queue.shift();
      if (file === FONT_REGISTRY) hit = file;
      else for (const [, t] of valueImports(file)) if (!parent.has(t)) parent.set(t, file), queue.push(t);
    }
    const chain = [];
    for (let f = hit; f; f = parent.get(f)) chain.unshift(rel(f));
    fontChains.set(entry, hit ? chain : null);
  }
  return fontChains.get(entry);
}

const NEW_WORKER = /\bnew\s+Worker\s*\(\s*new\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
const workers = new Set(files.filter((f) => /\.worker\.[cm]?[jt]sx?$/.test(f) || /\/src\/workers\//.test(f)));
for (const file of files) {
  for (const m of blankComments(readFileSync(abs(file), 'utf8')).matchAll(NEW_WORKER)) {
    const target = resolveFile(resolve(dirname(abs(file)), m[1]));
    if (target) workers.add(rel(target));
  }
}
const tests = testFiles();
const fontProblems = [];
for (const file of FONT_REGISTRY ? [...workers, ...tests] : []) {
  for (const [spec, target] of valueImports(abs(file))) {
    const chain = fontChain(target);
    if (!chain) continue;
    const key = `${file} -> ${spec}`;
    if (KNOWN.has(key) || PRIVATE_KNOWN.has(key)) {
      seenKnown.add(key);
      continue;
    }
    fontProblems.push(`${file} imports ${spec}, which loads the font registry (${chain.join(' > ')}).`);
  }
}

if (problems.length) {
  console.error('\nLayers: an import points the wrong way.\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nCores know nothing about machines, screens or apps; connectors nothing about apps. When a core');
  console.error('seems to need something from above, that knowledge belongs in the layer above, passed down as an option.\n');
}
if (fontProblems.length) {
  console.error('\nLayers: a worker or a node test loads the font registry.\n');
  for (const p of fontProblems) console.error(`  ${p}`);
  console.error('\nThe registry loads every font through import.meta.glob: a worker carries all of them in its bundle,');
  console.error('and a node test cannot run it without a stand-in. Where the chain enters a package by its root, import');
  console.error('the subpath that file needs instead (@vostok/laser/csg2d, @vostok/laser/rings, @vostok/fonts/textLayout...).\n');
}
if (problems.length || fontProblems.length) process.exit(1);
const fixed = [...KNOWN, ...PRIVATE_KNOWN].filter((k) => !seenKnown.has(k));
if (fixed.length) {
  console.log('\nLayers: ground gained. Drop these from KNOWN in scripts/check-layers.mjs (or layersKnown in scripts/budgets.private.json):\n');
  for (const k of fixed) console.log(`  ${k}`);
  console.log('');
}
console.log(
  `layers ok — ${files.length} files; ${seenKnown.size} known exceptions; ` +
    `no font registry in ${workers.size} workers or ${tests.length} node test files`,
);

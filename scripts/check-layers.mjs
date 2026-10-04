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
    name, so its public entry is the only door.

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
import { rel, abs, blankComments, appSourceFiles, packageSourceFiles, privateBudgets } from './lib/source.mjs';

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
  ['packages/laser/src/ops.ts', 'connector'],
  ['packages/laser/src/sheets.ts', 'connector'],
  ['packages/laser/src/burn.ts', 'connector'],
  ['packages/laser/src/material-preview.ts', 'connector'],
  ['packages/laser/src/index.ts', 'connector'], // the front door hands out connector parts too; a core imports a subpath
  ['packages/laser/', 'core'], // shape maths, 2D booleans, blanks, keyring, text, the tracers
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
  Already wrong when this check was written. A new one is a hard failure; fixing one is a
  deletion from this list.
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

if (problems.length) {
  console.error('\nLayers: an import points the wrong way.\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nCores know nothing about machines, screens or apps; connectors nothing about apps. When a core');
  console.error('seems to need something from above, that knowledge belongs in the layer above, passed down as an option.\n');
  process.exit(1);
}
const fixed = [...KNOWN, ...PRIVATE_KNOWN].filter((k) => !seenKnown.has(k));
if (fixed.length) {
  console.log('\nLayers: ground gained. Drop these from KNOWN in scripts/check-layers.mjs (or layersKnown in scripts/budgets.private.json):\n');
  for (const k of fixed) console.log(`  ${k}`);
  console.log('');
}
console.log(`layers ok — ${files.length} files; ${seenKnown.size} known exceptions`);

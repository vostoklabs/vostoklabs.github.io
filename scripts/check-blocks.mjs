#!/usr/bin/env node
/*
  pnpm check:blocks

  An app re-writing something the shelf already has. `check:ui` keeps hand-built controls out of
  the apps; this does the same one level down, for the engines and the plumbing.

  ## Why this exists

  The packages had a 3D viewer, a 3MF writer, an image tracer and a settings sync, and the apps
  had their own anyway: five private viewers, five forked 3MF writers, four tracer copies, a
  local `syncControls` in seven apps, `signedArea` written ten times. Each copy was written in
  good faith, by someone who did not know the shelf had it, and each one stopped receiving the
  fixes the shared block got. Nothing failed, so nothing stopped the next one.

  ## What it counts, per app (app code = each app's `src/`)

  - `shadow`: a function (or an UPPER_CASE constant) defined in the app under the name of
    something the shelf exports, per the packages' catalogue.json files. A local `processImage`
    is a tracer copy; a local `syncControls` is the settings sync re-derived. Names too generic
    to mean the same thing (`rect`, `section`...) are left out, listed in GENERIC below.
  - `viewer`: a three.js renderer built in the app. The 3D viewer is `createViewer()`.
  - `fileformat`: a 3MF or OBJ file assembled in the app. Those are `@vostok/export`'s.
  - `fonts`: fonts loaded by the app itself (FontFace, three.js font loaders). Fonts come from
    `@vostok/fonts`, so every font the customer sees is one the licence check has cleared.
  - `worker`: a worker started without `workerClient()`, i.e. hand-rolled request plumbing.
  - `project`: save/load written by hand, as a named function or inline (a JSON blob for a
    download link, a FileReader's result parsed as JSON). Saving is `downloadFile()`
    (`@vostok/export`), reading is `readProjectFile()` (`@vostok/ui-kit`).
  - `store`: a hand-written state store. The kit's is `createStore()` ("State store").

  **Ratcheted per app**, like `check:ui`: a count may go down, never up, and when one falls the
  check prints the new number. An app with no budget starts at zero, so a new generator starts
  clean. Budgets for private apps live in `scripts/budgets.private.json` (gitignored) so that no
  public file names a private app; a published app's budget lives in BUDGET below.

  The answer to a failure is never a bigger budget. Import the block; if it does not fit, widen
  it with an option whose default leaves every existing user unchanged.
*/

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, rel, appSourceFiles, read, blankComments, ignored, uncommitted, privateApps, privateBudgets } from './lib/source.mjs';

/*
  The baselines for published apps, and the only numbers to edit here. A kind not listed is
  zero. Lower one when the check says so; never raise one.
  Written 2026-10-04, the day the check went in.
*/
const BUDGET = {
  'bubble-pop-generator': { shadow: 14, viewer: 1, fileformat: 2, worker: 1 },
  'clicker-generator': { shadow: 1, viewer: 1, fonts: 3, worker: 1 },
  'house-number': { shadow: 2, worker: 1 },
  hub: { shadow: 1 },
  'keycap-generator': { viewer: 1, fonts: 7 },
  'keychain-carabiner': { shadow: 2, worker: 1 },
  'laser-studio': { shadow: 1 },
  'magnet-generator': { shadow: 15, viewer: 1 },
  'name-keychain': { shadow: 4, viewer: 1, project: 2 },
  'pen-topper': { shadow: 1, worker: 1 },
};

/** Shelf names too generic to mean "a copy of that block" when an app defines them. */
const GENERIC = new Set([
  'num', 'str', 'bool', 'number', 'toggle', 'select', 'section', 'button', 'chip', 'popover', 'slider',
  'rect', 'slot', 'star', 'circle', 'arc', 'hexagon', 'roundedRect', 'rng', 'SIZE', 'GAP', 'TOUCH', 'TAU', 'SQRT3',
]);

/* ------------------------------------------------------------------ the shelf's names */

/**
 * name -> "Block name (package)", from every catalogue.json on disk, and the subset named by a
 * PUBLIC catalogue. A public file is only measured against public names: a private block is not
 * on a public clone's shelf, and counting it here would make a published app's number differ
 * between this checkout and CI.
 */
function shelfNames() {
  const names = new Map();
  const publicNames = new Set();
  const found = [];
  const pkgs = join(ROOT, 'packages');
  const walk = (dir, pkg) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, pkg);
      else if (e.name === 'catalogue.json') found.push({ file: p, pkg });
    }
  };
  if (existsSync(pkgs)) {
    for (const d of readdirSync(pkgs)) {
      const pj = join(pkgs, d, 'package.json');
      if (existsSync(pj)) walk(join(pkgs, d), JSON.parse(readFileSync(pj, 'utf8')).name);
    }
  }
  const privateCatalogues = ignored(found.map((f) => rel(f.file)));
  for (const { file, pkg } of found) {
    const isPublic = !privateCatalogues.has(rel(file));
    const cat = JSON.parse(readFileSync(file, 'utf8'));
    for (const b of cat.blocks ?? []) {
      for (const n of [...[].concat(b.use ?? []), ...[].concat(b.with ?? [])]) {
        if (GENERIC.has(n)) continue;
        names.set(n, `${b.name} (${pkg})`);
        if (isPublic) publicNames.add(n);
      }
    }
  }
  return { names, publicNames };
}

const { names: SHELF, publicNames: PUBLIC_SHELF } = shelfNames();

/* ------------------------------------------------------------------ counting */

const PATTERNS = {
  viewer: /\bnew\s+(?:THREE\.)?WebGLRenderer\s*\(/g,
  fileformat: /3dmodel\.model|\[Content_Types\]\.xml|\bmtllib\b/g,
  fonts: /\bnew\s+FontFace\s*\(|\b(?:FontLoader|TTFLoader)\b/g,
  project: /\b(?:function\s+|(?:const|let)\s+)(?:downloadJSON|loadJSON|saveProject|loadProject|exportProject|importProject)\b/g,
  store: /\b(?:function\s+|(?:const|let)\s+)createStore\b/g,
};

/*
  `project` written inline, with no function to name it: a JSON blob or data URL made for a
  download link, or a FileReader's result parsed as JSON. A hit inside a save/load function that
  PATTERNS.project already counted is that function's body, not a second copy, so it is skipped.
  (`JSON.parse(await file.text())` is left out: the font loaders read typeface JSON that way.)
*/
const PROJECT_INLINE =
  /\bnew\s+Blob\s*\(\s*\[\s*JSON\.stringify\b|\bdata:application\/json\b|\bJSON\.parse\(\s*(?:String\(\s*)?\(?[\w$.?!]+(?:\s+as\s+\w+\))?\.result\b/g;

/** The [start, end) of each body following a PATTERNS.project match, by brace matching. */
function namedProjectBodies(src) {
  const bodies = [];
  for (const m of src.matchAll(PATTERNS.project)) {
    let i = src.indexOf('{', m.index);
    if (i < 0) continue;
    const start = i;
    for (let depth = 0; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) break;
    }
    bodies.push([start, i + 1]);
  }
  return bodies;
}

const inlineProject = (src) => {
  const bodies = namedProjectBodies(src);
  return [...src.matchAll(PROJECT_INLINE)].filter((m) => !bodies.some(([a, b]) => m.index >= a && m.index < b)).length;
};

/** A definition whose value is a function, or any const for an UPPER_CASE name. */
const DEFINITION = /\bfunction\*?\s+([A-Za-z_$][\w$]*)\s*[(<]|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(async\s*)?(function\b|\([^()]*(?:\([^()]*\)[^()]*)*\)\s*(?::\s*[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)?/g;

const ADVICE = {
  shadow: 'import it from the shelf (pnpm catalogue <name>)',
  viewer: 'createViewer() from @vostok/viewer (3D viewer)',
  fileformat: 'buildThreeMF() / buildObj() from @vostok/export',
  fonts: '@vostok/fonts (Font library, Font import, Text to outlines)',
  worker: 'workerClient() + answerRequests() from @vostok/ui-kit (Worker requests)',
  project: 'save with downloadFile() (@vostok/export), read with readProjectFile() (@vostok/ui-kit): "Project file"',
  store: 'createStore() from @vostok/ui-kit (State store)',
};
const KINDS = ['shadow', 'viewer', 'fileformat', 'fonts', 'worker', 'project', 'store'];

/* A count from a private file (a private app, or the private folder of a published one) goes to
   that app's private budget, so a published app's number is the same here as on a public clone. */
const FILES = appSourceFiles();
const PRIVATE_FILES = ignored(FILES.map((f) => f.file));
const counts = { public: new Map(), private: new Map() }; // bucket -> app -> kind -> n
const where = []; // { bucket, app, kind, file, n, detail }
const bump = (app, kind, file, n, detail = '') => {
  if (!n) return;
  const bucket = PRIVATE_FILES.has(file) ? 'private' : 'public';
  const into = counts[bucket];
  if (!into.has(app)) into.set(app, {});
  const c = into.get(app);
  c[kind] = (c[kind] ?? 0) + n;
  where.push({ bucket, app, kind, file, n, detail });
};

for (const { file, app } of FILES) {
  const src = blankComments(read(file));
  for (const [kind, re] of Object.entries(PATTERNS)) bump(app, kind, file, (src.match(re) ?? []).length);
  bump(app, 'project', file, inlineProject(src));
  if (!/\bworkerClient\b/.test(src)) bump(app, 'worker', file, (src.match(/\bnew\s+Worker\s*\(/g) ?? []).length);

  const shadows = [];
  const shelf = PRIVATE_FILES.has(file) ? SHELF : PUBLIC_SHELF;
  for (const m of src.matchAll(DEFINITION)) {
    const name = m[1] ?? m[2];
    if (!shelf.has(name)) continue;
    const isFunction = m[1] !== undefined || m[4] !== undefined;
    if (isFunction || /^[A-Z][A-Z0-9_]+$/.test(name)) shadows.push(name);
  }
  bump(app, 'shadow', file, shadows.length, shadows.join(', '));
}

/* ------------------------------------------------------------------ budgets and report */

const PRIVATE_BUDGET = privateBudgets();
const budgets = {
  public: (app) => BUDGET[app] ?? {},
  private: (app) => PRIVATE_BUDGET[app]?.blocks ?? {},
};

if (process.argv.includes('--baseline')) {
  const table = (bucket) =>
    Object.fromEntries(
      [...counts[bucket].keys()].sort().map((app) => {
        const c = counts[bucket].get(app);
        return [app, Object.fromEntries(KINDS.filter((k) => c[k]).map((k) => [k, c[k]]))];
      }),
    );
  console.log('BUDGET (published code, scripts/check-blocks.mjs):');
  console.log(JSON.stringify(table('public'), null, 2).replace(/"([\w]+)":/g, '$1:').replace(/"/g, "'"));
  console.log('\nscripts/budgets.private.json, "blocks" of each app (its private files only):');
  console.log(JSON.stringify(table('private'), null, 2));
  process.exit(0);
}

const over = [];
const under = [];
for (const bucket of ['public', 'private']) {
  const known = bucket === 'public' ? Object.keys(BUDGET) : Object.keys(PRIVATE_BUDGET).filter((k) => PRIVATE_BUDGET[k]?.blocks);
  for (const app of new Set([...counts[bucket].keys(), ...known])) {
    for (const kind of KINDS) {
      const have = counts[bucket].get(app)?.[kind] ?? 0;
      const max = budgets[bucket](app)[kind] ?? 0;
      if (have > max) over.push({ bucket, app, kind, have, max });
      else if (have < max) under.push({ bucket, app, kind, have, max });
    }
  }
}

// First, and even when another count fails: in a tree several sessions share, someone else's
// unfinished file must not hide the budgets this change has freed.
if (under.length) {
  console.log('\nBlocks: ground gained. Lower these budgets:\n');
  for (const u of under) {
    const file = u.bucket === 'private' ? 'scripts/budgets.private.json' : 'scripts/check-blocks.mjs';
    console.log(`  ${u.app}.${u.kind}: ${u.max} -> ${u.have}   (${file})`);
  }
  console.log('');
}

if (over.length) {
  console.error('\nBlocks: an app re-writes something the shelf already has (or adds another copy of\none it does not have yet). A count went up.\n');
  for (const o of over) {
    console.error(`  ${o.app}${o.bucket === 'private' ? ' (private files)' : ''}  ${o.kind}: ${o.have} (budget ${o.max})  -> ${ADVICE[o.kind]}`);
    const fresh = uncommitted();
    const mine = where.filter((x) => x.bucket === o.bucket && x.app === o.app && x.kind === o.kind);
    // Uncommitted files first: in a shared tree the new copy is usually in someone's unfinished work.
    for (const w of [...mine.filter((x) => fresh.has(x.file)), ...mine.filter((x) => !fresh.has(x.file)).sort((a, b) => b.n - a.n)].slice(0, 6)) {
      const owners = o.kind === 'shadow' ? `  [${w.detail.split(', ').map((n) => `${n}: ${SHELF.get(n)}`).slice(0, 4).join('; ')}]` : '';
      console.error(`      ${String(w.n).padStart(3)}  ${w.file}${owners}${fresh.has(w.file) ? '   (uncommitted)' : ''}`);
    }
  }
  console.error('\nThe shelf is listed by `pnpm catalogue`. Import the block; if it does not fit, widen it with an');
  console.error('option whose default changes nothing for the apps already using it. Never raise a budget.\n');
  process.exit(1);
}

const total = (bucket, kind) => [...counts[bucket].values()].reduce((n, c) => n + (c[kind] ?? 0), 0);
console.log(
  `blocks ok (${privateApps().size} private apps) — published code: ${KINDS.map((k) => `${k} ${total('public', k)}`).join(', ')}` +
    `; private files: ${KINDS.map((k) => `${k} ${total('private', k)}`).join(', ')}`,
);

#!/usr/bin/env node
/*
  pnpm check:copies

  The same code in two places. `check:blocks` catches a copy by its NAME; this catches it by its
  CONTENT, however it was renamed: the clicker's tracer sitting line for line inside the shared
  package, the same store file in three apps, a whole package's worth of files copied into an app.

  ## How

  Each file is reduced to its meaningful lines: comments, blank lines, imports and lines of pure
  punctuation dropped, whitespace collapsed. Any run of WINDOW such lines that appears in two
  different owners (an app or a package) is a copy, and every line it covers is counted against
  each owner that holds it. Copies inside one owner are its own business and are not counted.

  **Ratcheted per owner**, like `check:ui`: the count of copied lines may go down, never up. A new
  app starts at zero. Budgets for private apps, and for the private parts of packages, are in
  `scripts/budgets.private.json` ("copies"); a public file's count only ever counts matches
  against other public files, so it is the same on a public clone as here.

  The way down is to delete the copy and import the shelf's block, not to edit the copy until
  it no longer matches. A copy that has been reworded is still a copy; it has just stopped
  being findable.
*/

import { readFileSync } from 'node:fs';
import { abs, blankComments, appSourceFiles, packageSourceFiles, ignored, uncommitted, privateBudgets } from './lib/source.mjs';

/** Lines in a row that have to match before it counts as a copy. */
const WINDOW = 12;

/*
  Copied lines per owner, published code only. Lower one when the check says so; never raise
  one. An owner not listed has a budget of zero. Written 2026-10-04.
*/
const BUDGET = {
  'apps/bubble-pop-generator': 1444,
  'apps/clicker-generator': 207,
  'apps/house-number': 37,
  'apps/keycap-generator': 67,
  'apps/keychain-carabiner': 15,
  'apps/laser-studio': 26,
  'apps/magnet-generator': 1595,
  'apps/name-keychain': 45,
  'apps/pen-topper': 24,
  'packages/laser': 13,
  'packages/patterns': 13,
  // The image tracer moved here from packages/laser (1012 there before); magnet and bubble-pop
  // still hold their own copies of it.
  'packages/trace': 955,
  'packages/ui-kit': 26,
  'packages/viewer': 18,
};

/* ------------------------------------------------------------------ reading */

const sources = [
  ...appSourceFiles().map(({ file, app }) => ({ file, owner: `apps/${app}` })),
  ...packageSourceFiles().map(({ file, pkg }) => ({ file, owner: `packages/${pkg}` })),
];
const privateFiles = ignored(sources.map((s) => s.file));

/** Two 32-bit hashes of a string, as one key. Collisions across both are not a practical concern. */
function hash(str) {
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = (Math.imul(b, 33) + c) >>> 0;
  }
  return [a, b];
}

const files = [];
for (const s of sources) {
  const raw = readFileSync(abs(s.file), 'utf8');
  if (/AUTO-GENERATED|@generated/.test(raw.slice(0, 400)) || /\.generated\./.test(s.file)) continue;
  const lines = [];
  blankComments(raw)
    .split(/\r?\n/)
    .forEach((line, i) => {
      const t = line.trim().replace(/\s+/g, ' ');
      if (!t || /^[\s{}()[\];,.]*$/.test(t)) return;
      if (/^import\b|^export\s+(\*|\{[^}]*\})\s+from\b|^export\s+type\s+\{/.test(t)) return;
      lines.push({ text: t, line: i + 1, h: hash(t) });
    });
  if (lines.length >= WINDOW) files.push({ ...s, private: privateFiles.has(s.file), lines });
}

/* ------------------------------------------------------------------ matching */

// window key -> [{ f, i }]
const windows = new Map();
files.forEach((file, f) => {
  for (let i = 0; i + WINDOW <= file.lines.length; i++) {
    let a = 0;
    let b = 0;
    for (let k = 0; k < WINDOW; k++) {
      const h = file.lines[i + k].h;
      a = (Math.imul(a, 31) + h[0]) >>> 0;
      b = (Math.imul(b, 131) + h[1]) >>> 0;
    }
    const key = `${a}:${b}`;
    let list = windows.get(key);
    if (!list) windows.set(key, (list = []));
    list.push({ f, i });
  }
});

// For each file, the lines it shares with each other file of another owner.
const shared = files.map(() => new Map()); // f -> (g -> Set(line index))
for (const list of windows.values()) {
  if (list.length < 2) continue;
  for (const x of list) {
    for (const y of list) {
      const fx = files[x.f];
      const fy = files[y.f];
      if (fx.owner === fy.owner) continue;
      // A public file only counts matches against public files, so the number is the same on a
      // public clone. A private file counts every match.
      if (!fx.private && fy.private) continue;
      let set = shared[x.f].get(y.f);
      if (!set) shared[x.f].set(y.f, (set = new Set()));
      for (let k = 0; k < WINDOW; k++) set.add(x.i + k);
    }
  }
}

/* ------------------------------------------------------------------ counting */

const PRIVATE = privateBudgets();
const bucketOf = (file) => (file.private ? 'private' : 'public');
const counts = { public: new Map(), private: new Map() }; // owner -> lines
const pairs = []; // { owner, file, other, n }
files.forEach((file, f) => {
  const all = new Set();
  for (const [g, set] of shared[f]) {
    for (const i of set) all.add(i);
    pairs.push({ owner: file.owner, file: file.file, other: files[g].file, n: set.size, bucket: bucketOf(file) });
  }
  if (!all.size) return;
  const c = counts[bucketOf(file)];
  c.set(file.owner, (c.get(file.owner) ?? 0) + all.size);
});

const allowed = (bucket, owner) => (bucket === 'public' ? BUDGET[owner] : PRIVATE.copies?.[owner]) ?? 0;

if (process.argv.includes('--baseline')) {
  const pub = Object.fromEntries([...counts.public].sort());
  const priv = Object.fromEntries([...counts.private].sort());
  console.log('BUDGET (published code, scripts/check-copies.mjs):');
  console.log(JSON.stringify(pub, null, 2).replace(/"([\w/@.-]+)":/g, "'$1':"));
  console.log('\nscripts/budgets.private.json, "copies":');
  console.log(JSON.stringify(priv, null, 2));
  process.exit(0);
}

const over = [];
const under = [];
for (const bucket of ['public', 'private']) {
  const owners = new Set([...counts[bucket].keys(), ...Object.keys(bucket === 'public' ? BUDGET : PRIVATE.copies ?? {})]);
  for (const owner of owners) {
    const have = counts[bucket].get(owner) ?? 0;
    const max = allowed(bucket, owner);
    if (have > max) over.push({ bucket, owner, have, max });
    else if (have < max) under.push({ bucket, owner, have, max });
  }
}

// First, and even when another count fails: in a tree several sessions share, someone else's
// unfinished file must not hide the budgets this change has freed.
if (under.length) {
  console.log('\nCopies: ground gained. Lower these budgets:\n');
  for (const u of under) console.log(`  ${u.owner}: ${u.max} -> ${u.have}   (${u.bucket === 'public' ? 'scripts/check-copies.mjs' : 'scripts/budgets.private.json'})`);
  console.log('');
}
if (over.length) {
  console.error('\nCopies: the same code now sits in more places than before.\n');
  const fresh = uncommitted();
  const isFresh = (p) => fresh.has(p.file) || fresh.has(p.other);
  for (const o of over) {
    console.error(`  ${o.owner}${o.bucket === 'private' ? ' (private files)' : ''}: ${o.have} copied lines (budget ${o.max})`);
    const mine = pairs.filter((x) => x.owner === o.owner && x.bucket === o.bucket);
    // Uncommitted files first: the new copy is usually there.
    for (const p of [...mine.filter(isFresh), ...mine.filter((x) => !isFresh(x)).sort((a, b) => b.n - a.n)].slice(0, 6)) {
      console.error(`      ${String(p.n).padStart(4)}  ${p.file}  =  ${p.other}${isFresh(p) ? '   (uncommitted)' : ''}`);
    }
  }
  console.error('\nDelete the copy and import the block from the shelf (pnpm catalogue). If the shelf does not have');
  console.error('it, move ONE copy into the right package and import it from both places. Never raise a budget.\n');
  process.exit(1);
}
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
console.log(`copies ok — ${files.length} files; ${sum(counts.public)} copied lines in published code, ${sum(counts.private)} in private`);

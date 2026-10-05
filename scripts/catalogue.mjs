#!/usr/bin/env node
/*
  The catalogue: every building block on the shelf, under a plain name.

    pnpm catalogue                 # write CATALOGUE.md (local, not committed) and print a summary
    pnpm catalogue svg wizard      # print the blocks matching every word
    pnpm check:catalogue           # fail when the catalogue and the packages disagree
    node scripts/catalogue.mjs --list   # every export, claimed or not (for writing entries)

  ## Why this exists

  The packages held a viewer, a 3MF writer, a tracer, a font chooser and a build loop, and apps
  kept writing their own anyway, because nothing said what was on the shelf. A list written by
  hand would have the same fate as the skills that described the kit: correct on the day, then
  quietly wrong. So the list is generated from the packages, and this script fails the build
  when they disagree:

  - every value a package exports is claimed by its `catalogue.json`, as a block, as part of a
    block, or as internal, so a new export cannot be added without a decision about it;
  - every name a catalogue claims is really exported, so a rename cannot leave a dead entry;
  - every block has a plain name (unique across the shelf), a category and a line saying what
    it is for, and every asset has a licence;
  - every UI block is shown in kit-demo. That one is ratcheted: the count of UI blocks missing
    from it may go down, never up.

  Descriptions are one line on purpose. The detail lives in the doc comment on the export, where
  it changes with the code. Where a package is private in part, that part's `catalogue.json`
  sits in the private folder beside it and is read when present.
*/

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { ROOT, rel as relRoot, blankComments, ignored } from './lib/source.mjs';

/*
  UI blocks missing from kit-demo. Lower it when the check says so; never raise it. A new UI
  block is shown in kit-demo in the same change that adds it.

  23 on 2026-10-04, the day the catalogue was written; 1 the same evening, when kit-demo gained
  the other 22 (the one left is the pattern picker, from a package kit-demo does not use).
*/
const KIT_DEMO_MISSING_BUDGET = 1;

/** The catalogue's sections, in reading order. A block's `category` is one of these keys. */
const CATEGORIES = {
  ui: 'UI blocks',
  section: 'Ready-made sections',
  behaviour: 'Behaviour',
  engine: 'Engines (cores)',
  laser: 'Laser connector',
  print3d: '3D-print connector',
  asset: 'Assets: fonts, icons, patterns',
};
const CATEGORY_NOTES = {
  ui: 'Controls and windows. Machine-neutral; every app builds its screen from these.',
  section: 'Groups of blocks that belong together, ready to drop into a panel.',
  behaviour: 'The invisible parts every app needs: building, saving, exporting, the licence.',
  engine: 'What things look like. They return shapes in millimetres and know nothing about machines or screens.',
  laser: 'How shapes become a laser job: cut, score and engrave, kerf, sheets, the cut file.',
  print3d: 'How shapes become a 3D print: solids, plates, the 3MF/STL/OBJ file, the 3D view.',
  asset: 'Fonts, icons and pattern libraries. Every one is cleared for commercial use; the licence is listed.',
};

/* ------------------------------------------------------------- reading the packages */

/** `./x` from `file` to a real `.ts` file, or null. */
function resolveModule(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [base, `${base}.ts`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.js')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  // `./x.js` written for a `.ts` source.
  if (/\.js$/.test(base) && existsSync(base.replace(/\.js$/, '.ts'))) return base.replace(/\.js$/, '.ts');
  return null;
}

const VALUE_DECL = /^export\s+(?:declare\s+)?(?:async\s+)?(function\*?|const|let|var|class|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm;
const LOCAL_DECL = (name) =>
  new RegExp(`^(?:export\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|enum|abstract\\s+class)\\s+${name}\\b`, 'm');

/** The doc comment right above line `line` (0-based) of `src`, first sentence only. */
function docAbove(src, index) {
  const before = src.slice(0, index).replace(/\s+$/, '');
  if (!before.endsWith('*/')) return '';
  const start = before.lastIndexOf('/**');
  if (start < 0) return '';
  const body = before
    .slice(start + 3, -2)
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter((l) => !l.startsWith('@'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = body.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : body).slice(0, 220);
}

const exportCache = new Map();

/**
 * Every value a module exports: name -> { file, doc }. Types and interfaces are not blocks and
 * are left out. Follows `export { a } from`, `export * from` and local `export { a }`.
 */
function valueExports(file, seen = new Set()) {
  if (exportCache.has(file)) return exportCache.get(file);
  if (seen.has(file)) return new Map();
  seen.add(file);
  const raw = readFileSync(file, 'utf8');
  const src = blankComments(raw);
  const out = new Map();

  for (const m of src.matchAll(VALUE_DECL)) {
    out.set(m[2], { file, doc: docAbove(raw, m.index) });
  }

  // export { a, b as c, type T } [from './x']
  for (const m of src.matchAll(/^export\s+(type\s+)?\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?/gm)) {
    if (m[1]) continue; // `export type { … }`
    const target = m[3] ? resolveModule(file, m[3]) : file;
    const inner = m[3] && target ? valueExports(target, seen) : null;
    for (const part of m[2].split(',')) {
      const p = part.trim();
      if (!p || /^type\s/.test(p)) continue;
      const [orig, alias] = p.split(/\s+as\s+/).map((s) => s.trim());
      const name = alias ?? orig;
      if (m[3]) {
        if (!target) {
          // Handed on from another package (`export { x } from '@vostok/y'`): a value of this
          // module too, unless written as a type. A relative path that is not here is a private
          // file absent from this checkout: skip it.
          if (!m[3].startsWith('.')) out.set(name, { file, doc: '' });
          continue;
        }
        if (inner.has(orig)) out.set(name, inner.get(orig));
        // A name that is only a type in the target is not a value: leave it out.
      } else {
        const d = LOCAL_DECL(orig).exec(src);
        if (d) out.set(name, { file, doc: docAbove(raw, d.index) });
        // `import { x } from …` then `export { x }`: an imported value handed on.
        else if (new RegExp(`^import\\s+\\{[^}]*(?<!type\\s)\\b${orig}\\b[^}]*\\}\\s*from`, 'm').test(src)) out.set(name, { file, doc: '' });
      }
    }
  }

  // export * from './x'
  for (const m of src.matchAll(/^export\s+\*\s+from\s*['"]([^'"]+)['"]/gm)) {
    const target = resolveModule(file, m[1]);
    if (target) for (const [k, v] of valueExports(target, seen)) if (!out.has(k)) out.set(k, v);
  }

  exportCache.set(file, out);
  return out;
}

/** Every workspace package on disk: its name, folder, and its entry points (code only). */
function readPackages() {
  const dir = join(ROOT, 'packages');
  const pkgs = [];
  for (const name of readdirSync(dir).sort()) {
    const pj = join(dir, name, 'package.json');
    if (!existsSync(pj)) continue;
    const meta = JSON.parse(readFileSync(pj, 'utf8'));
    const entries = [];
    const exp = meta.exports ?? (meta.main ? { '.': meta.main } : {});
    for (const [sub, target] of Object.entries(exp)) {
      const t = typeof target === 'string' ? target : target?.default ?? target?.import;
      if (!t || !/\.(ts|js)$/.test(t)) continue;
      const file = join(dir, name, t);
      // A private entry (gitignored source) is simply absent in a public clone.
      if (!existsSync(file)) continue;
      entries.push({ spec: sub === '.' ? meta.name : `${meta.name}/${sub.replace(/^\.\//, '')}`, file });
    }
    pkgs.push({ name: meta.name, dir: join(dir, name), entries });
  }
  return pkgs;
}

/** Every `catalogue.json` under a package folder. */
function catalogueFiles(pkgDir) {
  const found = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'catalogue.json') found.push(p);
    }
  };
  walk(pkgDir);
  return found.sort();
}

/** True when git ignores the file: a private part of a package, present only in the owner's folder. */
const isPrivate = (file) => ignored([relRoot(file)]).size > 0;

/* ------------------------------------------------------------- reading the apps */

/**
 * What each app imports from the shelf: app -> "package name" -> names. An app uses a block
 * when it IMPORTS it; a local function that happens to share the name is a copy, not a use,
 * and counting it would report the copies as adopters. App code = `src/`.
 */
function appImports() {
  const apps = new Map();
  const dir = join(ROOT, 'apps');
  for (const app of readdirSync(dir).sort()) {
    const src = join(dir, app, 'src');
    if (!existsSync(src)) continue;
    const byPkg = new Map();
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'node_modules') walk(p);
        } else if (/\.(ts|js)$/.test(e.name) && !e.name.endsWith('.d.ts')) {
          const text = blankComments(readFileSync(p, 'utf8'));
          const add = (pkg, name) => {
            if (!byPkg.has(pkg)) byPkg.set(pkg, new Set());
            if (name) byPkg.get(pkg).add(name);
          };
          const names = (list) => list.split(',').map((p) => p.trim().replace(/^type\s+/, '').split(/\s+as\s+|\s*:\s*/)[0].trim());
          // `import { a, b as c } from '@vostok/x/sub'`, and the re-export form.
          for (const m of text.matchAll(/\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"](@vostok\/[\w-]+)(?:\/[^'"]*)?['"]/g)) {
            for (const n of names(m[1])) add(m[2], n);
          }
          // Loaded lazily: `const { a } = await import('@vostok/x')`, or `import('@vostok/x').then((m) => m.a)`.
          for (const m of text.matchAll(/\{([^}]*)\}\s*=\s*await\s+import\(\s*['"](@vostok\/[\w-]+)/g)) {
            for (const n of names(m[1])) add(m[2], n);
          }
          for (const m of text.matchAll(/\bimport\(\s*['"](@vostok\/[\w-]+)[^'"]*['"]\s*\)([^;\n]{0,160})/g)) {
            for (const t of m[2].matchAll(/\.([A-Za-z_$][\w$]*)|\[['"]([A-Za-z_$][\w$]*)['"]\]/g)) {
              const n = t[1] ?? t[2];
              if (!['then', 'catch', 'finally'].includes(n)) add(m[1], n);
            }
          }
        }
      }
    };
    walk(src);
    apps.set(app, byPkg);
  }
  return apps;
}

/* ------------------------------------------------------------- putting it together */

const problems = [];
const problem = (msg) => problems.push(msg);

const packages = readPackages();
const blocks = [];
const listing = []; // for --list

for (const pkg of packages) {
  // name -> { entry spec(s), file, doc }
  const exported = new Map();
  for (const entry of pkg.entries) {
    for (const [name, info] of valueExports(entry.file)) {
      if (!exported.has(name)) exported.set(name, { ...info, specs: [] });
      exported.get(name).specs.push(entry.spec);
    }
  }

  const claimed = new Map(); // name -> where
  const claim = (name, where, catFile) => {
    if (!exported.has(name)) {
      problem(`${relRoot(catFile)}: "${name}" is not exported by ${pkg.name} (renamed or removed?)`);
      return;
    }
    if (claimed.has(name)) problem(`${relRoot(catFile)}: "${name}" is claimed twice (${claimed.get(name)} and ${where})`);
    claimed.set(name, where);
  };

  for (const catFile of catalogueFiles(pkg.dir)) {
    let cat;
    try {
      cat = JSON.parse(readFileSync(catFile, 'utf8'));
    } catch (e) {
      problem(`${relRoot(catFile)}: not valid JSON (${e.message})`);
      continue;
    }
    const priv = isPrivate(catFile);
    for (const b of cat.blocks ?? []) {
      const use = [].concat(b.use ?? []);
      const withs = [].concat(b.with ?? []);
      if (!b.name) problem(`${relRoot(catFile)}: a block has no name (${use.join(', ')})`);
      if (!CATEGORIES[b.category]) problem(`${relRoot(catFile)}: "${b.name}" has category "${b.category}"; use one of ${Object.keys(CATEGORIES).join(', ')}`);
      if (!b.for) problem(`${relRoot(catFile)}: "${b.name}" says nothing about what it is for`);
      if (use.length === 0) problem(`${relRoot(catFile)}: "${b.name}" names no export to use`);
      if (b.category === 'asset' && !b.licence) problem(`${relRoot(catFile)}: asset "${b.name}" has no licence`);
      for (const n of use) claim(n, `block "${b.name}"`, catFile);
      for (const n of withs) claim(n, `block "${b.name}" (with)`, catFile);
      const specs = exported.get(use[0])?.specs ?? [pkg.name];
      blocks.push({ ...b, use, with: withs, from: specs[0], alsoFrom: specs.slice(1), pkg: pkg.name, private: priv, catFile });
    }
    for (const n of cat.internal?.names ?? []) claim(n, 'internal', catFile);
  }

  for (const [name, info] of exported) {
    listing.push({ pkg: pkg.name, name, specs: info.specs, file: relRoot(info.file), doc: info.doc, claimed: claimed.get(name) ?? null });
    if (!claimed.has(name)) {
      problem(`${pkg.name}: "${name}" (${relRoot(info.file)}) has no catalogue entry. Add it to a catalogue.json in ${relRoot(pkg.dir)} as a block, as "with" of a block, or under "internal".`);
    }
  }
}

// Plain names are what Claude and Ian search by, so each means exactly one block.
const byName = new Map();
for (const b of blocks) {
  const k = (b.name ?? '').toLowerCase();
  if (byName.has(k)) problem(`two blocks are called "${b.name}" (${byName.get(k).pkg} and ${b.pkg}); a plain name must mean one block`);
  else byName.set(k, b);
}

// Who uses what: an app that imports any of the block's names from its package.
const apps = appImports();
const imports = (app, b, names = [...b.use, ...b.with]) => {
  const got = apps.get(app)?.get(b.pkg);
  return !!got && names.some((n) => got.has(n));
};
for (const b of blocks) {
  b.usedBy = [...apps.keys()].filter((app) => app !== 'kit-demo' && imports(app, b));
}

// kit-demo shows every public UI block: one of the block's own `use` names, not just a part.
const notInDemo = blocks.filter((b) => (b.category === 'ui' || b.category === 'section') && !b.private && !imports('kit-demo', b, b.use));

/* ------------------------------------------------------------- output */

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const LIST = args.includes('--list');
const words = args.filter((a) => !a.startsWith('--')).map((w) => w.toLowerCase());

if (LIST) {
  for (const l of listing) {
    console.log(`${l.claimed ? '  ' : '! '}${l.pkg.padEnd(18)} ${l.name.padEnd(30)} ${l.specs.join(' ')}  ${l.file}${l.doc ? `  — ${l.doc}` : ''}`);
  }
  process.exit(0);
}

if (CHECK) {
  const kitDemoBudgetOk = notInDemo.length <= KIT_DEMO_MISSING_BUDGET;
  if (problems.length || !kitDemoBudgetOk) {
    console.error('\nCatalogue: the catalogue and the packages disagree.\n');
    for (const p of problems) console.error(`  ${p}`);
    if (!kitDemoBudgetOk) {
      console.error(`\n  ${notInDemo.length} UI blocks are not shown in kit-demo (budget ${KIT_DEMO_MISSING_BUDGET}). Show the new one in apps/kit-demo:`);
      for (const b of notInDemo) console.error(`    ${b.name}  (${b.use[0]})`);
    }
    console.error('\nEvery export is a decision: a block (with a plain name and a line on what it is for), part of');
    console.error('a block ("with"), or "internal". The catalogue is how the next app finds it instead of writing it again.\n');
    process.exit(1);
  }
  if (notInDemo.length < KIT_DEMO_MISSING_BUDGET && Number.isFinite(KIT_DEMO_MISSING_BUDGET)) {
    console.log(`\nCatalogue: ground gained. In scripts/catalogue.mjs set KIT_DEMO_MISSING_BUDGET: ${KIT_DEMO_MISSING_BUDGET} -> ${notInDemo.length}\n`);
  }
  console.log(`catalogue ok — ${blocks.length} blocks in ${packages.length} packages; ${notInDemo.length} UI blocks not yet in kit-demo`);
  process.exit(0);
}

const importLine = (b) => `import { ${b.use.join(', ')} } from '${b.from}'`;

function render() {
  const out = [];
  out.push('# The shelf: every building block, by plain name');
  out.push('');
  out.push('Generated by `pnpm catalogue` from the `catalogue.json` beside each package. Do not edit by hand;');
  out.push('change the catalogue.json and run it again. Not committed: it lists private blocks too.');
  out.push('');
  out.push('**Before writing anything, find it here.** It exists: import it. It almost fits: widen the block');
  out.push('with an option whose default changes nothing for the apps already using it. It does not exist:');
  out.push('build it on the shelf first (kit for neutral UI, a connector for machine-specific work, a core for');
  out.push('geometry), add it to its catalogue.json, then use it. Never copy a block into an app.');
  out.push('');
  out.push('| Section | Blocks |');
  out.push('|---|---|');
  for (const [k, title] of Object.entries(CATEGORIES)) out.push(`| [${title}](#${title.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')}) | ${blocks.filter((b) => b.category === k).length} |`);
  out.push('');
  for (const [k, title] of Object.entries(CATEGORIES)) {
    const list = blocks.filter((b) => b.category === k).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) continue;
    out.push(`## ${title}`);
    out.push('');
    out.push(CATEGORY_NOTES[k]);
    out.push('');
    for (const b of list) {
      out.push(`### ${b.name}`);
      out.push('');
      out.push(b.for);
      out.push('');
      out.push(`- Use: \`${importLine(b)}\`${b.alsoFrom.length ? ` (also from \`${b.alsoFrom.join('`, `')}\`)` : ''}`);
      if (b.with.length) out.push(`- With: ${b.with.map((n) => `\`${n}\``).join(', ')}`);
      if (b.licence) out.push(`- Licence: ${b.licence}`);
      if (b.note) out.push(`- Note: ${b.note}`);
      out.push(`- Used by: ${b.usedBy.length ? b.usedBy.join(', ') : 'no app yet'}`);
      out.push('');
    }
  }
  const templates = existsSync(join(ROOT, 'apps')) ? readdirSync(join(ROOT, 'apps')).filter((a) => /template/.test(a)) : [];
  out.push('## Templates');
  out.push('');
  out.push('Where a new app starts: `pnpm new:generator <id> "Name" "one line"` copies the template.');
  out.push('');
  for (const t of templates) {
    const pj = join(ROOT, 'apps', t, 'package.json');
    const d = existsSync(pj) ? JSON.parse(readFileSync(pj, 'utf8')).description ?? '' : '';
    out.push(`- \`apps/${t}\`${d ? `: ${d}` : ''}`);
  }
  out.push('');
  return out.join('\n');
}

const text = render();
writeFileSync(join(ROOT, 'CATALOGUE.md'), text);

if (words.length) {
  const hits = blocks.filter((b) => {
    const hay = [b.name, b.for, b.note ?? '', ...b.use, ...b.with, CATEGORIES[b.category]].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  if (!hits.length) console.log(`No block matches "${words.join(' ')}". If it is genuinely missing, build it on the shelf first.`);
  for (const b of hits) {
    console.log(`\n${b.name}  [${CATEGORIES[b.category]}]`);
    console.log(`  ${b.for}`);
    console.log(`  ${importLine(b)}`);
    if (b.with.length) console.log(`  with: ${b.with.join(', ')}`);
    console.log(`  used by: ${b.usedBy.length ? b.usedBy.join(', ') : 'no app yet'}`);
  }
} else {
  console.log(`CATALOGUE.md written: ${blocks.length} blocks.`);
  for (const [k, title] of Object.entries(CATEGORIES)) console.log(`  ${String(blocks.filter((b) => b.category === k).length).padStart(3)}  ${title}`);
}
if (problems.length) console.log(`\n${problems.length} catalogue problem(s); run pnpm check:catalogue to see them.`);

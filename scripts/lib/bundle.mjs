/*
  What an app's build can contain, read from its source: the files its imports reach, and the
  third-party packages those files import. The asset check derives which apps carry an asset from
  this, and the third-party notices which libraries and asset sets an app has to name.

  A build starts at the app's own src/. From there an import reaches a file of the app, a package
  of ours through the entry its `exports` names, the files an `import.meta.glob` pattern matches,
  a `new URL(…, import.meta.url)`, or a stylesheet's @import and url(). Everything in the app's
  public/ is carried as it is. A bare specifier that is not ours names a third-party package, and
  the walk stops there: what a library brings is its own business.

  A re-export is followed only for the names asked of it, so importing one control from the
  kit's front door does not count the symbol catalog the same door also hands out: the bundler
  drops a module nothing uses, and the catalog is 190 KB that most apps never carry. A module
  that is reached at all counts whole, every import in it included. Libraries go by the whole
  module graph instead (`reach`), since a module the bundler keeps for its side effects keeps
  what it imports too. Either way the answer is "can the build contain it", not "does it": a
  branch the bundler drops, or a glob a build narrows (the fold-up box keeps only the faces under
  its budget), still counts. A spare notice costs nothing; a missing one is a licence not
  honoured. Type-only imports are skipped: the bundler erases them.

  A published app is walked through its published files only, so a public clone and the owner's
  checkout give the same answer for it. A private app is walked through everything on disk.
*/

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { builtinModules } from 'node:module';
import { rel, abs, blankComments, ignored, privateApps } from './source.mjs';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-offline', 'dist-mw', 'offline', 'tests', 'test', 'makerlab', 'vendor']);
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const STYLE = /\.css$/;
const NOT_BUNDLED = /\.d\.ts$|\.(?:test|check|spec)\.[cm]?[jt]sx?$/;
const BUILTIN = new Set(builtinModules);
/** Every export of a module: what a namespace import, a dynamic import or an entry asks for. */
const ALL = '*';

/** Every file under `dir` (repo-relative), build output and tests left out. */
function filesUnder(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) filesUnder(p, out);
    else out.push(rel(p));
  }
  return out;
}

let privateSet = null;
/** Whether git ignores a file of the apps or packages: one `git check-ignore` for all of them. */
function isPrivate(relPath) {
  if (!privateSet) {
    const candidates = [];
    for (const group of ['apps', 'packages']) {
      const g = abs(group);
      if (!existsSync(g)) continue;
      for (const d of readdirSync(g)) filesUnder(join(g, d), candidates);
    }
    privateSet = ignored(candidates);
  }
  return privateSet.has(relPath);
}

let workspaceMap = null;
/** Our packages by name: name -> { dir, exports }. */
function workspace() {
  if (!workspaceMap) {
    workspaceMap = new Map();
    const add = (dir) => {
      const pj = join(dir, 'package.json');
      if (!existsSync(pj)) return;
      const meta = JSON.parse(readFileSync(pj, 'utf8'));
      if (meta.name) workspaceMap.set(meta.name, { dir, exports: meta.exports ?? (meta.main ? { '.': meta.main } : {}) });
    };
    const pkgs = abs('packages');
    if (existsSync(pkgs)) for (const d of readdirSync(pkgs)) add(join(pkgs, d));
    add(abs('config'));
  }
  return workspaceMap;
}

/** A path as a module resolver takes it: as written, with a source extension, or a folder's index. */
function resolveFile(base) {
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, join(base, 'index.ts'), join(base, 'index.js')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  if (/\.js$/.test(base) && existsSync(base.replace(/\.js$/, '.ts'))) return base.replace(/\.js$/, '.ts');
  return null;
}

/** The package a bare specifier names: `@scope/name` or `name`. */
const packageName = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

const resolved = new Map();
/** A specifier, resolved: { file } for a file of ours, { lib } for a third-party package, or null. */
function resolveSpec(spec, fromFile) {
  const key = `${fromFile}\0${spec}`;
  if (!resolved.has(key)) resolved.set(key, resolveUncached(spec, fromFile));
  return resolved.get(key);
}

function resolveUncached(spec, fromFile) {
  const bare = spec.split('?')[0];
  if (!bare || bare.startsWith('/') || /^(?:virtual:|\0|data:|https?:|#)/.test(bare)) return null;
  if (bare.startsWith('.')) {
    const hit = resolveFile(resolve(dirname(abs(fromFile)), bare));
    return hit ? { file: rel(hit) } : null;
  }
  if (bare.startsWith('node:') || BUILTIN.has(packageName(bare))) return null;
  const name = packageName(bare);
  const ours = workspace().get(name);
  if (!ours) return { lib: name };
  const key = bare === name ? '.' : `./${bare.slice(name.length + 1)}`;
  const target = typeof ours.exports[key] === 'string' ? ours.exports[key] : ours.exports[key]?.default;
  const file = target ? join(ours.dir, target) : null;
  return file && existsSync(file) ? { file: rel(file) } : null;
}

/** The repo files a glob pattern matches from `fromFile`: `*` and `?` within a name, `**` across folders. */
function expandGlob(pattern, fromFile) {
  const parts = pattern.replace(/^!/, '').split('/');
  const fixed = [];
  while (parts.length > 1 && !/[*?{[]/.test(parts[0])) fixed.push(parts.shift());
  const base = resolve(dirname(abs(fromFile)), ...fixed);
  const name = (p) => p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  const re = new RegExp(`^${parts.map((p, i) => (p === '**' ? (i === parts.length - 1 ? '.*' : '(?:[^/]+/)*') : `${name(p)}${i < parts.length - 1 ? '/' : ''}`)).join('')}$`);
  return filesUnder(base).filter((f) => re.test(relative(base, abs(f)).split(sep).join('/')));
}

/** The names in a `{ a, b as c, type D }` list, as [imported, exported] pairs; types left out. */
function specifiers(list) {
  return list.split(',').map((s) => s.trim()).filter((s) => s && !/^type\s/.test(s)).map((s) => {
    const m = s.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
    return m ? [m[1], m[2] ?? m[1]] : null;
  }).filter(Boolean);
}

// Statements are matched where a statement starts, at the head of a line, so the word "import"
// at the end of a string is not read as one.
const STATIC_IMPORT = /^[ \t]*import\s+(type\s+)?([\w$*{}\s,]*?)\s*from\s*['"]([^'"]+)['"]|^[ \t]*import\s*['"]([^'"]+)['"]/gm;
const DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)|new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
const GLOBS = /import\.meta(?:\s+as\s+\w+\))?\.glob(?:<[^>]*>)?\(\s*(\[[^\]]*\]|['"][^'"]+['"])/g;
const REEXPORT = /^[ \t]*export\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm;
const STAR = /^[ \t]*export\s+\*\s*(?:as\s+([\w$]+)\s+)?from\s*['"]([^'"]+)['"]/gm;
const LOCAL = /^[ \t]*export\s+(?:declare\s+)?(?:default\b|(?:async\s+)?function\*?\s+([\w$]+)|(?:abstract\s+)?class\s+([\w$]+)|(?:const|let|var)\s+([\w$]+)|enum\s+([\w$]+)|(?:const|let|var)\s+\{([^}]*)\}|\{([^}]*)\}(?!\s*from))/gm;
const CSS_REFS = /@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)|url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g;

const parsed = new Map();
/** A module's imports, re-exports and own exports. */
function parse(file) {
  if (parsed.has(file)) return parsed.get(file);
  const text = blankComments(readFileSync(abs(file), 'utf8'));
  const out = { imports: [], reexports: [], stars: [], local: new Set(), refs: [] };
  if (STYLE.test(file)) {
    for (const m of text.matchAll(CSS_REFS)) out.refs.push({ spec: m[1] ?? m[2], names: ALL });
  } else {
    for (const m of text.matchAll(STATIC_IMPORT)) {
      if (m[1]) continue;
      if (m[4]) { out.imports.push({ spec: m[4], names: new Set() }); continue; }
      const clause = m[2];
      if (/\*\s*as\s/.test(clause)) { out.imports.push({ spec: m[3], names: ALL }); continue; }
      const names = new Set(specifiers(clause.match(/\{([^}]*)\}/)?.[1] ?? '').map(([imported]) => imported));
      if (/^\s*[\w$]+\s*(?:,|$)/.test(clause)) names.add('default');
      out.imports.push({ spec: m[3], names });
    }
    for (const m of text.matchAll(DYNAMIC)) out.refs.push({ spec: m[1] ?? m[2], names: ALL });
    for (const m of text.matchAll(GLOBS)) for (const q of m[1].matchAll(/['"]([^'"]+)['"]/g)) for (const f of expandGlob(q[1], file)) out.refs.push({ file: f, names: ALL });
    for (const m of text.matchAll(REEXPORT)) if (!m[1]) out.reexports.push({ spec: m[3], pairs: specifiers(m[2]) });
    for (const m of text.matchAll(STAR)) out.stars.push({ spec: m[2], as: m[1] ?? null });
    for (const m of text.matchAll(LOCAL)) {
      if (/^\s*export\s+(?:declare\s+)?default\b/.test(m[0])) out.local.add('default');
      for (const n of [m[1], m[2], m[3], m[4]]) if (n) out.local.add(n);
      for (const list of [m[5], m[6]]) if (list !== undefined) for (const [, exported] of specifiers(list)) out.local.add(exported);
    }
  }
  parsed.set(file, out);
  return out;
}

const exportsMemo = new Map();
/** Every name a module exports, through its re-exports and `export *` too. */
function exportedNames(file, seen = new Set()) {
  if (exportsMemo.has(file)) return exportsMemo.get(file);
  if (seen.has(file) || !CODE.test(file)) return new Set();
  seen.add(file);
  const p = parse(file);
  const names = new Set(p.local);
  for (const r of p.reexports) for (const [, exported] of r.pairs) names.add(exported);
  for (const s of p.stars) {
    if (s.as) { names.add(s.as); continue; }
    const hit = resolveSpec(s.spec, file);
    if (hit?.file) for (const n of exportedNames(hit.file, seen)) if (n !== 'default') names.add(n);
  }
  exportsMemo.set(file, names);
  return names;
}

/** The workspace folder a repo path belongs to: `apps/<id>` or `packages/<name>`. */
const ownerOf = (relPath) => relPath.split('/').slice(0, 2).join('/');

const reached = new Map();
/**
 * What `appId`'s build can contain.
 *
 *  - `files`: every repo file its imports reach by name, or that it carries in public/: code,
 *    styles, fonts, data. This is what an asset is carried by.
 *  - `libs`: each third-party package a file of the module graph imports, with the workspace
 *    folders whose files import it. The graph holds every module an import or re-export names,
 *    asked for or not: a module the bundler keeps for its side effects keeps what it imports
 *    too, and a library's own top-level code usually counts as one. A library outside the graph
 *    cannot be in the bundle at all.
 *
 * `withPrivate` walks a published app's gitignored files too: what its private builds can carry,
 * which differs between checkouts and so is only ever compared, never written.
 */
export function reach(appId, { withPrivate = false } = {}) {
  const memo = `${appId}${withPrivate ? ' +private' : ''}`;
  if (reached.has(memo)) return reached.get(memo);
  const walkAll = withPrivate || privateApps().has(appId);
  const allowed = (f) => walkAll || !isPrivate(f);
  const files = new Set();
  const graph = new Set();
  const libs = new Map();
  const asked = new Map(); // module -> names asked of it so far, or ALL
  const lib = (name, from) => {
    if (!libs.has(name)) libs.set(name, new Set());
    libs.get(name).add(ownerOf(from));
  };

  /** Put `file` in the graph, and everything it imports or re-exports, asked for or not. */
  const inGraph = (file) => {
    if (graph.has(file) || !allowed(file)) return;
    graph.add(file);
    if (!((CODE.test(file) && !NOT_BUNDLED.test(file)) || STYLE.test(file))) return;
    const p = parse(file);
    for (const ref of [...p.imports, ...p.refs, ...p.reexports, ...p.stars]) {
      const hit = ref.file ? { file: ref.file } : resolveSpec(ref.spec, file);
      if (hit?.lib) lib(hit.lib, file);
      else if (hit?.file) inGraph(hit.file);
    }
  };

  /** Reach `file`, asking it for `names` (a Set, or ALL). */
  const visit = (file, names) => {
    if (!allowed(file)) return;
    inGraph(file);
    const first = !files.has(file);
    files.add(file);
    if (!CODE.test(file) || NOT_BUNDLED.test(file)) {
      if (first && STYLE.test(file)) for (const r of parse(file).refs) follow(r, file);
      return;
    }
    const before = asked.get(file);
    if (before === ALL) return;
    const fresh = names === ALL ? ALL : new Set([...names].filter((n) => !before?.has(n)));
    if (!first && fresh !== ALL && !fresh.size) return;
    asked.set(file, fresh === ALL ? ALL : new Set([...(before ?? []), ...fresh]));
    const p = parse(file);
    if (first) {
      for (const i of p.imports) follow(i, file);
      for (const r of p.refs) follow(r, file);
    }
    const wants = (n) => fresh === ALL || fresh.has(n);
    for (const r of p.reexports) {
      const wanted = r.pairs.filter(([, exported]) => wants(exported)).map(([imported]) => imported);
      if (wanted.length) follow({ spec: r.spec, names: new Set(wanted) }, file);
    }
    for (const s of p.stars) {
      if (s.as) {
        if (wants(s.as)) follow({ spec: s.spec, names: ALL }, file);
        continue;
      }
      if (fresh === ALL) { follow({ spec: s.spec, names: ALL }, file); continue; }
      const hit = resolveSpec(s.spec, file);
      if (!hit?.file) continue;
      const theirs = exportedNames(hit.file);
      const wanted = [...fresh].filter((n) => n !== 'default' && theirs.has(n));
      if (wanted.length) visit(hit.file, new Set(wanted));
    }
  };
  const follow = (ref, from) => {
    if (ref.file) return visit(ref.file, ref.names);
    const hit = resolveSpec(ref.spec, from);
    if (hit?.file) visit(hit.file, ref.names);
  };

  for (const f of filesUnder(abs(`apps/${appId}/src`))) if ((CODE.test(f) && !NOT_BUNDLED.test(f)) || STYLE.test(f)) visit(f, ALL);
  for (const f of filesUnder(abs(`apps/${appId}/public`))) if (allowed(f)) files.add(f);
  const out = { files, libs };
  reached.set(memo, out);
  return out;
}

/** Every app with a package.json, in name order. */
export function appIds() {
  const appsDir = abs('apps');
  return existsSync(appsDir) ? readdirSync(appsDir).filter((id) => existsSync(join(appsDir, id, 'package.json'))).sort() : [];
}


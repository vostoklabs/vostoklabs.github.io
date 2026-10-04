/*
  What the repo's checks read, in one place: the source files, which app or package each belongs
  to, whether it is private, and the code with its comments blanked out.

  The checks read the DISK, not `git ls-files`. Private apps and private parts of packages are
  gitignored, so a git listing never shows them, and drift grew there unseen. On a public clone
  (CI) the private files are simply absent, so the same code checks exactly the public tree.
*/

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const posix = (p) => p.split(sep).join('/');
export const rel = (abs) => posix(relative(ROOT, abs));
export const abs = (relPath) => join(ROOT, relPath);

/** Comments replaced by spaces (line breaks kept, so line numbers survive); strings left whole. */
export function blankComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (c === '/' && n === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (c === '"' || c === "'" || c === '`') {
      // A whole string, so a `//` inside a URL or a regex-looking string is not a comment.
      let j = i + 1;
      while (j < src.length && src[j] !== c && !(c !== '`' && src[j] === '\n')) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-offline', 'dist-mw', 'offline', 'tests', 'test', 'makerlab', 'vendor', '.git']);
const CODE_FILE = (name) => /\.(ts|tsx|js|mjs)$/.test(name) && !name.endsWith('.d.ts') && !/\.(test|check|spec)\.[cm]?[jt]sx?$/.test(name);

/** Every file under `dir` that `keep` accepts (relative to the repo), skipping build output and tests. */
function walk(dir, out, keep = CODE_FILE) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out, keep);
    else if (keep(e.name)) out.push(rel(p));
  }
  return out;
}

/**
 * Every private (gitignored) file under apps/ and packages/ that `keep` accepts: the private
 * apps and the private folders of published ones. Git names the ignored folders and the disk is
 * walked only inside them, which keeps this fast (listing every ignored file walks node_modules).
 */
export function privateFiles(keep = (name) => /\.(ts|tsx|js|mjs|css|html)$/.test(name) && !name.endsWith('.d.ts')) {
  let listed;
  try {
    listed = execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory', 'apps', 'packages'], { cwd: ROOT, encoding: 'utf8' });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of listed.split(/\r?\n/)) {
    if (!entry || entry.split('/').some((part) => SKIP_DIRS.has(part))) continue;
    if (entry.endsWith('/')) walk(abs(entry), out, keep);
    else if (keep(entry.split('/').pop())) out.push(entry);
  }
  return out;
}

/** App code: each app's `src/`. Returns [{ file, app }]. */
export function appSourceFiles() {
  const files = [];
  const appsDir = abs('apps');
  if (!existsSync(appsDir)) return files;
  for (const app of readdirSync(appsDir).sort()) {
    for (const file of walk(join(appsDir, app, 'src'), [])) files.push({ file, app });
  }
  return files;
}

/** Package code: each package's `src/`. Returns [{ file, pkg }] with `pkg` the folder name. */
export function packageSourceFiles() {
  const files = [];
  const pkgsDir = abs('packages');
  if (!existsSync(pkgsDir)) return files;
  for (const pkg of readdirSync(pkgsDir).sort()) {
    for (const file of walk(join(pkgsDir, pkg, 'src'), [])) files.push({ file, pkg });
  }
  return files;
}

/**
 * Which of these repo-relative paths git ignores, i.e. which are private. A new file that is
 * merely not committed yet is NOT private; only a gitignored one is. A folder takes a trailing
 * slash (`apps/<id>/`).
 */
export function ignored(paths) {
  const out = new Set();
  if (!paths.length) return out;
  try {
    const res = execFileSync('git', ['check-ignore', '--stdin'], { cwd: ROOT, input: paths.join('\n'), encoding: 'utf8' });
    for (const l of res.split(/\r?\n/)) if (l) out.add(l);
  } catch (e) {
    // Exit 1 means "none of them": that is an answer, not an error. Outside a git checkout,
    // nothing is private.
    for (const l of String(e.stdout ?? '').split(/\r?\n/)) if (l) out.add(l);
  }
  return out;
}

let privateAppSet = null;
/** The apps whose folder is gitignored: present in the owner's checkout, never published. */
export function privateApps() {
  if (!privateAppSet) {
    const appsDir = abs('apps');
    const names = existsSync(appsDir) ? readdirSync(appsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
    const hits = ignored(names.map((n) => `apps/${n}/`));
    privateAppSet = new Set(names.filter((n) => hits.has(`apps/${n}/`)));
  }
  return privateAppSet;
}

let uncommittedSet = null;
/**
 * Files with work nobody has committed yet: new (untracked, not ignored) or edited. The checks
 * list these first when a count goes up, because in a tree several sessions share, the new copy
 * is usually in someone's unfinished file.
 */
export function uncommitted() {
  if (!uncommittedSet) {
    uncommittedSet = new Set();
    try {
      const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'apps', 'packages'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      for (const l of out.split(/\r?\n/)) {
        const path = l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '');
        if (path) uncommittedSet.add(path);
      }
    } catch {
      /* not a git checkout */
    }
  }
  return uncommittedSet;
}

/** Budgets for private apps live in a private file, so no public file names a private app. */
export function privateBudgets() {
  const f = abs('scripts/budgets.private.json');
  if (!existsSync(f)) return {};
  return JSON.parse(readFileSync(f, 'utf8'));
}

export const read = (relPath) => readFileSync(abs(relPath), 'utf8');

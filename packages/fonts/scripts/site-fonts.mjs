// One copy of each font file for the whole website.
//
//   VITE_SITE_FONTS=shared/fonts/ node packages/fonts/scripts/site-fonts.mjs <site>
//
// Run by the Pages deploy once every app's build is in place under <site>/<route>/. Every app that
// bundles this package emits its own copy of each font file it uses into <route>/assets/, so the
// site would carry the library once per app. Built with VITE_SITE_FONTS, an app's code fetches
// every face from <site>/<VITE_SITE_FONTS> instead (src/site.ts). Its stylesheet (fonts.css, for
// the HTML previews) still names the app's own copies: a CSS file cannot read the build's env.
// So this puts the package's own file there, points each app's stylesheets at it, and takes out
// each app's copy, after checking it holds the same bytes. What the site serves is then exactly
// one copy of each file, the one the apps ask for.
//
// It checks everything before it changes anything, and fails, leaving the site as it was, when
// VITE_SITE_FONTS is not a folder inside the site, when an app's copy is not where the apps look
// up from (<site>/<route>/assets/), when a copy holds other bytes than the package's file, when an
// app was built without VITE_SITE_FONTS, or when a stylesheet or page would still name a copy it
// takes out.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const [siteArg] = process.argv.slice(2);
const dir = process.env.VITE_SITE_FONTS;
const fail = (...msgs) => {
  for (const msg of msgs) console.error(`site fonts: ${msg}`);
  process.exit(1);
};

if (!siteArg || !existsSync(siteArg)) fail(`no site folder at ${siteArg ?? '(none given)'}`);
if (!dir) fail('VITE_SITE_FONTS is not set, so the apps were built to fetch their own copies; nothing to share');
if (!/^(?:[\w-]+\/)+$/.test(dir)) fail(`VITE_SITE_FONTS must be a folder inside the site, like "shared/fonts/" (got "${dir}")`);

const site = resolve(siteArg);
const FONT_DIR = fileURLToPath(new URL('../src/fonts/', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MB = (n) => `${(n / 1e6).toFixed(1)} MB`;

/** Every file under `root`, as paths relative to it with forward slashes. */
function filesUnder(root) {
  const out = [];
  (function walk(d) {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full).split(sep).join('/'));
    }
  })(root);
  return out;
}

// The package's font files (what its globs hand out, "anton.ttf", "weights/roboto-bold.ttf"), by
// the name an app's emitted copy carries ahead of its hash ("roboto-bold.ttf").
const byName = new Map();
for (const file of filesUnder(FONT_DIR).filter((f) => /\.(?:ttf|otf)$/.test(f))) {
  const name = posix.basename(file);
  byName.set(name, [...(byName.get(name) ?? []), file]);
}
const packageSha = new Map();
const shaOf = (file) => {
  if (!packageSha.has(file)) packageSha.set(file, sha(readFileSync(join(FONT_DIR, file))));
  return packageSha.get(file);
};

// An app's copy, as Vite names an emitted asset: <name>-<8-character hash><ext>.
const EMITTED = /^(.+)-[\w-]{8}(\.(?:ttf|otf))$/;

const files = filesUnder(site);
const problems = [];
/** Each app's copy, by its path in the site, to the package file it is a copy of. */
const copies = new Map();
for (const p of files) {
  if (p.startsWith(dir)) continue; // the shared copies themselves, on a second run
  const m = EMITTED.exec(posix.basename(p));
  const candidates = m && byName.get(m[1] + m[2]);
  if (!candidates) continue;
  if (!/^[^/]+\/assets\/[^/]+$/.test(p)) {
    problems.push(`${p}: an app's copy must be at <route>/assets/, where its build looks up from`);
    continue;
  }
  const have = sha(readFileSync(join(site, p)));
  const same = candidates.find((file) => shaOf(file) === have);
  if (same) copies.set(p, same);
  else problems.push(`${p}: not the same bytes as the package's ${candidates.join(' or ')}`);
}

// Each app's build must have been told where the shared copies are, or taking its own away
// loses its faces.
const routes = [...new Set([...copies.keys()].map((p) => p.split('/')[0]))];
for (const route of routes) {
  const told = files.some((q) => q.startsWith(`${route}/assets/`) && q.endsWith('.js') && readFileSync(join(site, q), 'utf8').includes(dir));
  if (!told) problems.push(`${route}: built without VITE_SITE_FONTS, so it still fetches its own copies`);
}

// A stylesheet's url() naming a copy is pointed at the shared file instead, relative to the
// stylesheet as Vite writes them for a relative base: from <route>/assets/, ../../<dir><file>.
const URL_IN_CSS = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g;
const sheets = new Map();
let pointed = 0;
for (const css of files.filter((f) => f.endsWith('.css'))) {
  const text = readFileSync(join(site, css), 'utf8');
  const from = posix.dirname(css);
  const out = text.replace(URL_IN_CSS, (whole, quote, url) => {
    if (/^(?:[a-z][\w+.-]*:|\/|#)/i.test(url)) return whole;
    const cut = url.search(/[?#]/);
    const path = cut < 0 ? url : url.slice(0, cut);
    const file = copies.get(posix.normalize(posix.join(from, path)));
    if (!file) return whole;
    pointed++;
    return `url(${quote}${posix.relative(from, `${dir}${file}`)}${cut < 0 ? '' : url.slice(cut)}${quote})`;
  });
  if (out !== text) sheets.set(css, out);
}

// Nothing the browser reads as a stylesheet or a page may still name a copy that goes. (The apps'
// code does name them, rightly: built with the folder, it works the shared URL out from its own.)
const gone = new Set([...copies.keys()].map((p) => posix.basename(p)));
for (const f of files.filter((q) => /\.(?:css|html?)$/.test(q))) {
  const text = sheets.get(f) ?? readFileSync(join(site, f), 'utf8');
  const left = [...text.matchAll(/[\w-]+\.(?:ttf|otf)\b/g)].map((m) => m[0]).filter((n) => gone.has(n));
  if (left.length) problems.push(`${f}: still names ${left[0]}${left.length > 1 ? ` and ${left.length - 1} more` : ''}, which would be gone`);
}

if (problems.length) {
  fail(...problems.slice(0, 20), ...(problems.length > 20 ? [`...and ${problems.length - 20} more`] : []), 'nothing was changed');
}

// Everything checks out: one copy of each file in the shared folder, the stylesheets pointed at
// it, and the apps' own copies taken out.
const shared = [...new Set(copies.values())];
for (const file of shared) {
  mkdirSync(dirname(join(site, dir, file)), { recursive: true });
  copyFileSync(join(FONT_DIR, file), join(site, dir, file));
}
for (const [css, text] of sheets) writeFileSync(join(site, css), text);
let removed = 0;
for (const p of copies.keys()) {
  removed += statSync(join(site, p)).size;
  rmSync(join(site, p));
}
const kept = shared.reduce((n, file) => n + statSync(join(site, dir, file)).size, 0);
for (const route of routes) {
  const n = [...copies.keys()].filter((p) => p.startsWith(`${route}/`)).length;
  const s = [...sheets.keys()].filter((p) => p.startsWith(`${route}/`)).length;
  console.log(`site fonts: ${route}: ${n} copies taken out, ${s} stylesheet${s === 1 ? '' : 's'} pointed at ${dir}`);
}
console.log(`site fonts: ${copies.size} app copies (${MB(removed)}) replaced by ${shared.length} files at ${dir} (${MB(kept)}); ${pointed} stylesheet urls pointed there`);

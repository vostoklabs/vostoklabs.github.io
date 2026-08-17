// Build a generator as ONE html file that runs from `file://` — no server, no
// network — and zip it.
//
//   node scripts/offline.mjs foldbox
//   node scripts/offline.mjs clicker-generator
//
// Out: apps/<id>/offline/<id>-offline.{html,zip}
//
// `file://` takes away more than it sounds like. There is no module script (the
// origin is `null`, so loading one is a blocked cross-origin fetch), no `fetch()` at
// all (the file: scheme is not fetchable), and no worker loaded from a path. So the
// page has to carry its own bundle, its own stylesheet, its own fonts, its own
// worker and every byte the app would otherwise have asked the server for.
//
// The bundle is NOT edited. Everything the app does at runtime is redirected by a
// prelude that runs before it — see `prelude()` below — so this keeps working when
// the minifier changes its mind about how to write a Worker URL.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { SHELL_FILES } from './offline-config.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const app = process.argv[2];
if (!app) throw new Error('usage: node scripts/offline.mjs <app-id>');
const APP = join(ROOT, 'apps', app);
if (!existsSync(join(APP, 'vite.offline.config.ts'))) {
  throw new Error(`apps/${app} has no vite.offline.config.ts`);
}

const BUILD = join(APP, 'dist-offline');
const OUT = join(APP, 'offline');
const NAME = `${app}-offline`;

rmSync(BUILD, { recursive: true, force: true });
execFileSync('npx', ['vite', 'build', '--config', 'vite.offline.config.ts'], {
  cwd: APP,
  stdio: 'inherit',
  shell: true,
});

// ─────────────────────────────── the emitted files ───────────────────────────────

const walk = (dir, base = dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name), base)
      : [relative(base, join(dir, e.name)).split(sep).join(posix.sep)],
  );

const files = walk(BUILD);
const shell = (n) => join(BUILD, n);
const readText = (n) => readFileSync(shell(n), 'utf8');

const MIME = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.3mf': 'application/octet-stream',
  '.txt': 'text/plain',
  '.md': 'text/plain',
};
const mimeOf = (f) => MIME[f.slice(f.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream';

// Everything the app would have fetched from the server, keyed by the path it asks
// for. Base64 costs a third on top, and there is no way round that: it has to be
// text to live in an html file.
const assetFiles = files.filter((f) => !SHELL_FILES.has(f));
const assets = Object.fromEntries(
  assetFiles.map((f) => [f, `data:${mimeOf(f)};base64,${readFileSync(shell(f)).toString('base64')}`]),
);

// ────────────────────────────────── the prelude ──────────────────────────────────

/** Redirect every runtime lookup at the embedded map, without editing the bundle.
 *
 *  Three interceptions, and each one is a path the app actually uses:
 *
 *  - `fetch` — the 3MF bodies, the JSON, the .ttf fonts, the SVG samples.
 *  - `HTMLImageElement.src` — sample THUMBNAILS are assigned, not fetched, so the
 *    fetch hook never sees them and every thumbnail would come up broken.
 *  - `Worker` — `new Worker(<path>)` cannot load from file://, so the one worker
 *    becomes a Blob built from its own source. Matched by filename, which the
 *    offline vite config pins so it is not a hash.
 *
 *  Patching the prelude rather than the bundle is what keeps this from breaking the
 *  next time the minifier writes a worker URL differently. */
function prelude(map, workerSrc) {
  return `(function(){
var A = ${JSON.stringify(map)};
var W_SRC = ${JSON.stringify(workerSrc)};
var BASE = document.baseURI;
function key(u){
  if (u == null) return null;
  u = String(u);
  if (/^(data:|blob:|https?:)/i.test(u)) return null;
  if (u.indexOf(BASE) === 0) u = u.slice(BASE.length);
  u = u.replace(/^\\.\\//, '').replace(/^\\//, '').split('#')[0].split('?')[0];
  // Requests are built by concatenation in some places and by URL() in others, so
  // the same file arrives both with raw spaces and percent-encoded.
  var d = u; try { d = decodeURIComponent(u); } catch (e) {}
  if (Object.prototype.hasOwnProperty.call(A, d)) return d;
  return Object.prototype.hasOwnProperty.call(A, u) ? u : null;
}
var _fetch = window.fetch.bind(window);
window.fetch = function(input, init){
  var u = typeof input === 'string' ? input : (input && input.url);
  var k = key(u);
  return k ? _fetch(A[k], init) : _fetch(input, init);
};
var d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
if (d && d.set) {
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true, enumerable: d.enumerable,
    get: function(){ return d.get.call(this); },
    set: function(v){ var k = key(v); d.set.call(this, k ? A[k] : v); }
  });
}
// And setAttribute, which does NOT go through the property above. Both are in use:
// one thumbnail grid assigns img.src, another calls setAttribute, and only the
// second one's pictures came up broken.
var _sa = Element.prototype.setAttribute;
Element.prototype.setAttribute = function(name, value){
  if (name === 'src' || name === 'href' || name === 'xlink:href') {
    var k = key(value); if (k) value = A[k];
  }
  return _sa.call(this, name, value);
};
// And innerHTML, which sees neither. The sample grid is a template string with
// <img src="..."> in it, assigned in one go — so the six sample thumbnails were the
// only things still hitting the network, and they were invisible to both hooks
// above. Rewrite the markup on the way in, exactly as the build rewrites the
// static html.
function rewriteMarkup(h){
  return String(h).replace(/((?:src|href)=["'])([^"']+)(["'])/g, function(m, a, u, b){
    var k = key(u); return k ? a + A[k] + b : m;
  });
}
var ih = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
if (ih && ih.set) {
  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: true, enumerable: ih.enumerable,
    get: function(){ return ih.get.call(this); },
    set: function(v){ ih.set.call(this, rewriteMarkup(v)); }
  });
}
var _iah = Element.prototype.insertAdjacentHTML;
Element.prototype.insertAdjacentHTML = function(pos, h){
  return _iah.call(this, pos, rewriteMarkup(h));
};
if (W_SRC) {
  var _W = window.Worker;
  var blob = null;
  window.Worker = function(url, opts){
    if (String(url).indexOf('worker.js') < 0) return new _W(url, opts);
    // Built as an iife, so it is a CLASSIC worker whatever the caller asked for —
    // and a module worker from a blob would try to resolve imports against the
    // blob's own opaque origin.
    if (!blob) blob = URL.createObjectURL(new Blob([W_SRC], { type: 'text/javascript' }));
    var o = {}; for (var p in opts) o[p] = opts[p]; o.type = 'classic';
    return new _W(blob, o);
  };
  window.Worker.prototype = _W.prototype;
}
})();`;
}

// ──────────────────────────────── compose the page ────────────────────────────────

let html = readText('index.html');

// Google Fonts first. An offline page cannot reach them, and it does not need to:
// Chakra Petch is bundled locally in `@vostok/ui-kit`'s own @font-face and is
// already a data: URI in the stylesheet below. The clicker's MakerWorld build
// strips exactly these tags for the same reason (CSP `font-src: 'self'`).
const stripped = [];
html = html.replace(/[ \t]*<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*/gi, (tag) => {
  stripped.push(tag.trim().slice(0, 60));
  return '\n';
});

// The stylesheet, verbatim. Its font URLs are already data:, per the build config.
html = html.replace(/<link[^>]+rel="stylesheet"[^>]*>/g, (tag) => {
  const href = /href="([^"]+)"/.exec(tag)?.[1];
  if (!href || /^https?:/i.test(href)) return tag;
  return `<style>\n${readText(href.replace(/^\.\//, ''))}\n</style>`;
});

// Vite's html plugin writes `type="module"` on the entry whatever the rollup output
// format is, so the tag proves nothing — check the CODE. Not by grepping for the
// word `import`: the bundle is one minified line apart from newlines inside string
// literals, and one of foldbox's literals begins a line "import drops the size".
// What is unambiguous is rollup's iife tail, and `import.meta`, which a classic
// script cannot evaluate at all.
const isClassicBundle = (js) => {
  const code = js.replace(/\/\/#\s*sourceMappingURL=.*$/m, '').trim();
  return (
    /\}\s*\)?\s*\(\s*\)\s*;?$/.test(code) &&
    !/^\s*import[\s{*'"]/.test(code) &&
    !/\bimport\s*\.\s*meta\b/.test(code)
  );
};

let bundle = '';
html = html.replace(/<script[^>]*\ssrc="([^"]+)"[^>]*><\/script>\s*/g, (_tag, src) => {
  const js = readText(src.replace(/^\.\//, ''));
  if (!isClassicBundle(js)) {
    throw new Error(`${src} is not a plain iife bundle — the rollup output format did not take`);
  }
  bundle = js;
  return '';
});
if (!bundle) throw new Error('no entry script found in the built html');

const workerSrc = files.includes('worker.js') ? readText('worker.js') : '';
if (workerSrc) {
  if (!isClassicBundle(workerSrc)) throw new Error('worker.js is not a plain iife bundle');
  // If the bundle never names the worker, the interception below is dead code and
  // the app will try to load it off disk. Better to know now than to ship it.
  if (!bundle.includes('worker.js')) {
    throw new Error('the bundle does not reference worker.js — the Worker hook would never fire');
  }
}
const extraWorkers = files.filter((f) => /worker.*\.js$/.test(f) && f !== 'worker.js');
if (extraWorkers.length) throw new Error(`unhandled worker chunks: ${extraWorkers.join(', ')}`);

// Every remaining markup reference that resolves into the asset map becomes a data:
// URI — favicons, apple-touch-icons, preloads, whatever the html happens to carry.
// Generic rather than a rule per `rel`: the clicker has three icon links and one of
// them is `apple-touch-icon`, which a `rel="icon"` matcher walks straight past.
html = html.replace(/(\b(?:src|href)=")([^"]+)(")/g, (m, pre, url, post) => {
  if (/^(data:|#|https?:|mailto:)/i.test(url)) return m;
  const k = decodeURIComponent(url.replace(/^\.\//, '').replace(/^\//, ''));
  return assets[k] ? `${pre}${assets[k]}${post}` : m;
});

// Checked HERE, before the scripts go in. Run afterwards it scans the bundle too,
// and minified JS that builds html from template literals is full of `src="${x}"`.
const external = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(data:|#|https?:|mailto:)/.test(u));
if (external.length) {
  throw new Error(`offline build still references: ${[...new Set(external)].join(', ')}`);
}
if (/<link[^>]+modulepreload/.test(html)) throw new Error('modulepreload survived the build');

// The script goes at the END OF THE BODY. Vite puts the entry in <head>, which is
// fine for a module — those are deferred by spec — and fatal for an inline classic
// script: it runs before <div id="app"> exists and the app mounts into null.
//
// A replacer FUNCTION, not a replacement string: `String.replace` expands `$&`,
// `` $` `` and `$'` inside a replacement string, and megabytes of minified JS
// contain those sequences. Splicing as a string corrupts the bundle silently.
const escape = (js) => js.replace(/<\/script/gi, '<\\/script');
html = html.replace(
  '</body>',
  () =>
    `  <script>\n${escape(prelude(assets, workerSrc))}\n  </script>\n` +
    `  <script>\n${escape(bundle)}\n  </script>\n</body>`,
);

if (!html.includes(escape(bundle))) throw new Error('the bundle was mangled on the way in');

// ──────────────────────────────────── write ────────────────────────────────────

mkdirSync(OUT, { recursive: true });
const htmlPath = join(OUT, `${NAME}.html`);
writeFileSync(htmlPath, html);

const readmePath = join(APP, 'offline.README.txt');
const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
const zipPath = join(OUT, `${NAME}.zip`);
writeFileSync(
  zipPath,
  zipSync(
    {
      [`${NAME}.html`]: strToU8(html),
      ...(readme ? { 'README.txt': strToU8(readme) } : {}),
    },
    { level: 9 },
  ),
);

const mb = (p) => `${(statSync(p).size / 1024 / 1024).toFixed(2)} MB`;
const biggest = assetFiles
  .map((f) => [f, statSync(shell(f)).size])
  .sort((a, b) => b[1] - a[1])
  .slice(0, 3)
  .map(([f, n]) => `${f} ${(n / 1024 / 1024).toFixed(1)} MB`);
console.log(`\n  ${assetFiles.length} assets embedded${biggest.length ? ` — biggest: ${biggest.join(', ')}` : ''}`);
console.log(`  worker: ${workerSrc ? `${(workerSrc.length / 1024 / 1024).toFixed(2)} MB, inlined as a Blob` : 'none'}`);
console.log(`  ${relative(ROOT, htmlPath)}  ${mb(htmlPath)}  (no external references)`);
console.log(`  ${relative(ROOT, zipPath)}  ${mb(zipPath)}`);

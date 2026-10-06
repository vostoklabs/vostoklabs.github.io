// Every gallery card's picture, drawn at BUILD time.
//
// The gallery used to build all ~45 templates' default designs in the browser before a single
// thumbnail appeared: each template's `build()` on the main thread, then every boolean through
// the one geometry worker, in series. Measured on the dev server: cards at ~0.7 s, the first
// picture at ~24 s. None of
// that work depends on anything the customer does — a card is always the template's defaults —
// so it is done here, once, in node, and drawn by the app's OWN `thumbSvg` (src/preview.ts)
// through a tiny DOM stand-in, so a precomputed card is the same picture the live path would
// have drawn.
//
// The builder below is this script's own — the slice of `tests/node/harness.mjs` a card needs,
// nothing more. It used to import that harness, which is gitignored with the rest of tests/, so
// on CI the generator died on the import and the LIVE site built every card in the browser, all
// ~60 in series through the one worker, which was very slow. Nothing here may reach into
// tests/: deploy.yml runs it in a clean clone.
//
// The result is a map `{ templateId: '<svg …>' }` that the `laser-thumbs` Vite plugin
// (vite.config.ts) serves as `virtual:laser-thumbs`, so it is compiled INTO the bundle: no
// fetch, no file to find — it works from `file://` in the offline single-file build and under
// a strict same-origin CSP exactly as it does on the site (invariant #5). A template with no entry
// (a new one, or the generator failed) falls back to the old live build, so a card is never blank.
//
// Cached on disk keyed by a hash of every source file that can change a picture, so a rebuild
// with no geometry change costs a hash, not 45 builds.
//
//   node scripts/thumbs.mjs            regenerate (or reuse the cache) and print a summary
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const root = `${app}/../..`;
const CACHE_DIR = `${app}/node_modules/.cache/laser-thumbs`;
/** The two per-process bundles this script builds, beside the cache — never under tests/. */
const SCRATCH = `${CACHE_DIR}/tmp`;
const FONT_DIR = `${root}/packages/fonts/src/fonts`;

/** Everything a card's picture can depend on: the templates and their defaults, the engine, the
 *  drawing, and the packages they build on. Fonts by name and size (they are 34 MB). */
const SOURCES = [
  `${app}/src/templates`, `${app}/src/engine`, `${app}/src/symbols`, `${app}/src/preview.ts`, `${app}/src/assembled.ts`,
  // The faces the pattern template fills.
  `${app}/src/areas.ts`,
  `${app}/scripts/thumbs.mjs`,
  `${root}/packages/laser/src`, `${root}/packages/patterns/src`, `${root}/packages/fonts/src`,
  // The shape maths both engines stand on, and the kit's `svgNode` the picture is drawn with.
  `${root}/packages/shapes/src`, `${root}/packages/ui-kit/src/dom.ts`,
  // The booleans' memory-safe doors, and the pattern library's tiles.
  `${root}/packages/manifold/src`, `${root}/packages/patterns/data/pattern-monster.json`, `${root}/packages/patterns/data/pattern-monster-index.json`,
];

/** Whether a saved file can change a card's picture: the dev server drops the cards it serves when
 *  one is saved (vite.config.ts). The same list the cache key is made of, so the two never part. */
export function isPictureSource(file) {
  const f = resolve(file).replaceAll('\\', '/');
  return SOURCES.some((s) => {
    const p = resolve(s).replaceAll('\\', '/');
    return f === p || f.startsWith(`${p}/`);
  });
}

function walk(p, out) {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isDirectory()) { for (const f of readdirSync(p).sort()) walk(join(p, f), out); return; }
  out.push([p, st]);
}

export function sourceHash() {
  const h = createHash('sha256');
  const files = [];
  for (const s of SOURCES) walk(s, files);
  for (const [f, st] of files) {
    const rel = f.replaceAll('\\', '/').slice(root.length);
    h.update(rel + '\0');
    // A font is identified by its name and size; everything else by its bytes.
    h.update(/\.(ttf|otf|woff2?)$/i.test(f) ? String(st.size) : readFileSync(f));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

/** Just enough DOM for `thumbSvg`: createElementNS, setAttribute, append, serialise. */
class FakeEl {
  constructor(tag) { this.tag = tag; this.attrs = new Map(); this.children = []; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  append(...cs) { this.children.push(...cs); }
  appendChild(c) { this.children.push(c); return c; }
  get outerHTML() {
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const a = [...this.attrs].map(([k, v]) => ` ${k}="${esc(k === 'd' ? shortD(v) : v)}"`).join('');
    return `<${this.tag}${a}>${this.children.map((c) => c.outerHTML).join('')}</${this.tag}>`;
  }
}

/** A card is ~230 CSS px across a design 40–150 mm wide, so one device pixel is 0.15 mm or more
 *  even on a 2× screen. Path data drops to PRECISION decimals (the editor's preview keeps its
 *  three) and a point that rounds onto the one before it is dropped — a fraction of the bytes,
 *  with no visible change at card size. */
const PRECISION = 1;
function shortD(d) {
  const k = 10 ** PRECISION;
  const r = (v) => { const n = Math.round(Number(v) * k) / k; return Object.is(n, -0) ? '0' : String(n); };
  let out = '';
  let last = '';
  for (const m of d.matchAll(/([MLZ])(?:\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+))?/g)) {
    if (m[1] === 'Z') { out += 'Z'; last = ''; continue; }
    const pt = `${r(m[2])} ${r(m[3])}`;
    if (m[1] === 'L' && pt === last) continue;
    out += `${m[1]}${pt}`;
    last = pt;
  }
  return out;
}

/**
 * Every registered template's `build()` and the worker's `buildKeychain()`, in node: the app's own
 * modules bundled by esbuild exactly as the test harness bundles them (the same externals and the
 * same `import.meta.glob` stand-in — @vostok/fonts finds its .ttf files through Vite's glob, so
 * here they are read off disk and registered as custom fonts), manifold's node build for the
 * booleans. `buildTemplate(t)` builds `t` at its defaults.
 */
async function loadBuilder() {
  const { build } = await import('esbuild');
  const bundle = `${SCRATCH}/builder-${process.pid}.mjs`;
  mkdirSync(SCRATCH, { recursive: true });
  await build({
    stdin: {
      contents: [
        `export { TEMPLATES, defaultsOf, coerceValues } from '${app}/src/templates/index.ts';`,
        `export { buildKeychain } from '${app}/src/engine/build.ts';`,
        `export { registerCustomFont, FALLBACK_FONT_ID } from '${root}/packages/fonts/src/index.ts';`,
      ].join('\n'),
      resolveDir: app, loader: 'ts',
    },
    outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'error',
    external: ['manifold-3d', 'onnxruntime-web', 'pica', 'three'],
    define: { 'import.meta.glob': '__thumbFontGlob', 'import.meta.env': '{}' },
    banner: { js: 'const __thumbFontGlob = () => ({});' },
    loader: { '.json': 'json', '.svg': 'text', '.wasm': 'file' },
  });
  const mod = await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`);

  const Module = (await import(pathToFileURL(`${app}/node_modules/manifold-3d/manifold.js`).href)).default;
  const wasm = await Module();
  wasm.setup();
  // The worker's two tessellation settings (src/engine/worker.ts), so a card's curves are the app's.
  wasm.setMinCircularEdgeLength(0.15);
  wasm.setMinCircularAngle(3);

  const opentype = createRequire(`${root}/packages/fonts/package.json`)('opentype.js');
  const registered = new Set();
  const registerFont = (id) => {
    if (registered.has(id)) return;
    const file = `${FONT_DIR}/${id}.ttf`;
    if (!existsSync(file)) return;
    const buf = readFileSync(file);
    mod.registerCustomFont(id, opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
    registered.add(id);
  };
  const registerAll = () => { for (const f of readdirSync(FONT_DIR)) if (f.endsWith('.ttf')) registerFont(f.slice(0, -4)); };
  registerFont(mod.FALLBACK_FONT_ID);

  async function buildTemplate(t) {
    const values = mod.coerceValues(t, mod.defaultsOf(t));
    // Every string value that names a bundled face; a template that hard-codes a face its values
    // never name gets the whole library on its first miss, and one more try.
    for (const v of Object.values(values)) if (typeof v === 'string' && /^[a-z0-9-]+$/.test(v)) registerFont(v);
    let input;
    try { input = await t.build(values); } catch (err) {
      if (!/Font url not resolved|Custom font is missing/.test(String(err?.message ?? err))) throw err;
      registerAll();
      input = await t.build(values);
    }
    return mod.buildKeychain(wasm, input);
  }
  return { templates: mod.TEMPLATES, buildTemplate };
}

async function loadThumbSvg() {
  const { build } = await import('esbuild');
  const out = `${SCRATCH}/thumbsvg-${process.pid}.mjs`;
  mkdirSync(SCRATCH, { recursive: true });
  await build({
    stdin: { contents: `export { thumbSvg } from '${app}/src/preview.ts';`, resolveDir: app, loader: 'ts' },
    outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'error',
    external: ['manifold-3d', 'three'],
    loader: { '.css': 'empty', '.svg': 'text', '.json': 'json' },
    define: { 'import.meta.glob': '__thumbGlob', 'import.meta.env': '{}' },
    banner: { js: 'const __thumbGlob = () => ({});' },
  });
  const g = globalThis;
  if (!g.document) g.document = { createElementNS: (_ns, tag) => new FakeEl(tag), createElement: (tag) => new FakeEl(tag) };
  return (await import(`${pathToFileURL(out).href}?t=${Date.now()}`)).thumbSvg;
}

/** Build every registered template's default design and draw its card. `{ id: svg }`. */
export async function generateThumbs({ log = console.log, force = false } = {}) {
  const hash = sourceHash();
  const file = `${CACHE_DIR}/${hash}.json`;
  if (!force && existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, 'utf8'));
    return { hash, thumbs: cached, fromCache: true, failed: [] };
  }
  const started = Date.now();
  const builder = await loadBuilder();
  const thumbSvg = await loadThumbSvg();
  const thumbs = {};
  const failed = [];
  for (const t of builder.templates) {
    try {
      const svg = thumbSvg(await builder.buildTemplate(t), 0.15);
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      thumbs[t.id] = svg.outerHTML;
    } catch (err) {
      failed.push(t.id);
      log(`[laser-thumbs] ${t.id}: ${err?.message ?? err} — this card will build live in the browser`);
    }
  }
  // Both loaders leave a per-pid bundle in SCRATCH; this runs on every build and every dev save,
  // so it takes its own away rather than piling them up.
  for (const f of readdirSync(SCRATCH)) if (f.includes(`-${process.pid}.`)) rmSync(`${SCRATCH}/${f}`, { force: true });
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(thumbs));
  // Keep the newest few: a dev session editing a template writes one per save it reloads on.
  const old = readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json')).map((f) => [f, statSync(`${CACHE_DIR}/${f}`).mtimeMs]).sort((a, b) => b[1] - a[1]).slice(6);
  for (const [f] of old) rmSync(`${CACHE_DIR}/${f}`, { force: true });
  const kb = Math.round(JSON.stringify(thumbs).length / 1024);
  log(`[laser-thumbs] drew ${Object.keys(thumbs).length} card(s) in ${((Date.now() - started) / 1000).toFixed(1)} s · ${kb} KB${failed.length ? ` · ${failed.length} failed` : ''}`);
  return { hash, thumbs, fromCache: false, failed };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const r = await generateThumbs({ force: process.argv.includes('--force') });
  const sizes = Object.entries(r.thumbs).map(([id, s]) => [id, s.length]).sort((a, b) => b[1] - a[1]);
  console.log(`${r.fromCache ? 'cached' : 'generated'} ${sizes.length} thumbs, hash ${r.hash}; largest:`, sizes.slice(0, 5).map(([id, n]) => `${id} ${Math.round(n / 1024)} KB`).join(', '));
  process.exit(0);
}

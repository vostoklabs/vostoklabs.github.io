import { defineConfig, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Our CSP-safe manifold rebuild (see packages/manifold-noeval/README.md). Aliased in EVERY
// mode, as in the clicker and the keycap generator, so the public site and the MakerWorld embed
// run the same geometry engine and there is only one to reason about. The npm package stays
// installed — it still provides the TypeScript types — but its glue calls `new Function()` via
// Embind, which needs `'unsafe-eval'` in the CSP; the vendored rebuild avoids it in every
// mode. The subpath rule must come first so `manifold-3d/manifold.wasm?url` resolves to the
// vendored .wasm rather than npm's.
const MANIFOLD_NOEVAL = resolve(__dirname, '../../packages/manifold-noeval');

/*
  `virtual:makerlab` — the MakerWorld seam, the same one the clicker, the keycap
  generator and foldbox have.

  In `--mode makerworld` it resolves to the gitignored host glue (src/makerlab/), so it is NOT
  in a public clone. (Do not write that folder's ignore pattern out in a block comment: its
  slash-star closes the comment, which is how this file first failed to parse.) In every other
  build this resolves to the inline stub below, whose `MAKERLAB` is the literal `false`: no host
  glue ever enters the module graph, so the published site and the offline page carry none of
  it, and `pnpm build` in a fresh clone with no src/makerlab/ at all still works. That last part
  is not a nicety — it is what deploy.yml runs.

  The access helpers are stubbed: nothing calls `ensureAccess`. They are exported anyway,
  hard-locked in the stub and real in the glue, so the two builds keep one shape.
  Nothing here can grant access: `isUnlocked` and `ensureAccess` answer false in every build
  that is not talking to a host.
*/
function makerlabPlugin(enabled: boolean) {
  const VIRTUAL_ID = 'virtual:makerlab';
  const STUB_ID = '\0virtual:makerlab-stub';
  const gluePath = resolve(__dirname, 'src/makerlab/glue.ts');
  return {
    name: 'makerlab',
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return enabled ? gluePath : STUB_ID;
      return null;
    },
    load(id: string) {
      if (id !== STUB_ID) return null;
      return [
        'export const MAKERLAB = false;',
        'export const isEmbedded = () => false;',
        'export async function initMakerlab() { return null; }',
        'export const isReady = () => false;',
        'export const can = () => false;',
        'export async function sdkExport() { throw new Error("Not available in this build"); }',
        'export const isExportCancelled = () => false;',
        'export async function sdkToast() {}',
        // The paid seam, hard-locked. It exists so the call sites and the types are identical
        // in both builds; it cannot unlock anything, and no build that ships today asks it to.
        'export const isUnlocked = () => false;',
        'export async function ensureAccess() { return false; }',
      ].join('\n');
    },
    transformIndexHtml(html: string) {
      if (!enabled) return html;
      // The embedded build strips inline <script> blocks (those with no src). The only one is
      // the theme bootstrap, and the kit's sidebar footer re-applies the saved/system theme on
      // mount, so nothing is lost.
      return html.replace(/[ \t]*<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>\s*/gi, '\n');
    },
  };
}

/*
  `virtual:laser-thumbs` — every gallery card's picture, drawn at build time by
  scripts/thumbs.mjs as `{ templateId: '<svg …>' }`. Being a module, it is compiled INTO the
  bundle (its own lazy chunk on the site; folded into the one file by the offline build's
  `inlineDynamicImports`; a same-origin chunk in the embedded build) — no fetch anywhere, so
  invariant #5 holds in every target.

  The generator runs in a CHILD process: it installs a stand-in `document` on its global to
  run the app's own `thumbSvg`, and that has no business inside Vite's process.

  - `vite build` (every mode): generate, or reuse the on-disk cache when no source that can
    change a picture has changed. A failure is a warning, never a failed build — the gallery
    still builds any card it has no picture for, live, as it always did.
  - dev: serve the cache if it matches the current sources; otherwise serve the NEWEST cache
    there is and refresh it in the background — the next reload gets the fresh one. It used to
    serve `{}` there, so every card built live, ~60 in series through the one worker; and in a
    tree where the engine or the pattern library is being edited the hash is almost never
    current, so that was every reload, and slow. A card one reload out of date beats a page
    that draws for twenty seconds. No cache at all: `{}`, live.
*/
function laserThumbsPlugin() {
  const VIRTUAL_ID = 'virtual:laser-thumbs';
  const RESOLVED = '\0virtual:laser-thumbs';
  const script = resolve(__dirname, 'scripts/thumbs.mjs');
  const cacheDir = resolve(__dirname, 'node_modules/.cache/laser-thumbs');
  const cacheFile = (hash: string) => resolve(cacheDir, `${hash}.json`);
  /** The last cache written, whatever sources it was drawn from (dev only — see above). */
  const newestCache = (): string | null => {
    if (!existsSync(cacheDir)) return null;
    const files = readdirSync(cacheDir).filter((f) => f.endsWith('.json')).map((f) => resolve(cacheDir, f));
    return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
  };
  let isBuild = false;
  let generating: Promise<boolean> | null = null;
  // Dev only: drop the served module so the next page load re-reads it — after the background
  // generator lands, and whenever a source that can change a picture is saved.
  let invalidate = () => {};
  const PICTURE_SOURCES = /[\\/](src[\\/](templates|engine|symbols)[\\/]|src[\\/](preview|assembled)\.ts$|packages[\\/](laser|patterns|fonts)[\\/]src[\\/])/;
  const generate = () =>
    (generating ??= new Promise<boolean>((done) => {
      const child = spawn(process.execPath, [script], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      child.stdout.on('data', (d) => (log += d));
      child.stderr.on('data', (d) => (log += d));
      child.on('close', (code) => {
        generating = null;
        for (const l of log.split('\n')) if (l.startsWith('[laser-thumbs]')) console.log(l.trim());
        if (code !== 0) console.warn(`[laser-thumbs] generator exited ${code}; cards will build live.\n${log.slice(-2000)}`);
        invalidate();
        done(code === 0);
      });
    }));
  return {
    name: 'laser-thumbs',
    configResolved(c: { command: string }) { isBuild = c.command === 'build'; },
    configureServer(server: ViteDevServer) {
      invalidate = () => {
        const m = server.moduleGraph.getModuleById(RESOLVED);
        if (m) server.moduleGraph.invalidateModule(m);
      };
      server.watcher.on('change', (f) => { if (PICTURE_SOURCES.test(f)) invalidate(); });
    },
    resolveId(id: string) { return id === VIRTUAL_ID ? RESOLVED : null; },
    async load(id: string) {
      if (id !== RESOLVED) return null;
      const { sourceHash } = (await import(pathToFileURL(script).href)) as { sourceHash(): string };
      const file = cacheFile(sourceHash());
      if (!existsSync(file)) {
        if (isBuild) await generate();
        else void generate();
      }
      const served = existsSync(file) ? file : isBuild ? null : newestCache();
      const json = served ? readFileSync(served, 'utf8') : '{}';
      // No source map: generated data has no source to map to, and dev would otherwise inline
      // the 1.6 MB of pictures a second and third time as a base64 map (11 MB a page load).
      return { code: `export default ${json};`, map: { mappings: '' } };
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Relative base so the static build works on ANY GitHub Pages URL with no reconfig.
  base: './',
  plugins: [makerlabPlugin(mode === 'makerworld'), laserThumbsPlugin()],
  worker: { format: 'es' },
  server: {
    /* Don't watch `tests/`.
     *
     * Every headless harness in there points Chrome at a `--user-data-dir` inside the app —
     * `tests/.headless/chrome-profile`, `tests/node/.out/chrome-shoot`, and four more — and
     * Chrome writes journal and lock files into them continuously. Chokidar tries to stat those
     * while Chrome is mid-write and the dev server DIES on an `UNKNOWN` fs error, mid-run.
     *
     * That is what was behind a string of "the server is down" and "the test can't find the
     * gallery" symptoms while this app was under test: not a slow cold start, and not the
     * app — the server had crashed under the very test that was driving it. Nothing in `tests/`
     * is ever part of the bundle, so there is nothing to watch there anyway. */
    watch: { ignored: ['**/tests/**'] },
  },
  build: {
    target: 'es2022',
    // The embedded build goes to its own folder, never `dist/` — `dist/` is what deploy.yml
    // copies onto the live site, and the embedded bundle must not be able to sit where the
    // public build lives. `assetsInlineLimit: 0`: the embedded build ships every asset as its
    // own file.
    ...(mode === 'makerworld' ? { outDir: 'dist-mw', assetsInlineLimit: 0 } : {}),
  },
  // manifold-3d ships its own WASM; keep esbuild from trying to pre-bundle it.
  optimizeDeps: { exclude: ['manifold-3d'] },
  resolve: {
    alias: [
      { find: /^manifold-3d\//, replacement: MANIFOLD_NOEVAL + '/' },
      { find: /^manifold-3d$/, replacement: MANIFOLD_NOEVAL + '/manifold.js' },
    ],
  },
}));

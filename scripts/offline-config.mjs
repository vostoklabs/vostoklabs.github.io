/** Vite overrides shared by every app's `vite.offline.config.ts`.
 *
 *  Each setting is load-bearing for a page opened as `file://`:
 *
 *  - `format: 'iife'` — a browser will not load an external MODULE script from a
 *    file:// page. The origin is `null`, so the fetch is cross-origin and blocked.
 *    A classic script has no such rule, and it is the only thing that can be
 *    inlined into the page as-is.
 *  - `assetsInlineLimit: Infinity` — fonts referenced from inside the CSS, and any
 *    `?url` import (manifold's .wasm), have to already be data: URIs by the time the
 *    stylesheet and the bundle are folded into the html.
 *  - `cssCodeSplit: false` — one stylesheet to inline rather than several.
 *  - `worker.format: 'iife'` + a fixed worker filename — the worker is emitted as
 *    its own file whatever we do, so `scripts/offline.mjs` turns it into a Blob URL.
 *    It can only find it reliably if the name is not hashed.
 *
 *  Everything under the app's `public/` is copied, never inlined — that is what
 *  `publicDir` means — so the builder base64s those separately.
 */
export const OFFLINE_OVERRIDES = {
  build: {
    outDir: 'dist-offline',
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    // A megabyte in one file is the point of the exercise, not a warning.
    chunkSizeWarningLimit: 1_000_000,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  worker: {
    format: 'iife',
    rollupOptions: {
      output: {
        entryFileNames: 'worker.js',
        chunkFileNames: 'worker-[name].js',
        assetFileNames: 'worker-[name][extname]',
      },
    },
  },
};

/** Files the builder folds into the page itself rather than into the asset map. */
export const SHELL_FILES = new Set(['index.html', 'app.js', 'style.css', 'worker.js']);

/** Keep only the named fonts in an offline build.
 *
 *  `@vostok/fonts` ships 153 faces and hands them out two ways: an eager
 *  `import.meta.glob` of `./fonts/*.ttf` (the URL map `getFont` reads) and 153
 *  `@font-face` rules in `fonts.css` (the HTML previews). Offline,
 *  `assetsInlineLimit` is Infinity — so BOTH become base64 and 25 MB of TTF lands
 *  in the page twice. The carabiner uses exactly one face and its first offline
 *  build came out at 67 MB, of which 66 were fonts it never names.
 *
 *  An app with a font picker keeps all 153 and simply does not call this. An app
 *  that puts one fixed face on the model names it and gets a page 30x smaller.
 *
 *  Both rewrites run at `enforce: 'pre'`, ahead of `vite:import-glob` and
 *  `vite:css`, so the dropped files are never resolved, never read, never inlined.
 *
 *  `opts.css: false` for an app that does NOT import `@vostok/fonts/fonts.css` at all.
 *  There are two independent copies of every face in play — the `@font-face` rules and
 *  the glob's asset URLs — and offline BOTH become base64, so an app that needs a face in
 *  the DOM as well as in the geometry pays for it twice. The fold-up box injects its own
 *  `@font-face` rules from `getFontUrl` instead, which is one copy for both jobs and 1.4
 *  MB off its single-file page. Then fonts.css is legitimately absent from the graph, and
 *  the guard below has to be told so rather than failing the build.
 */
export function keepOnlyFonts(keep, opts = {}) {
  const wanted = [...new Set(keep)];
  const wantCss = opts.css !== false;
  if (!wanted.length) throw new Error('keepOnlyFonts: no fonts named');
  const norm = (id) => id.replace(/\\/g, '/').split('?')[0];
  const GLOB = "'./fonts/*.ttf'";
  let hitIndex = false;
  let hitCss = false;

  return {
    name: 'vostok:keep-only-fonts',
    enforce: 'pre',

    transform(code, id) {
      const p = norm(id);

      // The URL map. Narrow the glob rather than filtering what it returned: by then
      // it has already emitted an asset for every file it named.
      if (p.endsWith('packages/fonts/src/index.ts')) {
        if (!code.includes(GLOB)) {
          throw new Error(`keepOnlyFonts: ${GLOB} is not in fonts/src/index.ts — the glob moved`);
        }
        hitIndex = true;
        return code.replace(GLOB, JSON.stringify(wanted.map((f) => `./fonts/${f}.ttf`)));
      }

      // The @font-face rules — one per line, family `VL-<id>`.
      if (p.endsWith('packages/fonts/src/fonts.css')) {
        const seen = new Set();
        const out = code.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
          const fam = /font-family:\s*VL-([\w-]+)/.exec(block)?.[1];
          if (!fam) return block;
          if (!wanted.includes(fam)) return '';
          seen.add(fam);
          return block;
        });
        const missing = wanted.filter((f) => !seen.has(f));
        if (missing.length) throw new Error(`keepOnlyFonts: no @font-face for ${missing.join(', ')}`);
        hitCss = true;
        return out;
      }
      return null;
    },

    // The failure mode this guards is a rewrite that silently never fires: the build
    // succeeds, nothing complains, and the page is 67 MB again.
    buildEnd() {
      if (!hitIndex) throw new Error('keepOnlyFonts: fonts/src/index.ts was never transformed');
      if (wantCss && !hitCss) throw new Error('keepOnlyFonts: fonts.css was never transformed');
      // The other way round is just as bad, and only reachable by declaring `css: false`
      // and then importing the stylesheet anyway: the narrowing WOULD have fired, so the
      // page is correct but every face is in it twice and nothing says so.
      if (!wantCss && hitCss) {
        throw new Error('keepOnlyFonts: css: false, but fonts.css is in the graph — every face is inlined twice');
      }
    },
  };
}

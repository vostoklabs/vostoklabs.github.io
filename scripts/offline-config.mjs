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

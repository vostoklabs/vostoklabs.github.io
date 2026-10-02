import { defineConfig, mergeConfig, type Plugin } from 'vite';
import base from './vite.config';
import { OFFLINE_OVERRIDES } from '../../scripts/offline-config.mjs';

/** The keep-it-forever single-file build. See `scripts/offline.mjs`.
 *
 *  Laser Studio is the one app whose product IS the font library: the picker needs every one
 *  of the 242 faces, so `keepOnlyFonts` is not an option. Left to the shared overrides, each
 *  face would land in the page TWICE — once as the glob's `?url` import (inlined as base64
 *  for `getFont`), once inside the 242 `@font-face` rules of `fonts.css` (inlined again for
 *  the HTML previews) — ~90 MB of page for 34 MB of fonts. So here:
 *
 *  - the `.ttf` files under `packages/fonts/src/fonts/` are NOT inlined: they are emitted as
 *    files, and `scripts/offline.mjs` folds each into its asset map exactly once, where the
 *    prelude's `fetch` hook serves them to `getFont`;
 *  - `fonts.css` is emptied at build time, and the prelude re-creates its `@font-face` rules
 *    at runtime from the same map (family `VL-<file stem>`, the package's own convention).
 *
 *  Everything else (the manifold .wasm inside the worker, the kit's UI font, icons) stays
 *  inlined as the shared overrides say — the worker runs from a Blob and cannot fetch a path. */
function fontsOnce(): Plugin {
  let hitCss = false;
  const norm = (id: string) => id.replace(/\\/g, '/').split('?')[0];
  return {
    name: 'vostok:fonts-once',
    enforce: 'pre',
    transform(code, id) {
      if (!norm(id).endsWith('packages/fonts/src/fonts.css')) return null;
      if (!/@font-face/.test(code)) throw new Error('fonts-once: fonts.css has no @font-face rules — the file moved?');
      hitCss = true;
      return '/* @font-face rules are injected at runtime by the offline prelude (scripts/offline.mjs) */\n';
    },
    buildEnd() {
      if (!hitCss) throw new Error('fonts-once: fonts.css was never transformed — every face would be in the page twice');
    },
  };
}

const isLibraryFont = (file: string) => /[\\/]packages[\\/]fonts[\\/]src[\\/]fonts[\\/][^\\/]+\.ttf$/.test(file);

export default defineConfig((env) =>
  mergeConfig(mergeConfig(typeof base === 'function' ? base(env) : base, OFFLINE_OVERRIDES), {
    plugins: [fontsOnce()],
    build: {
      // Inline everything except the font library (see above).
      assetsInlineLimit: (file: string) => !isLibraryFont(file),
    },
  }),
);

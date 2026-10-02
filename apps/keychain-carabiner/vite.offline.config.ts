import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';
import { OFFLINE_OVERRIDES, keepOnlyFonts } from '../../scripts/offline-config.mjs';

/** The keep-it-forever build. See `scripts/offline.mjs`.
 *
 *  Everything the set needs at runtime is baked in: manifold's .wasm, the geometry
 *  worker, the icon font behind the symbol picker and the four bundled SVG shapes,
 *  which the app `fetch`es out of `public/assets/shapes/`. `file://` can fetch none
 *  of that off disk.
 *
 *  `icon-fallback` is the ONLY face this app touches — `getFont(FALLBACK_FONT_ID)`
 *  for the glyph outlines, `VL-icon-fallback` in `style.css` for the picker preview.
 *  There is no font picker here, so the other 152 in `@vostok/fonts` go nowhere near
 *  the page. If a text field ever lands on the charm, widen this list. */
export default defineConfig((env) =>
  mergeConfig(typeof base === 'function' ? base(env) : base, {
    ...OFFLINE_OVERRIDES,
    plugins: [keepOnlyFonts(['icon-fallback'])],
  }),
);

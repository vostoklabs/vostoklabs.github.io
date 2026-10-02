import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';
import { OFFLINE_OVERRIDES } from '../../scripts/offline-config.mjs';

/** The keep-it-forever build. See `scripts/offline.mjs`.
 *
 *  Everything the clicker needs at runtime gets baked in: manifold's .wasm (already
 *  a data: URI by the time the worker is bundled), the geometry worker itself, the
 *  switch and block 3MF bodies, the keycap and default-clicker JSON, all 28 text
 *  fonts and the sample images. `file://` cannot fetch any of it from disk. */
export default defineConfig((env) =>
  mergeConfig(typeof base === 'function' ? base(env) : base, OFFLINE_OVERRIDES),
);

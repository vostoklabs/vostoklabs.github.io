import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';
import { OFFLINE_OVERRIDES } from '../../scripts/offline-config.mjs';

/** The keep-it-forever single-file build. See `scripts/offline.mjs`.
 *
 *  Everything the box maker needs at runtime is baked in: manifold's .wasm inside the geometry
 *  worker, the kit's UI font, the box-type and ready-made-box pictures, and the Pattern Monster
 *  library the pattern picker loads on its first open (a dynamic import, folded into the one
 *  bundle). No font library: nothing here sets text. */
export default defineConfig((env) => mergeConfig(typeof base === 'function' ? base(env) : base, OFFLINE_OVERRIDES));

import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';
import { OFFLINE_OVERRIDES } from '../../scripts/offline-config.mjs';

/** The keep-it-forever single-file build. See `scripts/offline.mjs`.
 *
 *  Everything the converter needs at runtime is baked in: the reading worker with its WASM,
 *  the kit's UI font and the sample STL. No font library: nothing here sets text. */
export default defineConfig((env) => mergeConfig(typeof base === 'function' ? base(env) : base, OFFLINE_OVERRIDES));

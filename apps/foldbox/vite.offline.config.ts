import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';
import { OFFLINE_OVERRIDES } from '../../scripts/offline-config.mjs';

/** The keep-it-forever build. See `scripts/offline.mjs`. */
export default defineConfig((env) =>
  mergeConfig(typeof base === 'function' ? base(env) : base, OFFLINE_OVERRIDES),
);

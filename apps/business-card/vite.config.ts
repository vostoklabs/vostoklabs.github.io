import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Our CSP-safe manifold rebuild (see packages/manifold-noeval/README.md).
const MANIFOLD_NOEVAL = resolve(__dirname, '../../packages/manifold-noeval');

// Relative base so the static build works on any GitHub Pages URL with no reconfig.
export default defineConfig({
  base: './',
  worker: {
    format: 'es' as const,
  },
  build: {
    target: 'es2022',
  },
  // manifold-3d ships its own WASM; keep esbuild from trying to pre-bundle it.
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  // Swap manifold's runtime for the -sDYNAMIC_EXECUTION=0 rebuild: the npm package stays installed
  // for its types, but its glue calls `new Function()`, which needs 'unsafe-eval' in a CSP. The
  // subpath rule comes first so `manifold-3d/manifold.wasm?url` resolves to the vendored .wasm.
  resolve: {
    alias: [
      { find: /^manifold-3d\//, replacement: MANIFOLD_NOEVAL + '/' },
      { find: /^manifold-3d$/, replacement: MANIFOLD_NOEVAL + '/manifold.js' },
    ],
  },
});

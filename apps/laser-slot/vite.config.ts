import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Our CSP-safe manifold rebuild (see packages/manifold-noeval/README.md).
const MANIFOLD_NOEVAL = resolve(__dirname, '../../packages/manifold-noeval');

// Relative base so the static build works on ANY GitHub Pages URL
// (user/org page at '/', or a project page at '/<repo>/') with no reconfig.
export default defineConfig({
  base: './',
  worker: {
    format: 'es' as const,
  },
  build: {
    target: 'es2022',
  },
  server: { open: true },
  // manifold-3d ships its own WASM; keep esbuild from trying to pre-bundle it.
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  // Swap manifold's RUNTIME for our -sDYNAMIC_EXECUTION=0 rebuild. The npm package stays
  // installed (it still provides the TypeScript types), but its glue calls `new Function()`
  // via Embind, which needs 'unsafe-eval' in the CSP. Subpath rule must come first so
  // `manifold-3d/manifold.wasm?url` resolves to the vendored .wasm.
  resolve: {
    alias: [
      { find: /^manifold-3d\//, replacement: MANIFOLD_NOEVAL + '/' },
      { find: /^manifold-3d$/, replacement: MANIFOLD_NOEVAL + '/manifold.js' },
    ],
  },
});

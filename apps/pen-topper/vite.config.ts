import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022' },
  // manifold-3d ships its own WASM; pre-bundling it breaks the `?url` import.
  optimizeDeps: { exclude: ['manifold-3d'] },
});

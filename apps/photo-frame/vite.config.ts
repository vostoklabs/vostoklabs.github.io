import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The solids are built by manifold-3d in a worker. Its npm glue builds functions with
// `new Function()`, which a strict content policy refuses, so both the glue and its .wasm come
// from the shelf's rebuild in packages/manifold-noeval (the npm package still supplies the types).
const NOEVAL = resolve(__dirname, '../../packages/manifold-noeval');

export default defineConfig({
  // Relative, so the static build runs under any path it is served from.
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['manifold-3d'] },
  resolve: {
    alias: [
      // The subpath first, so `manifold-3d/manifold.wasm?url` finds the rebuilt .wasm.
      { find: /^manifold-3d\//, replacement: NOEVAL + '/' },
      { find: /^manifold-3d$/, replacement: NOEVAL + '/manifold.js' },
    ],
  },
});

import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// The CSP-safe manifold rebuild (packages/manifold-noeval/README.md), aliased in every mode as
// in Laser Studio, the clicker and the keycap generator: one geometry engine to reason about,
// and no `new Function()` in any bundle. The subpath rule first, so `manifold-3d/manifold.wasm`
// resolves to the vendored .wasm.
const MANIFOLD_NOEVAL = resolve(__dirname, '../../packages/manifold-noeval');

/*
  `virtual:makerlab` — the MakerWorld seam, Laser Studio's.

  In `--mode makerworld` it resolves to the host glue (src/makerlab/, gitignored: it imports the
  NDA SDK). In every other build it resolves to the inline stub below, whose `MAKERLAB` is the
  literal `false`, so no host glue enters the module graph and the site and the offline page
  carry none of it. The access helpers are stubbed hard-locked; nothing calls them.
*/
function makerlabPlugin(enabled: boolean) {
  const VIRTUAL_ID = 'virtual:makerlab';
  const STUB_ID = '\0virtual:makerlab-stub';
  const gluePath = resolve(__dirname, 'src/makerlab/glue.ts');
  return {
    name: 'makerlab',
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return enabled ? gluePath : STUB_ID;
      return null;
    },
    load(id: string) {
      if (id !== STUB_ID) return null;
      return [
        'export const MAKERLAB = false;',
        'export const isEmbedded = () => false;',
        'export async function initMakerlab() { return null; }',
        'export const isReady = () => false;',
        'export const can = () => false;',
        'export async function sdkExport() { throw new Error("Not available in this build"); }',
        'export const isExportCancelled = () => false;',
        'export async function sdkToast() {}',
        'export const isUnlocked = () => false;',
        'export async function ensureAccess() { return false; }',
      ].join('\n');
    },
  };
}

/*
  The MakerWorld build's id, `mw-<commit>-<yyyymmdd>` (UTC): the `Build:` line of the provenance
  mark in every exported SVG and the last line of the README in the zip, so a file found in the
  wild can be traced to the submission it came from. An id set from outside wins. The public
  build is untouched: its mark still says `dev`.
*/
function makerworldBuildId(): string {
  if (process.env.VITE_BUILD_ID) return process.env.VITE_BUILD_ID;
  let commit = 'nogit';
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || commit;
  } catch {
    // Not a checkout (a copied folder): the date still says which build it was.
  }
  return `mw-${commit}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
}

export default defineConfig(({ mode }) => ({
  // Relative base so the static build works on any GitHub Pages path, and inside MakerLab, which
  // serves each release from its own versioned subpath.
  base: './',
  plugins: [makerlabPlugin(mode === 'makerworld')],
  ...(mode === 'makerworld'
    ? { define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(makerworldBuildId()) } }
    : {}),
  worker: { format: 'es' },
  // Nothing under tests/ is bundled, and a headless harness's Chrome profile in there is what
  // crashed Laser Studio's dev server mid-run (its vite.config.ts says how).
  server: { watch: { ignored: ['**/tests/**'] } },
  build: {
    target: 'es2022',
    // The embedded build goes to its own folder, never `dist/`: it carries the NDA SDK, and
    // `dist/` is what a deploy publishes. Every asset ships as its own file there.
    ...(mode === 'makerworld' ? { outDir: 'dist-mw', assetsInlineLimit: 0 } : {}),
  },
  optimizeDeps: { exclude: ['manifold-3d'] },
  resolve: {
    alias: [
      { find: /^manifold-3d\//, replacement: MANIFOLD_NOEVAL + '/' },
      { find: /^manifold-3d$/, replacement: MANIFOLD_NOEVAL + '/manifold.js' },
    ],
  },
}));

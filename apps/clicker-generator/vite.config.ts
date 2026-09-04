import { defineConfig } from 'vite';
import { readdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Our CSP-safe manifold rebuild (see packages/manifold-noeval/README.md).
const MANIFOLD_NOEVAL = resolve(__dirname, '../../packages/manifold-noeval');

const TRADEMARKED_ICONS = new Set([
  'discord.svg', 'gmail.svg', 'google.svg', 'googlechrome.svg',
  'googledrive.svg', 'googlesheets.svg', 'instagram.svg',
  'twitch.svg', 'x.svg', 'youtube.svg'
]);

// Strip third-party trademarked SVGs from dist/ during MakerWorld build while leaving self-hosted app intact.
function trademarkCleanPlugin(enabled: boolean) {
  return {
    name: 'trademark-clean',
    generateBundle(_options: unknown, bundle: Record<string, { fileName: string }>) {
      if (enabled) {
        for (const fileName of Object.keys(bundle)) {
          const basename = fileName.split('/').pop()?.toLowerCase();
          if (basename && TRADEMARKED_ICONS.has(basename)) {
            delete bundle[fileName];
          }
        }
      }
    },
    closeBundle() {
      if (enabled) {
        const distIconsDir = resolve(__dirname, 'dist', 'icons');
        if (existsSync(distIconsDir)) {
          for (const file of readdirSync(distIconsDir)) {
            if (TRADEMARKED_ICONS.has(file.toLowerCase())) {
              try { rmSync(join(distIconsDir, file), { force: true }); } catch {}
            }
          }
        }
      }
    },
  };
}

// `virtual:makerlab` — the MakerLab integration seam. In the MakerWorld build
// (`vite --mode makerworld`) it resolves to the real SDK glue (src/makerlab/glue.ts, which
// pulls in the NDA SDK). In every other build it resolves to an inline no-op stub, so the
// public site never depends on the SDK and builds fine without those gitignored files.
// `virtual:pro-pack` is the same seam for the paid features (src/pro/). Both the SDK glue and
// those sources are gitignored, so this indirection is what keeps `pnpm build` working in a
// fresh public clone: without it, mount.ts's static `./pro/panel` import is an unresolved
// module and the build dies before the MAKERLAB dead-code pass ever runs.
//
// The paid features exist ONLY in the MakerWorld build. Not locked, not hidden — absent. That
// is stronger than a client-side gate and it sidesteps the question of whether one is real.
function makerlabPlugin(enabled: boolean) {
  const VIRTUAL_ID = 'virtual:makerlab';
  const STUB_ID = '\0virtual:makerlab-stub';
  const PRO_ID = 'virtual:pro-pack';
  const PRO_STUB_ID = String.fromCharCode(0) + 'virtual:pro-pack-stub';
  const gluePath = resolve(__dirname, 'src/makerlab/glue.ts');
  const proPath = resolve(__dirname, 'src/pro/panel.ts');
  return {
    name: 'makerlab',
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return enabled ? gluePath : STUB_ID;
      // Only reach for the real panel when it is actually present: the MakerWorld build runs
      // from the full working tree, and a public clone has no src/pro/ at all.
      if (id === PRO_ID) return enabled && existsSync(proPath) ? proPath : PRO_STUB_ID;
      return null;
    },
    load(id: string) {
      if (id === PRO_STUB_ID) {
        // Same module shape as the real panel so the call site needs no null checks. It is
        // never called in the public build (the branch is fenced behind MAKERLAB); this
        // exists so the module graph resolves.
        return [
          'export function mountProFeatures() {',
          '  return { refresh() {}, destroy() {}, paramsPatch: () => ({}) };',
          '}',
        ].join('\n');
      }
      if (id === STUB_ID) {
        return [
          'export const MAKERLAB = false;',
          'export const isEmbedded = () => false;',
          'export async function initMakerlab() { return null; }',
          'export const isReady = () => false;',
          'export const can = () => false;',
          'export async function sdkExport() { throw new Error("MakerLab SDK not available in this build"); }',
          'export async function sdkToast() {}',
          // The paid surface, hard-locked. Identical module shape so app code can import it
          // unconditionally, and a public build where every gate answers `false` and every
          // price answers `null` — the paid features are fenced behind MAKERLAB anyway, so
          // this is belt and braces rather than the only thing stopping them.
          'export const SELLER_PACK = "seller_pack";',
          'export const isUnlocked = () => false;',
          'export const paymentInfo = () => null;',
          'export const isUserCancelled = () => false;',
          'export async function ensureAccess() { return false; }',
          'export const formatPrice = () => "";',
          'export const currentPrice = () => null;',
        ].join('\n');
      }
      return null;
    },
    transformIndexHtml(html: string) {
      if (!enabled) return html;
      // The MakerLab host enforces `script-src` WITHOUT 'unsafe-inline', so strip inline
      // <script> blocks (those without a src). The only one is the theme bootstrap; the
      // ui-kit sidebar footer re-applies the saved/system theme on mount, so nothing is
      // lost — the app stays CSP-clean in QA. The external module <script src> is kept.
      let result = html.replace(/[ \t]*<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>\s*/gi, '\n');
      // Strip Google Fonts <link> tags — CSP font-src: 'self' blocks external fonts.
      // Chakra Petch is already bundled locally via @vostok/ui-kit styles.css @font-face.
      result = result.replace(/[ \t]*<link[^>]*fonts\.googleapis\.com[^>]*>\s*/gi, '\n');
      result = result.replace(/[ \t]*<link[^>]*fonts\.gstatic\.com[^>]*>\s*/gi, '\n');
      return result;
    },
  };
}

// Relative base so the static build works on ANY GitHub Pages URL
// (user/org page at '/', or a project page at '/<repo>/') with no reconfig.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [trademarkCleanPlugin(mode === 'makerworld'), makerlabPlugin(mode === 'makerworld')],
  /*
    The 2-D shape editor, kept out of the public build.

    A compile-time literal rather than a runtime setting, for the reason the paid pack above
    states: absent beats hidden. `false` here folds `if (__SHAPE_EDITOR__)` to `if (false)`,
    which takes the dynamic `import('./ui/shapeEditor')` with it, so the editor and the
    geometry it pulls in never reach the bundle and no button can reveal it.

    On in `pnpm dev` and in `vite build --mode internal`; off in the plain `pnpm build` the
    deploy workflow runs. Flip a shipped build on by adding a mode here, never by editing
    the app.
  */
  define: {
    __SHAPE_EDITOR__: JSON.stringify(mode === 'development' || mode === 'internal'),
  },
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
  // via Embind, which needs 'unsafe-eval' in the CSP — MakerWorld requires that be dropped.
  // See packages/manifold-noeval/README.md. Subpath rule must come first so
  // `manifold-3d/manifold.wasm?url` resolves to the vendored .wasm.
  resolve: {
    alias: [
      { find: /^manifold-3d\//, replacement: MANIFOLD_NOEVAL + '/' },
      { find: /^manifold-3d$/, replacement: MANIFOLD_NOEVAL + '/manifold.js' },
    ],
  },
}));

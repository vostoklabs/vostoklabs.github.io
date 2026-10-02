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

// The brand icons the embedded build omits.
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
// (`vite --mode makerworld`) it resolves to the gitignored host glue (src/makerlab/glue.ts).
// In every other build it resolves to an inline no-op stub, so the public site never depends
// on the host glue and builds fine without those gitignored files.
// `virtual:pro-pack` is the same seam for the paid features (src/pro/). Both the host glue and
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
          '  return { refresh() {}, gateShape: async () => false, destroy() {}, paramsPatch: () => ({}) };',
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
          'export async function sdkExport() { throw new Error("Not available in this build"); }',
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
      // The embedded build strips inline <script> blocks (those without a src). The only one
      // is the theme bootstrap; the ui-kit sidebar footer re-applies the saved/system theme on
      // mount, so nothing is lost. The external module <script src> is kept.
      let result = html.replace(/[ \t]*<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>\s*/gi, '\n');
      // Strip Google Fonts <link> tags; the embedded build loads no external fonts.
      // Chakra Petch is already bundled locally via @vostok/ui-kit styles.css @font-face.
      result = result.replace(/[ \t]*<link[^>]*fonts\.googleapis\.com[^>]*>\s*/gi, '\n');
      result = result.replace(/[ \t]*<link[^>]*fonts\.gstatic\.com[^>]*>\s*/gi, '\n');
      return result;
    },
  };
}

// `virtual:shape-editor` — the 2-D shape editor, a paid feature fenced in src/pro/ (gitignored).
// The real module only when its source is on disk AND the mode ships it; otherwise (a public
// clone, or the plain public build) an inline stub with the same export, never called.
const SHAPE_EDITOR_ENTRY = resolve(__dirname, 'src/pro/shape-editor/shapeEditor.ts');
const SHAPE_EDITOR_MODES = new Set(['development', 'internal', 'makerworld']);
const hasShapeEditor = (mode: string): boolean =>
  SHAPE_EDITOR_MODES.has(mode) && existsSync(SHAPE_EDITOR_ENTRY);

function shapeEditorPlugin(enabled: boolean) {
  const VIRTUAL_ID = 'virtual:shape-editor';
  const STUB_ID = '\0virtual:shape-editor-stub';
  return {
    name: 'shape-editor',
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return enabled ? SHAPE_EDITOR_ENTRY : STUB_ID;
      return null;
    },
    load(id: string) {
      if (id === STUB_ID) return 'export async function openShapeEditor() { return null; }';
      return null;
    },
  };
}

// Relative base so the static build works on ANY GitHub Pages URL
// (user/org page at '/', or a project page at '/<repo>/') with no reconfig.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    trademarkCleanPlugin(mode === 'makerworld'),
    makerlabPlugin(mode === 'makerworld'),
    shapeEditorPlugin(hasShapeEditor(mode)),
  ],
  define: {
    // True only in a build that contains the shape editor (see `shapeEditorPlugin` above);
    // false folds its button and its dynamic import out of the bundle.
    __SHAPE_EDITOR__: JSON.stringify(hasShapeEditor(mode)),
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
  // via Embind, which needs 'unsafe-eval'; the rebuild lets the app run under a strict CSP.
  // See packages/manifold-noeval/README.md. Subpath rule must come first so
  // `manifold-3d/manifold.wasm?url` resolves to the vendored .wasm.
  resolve: {
    alias: [
      { find: /^manifold-3d\//, replacement: MANIFOLD_NOEVAL + '/' },
      { find: /^manifold-3d$/, replacement: MANIFOLD_NOEVAL + '/manifold.js' },
    ],
  },
}));

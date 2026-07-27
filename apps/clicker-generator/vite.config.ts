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
      if (id === STUB_ID) {
        return [
          'export const MAKERLAB = false;',
          'export const isEmbedded = () => false;',
          'export async function initMakerlab() { return null; }',
          'export const isReady = () => false;',
          'export const can = () => false;',
          'export async function sdkExport() { throw new Error("MakerLab SDK not available in this build"); }',
          'export async function sdkToast() {}',
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

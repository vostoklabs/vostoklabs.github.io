import { defineConfig } from 'vite';
import { readdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Our CSP-safe manifold rebuild (see packages/manifold-noeval/README.md).
const MANIFOLD_NOEVAL = resolve(__dirname, '../../packages/manifold-noeval');

// Pretty-print a file name for the gallery: "googlecalendar.svg" -> "Googlecalendar"
function pretty(file) {
  const base = file.replace(/\.svg$/i, '').replace(/[-_]+/g, ' ').trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

const TRADEMARKED_ICONS = new Set([
  'discord.svg', 'gmail.svg', 'google.svg', 'googlechrome.svg',
  'googledrive.svg', 'googlesheets.svg', 'instagram.svg',
  'twitch.svg', 'x.svg', 'youtube.svg'
]);

// Lists public/icons/*.svg so the gallery updates whenever you drop new icons in.
// In MakerWorld build mode, third-party trademarked brand SVGs are filtered out automatically
// to guarantee MakerWorld submission review compliance, while leaving the public site 100% intact.
function iconsManifestPlugin(isMakerWorld) {
  const iconsDir = resolve(__dirname, 'public', 'icons');
  const list = () =>
    readdirSync(iconsDir)
      .filter((f) => /\.svg$/i.test(f))
      .filter((f) => !isMakerWorld || !TRADEMARKED_ICONS.has(f.toLowerCase()))
      .sort()
      .map((f) => ({ name: pretty(f), file: `icons/${f}` }));

  return {
    name: 'icons-manifest',
    configureServer(server) {
      // Live listing in dev: drop an SVG into public/icons and refresh.
      server.middlewares.use('/icons-manifest.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(list()));
      });
    },
    generateBundle(_options, bundle) {
      // Static manifest for `npm run build`.
      this.emitFile({
        type: 'asset',
        fileName: 'icons-manifest.json',
        source: JSON.stringify(list()),
      });

      // In MakerWorld build mode, strip third-party trademarked SVG files from dist/
      if (isMakerWorld) {
        for (const fileName of Object.keys(bundle)) {
          const basename = fileName.split('/').pop()?.toLowerCase();
          if (basename && TRADEMARKED_ICONS.has(basename)) {
            delete bundle[fileName];
          }
        }
      }
    },
    closeBundle() {
      // Clean up public directory copy of trademarked icons in dist/icons/ when building for MakerWorld
      if (isMakerWorld) {
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
// (`vite --mode makerworld`) it resolves to the real SDK glue (src/makerlab/glue.js, which
// pulls in the NDA SDK). In every other build it resolves to an inline no-op stub, so the
// public site never depends on the SDK and builds fine without those gitignored files.
function makerlabPlugin(enabled) {
  const VIRTUAL_ID = 'virtual:makerlab';
  const STUB_ID = '\0virtual:makerlab-stub';
  const gluePath = resolve(__dirname, 'src/makerlab/glue.js');
  return {
    name: 'makerlab',
    resolveId(id) {
      if (id === VIRTUAL_ID) return enabled ? gluePath : STUB_ID;
      return null;
    },
    load(id) {
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
    transformIndexHtml(html) {
      if (!enabled) return html;
      // The MakerLab host enforces `script-src` WITHOUT 'unsafe-inline', so strip inline
      // <script> blocks (those without a src). The only one is the theme bootstrap; the
      // ui-kit sidebar footer re-applies the saved/system theme on mount, so nothing is
      // lost — the app stays CSP-clean in QA. The external module <script src> is kept.
      let result = html.replace(/[ \t]*<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>\s*/gi, '\n');
      // Drop markup fenced by <!-- mw:strip:start --> … <!-- mw:strip:end -->: blocks that
      // must not ship in the MakerWorld build at all (the off-platform quality callout).
      // main.js also removes it at runtime, but stripping here avoids a flash before the
      // module loads and keeps the copy out of the shipped file.
      result = result.replace(/[ \t]*<!--\s*mw:strip:start[\s\S]*?mw:strip:end\s*-->\s*/gi, '\n');
      // NOTE: an earlier version rewrote every external href to "#" here. MakerWorld's
      // review (2026-07-27) rejected that — links must stay ABSOLUTE URLs. Any link that
      // shouldn't ship in the embed is removed outright via the mw:strip fence above,
      // rather than left behind as a dead "#" anchor.
      return result;
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Relative asset URLs so the build works under any subpath (e.g. GitHub Pages
  // serves this app at /<repo-name>/, not at the domain root).
  base: './',
  plugins: [iconsManifestPlugin(mode === 'makerworld'), makerlabPlugin(mode === 'makerworld')],
  server: { open: true },
  // manifold-3d ships its own WASM; let it load the asset directly instead of prebundling.
  optimizeDeps: { exclude: ['manifold-3d'] },
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

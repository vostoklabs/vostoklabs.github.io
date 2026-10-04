import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { keepOnlyFonts } from '../../scripts/offline-config.mjs';
import { LOGO_FONTS } from './src/logoFonts';

// `virtual:cut-pack` — the build-mode seam. The DEFAULT build is print-only, and the
// cut exporter is absent from it rather than hidden.
//
// In `--mode full` this resolves to src/export/cutPack.ts (`CUT = true`, the real
// exporter). In every other build it resolves to the stub below: `CUT` is the literal
// `false`, so every `if (CUT)` branch in main.ts is dead code the bundler drops, and
// with it the last reference to `cutFiles.ts` — which therefore never enters the
// bundle. Same shape both ways, so no call site needs a null check.
//
// WHAT THIS DOES NOT DO, measured rather than assumed: the `MACHINES` and `STOCKS` tables
// live in `types.ts` next to `SHEETS` and `DEFAULT_PARAMS`, which the print-only build
// needs — so their names and notes are in the print-only bundle as data, Cricut and
// Glowforge and Laser Line and all. None of it is ever rendered: every control that would
// show it is built inside `buildCutUI()`, and the diagnostics that mention a `.lac` are
// gated on `makeMode === 'cut'`. So no cut copy is on SCREEN, which is what matters for
// the launch — but "not in the bundle to be found" would be too strong a claim, and the
// fix is to move the two tables behind this door rather than to keep saying it.
//
// The shared half — `collectPaths` and `OP_COLOR` in src/export/paths.ts — is
// deliberately NOT behind this door: the flat dieline view on the stage draws from it
// and stays in the print-only build.
function cutPackPlugin(enabled: boolean) {
  const VIRTUAL_ID = 'virtual:cut-pack';
  const STUB_ID = '\0virtual:cut-pack-stub';
  const packPath = resolve(__dirname, 'src/export/cutPack.ts');
  return {
    name: 'cut-pack',
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return enabled ? packPath : STUB_ID;
      return null;
    },
    load(id: string) {
      if (id === STUB_ID) {
        return [
          // Never reached: the one call site is fenced behind __FOLDBOX_CUT__. It
          // exists so the module shape matches and the call site needs no guard.
          'export function downloadCutFiles() {',
          '  throw new Error("Cut export is not in this build");',
          '}',
          'export function buildCutFiles() {',
          '  throw new Error("Cut export is not in this build");',
          '}',
        ].join('\n');
      }
      return null;
    },
    // index.html carries one meta description per mode, each between markers. Keep
    // this mode's, drop the other's, then strip the surviving markers too.
    transformIndexHtml(html: string) {
      const drop = (src: string, open: string, close: string) => {
        let out = src;
        for (;;) {
          const from = out.indexOf(open);
          const to = from < 0 ? -1 : out.indexOf(close, from);
          if (to < 0) return out;
          out = out.slice(0, from) + out.slice(to + close.length);
        }
      };
      const gone = enabled ? 'print' : 'cut';
      const kept = enabled ? 'cut' : 'print';
      let out = drop(html, `<!-- ${gone}:only -->`, `<!-- /${gone}:only -->`);
      out = out.split(`<!-- ${kept}:only -->`).join('').split(`<!-- /${kept}:only -->`).join('');
      return out.replace(/<!-- One description per mode;[^>]*-->/, '');
    },
  };
}

// `virtual:makerlab` — the MakerLab (MakerWorld) seam, the same one the clicker and the keycap
// generator have. In `--mode makerworld` it resolves to src/makerlab/glue.ts, which pulls in the
// NDA SDK from src/makerlab/lib/ (gitignored, see makerlab/README.md). In every other build it
// resolves to the inline stub below, whose `MAKERLAB` is the literal `false`: no SDK file is
// ever in the module graph, so the public site, `build:full` and the offline page carry none of
// it, and a public clone without src/makerlab/ still builds.
//
// The free surface only. This generator sells nothing on MakerWorld.
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
        'export async function sdkExport() { throw new Error("MakerLab SDK not available in this build"); }',
        'export async function sdkToast() {}',
      ].join('\n');
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  // The logo offers a handful of faces and the bundle carries exactly those. Without
  // this, every build emits all 153 faces in `@vostok/fonts` — and the offline build,
  // where `assetsInlineLimit` is Infinity, base64s all 25 MB of them into the page.
  //
  // `css: false` because this app never imports `fonts.css`: it registers the handful of
  // faces it needs from `getFontUrl` (FontFace API, see mount.ts), so the same bytes serve the font tiles'
  // preview AND the glyph outlines. Importing the stylesheet as well put every face in the
  // offline page twice — 2.8 MB of base64 for 1.1 MB of fonts.
  //
  // `makerworld` is the MakerLab embed, and it carries BOTH halves: MakerLab exports the cut
  // files as a zip and the printed sheet as a 3MF. So the cut half is on in `full` OR
  // `makerworld`, and nowhere else.
  plugins: [
    cutPackPlugin(mode === 'full' || mode === 'makerworld'),
    makerlabPlugin(mode === 'makerworld'),
    keepOnlyFonts(LOGO_FONTS, { css: false }),
  ],
  // The flag itself, as a literal the bundler can fold. Swapping the MODULE is what
  // keeps `cutFiles.ts` out of the print-only bundle; this is what keeps the cut
  // UI out of it. Both are needed: an exported `const CUT = false` does not survive
  // the module boundary as a constant, so `if (CUT)` branches shipped intact — the
  // exporter was gone and every string that described it was still readable.
  define: { __FOLDBOX_CUT__: JSON.stringify(mode === 'full' || mode === 'makerworld') },
  // The MakerLab build goes to its own folder, never `dist/`. `dist/` is what deploy.yml
  // publishes, and a local full-mode bundle (cut half and SDK included) must never be able to
  // sit where the public build lives. `assetsInlineLimit: 0` because the host's CSP has
  // `font-src 'self'` and `connect-src 'self'`: an asset Vite inlined as a `data:` URI would be
  // refused as a font and as a fetch, so in this build every asset is a file.
  ...(mode === 'makerworld' ? { build: { outDir: 'dist-mw', assetsInlineLimit: 0 } } : {}),
}));

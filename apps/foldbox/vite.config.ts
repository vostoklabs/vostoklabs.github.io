import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// `virtual:cut-pack` — the phase seam. Foldbox can do two things with one net: cut it
// from card on a laser or a blade cutter, or print it flat as a thin grooved sheet.
// Only the printing half is launched, so the DEFAULT build is print-only and the cut
// half has to be absent from it — not hidden, absent. A hidden feature is one devtools
// window away from being an announcement, and this repo is the live site.
//
// In `--mode full` this resolves to src/export/cutPack.ts (`CUT = true`, the real
// exporter). In every other build it resolves to the stub below: `CUT` is the literal
// `false`, so every `if (CUT)` branch in main.ts is dead code the bundler drops, and
// with it the last reference to `cutFiles.ts` — which therefore never enters the
// bundle. Same shape both ways, so no call site needs a null check.
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
        ].join('\n');
      }
      return null;
    },
    // index.html carries both phases' meta description, each inside a fence. Strip
    // the one that does not belong: a page is not print-only while its <head> still
    // sells a cut export, and search engines read the head, not the bundle.
    //
    // Then strip the SURVIVING fence markers too. They are comments, so nothing
    // renders them — but view-source is a thing, and `<!-- print:only -->` sitting in
    // a shipped <head> says there is another mode as plainly as the description
    // would have. The explanation that used to live in index.html said it outright:
    // it shipped for a week reading "the launched page never advertises a cut export
    // it does not have", in the head of the launched page. A comment about a fence is
    // still on the wrong side of it, which is why the reasoning is here instead.
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

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [cutPackPlugin(mode === 'full')],
  // The flag itself, as a literal the bundler can fold. Swapping the MODULE is what
  // keeps `cutFiles.ts` out of the print-only bundle; this is what keeps the cut
  // UI out of it. Both are needed: an exported `const CUT = false` does not survive
  // the module boundary as a constant, so `if (CUT)` branches shipped intact — the
  // exporter was gone and every string that described it was still readable.
  define: { __FOLDBOX_CUT__: JSON.stringify(mode === 'full') },
}));

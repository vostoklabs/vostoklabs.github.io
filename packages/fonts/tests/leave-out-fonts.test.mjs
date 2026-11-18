/*
  pnpm --filter @vostok/fonts test

  A build that leaves faces out (`leaveOutFonts`, vite.js) offers them nowhere. The package's
  index is bundled here exactly as that plugin rewrites it, leaving out Anton and the Chinese
  reserve, and what this guards:
   - FONTS lists every face but those two, and `inThisBuild` says so;
   - the curated list loses Anton and nothing else;
   - Chinese text Noto Sans SC lacks has no face to fall back to (the reserve is not offered),
     and text Noto writes still starts on Noto;
   - with nothing left out, the same index offers the whole registry and the reserve as before.
*/
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { leaveOutFonts } from '../vite.js';

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
};

const entry = fileURLToPath(new URL('./leave-out-fonts.entry.mts', import.meta.url));
const shim = fileURLToPath(new URL('./vite-glob-shim.mts', import.meta.url));

/** The package bundled for node, with the index rewritten by `leaveOutFonts(drop)` (none: as is). */
async function load(drop, name) {
  const plugin = drop.length ? leaveOutFonts(drop) : null;
  const outfile = fileURLToPath(new URL(`../node_modules/.cache/leave-out-${name}.mjs`, import.meta.url));
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['opentype.js'],
    define: { 'import.meta.glob': 'globalThis.__viteGlob' },
    inject: [shim],
    outfile,
    logLevel: 'error',
    plugins: plugin
      ? [{
          name: 'leave-out',
          setup(b) {
            b.onLoad({ filter: /[\\/]fonts[\\/]src[\\/]index\.ts$/ }, (args) => ({
              contents: plugin.transform(readFileSync(args.path, 'utf8'), args.path),
              loader: 'ts',
            }));
          },
        }]
      : [],
  });
  return import(pathToFileURL(outfile).href);
}

const RESERVE = 'source-han-sans-cn-light';
const cut = await load(['anton', RESERVE], 'cut');
const whole = await load([], 'whole');

ok(cut.FONTS.length === whole.FONTS.length - 2, `FONTS loses the two faces: ${whole.FONTS.length} → ${cut.FONTS.length}`);
ok(!cut.FONTS.some((f) => f.id === 'anton' || f.id === RESERVE), 'neither is in FONTS');
ok(!cut.inThisBuild('anton') && !cut.inThisBuild(RESERVE) && cut.inThisBuild('pacifico'), 'inThisBuild names the two, and only them');
ok(cut.curatedFonts().length === whole.curatedFonts().length - 1 && !cut.curatedFonts().some((f) => f.id === 'anton'), 'the curated list loses Anton and nothing else');

const faces = (m) => m.FONTS.map((f) => f.id);
const writes = (m) => (id, t) => m.fontSupportsText(id, t);
const rare = (m) => m.fallbackFaces('张琪', { faces: faces(m), writes: writes(m) });
ok(rare(whole).length === 1 && rare(whole)[0] === RESERVE, `whole: a rarer hanzi lands on the reserve (${rare(whole).join(', ')})`);
ok(rare(cut).length === 0, `cut: no face is offered for it (${rare(cut).join(', ')})`);
const common = cut.fallbackFaces('张三', { faces: faces(cut), writes: writes(cut) });
ok(common[0] === 'noto-sans-sc', `cut: common Chinese still starts on Noto Sans SC (${common.join(', ')})`);
ok(whole.inThisBuild('anton') && whole.FONTS.some((f) => f.id === 'anton'), 'nothing left out: Anton is offered');

console.log(failed ? `leave out fonts: ${failed} FAILED` : 'leave out fonts: a face left out is offered nowhere');
process.exit(failed ? 1 : 0);

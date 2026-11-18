/*
  pnpm --filter @vostok/fonts test

  Bundled with a glob answering with the URLs a build gives an app at <site>/clicker/
  (tests/vite-glob-site.mts), and run twice: with `site`, `import.meta.env` is a website build's
  (VITE_SITE_FONTS "shared/fonts/"), and every font file, through every door of the package (the
  library, the symbol font, the other weights), is fetched from the site's one shared copy; with
  `app`, the env is every other build's, and every file comes from the app's own, exactly as before.
*/
import { getFontUrl } from '../src/index';
import { iconFontUrl } from '../src/iconFont';
import { siteFontUrl } from '../src/site';
import '../src/weights';

const mode = process.argv[2];
let failed = 0;
const ok = (cond: boolean, msg: string): void => {
  if (!cond) {
    failed++;
    console.error(`  FAIL  ${msg} [${mode}]`);
  }
};

const APP = 'https://site.test/clicker/assets/';
const want: Record<string, [string, string]> = {
  'source-han-sans-cn-light': ['shared/fonts/source-han-sans-cn-light.otf', 'source-han-sans-cn-light-DFp6YVuz.otf'],
  'noto-sans-sc': ['shared/fonts/noto-sans-sc.ttf', 'noto-sans-sc-C0o7kma7.ttf'],
  anton: ['shared/fonts/anton.ttf', 'anton-Q1w2E3r4.ttf'],
  'icon-fallback': ['shared/fonts/icon-fallback.ttf', 'icon-fallback-Ic0n_F0n.ttf'],
  'roboto-bold': ['shared/fonts/weights/roboto-bold.ttf', 'roboto-bold-B0ld-123.ttf'],
};

if (mode === 'site') {
  for (const [id, [shared]] of Object.entries(want)) {
    const url = getFontUrl(id);
    ok(url === `https://site.test/${shared}`, `${id} comes from the site's shared folder (${url})`);
  }
  ok(iconFontUrl === 'https://site.test/shared/fonts/icon-fallback.ttf', `the symbol font's own door too (${iconFontUrl})`);
  // On a project page the site is a folder of the domain; the shared copy is in that folder.
  const project = siteFontUrl('./fonts/anton.ttf', 'https://someone.github.io/tools/clicker/assets/anton-Q1w2E3r4.ttf');
  ok(project === 'https://someone.github.io/tools/shared/fonts/anton.ttf', `on a project page, from the site's own folder (${project})`);
} else if (mode === 'app') {
  for (const [id, [, own]] of Object.entries(want)) {
    const url = getFontUrl(id);
    ok(url === APP + own, `${id} comes from the app's own files (${url})`);
  }
  ok(iconFontUrl === `${APP}icon-fallback-Ic0n_F0n.ttf`, `and the symbol font's own door too (${iconFontUrl})`);
} else {
  ok(false, 'run with `site` or `app`');
}

console.log(failed ? `site font urls [${mode}]: ${failed} FAILED` : mode === 'site'
  ? 'site font urls [site]: every face, the symbol font and the other weights from the shared copy'
  : 'site font urls [app]: every face from the app\'s own files, as before');
process.exit(failed ? 1 : 0);

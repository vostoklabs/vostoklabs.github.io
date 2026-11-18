/*
  pnpm --filter @vostok/fonts test

  scripts/site-fonts.mjs leaves the website one copy of each font file, where the apps were built
  to fetch it (VITE_SITE_FONTS), and points the apps' stylesheets at it. What this guards:
   - every app's copy goes and one copy, the package's own bytes, is put in the shared folder, at
     the path it has in the package (a face, a .otf face, another weight in weights/);
   - a face is told from another whose name starts the same (roboto, roboto-mono, roboto-bold);
   - each stylesheet's url() for a copy now names the shared file, and resolves to it; every
     other url() is left as it was;
   - it refuses, and changes nothing, when an app was built without the folder (it would lose its
     faces), when a copy holds other bytes, when a copy is not at <route>/assets/ (where the apps
     look up from), when a page would still name a copy that goes, and when the folder is unset or
     points outside the site.
*/
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/site-fonts.mjs', import.meta.url));
const FONTS = fileURLToPath(new URL('../src/fonts/', import.meta.url));

/** Package files and the names a build gives their copies (Vite's 8-character hash). */
const FACES = [
  ['source-han-sans-cn-light.otf', 'source-han-sans-cn-light-DFp6YVuz.otf'],
  ['roboto.ttf', 'roboto-Ab3_x9Zq.ttf'],
  ['roboto-mono.ttf', 'roboto-mono-Q1w-E3r4.ttf'],
  ['weights/roboto-bold.ttf', 'roboto-bold-Zz9yX8w7.ttf'],
];
/** What a build's stylesheet says: the faces by their copies, and two urls that are not ours. */
const SHEET = [
  ...FACES.map(([file, copy]) => `@font-face{font-family:VL-${posix.basename(file)};src:url(./${copy})}`),
  '@font-face{font-family:Chakra Petch;src:url(./ChakraPetch-Medium-BR1ody1F.woff2) format("woff2")}',
  '.x{background:url("data:image/svg+xml,%3Csvg%3E")}',
].join('');

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
};

/** A site with the given apps, each { route, js: what its bundle says, at: where its copies are,
 *  bytes: what the first copy holds instead, html: its page }, and the hub at the root. */
function site(apps) {
  const root = mkdtempSync(join(tmpdir(), 'site-fonts-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>hub</title>');
  for (const a of apps) {
    const at = join(root, a.at ?? `${a.route}/assets`);
    mkdirSync(at, { recursive: true });
    mkdirSync(join(root, a.route, 'assets'), { recursive: true });
    writeFileSync(join(root, a.route, 'assets', 'index-abc.js'), a.js ?? 'const env={"VITE_SITE_FONTS":"shared/fonts/"};');
    writeFileSync(join(root, a.route, 'assets', 'index-abc.css'), SHEET);
    writeFileSync(join(root, a.route, 'index.html'), a.html ?? '<!doctype html><link rel="stylesheet" href="./assets/index-abc.css">');
    FACES.forEach(([file, copy], i) => {
      if (i === 0 && a.bytes) writeFileSync(join(at, copy), a.bytes);
      else copyFileSync(join(FONTS, file), join(at, copy));
    });
  }
  return root;
}
const run = (root, dir = 'shared/fonts/') =>
  spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8', env: { ...process.env, VITE_SITE_FONTS: dir ?? '' } });

{
  const root = site([{ route: 'clicker' }, { route: 'keycap' }]);
  const r = run(root);
  ok(r.status === 0, `two apps: it succeeds (${r.stderr.trim()})`);
  for (const [file, copy] of FACES) {
    const shared = join(root, 'shared/fonts', file);
    ok(existsSync(shared) && readFileSync(shared).equals(readFileSync(join(FONTS, file))), `one copy of ${file}, the package's own bytes, at shared/fonts/${file}`);
    ok(!existsSync(join(root, 'clicker/assets', copy)) && !existsSync(join(root, 'keycap/assets', copy)), `and the apps' own copies of ${file} are gone`);
  }
  for (const route of ['clicker', 'keycap']) {
    const css = readFileSync(join(root, route, 'assets/index-abc.css'), 'utf8');
    for (const [file] of FACES) {
      const url = `../../shared/fonts/${file}`;
      ok(css.includes(`url(${url})`), `${route}'s stylesheet names ${url}`);
      ok(existsSync(join(root, route, 'assets', url)), `and that resolves, from the stylesheet, to the shared file`);
    }
    ok(!FACES.some(([, copy]) => css.includes(copy)), `${route}'s stylesheet names none of its old copies`);
    ok(css.includes('url(./ChakraPetch-Medium-BR1ody1F.woff2)') && css.includes('url("data:image/svg+xml,%3Csvg%3E")'), `${route}'s other urls are left as they were`);
  }
  ok(/8 app copies .* replaced by 4 files at shared\/fonts\//.test(r.stdout), `and it says what it did (${r.stdout.trim().split('\n').pop()})`);
  rmSync(root, { recursive: true, force: true });
}

const refuses = (apps, why, dir) => {
  const root = site(apps);
  const r = run(root, dir);
  ok(r.status === 1, `${why}: it fails (exit ${r.status})`);
  ok(apps.every((a) => FACES.every(([, copy]) => existsSync(join(root, a.at ?? `${a.route}/assets`, copy)))), `${why}: and every app keeps every copy`);
  ok(apps.every((a) => readFileSync(join(root, a.route, 'assets/index-abc.css'), 'utf8') === SHEET), `${why}: and every stylesheet is as it was`);
  ok(!existsSync(join(root, 'shared')), `${why}: and nothing is put in the shared folder`);
  rmSync(root, { recursive: true, force: true });
};
refuses([{ route: 'clicker' }, { route: 'old', js: 'const env={};' }], 'an app built without VITE_SITE_FONTS');
refuses([{ route: 'clicker' }, { route: 'odd', bytes: Buffer.from('not the face') }], 'a copy with other bytes');
refuses([{ route: 'clicker' }, { route: 'deep', at: 'deep/sub/assets' }], 'copies deeper than <route>/assets/');
refuses([{ route: 'clicker', html: `<style>@font-face{font-family:X;src:url(./assets/${FACES[1][1]})}</style>` }], 'a page that names a copy itself');
refuses([{ route: 'clicker' }], 'VITE_SITE_FONTS unset', null);
refuses([{ route: 'clicker' }], 'VITE_SITE_FONTS outside the site', '../fonts/');

// Run twice (a deploy re-run on the same folder): the second finds nothing left to do, and the
// site still works.
{
  const root = site([{ route: 'clicker' }]);
  run(root);
  const r = run(root);
  ok(r.status === 0 && /0 app copies/.test(r.stdout), `a second run changes nothing (${r.stderr.trim() || r.stdout.trim()})`);
  ok(existsSync(join(root, 'shared/fonts/roboto.ttf')), 'and the shared copies are still there');
  rmSync(root, { recursive: true, force: true });
}

console.log(failed ? `site fonts: ${failed} FAILED` : 'site fonts: one copy of each file for the site, stylesheets pointed at it, and refused wherever an app would lose one');
process.exit(failed ? 1 : 0);

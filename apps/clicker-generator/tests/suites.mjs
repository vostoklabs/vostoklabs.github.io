#!/usr/bin/env node
/*
  The clicker's node suites that used to be run by hand, one command each, from their headers.

    node apps/clicker-generator/tests/suites.mjs                  (part of pnpm test)
    node apps/clicker-generator/tests/suites.mjs switch-fit shapes   (only the ones named)

  Each suite is bundled the way its header says and run in its own process from the repo root,
  where the suites look for the app's assets (`process.cwd()`). The flags differ per suite, and
  getting one wrong does not fail quietly, it crashes the suite:

    manifold   manifold-3d stays external, so its WASM loads from beside its own module;
    xmldom     @xmldom/xmldom stays external, the DOMParser the SVG reader is given under node;
    env        `import.meta.env` is defined, for the modules that read the asset base from it;
    fonts      `import.meta.glob` is defined and its stand-in injected (Vite's glob, which
               @vostok/fonts reads its font table through, does not exist under node).

  Every suite runs even when an earlier one fails, so one red suite cannot hide another; the
  exit code is 1 if any failed. A suite still running after 15 minutes (CLICKER_SUITE_TIMEOUT_S
  sets another limit, in seconds) is stopped and counted as failed, saying so: a hang fails the
  run instead of holding it until CI gives up on it.
*/
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = dirname(fileURLToPath(import.meta.url));
const APP = resolve(TESTS, '..');
const ROOT = resolve(APP, '../..');

/** How long one suite may run, in seconds: many times the slowest, so only a hang reaches it. */
const TIMEOUT_S = Number(process.env.CLICKER_SUITE_TIMEOUT_S) || 15 * 60;

/** Suite name (tests/<name>.test.ts) -> what its bundle needs. */
const SUITES = {
  'block-layout': [],
  'blocks-body': ['manifold'],
  'blocks-fit': ['manifold'],
  'fit-controls': ['manifold'],
  'font-fallback': ['fonts'],
  'model-cut': ['manifold', 'env'],
  packs: ['manifold', 'xmldom'],
  plating: [],
  quantize: ['env'],
  'rebuild-heap': ['manifold', 'xmldom'],
  'seller-features': ['manifold'],
  shapes: ['manifold', 'env'],
  'svg-bg-removal': ['xmldom'],
  'svg-coverage': ['xmldom'],
  'svg-import': ['xmldom'],
  'switch-fit': ['manifold', 'env'],
  'text-sizing': ['manifold', 'fonts'],
  // What every export writes, and every model file reads as, pinned (tests/golden/).
  'golden/export-matrix': ['manifold', 'xmldom', 'env', 'fonts'],
  'golden/readers': [],
};

const asked = process.argv.slice(2);
const unknown = asked.filter((n) => !(n in SUITES));
if (unknown.length) {
  console.error(`No such suite: ${unknown.join(', ')}. The suites: ${Object.keys(SUITES).join(', ')}.`);
  process.exit(2);
}

const cache = join(APP, 'node_modules', '.cache', 'suites');
mkdirSync(cache, { recursive: true });

const results = [];
for (const [name, needs] of Object.entries(SUITES)) {
  if (asked.length && !asked.includes(name)) continue;
  const outfile = join(cache, `${name.replaceAll('/', '-')}.mjs`);
  const started = Date.now();
  console.log(`\n=== ${name}`);
  try {
    await build({
      entryPoints: [join(TESTS, `${name}.test.ts`)],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'error',
      external: [...(needs.includes('manifold') ? ['manifold-3d'] : []), ...(needs.includes('xmldom') ? ['@xmldom/xmldom'] : [])],
      define: {
        ...(needs.includes('env') ? { 'import.meta.env': JSON.stringify({ BASE_URL: '/' }) } : {}),
        ...(needs.includes('fonts') ? { 'import.meta.glob': 'globalThis.__viteGlob' } : {}),
      },
      inject: needs.includes('fonts') ? [join(ROOT, 'packages/fonts/tests/vite-glob-shim.mts')] : [],
    });
  } catch (err) {
    console.error(`${name}: did not bundle\n${err instanceof Error ? err.message : err}`);
    results.push({ name, ok: false, secs: 0 });
    continue;
  }
  const run = spawnSync(process.execPath, [outfile], { cwd: ROOT, stdio: 'inherit', timeout: TIMEOUT_S * 1000, killSignal: 'SIGKILL' });
  rmSync(outfile, { force: true });
  const hung = run.error?.code === 'ETIMEDOUT';
  if (hung) console.error(`\n${name}: still running after ${TIMEOUT_S} s, so it was stopped and counts as failed.`);
  results.push({ name, ok: run.status === 0, hung, secs: (Date.now() - started) / 1000 });
}

const failed = results.filter((r) => !r.ok);
console.log('\nclicker suites:');
for (const r of results) console.log(`  ${r.ok ? 'pass' : r.hung ? 'HUNG' : 'FAIL'}  ${r.name}  (${r.secs.toFixed(1)} s)`);
console.log(failed.length ? `\n${failed.length} of ${results.length} suites failed: ${failed.map((r) => r.name).join(', ')}` : `\nall ${results.length} suites passed`);
process.exit(failed.length ? 1 : 0);

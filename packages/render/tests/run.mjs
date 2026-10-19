#!/usr/bin/env node
/*
  The render package's node tests: each tests/*.test.ts bundled with esbuild and run in turn.
  Each file prints its failures and a summary; this adds them up.

    pnpm --filter @vostok/render test
    node tests/run.mjs studio colors      (only the ones named)

  What needs WebGL or a 2D canvas (the preview, a still's pixels) is not here: node has neither.
  What decides what a still shows, and every byte of the model readers, is.
*/
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = dirname(fileURLToPath(import.meta.url));
const cache = join(resolve(TESTS, '..'), 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });

let failedFiles = 0;
let files = 0;
const total = { pass: 0, fail: 0, asserts: 0 };
const asked = process.argv.slice(2);
for (const name of readdirSync(TESTS).filter((f) => f.endsWith('.test.ts')).sort()) {
  if (asked.length && !asked.includes(name.replace(/\.test\.ts$/, ''))) continue;
  files++;
  const outfile = join(cache, name.replace(/\.ts$/, '.mjs'));
  await build({ entryPoints: [join(TESTS, name)], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
  const run = spawnSync(process.execPath, [outfile], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  let reported = false;
  for (const line of (run.stdout ?? '').split(/\r?\n/)) {
    const m = /^#checks \S+ pass=(\d+) fail=(\d+) asserts=(\d+)$/.exec(line);
    if (!m) {
      if (line) console.log(line);
      continue;
    }
    reported = true;
    total.pass += Number(m[1]);
    total.fail += Number(m[2]);
    total.asserts += Number(m[3]);
  }
  if (run.status !== 0 || !reported) {
    failedFiles++;
    if (!reported) console.log(`${name}: did not finish (exit ${run.status})`);
  }
}
console.log(`\nrender: ${total.pass + total.fail} checks in ${files} files, ${total.fail ? `${total.fail} FAILED` : 'all passed'} (${total.asserts} assertions)`);
process.exit(failedFiles ? 1 : 0);

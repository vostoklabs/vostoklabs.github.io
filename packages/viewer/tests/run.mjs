#!/usr/bin/env node
/*
  The viewer's node tests: each tests/*.test.ts bundled with esbuild and run in turn, with the
  garbage collector in reach (`--expose-gc`), so a test can show what dispose lets go of.

    pnpm --filter @vostok/viewer test
    node tests/run.mjs default-path      (only the ones named)
*/
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = dirname(fileURLToPath(import.meta.url));
const cache = join(resolve(TESTS, '..'), 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });

let failed = 0;
const asked = process.argv.slice(2);
for (const name of readdirSync(TESTS).filter((f) => f.endsWith('.test.ts')).sort()) {
  if (asked.length && !asked.includes(name.replace(/\.test\.ts$/, ''))) continue;
  const outfile = join(cache, name.replace(/\.ts$/, '.mjs'));
  await build({ entryPoints: [join(TESTS, name)], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
  const run = spawnSync(process.execPath, ['--expose-gc', outfile], { stdio: 'inherit' });
  if (run.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);

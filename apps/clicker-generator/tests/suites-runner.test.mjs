#!/usr/bin/env node
/*
  The clicker's suite runner, and the switches its suites read, checked from outside: what a run
  does with the environment it is given.

    node apps/clicker-generator/tests/suites-runner.test.mjs      (part of pnpm test)

  GOLDEN_UPDATE: 1 rewrites the export matrix's table, unset compares against it, and any other
  value ("0", "true") stops the run before a design is built and leaves the table as it was.
*/
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TESTS, '../../..');
const RUNNER = join(TESTS, 'suites.mjs');
const GOLDEN = join(TESTS, 'golden/export-matrix.json');

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
};

/** One run of the runner, with these variables set, as pnpm test would start it. */
const run = (env, ...suites) => {
  const r = spawnSync(process.execPath, [RUNNER, ...suites], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

/* ------------------------------------------------------------------ GOLDEN_UPDATE */

for (const value of ['0', 'true']) {
  const before = readFileSync(GOLDEN);
  const written = statSync(GOLDEN).mtimeMs;
  const { status, out } = run({ GOLDEN_UPDATE: value }, 'golden/export-matrix');
  check(`GOLDEN_UPDATE=${value}: the run stops before building, and says what to set`,
    status !== 0 && !out.includes('\nbuilt ') && out.includes('GOLDEN_UPDATE=1'), `exit ${status}; ${out.trim().split('\n').slice(-3).join(' | ')}`);
  check(`GOLDEN_UPDATE=${value}: the table is as it was, not written again`, readFileSync(GOLDEN).equals(before) && statSync(GOLDEN).mtimeMs === written);
}

/* ------------------------------------------------------------------ report */

console.log(`\nsuites runner: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);

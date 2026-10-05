/*
  node scripts/check-layers.test.mjs

  The font-registry rule of check-layers.mjs: a worker or a node test never loads the registry.
  The real script runs on a small workspace written to a temporary folder, copied in beside it,
  since it reads the tree it sits in. What it must hold:
   - a worker that reaches the registry only through its own app's files is caught: it imports
     `../engine/build`, which imports `@vostok/laser`'s root, whose text module loads the fonts;
   - a worker is found by its `new Worker(new URL(…, import.meta.url))` as well as by its name,
     and a brace import naming a value beside a type still loads the module;
   - braces holding only `type` names are erased at build, so they load nothing, whether in the
     worker or further down its imports;
   - a node test is followed through its relative imports the same way;
   - each finding is cleared by an exception written "<file> -> <import>", and the summary counts
     every worker.
*/

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'check-layers-'));
const write = (path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const lines = (...l) => `${l.join('\n')}\n`;

let checks = 0;
let failed = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failed++; console.error(`  FAIL  ${msg}`); }
}

try {
  mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
  copyFileSync(join(SCRIPTS, 'check-layers.mjs'), join(root, 'scripts', 'check-layers.mjs'));
  copyFileSync(join(SCRIPTS, 'lib', 'source.mjs'), join(root, 'scripts', 'lib', 'source.mjs'));

  // The registry, and a laser root that reaches it through its text module.
  write('packages/fonts/package.json', JSON.stringify({ name: '@vostok/fonts', exports: { '.': './src/index.ts' } }));
  write('packages/fonts/src/index.ts', lines("export const FONTS = import.meta.glob('./fonts/*.ttf');", 'export type FontChoice = string;'));
  write('packages/laser/package.json', JSON.stringify({ name: '@vostok/laser', exports: { '.': './src/index.ts', './csg2d': './src/csg2d.ts' } }));
  write('packages/laser/src/index.ts', lines("export { buildText } from './text';", "export { union } from './csg2d';"));
  write('packages/laser/src/text.ts', lines("import { FONTS } from '@vostok/fonts';", 'export const buildText = () => FONTS;'));
  write('packages/laser/src/csg2d.ts', lines('export const union = () => 1;'));

  // An app with three workers, one of them under a plain name, and a node test.
  write('apps/demo/src/main.ts', lines(
    "new Worker(new URL('./engine/plain.ts', import.meta.url), { type: 'module' });",
    "new Worker(new URL('./workers/relay.worker.ts', import.meta.url), { type: 'module' });",
    "new Worker(new URL('./workers/typed.worker.ts', import.meta.url), { type: 'module' });",
  ));
  write('apps/demo/src/engine/plain.ts', lines(
    "import { type FontChoice, FONTS } from '@vostok/fonts';",
    'export const f: FontChoice = String(FONTS);',
  ));
  write('apps/demo/src/workers/relay.worker.ts', lines("import { build } from '../engine/build';", 'build();'));
  write('apps/demo/src/engine/build.ts', lines("import { buildText } from '@vostok/laser';", 'export const build = () => buildText();'));
  write('apps/demo/src/workers/typed.worker.ts', lines(
    "import { type FontChoice } from '@vostok/fonts';",
    "import { shape } from '../engine/shape';",
    'export const f: FontChoice = shape();',
  ));
  write('apps/demo/src/engine/shape.ts', lines(
    "import { union } from '@vostok/laser/csg2d';",
    "import { type FontChoice } from '@vostok/fonts';",
    "export { type FontChoice } from '@vostok/fonts';",
    'export const shape = (): FontChoice => String(union());',
  ));
  write('apps/demo/tests/measure.test.ts', lines("import { build } from '../src/engine/build';", 'build();'));

  const run = () => spawnSync(process.execPath, [join(root, 'scripts', 'check-layers.mjs')], { encoding: 'utf8' });

  const first = run();
  const flagged = (file, spec) => first.stderr.includes(`${file} imports ${spec}, which loads the font registry`);
  ok(first.status === 1, `fails while a worker or a test loads the registry (exit ${first.status})`);
  ok(flagged('apps/demo/src/workers/relay.worker.ts', '../engine/build'), 'a worker reaching the registry only through a relative import is caught');
  ok(
    first.stderr.includes('(apps/demo/src/engine/build.ts > packages/laser/src/index.ts > packages/laser/src/text.ts > packages/fonts/src/index.ts)'),
    'the finding names the chain to the registry',
  );
  ok(flagged('apps/demo/src/engine/plain.ts', '@vostok/fonts'), 'a worker made with new Worker(new URL()) under a plain name is caught');
  ok(!first.stderr.includes('typed.worker.ts'), 'braces holding only type names load nothing');
  ok(flagged('apps/demo/tests/measure.test.ts', '../src/engine/build'), 'a node test is followed through its relative imports');
  ok(!first.stderr.includes('apps/demo/src/engine/build.ts imports'), 'a file that is neither a worker nor a test is not judged');

  write('scripts/budgets.private.json', JSON.stringify({
    layersKnown: [
      'apps/demo/src/workers/relay.worker.ts -> ../engine/build',
      'apps/demo/src/engine/plain.ts -> @vostok/fonts',
      'apps/demo/tests/measure.test.ts -> ../src/engine/build',
    ],
  }));
  const second = run();
  ok(second.status === 0, `passes once each finding is a listed exception (exit ${second.status}) ${second.stderr.trim()}`);
  ok(
    second.stdout.includes('no font registry in 3 workers or 1 node test files'),
    `the summary counts every worker: ${second.stdout.trim().split('\n').pop()}`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`check-layers: ${checks - failed} passed, ${failed} failed`);
if (failed) process.exit(1);

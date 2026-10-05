/*
  The keycap's project file, saved and read back the way Save and Load do it.

    node apps/keycap-generator/tests/project-file.test.mjs      (part of pnpm test)

  Save writes `projectFileText(collectState())` and Load hands the picked file to the kit's
  `readProjectFile` with the keycap's `PROJECT_FILE` (src/projectFile.js, mount.js). This saves a
  project as collectState() writes one, reads it back, and offers Load the files it has to
  refuse: another generator's project, `{}`, and text that is not JSON. A file saved before the
  `app` key existed still opens.

  collectState() lives inside mount()'s closure, so the keys it writes are read from mount.js's
  source: the keys Load insists on must be ones every Save writes, or no new file would open.

  The kit's toast needs a document; the kit's own stand-in (packages/ui-kit/tests/support) is the
  one every app test uses.
*/
import { build } from 'esbuild';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(APP, 'node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
const outfile = join(cacheDir, `project-file-${process.pid}.mjs`);
await build({
  stdin: {
    contents: [
      "export { PROJECT_FILE, projectFileText } from './src/projectFile.js';",
      "export { readProjectFile } from '@vostok/ui-kit';",
      "export { installDom } from '../../packages/ui-kit/tests/support/dom';",
    ].join('\n'),
    resolveDir: APP,
    sourcefile: 'project-file-entry.js',
    loader: 'js',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
});
const { PROJECT_FILE, projectFileText, readProjectFile, installDom } = await import(pathToFileURL(outfile).href);
rmSync(outfile, { force: true });

installDom();
let logged = 0;
console.error = () => { logged++; };

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fileOf = (text, name = 'keycap-project.json') => new File([text], name, { type: 'application/json' });

/** Load as mount.js does it: what `apply` was handed, and what readProjectFile returned. */
async function load(file) {
  const applied = [];
  const got = await readProjectFile(file, (data) => { applied.push(data); }, PROJECT_FILE);
  return { got, applied };
}

// ------------------------------------------------------------------ what Save writes
// mount.js collectState(): the keys of its object literal, read from the source.
const mountSrc = readFileSync(join(APP, 'src', 'mount.js'), 'utf8');
const body = mountSrc.match(/function collectState\(\) \{\s*const projectState = \{([\s\S]*?)\n\s*\};/)?.[1] ?? '';
const savedKeys = [...body.matchAll(/^\s*(\w+)\s*[:,]/gm)].map((m) => m[1]);
check('collectState() is where the test expects it, and writes fields', savedKeys.length >= 10, savedKeys.join(', '));
check(
  'every key Load requires is one Save always writes',
  PROJECT_FILE.keys.every((k) => savedKeys.includes(k)),
  `requires ${PROJECT_FILE.keys.join(', ')}`,
);

/** A project as collectState() writes one: every field it always writes, plus the legend. */
const state = {
  size: 8.4, depth: 0.55, rot: -15, offx: 0.5, offy: -1, stemTol: 0.06,
  capColor: '#161616', logoColor: '#f7f7f5',
  mirror: false, homingBump: true, through: false, single: false,
  profile: 'standard-profile', unit: '1u', wallGenerator: 'classic',
  legend: { contours: [[[0, 0], [10, 0], [10, 10]]], strokeGeoms: [], box: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } }, name: 'A-Roboto' },
};
check(
  'the test project carries every field collectState() writes',
  savedKeys.every((k) => k in state),
  savedKeys.filter((k) => !(k in state)).join(', ') || 'all there',
);

const text = projectFileText(state);
const written = JSON.parse(text);
check('the file names the keycap generator, first', Object.keys(written)[0] === 'app' && written.app === PROJECT_FILE.app, JSON.stringify(written.app));
check('the file is indented as Save has always written it', text.startsWith('{\n  "app": "keycap-generator",\n  "size": 8.4,'));
const { app: _app, ...rest } = written;
check('apart from app, the file is the project', same(rest, state));

// ------------------------------------------------------------------ what Load opens
const back = await load(fileOf(text));
check('Load opens it and hands the project over once', back.applied.length === 1 && back.got !== null);
check('what Load hands over is what was saved, without app', same(back.applied[0], state) && !('app' in back.applied[0]));

const older = await load(fileOf(JSON.stringify(state, null, 2)));
check('a project saved before the app key existed still opens', older.applied.length === 1 && same(older.applied[0], state));

check('nothing was refused so far', logged === 0, `${logged} logged`);

// ------------------------------------------------------------------ what Load refuses
const refused = async (name, file) => {
  const before = logged;
  const r = await load(file);
  check(name, r.got === null && r.applied.length === 0 && logged === before + 1, `returned ${JSON.stringify(r.got)}`);
};
await refused('{} is refused, not opened as the defaults', fileOf('{}'));
await refused('another generator\'s project is refused', fileOf(JSON.stringify({ app: 'clicker-generator', ...state })));
await refused('an older file from another generator, without the keycap\'s keys, is refused',
  fileOf(JSON.stringify({ style: 'tuck', lengthMm: 60, widthMm: 40, heightMm: 30 })));
await refused('text that is not JSON is refused', fileOf('size=8', 'notes.txt'));
await refused('a JSON list is refused', fileOf('[8, 0.5, 0]'));

console.log(fails.length ? `\n${fails.length} FAILED, ${pass} passed` : `\nall ${pass} project file checks pass`);
process.exit(fails.length ? 1 : 0);

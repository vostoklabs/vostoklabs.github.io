/*
  readProjectFile(), without a browser: a stand-in document catches the toasts.

    pnpm --filter @vostok/ui-kit test
*/
import { readProjectFile, markProject, type ProjectShape } from '../src/components/project-file';

const toasts: string[] = [];
const fakeNode = () => ({
  className: '',
  textContent: '',
  isConnected: false,
  style: { cssText: '' },
  setAttribute() {},
  addEventListener() {},
  remove() {},
  append(...c: { className?: string; textContent?: string }[]) {
    for (const x of c) if (x.className?.includes('vl-toast--error')) toasts.push(x.textContent ?? '');
  },
});
const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  createElement: fakeNode,
  createTextNode: (text: string) => ({ text }),
  body: { append(n: { isConnected: boolean }) { n.isConnected = true; } },
};
g.window = { setTimeout: () => 0 };
let logged = 0;
console.error = () => { logged++; };

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};

const fileOf = (name: string, bytes: number[] | Uint8Array) => {
  const b = Uint8Array.from(bytes);
  return { name, arrayBuffer: async () => b.buffer } as unknown as File;
};
const utf8 = (s: string) => [...new TextEncoder().encode(s)];
const utf16 = (s: string, le: boolean) =>
  [...s].flatMap((ch) => { const c = ch.charCodeAt(0); return le ? [c & 0xff, c >> 8] : [c >> 8, c & 0xff]; });
const json = '{"width":40,"label":"Café"}';
const same = (v: unknown) => JSON.stringify(v) === json;

let applied: unknown[] = [];
const got = await readProjectFile(fileOf('a.json', utf8(json)), (d) => { applied.push(d); });
check('reads a project and hands it to apply once', same(got) && applied.length === 1 && same(applied[0]));
check('a UTF-8 file with a byte-order mark', same(await readProjectFile(fileOf('b.json', [0xef, 0xbb, 0xbf, ...utf8(json)]))));
check('a UTF-16 file, little-endian, as Notepad saves "Unicode"', same(await readProjectFile(fileOf('c.json', [0xff, 0xfe, ...utf16(json, true)]))));
check('a UTF-16 file, big-endian', same(await readProjectFile(fileOf('d.json', [0xfe, 0xff, ...utf16(json, false)]))));
check('nothing failed so far: no toast, nothing logged', toasts.length === 0 && logged === 0);

const notJson = await readProjectFile(fileOf('notes.txt', utf8('hello')));
check('not JSON: null, one toast naming the file, the cause logged', notJson === null && toasts.length === 1 && toasts[0] === '"notes.txt" is not a project file' && logged === 1);

toasts.length = 0; logged = 0;
const thrown = await readProjectFile(fileOf('e.json', utf8(json)), () => { throw new Error('no settings'); });
check('apply throws: null and one toast', thrown === null && toasts.length === 1 && logged === 1);

toasts.length = 0; logged = 0;
const rejected = await readProjectFile(fileOf('f.json', utf8(json)), async () => { await Promise.resolve(); throw new Error('later'); });
check('apply rejects later: null and one toast', rejected === null && toasts.length === 1 && logged === 1);

let finished = false;
await readProjectFile(fileOf('g.json', utf8(json)), async () => { await new Promise((r) => setTimeout(r, 5)); finished = true; });
check('apply is awaited before it returns', finished);

/* An app's shape: its id, and the keys every file it ever saved has. */
const SHAPE: ProjectShape = { app: 'box-app', keys: ['style', 'lengthMm'] };
const saved = { style: 'mailer', lengthMm: 90, logo: 'none' };
const marked = JSON.stringify(markProject(SHAPE, saved), null, 2);
check('markProject puts the app id first and keeps every field', marked.startsWith('{\n  "app": "box-app",') && JSON.stringify(JSON.parse(marked)) === JSON.stringify({ app: 'box-app', ...saved }));

const opened = async (name: string, text: string) => {
  toasts.length = 0; logged = 0;
  applied = [];
  return readProjectFile(fileOf(name, utf8(text)), (d) => { applied.push(d); }, SHAPE);
};
const unmarked = JSON.stringify(saved);
check('a file this app saved opens, and apply gets it without the marker',
  JSON.stringify(await opened('h.json', marked)) === unmarked && applied.length === 1 && JSON.stringify(applied[0]) === unmarked && toasts.length === 0);
check('an older file with no marker but every key still opens',
  JSON.stringify(await opened('i.json', unmarked)) === unmarked && applied.length === 1 && toasts.length === 0);
check("another app's file is refused, says so, and apply never runs",
  (await opened('magnet-project.json', JSON.stringify({ app: 'magnet-app', v: 2, settings: {} }))) === null &&
    applied.length === 0 && toasts[0] === '"magnet-project.json" was saved by another generator' && logged === 1);
check("another app's file is refused even when it has this app's keys",
  (await opened('j.json', JSON.stringify({ app: 'other-app', style: 'x', lengthMm: 1 }))) === null && applied.length === 0 && toasts.length === 1);
check('{} is refused as not a project file',
  (await opened('k.json', '{}')) === null && applied.length === 0 && toasts[0] === '"k.json" is not a project file' && logged === 1);
check('a file missing one of the keys is refused',
  (await opened('l.json', JSON.stringify({ style: 'mailer' }))) === null && applied.length === 0 && toasts.length === 1);
check('JSON that is not an object is refused (an array, null, a number)',
  (await opened('m.json', '[1]')) === null && (await opened('n.json', 'null')) === null && (await opened('o.json', '7')) === null && applied.length === 0);
check('without a shape nothing is checked, as before',
  same(await readProjectFile(fileOf('p.json', utf8(json)))) && JSON.stringify(await readProjectFile(fileOf('q.json', utf8('{}')))) === '{}');

console.log(`\nproject file: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);

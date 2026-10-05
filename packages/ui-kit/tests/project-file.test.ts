/*
  readProjectFile(), without a browser: a stand-in document catches the toasts.

    pnpm --filter @vostok/ui-kit test
*/
import { readProjectFile } from '../src/components/project-file';

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

console.log(`\nproject file: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);

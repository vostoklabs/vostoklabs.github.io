/*
  Diagnostics, without a browser: a stand-in document records what the blocks draw.

    pnpm --filter @vostok/ui-kit test

  The guard for invariant #13. A warning that means "this will not print" blocks export, and
  every warning is shown, never only the first. Each case is one way that went wrong: a status
  line showing `warnings[0]` and nothing of the rest, an app that showed none, and an export
  that wrote a model its own warning said would not print.
*/
import { stageStatus } from '../src/components/stage';
import { diagnosticsList } from '../src/components/diagnostics-list';
import { exportPanel } from '../src/components/export-panel';
import { buildLoop } from '../src/build-loop';
import { assertExportable, ExportBlockedError, type Diagnostic } from '../src/diagnostics';

/* ------------------------------------------------------------ stand-in document */

interface FakeNode {
  tag: string;
  className: string;
  textContent: string;
  hidden: boolean;
  disabled: boolean;
  attrs: Record<string, string>;
  kids: FakeNode[];
  listeners: Record<string, (e?: unknown) => unknown>;
  isConnected: boolean;
  style: { cssText: string };
  classList: { toggle(c: string, on?: boolean): void };
  setAttribute(k: string, v: string): void;
  removeAttribute(k: string): void;
  addEventListener(type: string, fn: (e?: unknown) => unknown): void;
  append(...c: (FakeNode | string)[]): void;
  replaceChildren(...c: FakeNode[]): void;
  remove(): void;
}

function node(tag: string): FakeNode {
  const n: FakeNode = {
    tag,
    className: '',
    textContent: '',
    hidden: false,
    disabled: false,
    attrs: {},
    kids: [],
    listeners: {},
    isConnected: true,
    style: { cssText: '' },
    classList: {
      toggle(c, on) {
        const set = new Set(n.className.split(/\s+/).filter(Boolean));
        if (on ?? !set.has(c)) set.add(c);
        else set.delete(c);
        n.className = [...set].join(' ');
      },
    },
    setAttribute(k, v) { n.attrs[k] = v; },
    removeAttribute(k) { delete n.attrs[k]; },
    addEventListener(type, fn) { n.listeners[type] = fn; },
    append(...c) { for (const x of c) { if (typeof x === 'string') n.textContent += x; else n.kids.push(x); } },
    replaceChildren(...c) { n.kids = c; },
    remove() { n.isConnected = false; },
  };
  return n;
}

const body = node('body');
const g = globalThis as unknown as Record<string, unknown>;
g.document = { createElement: node, createTextNode: (text: string) => ({ ...node('#text'), textContent: text }), body };
// The toast's own timer: never fired here, so every toast stays where the test can read it.
g.window = { setTimeout: () => 0 };

/** All the text under a node, as a reader would meet it. */
const textOf = (n: FakeNode): string => [n.textContent, ...n.kids.map(textOf)].filter(Boolean).join(' ');
const find = (n: FakeNode, tag: string): FakeNode[] => [...(n.tag === tag ? [n] : []), ...n.kids.flatMap((k) => find(k, tag))];
const toasts = () => body.kids.flatMap((c) => c.kids);
const made = (n: unknown) => n as FakeNode;

/* ------------------------------------------------------------------------ cases */

let passed = 0;
let failed = 0;
const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, fn: () => Promise<void> | void) => cases.push([name, fn]);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const THIN: Diagnostic = { level: 'warning', message: 'The letters are 0.6 mm wide in places.', fix: 'Pick a bolder font.', code: 'thin' };
const OFF_PLATE: Diagnostic = { level: 'error', message: 'The text runs off the plate.', fix: 'Make it smaller, or pick a bigger plate.', code: 'plate' };
const SWAP: Diagnostic = { level: 'info', message: 'The letters print in a second colour.', fix: 'Pause at layer 12 to swap.', code: 'swap' };
const HOLE: Diagnostic = { level: 'warning', message: 'The ring hole is 2.8 mm across.', code: 'hole' };

test('three diagnostics all show: the list draws every one, in order, each with its fix', () => {
  const list = diagnosticsList();
  list.set([THIN, OFF_PLATE, SWAP]);
  const root = made(list.root);
  const rows = find(root, 'li');
  assert(rows.length === 3, `expected 3 rows, got ${rows.length}`);
  for (const [i, d] of [THIN, OFF_PLATE, SWAP].entries()) {
    const text = textOf(rows[i]!);
    assert(text.includes(d.message) && text.includes(d.fix!), `row ${i + 1} reads "${text}"`);
    assert(rows[i]!.className.includes(`vl-diag--${d.level}`), `row ${i + 1} is not marked ${d.level}`);
  }
  assert(!root.hidden, 'a list with diagnostics in it must show');
});

test('three diagnostics all show: the status line gives the worst one, not the first, and the count', () => {
  const status = stageStatus('');
  status.setDiagnostics([THIN, OFF_PLATE, HOLE], 'Ready');
  const root = made(status.root);
  assert(root.textContent === `3 problems · ${OFF_PLATE.message}`, `status reads "${root.textContent}"`);
  assert(root.className.includes('vl-stage-status--error'), `status is "${root.className}", not the error colour`);
});

test('warnings alone: the first warning in the warning colour, with the count', () => {
  const status = stageStatus('');
  status.setDiagnostics([HOLE, THIN], 'Ready');
  const root = made(status.root);
  assert(root.textContent === `2 problems · ${HOLE.message}`, `status reads "${root.textContent}"`);
  assert(root.className.includes('vl-stage-status--warn'), `status is "${root.className}"`);
});

test('one problem is shown as itself; notes stay in the list and the line reads the app’s own text', () => {
  const status = stageStatus('');
  const root = made(status.root);
  status.setDiagnostics([SWAP, OFF_PLATE], 'Ready');
  assert(root.textContent === OFF_PLATE.message, `one error reads "${root.textContent}"`);
  status.setDiagnostics([SWAP], 'Ready · 2 parts');
  assert(root.textContent === 'Ready · 2 parts' && root.className === 'vl-stage-status', `notes only: "${root.textContent}" (${root.className})`);
  status.setDiagnostics([], 'Ready · 2 parts');
  assert(root.textContent === 'Ready · 2 parts' && root.className === 'vl-stage-status', 'nothing found reads the app’s text');
});

test('an empty list hides the block, and a list with something in it shows it again', () => {
  const list = diagnosticsList();
  const root = made(list.root);
  assert(root.hidden, 'a list with nothing set yet must not show');
  list.set([SWAP]);
  assert(!root.hidden && find(root, 'li').length === 1, 'one note shows');
  list.set([]);
  assert(root.hidden && find(root, 'li').length === 0, 'cleared, it hides and draws nothing');
});

test('assertExportable refuses in the first error’s own words, and lets warnings and notes through', () => {
  let caught: unknown = null;
  try {
    assertExportable([THIN, OFF_PLATE, { ...OFF_PLATE, message: 'A second error.' }]);
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof ExportBlockedError, 'expected ExportBlockedError');
  assert(caught.message === OFF_PLATE.message && caught.diagnostic === OFF_PLATE, `refused with "${caught.message}"`);
  assertExportable([THIN, SWAP, HOLE]);
  assertExportable([]);
});

/** A model whose build reports what `found` holds when it runs. */
function model(found: Diagnostic[]) {
  const state = { found, builds: 0, shown: [] as Diagnostic[][] };
  const loop = buildLoop({
    debounceMs: 1000,
    run: () => ({ build: ++state.builds, diagnostics: state.found }),
    diagnose: (r) => r.diagnostics,
    onResult: (r) => state.shown.push(r.diagnostics),
  });
  return { state, loop };
}

test('an error blocks export: settled() refuses in the error’s own words, and the preview still gets the build', async () => {
  const { state, loop } = model([THIN, OFF_PLATE]);
  loop.request();
  let refused: unknown = null;
  await loop.settled().catch((e) => { refused = e; });
  assert(refused instanceof ExportBlockedError, `expected ExportBlockedError, got ${String(refused)}`);
  assert(refused.message === OFF_PLATE.message, `refused with "${refused.message}"`);
  assert(state.shown.length === 1 && state.shown[0]!.length === 2, 'the build reached the preview with its diagnostics');
  assert(loop.latest?.build === 1, 'the preview keeps the build');
});

test('clearing the error lifts the block, even when export is pressed before the rebuild starts', async () => {
  const { state, loop } = model([OFF_PLATE]);
  loop.request();
  await loop.settled().catch(() => {});
  state.found = [THIN]; // the user fixes it; a warning is left
  loop.request(); // the debounce has not fired
  const got = await loop.settled(); // and they press Download at once
  assert(got.build === 2 && got.diagnostics[0] === THIN, `export got build ${got.build}`);
});

test('and the other way: an error that appears is refused, not the clean build before it', async () => {
  const { state, loop } = model([]);
  loop.request();
  assert((await loop.settled()).build === 1, 'first build exports');
  state.found = [SWAP, OFF_PLATE];
  loop.request();
  let msg = '';
  await loop.settled().catch((e: Error) => { msg = e.message; });
  assert(msg === OFF_PLATE.message, `expected the new error to refuse, got "${msg}"`);
});

test('the export panel shows the refusal, and clearing the error lets the same button export', async () => {
  const { state, loop } = model([THIN, OFF_PLATE, SWAP]);
  loop.request();
  const exported: number[] = [];
  const panel = made(exportPanel({
    formats: [{ id: '3mf', label: '3MF' }],
    onExport: async () => { exported.push((await loop.settled()).build); },
  }));
  const button = find(panel, 'button')[0]!;
  const before = toasts().length;
  await button.listeners.click!();
  const shown = toasts().slice(before);
  assert(exported.length === 0, 'nothing may be exported while an error stands');
  assert(shown.length === 1 && shown[0]!.textContent === OFF_PLATE.message, `toast: ${shown.map((t) => t.textContent).join(' | ') || 'none'}`);
  assert(shown[0]!.className.includes('vl-toast--error'), 'the refusal is shown as an error');
  assert(!button.disabled, 'the button comes back after a refusal');

  state.found = [THIN, SWAP];
  loop.request();
  await button.listeners.click!();
  assert(exported.length === 1 && exported[0] === 2, `after the fix, export got ${exported.join(',') || 'nothing'}`);
});

test('without diagnose, a loop is unchanged: a result carrying an error still exports', async () => {
  const loop = buildLoop({ run: () => ({ diagnostics: [OFF_PLATE] }) });
  loop.request();
  const got = await loop.settled();
  assert(got.diagnostics[0] === OFF_PLATE, 'settled() must resolve as it always has');
});

test('a diagnose that throws refuses the export instead of leaving it waiting', async () => {
  const loop = buildLoop({ run: () => 1, diagnose: () => { throw new Error('no diagnostics'); } });
  loop.request();
  const outcome = await Promise.race([
    loop.settled().then(() => 'resolved', (e: Error) => e.message),
    tick(200).then(() => 'hung'),
  ]);
  assert(outcome === 'no diagnostics', `expected a refusal, got "${outcome}"`);
});

/* ------------------------------------------------------------------------ run */

for (const [name, fn] of cases) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${(err as Error).message}`);
  }
}
console.log(`\ndiagnostics: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

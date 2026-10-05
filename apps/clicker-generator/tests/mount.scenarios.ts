/*
  Scenarios for tests/mount.test.mjs: the clicker's real mount(), and what Export writes.

  Each one is something a user does (moves a slider, picks a font, opens a project, opens the fit
  test) and then presses Export, at the worst moment: before the debounce runs out, while a font
  or a model is still loading, while a build is on its way or after one failed. Export must write
  the build of what the controls show, once it is on screen, or refuse in the status line's
  words, and never hang.

  Time is virtual: `clock.advance(130)` is "the debounce runs out". The worker answers each
  request 5 ms after the one before it unless a scenario says otherwise, and a built part is
  named after the design it came from ("built:image:cc=4|w=40|st=0"), so a check can say which
  build reached the file.
*/
import { deflateSync } from 'fflate';
import { FakeElement, installDom } from '../../../packages/ui-kit/tests/support/dom';
import { installClock } from '../../../packages/ui-kit/tests/support/clock';
import { FakeWorker, installWorker } from '../../../packages/ui-kit/tests/support/worker';
import { kit, resetKit } from '../../../packages/ui-kit/tests/support/kit';
import { knobs, reset, seen, setMakerlab, traces } from './mount.stand-ins';
import { mount } from '../src/mount';

installDom();
const clock = installClock();
installWorker();

/* What the app logs goes here rather than to the terminal; a failing check prints the tail. */
const logged: string[] = [];
const print = (line: string) => process.stdout.write(`${line}\n`);
for (const level of ['log', 'warn', 'error'] as const) {
  console[level] = (...args: unknown[]) => void logged.push(args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
}
const unhandled: unknown[] = [];
process.on('unhandledRejection', (e) => void unhandled.push(e));

/* ---------------------------------------------------------------- the network */

/** Slow downloads, by a fragment of their URL, and ones that fail. */
const net = { ms: {} as Record<string, number>, fails: new Set<string>() };
(globalThis as Record<string, unknown>).fetch = async (url: string) => {
  const u = String(url);
  const slow = Object.keys(net.ms).find((k) => u.includes(k));
  if (slow) await new Promise((r) => setTimeout(r, net.ms[slow]));
  const ok = ![...net.fails].some((k) => u.includes(k));
  return {
    ok,
    status: ok ? 200 : 404,
    arrayBuffer: async () => new ArrayBuffer(8),
    text: async () => '',
    json: async () =>
      u.includes('default-clicker')
        ? [{ kind: 'cap', group: 'top', colorRgb: [1, 2, 3], name: 'default-sample', numProp: 3, vertProperties: [0, 0, 0, 1, 0, 0, 0, 1, 0], triVerts: [0, 1, 2] }]
        : {},
  };
};

/* ---------------------------------------------------------------- the geometry worker */

/** How the worker answers: in the order it was asked, one reply per request, as the real one. */
const worker = {
  /** How long each request takes, ms. */
  ms: 5 as number | ((msg: any) => number),
  /** A message to fail a request with, or null to build it. */
  failIf: null as null | ((msg: any) => string | null),
  /** Requests that kill the worker. */
  crashIf: null as null | ((msg: any) => boolean),
  /** Requests it never answers. */
  silentIf: null as null | ((msg: any) => boolean),
  /** Requests that cannot even be posted to it, as one holding something uncloneable. */
  refuseIf: null as null | ((msg: any) => boolean),
};
const inbox: { w: FakeWorker; msg: any }[] = [];
let working = false;

const partsNamed = (name: string) => [
  { kind: 'cap', group: 'top', colorRgb: [9, 9, 9], name, numProp: 3, vertProperties: new Float32Array(0), triVerts: new Uint32Array(0) },
];
/** The design a build was traced from, by the index its first point carries. */
const traceOf = (msg: any) => traces[msg.regions?.[0]?.rings?.[0]?.[0]?.[0]] ?? '?';

function answer(msg: any): unknown {
  switch (msg.type) {
    case 'init':
      return { type: 'initDone', socketInfo: '', stemInfo: '', switchInfo: '', switchMesh: { vertProperties: new Float32Array(0), triVerts: new Uint32Array(0), numProp: 3 }, switchColumnMm: 17 };
    case 'buildClicker':
      return { type: 'parts', parts: partsNamed(`built:${traceOf(msg)}|w=${msg.params.capWidthMm}|st=${msg.params.stemFitMm}`), switchPlacements: [], warnings: [], requestId: msg.requestId };
    case 'buildBlocks':
      return { type: 'parts', parts: partsNamed(`blocks:${traceOf(msg)}|w=${msg.params.capWidthMm}`), switchPlacements: [], warnings: [], requestId: msg.requestId };
    case 'importModel':
      // The samples are 40 mm; anything uploaded is 60 mm, so its cut is told apart from theirs.
      return { type: 'modelInfo', info: { name: msg.name, fileTriangles: 1, triangles: 1, sizeMm: msg.name.startsWith('skull') ? [40, 40, 40] : [60, 60, 60], notes: [] } };
    case 'buildModel':
      return {
        type: 'parts',
        parts: partsNamed(`model:${msg.params.cutter}|size=${msg.params.sizeMm}|st=${msg.params.stemFitMm}`),
        switchPlacements: [],
        warnings: [],
        requestId: msg.requestId,
        modelMeta: { sizeMm: [msg.params.sizeMm, msg.params.sizeMm, msg.params.sizeMm], cutHeightMm: 20, cutRangeMm: [5, 35], switchAt: { x: 0, y: 0, z: 0, rotation: 0 }, buttonAt: null, movingGrams: 1, flattenMm: 0, canHideSeam: false, hideSeam: false, assemblyMinZ: 0 },
      };
    case 'buildFitStrip':
      return { type: 'parts', parts: partsNamed(`tiles:${msg.labels.map((l: any) => l.fitMm).join(',')}`), switchPlacements: [], warnings: [], requestId: msg.requestId };
  }
  return { type: 'error', message: `unknown request ${msg.type}`, request: msg.type };
}

async function work() {
  if (working) return;
  working = true;
  while (inbox.length) {
    const { w, msg } = inbox.shift()!;
    const ms = typeof worker.ms === 'function' ? worker.ms(msg) : worker.ms;
    await new Promise((r) => setTimeout(r, ms));
    if (w.terminated || worker.silentIf?.(msg)) continue;
    if (worker.crashIf?.(msg)) {
      w.crash('out of memory');
      continue;
    }
    const failure = worker.failIf?.(msg);
    w.reply(failure ? { type: 'error', message: failure, request: msg.type, requestId: msg.requestId } : answer(msg));
  }
  working = false;
}

/* ---------------------------------------------------------------- harness */

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  print(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (!ok) {
    failures++;
    for (const line of logged.slice(-6)) print(`        log: ${line.split('\n')[0]}`);
  }
};

/** A promise's state, readable without awaiting it. */
function watch<T>(p: Promise<T>) {
  const state: { done: boolean; value?: T; error?: Error } = { done: false };
  p.then(
    (value) => Object.assign(state, { done: true, value }),
    (error: Error) => Object.assign(state, { done: true, error }),
  );
  return state;
}

/** The clicker, mounted afresh and settled on its startup sample. `prepare` sets the scene first. */
async function fresh(prepare?: () => void) {
  reset();
  resetKit();
  FakeWorker.reset();
  inbox.length = 0;
  working = false;
  Object.assign(worker, { ms: 5, failIf: null, crashIf: null, silentIf: null, refuseIf: null });
  net.ms = {};
  net.fails = new Set();
  clock.errors.length = 0;
  unhandled.length = 0;
  logged.length = 0;
  FakeWorker.onPost = (w, msg) => {
    if (worker.refuseIf?.(msg)) throw new DOMException('The object could not be cloned.', 'DataCloneError');
    inbox.push({ w, msg });
    void work();
  };
  FakeWorker.onStart = (w) => w.reply({ type: 'ready' });
  prepare?.();
  setMakerlab(knobs.makerlab);
  const unmount = mount(new FakeElement('div') as unknown as HTMLElement);
  await clock.advance(50);
  return unmount;
}

/** The end of a scenario: unmount, and check nothing threw where no one would hear it. A
 *  scenario that expects a throw takes it out of `clock.errors` first. */
function finish(unmount: () => void) {
  unmount();
  const stray = [...clock.errors, ...unhandled].map((e) => (e as Error)?.message ?? String(e));
  if (stray.length) check('…and nothing threw that nobody caught', false, stray.join(' | '));
}

const ui = () => seen.ui;
const status = () => String(seen.state?.status ?? '');
const onScreen = () => seen.screen[0]?.name as string | undefined;
const written = () => seen.downloads.map((d) => d.parts[0]?.name as string);
const shown = (name: string | undefined) => String(name).replace(/\n/g, '\\n');
const describe = (exp: { done: boolean; error?: Error }) =>
  !exp.done ? 'still waiting' : exp.error ? `refused: ${exp.error.message}` : `wrote ${shown(written().join(', ') || 'nothing')}`;
/** Export, as its button presses it, with its state readable at any time. */
const press = () => watch<void>(ui().onExport());


/* ================================================================= edits, then Export */

{
  const unmount = await fresh();
  check('startup: the sample is on screen', onScreen() === 'default-sample', shown(onScreen()));
  const exp = press();
  await clock.advance(10);
  check('startup: Export writes the sample as it is', exp.done && !exp.error && written()[0] === 'default-sample', describe(exp));
  check('…with the licence nudge, once', kit.licence.length === 1, `${kit.licence.length} nudges`);
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onWidth(40);
  const exp = press();
  await clock.advance(129);
  const waited = !exp.done;
  await clock.advance(40);
  check('a slider moved, then Export at once: Export waits out the debounce', waited);
  check('…and writes the build with the new width, the one on screen', written()[0] === 'built:image:cc=4|w=40|st=0' && written()[0] === onScreen(), `${describe(exp)}; screen ${shown(onScreen())}`);
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onImportMode('text');
  await clock.advance(50);
  ui().onTextChange('Hi');
  const exp = press();
  await clock.advance(219);
  const waited = !exp.done;
  await clock.advance(40);
  check('text typed, then Export at once: Export waits out the typing\'s debounce', waited);
  check('…and writes the typed text', written()[0] === 'built:text:Hi:font=helvetiker-regular|w=35|st=0', describe(exp));
  finish(unmount);
}

{
  const unmount = await fresh();
  worker.ms = 120;
  ui().onWidth(41);
  await clock.advance(140); // the debounce has run out: the build for 41 is in the worker
  const exp = press();
  await clock.advance(20);
  ui().onWidth(42); // another edit while Export waits
  await clock.advance(700);
  check('Export during a slow build, then another edit: the newest edit is written', exp.done && written()[0] === 'built:image:cc=4|w=42|st=0', describe(exp));
  check('…and only that one', seen.downloads.length === 1, `${seen.downloads.length} files`);
  finish(unmount);
}

{
  const unmount = await fresh();
  worker.failIf = (msg) => (msg.type === 'buildClicker' && msg.params.capWidthMm === 44 ? 'RangeError: the boolean failed\n    at buildClicker' : null);
  ui().onWidth(44);
  await clock.advance(200);
  const refused = press();
  await clock.advance(10);
  check('a build that failed: Export refuses, in the status line\'s words', refused.error?.message === 'Error: RangeError: the boolean failed' && status() === refused.error?.message, `${describe(refused)}; status "${status()}"`);
  check('…and writes nothing, so no licence nudge either', seen.downloads.length === 0 && kit.licence.length === 0);
  worker.failIf = null;
  ui().onWidth(45);
  const exp = press();
  await clock.advance(200);
  check('…until the next edit builds', written()[0] === 'built:image:cc=4|w=45|st=0', describe(exp));
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(200);
  worker.refuseIf = (msg) => msg.type === 'buildClicker';
  ui().onEdgeStep('capTop', 0.5); // a live edit: its build goes out with no busy overlay
  const exp = press();
  await clock.advance(300);
  check('a build that cannot even be sent to the worker: Export is answered, not left waiting', exp.done, describe(exp));
  check('…and the page hears about it, as an uncaught error', clock.errors.length === 1 && (clock.errors[0] as Error).name === 'DataCloneError', String(clock.errors[0]));
  clock.errors.length = 0;
  finish(unmount);
}

/* ================================================================= traces that fail */

{
  const unmount = await fresh();
  ui().onImportMode('svg');
  ui().onSelectSvg('good', 'good.svg');
  await clock.advance(50);
  check('SVG mode: the SVG is built', onScreen() === 'built:svg:good|w=35|st=0', shown(onScreen()));
  knobs.svgTraceThrows = 'Unexpected end of SVG';
  ui().onSelectSvg('bad', 'bad.svg');
  await clock.advance(50);
  const refused = press();
  await clock.advance(10);
  check('an SVG whose trace throws: Export refuses rather than writing the SVG before it', refused.error?.message === 'Error: Unexpected end of SVG', describe(refused));
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(200);
  check('image mode: the picture is traced and built', onScreen() === 'built:image:cc=4|w=40|st=0', shown(onScreen()));
  knobs.imageTraceThrows = 'Array buffer allocation failed';
  ui().onColorCount(3);
  await clock.advance(300);
  const refused = press();
  await clock.advance(10);
  check('a picture whose trace throws: Export refuses rather than writing the picture before it', refused.error?.message === 'Error: Array buffer allocation failed', describe(refused));
  check('…and the busy state comes down, with the status saying why', seen.state?.building === false && status() === 'Error: Array buffer allocation failed', `building ${seen.state?.building}; status "${status()}"`);
  finish(unmount);
}

/* ======================================== Export waits for what is still on its way to a build */

{
  const unmount = await fresh();
  ui().onImportMode('text');
  await clock.advance(50);
  check('Text mode: the text is built in Standard', onScreen() === 'built:text:Custom\nText:font=helvetiker-regular|w=35|st=0', shown(onScreen()));
  knobs.fontMs.pacifico = 300;
  ui().onFontSelect('pacifico');
  const exp = press();
  await clock.advance(250);
  const waited = !exp.done;
  await clock.advance(100);
  check('a font picked, still loading: Export waits for it', waited, describe(exp));
  check('…and writes the text set in it', written()[0] === 'built:text:Custom\nText:font=pacifico|w=35|st=0', describe(exp));
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onImportMode('text');
  await clock.advance(50);
  knobs.fontMs.pacifico = 100;
  knobs.fontFails.add('pacifico');
  ui().onFontSelect('pacifico');
  const exp = press();
  await clock.advance(200);
  check('a font picked that fails to load: Export is answered, not left waiting', exp.done, describe(exp));
  check('…and the status says so', status() === 'That font could not be loaded. Pick another one.', status());
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onImportMode('text');
  await clock.advance(50);
  knobs.cantWrite.add('helvetiker-regular');
  knobs.fontMs.pacifico = 600; // slower than the typing's own debounce
  ui().onTextChange('한글');
  const exp = press();
  await clock.advance(500); // the debounce's build has landed, drawn in Standard: the face was not ready
  const waited = !exp.done;
  await clock.advance(200);
  check('letters the face cannot write: the text moves to a face that can, and says so', kit.toasts.length === 1, kit.toasts.map((t) => t.message).join(' | '));
  check('…and Export waits for that face to load', waited, describe(exp));
  check('…then writes the text set in it', written()[0] === 'built:text:한글:font=pacifico|w=35|st=0', describe(exp));
  finish(unmount);
}

{
  const unmount = await fresh();
  knobs.fontMs.pacifico = 150;
  const project = { version: 3, settings: { importMode: 'text', currentText: 'Loaded', currentFontId: 'pacifico', capWidthMm: 44 } };
  ui().onLoadProject(new File([JSON.stringify(project)], 'clicker-project.json'));
  await clock.advance(0); // the file is read, and its settings start to land
  const exp = press();
  await clock.advance(100);
  const waited = !exp.done;
  await clock.advance(400);
  check('a project still loading (its font): Export waits for it', waited, describe(exp));
  check('…and writes the project, not what was on screen before it', written()[0] === 'built:text:Loaded:font=pacifico|w=44|st=0', describe(exp));
  finish(unmount);
}

{
  const unmount = await fresh();
  knobs.fontMs.pacifico = 150;
  const project = {
    version: 3,
    settings: { importMode: 'model', currentFontId: 'pacifico', modelCut: { sizeMm: 50 } },
    model: { name: 'figure.stl', data: Buffer.from(deflateSync(new Uint8Array(16))).toString('base64') },
  };
  ui().onLoadProject(new File([JSON.stringify(project)], 'clicker-project.json'));
  await clock.advance(0);
  const exp = press(); // while the project's font loads; its model is read after it
  await clock.advance(400);
  check('a Model-mode project with its model inside: Export waits for the model to be cut', exp.done && written()[0] === 'model:slice|size=50|st=0', describe(exp));
  finish(unmount);
}

{
  const unmount = await fresh(() => (net.ms['samples/skull'] = 150));
  ui().onImportMode('model');
  const exp = press();
  await clock.advance(100);
  const waited = !exp.done;
  await clock.advance(300);
  check('Model mode, its sample still downloading: Export waits for it', waited, describe(exp));
  check('…and writes the model\'s cut, the one on screen', written()[0] === 'model:slice|size=40|st=0' && written()[0] === onScreen(), `${describe(exp)}; screen ${shown(onScreen())}`);
  finish(unmount);
}

{
  const unmount = await fresh(() => {
    net.ms['samples/skull'] = 150;
    net.fails.add('samples/skull');
  });
  ui().onImportMode('model');
  const exp = press();
  await clock.advance(300);
  check('Model mode, its sample fails to download while Export waits: Export is answered', exp.done, `${describe(exp)}; status "${status()}"`);
  finish(unmount);
}

/* ================================================================= the fit test */

{
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(200);
  ui().onFitTest();
  let exp = press();
  await clock.advance(100);
  check('the fit test showing: Export writes its tiles, under their own name', exp.done && written()[0] === 'tiles:-0.2,-0.1,0,0.1,0.2' && seen.downloads[0]?.name === 'clicker-stem-fit-test.3mf', `${describe(exp)} as ${seen.downloads[0]?.name}`);
  seen.downloads.length = 0;
  ui().onStemFit(0.1);
  exp = press();
  await clock.advance(100);
  const waited = !exp.done;
  await clock.advance(100);
  check('the stem fit stepped under the fit test: Export waits for the new tiles', waited && written()[0] === 'tiles:-0.1,0,0.1,0.2,0.3' && written()[0] === onScreen(), describe(exp));
  seen.downloads.length = 0;
  ui().onFitTestExit();
  exp = press();
  await clock.advance(200);
  check('the fit test closed: Export writes the design, rebuilt with the new stem fit', written()[0] === 'built:image:cc=4|w=40|st=0.1', describe(exp));
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(200);
  worker.silentIf = (msg) => msg.type === 'buildFitStrip';
  ui().onFitTest();
  const exp = press(); // waits for tiles that will never come
  await clock.advance(100);
  ui().onFitTestExit();
  await clock.advance(10);
  check('the fit test closed while its tiles are still building: Export goes ahead with the design', exp.done && written()[0] === 'built:image:cc=4|w=40|st=0', describe(exp));
  finish(unmount);
}

/* ================================================================= the worker */

{
  const unmount = await fresh();
  worker.crashIf = (msg) => msg.type === 'buildClicker' && msg.params.capWidthMm === 46;
  ui().onWidth(46);
  await clock.advance(200);
  const refused = press();
  await clock.advance(10);
  check('the worker dies mid-build: Export refuses, rather than writing the model before the edit', refused.error?.message === 'Worker failed: out of memory', describe(refused));
  finish(unmount);
}

{
  // The worker takes its time to start, and meanwhile the user opens an SVG that will not trace.
  const unmount = await fresh(() => (worker.ms = (msg) => (msg.type === 'init' ? 300 : 5)));
  knobs.svgTraceThrows = 'Unexpected end of SVG';
  ui().onImportMode('svg');
  ui().onSelectSvg('bad', 'bad.svg');
  await clock.advance(20);
  const early = press();
  await clock.advance(10);
  check('before the worker has started: a trace that failed refuses Export', early.error?.message === 'Error: Unexpected end of SVG', describe(early));
  await clock.advance(400); // the worker starts, and the startup sample goes on screen
  const exp = press();
  await clock.advance(10);
  check('…and the sample that then goes on screen lifts the refusal: Export writes it', exp.done && written()[0] === 'default-sample' && onScreen() === 'default-sample', `${describe(exp)}; screen ${shown(onScreen())}`);
  finish(unmount);
}

/* ================================================================= Model mode */

{
  const unmount = await fresh();
  ui().onImportMode('model');
  await clock.advance(100);
  check('Model mode: the sample model is cut and shown', onScreen() === 'model:slice|size=40|st=0', shown(onScreen()));
  seen.modelPanel.setCut({ ...seen.state.modelCut, sizeMm: 60 }, false);
  const exp = press();
  await clock.advance(300);
  check('a cut setting changed, then Export at once: the new cut is written', written()[0] === 'model:slice|size=60|st=0' && written()[0] === onScreen(), `${describe(exp)}; screen ${shown(onScreen())}`);
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onImportMode('model');
  await clock.advance(400); // the result cards are being drawn, in the worker ahead of anything new
  worker.ms = 60;
  seen.modelPanel.setCut({ ...seen.state.modelCut, sizeMm: 61 }, false);
  const exp = press();
  await clock.advance(1000);
  check('a cut changed while the result cards build: Export waits past them for the new cut', exp.done && written()[0] === 'model:slice|size=61|st=0', describe(exp));
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(200);
  worker.ms = 80;
  ui().onWidth(41);
  await clock.advance(200); // the build for 41 is in the worker
  ui().onModelFile(new File([new Uint8Array(16)], 'figure.stl'));
  const exp = press();
  await clock.advance(1000);
  check('a model uploaded while a design build runs: Export waits for the model\'s cut', exp.done && written()[0] === 'model:slice|size=60|st=0', describe(exp));
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(200);
  worker.failIf = (msg) => (msg.type === 'importModel' ? 'That file has no triangles' : null);
  ui().onModelFile(new File([new Uint8Array(16)], 'broken.stl'));
  const exp = press();
  await clock.advance(200);
  check('a model that fails to open: Export is answered', exp.done, describe(exp));
  check('…and the status says why', status() === 'Could not open that model: That file has no triangles', status());
  finish(unmount);
}

/* ============================== builds that answer whoever asked for them, not the screen */

{
  // Each result card's picture is a build of its own, asked for after the cut on screen lands.
  const unmount = await fresh();
  worker.failIf = (msg) => (msg.type === 'buildModel' && msg.requestId ? 'Assets not initialized' : null);
  worker.ms = (msg) => (msg.requestId ? 200 : 5);
  ui().onImportMode('model');
  await clock.advance(100); // the sample is cut; its cards are asked for 120 ms after
  seen.modelPanel.setCut({ ...seen.state.modelCut, sizeMm: 50 }, false); // an edit, cut behind the cards
  await clock.advance(250); // the first card has failed; the edit is still in the worker
  check('a result card whose build fails: the status line still says the edit is being cut', status() === 'Cutting the model…' && seen.state?.building === true, `building ${seen.state?.building}; status "${status()}"`);
  const exp = press();
  await clock.advance(800);
  check('…and Export writes that cut', written()[0] === 'model:slice|size=50|st=0', describe(exp));
  finish(unmount);
}

{
  const unmount = await fresh();
  worker.failIf = (msg) => (msg.type === 'buildModel' && msg.requestId ? 'Assets not initialized' : null);
  worker.ms = (msg) => (msg.requestId ? 200 : 5);
  ui().onImportMode('model');
  await clock.advance(200); // the sample is cut, and its cards are in the worker
  ui().onModelFile(new File([new Uint8Array(16)], 'figure.stl')); // read in behind them
  await clock.advance(10);
  const exp = press();
  await clock.advance(1500);
  check('a result card that fails while a new model loads: the new model still opens, and is cut', onScreen() === 'model:slice|size=60|st=0', `screen ${shown(onScreen())}; status "${status()}"`);
  check('…and Export writes it', written()[0] === 'model:slice|size=60|st=0', describe(exp));
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(200);
  worker.failIf = (msg) => (msg.type === 'buildFitStrip' ? 'Assets not initialized' : null);
  ui().onFitTest();
  await clock.advance(50);
  check('a fit test strip that fails: the status says so, and the busy state comes down', status() === 'Error: Assets not initialized' && seen.state?.building === false, `building ${seen.state?.building}; status "${status()}"`);
  const refused = press();
  await clock.advance(10);
  check('…and Export refuses, in those words', refused.error?.message === 'Error: Assets not initialized', describe(refused));
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(200);
  const before = status();
  worker.failIf = (msg) => (msg.type === 'buildFitStrip' ? 'Assets not initialized' : null);
  worker.ms = (msg) => (msg.type === 'buildFitStrip' ? 100 : 5);
  ui().onFitTest();
  await clock.advance(20);
  ui().onFitTestExit(); // back to the design before the strip has come back
  await clock.advance(200);
  check('a fit test strip that fails after the fit test has closed: the design\'s status line is left alone', status() === before && seen.state?.building === false, `building ${seen.state?.building}; status "${status()}", was "${before}"`);
  finish(unmount);
}

{
  // The MakerWorld build's batch run builds one clicker per row through the same worker.
  const unmount = await fresh(() => (knobs.makerlab = true));
  ui().onWidth(40);
  await clock.advance(200);
  const before = status();
  worker.failIf = (msg) => (msg.type === 'buildClicker' && msg.requestId ? 'RangeError: Invalid array length\n    at buildClicker' : null);
  const ring = [[0, 0], [1, 0], [0, 1]];
  const row = watch(seen.pro.buildOne([{ filamentRgb: [0, 0, 0], coverage: 1, rings: [ring], partName: 'top-color-0-0' }], [ring], {}));
  await clock.advance(50);
  check('a batch row whose build fails: the batch is told, rather than left waiting', row.done && row.error?.message === 'RangeError: Invalid array length', row.done ? row.error?.message ?? 'answered' : 'still waiting');
  check('…and the design\'s status line is left alone', status() === before, `"${status()}", was "${before}"`);
  finish(unmount);
}

/* ---------------------------------------------------------------- */

print(failures ? `\n${failures} FAILED` : '\nExport writes the build on screen, whatever happened before it was pressed');
process.exit(failures ? 1 : 0);

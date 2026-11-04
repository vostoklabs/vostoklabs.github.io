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
/* Saving a project draws its picture into a canvas through `ImageData`, which node lacks. */
(globalThis as Record<string, unknown>).ImageData ??= class {
  constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
};

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
  /** Clicker builds send back the outlines the Design view draws. */
  layout: false,
};
/** A clicker seen from above, as small as the Design view will draw. */
const square = (h: number) => [[[-h, -h], [h, -h], [h, h], [-h, h]]];
const LAYOUT = {
  cap: square(10), imageArea: square(8), body: square(13), well: square(10.5),
  art: { scale: 16, offX: 0, offY: 0, rotation: 0 }, switchBox: { loX: -1, hiX: 1, loY: -1, hiY: 1 }, textureMm: 0,
};
const inbox: { w: FakeWorker; msg: any }[] = [];
/** Every request posted to the worker since the clicker was mounted, in order. */
const posted: any[] = [];
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
      return { type: 'parts', parts: partsNamed(`built:${traceOf(msg)}|w=${msg.params.capWidthMm}|st=${msg.params.stemFitMm}`), switchPlacements: [], warnings: [], requestId: msg.requestId, ...(worker.layout ? { layout: LAYOUT } : {}) };
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

/** The clicker, mounted afresh and settled on its startup sample. `prepare` sets the scene first;
 *  `host` stands in for a desktop app the clicker is mounted inside. */
async function fresh(prepare?: () => void, host?: object) {
  reset();
  resetKit();
  FakeWorker.reset();
  inbox.length = 0;
  working = false;
  Object.assign(worker, { ms: 5, failIf: null, crashIf: null, silentIf: null, refuseIf: null, layout: false });
  net.ms = {};
  net.fails = new Set();
  clock.errors.length = 0;
  unhandled.length = 0;
  logged.length = 0;
  posted.length = 0;
  FakeWorker.onPost = (w, msg) => {
    if (worker.refuseIf?.(msg)) throw new DOMException('The object could not be cloned.', 'DataCloneError');
    posted.push(msg);
    inbox.push({ w, msg });
    void work();
  };
  FakeWorker.onStart = (w) => w.reply({ type: 'ready' });
  prepare?.();
  setMakerlab(knobs.makerlab);
  const unmount = mount(new FakeElement('div') as unknown as HTMLElement, host as Parameters<typeof mount>[1]);
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
/** Without moving time, let promises settle until `ready()` holds: a file being read is real I/O,
 *  which takes node however many turns it takes. One that never gets there fails its checks. */
async function until(ready: () => boolean) {
  for (let turn = 0; turn < 100 && !ready(); turn++) await clock.settle();
}


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
  // An edit, then the clicker is unmounted while the undo history still waits to record it.
  const unmount = await fresh();
  ui().onImportMode('model'); // a new subject: its first build starts the undo history
  await clock.advance(100);
  seen.modelPanel.setCut({ ...seen.state.modelCut, sizeMm: 50 }, false);
  await clock.advance(200); // built; the history records it 350 ms after the last change
  const last = seen.state;
  finish(unmount);
  await clock.advance(1000);
  check('unmounted, a clicker redraws nothing: a timer still running then does not reach its sidebars', !!last && seen.state === last, seen.state === last ? '' : `redrawn, canUndo ${seen.state?.canUndo}`);
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
  ui().onColourLevel(0, 1); // a live edit (a Relief row): its build goes out with no busy overlay
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
  await until(() => status() === 'Loading project…'); // the file is read; its settings start to land
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
  await until(() => status() === 'Loading project…');
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
  check('…saying whose shape it is', seen.downloads[0]?.opts.sourceModel === 'Skull', String(seen.downloads[0]?.opts.sourceModel));
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
  check('…and the picture still on screen is not credited to a model', written()[0] === 'default-sample' && seen.downloads[0]?.opts.sourceModel === undefined, `${describe(exp)}, credited to ${seen.downloads[0]?.opts.sourceModel}`);
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

/* ================================================================= the cover */

/* A cover is a picture of the viewer. Here it is taken when its drawing is done, `coverMs` after
   it starts, as a viewer that waits for a frame would take it, and it carries the name of the
   part that was on screen then. */
const coverIn = (png: unknown) => (png instanceof Uint8Array ? new TextDecoder().decode(png) : undefined);

{
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(200);
  knobs.coverMs = 400;
  const exp = press();
  await clock.advance(40);
  ui().onWidth(50); // an edit made after Export was pressed, landing while the cover is drawn
  await clock.advance(1500);
  const file = seen.downloads[0];
  check('an edit that lands while the cover is drawn: the cover shows the build the file holds', exp.done && !!file && coverIn(file.opts.coverPng) === file.parts[0].name, `file ${shown(file?.parts[0].name)}, cover of ${shown(coverIn(file?.opts.coverPng))}`);
  check('…which is the newer build, the one on screen', file?.parts[0].name === 'built:image:cc=4|w=50|st=0' && onScreen() === file?.parts[0].name, `${describe(exp)}; screen ${shown(onScreen())}`);
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(200);
  knobs.coverMs = 400;
  const exp = press();
  for (let mm = 41; mm <= 52; mm++) {
    await clock.advance(150);
    ui().onWidth(mm); // edits landing faster than a cover can be drawn
  }
  await clock.advance(3000);
  const file = seen.downloads[0];
  check('a build that keeps changing while its cover is drawn: Export still finishes, after three drawings', exp.done && seen.covers.length === 3, `${describe(exp)} after ${seen.covers.length} drawings`);
  check('…and the file has no cover rather than another build\'s', !!file && file.opts.coverPng === undefined, `cover of ${shown(coverIn(file?.opts.coverPng))}`);
  finish(unmount);
}

{
  const library: unknown[] = [];
  const host = { exportToLibrary: async (file: unknown) => (library.push(file), { indexed: true }) };
  const unmount = await fresh(undefined, host);
  ui().onWidth(40);
  await clock.advance(200);
  knobs.coverMs = 400;
  const exp = press();
  await clock.advance(40);
  ui().onWidth(50);
  await clock.advance(1500);
  const file = seen.built[0];
  check('inside a desktop host: the cover saved with the file shows the build the file holds', exp.done && library.length === 1 && !!file && coverIn(file.opts.coverPng) === file.parts[0].name, `file ${shown(file?.parts[0].name)}, cover of ${shown(coverIn(file?.opts.coverPng))}`);
  finish(unmount);
}

{
  const unmount = await fresh(() => (knobs.makerlab = true));
  ui().onWidth(40);
  await clock.advance(200);
  knobs.coverMs = 400;
  const exp = press();
  await clock.advance(40);
  ui().onWidth(50);
  await clock.advance(1500);
  const sent = seen.sdkExports[0]?.artifacts?.[0];
  const cover = sent ? new TextDecoder().decode(Buffer.from(String(sent.coverImage).replace('data:image/png;base64,', ''), 'base64')) : undefined;
  check('in MakerLab: the cover sent with the model shows the build in it', exp.done && seen.objs.length === 1 && cover === seen.objs[0][0].name, `model ${shown(seen.objs[0]?.[0].name)}, cover of ${shown(cover)}`);
  check('…and its OBJ, a picture of ours, credits no model', seen.objOpts[0]?.sourceModel === undefined, String(seen.objOpts[0]?.sourceModel));
  finish(unmount);
}

{
  const unmount = await fresh(() => (knobs.makerlab = true));
  ui().onImportMode('model');
  await clock.advance(300);
  const exp = press();
  await clock.advance(300);
  check('in MakerLab, Model mode: the OBJ sent is the cut on screen', exp.done && seen.objs[0]?.[0].name === 'model:slice|size=40|st=0', `${shown(seen.objs[0]?.[0].name)}`);
  check('…and its mark says whose shape it is, as the 3MF\'s does', seen.objOpts[0]?.sourceModel === 'Skull', String(seen.objOpts[0]?.sourceModel));
  finish(unmount);
}

{
  const unmount = await fresh(() => (knobs.makerlab = true));
  const exp = press();
  await clock.advance(300);
  const call = seen.sdkExports[0];
  const art = call?.artifacts?.[0];
  check('in MakerLab: the clicker goes as a 3D model, one OBJ artifact with its MTL', exp.done && call?.printerType !== '2D' && call.artifacts.length === 1 && art?.format === 'obj' && typeof art.mtl === 'string', JSON.stringify(call && { printerType: call.printerType, format: art?.format }));
  check('…and the status says it was sent', status() === 'Sent the clicker to MakerLab', status());
  finish(unmount);
}

{
  // MakerLab's own export window ended it: nothing loud.
  const unmount = await fresh(() => { knobs.makerlab = true; knobs.sdkAnswer = { success: false, errorCode: 'EXPORT_USER_CANCELLED' }; });
  const exp = press();
  await clock.advance(300);
  check('in MakerLab, the export window closed: a quiet status line, no failure', exp.done && status() === 'Export cancelled', status());
  finish(unmount);
}

/* ===================================================== what the panel's controls call */

{
  // Add switch and × on the Switch list: an untouched layout is laid out evenly for the new count;
  // once one is placed by hand, the others keep their places. The one added is the one picked.
  const unmount = await fresh();
  const one = JSON.stringify(seen.state?.switches);
  ui().onSwitchAdd();
  await clock.advance(200);
  const two = seen.state!.switches;
  check('Add switch: two switches, evenly placed, the new one picked', two.length === 2 && two[0].x === -two[1].x && two[0].x !== 0 && seen.state?.activeSwitchIndex === 1,
    `${JSON.stringify(two)}, picked ${seen.state?.activeSwitchIndex}`);
  seen.designView.onEdit({ kind: 'switch', index: 0, x: -5, y: 4, rotation: 0 });
  await clock.advance(200);
  ui().onSwitchAdd();
  await clock.advance(200);
  const three = seen.state!.switches;
  check('…a third after one was moved: the moved one stays where it was put', three.length === 3 && three[0].x === -5 && three[0].y === 4 && seen.state?.activeSwitchIndex === 2,
    JSON.stringify(three));
  ui().onSwitchAdd();
  await clock.advance(200);
  check('…and no fourth', seen.state?.switches.length === 3, `${seen.state?.switches.length} switches`);
  ui().onSwitchRemove(1);
  await clock.advance(200);
  const left = seen.state!.switches;
  check('× takes that one off, the others where they were', left.length === 2 && left[0].x === -5 && JSON.stringify(left[1]) === JSON.stringify(three[2]),
    JSON.stringify(left));
  ui().onSwitchRemove(0);
  await clock.advance(200);
  ui().onSwitchRemove(0);
  await clock.advance(200);
  check('…and the last one stays', seen.state?.switches.length === 1, `${seen.state?.switches.length} switches`);
  // An Outline base's picture dragged on the 2D view: the switches move the other way.
  const at = seen.state!.switches[0];
  seen.designView.onEdit({ kind: 'outline-move', dx: 3, dy: -2 });
  await clock.advance(200);
  const now = seen.state!.switches[0];
  check('an Outline picture moved 3 right and 2 down: the switch goes 3 left and 2 up on it', now.x === Math.round((at.x - 3) * 10) / 10 && now.y === Math.round((at.y + 2) * 10) / 10,
    `${JSON.stringify(at)} → ${JSON.stringify(now)}`);
  void one;
  finish(unmount);
}

{
  // Relief's Bevelled edges: a size, to a tenth of a millimetre, to the build.
  const unmount = await fresh();
  ui().onExtrudeChamferMm(0.74);
  await clock.advance(300);
  const last = [...posted].reverse().find((m) => m.type === 'buildClicker');
  check('Bevelled edges: 0.74 mm is kept as 0.7 and built with it', seen.state?.extrudeChamferMm === 0.7 && last?.params.extrudeChamferMm === 0.7 && last?.params.extrudeChamfer === true,
    `${seen.state?.extrudeChamferMm}; sent ${last?.params.extrudeChamferMm}`);
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onSwitchAdd();
  await clock.advance(200);
  const layout = JSON.stringify(seen.state?.switches);
  // A switch dragged on the Design view.
  seen.designView.onEdit({ kind: 'switch', index: 0, x: -4, y: 3, rotation: 0 });
  await clock.advance(200);
  const moved = JSON.stringify(seen.state?.switches) !== layout;
  const before = posted.length;
  ui().onSwitchResetAll();
  await clock.advance(200);
  check('Reset all switches: every switch goes back where two switches start', moved && JSON.stringify(seen.state?.switches) === layout && seen.state?.activeSwitchIndex === 0, `${JSON.stringify(seen.state?.switches)}, was ${layout}`);
  check('…and the clicker is built again with them', posted.slice(before).some((m) => m.type === 'buildClicker' && JSON.stringify(m.params.switches) === layout), `${posted.length - before} requests`);
  finish(unmount);
}

{
  // The rail's Left / right, Up / down and Turn rows, and the loop's two.
  const unmount = await fresh();
  ui().onSwitchAdd();
  await clock.advance(200);
  const before = JSON.stringify(seen.state?.switches[0]);
  ui().onActiveSwitch(1);
  ui().onSwitchMove(1, { x: 6 });
  ui().onSwitchMove(1, { rotation: 30 });
  ui().onImageOffset(2, -3);
  ui().onDesignRotation(45);
  ui().onKeychainToggle(true);
  ui().onKeychainAngle(-90);
  ui().onKeychainOffsetSet(40);
  await clock.advance(300);
  const s = seen.state!;
  const last = [...posted].reverse().find((m) => m.type === 'buildClicker');
  check('the rail moves the switch picked, and only the axis it moved', s.activeSwitchIndex === 1 && s.switches[1].x === 6 && s.switches[1].rotation === 30 && JSON.stringify(s.switches[0]) === before, JSON.stringify(s.switches));
  check('…the picture on its base, and its turn', s.imageOffset.x === 2 && s.imageOffset.y === -3 && s.designRotation === 45, `${JSON.stringify(s.imageOffset)} ${s.designRotation}°`);
  check('…and the loop: its bearing taken round to 0-360°, its slide held to ±15 mm', s.keychain.angleDeg === 270 && s.keychain.offsetMm === 15, JSON.stringify(s.keychain));
  check('…all of it in the build that goes out', !!last && last.params.switches[1].x === 6 && last.params.imageOffset.x === 2 && last.params.designRotation === 45 && last.params.keychain.angleDeg === 270,
    last ? JSON.stringify({ sw: last.params.switches, at: last.params.imageOffset, turn: last.params.designRotation, kc: last.params.keychain }) : 'no build');

  // Lettering's per-line rows: the line picked under Line, and only that one.
  ui().onWordAdd();
  ui().onWordAdd();
  await clock.advance(200);
  const [w1, w2] = seen.state!.words;
  ui().onActiveWord(w2.id);
  ui().onWordSize(10);
  ui().onWordMove(w2.id, { x: 4, rotation: -20 });
  await clock.advance(300);
  const words = seen.state!.words;
  check('Lettering sizes and moves the line picked, and only that line', words[1].heightMm === 10 && words[1].x === 4 && words[1].rotation === -20 && words[0].heightMm === w1.heightMm && words[0].x === w1.x,
    JSON.stringify(words));
  finish(unmount);
}

{
  // Text size used to size the clicker too: a project saved then opens at the size it was made.
  const unmount = await fresh();
  const project = { version: 3, settings: { importMode: 'text', currentText: 'Big', currentFontId: 'helvetiker-regular', baseShape: 'outline', capWidthMm: 40, textScale: 1.5 } };
  ui().onLoadProject(new File([JSON.stringify(project)], 'clicker-project.json'));
  await clock.advance(600);
  check('a text clicker saved with Text size 150% on an Outline base opens 60 mm wide, Text size back to 100%', seen.state?.capWidthMm === 60 && seen.state?.textScale === 1 && onScreen() === 'built:text:Big:font=helvetiker-regular|w=60|st=0',
    `Size ${seen.state?.capWidthMm}, Text size ${seen.state?.textScale}; ${shown(onScreen())}`);
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onImportMode('model');
  await clock.advance(300);
  seen.partPick?.(0, 120, 80, false);
  const pop = seen.popovers[0];
  check('a click on the model opens the colour picker there, on the piece\'s colour, offering the filament shelf', !!pop && pop.x === 120 && pop.y === 80 && pop.hex === '#090909' && pop.options.length === 14, pop ? `${pop.x},${pop.y} ${pop.hex}, ${pop.options.length} offered` : 'none opened');
  const before = posted.length;
  pop?.handlers.onSelect('#00ae42');
  await clock.advance(300);
  check('…and a pick recolours that piece and builds it again', JSON.stringify(seen.state?.modelCut.colors.top) === '[0,174,66]' && posted.slice(before).some((m) => m.type === 'buildModel' && JSON.stringify(m.params.colors?.top) === '[0,174,66]'), JSON.stringify(seen.state?.modelCut.colors.top));
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onCustomColor('#123456');
  ui().onCustomColor('#00ae42'); // a shelf colour is not a new one
  ui().onCustomColor('#123456'); // nor is one already kept
  await clock.advance(10);
  check('a colour made on the picker\'s wheel is kept for the next picker, once; a shelf colour is not', JSON.stringify(seen.state?.customColors) === '[[18,52,86]]', JSON.stringify(seen.state?.customColors));
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
  await until(() => status() === 'Reading broken.stl…'); // read, and on its way to the worker
  const exp = press();
  await clock.advance(200);
  check('a model that fails to open while Export waits: Export is answered', exp.done, describe(exp));
  check('…and the status says why, and that the design on screen stays', status() === 'Could not open that model: That file has no triangles. The design on screen is unchanged.', status());
  check('…and the picture still on screen is not credited to a model', written()[0] === 'built:image:cc=4|w=40|st=0' && seen.downloads[0]?.opts.sourceModel === undefined, `${describe(exp)}, credited to ${seen.downloads[0]?.opts.sourceModel}`);
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onModelFile(new File([new Uint8Array(16)], 'figure.stl'));
  await clock.advance(100);
  check('Model mode: an uploaded model is cut', onScreen() === 'model:slice|size=60|st=0', shown(onScreen()));
  worker.failIf = (msg) => (msg.type === 'importModel' ? 'That file has no triangles' : null);
  ui().onModelFile(new File([new Uint8Array(16)], 'broken.stl'));
  await clock.advance(100); // read, sent, and refused by the worker
  const exp = press();
  await clock.advance(10);
  check('another model that then fails to open: Export writes the cut still on screen, credited to its own model', written()[0] === 'model:slice|size=60|st=0' && seen.downloads[0]?.opts.sourceModel === 'figure.stl', `${describe(exp)}, credited to ${seen.downloads[0]?.opts.sourceModel}`);
  check('…and the status says so, in the reader\'s own words', status() === 'Could not open that model: That file has no triangles. The design on screen is unchanged.', status());
  finish(unmount);
}

/* "The design on screen is unchanged" holds past the next edit: the model that failed replaces
   nothing, so an edit cuts the model still loaded, and Export names and credits it. */

{
  const unmount = await fresh();
  ui().onModelFile(new File([new Uint8Array(16)], 'figure.stl'));
  await clock.advance(100);
  press();
  await clock.advance(10);
  const named = seen.downloads[0]?.name;
  worker.failIf = (msg) => (msg.type === 'importModel' ? 'That file has no triangles' : null);
  ui().onModelFile(new File([new Uint8Array(16)], 'broken.stl'));
  await clock.advance(100); // read, sent, and refused by the worker
  worker.failIf = null;
  const sent = posted.length;
  seen.modelPanel.setCut({ ...seen.state.modelCut, sizeMm: 61 }, false); // an edit after it
  const exp = press();
  await clock.advance(300);
  const last = seen.downloads.at(-1);
  check('a model that failed to open, then an edit: the edit cuts the model still loaded, and Export writes it', written().at(-1) === 'model:slice|size=61|st=0' && !posted.slice(sent).some((m) => m.type === 'importModel'), `${describe(exp)}; asked the worker for ${posted.slice(sent).map((m) => m.type).join(', ')}`);
  check('…named and credited as before the failed file', !!named && last?.name === named && last?.opts.sourceModel === 'figure.stl', `${named} then ${last?.name}, credited to ${last?.opts.sourceModel}`);
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(200);
  press();
  await clock.advance(10);
  const named = seen.downloads[0]?.name;
  worker.failIf = (msg) => (msg.type === 'importModel' ? 'That file has no triangles' : null);
  ui().onModelFile(new File([new Uint8Array(16)], 'broken.stl')); // dropped on the picture
  await clock.advance(100);
  worker.failIf = null;
  check('a model dropped on the picture that fails to open: back on the picture\'s tab', seen.state?.importMode === 'image', String(seen.state?.importMode));
  ui().onWidth(41);
  const exp = press();
  await clock.advance(300);
  const last = seen.downloads.at(-1);
  check('…and the next edit rebuilds the picture, which Export writes, named as before and credited to no model', written().at(-1) === 'built:image:cc=4|w=41|st=0' && !!named && last?.name === named && last?.opts.sourceModel === undefined, `${describe(exp)}; ${named} then ${last?.name}, credited to ${last?.opts.sourceModel}`);
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onModelFile(new File([new Uint8Array(16)], 'figure.stl'));
  await clock.advance(100);
  net.fails.add('pumpkin');
  seen.modelPanel.onSample('pumpkin');
  await clock.advance(100);
  check('a sample that cannot be fetched: the status says so', status() === 'Could not load that sample.', status());
  seen.modelPanel.setCut({ ...seen.state.modelCut, sizeMm: 61 }, false);
  const exp = press();
  await clock.advance(300);
  check('…and the next edit still cuts the model loaded before it', written().at(-1) === 'model:slice|size=61|st=0' && seen.downloads.at(-1)?.opts.sourceModel === 'figure.stl', `${describe(exp)}, credited to ${seen.downloads.at(-1)?.opts.sourceModel}`);
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onImportMode('model');
  await clock.advance(100);
  ui().onImportMode('image'); // back to the picture
  const exp = press();
  await clock.advance(300);
  check('back from Model mode to the picture: Export writes the picture, credited to no model', written()[0] === 'built:image:cc=4|w=35|st=0' && seen.downloads[0]?.opts.sourceModel === undefined, `${describe(exp)}, credited to ${seen.downloads[0]?.opts.sourceModel}`);
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
  await until(() => status() === 'Reading figure.stl…');
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

/* ================================================================= Blank */

/** The last request of a kind the worker was sent. */
const lastSent = (type: string) => [...posted].reverse().find((m) => m.type === type);
const regionNames = (msg: any) => (msg ? msg.regions.map((r: any) => r.partName).join(', ') || 'none' : 'no build');

{
  // Image mode: the picture's shapes go, the words stay, and the outline is what it was.
  const unmount = await fresh();
  ui().onWordAdd();
  await clock.advance(300);
  const off = lastSent('buildClicker');
  ui().onBlank(true);
  await clock.advance(300);
  const on = lastSent('buildClicker');
  check('Blank in Image mode: the build gets the words and none of the picture',
    !!off && !!on && off !== on && off.regions.some((r: any) => !r.mm) && on.regions.length === 1 && on.regions.every((r: any) => r.mm),
    `${regionNames(off)} → ${regionNames(on)}`);
  check('…on the outline the picture gives it, so the base keeps its shape and size',
    !!on && JSON.stringify(on.outline) === JSON.stringify(off?.outline), on ? JSON.stringify(on.outline) : 'no build');
  check('…said to the build, which a clicker with its picture never is', on?.params.blank === true && off?.params.blank === undefined,
    `${off?.params.blank} → ${on?.params.blank}`);
  check('…and the button is the picture\'s ink, not the body\'s colour', JSON.stringify(on?.params.baseFilamentRgb) === '[10,20,30]'
    && JSON.stringify(on?.params.bodyColorRgb) === '[240,240,240]', `button ${JSON.stringify(on?.params.baseFilamentRgb)}, body ${JSON.stringify(on?.params.bodyColorRgb)}`);

  // The Design view: the words and the switch are there to move, the picture is not.
  worker.layout = true;
  ui().onDesignView(true);
  await clock.advance(300);
  const blankView = seen.designInput;
  check('…the Design view draws no picture, and is told so', !!blankView && blankView.art.length === 0 && blankView.blank === true && blankView.words.length === 1,
    blankView ? `${blankView.art.length} colours, blank ${blankView.blank}, ${blankView.words.length} words` : 'not drawn');
  ui().onBlank(false);
  await clock.advance(300);
  const back = seen.designInput;
  check('…and draws it again once Blank is off', !!back && back.art.length === 1 && back.blank === false && lastSent('buildClicker')?.regions.some((r: any) => !r.mm),
    back ? `${back.art.length} colours, blank ${back.blank}` : 'not drawn');
  finish(unmount);
}

{
  // Blocks: every key, in the same layout, each a plain cap.
  const unmount = await fresh();
  ui().onImportMode('blocks');
  await clock.advance(300);
  const off = lastSent('buildBlocks');
  ui().onBlank(true);
  await clock.advance(300);
  const on = lastSent('buildBlocks');
  check('Blank in Blocks: every key is built, each with nothing on it',
    !!off && !!on && off !== on && on.regions.length === off.regions.length && off.regions.some((r: any) => r.rings.length)
      && on.regions.every((r: any) => r.rings.length === 0) && JSON.stringify(on.params.blockKeys) === JSON.stringify(off.params.blockKeys),
    `${off?.regions.length} keys → ${on?.regions.length}, keys ${JSON.stringify(on?.params.blockKeys)}`);
  check('…and the caps are the letters\' colour, not the body\'s: two colours', JSON.stringify(off?.params.baseFilamentRgb) === '[240,240,240]'
    && JSON.stringify(on?.params.baseFilamentRgb) === '[10,20,30]', `caps ${JSON.stringify(off?.params.baseFilamentRgb)} → ${JSON.stringify(on?.params.baseFilamentRgb)}`);
  ui().onBlockLine(0, 'AB');
  await clock.advance(400);
  check('…typing on the keys leaves Blank on', seen.state?.blank === true && lastSent('buildBlocks')?.regions.every((r: any) => r.rings.length === 0), String(seen.state?.blank));
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onBlank(true);
  ui().onImportMode('model');
  await clock.advance(300);
  check('Model mode ignores Blank: the model is cut as ever', onScreen() === 'model:slice|size=40|st=0' && lastSent('buildModel')?.params.blank === undefined, shown(onScreen()));
  const exp = press();
  await clock.advance(100);
  check('…and its file is not called blank', exp.done && !!seen.downloads[0] && !seen.downloads[0].name.includes('blank'), String(seen.downloads[0]?.name));
  finish(unmount);
}

{
  const unmount = await fresh();
  ui().onBlank(true);
  await clock.advance(300);
  const exp = press();
  await clock.advance(100);
  check('Export of a blank: its file says so', exp.done && seen.downloads[0]?.name === 'clicker-vostok-labs-blank.3mf', String(seen.downloads[0]?.name));
  finish(unmount);
}

{
  const unmount = await fresh(() => (knobs.makerlab = true));
  ui().onBlank(true);
  await clock.advance(300);
  const exp = press();
  await clock.advance(300);
  const art = seen.sdkExports[0]?.artifacts?.[0];
  check('in MakerLab, a blank: not called multi-colour, and named as blank', exp.done && art?.description === 'Clicker, made with the Clicker Generator.' && art?.fileName === 'clicker-vostok-labs-blank.obj',
    `${art?.fileName}: ${art?.description}`);
  finish(unmount);
}

{
  // Saved, opened again; and a project from before Blank.
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(300);
  ui().onBlank(true);
  await clock.advance(300);
  ui().onSaveProject();
  const saved = seen.files.find((f) => f.name === 'clicker-project.json');
  const settings = saved ? JSON.parse(String(saved.data)).settings : null;
  check('Save writes Blank into the project', settings?.blank === true, JSON.stringify(settings?.blank));
  ui().onBlank(false);
  await clock.advance(300);
  ui().onLoadProject(new File([String(saved?.data)], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  const loaded = lastSent('buildClicker');
  check('…and opening it brings Blank back, built without the picture', seen.state?.blank === true && loaded?.params.blank === true && loaded?.regions.length === 0,
    `blank ${seen.state?.blank}; ${regionNames(loaded)}`);
  ui().onLoadProject(new File([JSON.stringify({ version: 3, settings: { importMode: 'text', currentText: 'Old' } })], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  check('a project saved before Blank opens with its picture', seen.state?.blank === false && lastSent('buildClicker')?.regions.length === 1, `blank ${seen.state?.blank}`);
  finish(unmount);
}

{
  // Undo and redo carry it, and rebuild with it.
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(800); // traced: its build is the undo baseline
  ui().onBlank(true);
  await clock.advance(800); // built, and recorded 350 ms after
  ui().onUndo();
  await clock.advance(300);
  check('Undo after Blank: the picture is back, in the state and in the build', seen.state?.blank === false && lastSent('buildClicker')?.regions.length === 1,
    `blank ${seen.state?.blank}; ${regionNames(lastSent('buildClicker'))}`);
  ui().onRedo();
  await clock.advance(300);
  check('…and Redo leaves it off again', seen.state?.blank === true && lastSent('buildClicker')?.regions.length === 0, `blank ${seen.state?.blank}`);
  finish(unmount);
}

{
  // A new picture is a request to see it; typing is not.
  const unmount = await fresh();
  ui().onBlank(true);
  await clock.advance(300);
  ui().onUpload(new File([new Uint8Array(8)], 'cat.png', { type: 'image/png' }));
  await clock.advance(300);
  check('a picture uploaded while Blank is on: Blank goes off, and the picture is built', seen.state?.blank === false && lastSent('buildClicker')?.regions.length === 1,
    `blank ${seen.state?.blank}; ${regionNames(lastSent('buildClicker'))}`);
  ui().onBlank(true);
  await clock.advance(300);
  ui().onSample(async () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) }), 'Vostok Labs');
  await clock.advance(300);
  check('…a sample picked: off too', seen.state?.blank === false, String(seen.state?.blank));
  ui().onBlank(true);
  ui().onAdjustImage();
  await clock.advance(300);
  check('…but Adjust image, the same picture, leaves it on', seen.state?.blank === true, String(seen.state?.blank));
  ui().onImportMode('icon');
  await clock.advance(300);
  ui().onSelectIcon('<svg/>', 'star');
  await clock.advance(300);
  check('…an icon picked: off', seen.state?.blank === false, String(seen.state?.blank));
  ui().onImportMode('svg');
  ui().onBlank(true);
  ui().onSelectSvg('logo', 'logo.svg');
  await clock.advance(300);
  check('…an SVG picked: off', seen.state?.blank === false, String(seen.state?.blank));
  ui().onBlank(true);
  ui().onSelectSvg('logo', 'logo.svg'); // a project opening selects its own SVG again
  await clock.advance(300);
  check('…but the SVG already loaded, picked again, leaves it on', seen.state?.blank === true, String(seen.state?.blank));
  ui().onImportMode('text');
  await clock.advance(300);
  ui().onTextChange('Hi');
  await clock.advance(400);
  check('…and typing in Text mode leaves it on, built with no letters', seen.state?.blank === true && lastSent('buildClicker')?.regions.length === 0,
    `blank ${seen.state?.blank}; ${regionNames(lastSent('buildClicker'))}`);
  finish(unmount);
}

/* ---------------------------------------------------------------- */

print(failures ? `\n${failures} FAILED` : '\nExport writes the build on screen, whatever happened before it was pressed');
process.exit(failures ? 1 : 0);

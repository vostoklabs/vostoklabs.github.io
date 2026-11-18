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
import { holeSizeRange, keychainStyleShown } from '../src/ui/keychainRows';
import { bottomPictureShown, showBottomPictureRows } from '../src/bottomArt';
import { BLOCK_KEYCAP_IDS, BLOCK_KEYCAPS, BLOCK_TRAVEL_MM, CAP_LOWER_MAX_MM, rimRaiseMax } from '../src/geometry/blockKeycaps';
import { ART_MM_MAX, NOT_SAVED, SAVED_SETTINGS, SETTING_LIMITS } from '../src/settings';
import projectFull from './fixtures/project-full.json';
import projectOld from './fixtures/project-v3-2026-11-09.json';

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
        // A keycap file says which file it is, so a check can tell the worker was handed each one.
        : u.includes('keycap') ? { file: u }
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
  /** What a clicker build has to say, as the real one would: its warnings and what blocks Export,
   *  and the outlines it sends back when they matter to the scenario. */
  notes: null as null | ((msg: any) => { warnings?: string[]; blocking?: string[]; layout?: unknown }),
};
/** A clicker seen from above, as small as the Design view will draw. */
const square = (h: number) => [[[-h, -h], [h, -h], [h, h], [-h, h]]];
const LAYOUT = {
  cap: square(10), imageArea: square(8), body: square(13), well: square(10.5),
  art: { scale: 16, fit: 16, offX: 0, offY: 0, rotation: 0 }, switchBox: { loX: -1, hiX: 1, loY: -1, hiY: 1 }, textureMm: 0,
};
/** The layout a clicker build answers with. The picture is sized as the real build sizes it on a
 *  free base: it would be Size less the 1.2 mm margins at Design size 100 % (`fit`), and is that
 *  times Design size, or a held size in mm when the build is sent one. */
function layoutFor(params: any) {
  const fit = params.capWidthMm - 2.4;
  const scale = params.artMm > 0 ? params.artMm : fit * (params.designScale ?? 1);
  return { ...LAYOUT, art: { ...LAYOUT.art, scale, fit } };
}
const inbox: { w: FakeWorker; msg: any }[] = [];
/** Every request posted to the worker since the clicker was mounted, in order. */
const posted: any[] = [];
let working = false;

const partsNamed = (name: string) => [
  { kind: 'cap', group: 'top', colorRgb: [9, 9, 9], name, numProp: 3, vertProperties: new Float32Array(0), triVerts: new Uint32Array(0) },
];
/** The design a build was traced from, by the index its first point carries. */
const traceOf = (msg: any) => traces[msg.regions?.[0]?.rings?.[0]?.[0]?.[0]] ?? '?';

/** The keycaps the worker was handed at init, by profile: as the real one, it builds no other. */
let keycapsHeld: Record<string, unknown> = {};

function answer(msg: any): unknown {
  switch (msg.type) {
    case 'init':
      keycapsHeld = msg.keycaps ?? {};
      return { type: 'initDone', socketInfo: '', stemInfo: '', switchInfo: '', switchMesh: { vertProperties: new Float32Array(0), triVerts: new Uint32Array(0), numProp: 3 }, switchColumnMm: 17 };
    case 'buildClicker':
      return { type: 'parts', parts: partsNamed(`built:${traceOf(msg)}|w=${msg.params.capWidthMm}|st=${msg.params.stemFitMm}`), switchPlacements: [], warnings: [], requestId: msg.requestId, ...(worker.layout ? { layout: layoutFor(msg.params) } : {}), ...(worker.notes?.(msg) ?? {}) };
    case 'buildBlocks':
      if (!keycapsHeld[msg.params.blockKeycap ?? 'standard']) {
        return { type: 'error', message: `The ${msg.params.blockKeycap} keycap is not loaded.`, request: msg.type, requestId: msg.requestId };
      }
      return {
        type: 'parts',
        parts: partsNamed(`blocks:${traceOf(msg)}|w=${msg.params.capWidthMm}|cap=${msg.params.blockKeycap}-${msg.params.blockCapLowerMm}|rim=${msg.params.blockRimRaiseMm}`),
        switchPlacements: [],
        warnings: [],
        requestId: msg.requestId,
      };
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
  keycapsHeld = {};
  Object.assign(worker, { ms: 5, failIf: null, crashIf: null, silentIf: null, refuseIf: null, layout: false, notes: null });
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

{
  // The Fit category's simple choices call the steppers' own callbacks: Looser on the top part
  // and Snugger on the switch cut-out land in the state and in the next build, as typed numbers do.
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(200);
  ui().onStemFit(0.1);
  ui().onSocketFit(-2);
  await clock.advance(300);
  const sent = [...posted].reverse().find((m) => m.type === 'buildClicker');
  check(
    'the fit choices: Looser on the top part and Snugger on the cut-out reach the state and the build',
    seen.state?.stemFitMm === 0.1 && seen.state?.socketFitPct === -2 && sent?.params.stemFitMm === 0.1 && sent?.params.socketFitPct === -2,
    `state ${seen.state?.stemFitMm} / ${seen.state?.socketFitPct}, build ${sent?.params.stemFitMm} / ${sent?.params.socketFitPct}`,
  );
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
  // The Switch d-pad's centre: the picked switch back to its own place and turn in the even
  // layout, the others left where they are, in one Undo step.
  const unmount = await fresh();
  ui().onSwitchAdd();
  await clock.advance(800); // built and recorded: the undo baseline
  const even = seen.state!.switches.map((sw) => ({ ...sw }));
  ui().onSwitchMove(0, { x: -3, y: 2 });
  ui().onSwitchMove(1, { x: 4, y: -5, rotation: 30 });
  await clock.advance(800);
  const moved = JSON.stringify(seen.state!.switches);
  const before = posted.length;
  ui().onSwitchHome(1);
  await clock.advance(800);
  const s = seen.state!;
  check('the pad\'s centre puts the picked switch back in its place and its turn',
    s.switches[1].x === even[1].x && s.switches[1].y === even[1].y && s.switches[1].rotation === even[1].rotation && s.activeSwitchIndex === 1,
    `${JSON.stringify(s.switches[1])}, home ${JSON.stringify(even[1])}, picked ${s.activeSwitchIndex}`);
  check('…the other switch stays where it was put, turn and all', s.switches[0].x === -3 && s.switches[0].y === 2 && s.switches[0].rotation === even[0].rotation, JSON.stringify(s.switches[0]));
  check('…and the clicker is built again with it', posted.slice(before).some((m) => m.type === 'buildClicker' && m.params.switches[1].x === even[1].x && m.params.switches[1].rotation === even[1].rotation),
    `${posted.length - before} requests`);
  ui().onUndo();
  await clock.advance(300);
  check('…one Undo brings back where it was and its turn together', JSON.stringify(seen.state!.switches) === moved, `${JSON.stringify(seen.state!.switches)}, was ${moved}`);
  ui().onRedo();
  await clock.advance(300);
  const held = JSON.stringify(seen.state!.switches);
  ui().onSwitchHome(9);
  ui().onSwitchHome(-1);
  await clock.advance(200);
  check('…a switch that is not there changes nothing', JSON.stringify(seen.state!.switches) === held && seen.state!.activeSwitchIndex === 1, JSON.stringify(seen.state!.switches));
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
  // The switch Clicker moves is outlined in the preview, where the state has it, and only there.
  ui().onCategory('switch');
  await clock.advance(50);
  check('Clicker open: the lit switch is outlined in 3D, where it was moved, turned with it', seen.switchMark?.x === 6 && seen.switchMark?.rotation === 30, JSON.stringify(seen.switchMark));
  ui().onActiveSwitch(0);
  await clock.advance(50);
  check('…picking the other switch outlines that one', seen.switchMark?.x === seen.state?.switches[0].x && seen.switchMark?.rotation === seen.state?.switches[0].rotation, JSON.stringify(seen.switchMark));
  ui().onActiveSwitch(1);
  ui().onCategory('shape');
  await clock.advance(50);
  check('…and another category takes the outline away', seen.switchMark === null, JSON.stringify(seen.switchMark));
  check('…all of it in the build that goes out', !!last && last.params.switches[1].x === 6 && last.params.imageOffset.x === 2 && last.params.designRotation === 45 && last.params.keychain.angleDeg === 270,
    last ? JSON.stringify({ sw: last.params.switches, at: last.params.imageOffset, turn: last.params.designRotation, kc: last.params.keychain }) : 'no build');
  // Reset position: the loop's bearing and slide back to a new clicker's, the rest of it kept.
  const kcBefore = seen.state!.keychain;
  ui().onKeychainPositionReset();
  await clock.advance(300);
  const kcAfter = seen.state!.keychain;
  const lastReset = [...posted].reverse().find((m) => m.type === 'buildClicker');
  check('Reset position puts the loop back at 90° with no slide, keeping it on and its hole size',
    kcAfter.angleDeg === 90 && kcAfter.offsetMm === 0 && kcAfter.enabled && kcAfter.holeDiameterMm === kcBefore.holeDiameterMm && lastReset?.params.keychain.angleDeg === 90,
    JSON.stringify(kcAfter));

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
  const saved = seen.files.find((f) => f.name.endsWith('-project.json'));
  check('Save names the file after the design, as the 3MF is', saved?.name === 'clicker-vostok-labs-blank-project.json', String(saved?.name));
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

/* ================================================================= Design size */

{
  // The slider's value reaches the build as it is, down to the floor.
  const unmount = await fresh();
  ui().onDesignScale(0.1);
  await clock.advance(300);
  check('Design size at 10 %: the build is sent 10 %', lastSent('buildClicker')?.params.designScale === 0.1,
    String(lastSent('buildClicker')?.params.designScale));
  // A project holds whatever was written into it; it opens inside the range.
  for (const [saved, opens] of [[0.01, 0.1], [5, 2]] as const) {
    ui().onLoadProject(new File([JSON.stringify({ version: 3, settings: { importMode: 'image', baseShape: 'circle', designScale: saved } })], 'clicker-project.json'));
    await until(() => status() === 'Loading project…');
    await clock.advance(600);
    check(`a project saved with Design size ${saved * 100} % opens at ${opens * 100} %, and builds there`,
      seen.state?.designScale === opens && lastSent('buildClicker')?.params.designScale === opens,
      `state ${seen.state?.designScale}, build ${lastSent('buildClicker')?.params.designScale}`);
  }
  // The Design view's corner: a picture's stops at Design size's floor, Text mode's at Text size's.
  worker.layout = true;
  ui().onDesignView(true);
  await clock.advance(300);
  const picture = seen.designInput;
  seen.designView.onEdit({ kind: 'art', offset: { x: 0, y: 0 }, designScale: 0.1, rotation: 0 });
  await clock.advance(300);
  check('the Design view\'s corner on a picture: no floor of its own, and 10 % reaches the build',
    !!picture && picture.designScaleMin === undefined && lastSent('buildClicker')?.params.designScale === 0.1,
    `floor ${picture?.designScaleMin}, build ${lastSent('buildClicker')?.params.designScale}`);
  ui().onImportMode('text');
  await clock.advance(300);
  const letters = seen.designInput;
  seen.designView.onEdit({ kind: 'art', offset: { x: 0, y: 0 }, designScale: 0.1, rotation: 0 });
  await clock.advance(300);
  check('…on Text mode\'s letters it stops at Text size\'s 50 %, as Text size does',
    letters?.designScaleMin === 0.5 && seen.state?.textScale === 0.5,
    `floor ${letters?.designScaleMin}, Text size ${seen.state?.textScale}`);
  finish(unmount);
}

/* ================================================================= Picture follows size */

{
  // The picture follows the shape's size unless it is told to keep its own.
  const near = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 1e-6;
  const builds = () => posted.filter((m) => m.type === 'buildClicker').length;
  const open = async (settings: Record<string, unknown>) => {
    ui().onLoadProject(new File([JSON.stringify({ version: 3, settings: { importMode: 'image', baseShape: 'circle', capWidthMm: 35, ...settings } })], 'clicker-project.json'));
    await until(() => status() === 'Loading project…');
    await clock.advance(600);
  };
  const unmount = await fresh();
  worker.layout = true;
  await open({});
  const followed = lastSent('buildClicker');
  check('a project from before the switch opens following: nothing held, and the build is sent no size',
    seen.state?.artMm === null && !!followed && !('artMm' in followed.params) && near(seen.state?.artFitMm, 32.6),
    `held ${seen.state?.artMm}, sent ${followed?.params.artMm}, fit ${seen.state?.artFitMm}`);

  // Off: held at the size on screen, with nothing to rebuild.
  const before = builds();
  ui().onFollowSize(false);
  await clock.advance(300);
  check('switch off: the picture is held at the size the last build made, and nothing is rebuilt',
    near(seen.state?.artMm, 32.6) && builds() === before, `held ${seen.state?.artMm}, ${builds() - before} builds`);

  // Then the shape is resized: the picture's millimetres hold.
  ui().onWidth(25);
  await clock.advance(300);
  let sent = lastSent('buildClicker');
  check('…then Size 35 → 25: the picture keeps its 32.6 mm, in the state and in the build',
    near(seen.state?.artMm, 32.6) && near(sent?.params.artMm, 32.6) && sent?.params.capWidthMm === 25,
    `held ${seen.state?.artMm}, sent ${sent?.params.artMm} at Size ${sent?.params.capWidthMm}`);
  ui().onDesignView(true);
  await clock.advance(300);
  const view = seen.designInput;
  const drawnMm = view ? view.layout.art.scale * (view.designScale / view.builtDesignScale) : NaN;
  check('…the Design view draws it at its millimetres, and its corner may run past the slider\'s top',
    near(drawnMm, 32.6) && near(view?.designScale, 32.6 / 22.6) && view?.designScaleMax === 16,
    `drawn ${drawnMm} mm, share ${view?.designScale}, top ${view?.designScaleMax}`);
  seen.designView.onEdit({ kind: 'base', w: 30, h: 30 });
  await clock.advance(300);
  sent = lastSent('buildClicker');
  check('…a base dragged to 30 mm in the Design view: the same',
    near(sent?.params.artMm, 32.6) && sent?.params.bodySize?.w === 30, `sent ${sent?.params.artMm}, base ${JSON.stringify(sent?.params.bodySize)}`);

  // A move hands back the share it was drawn at, rounded (32.6 / 22.6 = 144.25 % → 1.44, which
  // is 32.54 mm): the size held must not creep to that.
  seen.designView.onEdit({ kind: 'art', offset: { x: 2, y: 0 }, designScale: Math.round((32.6 / 22.6) * 100) / 100, rotation: 0 });
  await clock.advance(300);
  check('…the picture moved, not resized: its size does not creep', seen.state?.artMm === 32.6 && seen.state?.imageOffset.x === 2,
    `held ${seen.state?.artMm}, offset ${JSON.stringify(seen.state?.imageOffset)}`);

  // While held, Design size and the corner size the picture in mm; Design size itself stays.
  ui().onDesignScale(0.5);
  await clock.advance(300);
  check('…Design size 50 % while held: half of what fits now (22.6 mm), and Design size is left as it was',
    near(seen.state?.artMm, 11.3) && near(lastSent('buildClicker')?.params.artMm, 11.3) && seen.state?.designScale === 1,
    `held ${seen.state?.artMm}, Design size ${seen.state?.designScale}`);
  seen.designView.onEdit({ kind: 'art', offset: { x: 2, y: 0 }, designScale: 2.5, rotation: 0 });
  await clock.advance(300);
  check('…its corner dragged to 250 %: 56.5 mm, past where the slider stops',
    near(seen.state?.artMm, 56.5) && near(lastSent('buildClicker')?.params.artMm, 56.5), `held ${seen.state?.artMm}`);

  // The tracer: the held size while held.
  ui().onAdjustImage();
  await clock.advance(300);
  check('…Adjust image traces it at the held size', near(seen.wizards.at(-1)?.designMm, 56.5) && near(seen.imageTraces.at(-1)?.designMm, 56.5),
    `window ${seen.wizards.at(-1)?.designMm}, trace ${seen.imageTraces.at(-1)?.designMm}`);

  // Saved and opened again.
  ui().onSaveProject();
  const saved = seen.files.filter((f) => f.name.endsWith('-project.json')).at(-1);
  check('Save writes the held size', near(saved ? JSON.parse(String(saved.data)).settings.artMm : null, 56.5));
  await open({ artMm: null });
  check('…(a project that follows opens following)', seen.state?.artMm === null && !('artMm' in (lastSent('buildClicker')?.params ?? {})));
  ui().onLoadProject(new File([String(saved?.data)], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  check('…and opening it holds the picture at that size again', near(seen.state?.artMm, 56.5) && near(lastSent('buildClicker')?.params.artMm, 56.5),
    `held ${seen.state?.artMm}, sent ${lastSent('buildClicker')?.params.artMm}`);

  // On again is the reset; undo brings the held size back.
  await clock.advance(800);
  ui().onFollowSize(true);
  await clock.advance(800);
  sent = lastSent('buildClicker');
  check('switch on: the picture fits the shape again, the build is sent no size', seen.state?.artMm === null && !('artMm' in sent.params),
    `held ${seen.state?.artMm}, sent ${sent?.params.artMm}`);
  ui().onUndo();
  await clock.advance(300);
  check('…and Undo holds it again', near(seen.state?.artMm, 56.5) && near(lastSent('buildClicker')?.params.artMm, 56.5),
    `held ${seen.state?.artMm}`);

  // A new picture follows.
  ui().onUpload(new File([new Uint8Array(8)], 'cat.png', { type: 'image/png' }));
  await clock.advance(300);
  check('a new picture while one is held: it follows the shape, previewed and traced at Size times Design size',
    seen.state?.artMm === null && !('artMm' in lastSent('buildClicker').params)
      && seen.state?.capWidthMm === 25
      && seen.wizards.at(-1)?.designMm === 25 * seen.state?.designScale && seen.imageTraces.at(-1)?.designMm === 25 * seen.state?.designScale,
    `held ${seen.state?.artMm}, window ${seen.wizards.at(-1)?.designMm}, trace ${seen.imageTraces.at(-1)?.designMm}`);

  // Where the picture is the shape, a held size means nothing.
  await open({ baseShape: 'outline', artMm: 20 });
  check('an Outline base with a held size in its file: the build is sent none, and the picture is traced as it follows',
    !('artMm' in lastSent('buildClicker').params) && seen.imageTraces.at(-1)?.designMm === 35,
    `sent ${lastSent('buildClicker')?.params.artMm}, trace ${seen.imageTraces.at(-1)?.designMm}`);

  // The picture on screen is the last project's (32.6 mm); another project opens and the switch is
  // turned off before its own build lands. The last project's size says nothing about this one.
  await open({});
  const lastMm = layoutFor(lastSent('buildClicker')?.params ?? {}).art.scale;
  worker.silentIf = (m) => m.type === 'buildClicker';
  await open({ capWidthMm: 50, designScale: 0.5 });
  ui().onFollowSize(false);
  check('switch off before an opened project\'s first build: held at its own Size and Design size, not the last project\'s picture',
    near(seen.state?.artMm, (50 - 2.4) * 0.5) && near(lastMm, 32.6) && seen.state?.artFitMm === null,
    `held ${seen.state?.artMm}, the last project's was ${lastMm}, fit ${seen.state?.artFitMm}`);
  worker.silentIf = null;
  finish(unmount);
}

/* ================================================================= Blocks: the keycap */

{
  // Every profile is in the worker from the start, so a pick builds at once.
  const unmount = await fresh();
  const init = posted.find((m) => m.type === 'init');
  const files = Object.fromEntries(Object.entries(init?.keycaps ?? {}).map(([id, f]) => [id, (f as { file?: string })?.file]));
  check('startup: the worker is handed the three keycaps, each its own file',
    Object.keys(files).join() === BLOCK_KEYCAP_IDS.join() && BLOCK_KEYCAP_IDS.every((id) => String(files[id]).endsWith(BLOCK_KEYCAPS[id].file)),
    JSON.stringify(files));
  ui().onImportMode('blocks');
  await clock.advance(300);
  const first = lastSent('buildBlocks');
  check('Blocks start on the Standard keycap as drawn, at the travel the keycaps\' limits assume',
    first?.params.blockKeycap === 'standard' && first?.params.blockCapLowerMm === 0 && first?.params.travel === BLOCK_TRAVEL_MM,
    `${first?.params.blockKeycap}, cut ${first?.params.blockCapLowerMm}, travel ${first?.params.travel}`);

  ui().onBlockRimRaise(5);
  await clock.advance(300);
  ui().onBlockKeycap('low');
  await clock.advance(300);
  const low = lastSent('buildBlocks');
  check('Low profile picked: the next build carries it', low?.params.blockKeycap === 'low' && onScreen()?.includes('cap=low-0'),
    `${low?.params.blockKeycap}; screen ${shown(onScreen())}`);
  check('…with the rim brought down to the highest that cap allows, in the state and in the build',
    seen.state?.blockRimRaiseMm === rimRaiseMax('low') && low?.params.blockRimRaiseMm === rimRaiseMax('low'),
    `state ${seen.state?.blockRimRaiseMm}, build ${low?.params.blockRimRaiseMm}, cap allows ${rimRaiseMax('low')}`);
  check('…and the camera stays where it was', seen.keptCamera === true, String(seen.keptCamera));
  ui().onBlockCapLower(3);
  await clock.advance(300);
  check('a cap that cannot be cut shorter is not', seen.state?.blockCapLowerMm === 0 && lastSent('buildBlocks')?.params.blockCapLowerMm === 0,
    String(seen.state?.blockCapLowerMm));

  ui().onBlockKeycap('standard');
  ui().onBlockRimRaise(6);
  ui().onBlockCapLower(9);
  await clock.advance(300);
  const cut = lastSent('buildBlocks');
  check(`Standard cut as far as it goes (${CAP_LOWER_MAX_MM} mm): the rim comes down with it`,
    cut?.params.blockKeycap === 'standard' && cut?.params.blockCapLowerMm === CAP_LOWER_MAX_MM && cut?.params.blockRimRaiseMm === rimRaiseMax('standard', CAP_LOWER_MAX_MM),
    `cut ${cut?.params.blockCapLowerMm}, rim ${cut?.params.blockRimRaiseMm}`);
  const exp = press();
  await clock.advance(100);
  check('…and Export writes that build', exp.done && written()[0] === `blocks:blocks:font=helvetiker-regular|w=35|cap=standard-${CAP_LOWER_MAX_MM}|rim=${rimRaiseMax('standard', CAP_LOWER_MAX_MM)}`,
    describe(exp));
  finish(unmount);
}

{
  // Saved, opened again; and a project from before the keycap could be picked.
  const unmount = await fresh();
  ui().onImportMode('blocks');
  await clock.advance(300);
  ui().onBlockKeycap('thocky');
  ui().onBlockRimRaise(4);
  await clock.advance(300);
  ui().onSaveProject();
  const saved = seen.files.find((f) => f.name.endsWith('-project.json'));
  const settings = saved ? JSON.parse(String(saved.data)).settings : null;
  check('Save writes the keycap into the project', settings?.blockKeycap === 'thocky' && settings?.blockCapLowerMm === 0 && settings?.blockRimRaiseMm === 4,
    `${settings?.blockKeycap}, cut ${settings?.blockCapLowerMm}, rim ${settings?.blockRimRaiseMm}`);
  ui().onBlockKeycap('standard');
  ui().onBlockCapLower(2);
  await clock.advance(300);
  ui().onLoadProject(new File([String(saved?.data)], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  const back = lastSent('buildBlocks');
  check('…and opening it brings it back, built that way',
    seen.state?.blockKeycap === 'thocky' && seen.state?.blockCapLowerMm === 0 && seen.state?.blockRimRaiseMm === 4
      && back?.params.blockKeycap === 'thocky' && back?.params.blockCapLowerMm === 0 && back?.params.blockRimRaiseMm === 4,
    `state ${seen.state?.blockKeycap}/${seen.state?.blockCapLowerMm}/${seen.state?.blockRimRaiseMm}, build ${back?.params.blockKeycap}/${back?.params.blockCapLowerMm}/${back?.params.blockRimRaiseMm}`);

  ui().onBlockKeycap('standard');
  ui().onBlockCapLower(2.5);
  await clock.advance(300);
  ui().onSaveProject();
  const cutFile = seen.files.filter((f) => f.name.endsWith('-project.json')).at(-1);
  ui().onBlockCapLower(0);
  await clock.advance(300);
  ui().onLoadProject(new File([String(cutFile?.data)], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  check('a Standard keycap saved cut shorter opens cut as much', seen.state?.blockKeycap === 'standard' && seen.state?.blockCapLowerMm === 2.5
    && lastSent('buildBlocks')?.params.blockCapLowerMm === 2.5, `cut ${seen.state?.blockCapLowerMm}`);

  ui().onLoadProject(new File([JSON.stringify({ version: 3, settings: { importMode: 'blocks', blockLines: ['Old'], blockRimRaiseMm: 3 } })], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  const old = lastSent('buildBlocks');
  check('a block set saved before the keycap could be picked opens on the Standard keycap as drawn, its rim as saved',
    seen.state?.blockKeycap === 'standard' && seen.state?.blockCapLowerMm === 0 && seen.state?.blockRimRaiseMm === 3
      && old?.params.blockKeycap === 'standard' && old?.params.blockCapLowerMm === 0,
    `${seen.state?.blockKeycap}, cut ${seen.state?.blockCapLowerMm}, rim ${seen.state?.blockRimRaiseMm}`);
  finish(unmount);
}

{
  // Undo and redo carry the keycap, and the rim with it.
  const unmount = await fresh();
  ui().onImportMode('blocks');
  await clock.advance(800); // built: the undo baseline
  ui().onBlockRimRaise(5);
  await clock.advance(800); // built, and recorded 350 ms after
  ui().onBlockKeycap('low');
  await clock.advance(800);
  const lowRim = seen.state?.blockRimRaiseMm;
  ui().onUndo();
  await clock.advance(300);
  const undone = lastSent('buildBlocks');
  check('Undo after picking Low profile: Standard again, with the rim it had, in the state and in the build',
    seen.state?.blockKeycap === 'standard' && seen.state?.blockRimRaiseMm === 5 && undone?.params.blockKeycap === 'standard' && undone?.params.blockRimRaiseMm === 5,
    `${seen.state?.blockKeycap}, rim ${seen.state?.blockRimRaiseMm}; built ${undone?.params.blockKeycap}, rim ${undone?.params.blockRimRaiseMm}`);
  ui().onRedo();
  await clock.advance(300);
  check('…and Redo brings Low profile back with its lower rim', seen.state?.blockKeycap === 'low' && seen.state?.blockRimRaiseMm === lowRim
    && lowRim === rimRaiseMax('low') && lastSent('buildBlocks')?.params.blockKeycap === 'low',
    `${seen.state?.blockKeycap}, rim ${seen.state?.blockRimRaiseMm}`);
  ui().onBlockKeycap('standard');
  ui().onBlockCapLower(1.2);
  await clock.advance(800);
  ui().onUndo();
  await clock.advance(300);
  check('Undo after a Keycap height change: the cap as it was', seen.state?.blockKeycap === 'low' && seen.state?.blockCapLowerMm === 0,
    `${seen.state?.blockKeycap}, cut ${seen.state?.blockCapLowerMm}`);
  finish(unmount);
}

{
  // A blank block set wears the keycap too.
  const unmount = await fresh();
  ui().onImportMode('blocks');
  await clock.advance(300);
  ui().onBlank(true);
  ui().onBlockKeycap('thocky');
  await clock.advance(300);
  const blank = lastSent('buildBlocks');
  check('Blank on Thocky keycaps: plain Thocky caps', blank?.params.blockKeycap === 'thocky' && blank?.regions.every((r: any) => r.rings.length === 0),
    `${blank?.params.blockKeycap}, ${regionNames(blank)}`);
  finish(unmount);
}

/* ---------------------------------------------------------------- the keyring: a loop or a hole */

{
  // Picking Hole: it is built, the size row's range is the tunnel's, and what the build says is said.
  const unmount = await fresh();
  ui().onKeychainToggle(true);
  await clock.advance(300);
  const loopBuild = lastSent('buildClicker');
  check('Keyring on: a loop, as before', loopBuild?.params.keychain.enabled === true && loopBuild?.params.keychain.style === 'loop',
    JSON.stringify(loopBuild?.params.keychain));
  check('…its Hole size runs 3.2 to 8 mm', JSON.stringify(holeSizeRange(seen.state.importMode, seen.state.keychain.style)) === '[3.2,8]');
  ui().onKeychainStyle('hole');
  await clock.advance(300);
  check('Hole: the build that goes out makes a hole', seen.state?.keychain.style === 'hole' && lastSent('buildClicker')?.params.keychain.style === 'hole',
    JSON.stringify(lastSent('buildClicker')?.params.keychain));
  check('…and its Hole size runs 3.2 to 6 mm', JSON.stringify(holeSizeRange(seen.state.importMode, seen.state.keychain.style)) === '[3.2,6]');
  ui().onKeychainSize(4);
  await clock.advance(300);
  check('…so a hole goes no wider than 6 mm, in the state and in the build',
    seen.state?.keychain.holeDiameterMm === 6 && lastSent('buildClicker')?.params.keychain.holeDiameterMm === 6,
    `${seen.state?.keychain.holeDiameterMm}, sent ${lastSent('buildClicker')?.params.keychain.holeDiameterMm}`);
  ui().onKeychainStyle('loop');
  ui().onKeychainSize(2);
  await clock.advance(300);
  check('…while a loop\'s still goes to 8', seen.state?.keychain.holeDiameterMm === 8 && lastSent('buildClicker')?.params.keychain.holeDiameterMm === 8,
    String(seen.state?.keychain.holeDiameterMm));

  // The engine narrows the hole to fit: the status line says so.
  worker.notes = (msg) => (msg.params.keychain.style === 'hole' ? { warnings: ['Hole made 4.0 mm to fit.'] } : {});
  ui().onKeychainStyle('hole');
  await clock.advance(300);
  check('a hole the engine narrowed: the status line says so', status().includes('Hole made 4.0 mm to fit.'), `"${status()}"`);
  check('…and a loop at 8 mm, made a hole, is 6 mm in the state and the build, as the row shows',
    seen.state?.keychain.holeDiameterMm === 6 && lastSent('buildClicker')?.params.keychain.holeDiameterMm === 6,
    `${seen.state?.keychain.holeDiameterMm}, sent ${lastSent('buildClicker')?.params.keychain.holeDiameterMm}`);

  // No room at all: Export refuses in the status line's words, until it is moved.
  const noRoom = 'No room for a keyring hole here. Move it, make the clicker larger, or use Loop.';
  worker.notes = (msg) => (msg.params.keychain.angleDeg === 90 && msg.params.keychain.style === 'hole' ? { blocking: [noRoom] } : {});
  ui().onKeychainAngle(90);
  ui().onWidth(26);
  await clock.advance(300);
  const before = seen.downloads.length;
  const refused = press();
  await clock.advance(300);
  check('a hole with no room: Export refuses and the status line says why',
    !!refused.error && status().includes(noRoom) && seen.downloads.length === before, `${describe(refused)}; status "${status()}"`);
  ui().onKeychainAngle(45);
  await clock.advance(300);
  const exp = press();
  await clock.advance(300);
  check('…moved to where it fits, Export writes it', exp.done && !exp.error && seen.downloads.length === before + 1 && !status().includes(noRoom),
    `${describe(exp)}; status "${status()}"`);
  finish(unmount);
}

{
  // A hole is placed first, then cut: Hole goes out uncut, Cut hole cuts it, it stays cut when
  // moved, Undo takes the cut back, and choosing Hole again places a new one.
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(800); // the undo baseline
  ui().onKeychainToggle(true);
  ui().onKeychainStyle('hole');
  await clock.advance(800);
  const kcSent = () => lastSent('buildClicker')?.params.keychain;
  check('Hole: placed, not cut, in the state and the build', seen.state?.keychain.holeCut === false && kcSent()?.holeCut === false,
    JSON.stringify(kcSent()));
  ui().onKeychainCut();
  await clock.advance(800);
  check('Cut hole: cut, in the state and the build', seen.state?.keychain.holeCut === true && kcSent()?.holeCut === true, JSON.stringify(kcSent()));
  ui().onKeychainAngle(45);
  await clock.advance(800);
  check('…moved after the cut, it stays cut and goes where it was moved', kcSent()?.holeCut === true && kcSent()?.angleDeg === 45, JSON.stringify(kcSent()));
  ui().onUndo();
  await clock.advance(800);
  ui().onUndo();
  await clock.advance(800);
  check('Undo, twice: the move and then the cut are taken back, the hole placed again', seen.state?.keychain.holeCut === false && kcSent()?.holeCut === false
    && kcSent()?.angleDeg === 90, JSON.stringify(kcSent()));
  ui().onKeychainCut();
  ui().onKeychainStyle('loop');
  ui().onKeychainStyle('hole');
  await clock.advance(800);
  check('…and a hole chosen again is placed afresh, not cut', kcSent()?.style === 'hole' && kcSent()?.holeCut === false, JSON.stringify(kcSent()));
  finish(unmount);
}

{
  /* A hole being placed finds its own place: the build after Hole is asked to find it, and the
     bearing it found becomes Position, in the same Undo step as picking Hole. A move by hand is
     never moved again. Where there is no room, the line under Cut hole says so, and Cut hole
     cuts nothing; where there is room, it cuts. The stand-in worker: asked to find, it finds 75°;
     at 90° there is no room. */
  const unmount = await fresh();
  worker.layout = true;
  worker.notes = (msg) => {
    const kc = msg.params.keychain;
    if (!kc.enabled || kc.style !== 'hole') return {};
    const noRoom = !msg.params.holeFind && kc.angleDeg === 90;
    return {
      layout: {
        ...layoutFor(msg.params),
        loop: {
          x: 0, y: 12, outerR: 6.6, holeR: 2.6, style: 'hole', z: -5.2,
          ...(kc.holeCut === false ? { uncut: true } : {}),
          ...(noRoom ? { noRoom: true } : {}),
          ...(msg.params.holeFind ? { foundDeg: 75 } : {}),
        },
      },
      ...(noRoom ? { warnings: ['No room for a keyring hole here. Move it, make the clicker larger, or use Loop.'] } : {}),
    };
  };
  const finds = () => posted.filter((m) => m.type === 'buildClicker' && m.params.holeFind).length;
  const kcSent = () => lastSent('buildClicker')?.params.keychain;
  ui().onWidth(40);
  await clock.advance(800); // the undo baseline
  ui().onKeychainToggle(true);
  await clock.advance(800); // a loop, recorded
  check('a loop switched on is not asked to find a place', finds() === 0, `${finds()} finds`);
  const builds = () => posted.filter((m) => m.type === 'buildClicker').length;
  const buildsBefore = builds();
  ui().onKeychainStyle('hole');
  await clock.advance(800);
  const kc = seen.state?.keychain;
  check('Hole: one build is asked to find the place, and Position goes there, Fine offset 0, still placed',
    finds() === 1 && kc?.style === 'hole' && kc.angleDeg === 75 && kc.offsetMm === 0 && kc.holeCut === false,
    `${finds()} finds; ${JSON.stringify(kc)}`);
  check('…no status line, no line under Cut hole', status() === '' && seen.state?.holeNoRoom === false, `"${status()}", no room ${seen.state?.holeNoRoom}`);
  check('…and that one build is the hole on screen: the place it found is not built again', builds() === buildsBefore + 1,
    `${builds() - buildsBefore} builds since Hole`);
  ui().onUndo();
  await clock.advance(800);
  check('Undo once: the loop at 90°, as before Hole (not a hole at 90°)',
    seen.state?.keychain.style === 'loop' && seen.state?.keychain.angleDeg === 90 && kcSent()?.style === 'loop', JSON.stringify(seen.state?.keychain));
  ui().onRedo();
  await clock.advance(800);
  check('…Redo: the hole where it was found', seen.state?.keychain.style === 'hole' && seen.state?.keychain.angleDeg === 75 && finds() === 1,
    `${finds()} finds; ${JSON.stringify(seen.state?.keychain)}`);

  // Moved by hand to where there is no room: it stays there, and says so.
  ui().onKeychainAngle(90);
  await clock.advance(800);
  check('moved by hand to 90°, it stays at 90°; the build is not asked to find a place', seen.state?.keychain.angleDeg === 90 && finds() === 1,
    `${finds()} finds; ${JSON.stringify(kcSent())}`);
  check('…the line under Cut hole says there is no room', seen.state?.holeNoRoom === true);
  ui().onKeychainCut();
  await clock.advance(800);
  check('…and Cut hole there cuts nothing', seen.state?.keychain.holeCut === false && kcSent()?.holeCut === false, JSON.stringify(kcSent()));
  ui().onKeychainAngle(80);
  await clock.advance(800);
  ui().onKeychainCut();
  await clock.advance(800);
  check('moved to where it fits, Cut hole cuts', seen.state?.keychain.holeCut === true && kcSent()?.holeCut === true && seen.state?.holeNoRoom === false,
    JSON.stringify(kcSent()));

  // Switched off and on again as a Hole that has been moved: it stays where it was put.
  ui().onKeychainStyle('loop');
  ui().onKeychainStyle('hole');
  ui().onKeychainAngle(120);
  await clock.advance(800);
  const before = finds();
  ui().onKeychainToggle(false);
  await clock.advance(300);
  ui().onKeychainToggle(true);
  await clock.advance(800);
  check('a placed hole moved by hand, switched off and on: not moved', finds() === before && seen.state?.keychain.angleDeg === 120,
    `${finds() - before} new finds; ${JSON.stringify(seen.state?.keychain)}`);
  // Reset position on a hole: back where a new one goes, the place nearest the start that fits,
  // not the start itself (here, no room at 90°).
  ui().onKeychainPositionReset();
  await clock.advance(800);
  check('Reset position on a hole finds its place again', finds() === before + 1 && seen.state?.keychain.angleDeg === 75 && seen.state?.holeNoRoom === false,
    `${finds() - before} new finds; ${JSON.stringify(seen.state?.keychain)}`);
  // …and one still where a new one starts: switched on, it finds its place, as Hole does.
  ui().onKeychainAngle(90);
  await clock.advance(800);
  ui().onKeychainToggle(false);
  await clock.advance(300);
  ui().onKeychainToggle(true);
  await clock.advance(800);
  check('a placed hole never moved, switched on: it finds its place', finds() === before + 2 && seen.state?.keychain.angleDeg === 75,
    `${finds() - before} new finds; ${JSON.stringify(seen.state?.keychain)}`);
  finish(unmount);
}

{
  // Saved and opened again; a project from before the choice opens as a loop.
  const unmount = await fresh();
  ui().onKeychainToggle(true);
  ui().onKeychainStyle('hole');
  await clock.advance(300);
  ui().onSaveProject();
  const saved = seen.files.filter((f) => f.name.endsWith('-project.json')).at(-1);
  const kc = saved ? JSON.parse(String(saved.data)).settings.keychain : null;
  check('Save writes the keyring\'s style', kc?.style === 'hole', JSON.stringify(kc));
  ui().onKeychainStyle('loop');
  await clock.advance(300);
  ui().onLoadProject(new File([String(saved?.data)], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  check('…and opening it makes the hole again', seen.state?.keychain.style === 'hole' && lastSent('buildClicker')?.params.keychain.style === 'hole',
    `${seen.state?.keychain.style}, sent ${lastSent('buildClicker')?.params.keychain.style}`);
  for (const [what, keychain] of [
    ['with no style', { enabled: true, angleDeg: 90, holeDiameterMm: 5.2 }],
    ['with a style it does not know', { enabled: true, style: 'tunnel', angleDeg: 90, holeDiameterMm: 5.2 }],
  ] as const) {
    ui().onLoadProject(new File([JSON.stringify({ version: 3, settings: { importMode: 'text', currentText: 'Old', keychain } })], 'clicker-project.json'));
    await until(() => status() === 'Loading project…');
    await clock.advance(600);
    check(`a project ${what} opens with a loop`, seen.state?.keychain.style === 'loop' && lastSent('buildClicker')?.params.keychain.style === 'loop',
      `${seen.state?.keychain.style}, sent ${lastSent('buildClicker')?.params.keychain.style}`);
  }
  finish(unmount);
}

{
  // Undo takes the choice back; a block set hides it and keeps its loop.
  const unmount = await fresh();
  ui().onKeychainToggle(true);
  await clock.advance(800); // built, and recorded
  ui().onKeychainStyle('hole');
  await clock.advance(800);
  ui().onUndo();
  await clock.advance(300);
  check('Undo after picking Hole: a loop again, in the state and in the build',
    seen.state?.keychain.style === 'loop' && lastSent('buildClicker')?.params.keychain.style === 'loop',
    `${seen.state?.keychain.style}, sent ${lastSent('buildClicker')?.params.keychain.style}`);
  ui().onRedo();
  await clock.advance(300);
  check('…and Redo makes the hole again', seen.state?.keychain.style === 'hole' && lastSent('buildClicker')?.params.keychain.style === 'hole',
    String(seen.state?.keychain.style));

  ui().onImportMode('blocks');
  await clock.advance(300);
  const s = seen.state!;
  check('a block set: no Style row, and Hole size is the loop\'s again',
    !keychainStyleShown(s.importMode) && JSON.stringify(holeSizeRange(s.importMode, s.keychain.style)) === '[3.2,8]',
    `${s.importMode}, ${s.keychain.style}`);
  check('…the state keeps the hole for the clicker', s.keychain.style === 'hole');
  ui().onImportMode('text');
  await clock.advance(300);
  check('…which shows it, and cuts it, again', keychainStyleShown(seen.state.importMode) && lastSent('buildClicker')?.params.keychain.style === 'hole',
    String(lastSent('buildClicker')?.params.keychain.style));
  finish(unmount);
}

/* ======================================== the rail's Colors count splits as the picture window does */

{
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(200);
  const rgbIs = (c: number[] | undefined, want: number[]) => c?.join() === want.join();
  ui().onColorCount(3);
  await clock.advance(300);
  let s = seen.state!;
  check('the rail\'s Colors count on a picture: split by the colour finder, kept as the window keeps it',
    s.colorMode === 'mapped' && s.colorCount === 3 && s.mappedFilaments.length === 3 && s.mappedColors.length === 4,
    `${s.colorMode}, count ${s.colorCount}, ${s.mappedFilaments.length} filaments, ${s.mappedColors.length} colours`);
  check('…the closest pair (the two reds) prints as one filament, the bigger red',
    s.mappedColors[2].group === s.mappedColors[3].group && rgbIs(s.mappedFilaments[s.mappedColors[2].group], [200, 30, 40]),
    JSON.stringify(s.mappedColors));
  const trace = seen.imageTraces.at(-1);
  check('…the trace is given every colour and the group it prints in, and builds three filaments',
    trace?.customColors?.length === 4 && trace?.mergeInto?.join() === s.mappedColors.map((c: { group: number }) => c.group).join()
      && onScreen() === 'built:image:cc=3|w=40|st=0',
    `${JSON.stringify(trace)}; ${shown(onScreen())}`);
  check('…the finder took the background off as the rail says', seen.colourFinds.length > 0 && seen.colourFinds.every((f) => f.removeBg === s.removeBg),
    JSON.stringify(seen.colourFinds));

  ui().onColorCount(5);
  await clock.advance(300);
  s = seen.state!;
  check('more than the picture opens with: a finer split is asked for, and every colour is its own filament',
    seen.colourFinds.some((f) => f.detail === 1) && s.colorCount === 5 && new Set(s.mappedColors.map((c: { group: number }) => c.group)).size === 5
      && rgbIs(s.mappedFilaments[4], [30, 120, 60]),
    `${JSON.stringify(seen.colourFinds)}; count ${s.colorCount}`);

  ui().onColorCount(8);
  await clock.advance(300);
  s = seen.state!;
  check('more than the picture has: every colour it has, and the count shows that many',
    s.colorCount === 5 && s.mappedFilaments.length === 5 && onScreen() === 'built:image:cc=5|w=40|st=0',
    `count ${s.colorCount}; ${shown(onScreen())}`);
  finish(unmount);
}

/* ======================================== parts taken out of the picture */

{
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(300);
  const taken = [{ op: 'remove', x: 0.25, y: 0.5 }, { op: 'dropColour', rgb: [200, 30, 40] }];
  knobs.wizardEdits = taken;
  ui().onUpload(new File([new Uint8Array(8)], 'splat.png', { type: 'image/png' }));
  await clock.advance(300);
  check('a new picture opens the window with nothing taken out', same(seen.wizards.at(-1)?.initialEdits, []),
    JSON.stringify(seen.wizards.at(-1)?.initialEdits));
  check('…what the window took out is kept, and the build traces the picture without it',
    same(seen.state?.pictureEdits, taken) && same(seen.imageTraces.at(-1)?.edits, taken),
    `state ${JSON.stringify(seen.state?.pictureEdits)}, trace ${JSON.stringify(seen.imageTraces.at(-1)?.edits)}`);

  knobs.wizardEdits = null;
  ui().onAdjustImage();
  await clock.advance(300);
  check('Adjust image opens the window on the same picture with them', same(seen.wizards.at(-1)?.initialEdits, taken),
    JSON.stringify(seen.wizards.at(-1)?.initialEdits));
  ui().onColorCount(3);
  await clock.advance(300);
  check('…the rail\'s Colors count finds the colours of the picture without them',
    seen.colourFinds.length > 0 && same(seen.colourFinds.at(-1)?.picture?.edits, taken), JSON.stringify(seen.colourFinds.at(-1)?.picture));

  ui().onSaveProject();
  const saved = seen.files.filter((f) => f.name.endsWith('-project.json')).at(-1);
  check('Save writes them', same(saved ? JSON.parse(String(saved.data)).settings.pictureEdits : null, taken));

  ui().onUpload(new File([new Uint8Array(8)], 'cat.png', { type: 'image/png' }));
  await clock.advance(300);
  const catBase = seen.wizards.at(-1)?.baseImage;
  check('another picture starts with nothing taken out, in the window, the state and the trace',
    same(seen.wizards.at(-1)?.initialEdits, []) && same(seen.state?.pictureEdits, []) && same(seen.imageTraces.at(-1)?.edits, []),
    `window ${JSON.stringify(seen.wizards.at(-1)?.initialEdits)}, state ${JSON.stringify(seen.state?.pictureEdits)}`);

  ui().onLoadProject(new File([String(saved?.data)], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  check('…opening the project brings them back, and the build traces without them',
    same(seen.state?.pictureEdits, taken) && same(seen.imageTraces.at(-1)?.edits, taken),
    `state ${JSON.stringify(seen.state?.pictureEdits)}, trace ${JSON.stringify(seen.imageTraces.at(-1)?.edits)}`);
  ui().onAdjustImage();
  await clock.advance(300);
  check('…and Adjust image opens the project\'s picture, not the one before it, with them',
    !!seen.wizards.at(-1)?.baseImage && seen.wizards.at(-1)?.baseImage !== catBase && same(seen.wizards.at(-1)?.initialEdits, taken),
    JSON.stringify(seen.wizards.at(-1)?.initialEdits));

  ui().onLoadProject(new File([JSON.stringify({ version: 3, settings: { importMode: 'image' } })], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  check('a project from before parts could be taken out opens with none', same(seen.state?.pictureEdits, []) && same(seen.imageTraces.at(-1)?.edits, []),
    JSON.stringify(seen.state?.pictureEdits));
  const junk = [{ op: 'remove', x: 'a', y: 0.2 }, { op: 'remove', x: 1.5, y: 0.2 }, { op: 'remove', x: 0.75, y: 0.2 }, { op: 'paint' }, null];
  ui().onLoadProject(new File([JSON.stringify({ version: 3, settings: { importMode: 'image', pictureEdits: junk } })], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  check('…and one with broken edits keeps only the well-formed ones; a place outside the picture is dropped',
    same(seen.state?.pictureEdits, [{ op: 'remove', x: 0.75, y: 0.2 }]), JSON.stringify(seen.state?.pictureEdits));
  finish(unmount);
}

/* ======================================== the picture's crop */

{
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(300);
  const box = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
  knobs.wizardCrop = { crop: box };
  ui().onUpload(new File([new Uint8Array(8)], 'wide.png', { type: 'image/png' }));
  await clock.advance(300);
  check('a new picture opens the window with no crop', seen.wizards.at(-1)?.initialCrop === null,
    JSON.stringify(seen.wizards.at(-1)?.initialCrop));
  check('…the crop the window confirms is kept, and the build traces only what is inside it',
    same(seen.state?.pictureCrop, box) && same(seen.imageTraces.at(-1)?.crop, box),
    `state ${JSON.stringify(seen.state?.pictureCrop)}, trace ${JSON.stringify(seen.imageTraces.at(-1)?.crop)}`);

  knobs.wizardCrop = null;
  ui().onAdjustImage();
  await clock.advance(300);
  check('Adjust image opens the window on the same picture with the box where it was', same(seen.wizards.at(-1)?.initialCrop, box),
    JSON.stringify(seen.wizards.at(-1)?.initialCrop));
  check('…and confirming it again keeps it, in the state and the trace',
    same(seen.state?.pictureCrop, box) && same(seen.imageTraces.at(-1)?.crop, box), JSON.stringify(seen.state?.pictureCrop));
  ui().onColorCount(3);
  await clock.advance(300);
  check('…the rail\'s Colors count finds only the colours inside it',
    seen.colourFinds.length > 0 && same(seen.colourFinds.at(-1)?.picture?.crop, box), JSON.stringify(seen.colourFinds.at(-1)?.picture));

  ui().onSaveProject();
  const saved = seen.files.filter((f) => f.name.endsWith('-project.json')).at(-1);
  check('Save writes the crop', same(saved ? JSON.parse(String(saved.data)).settings.pictureCrop : null, box));

  ui().onUpload(new File([new Uint8Array(8)], 'cat.png', { type: 'image/png' }));
  await clock.advance(300);
  check('another picture starts with no crop, in the window, the state and the trace',
    seen.wizards.at(-1)?.initialCrop === null && seen.state?.pictureCrop === null && !seen.imageTraces.at(-1)?.crop,
    `window ${JSON.stringify(seen.wizards.at(-1)?.initialCrop)}, state ${JSON.stringify(seen.state?.pictureCrop)}`);

  ui().onLoadProject(new File([String(saved?.data)], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  check('…opening the project brings the crop back, and the build traces only inside it',
    same(seen.state?.pictureCrop, box) && same(seen.imageTraces.at(-1)?.crop, box),
    `state ${JSON.stringify(seen.state?.pictureCrop)}, trace ${JSON.stringify(seen.imageTraces.at(-1)?.crop)}`);
  ui().onAdjustImage();
  await clock.advance(300);
  check('…and Adjust image shows the box where it was saved', same(seen.wizards.at(-1)?.initialCrop, box),
    JSON.stringify(seen.wizards.at(-1)?.initialCrop));

  ui().onLoadProject(new File([JSON.stringify({ version: 3, settings: { importMode: 'image' } })], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  check('a project from before the crop opens with none', seen.state?.pictureCrop === null, JSON.stringify(seen.state?.pictureCrop));
  const loads: [unknown, unknown, string][] = [
    [{ x: 'a', y: 0, w: 0.5, h: 0.5 }, null, 'a box that is not numbers'],
    [{ x: 0, y: 0, w: 1, h: 1 }, null, 'the whole picture'],
    [{ x: -0.2, y: 0.1, w: 0.7, h: 2 }, { x: 0, y: 0.1, w: 0.5, h: 0.9 }, 'a box past the picture\'s edges'],
  ];
  for (const [raw, want, what] of loads) {
    ui().onLoadProject(new File([JSON.stringify({ version: 3, settings: { importMode: 'image', pictureCrop: raw } })], 'clicker-project.json'));
    await until(() => status() === 'Loading project…');
    await clock.advance(600);
    check(`…and ${what} loads as ${want ? 'the part inside the picture' : 'no crop'}`, same(seen.state?.pictureCrop, want), JSON.stringify(seen.state?.pictureCrop));
  }
  finish(unmount);
}

/* ======================================== the bottom picture */

{
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  check('a bottom picture has a place on image, SVG, icon and text clickers, and none on a block set or a cut model',
    ['image', 'svg', 'icon', 'text'].every(bottomPictureShown) && !bottomPictureShown('blocks') && !bottomPictureShown('model'));
  // What the rail's update does to the Bottom category's rows, with stand-ins for them: every row
  // hidden takes the category off the rail.
  const rowsAt = (mode: string, has: boolean) => {
    const rows = { zone: { hidden: false }, buttons: { hidden: false }, replace: { hidden: false }, place: [{ hidden: false }, { hidden: false }] };
    showBottomPictureRows(rows, mode, has);
    return [rows.zone.hidden, rows.buttons.hidden, rows.replace.hidden, ...rows.place.map((r) => r.hidden)];
  };
  check('Bottom: the drop zone until there is a picture, then its buttons and the rows that place it; nothing on a block set or a cut model',
    same(rowsAt('image', false), [false, true, true, true, true]) && same(rowsAt('text', true), [true, false, false, false, false])
      && rowsAt('blocks', true).every(Boolean) && rowsAt('model', false).every(Boolean),
    JSON.stringify([rowsAt('image', false), rowsAt('text', true), rowsAt('blocks', true), rowsAt('model', false)]));

  const unmount = await fresh();
  ui().onWidth(40);
  await clock.advance(300);
  check('a clicker with no bottom picture sends the build none',
    seen.state?.bottomPicture === null && !!lastSent('buildClicker') && !('bottomArt' in lastSent('buildClicker').params));

  // Chosen: the window opens on it under its own heading, fresh, and what it confirms is kept.
  const box = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
  const edits = [{ op: 'remove', x: 0.4, y: 0.5 }];
  const mapping = { colors: [{ rgb: [10, 20, 30], group: 0 }], filaments: [[200, 0, 0]] };
  Object.assign(knobs, { wizardCrop: { crop: box }, wizardEdits: edits, wizardMapping: mapping });
  const tracesBefore = seen.imageTraces.length;
  ui().onBottomPicture(new File([new Uint8Array(8)], 'logo.png', { type: 'image/png' }));
  await clock.advance(300);
  Object.assign(knobs, { wizardCrop: null, wizardEdits: null, wizardMapping: null });
  const opened = seen.wizards.at(-1);
  check('Bottom picture: choosing one opens the picture window headed "Prepare bottom picture", with nothing removed or cropped',
    opened?.title === 'Prepare bottom picture' && same(opened?.initialEdits, []) && opened?.initialCrop === null && opened?.initialRemoveBg === true,
    `${opened?.title}, edits ${JSON.stringify(opened?.initialEdits)}, crop ${JSON.stringify(opened?.initialCrop)}`);
  const kept = seen.state?.bottomPicture;
  check('…what it confirms is kept: colours, filaments, what was removed and the crop',
    same(kept?.mappedColors, mapping.colors) && same(kept?.mappedFilaments, mapping.filaments) && same(kept?.pictureEdits, edits) && same(kept?.pictureCrop, box),
    JSON.stringify(kept));
  check('…and the top picture is not touched by it', seen.state?.pictureCrop === null && same(seen.state?.pictureEdits, []));
  const bottomTrace = seen.imageTraces.at(-1);
  check('…it is traced once, with its own removals and crop',
    seen.imageTraces.length === tracesBefore + 1 && same(bottomTrace?.crop, box) && same(bottomTrace?.edits, edits) && same(bottomTrace?.customColors, [[10, 20, 30]]),
    `${seen.imageTraces.length - tracesBefore} traces, ${JSON.stringify(bottomTrace)}`);
  const art = lastSent('buildClicker')?.params.bottomArt;
  check('…and reaches the build as bottomArt: each shape named bottom-color-<colour>-<shape>, in its filament',
    art?.regions?.length === 1 && art.regions[0].partName === 'bottom-color-0-0' && same(art.regions[0].filamentRgb, [200, 0, 0]) && Array.isArray(art.outline),
    JSON.stringify(art?.regions?.map((r: any) => [r.partName, r.filamentRgb])));

  ui().onWidth(42);
  await clock.advance(300);
  check('another edit sends it again without tracing it again',
    seen.imageTraces.length === tracesBefore + 1 && lastSent('buildClicker')?.params.capWidthMm === 42 && !!lastSent('buildClicker')?.params.bottomArt,
    `${seen.imageTraces.length - tracesBefore} traces`);

  // Adjust: the same window on the same picture, with what it confirmed.
  ui().onBottomAdjust();
  await clock.advance(300);
  const again = seen.wizards.at(-1);
  check('Adjust picture reopens it with its removals, crop and colours',
    again?.title === 'Prepare bottom picture' && same(again?.initialEdits, edits) && same(again?.initialCrop, box) && same(again?.initialMapping?.colors, mapping.colors),
    JSON.stringify({ edits: again?.initialEdits, crop: again?.initialCrop, mapping: again?.initialMapping }));
  check('…and confirming it keeps them', same(seen.state?.bottomPicture?.pictureCrop, box) && same(seen.state?.bottomPicture?.pictureEdits, edits));

  // Placed: Size, Left / right, Up / down and Turn move it without tracing it again.
  const ENGINE = { x: 0, y: 0, rotation: 0, scale: 1 };
  check('a new bottom picture starts in the engine\'s place, and the build is told none',
    same(seen.state?.bottomPicture?.place, ENGINE) && !('place' in (lastSent('buildClicker')?.params.bottomArt ?? {})),
    JSON.stringify(seen.state?.bottomPicture?.place));
  const tracesPlaced = seen.imageTraces.length;
  ui().onBottomPlace({ x: 4, rotation: 30 });
  ui().onBottomPlace({ scale: 9 });
  await clock.advance(300);
  const PLACED = { x: 4, y: 0, rotation: 30, scale: 2 };
  check('Bottom: a move, a turn and a size reach the build as its place, held to the ranges, without tracing it again',
    same(seen.state?.bottomPicture?.place, PLACED) && same(lastSent('buildClicker')?.params.bottomArt?.place, PLACED)
      && seen.imageTraces.length === tracesPlaced,
    JSON.stringify({ place: seen.state?.bottomPicture?.place, sent: lastSent('buildClicker')?.params.bottomArt?.place, traces: seen.imageTraces.length - tracesPlaced }));
  ui().onBottomAdjust();
  await clock.advance(300);
  check('…Adjust picture keeps where it was put', same(seen.state?.bottomPicture?.place, PLACED), JSON.stringify(seen.state?.bottomPicture?.place));

  // The Design view's two faces: opening Bottom turns it over, the stage's Top | Bottom switch
  // flips it while Bottom stays open, and leaving Bottom turns it back. Never saved.
  worker.layout = true;
  ui().onDesignView(true);
  await clock.advance(300);
  ui().onCategory('bottom');
  await clock.advance(50);
  check('2D: opening Bottom lays out the underside', seen.state?.designSide === 'bottom' && !!seen.designInput?.underside, String(seen.state?.designSide));
  ui().onDesignSide('top');
  await clock.advance(50);
  check('…the 2D switch shows the top while Bottom stays open', seen.state?.designSide === 'top' && !seen.designInput?.underside, String(seen.state?.designSide));
  ui().onDesignSide('bottom');
  await clock.advance(50);
  ui().onCategory('shape');
  await clock.advance(50);
  check('…and leaving Bottom turns it back to the top', seen.state?.designSide === 'top' && !seen.designInput?.underside, String(seen.state?.designSide));
  ui().onDesignView(false);
  await clock.advance(50);

  // Saved: the settings in `settings`, the pixels beside the top picture's.
  ui().onSaveProject();
  const saved = seen.files.filter((f) => f.name.endsWith('-project.json')).at(-1);
  const file = saved ? JSON.parse(String(saved.data)) : null;
  check('Save writes settings.bottomPicture and the picture as bottomImage, beside image',
    same(file?.settings?.bottomPicture, seen.state?.bottomPicture) && typeof file?.bottomImage === 'string' && file.bottomImage.startsWith('data:image/png'),
    `${JSON.stringify(file?.settings?.bottomPicture)}; bottomImage ${typeof file?.bottomImage}`);

  // Remove, then Undo.
  await clock.advance(800);
  ui().onBottomRemove();
  await clock.advance(800);
  check('Remove takes it off: none in the state or the build',
    seen.state?.bottomPicture === null && !('bottomArt' in lastSent('buildClicker').params));
  ui().onSaveProject();
  const afterRemove = JSON.parse(String(seen.files.filter((f) => f.name.endsWith('-project.json')).at(-1)?.data));
  check('…and a project saved then has none', afterRemove.settings.bottomPicture === null && afterRemove.bottomImage === null);
  ui().onUndo();
  await clock.advance(300);
  check('…Undo brings it back, to the state and the build',
    same(seen.state?.bottomPicture?.pictureCrop, box) && lastSent('buildClicker')?.params.bottomArt?.regions?.[0]?.partName === 'bottom-color-0-0',
    JSON.stringify(seen.state?.bottomPicture));

  // Replace: a new picture, so nothing removed or cropped carries over.
  ui().onBottomPicture(new File([new Uint8Array(8)], 'other.png', { type: 'image/png' }));
  await clock.advance(300);
  check('Replace opens the window on the new picture with nothing removed or cropped, in the engine\'s place',
    same(seen.wizards.at(-1)?.initialEdits, []) && seen.wizards.at(-1)?.initialCrop === null && seen.wizards.at(-1)?.initialMapping === undefined
      && seen.state?.bottomPicture?.pictureCrop === null && !!lastSent('buildClicker')?.params.bottomArt
      && same(seen.state?.bottomPicture?.place, { x: 0, y: 0, rotation: 0, scale: 1 }),
    JSON.stringify(seen.state?.bottomPicture));

  // Opened again from the file.
  ui().onLoadProject(new File([String(saved?.data)], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  check('opening the project brings the bottom picture back, in the state, its trace and the build, where it was put',
    same(seen.state?.bottomPicture, file?.settings?.bottomPicture) && same(seen.imageTraces.at(-1)?.crop, box)
      && lastSent('buildClicker')?.params.bottomArt?.regions?.[0]?.partName === 'bottom-color-0-0'
      && same(file?.settings?.bottomPicture?.place, { x: 4, y: 0, rotation: 30, scale: 2 })
      && same(lastSent('buildClicker')?.params.bottomArt?.place, { x: 4, y: 0, rotation: 30, scale: 2 }),
    JSON.stringify(seen.state?.bottomPicture));

  // A block set and a cut model have no flat underside: hidden there, kept for the way back.
  ui().onImportMode('blocks');
  await clock.advance(300);
  check('Blocks: the build is sent no bottom picture, and the state keeps it',
    !!lastSent('buildBlocks') && !('bottomArt' in lastSent('buildBlocks').params) && !!seen.state?.bottomPicture);
  ui().onImportMode('model');
  await clock.advance(300);
  check('Model: no bottom picture shown, the state keeps it', !bottomPictureShown(seen.state?.importMode) && !!seen.state?.bottomPicture);
  ui().onImportMode('text');
  await clock.advance(300);
  check('…and back on a flat clicker it is built again', !!lastSent('buildClicker')?.params.bottomArt?.regions?.length);

  // Projects from before, or with a broken entry: none, and nothing of the last one lingers.
  ui().onLoadProject(new File([JSON.stringify({ version: 3, settings: { importMode: 'image' } })], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  check('a project from before the bottom picture opens with none', seen.state?.bottomPicture === null && !('bottomArt' in lastSent('buildClicker').params));
  const wizardsBefore = seen.wizards.length;
  ui().onBottomAdjust();
  await clock.advance(300);
  check('…and the last project\'s picture is gone: Adjust picture opens nothing', seen.wizards.length === wizardsBefore);
  const loads: [unknown, string][] = [
    [{ version: 3, settings: { importMode: 'image', bottomPicture: file?.settings?.bottomPicture } }, 'settings without the picture'],
    [{ version: 3, settings: { importMode: 'image', bottomPicture: 'junk' }, bottomImage: file?.bottomImage }, 'a picture without settings'],
  ];
  for (const [proj, what] of loads) {
    ui().onLoadProject(new File([JSON.stringify(proj)], 'clicker-project.json'));
    await until(() => status() === 'Loading project…');
    await clock.advance(600);
    check(`…and ${what} opens with none`, seen.state?.bottomPicture === null, JSON.stringify(seen.state?.bottomPicture));
  }
  const broken = { smoothing: 9, mappedColors: [{ rgb: [1, 2, 3], group: 4 }], mappedFilaments: 'x' };
  ui().onLoadProject(new File([JSON.stringify({ version: 3, settings: { importMode: 'image', bottomPicture: broken }, bottomImage: file?.bottomImage })], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  const cleaned = seen.state?.bottomPicture;
  check('…and broken settings load cleaned: smoothing held to 0..1, no colour pointing past the filaments, the engine\'s place',
    cleaned?.smoothing === 1 && same(cleaned?.mappedColors, []) && same(cleaned?.mappedFilaments, []) && cleaned?.removeBg === true && cleaned?.pictureCrop === null
      && same(cleaned?.place, { x: 0, y: 0, rotation: 0, scale: 1 }),
    JSON.stringify(cleaned));
  finish(unmount);
}

/* ======================================== the project file: complete, read back whole, held in range */

{
  /** JSON with every object's keys sorted, so key order never makes two values differ. */
  const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
  const same = (a: unknown, b: unknown) => canon(a) === canon(b);
  const saved = () => JSON.parse(String(seen.files.filter((f) => f.name.endsWith('-project.json')).at(-1)?.data ?? 'null'));
  const load = async (proj: unknown) => {
    ui().onLoadProject(new File([JSON.stringify(proj)], 'clicker-project.json'));
    await until(() => status() === 'Loading project…');
    await clock.advance(600);
  };
  const savedKeys = [...SAVED_SETTINGS] as string[];
  const notSaved = Object.keys(NOT_SAVED);
  /** The saved keys the fixture cannot set off their start value, and why: the shape editor is
   *  not in this build, and only it draws a shape whose points are saved; and only the Standard
   *  keycap can be cut shorter, so the fixture keeps it to carry a cut. */
  const SAME_AS_START = ['drawnShapeRings', 'blockKeycap'];

  const unmount = await fresh();
  const startState = seen.state;
  const unplaced = Object.keys(startState).filter((k) => !savedKeys.includes(k) && !notSaved.includes(k));
  const doubled = notSaved.filter((k) => savedKeys.includes(k));
  check('every field of the state is saved or listed as not saved, and none is both',
    unplaced.length === 0 && doubled.length === 0, `unplaced ${unplaced.join(', ') || 'none'}; both ${doubled.join(', ') || 'none'}`);
  ui().onSaveProject();
  const start = saved();
  const written = Object.keys(start?.settings ?? {});
  check('Save writes exactly the settings the list names',
    same([...written].sort(), [...savedKeys].sort()),
    `not listed: ${written.filter((k) => !savedKeys.includes(k)).join(', ') || 'none'}; not written: ${savedKeys.filter((k) => !written.includes(k)).join(', ') || 'none'}`);
  check('…and beside them the picture, the bottom picture and the picture window\'s memory',
    ['app', 'version', 'settings', 'palette', 'image', 'bottomImage', 'picture', 'model'].every((k) => k in start) && start.version === 3,
    Object.keys(start ?? {}).join(', '));
  const full = projectFull as any;
  const missing = savedKeys.filter((k) => !(k in full.settings));
  const atStart = savedKeys.filter((k) => !SAME_AS_START.includes(k) && same(full.settings[k], start.settings[k]));
  check('the full fixture holds every saved setting, each at a value the app does not start with',
    missing.length === 0 && atStart.length === 0, `missing ${missing.join(', ') || 'none'}; at the start value ${atStart.join(', ') || 'none'}`);

  // Round trip: a file holding every setting comes back out of Save as it went in.
  await load(full);
  ui().onSaveProject();
  const back = saved();
  const changed = savedKeys.filter((k) => !same(back?.settings?.[k], full.settings[k]));
  check('round trip: every setting of a loaded project is saved again as it was',
    changed.length === 0, changed.map((k) => `${k}: ${canon(full.settings[k])} -> ${canon(back?.settings?.[k])}`).join(' | '));
  check('…the bottom picture\'s pixels with it', typeof back?.bottomImage === 'string' && back.bottomImage.startsWith('data:image/'));
  check('…and a Text-mode project keeps its Model-mode buttons',
    seen.state?.modelCut?.buttons === 2 && seen.state?.modelCut?.more?.length === 1 && seen.state?.modelCut?.cutter === 'button',
    canon(seen.state?.modelCut));

  // A key the file does not have means the default, not what the last project had.
  await load({ version: 3, settings: { importMode: 'text', currentText: 'Bare' } });
  const d = startState;
  const kept = ['topThickness', 'imageDepth', 'tolerance', 'smoothing', 'removeBg', 'edgeSettings', 'blockLayout', 'blockStyle', 'legendScale', 'baseColorOverride', 'modelCut', 'bodyColorRgb']
    .filter((k) => !same(seen.state?.[k], d[k]));
  check('a project without a setting opens with its default, not the last project\'s value',
    kept.length === 0, kept.map((k) => `${k} ${canon(seen.state?.[k])}`).join(' | '));

  // Hand-edited numbers land in range, in the state as well as on the controls.
  await load({
    version: 3,
    settings: {
      importMode: 'text', capWidthMm: 9999, tolerance: 50, topThickness: -3, smoothing: 99, socketFitPct: 400,
      colorCount: 99, capProud: 90, imageDepth: 100, baseShape: 'circle', textScale: 0.01, lineSpacing: 0, letterSpacing: 5, textBold: -9,
      extrudeChamferMm: 7, keychainSlideMm: -500, stemFitMm: 3, stemOuterMm: -1, designScale: 50, artMm: 5000,
      fixedSize: { w: 5, h: 999 }, keychain: { enabled: true, angleDeg: 450, holeDiameterMm: 50, offsetMm: 99 },
    },
  });
  const s = seen.state;
  const lim = SETTING_LIMITS;
  const held: [string, unknown, unknown][] = [
    ['capWidthMm', s.capWidthMm, lim.capWidthMm[1]], ['tolerance', s.tolerance, lim.tolerance[1]],
    ['topThickness', s.topThickness, lim.topThickness[0]], ['smoothing', s.smoothing, lim.smoothing[1]],
    ['socketFitPct', s.socketFitPct, lim.socketFitPct[1]], ['colorCount', s.colorCount, lim.colorCount[1]],
    ['capProud', s.capProud, lim.capProud[1]], ['imageDepth', s.imageDepth, lim.imageDepth[1]],
    ['textScale', s.textScale, lim.textScale[0]], ['lineSpacing', s.lineSpacing, lim.lineSpacing[0]],
    ['letterSpacing', s.letterSpacing, lim.letterSpacing[1]], ['textBold', s.textBold, lim.textBold[0]],
    ['extrudeChamferMm', s.extrudeChamferMm, lim.extrudeChamferMm[1]], ['keychainSlideMm', s.keychainSlideMm, lim.keychainSlideMm[0]],
    ['stemFitMm', s.stemFitMm, lim.stemFitMm[1]], ['stemOuterMm', s.stemOuterMm, lim.stemOuterMm[0]],
    ['designScale', s.designScale, lim.designScale[1]], ['artMm', s.artMm, ART_MM_MAX],
    ['fixedSize', s.fixedSize, { w: lim.fixedSizeMm[0], h: lim.fixedSizeMm[1] }],
    ['keychain', s.keychain, { enabled: true, style: 'loop', angleDeg: 90, holeDiameterMm: lim.keychainHoleMm[1], offsetMm: lim.keychainOffsetMm[1] }],
  ];
  const out = held.filter(([, got, want]) => !same(got, want));
  check('numbers past a control\'s range load at its end, in the state', out.length === 0,
    out.map(([k, got, want]) => `${k} ${canon(got)} (want ${canon(want)})`).join(' | '));
  await load({ version: 3, settings: { importMode: 'text', colorCount: 'many', capWidthMm: '40', removeBg: 'yes', switches: 'x', keychain: 'yes' } });
  check('…and a value of the wrong type loads as the default',
    seen.state?.colorCount === d.colorCount && seen.state?.capWidthMm === d.capWidthMm && seen.state?.removeBg === d.removeBg
      && same(seen.state?.switches, [{ x: 0, y: 0, rotation: 0 }]) && same(seen.state?.keychain, d.keychain),
    canon({ colorCount: seen.state?.colorCount, capWidthMm: seen.state?.capWidthMm, removeBg: seen.state?.removeBg, keychain: seen.state?.keychain }));

  // A file saved by the live build, before these settings existed.
  await load(projectOld);
  const o = seen.state;
  check('a project from before opens with every new setting at its default',
    o.stemOuterMm === 0 && o.artMm === null && same(o.pictureEdits, []) && o.pictureCrop === null && o.bottomPicture === null
      && o.keychain.style === 'loop' && o.modelCut.buttons === 1 && same(o.modelCut.more, []),
    canon({ stemOuterMm: o.stemOuterMm, artMm: o.artMm, edits: o.pictureEdits, crop: o.pictureCrop, bottom: o.bottomPicture, keychain: o.keychain, buttons: o.modelCut.buttons }));
  const oldParams = lastSent('buildClicker')?.params;
  check('…and builds as it did: no held picture size, no bottom picture, a loop, the post as drawn',
    !!oldParams && !('artMm' in oldParams) && !('bottomArt' in oldParams) && oldParams.keychain?.style === 'loop'
      && (oldParams.stemOuterMm ?? 0) === 0 && oldParams.capWidthMm === (projectOld as any).settings.capWidthMm,
    canon({ artMm: oldParams?.artMm, keychain: oldParams?.keychain, stemOuterMm: oldParams?.stemOuterMm, w: oldParams?.capWidthMm }));
  // The keyring and the cut gain fields (their defaults); everything else comes back as it was.
  const oldSet = (projectOld as any).settings;
  const oldKept = Object.keys(oldSet).filter((k) => k in seen.state && k !== 'keychain' && k !== 'modelCut' && !same(seen.state[k], oldSet[k]));
  check('…keeping every setting it had', oldKept.length === 0, oldKept.map((k) => `${k} ${canon(seen.state[k])}`).join(' | '));
  ui().onSaveProject();
  const resaved = saved();
  check('…and saved again it is a whole current file', same(Object.keys(resaved.settings).sort(), [...savedKeys].sort()) && resaved.picture === null,
    `${Object.keys(resaved.settings).length} settings, picture ${canon(resaved.picture)}`);

  // The cap's colour picked by hand, in a file with no palette.
  await load({ version: 3, settings: { importMode: 'text', baseColorOverride: [7, 7, 7] } });
  check('a hand-picked cap colour comes back from a file without a palette', same(seen.state?.baseColorOverride, [7, 7, 7]), canon(seen.state?.baseColorOverride));

  // A shape drawn where the shape editor is, opened where it is not (this build has none).
  await load({ version: 3, settings: { importMode: 'text', currentText: 'Hi', baseShape: 'custom', drawnShapeRings: [[[0, 0], [10, 0], [0, 10]]] } });
  check('a drawn base shape this build cannot open: the status line says the base is a circle',
    status().includes('cannot open a drawn base shape') && seen.state?.drawnShapeId === null, status());

  // A hand-edited mapping: no picture colour points at a filament the file does not have.
  await load({
    version: 3,
    settings: { importMode: 'image', colorMode: 'mapped', mappedColors: [{ rgb: [1, 2, 3], group: 0 }, { rgb: [4, 5, 6], group: 3 }, 'x'], mappedFilaments: [[9, 9, 9], 'red'] },
    image: 'data:image/png;base64,saved',
  });
  check('the picture\'s colours load cleaned: none past the filaments, no broken filament',
    same(seen.state?.mappedColors, [{ rgb: [1, 2, 3], group: 0 }]) && same(seen.state?.mappedFilaments, [[9, 9, 9]]),
    canon({ colors: seen.state?.mappedColors, filaments: seen.state?.mappedFilaments }));

  // A picture that is an address, not the picture's data, is never fetched.
  const fetched: string[] = [];
  const g = globalThis as Record<string, any>;
  const PlainImage = g.Image;
  g.Image = class extends PlainImage {
    set src(url: string) {
      fetched.push(url);
      super.src = url;
    }
  };
  await load({
    version: 3,
    settings: { importMode: 'image', bottomPicture: { smoothing: 0.1 } },
    image: 'https://example.invalid/a.png',
    bottomImage: 'https://example.invalid/b.png',
  });
  g.Image = PlainImage;
  check('a picture given as an address is not read: nothing fetched, and no bottom picture',
    fetched.length === 0 && seen.state?.bottomPicture === null, fetched.join(', ') || 'nothing fetched');

  // A keyring saved as a Hole: built as today's Hole, the tunnel through the base.
  const oldHole = { ...(projectOld as any), settings: { ...(projectOld as any).settings, keychain: { enabled: true, style: 'hole', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 } } };
  await load(oldHole);
  check('a project whose keyring is a Hole builds the Hole', lastSent('buildClicker')?.params.keychain?.style === 'hole' && seen.state?.keychain?.style === 'hole',
    canon(lastSent('buildClicker')?.params.keychain));
  finish(unmount);
}

{
  // A project opened after a sample was picked, or after a picture: nothing of either stays.
  const canon = (v: unknown) => JSON.stringify(v);
  const saved = () => JSON.parse(String(seen.files.filter((f) => f.name.endsWith('-project.json')).at(-1)?.data ?? 'null'));
  const load = async (proj: unknown) => {
    ui().onLoadProject(new File([JSON.stringify(proj)], 'clicker-project.json'));
    await until(() => status() === 'Loading project…');
    await clock.advance(600);
  };
  const unmount = await fresh();
  const startTile = seen.state?.loadedSampleId;
  await load({ version: 3, settings: { importMode: 'image', currentImageName: 'cat' }, image: 'data:image/png;base64,cat' });
  check('a project opened over a sample: the sample tile is no longer marked', !!startTile && seen.state?.loadedSampleId === null,
    `${startTile} -> ${seen.state?.loadedSampleId}`);
  const exp = press();
  await clock.advance(100);
  check('…and its export is named after the project\'s picture', exp.done && seen.downloads[0]?.name === 'clicker-cat.3mf', String(seen.downloads[0]?.name));

  await load({ version: 3, settings: { importMode: 'text', currentText: 'Words' } });
  ui().onSaveProject();
  const text = saved();
  check('a Text project opened after a picture one: Save writes no picture and no picture window memory',
    text?.image === null && text?.picture === null, canon({ image: typeof text?.image, picture: text?.picture }));
  const before = seen.wizards.length;
  ui().onAdjustImage();
  await clock.advance(300);
  check('…and Adjust image has no picture to open', seen.wizards.length === before && status() === 'Load an image first.', status());
  finish(unmount);
}

{
  // The picture window's memory: what it ran on and with, through a save and a load.
  const canon = (v: unknown) => JSON.stringify(v);
  const saved = () => JSON.parse(String(seen.files.filter((f) => f.name.endsWith('-project.json')).at(-1)?.data ?? 'null'));
  const load = async (proj: unknown) => {
    ui().onLoadProject(new File([JSON.stringify(proj)], 'clicker-project.json'));
    await until(() => status() === 'Loading project…');
    await clock.advance(600);
  };
  /* A picture decodes 4 px wide, and 5 px when its data says "source", so a check can tell the
     picture before the sliders from the saved one. */
  const g = globalThis as Record<string, any>;
  const PlainImage = g.Image;
  g.Image = class extends PlainImage {
    set src(url: string) {
      if (url.includes('source')) this.naturalWidth = 5;
      super.src = url;
    }
  };
  const unmount = await fresh();
  ui().onUpload(new File([new Uint8Array(8)], 'a.png', { type: 'image/png' }));
  await clock.advance(300);
  const pictureA = seen.wizards.at(-1)?.baseImage;
  ui().onSaveProject();
  const first = saved();
  check('Save keeps the picture window\'s sliders, and no second picture when they changed nothing',
    first?.picture?.source === null && first?.picture?.preprocess?.keepBackground === false, canon(first?.picture));

  const mapping = { colors: [{ rgb: [10, 20, 30], group: 0 }], filaments: [[200, 0, 0]] };
  const imageProject = {
    version: 3,
    settings: { importMode: 'image', colorMode: 'mapped', mappedColors: mapping.colors, mappedFilaments: mapping.filaments },
    image: 'data:image/png;base64,saved',
  };
  await load(imageProject);
  ui().onAdjustImage();
  await clock.advance(300);
  const reopened = seen.wizards.at(-1);
  check('a project from before the window\'s memory: Adjust image opens its own picture, not the last one, with its colours',
    !!reopened?.baseImage && reopened.baseImage !== pictureA && reopened.baseImage.width === 4
      && canon(reopened.initialMapping?.colors) === canon(mapping.colors) && reopened.initialPreprocess === undefined,
    canon({ width: reopened?.baseImage?.width, mapping: reopened?.initialMapping, preprocess: reopened?.initialPreprocess }));

  await load({ ...imageProject, picture: { preprocess: { contrast: 1.4, keepBackground: true, exposure: 'x' }, source: 'data:image/png;base64,source' } });
  ui().onAdjustImage();
  await clock.advance(300);
  const withSource = seen.wizards.at(-1);
  check('a project with the window\'s memory: Adjust image opens the picture before the sliders, with the sliders',
    withSource?.baseImage?.width === 5 && withSource?.initialPreprocess?.contrast === 1.4 && withSource?.initialPreprocess?.exposure === 1
      && canon(withSource?.initialMapping?.colors) === canon(mapping.colors),
    canon({ width: withSource?.baseImage?.width, preprocess: withSource?.initialPreprocess }));
  await load({ ...imageProject, picture: { preprocess: { contrast: 1.4 }, source: 'data:image/png;base64,source' } });
  ui().onSaveProject();
  const again = saved();
  check('…and Save writes that picture and those sliders again',
    typeof again?.picture?.source === 'string' && again.picture.preprocess?.contrast === 1.4, canon(again?.picture?.preprocess));
  g.Image = PlainImage;
  finish(unmount);
}

{
  // The MakerWorld build saves and opens the same file, the same way: a download and the picker.
  const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
  const unmount = await fresh(() => (knobs.makerlab = true));
  ui().onLoadProject(new File([JSON.stringify(projectFull)], 'clicker-project.json'));
  await until(() => status() === 'Loading project…');
  await clock.advance(600);
  ui().onSaveProject();
  const files = seen.files.filter((f) => f.name.endsWith('-project.json'));
  const back = files.length ? JSON.parse(String(files.at(-1)!.data)) : null;
  const changed = (SAVED_SETTINGS as readonly string[]).filter((k) => canon(back?.settings?.[k]) !== canon((projectFull as any).settings[k]));
  check('MakerWorld build: Save downloads the project file, the one the website writes', back?.app === 'clicker-generator' && files.length === 1,
    `${files.length} files`);
  check('…not through the host\'s export, and with no licence nudge', seen.sdkExports.length === 0 && kit.licence.length === 0,
    `${seen.sdkExports.length} exports, ${kit.licence.length} nudges`);
  check('…and a project opened there is saved again as it was', changed.length === 0, changed.join(', '));
  finish(unmount);
}

/* ---------------------------------------------------------------- */

print(failures ?`\n${failures} FAILED` : '\nExport writes the build on screen, whatever happened before it was pressed');
process.exit(failures ? 1 : 0);

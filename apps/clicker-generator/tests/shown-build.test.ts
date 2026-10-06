/*
  Export sends the build on screen, once it has landed (src/export/shownBuild.ts).

  What this pins: Export used to hand the 3MF writer whatever parts had arrived last. A click a
  beat after an edit exported the model from before it, a build that failed left the one before
  it to be exported with a success message, and the browser download sent the design while the
  fit test's tiles were on screen.

  The tracker is driven with the geometry worker's own messages, through a stand-in worker that
  answers the oldest request it holds (the real one answers in arrival order: see shownBuild.ts)
  and a stand-in for mount.ts that keeps the parts on screen the way mount.ts does. How mount.ts
  wires it (the holds, the pokes, the failures it reports) is checked by driving the real mount()
  in tests/mount.test.mjs; the last checks here read mount.ts and the worker as text: every
  exporter is handed the settled parts, every debounced build is waited out, every message to the
  worker is counted, and a failure names the request it belongs to.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/shown-build.test.ts \
      --bundle --platform=node --format=esm \
      --outfile=apps/clicker-generator/.shown-build-test.mjs \
      && node apps/clicker-generator/.shown-build-test.mjs
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shownBuild, type Shown } from '../src/export/shownBuild.ts';
import type { BuildParams, ClickerPart, GeometryRequest, GeometryResponse } from '../src/types.ts';
import type { ModelCutParams } from '../src/model/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (!ok) failures++;
};

/** One part, named after the build it came from, so a check can say which build Export got. */
const partsOf = (name: string): ClickerPart[] => [
  {
    kind: 'cap',
    group: 'top',
    colorRgb: [200, 200, 200],
    name,
    numProp: 3,
    vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    triVerts: new Uint32Array([0, 1, 2]),
  },
];
const nameOf = (shown: Shown | null | undefined) => shown?.parts[0]?.name ?? String(shown);

/** Lets queued work run: the tracker settles everything in a microtask. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A promise's state, readable without awaiting it. */
function watch<T>(p: Promise<T>) {
  const state: { done: boolean; value?: T; error?: Error } = { done: false };
  p.then(
    (value) => Object.assign(state, { done: true, value }),
    (error: Error) => Object.assign(state, { done: true, error }),
  );
  return state;
}

/**
 * mount.ts around the tracker, cut down to what decides what Export gets: the parts on screen,
 * the fit test, the debounces, and a worker that answers the oldest request it holds with the
 * parts or the failure a check hands it.
 */
function app() {
  let design: ClickerPart[] = [];
  let tiles: ClickerPart[] = [];
  let fitTest = false;
  let editPending = false; // a debounced rebuild counting down
  let stepPending = false; // the fit test's debounced strip counting down
  let fitSeq = 0;
  const inbox: GeometryRequest[] = [];
  const params = {} as BuildParams;
  const cut = {} as ModelCutParams;

  const t = shownBuild({
    fitTest: () => fitTest,
    design: () => design,
    tiles: () => tiles,
    designPending: () => editPending,
    tilesPending: () => stepPending,
  });
  const send = (msg: GeometryRequest) => {
    inbox.push(msg);
    t.sent(msg);
  };
  /** mount.ts's `worker.onmessage`, as far as the parts on screen go. */
  const receive = (msg: GeometryResponse) => {
    t.answered(msg);
    if (msg.type !== 'parts') return;
    if (!msg.requestId) design = msg.parts;
    else if (msg.requestId === `fit${fitSeq}` && fitTest) tiles = msg.parts;
  };
  const strip = () => {
    stepPending = false;
    send({ type: 'buildFitStrip', labels: [], colorRgb: [0, 0, 0], requestId: `fit${++fitSeq}` });
  };
  const requestIdOf = (req: GeometryRequest) => ('requestId' in req ? req.requestId : undefined);

  return {
    t,
    get inFlight() {
      return t.designsInFlight;
    },
    /** A control moved: its debounce starts counting down. */
    edit() {
      editPending = true;
      t.poke();
    },
    /** The debounce ran out, or a rebuild was asked for straight away: a design build goes out. */
    build() {
      editPending = false;
      send({ type: 'buildClicker', regions: [], outline: [], params });
      t.poke();
    },
    buildBlocks: () => send({ type: 'buildBlocks', regions: [], params }),
    buildModel: () => send({ type: 'buildModel', params: cut }),
    /** A result card's picture: correlated, never the viewport's. */
    card: (requestId: string) => send({ type: 'buildModel', params: cut, requestId }),
    importModel: () => send({ type: 'importModel', bytes: new ArrayBuffer(0), name: 'figure.stl' }),
    /** Parts put on screen without a build, like the prebuilt sample. */
    show(name: string) {
      design = partsOf(name);
      t.shown();
    },
    /** The fit test opens: its tiles replace the design on screen and the first strip goes out. */
    openFitTest() {
      fitTest = true;
      strip();
      t.poke();
    },
    closeFitTest() {
      fitTest = false;
      fitSeq++;
      tiles = [];
      t.poke();
    },
    /** The stem fit stepper moved under the fit test: a new strip is counting down. */
    step() {
      stepPending = true;
      t.poke();
    },
    /** That countdown ran out. */
    strip() {
      strip();
      t.poke();
    },
    /** The worker answers the oldest request it holds. */
    answer(name: string) {
      const req = inbox.shift()!;
      receive({ type: 'parts', parts: partsOf(name), switchPlacements: [], warnings: [], requestId: requestIdOf(req) });
    },
    fail(message: string) {
      const req = inbox.shift()!;
      receive({ type: 'error', message, request: req.type, requestId: requestIdOf(req) });
    },
  };
}

/* ------------------------------------------------------------------ edit, then Export */

{
  const a = app();
  check('nothing built yet: Export has nothing to send', (await a.t.settled()) === null);
}

{
  const a = app();
  a.build();
  a.answer('before-edit');
  a.edit(); // the user moves a slider…
  const exp = watch(a.t.settled()); // …and presses Export before its debounce runs out
  await tick();
  const waitedForDebounce = !exp.done;
  a.build(); // the debounce runs out: the edit goes to the worker
  await tick();
  const waitedForBuild = !exp.done;
  a.answer('after-edit');
  await tick();
  check('edit then Export at once: Export waits out the debounce', waitedForDebounce);
  check('…and the build the debounce starts', waitedForBuild);
  check('…and exports the edited build, not the model on screen when Export was pressed', nameOf(exp.value) === 'after-edit', `got ${nameOf(exp.value)}`);
}

{
  const a = app();
  a.build();
  a.build();
  const exp = watch(a.t.settled());
  a.answer('older');
  await tick();
  const waited = !exp.done;
  a.answer('newer');
  await tick();
  check('two builds in flight: Export does not take the older one', waited);
  check('…it takes the newest', nameOf(exp.value) === 'newer', `got ${nameOf(exp.value)}`);
}

{
  const a = app();
  a.build();
  const exp = watch(a.t.settled());
  // A reply whose handler sends the next build in the same task (a trace after initDone, a
  // model's build after its import): Export must not take the reply in between.
  a.answer('first');
  a.build();
  await tick();
  const waited = !exp.done;
  a.answer('second');
  await tick();
  check('a reply that is followed at once by the next build: Export waits for that build', waited && nameOf(exp.value) === 'second', `got ${nameOf(exp.value)}`);
}

{
  const a = app();
  a.build();
  const one = watch(a.t.settled());
  const two = watch(a.t.settled());
  a.answer('only');
  await tick();
  check('Export pressed twice: both get the same build', nameOf(one.value) === 'only' && nameOf(two.value) === 'only');
}

/* ------------------------------------------------------------------ the fit test */

{
  const a = app();
  a.build();
  a.answer('design');
  a.openFitTest();
  const exp = watch(a.t.settled());
  await tick();
  const waited = !exp.done;
  a.answer('tiles');
  await tick();
  check('fit test showing: Export waits for its strip', waited);
  check('…and sends the tiles, not the design', nameOf(exp.value) === 'tiles' && exp.value?.fitTest === true, `got ${nameOf(exp.value)}, fitTest ${exp.value?.fitTest}`);
}

{
  const a = app();
  a.build();
  a.answer('design');
  a.build(); // still in flight when the fit test opens
  a.openFitTest();
  const exp = watch(a.t.settled());
  a.answer('design-late'); // lands under the fit test: kept for later, not shown
  await tick();
  const waited = !exp.done;
  a.answer('tiles');
  await tick();
  check('a design build landing under the fit test is not what Export sends', waited && nameOf(exp.value) === 'tiles', `got ${nameOf(exp.value)}`);
  a.closeFitTest();
  const back = await a.t.settled();
  check('…and once the fit test closes, Export sends the newest design', nameOf(back) === 'design-late' && back?.fitTest === false, `got ${nameOf(back)}`);
}

{
  const a = app();
  a.openFitTest();
  a.answer('tiles-1');
  a.step();
  const exp = watch(a.t.settled());
  await tick();
  const waitedForStep = !exp.done;
  a.strip();
  await tick();
  const waitedForStrip = !exp.done;
  a.answer('tiles-2');
  await tick();
  check('stem fit stepped under the fit test: Export waits for the new tiles', waitedForStep && waitedForStrip && nameOf(exp.value) === 'tiles-2', `got ${nameOf(exp.value)}`);
}

{
  const a = app();
  a.openFitTest();
  a.strip(); // two strips out: the first was replaced before it landed
  const exp = watch(a.t.settled());
  a.answer('tiles-replaced');
  await tick();
  const waited = !exp.done;
  a.answer('tiles-newest');
  await tick();
  check('a replaced strip is not exported', waited && nameOf(exp.value) === 'tiles-newest', `got ${nameOf(exp.value)}`);
}

{
  const a = app();
  a.build();
  a.answer('design');
  a.build();
  const exp = watch(a.t.settled());
  a.openFitTest(); // opened while Export waits on the design
  a.answer('design-2');
  await tick();
  const waited = !exp.done;
  a.answer('tiles');
  await tick();
  check('the fit test opened while Export waits: it sends what the screen then shows', waited && nameOf(exp.value) === 'tiles' && exp.value?.fitTest === true, `got ${nameOf(exp.value)}`);
}

/* ------------------------------------------------------------------ failures refuse */

{
  const a = app();
  a.build();
  a.answer('good');
  a.build();
  a.fail('RangeError: Invalid array length\n    at buildClicker (geometry.worker.js:1:1)');
  const refused = watch(a.t.settled());
  await tick();
  check('a failed build refuses: the build before it is not exported', refused.done && refused.value === undefined && !!refused.error);
  check("…in the status line's words", refused.error?.message === 'Error: RangeError: Invalid array length', refused.error?.message);
  a.build();
  a.answer('fixed');
  check('the next good build lifts the refusal', nameOf(await a.t.settled()) === 'fixed');
}

{
  const a = app();
  a.build();
  a.answer('good');
  a.build();
  const exp = watch(a.t.settled()); // pressed while the build is still running…
  await tick();
  const waited = !exp.done;
  a.fail('Boolean failed'); // …which then fails
  await tick();
  check('Export pressed during a build that then fails: refused, not the build before', waited && exp.error?.message === 'Error: Boolean failed', exp.error?.message ?? nameOf(exp.value));
}

{
  const a = app();
  a.build();
  a.answer('good');
  a.t.failed('No outline found. Turn off Remove background, or use Adjust image to check the trace.');
  const refused = watch(a.t.settled());
  await tick();
  check('a trace that finds nothing refuses: the model on screen is from before the change', refused.error?.message.startsWith('No outline found.') === true, refused.error?.message ?? nameOf(refused.value));
  a.build();
  a.answer('traced');
  check('…until a build lands', nameOf(await a.t.settled()) === 'traced');
}

{
  const a = app();
  a.build(); // a build from before the change…
  a.t.failed('Error: Unexpected end of SVG'); // …then the change's trace fails…
  a.answer('stale'); // …then the older build lands
  const refused = watch(a.t.settled());
  await tick();
  check('an older build landing after a newer failure does not lift it', refused.error?.message === 'Error: Unexpected end of SVG', refused.error?.message ?? nameOf(refused.value));
}

{
  const a = app();
  a.build();
  a.answer('design');
  a.openFitTest();
  a.fail('Assets not initialized');
  const refused = watch(a.t.settled());
  await tick();
  check('a failed fit test strip refuses the tiles', refused.error?.message === 'Error: Assets not initialized', refused.error?.message ?? nameOf(refused.value));
  check('…without counting down a design build', a.inFlight === 0);
  a.closeFitTest();
  check('…and the design still exports once the fit test closes', nameOf(await a.t.settled()) === 'design');
}

/* ------------------------------------------------------------------ whose failure it is */

{
  const a = app();
  a.build();
  a.answer('A');
  a.card('m1'); // a result card's picture…
  a.importModel(); // …and a model import, both ahead of…
  a.build(); // …the design build Export has to wait for
  const counted = a.inFlight;
  const exp = watch(a.t.settled());
  a.fail('Assets not initialized'); // the card's failure
  a.fail('That is not a 3D model'); // the import's failure
  await tick();
  const afterThem = a.inFlight;
  const settledEarly = exp.done;
  a.answer('B');
  await tick();
  check("another request's failure is not the design's: Export keeps waiting", counted === 1 && afterThem === 1 && !settledEarly, `design builds in flight ${counted}, after the two failures ${afterThem}; settled early: ${settledEarly}`);
  check('…and sends the design build when it lands', nameOf(exp.value) === 'B', `got ${nameOf(exp.value)}`);
}

{
  const a = app();
  a.build();
  a.buildBlocks();
  a.buildModel();
  a.card('m1');
  a.importModel();
  a.openFitTest();
  check('only the design builds count as in flight', a.inFlight === 3, `${a.inFlight}`);
}

/* ------------------------------------------------------------------ the worker stops */

{
  const a = app();
  a.build();
  a.answer('A');
  a.build();
  const exp = watch(a.t.settled());
  a.t.crashed('Worker failed: out of memory');
  await tick();
  check('the worker stops mid-build: Export refuses rather than waiting for ever', exp.error?.message === 'Worker failed: out of memory', exp.error?.message ?? nameOf(exp.value));
  check('…and nothing is left in flight for the spinner', a.inFlight === 0);
}

{
  const a = app();
  a.build();
  a.answer('A');
  a.t.crashed('Worker failed: script error');
  check('the worker stops with nothing in flight: the model on screen still exports', nameOf(await a.t.settled()) === 'A');
  a.edit();
  const exp = watch(a.t.settled());
  await tick();
  check('…but an edit it can no longer build is refused, not swapped for that model', exp.error?.message === 'Worker failed: script error', exp.error?.message ?? nameOf(exp.value));
}

{
  const a = app();
  a.build();
  a.t.crashed('Worker failed: script error');
  a.answer('B'); // it answers after all
  check('a worker that answers after an error event: its build exports', nameOf(await a.t.settled()) === 'B');
  a.build();
  const exp = watch(a.t.settled());
  await tick();
  const waited = !exp.done;
  a.answer('C');
  await tick();
  check('…and its next build is waited for again, not refused', waited && nameOf(exp.value) === 'C', exp.error?.message ?? nameOf(exp.value));
}

/* ------------------------------------------------------------------ parts without a build */

{
  const a = app();
  a.show('prebuilt-sample');
  check('parts put on screen without a build export as they are', nameOf(await a.t.settled()) === 'prebuilt-sample');
  a.t.failed('No outline found.');
  a.show('shown-after');
  check('…and lift an earlier refusal', nameOf(await a.t.settled()) === 'shown-after');
}

/* ------------------------------------------------------------------ mount.ts and the worker */

const read = (p: string) => readFileSync(join(process.cwd(), 'apps/clicker-generator/src', p), 'utf8');
const mount = read('mount.ts');
const worker = read('workers/geometry.worker.ts');

const onExport = mount.slice(mount.indexOf('onExport: async () => {'), mount.indexOf('onRenderPng:'));
const writers = ['clickerObjMtl(', 'clickerThreeMF(', 'downloadClickerThreeMF('];
const firstWrite = Math.min(...writers.map((w) => onExport.indexOf(w)).filter((i) => i >= 0));
const settledAt = onExport.indexOf('await onScreen.settled()');
check('Export awaits the build on screen before it writes anything', settledAt >= 0 && settledAt < firstWrite);
check("Export never reads the preview's own parts variables", !/\b(latestParts|fitStripParts)\b/.test(onExport));

const exporterCalls = [...mount.matchAll(/\b(downloadClickerThreeMF|clickerThreeMF|clickerObjMtl)\(\s*([\w$]+)/g)].map((m) => `${m[1]}(${m[2]}`);
check('every exporter call in mount.ts is handed the settled parts', exporterCalls.length === 3 && exporterCalls.every((c) => c.endsWith('(parts')), exporterCalls.join(', '));

// A debounced build Export does not know about is one it would export past.
const debounced = [...mount.matchAll(/\bconst (\w+) = debounce\(/g)].map((m) => m[1]).filter((n) => n !== 'commitHistory');
const unwatched = debounced.filter((n) => !mount.includes(`${n}.pending()`));
check('every debounced build is waited out by Export', debounced.length >= 4 && unwatched.length === 0, unwatched.length ? `not waited out: ${unwatched.join(', ')}` : debounced.join(', '));

check('every message to the worker goes through send(), which counts it',
  (mount.match(/\bworker\.postMessage\(/g) ?? []).length === 1
  && /function send\([\s\S]{0,120}?\{\s*worker\.postMessage\([^;]*;\s*onScreen\.sent\(msg\);/.test(mount));
check('every reply from the worker reaches the tracker before anything acts on it',
  /worker\.onmessage = [\s\S]{0,120}?const msg = e\.data;[\s\S]{0,160}?onScreen\.answered\(msg\);\s*switch \(msg\.type\)/.test(mount));
check('a stopped worker is reported to the tracker', /worker\.onerror = [\s\S]{0,200}?onScreen\.crashed\(/.test(mount));
check('the worker says which request a failure belongs to',
  /type: 'error',[\s\S]{0,400}?request: msg\?\.type,[\s\S]{0,200}?requestId: /.test(worker));

console.log(failures ? `\n${failures} FAILED` : '\nExport sends the build on screen, once it has landed');
process.exit(failures ? 1 : 0);

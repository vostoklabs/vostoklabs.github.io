/*
  The build loop and the worker transport, without a browser.

    pnpm --filter @vostok/ui-kit test

  Each case is one of the failures the loop exists to prevent: an export that reads the
  previous build, an edit dropped behind a failed build, a build that never ends, a late reply
  landing after a mode switch, a worker whose death leaves its callers waiting forever.
*/
import {
  buildLoop,
  workerClient,
  answerRequests,
  NothingBuiltError,
  BuildTimeoutError,
} from '../src/build-loop';
import { syncControls, type ValueRow } from '../src/components/controls';

let passed = 0;
let failed = 0;
const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, fn: () => Promise<void> | void) => cases.push([name, fn]);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** A controllable async build: each call returns a promise the test settles by hand. */
function manualRun<T>() {
  const calls: { resolve: (v: T) => void; reject: (e: Error) => void }[] = [];
  return {
    calls,
    run: () => new Promise<T>((resolve, reject) => calls.push({ resolve, reject })),
  };
}

/** `p`, or a failure once `ms` have passed: a promise that hangs fails its check instead of
 *  stopping the suite. */
function within<T>(p: Promise<T>, ms = 200): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** Runs `fn` with console.error caught rather than printed, and returns what it was sent. */
async function errorsLogged(fn: () => Promise<void>): Promise<unknown[]> {
  const logged: unknown[] = [];
  const real = console.error;
  console.error = (...args: unknown[]) => { logged.push(args[0]); };
  try {
    await fn();
  } finally {
    console.error = real;
  }
  return logged;
}

/** Rejections nothing handled. A callback that threw inside the loop used to end up here, and
 *  node stops the process for one, so they are collected and checked at the end instead. */
const escaped: unknown[] = [];
process.on('unhandledRejection', (e) => { escaped.push(e); });

/* ------------------------------------------------------------------ buildLoop */

test('a burst of requests costs one build, built from the newest settings', async () => {
  let width = 10;
  let runs = 0;
  const loop = buildLoop({ debounceMs: 5, run: () => { runs++; return width; } });
  for (width = 11; width <= 15; width++) loop.request();
  width = 15;
  await tick(20);
  assert(runs === 1, `expected 1 build, got ${runs}`);
  assert(loop.latest === 15, `expected 15, got ${loop.latest}`);
});

test('changes made while a build runs cost exactly one more build', async () => {
  let width = 1;
  const m = manualRun<number>();
  const loop = buildLoop({ run: () => { const w = width; return m.run().then(() => w); } });
  loop.request();
  await tick();
  assert(m.calls.length === 1, 'first build should have started');
  for (width = 2; width <= 6; width++) loop.request();
  width = 6;
  await tick();
  assert(m.calls.length === 1, 'nothing else may start while one runs');
  m.calls[0]!.resolve(0);
  await tick();
  assert(m.calls.length === 2, `expected exactly one follow-up, got ${m.calls.length - 1}`);
  m.calls[1]!.resolve(0);
  await tick();
  assert(loop.latest === 6, `the follow-up must build the newest settings, got ${loop.latest}`);
  assert(!loop.busy, 'should be idle');
});

test('export a beat after a change gets the new build, not the previous one', async () => {
  let width = 1;
  const loop = buildLoop({ debounceMs: 1000, run: () => width });
  loop.request();
  loop.flush();
  await tick();
  assert(loop.latest === 1, 'first build');
  width = 2;
  loop.request(); // the user moves a slider; the debounce has not fired
  const got = await loop.settled(); // and clicks Download immediately
  assert(got === 2, `settled() returned the previous build (${got})`);
});

test('export waits for a build that is still running', async () => {
  const m = manualRun<string>();
  const loop = buildLoop({ run: m.run });
  loop.request();
  await tick();
  let got: string | null = null;
  void loop.settled().then((v) => { got = v; });
  await tick();
  assert(got === null, 'settled() must not resolve while the build runs');
  m.calls[0]!.resolve('new');
  await tick();
  assert(got === 'new', `expected the running build's result, got ${got}`);
});

test('after a failed build, export refuses instead of handing over the last good one', async () => {
  let fail = false;
  const loop = buildLoop({ run: () => { if (fail) throw new Error('boom'); return 'good'; } });
  loop.request();
  await tick();
  assert((await loop.settled()) === 'good', 'first build');
  fail = true;
  loop.request();
  await tick();
  let refused = false;
  await loop.settled().catch((e: Error) => { refused = e.message === 'boom'; });
  assert(refused, 'settled() must reject with the build error');
  assert(loop.latest === 'good', 'the preview may keep the last good build');
  fail = false;
  loop.request();
  assert((await loop.settled()) === 'good', 'a later good build clears the error');
});

test('an edit made while a build fails is built, not dropped', async () => {
  let width = 1;
  const m = manualRun<number>();
  const loop = buildLoop({ run: () => { const w = width; return m.run().then(() => w); } });
  loop.request();
  await tick();
  width = 2;
  loop.request(); // queued behind the running build
  await tick();
  m.calls[0]!.reject(new Error('the first one failed'));
  await tick();
  assert(m.calls.length === 2, 'the queued edit must still be built after a failure');
  m.calls[1]!.resolve(0);
  assert((await loop.settled()) === 2, 'and export gets it');
});

test('a build that never answers times out instead of spinning forever', async () => {
  let errors = 0;
  let idle = 0;
  const loop = buildLoop({
    timeoutMs: 30,
    run: () => new Promise<number>(() => {}),
    onError: () => errors++,
    onIdle: () => idle++,
  });
  loop.request();
  let timedOut = false;
  await loop.settled().catch((e) => { timedOut = e instanceof BuildTimeoutError; });
  assert(timedOut, 'settled() must reject with BuildTimeoutError');
  assert(errors === 1 && idle === 1, `onError ${errors}, onIdle ${idle}`);
  assert(!loop.busy, 'the loop must be idle again');
});

test('a late result after a timeout is ignored', async () => {
  const m = manualRun<string>();
  const loop = buildLoop({ timeoutMs: 20, run: m.run });
  loop.request();
  await loop.settled().catch(() => {});
  m.calls[0]!.resolve('late');
  await tick();
  assert(loop.latest === null, 'a result that arrives after the timeout must not count');
});

test('a reply that lands after a mode switch does not replace the new design', async () => {
  const m = manualRun<string>();
  let shown: string | null = null;
  const loop = buildLoop({ run: m.run, onResult: (r) => { shown = r; } });
  loop.request();
  await tick();
  loop.invalidate(); // the user switched mode while the old build ran
  m.calls[0]!.resolve('old mode');
  await tick();
  assert(shown === null, 'the old mode result reached the preview');
  let nothing = false;
  await loop.settled().catch((e) => { nothing = e instanceof NothingBuiltError; });
  assert(nothing, 'nothing current has been built, so export must refuse');
});

test('a synchronous throw is a failed build, not an uncaught error', async () => {
  const loop = buildLoop<number>({ run: () => { throw new Error('sync'); } });
  loop.request();
  let msg = '';
  await loop.settled().catch((e: Error) => { msg = e.message; });
  assert(msg === 'sync', `expected the thrown error, got "${msg}"`);
});

test('dispose rejects anyone still waiting', async () => {
  const m = manualRun<number>();
  const loop = buildLoop({ run: m.run });
  loop.request();
  await tick();
  const waiting = loop.settled().then(() => 'resolved', () => 'rejected');
  loop.dispose();
  assert((await waiting) === 'rejected', 'a disposed loop must not leave a caller hanging');
});

test('before anything is built, export refuses', async () => {
  const loop = buildLoop({ run: () => 1 });
  let nothing = false;
  await loop.settled().catch((e) => { nothing = e instanceof NothingBuiltError; });
  assert(nothing, 'expected NothingBuiltError');
});

/* The app's callbacks are the app's code. One that throws is reported, and the loop goes on. */

test('a throw in onResult neither strands Export nor drops the edit queued behind the build', async () => {
  let width = 1;
  const m = manualRun<number>();
  const loop = buildLoop({
    run: () => { const w = width; return m.run().then(() => w); },
    onResult: () => { throw new Error('the preview could not show it'); },
  });
  const logged = await errorsLogged(async () => {
    loop.request();
    await tick();
    const exported = within(loop.settled()); // Export, pressed while the build runs…
    width = 2;
    loop.request(); // …and an edit made behind it
    await tick();
    m.calls[0]!.resolve(0);
    await tick();
    assert(m.calls.length === 2, 'the edit queued behind the build was dropped');
    m.calls[1]!.resolve(0);
    assert((await exported) === 2, 'Export must get the newest build');
  });
  assert(logged.length === 2, `each throw is reported, once: ${logged.length} reported`);
  assert(!loop.busy, 'the loop must be idle again');
});

test('a throw in onError still refuses Export with the build error, and builds the queued edit', async () => {
  let width = 1;
  let fail = true;
  const m = manualRun<number>();
  const loop = buildLoop({
    run: () => { const w = width; return m.run().then(() => { if (fail) throw new Error('boom'); return w; }); },
    onError: () => { throw new Error('the error message could not be shown'); },
  });
  await errorsLogged(async () => {
    loop.request();
    await tick();
    const refused = within(loop.settled()).then(() => 'exported', (e: Error) => e.message);
    m.calls[0]!.resolve(0);
    assert((await refused) === 'boom', `Export must refuse with the build's own error, got "${await refused}"`);
    loop.request();
    await tick();
    const exported = within(loop.settled());
    width = 2;
    loop.request(); // an edit behind the build that is about to fail
    await tick();
    m.calls[1]!.resolve(0);
    await tick();
    assert(m.calls.length === 3, 'the edit queued behind the failed build was dropped');
    fail = false;
    m.calls[2]!.resolve(0);
    assert((await exported) === 2, 'and Export gets it');
  });
});

test('a throw in onStart neither stops the build nor leaves the loop busy for good', async () => {
  let width = 1;
  const loop = buildLoop({ run: () => width, onStart: () => { throw new Error('the busy state could not be shown'); } });
  await errorsLogged(async () => {
    loop.request();
    assert((await within(loop.settled())) === 1, 'the build must still run');
    width = 2;
    loop.request();
    assert((await within(loop.settled())) === 2, 'and so must the next one');
  });
  assert(!loop.busy, 'the loop must be idle again');
});

test('a throw in onIdle still answers Export', async () => {
  const loop = buildLoop({ run: () => 7, onIdle: () => { throw new Error('the busy state could not be cleared'); } });
  await errorsLogged(async () => {
    loop.request();
    assert((await within(loop.settled())) === 7, 'Export must get the build');
  });
});

/* --------------------------------------------------------------- seed and hold */

test('seed: an export of the prebuilt design gets it, with nothing built and nothing shown twice', async () => {
  let runs = 0;
  let shown = 0;
  const loop = buildLoop({ run: () => { runs++; return 'built'; }, onResult: () => { shown++; } });
  assert(loop.seed('prebuilt'), 'a seed before anything was asked for must be taken');
  assert(loop.latest === 'prebuilt', `latest is ${loop.latest}`);
  assert((await within(loop.settled())) === 'prebuilt', 'settled() must hand over the seed');
  assert(runs === 0 && shown === 0, `nothing runs (${runs}) and onResult is not called (${shown})`);
  assert(!loop.busy, 'the loop must be idle');
});

test('seed: the first change builds as usual and replaces it', async () => {
  let width = 1;
  const loop = buildLoop({ run: () => width });
  loop.seed(0);
  width = 2;
  loop.request();
  assert((await within(loop.settled())) === 2, 'export must get the build of the change, not the seed');
});

test('seed: refused once a build has been asked for, so a late prebuilt design never replaces an edit', async () => {
  const loop = buildLoop({ run: () => 'edited' });
  loop.request();
  assert((await loop.settled()) === 'edited', 'first build');
  assert(loop.seed('prebuilt') === false, 'a seed after a build must be refused');
  assert(loop.latest === 'edited' && (await loop.settled()) === 'edited', 'and the build stands');
});

test('seed: taken again after invalidate(), for the new design', async () => {
  const loop = buildLoop({ run: () => 'built' });
  loop.request();
  await loop.settled();
  loop.invalidate();
  assert(loop.seed('another design'), 'after invalidate() a seed is for the new settings');
  assert((await loop.settled()) === 'another design', 'and settled() hands it over');
});

test('seed: a seeded result is held to diagnose like a build', async () => {
  const loop = buildLoop<string[]>({ run: () => [], diagnose: (r) => r.map((message) => ({ level: 'error' as const, message })) });
  loop.seed(['It is bigger than the plate.']);
  const refused = await loop.settled().then(() => 'exported', (e: Error) => e.message);
  assert(refused === 'It is bigger than the plate.', `export must refuse in the error's words, got "${refused}"`);
});

test('hold: no build starts while a batch holds the loop, and the edits made meanwhile build once after', async () => {
  let width = 1;
  let runs = 0;
  const loop = buildLoop({ debounceMs: 5, run: () => { runs++; return width; } });
  loop.request();
  assert((await within(loop.settled())) === 1, 'first build');
  const release = loop.hold();
  assert(release, 'an idle loop can be held');
  for (width = 2; width <= 4; width++) loop.request(); // the user keeps editing during the batch
  width = 4;
  loop.flush();
  await tick(30);
  assert(runs === 1, `no build may start while held, ${runs - 1} did`);
  release!();
  await tick(10);
  assert(runs === 2, `exactly one build after the release, got ${runs - 1}`);
  assert(loop.latest === 4, `from the newest settings, got ${loop.latest}`);
});

test('hold: an export pressed during the batch waits for it, then gets the design on screen', async () => {
  let width = 1;
  const loop = buildLoop({ run: () => width });
  loop.request();
  await loop.settled();
  const release = loop.hold()!;
  let got: number | null = null;
  void loop.settled().then((v) => { got = v; });
  await tick(20);
  assert(got === null, 'settled() must wait while a batch holds the loop');
  width = 2;
  loop.request();
  release();
  assert((await within(loop.settled())) === 2, 'the edit made during the batch must be built');
  assert(got === 2, `and the export that waited gets it, got ${got}`);
});

test('hold: released with nothing asked, a waiting export gets the result there is and nothing rebuilds', async () => {
  let runs = 0;
  const loop = buildLoop({ run: () => { runs++; return 'cap'; } });
  loop.request();
  await loop.settled();
  const release = loop.hold()!;
  const waiting = within(loop.settled());
  release();
  assert((await waiting) === 'cap', 'the waiting export must get the result');
  assert(runs === 1, `nothing may rebuild, ${runs - 1} did`);
});

test('hold: refused while a build runs or another batch holds it, and a stale release frees nothing', async () => {
  const m = manualRun<string>();
  const loop = buildLoop({ run: m.run });
  loop.request();
  await tick();
  assert(loop.hold() === null, 'a running build must not be held under');
  m.calls[0]!.resolve('a');
  await tick();
  const first = loop.hold();
  assert(first, 'held once the build landed');
  assert(loop.hold() === null, 'a second batch must wait for the first');
  first!();
  const second = loop.hold();
  assert(second, 'the next batch may hold it once the first lets go');
  first!(); // the first batch's release, called again
  loop.request();
  await tick(10);
  assert(m.calls.length === 1, 'a stale release must not let a build start under the second batch');
  second!();
  await tick();
  assert(m.calls.length === 2, 'the second release lets it build');
  m.calls[1]!.resolve('b');
  assert((await within(loop.settled())) === 'b', 'and export gets it');
});

test('hold: dispose rejects an export waiting on a batch, and a release after it builds nothing', async () => {
  let runs = 0;
  const loop = buildLoop({ run: () => { runs++; return 1; } });
  loop.request();
  await loop.settled();
  const release = loop.hold()!;
  const waiting = loop.settled().then(() => 'resolved', () => 'rejected');
  loop.request();
  loop.dispose();
  assert((await waiting) === 'rejected', 'a disposed loop must not leave a caller hanging');
  release();
  await tick(10);
  assert(runs === 1, `nothing may build after dispose, ${runs - 1} did`);
});

/* -------------------------------------------------------------- worker transport */

/**
 * A worker in the same process: `answerRequests` installs itself on globalThis, as it would in
 * a real worker, and this fake carries messages both ways asynchronously.
 */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  constructor(private readonly scope: { onmessage: ((e: MessageEvent) => void) | null }) {}
  postMessage(data: unknown) {
    setTimeout(() => { if (!this.terminated) this.scope.onmessage?.({ data } as MessageEvent); }, 0);
  }
  terminate() { this.terminated = true; }
  crash(message: string) { this.onerror?.({ message, preventDefault() {} } as ErrorEvent); }
}

function fakeWorkerPair<Req, Res>(handle: (r: Req) => Promise<Res> | Res) {
  const g = globalThis as unknown as Record<string, unknown>;
  let current: FakeWorker | null = null;
  g.postMessage = (data: unknown) => setTimeout(() => { if (current && !current.terminated) current.onmessage?.({ data } as MessageEvent); }, 0);
  answerRequests<Req, Res>(handle);
  const scope = g as unknown as { onmessage: ((e: MessageEvent) => void) | null };
  const created: FakeWorker[] = [];
  const create = () => {
    current = new FakeWorker(scope);
    created.push(current);
    return current as unknown as Worker;
  };
  return { create, created, current: () => current! };
}

test('each reply goes to the request that asked for it, whatever order they finish in', async () => {
  const w = fakeWorkerPair<{ n: number; ms: number }, number>(async (r) => { await tick(r.ms); return r.n * 10; });
  const client = workerClient<{ n: number; ms: number }, number>(w.create);
  const [a, b] = await Promise.all([client.call({ n: 1, ms: 30 }), client.call({ n: 2, ms: 0 })]);
  assert(a === 10 && b === 20, `replies crossed: ${a}, ${b}`);
});

test('a throw in the worker fails that request with its message', async () => {
  const w = fakeWorkerPair<{ bad: boolean }, string>((r) => { if (r.bad) throw new Error('no glyphs'); return 'ok'; });
  const client = workerClient<{ bad: boolean }, string>(w.create);
  let msg = '';
  await client.call({ bad: true }).catch((e: Error) => { msg = e.message; });
  assert(msg === 'no glyphs', `expected the worker's message, got "${msg}"`);
  assert((await client.call({ bad: false })) === 'ok', 'the worker keeps answering after an error');
});

test('a crashed worker fails every pending call and is replaced on the next call', async () => {
  const w = fakeWorkerPair<{ wait: boolean }, string>(async (r) => { if (r.wait) await new Promise(() => {}); return 'fresh'; });
  let crashes = 0;
  const client = workerClient<{ wait: boolean }, string>(w.create, { onCrash: () => crashes++ });
  const hung = client.call({ wait: true }).then(() => 'resolved', () => 'rejected');
  await tick(5);
  w.current().crash('out of memory');
  assert((await hung) === 'rejected', 'a call pending on a dead worker must reject');
  assert(crashes === 1, 'onCrash fires once');
  assert((await client.call({ wait: false })) === 'fresh', 'the next call starts a new worker');
  assert(w.created.length === 2, `expected a replacement worker, made ${w.created.length}`);
});

test('the loop and the transport together: export after a worker crash refuses, then recovers', async () => {
  const w = fakeWorkerPair<{ size: number }, number>((r) => r.size);
  const client = workerClient<{ size: number }, number>(w.create);
  let size = 5;
  const loop = buildLoop({ run: () => client.call({ size }) });
  loop.request();
  assert((await loop.settled()) === 5, 'first build');
  size = 6;
  loop.request();
  loop.flush();
  w.current().crash('gone');
  let refused = false;
  await loop.settled().catch(() => { refused = true; });
  assert(refused, 'the build that died with the worker must not export the previous model');
  loop.request();
  assert((await loop.settled()) === 6, 'and the next request rebuilds on a fresh worker');
});

test('a build still waiting on a font when the generator closes starts no worker afterwards', async () => {
  // A build that loads its font before it calls the worker, closed while the font loads: the
  // call arrives after dispose(), and a worker started for it would never be stopped.
  const w = fakeWorkerPair<{ n: number }, number>((r) => r.n);
  const client = workerClient<{ n: number }, number>(w.create);
  let fontArrives!: () => void;
  const font = new Promise<void>((resolve) => { fontArrives = resolve; });
  const loop = buildLoop({ run: async () => { await font; return client.call({ n: 1 }); } });
  loop.request();
  await tick();
  loop.dispose(); // the generator closes while its font loads…
  client.dispose();
  fontArrives(); // …and then the font arrives
  await tick();
  const running = w.created.filter((x) => !x.terminated).length;
  assert(running === 0, `${w.created.length} worker(s) started after dispose, ${running} still running`);
  const late = await client.call({ n: 2 }).then(() => 'answered', (e: Error) => e.message);
  assert(late === 'This generator has been closed.', `a call after dispose must be refused, got "${late}"`);
  assert(w.created.length === 0, `no worker may be started after dispose, made ${w.created.length}`);
});

/* -------------------------------------------------------------- syncControls */

/** The two methods `syncControls` uses, behaving like a slider clamped to [lo, hi]. */
function fakeRow(lo: number, hi: number, initial: number): ValueRow<number> {
  let current = initial;
  return {
    setValue(v: number) { current = Math.min(hi, Math.max(lo, v)); },
    getValue: () => current,
    setDisabled() {},
  } as unknown as ValueRow<number>;
}

test('syncControls writes the clamped value back, so the model builds what the slider shows', () => {
  const state = { width: 400, height: 30, label: 'kept' };
  const changed = syncControls(state, { width: fakeRow(20, 120, 60), height: fakeRow(15, 120, 40) });
  assert(state.width === 120, `width should be clamped to 120, is ${state.width}`);
  assert(state.height === 30, 'an in-range value is left alone');
  assert(state.label === 'kept', 'a key with no control is left alone');
  assert(changed.length === 1 && changed[0] === 'width', `changed: ${changed.join(',')}`);
});

test('nothing above left a rejection unhandled', () => {
  assert(escaped.length === 0, `${escaped.length} unhandled: ${escaped.map((e) => (e as Error)?.message ?? String(e)).join(' | ')}`);
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
console.log(`\nbuild-loop: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

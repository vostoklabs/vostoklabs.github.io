/*
  The build loop every generator runs, written once.

  Each app grew its own: a debounce, a busy flag, a dirty flag and a "latest parts" variable.
  Between the copies, every way this can go wrong had shipped somewhere:

   - Download read whichever build finished last, not the one that matches the screen. A click
     a beat after a slider exported the previous model, and after a failed build it exported
     the build before that, with a success message.
   - A failed build dropped the edit queued behind it, so the preview stopped following the
     controls until something else changed.
   - A worker that never answered left "Building…" on screen until a reload.
   - A reply that landed after the user had moved on (a mode switch) replaced the new design.

  `buildLoop()` is the main-thread half: one build at a time, at most one more waiting behind
  it, always built from the settings as they are when it starts, and `settled()` for export.
  `workerClient()` / `answerRequests()` are the transport: every request carries an id, the
  reply to it is matched by that id, and a dead worker fails every pending request instead of
  leaving it hanging.

  Nothing here touches the DOM, so a worker can import this module on its own:
  `import { answerRequests } from '@vostok/ui-kit/build-loop'`.
*/
import { assertExportable, type Diagnostic } from './diagnostics';

/* ----------------------------------------------------------------- build loop */

export interface BuildLoopOptions<R> {
  /**
   * One build of the CURRENT settings. Read them inside this function, not when the change was
   * requested: a build always works from the newest settings, so a burst of changes costs one
   * build rather than one per change.
   */
  run: () => Promise<R> | R;
  /** Quiet time after the last `request()` before a build starts. Default 0. */
  debounceMs?: number;
  /** A build that has not finished after this long counts as failed. Default: no limit. */
  timeoutMs?: number;
  /** A build is starting. Show the busy state. */
  onStart?: () => void;
  /** A build finished and still matches what the user asked for. Show it. */
  onResult?: (result: R) => void;
  /** A build failed and still matches what the user asked for. Say so. */
  onError?: (error: Error) => void;
  /** Nothing is running or waiting any more. Clear the busy state. */
  onIdle?: () => void;
  /**
   * The diagnostics a result carries. With this, `settled()` refuses a result that has an
   * error-level one, with `ExportBlockedError` in that error's own words, so every export that
   * awaits it is guarded without remembering to be. The preview still gets the result.
   */
  diagnose?: (result: R) => readonly Diagnostic[];
}

export interface BuildLoop<R> {
  /** The settings changed. However often this is called, one build runs at a time and at most
   *  one more waits behind it. */
  request(): void;
  /** Start the pending build now instead of waiting out the debounce. */
  flush(): void;
  /**
   * The result that matches the settings as they are now. Waits for a pending or running
   * build, and rejects if that build failed, nothing has been built, or (with `diagnose`) the
   * result carries an error.
   *
   * Every export path awaits this. An exporter handed `latest` instead is the bug this module
   * exists to remove.
   */
  settled(): Promise<R>;
  /**
   * What is running is no longer wanted: the user switched mode or design. Its result is
   * dropped when it lands, and `latest` is cleared so nothing from before can be exported.
   * Call `request()` to build the new thing.
   */
  invalidate(): void;
  /** A build is running or waiting to run. */
  readonly busy: boolean;
  /** The last result that was still current when it landed. For the preview only. */
  readonly latest: R | null;
  /** Why the most recent build failed, or null if it did not. */
  readonly error: Error | null;
  /** Stop for good: cancel the debounce, drop what is in flight, reject anyone waiting. */
  dispose(): void;
}

/** Thrown into `settled()` when nothing current has been built. */
export class NothingBuiltError extends Error {
  constructor() {
    super('Nothing has been built yet.');
    this.name = 'NothingBuiltError';
  }
}

/** A build that ran past `timeoutMs`. */
export class BuildTimeoutError extends Error {
  constructor(ms: number) {
    super(`The build did not finish within ${Math.round(ms / 1000)} s.`);
    this.name = 'BuildTimeoutError';
  }
}

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/** What an export of this result is refused with, or null. A `diagnose` that throws refuses too,
 *  rather than escaping while `settled()` callers are being answered and leaving them waiting. */
function refusal<R>(result: R, diagnose: BuildLoopOptions<R>['diagnose']): Error | null {
  if (!diagnose) return null;
  try {
    assertExportable(diagnose(result));
    return null;
  } catch (e) {
    return asError(e);
  }
}

export function buildLoop<R>(opts: BuildLoopOptions<R>): BuildLoop<R> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  /** The settings changed since the last build started. */
  let dirty = false;
  /** Bumped by `invalidate()`. A build only counts if the generation it started in still holds. */
  let generation = 0;
  let latest: R | null = null;
  let error: Error | null = null;
  let disposed = false;
  let waiters: { resolve: (r: R) => void; reject: (e: Error) => void }[] = [];

  const outcome = (): { ok: true; value: R } | { ok: false; error: Error } => {
    if (error) return { ok: false, error };
    if (latest === null) return { ok: false, error: new NothingBuiltError() };
    const refused = refusal(latest, opts.diagnose);
    return refused ? { ok: false, error: refused } : { ok: true, value: latest };
  };

  const settleWaiters = () => {
    const list = waiters;
    waiters = [];
    const out = outcome();
    for (const w of list) {
      if (out.ok) w.resolve(out.value);
      else w.reject(out.error);
    }
  };

  const start = () => {
    clearTimeout(timer);
    timer = undefined;
    if (disposed || running) return; // a running build sees `dirty` when it lands and goes again
    dirty = false;
    running = true;
    const gen = generation;
    let finished = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const finish = (ok: boolean, value: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      running = false;
      if (disposed) return;
      if (gen === generation) {
        if (ok) {
          latest = value as R;
          error = null;
          opts.onResult?.(value as R);
        } else {
          error = asError(value);
          opts.onError?.(error);
        }
      }
      // A change arrived while this one ran: build it, success or failure. Dropping it on an
      // error is how an edit used to vanish.
      if (dirty) start();
      else {
        opts.onIdle?.();
        settleWaiters();
      }
    };

    if (opts.timeoutMs) {
      const ms = opts.timeoutMs;
      watchdog = setTimeout(() => finish(false, new BuildTimeoutError(ms)), ms);
    }
    opts.onStart?.();
    try {
      Promise.resolve(opts.run()).then(
        (r) => finish(true, r),
        (e) => finish(false, e),
      );
    } catch (e) {
      finish(false, e);
    }
  };

  return {
    request() {
      if (disposed) return;
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(start, opts.debounceMs ?? 0);
    },
    flush() {
      if (timer !== undefined) start();
    },
    settled() {
      if (disposed) return Promise.reject(new Error('This generator has been closed.'));
      // Someone is waiting on the result, so the debounce has nothing left to save.
      if (timer !== undefined) start();
      if (!running && !dirty) {
        const out = outcome();
        return out.ok ? Promise.resolve(out.value) : Promise.reject(out.error);
      }
      return new Promise<R>((resolve, reject) => waiters.push({ resolve, reject }));
    },
    invalidate() {
      generation += 1;
      latest = null;
      error = null;
    },
    get busy() {
      return running || dirty;
    },
    get latest() {
      return latest;
    },
    get error() {
      return error;
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      timer = undefined;
      const list = waiters;
      waiters = [];
      for (const w of list) w.reject(new Error('This generator has been closed.'));
    },
  };
}

/* ------------------------------------------------------------- worker transport */

/** What `workerClient` adds to a request, and what `answerRequests` echoes back. */
interface Envelope {
  __vlId: number;
}
type Reply = Envelope & ({ ok: true; value: unknown } | { ok: false; message: string });

/** A request on its way in, or a reply on its way back: both carry the id. */
const hasId = (data: unknown): data is Envelope =>
  typeof data === 'object' && data !== null && typeof (data as Envelope).__vlId === 'number';

export interface WorkerClientOptions {
  /** Messages the worker sends that are not replies: progress, "ready", log lines. */
  onEvent?: (data: unknown) => void;
  /** The worker died (a load failure, an uncaught error). Pending calls are already rejected;
   *  the next `call()` starts a fresh worker. */
  onCrash?: (error: Error) => void;
}

export interface WorkerClient<Req, Res> {
  /** Send one request. Resolves with the worker's answer to THIS request, rejects with its error. */
  call(request: Req, transfer?: Transferable[]): Promise<Res>;
  /** Stop the worker and fail every pending call. The next `call()` starts a fresh one. */
  restart(): void;
  /** Stop the worker for good. */
  dispose(): void;
}

/**
 * The main-thread side of a worker that answers requests by id.
 *
 * The worker must answer with `answerRequests()`. Messages it posts by any other means arrive at
 * `onEvent`. `create` is called lazily and again after a crash or `restart()`, so a worker that
 * died is replaced rather than left wedged.
 */
export function workerClient<Req, Res>(create: () => Worker, opts: WorkerClientOptions = {}): WorkerClient<Req, Res> {
  let worker: Worker | null = null;
  let nextId = 0;
  const pending = new Map<number, { resolve: (r: Res) => void; reject: (e: Error) => void }>();

  const failAll = (err: Error) => {
    const list = [...pending.values()];
    pending.clear();
    for (const p of list) p.reject(err);
  };

  const stop = () => {
    worker?.terminate();
    worker = null;
  };

  const crash = (err: Error) => {
    stop();
    failAll(err);
    opts.onCrash?.(err);
  };

  const ensure = (): Worker => {
    if (worker) return worker;
    const w = create();
    w.onmessage = (e: MessageEvent) => {
      const data = e.data as unknown;
      if (!hasId(data)) {
        opts.onEvent?.(data);
        return;
      }
      const reply = data as Reply;
      const p = pending.get(reply.__vlId);
      if (!p) return; // answered after a restart: nobody is waiting for it
      pending.delete(reply.__vlId);
      if (reply.ok) p.resolve(reply.value as Res);
      else p.reject(new Error(reply.message));
    };
    w.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      crash(new Error(e.message || 'The geometry engine stopped.'));
    };
    w.onmessageerror = () => crash(new Error('The geometry engine sent a message that could not be read.'));
    worker = w;
    return w;
  };

  return {
    call(request, transfer = []) {
      const id = ++nextId;
      return new Promise<Res>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          ensure().postMessage({ ...(request as object), __vlId: id }, transfer);
        } catch (err) {
          pending.delete(id);
          reject(asError(err));
        }
      });
    },
    restart() {
      stop();
      failAll(new Error('The geometry engine was restarted.'));
    },
    dispose() {
      stop();
      failAll(new Error('This generator has been closed.'));
    },
  };
}

/** The scope a module worker runs in, as much of it as this file needs. */
interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

export interface AnswerOptions<Res> {
  /** Buffers to transfer rather than copy, e.g. a mesh's typed arrays. */
  transfer?: (result: Res) => Transferable[];
  /** Messages without a request id (an old-style command, a cancel). */
  onOther?: (data: unknown) => void;
}

/**
 * The worker side: answer every request `workerClient` sends with exactly one reply carrying
 * its id, the result or the error. A throw inside `handle` becomes that request's error, so the
 * caller hears about it instead of waiting forever.
 *
 * Start-up work (loading WASM) belongs inside `handle`, awaited, not in a promise of its own
 * whose failure only reaches the console: then a load failure fails the request that needed it.
 */
export function answerRequests<Req, Res>(handle: (request: Req) => Promise<Res> | Res, opts: AnswerOptions<Res> = {}): void {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = async (e: MessageEvent) => {
    const data = e.data as unknown;
    if (!hasId(data)) {
      opts.onOther?.(data);
      return;
    }
    const { __vlId, ...request } = data as Envelope & Record<string, unknown>;
    try {
      const value = await handle(request as Req);
      scope.postMessage({ __vlId, ok: true, value }, opts.transfer?.(value) ?? []);
    } catch (err) {
      scope.postMessage({ __vlId, ok: false, message: asError(err).message });
    }
  };
}

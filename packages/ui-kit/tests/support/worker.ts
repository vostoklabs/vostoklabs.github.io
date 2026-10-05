/*
  A stand-in for `Worker`, scripted by the test.

  An app's geometry worker needs WASM and its own thread; what a mount test cares about is the
  traffic: which requests went out, in what order, and what happens when a reply comes back
  late, fails, or never comes. `FakeWorker.onPost` sees every message the app posts, and the test
  answers through `reply()`, or kills the worker with `crash()`, as and when its scenario says.
*/

export class FakeWorker {
  /** Every worker made, oldest first. */
  static instances: FakeWorker[] = [];
  /** Called for every message the app posts to any worker. */
  static onPost: (worker: FakeWorker, data: any, transfer?: Transferable[]) => void = () => {};
  /** Called once a new worker has started, a tick after it was made, as a real one would be. */
  static onStart: (worker: FakeWorker) => void = () => {};

  static reset() {
    FakeWorker.instances = [];
    FakeWorker.onPost = () => {};
    FakeWorker.onStart = () => {};
  }

  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string; preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  /** Every message the app posted to this worker. */
  readonly posted: any[] = [];

  constructor(readonly url?: unknown, readonly options?: unknown) {
    FakeWorker.instances.push(this);
    setTimeout(() => {
      if (!this.terminated) FakeWorker.onStart(this);
    }, 0);
  }

  postMessage(data: unknown, transfer?: Transferable[]) {
    if (this.terminated) return;
    this.posted.push(data);
    FakeWorker.onPost(this, data, transfer);
  }
  terminate() {
    this.terminated = true;
  }
  /** The worker answers. Nothing arrives once it has been terminated. */
  reply(data: unknown) {
    if (!this.terminated) this.onmessage?.({ data });
  }
  /** The worker dies, as an uncaught error inside it would kill it. */
  crash(message = 'The worker stopped.') {
    if (!this.terminated) this.onerror?.({ message, preventDefault() {} });
  }
}

/** Make `new Worker(…)` build one of these. */
export function installWorker() {
  (globalThis as Record<string, unknown>).Worker = FakeWorker;
}

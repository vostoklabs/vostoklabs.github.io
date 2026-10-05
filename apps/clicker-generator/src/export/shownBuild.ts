/*
  What Export exports: the build the preview shows, once it has landed.

  Export used to hand the writer whatever parts had arrived last. A click a beat after a slider
  exported the model from before the slider moved; after a build that failed it exported the
  one before, with a success message; and the browser download sent the design even with the
  fit test's tiles on screen. This follows every request to the geometry worker and every reply,
  and `settled()` answers once nothing that changes the preview is still on its way: the tiles
  while the fit test shows, the design otherwise. It refuses, in the status line's words, when
  the newest of those builds failed.

  The kit's `buildLoop` does this for a generator whose builds all go through one `run()`. The
  clicker's do not: three debounced paths build the design, Model mode posts its own builds, and
  the prebuilt sample goes on screen without one. So this watches the worker's traffic instead.

  It relies on one property of the worker (workers/geometry.worker.ts): it answers messages in
  the order they arrive, each with exactly one reply. A design build carries no request id, so
  that order is how its reply is found. Everything else that builds (the fit test's strip, a
  result card's picture) carries one, and failures name the request they belong to.

  No DOM here, so tests/shown-build.test.ts drives it with the worker's own messages.
*/
import type { ClickerPart, GeometryRequest, GeometryResponse } from '../types';

/** The requests that build the design on screen, when they carry no request id. */
const DESIGN: ReadonlySet<GeometryRequest['type']> = new Set(['buildClicker', 'buildBlocks', 'buildModel']);

/** What the status line says when the worker fails a request (mount.ts writes the same words). */
const errorStatus = (message: string): string => 'Error: ' + message.split('\n')[0];

export interface ShownBuildSources {
  /** The fit test's tiles are what the preview shows, rather than the design. */
  fitTest(): boolean;
  /** The parts on screen, read only once their builds have landed. */
  design(): ClickerPart[];
  tiles(): ClickerPart[];
  /** Work that has not reached the worker yet and will end in a build: a debounce still counting
   *  down, a font or a model still loading. Export waits it out. */
  designPending(): boolean;
  tilesPending(): boolean;
}

/** The parts to export, and whether they are the fit test's tiles. */
export interface Shown {
  parts: ClickerPart[];
  fitTest: boolean;
}

export interface ShownBuild {
  /** A request went to the worker. */
  sent(msg: GeometryRequest): void;
  /** The worker answered. */
  answered(msg: GeometryResponse): void;
  /** The worker stopped (`worker.onerror`): what it was building may never come back. `status` is
   *  what the status line says about it. Lifted by the worker's next answer. */
  crashed(status: string): void;
  /** A change to the design failed before it reached the worker: its trace threw, or found
   *  nothing to build. `status` is what the status line says about it. */
  failed(status: string): void;
  /** Parts went on screen without a build, as the prebuilt sample does. */
  shown(): void;
  /** Something a `…Pending()` source reads may have changed. */
  poke(): void;
  /** Design builds sent and not answered yet. */
  readonly designsInFlight: number;
  /**
   * The parts on screen once the build that matches the settings has landed, or null when
   * nothing has been built. Rejects, with the status line's words, when that build failed.
   */
  settled(): Promise<Shown | null>;
}

export function shownBuild(src: ShownBuildSources): ShownBuild {
  /** Design builds in flight, oldest first, each by the turn it was asked for in. */
  const designs: number[] = [];
  let turn = 0;
  /** The turn the design's outcome comes from. An older build that lands late still repaints
   *  the preview, but cannot overrule a newer outcome. */
  let outcomeTurn = 0;
  let designFailure: string | null = null;
  /** The newest fit test strip asked for and not answered, and how the newest answer went. */
  let tilesAwaited: string | null = null;
  let tilesFailure: string | null = null;
  /** Why the worker stopped, until it answers again. */
  let crash: string | null = null;
  let waiters: { resolve: (shown: Shown | null) => void; reject: (err: Error) => void }[] = [];
  let checkQueued = false;

  const recordDesign = (at: number, failure: string | null) => {
    if (at < outcomeTurn) return;
    outcomeTurn = at;
    designFailure = failure;
  };

  const check = () => {
    checkQueued = false;
    if (!waiters.length) return;
    const fitTest = src.fitTest();
    const busy = fitTest
      ? tilesAwaited !== null || src.tilesPending()
      : designs.length > 0 || src.designPending();
    // A stopped worker answers nothing, so what it still owes is refused rather than awaited.
    if (busy && !crash) return;
    const failure = busy ? crash : fitTest ? tilesFailure : designFailure;
    const parts = fitTest ? src.tiles() : src.design();
    const waiting = waiters;
    waiters = [];
    for (const w of waiting) {
      if (failure) w.reject(new Error(failure));
      else w.resolve(parts.length ? { parts, fitTest } : null);
    }
  };

  /* Looked at once the current task is done, never on the spot: a reply's handler puts its parts
     on screen after telling this, and often sends the next build too; a debounce's runs a trace
     and then sends one. */
  const poke = () => {
    if (checkQueued) return;
    checkQueued = true;
    queueMicrotask(check);
  };

  return {
    sent(msg) {
      if (msg.type === 'buildFitStrip') tilesAwaited = msg.requestId ?? null;
      else if (DESIGN.has(msg.type) && !('requestId' in msg && msg.requestId)) designs.push(++turn);
    },
    answered(msg) {
      crash = null;
      if (msg.type === 'parts' || msg.type === 'error') {
        const failure = msg.type === 'error' ? errorStatus(msg.message) : null;
        if (msg.requestId) {
          // Only the newest strip counts: an older one was replaced before it landed.
          if (msg.requestId === tilesAwaited) {
            tilesAwaited = null;
            tilesFailure = failure;
          }
        } else if (msg.type === 'parts' || (msg.request !== undefined && DESIGN.has(msg.request))) {
          const at = designs.shift();
          if (at !== undefined) recordDesign(at, failure);
        }
      }
      poke();
    },
    crashed(status) {
      crash = status;
      poke();
    },
    failed(status) {
      recordDesign(++turn, status);
      poke();
    },
    shown() {
      recordDesign(++turn, null);
      poke();
    },
    poke,
    get designsInFlight() {
      return crash ? 0 : designs.length;
    },
    settled() {
      return new Promise<Shown | null>((resolve, reject) => {
        waiters.push({ resolve, reject });
        poke();
      });
    },
  };
}

/*
  Time a test moves by hand.

  An app's mount runs on timers: a 130 ms debounce in front of every rebuild, a worker that takes
  its time to answer, a font that loads late. Waiting for them in real time makes a suite slow and
  its timing a matter of luck. With this installed, `setTimeout` and its kin only fire when the
  test calls `advance()`, in the order they are due, with every promise that can settle settled
  in between, so a scenario reads as a timeline and runs in no time at all:

      clock.advance(130)   // the debounce runs out, and the build goes to the worker

  Promises, `queueMicrotask` and node's own I/O stay real. A timer callback that throws is what a
  browser would report as an uncaught error: it is kept in `errors` for the test to check, and
  the clock carries on, as the page would.
*/

export interface Clock {
  /** Virtual milliseconds since the clock was installed. */
  readonly now: number;
  /** Run every timer due in the next `ms`, in order, letting promises settle after each one. */
  advance(ms: number): Promise<void>;
  /** Let every promise that can settle now settle, without moving time. */
  settle(): Promise<void>;
  /** What timer callbacks threw, oldest first. */
  readonly errors: unknown[];
}

export function installClock(): Clock {
  const g = globalThis as Record<string, unknown>;
  const immediate = globalThis.setImmediate;
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void; every: number | null }>();
  const errors: unknown[] = [];

  const add = (fn: (...a: unknown[]) => void, ms: unknown, args: unknown[], repeat: boolean) => {
    const id = nextId++;
    const delay = Math.max(0, Number(ms) || 0);
    timers.set(id, { at: now + delay, run: () => fn(...args), every: repeat ? Math.max(1, delay) : null });
    return id;
  };
  const clear = (id: unknown) => void timers.delete(id as number);
  g.setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => add(fn, ms, args, false);
  g.setInterval = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => add(fn, ms, args, true);
  g.clearTimeout = clear;
  g.clearInterval = clear;

  /** A few turns of node's own loop: microtasks, and I/O node finishes on its own (a Blob read). */
  const settle = async () => {
    for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => immediate(resolve));
  };

  return {
    get now() {
      return now;
    },
    errors,
    settle,
    async advance(ms: number) {
      const end = now + ms;
      await settle();
      for (;;) {
        let dueId = 0;
        let due: { at: number; run: () => void; every: number | null } | undefined;
        for (const [id, t] of timers) if (t.at <= end && (!due || t.at < due.at)) [dueId, due] = [id, t];
        if (!due) break;
        now = due.at;
        if (due.every === null) timers.delete(dueId);
        else due.at += due.every;
        try {
          due.run();
        } catch (e) {
          errors.push(e);
        }
        await settle();
      }
      now = end;
    },
  };
}

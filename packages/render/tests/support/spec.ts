/*
  The little of a test framework these tests use: describe, it and expect, run in node with
  nothing installed.

  `it` runs its test at once (an async one is awaited in turn), and when the process is about to
  exit the file prints its failures and one summary line, which tests/run.mjs reads:

    #checks <file> pass=<n> fail=<n> asserts=<n>

  The matchers are the ones the tests call, with the meanings the usual frameworks give them:
  `toEqual` is deep equality that ignores keys whose value is undefined; `toBeCloseTo(x, d)`
  passes when the difference is below 10^-d / 2.
*/

const names: string[] = [];
const failures: { name: string; error: unknown }[] = [];
let passed = 0;
let asserts = 0;
let chain: Promise<void> = Promise.resolve();
const file = (process.argv[1] ?? 'tests').split(/[\\/]/).pop()?.replace(/\.test\.m?js$/, '') ?? 'tests';

export function describe(name: string, body: () => void): void {
  names.push(name);
  try {
    body();
  } finally {
    names.pop();
  }
}

export function it(name: string, test: () => void | Promise<void>): void {
  const full = [...names, name].join(' > ');
  const record = (error: unknown) => {
    if (error === undefined) passed++;
    else failures.push({ name: full, error });
  };
  chain = chain.then(async () => {
    try {
      await test();
      record(undefined);
    } catch (error) {
      record(error ?? new Error('threw undefined'));
    }
  });
}

class Failure extends Error {}

function show(value: unknown): string {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return `${value.constructor.name}[${Array.from(value as unknown as ArrayLike<number>).join(', ')}]`;
  }
  if (value instanceof Map) return `Map(${JSON.stringify([...value.entries()])})`;
  if (value instanceof Set) return `Set(${JSON.stringify([...value])})`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || value === undefined || value === null || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor) return false;
    const x = a as unknown as ArrayLike<unknown>;
    const y = b as unknown as ArrayLike<unknown>;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return false;
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !deepEqual(v, b.get(k))) return false;
    return true;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined).sort();
  const ka = keys(ra);
  const kb = keys(rb);
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => deepEqual(ra[k], rb[k]));
}

export interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toHaveLength(length: number): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeTruthy(): void;
  toBeGreaterThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  toBeLessThan(n: number): void;
  toBeLessThanOrEqual(n: number): void;
  toBeCloseTo(n: number, digits?: number): void;
  toMatch(pattern: RegExp | string): void;
  toContain(item: unknown): void;
  toThrow(pattern?: RegExp | string): void;
}

function matchers(actual: unknown, negate: boolean): Matchers {
  const check = (ok: boolean, says: string) => {
    asserts++;
    if (ok === negate) throw new Failure(`expected ${show(actual)} ${negate ? 'not ' : ''}${says}`);
  };
  const num = () => actual as number;
  return {
    toBe: (expected) => check(Object.is(actual, expected), `to be ${show(expected)}`),
    toEqual: (expected) => check(deepEqual(actual, expected), `to equal ${show(expected)}`),
    toHaveLength: (length) => check((actual as { length?: number } | null)?.length === length, `to have length ${length}`),
    toBeNull: () => check(actual === null, 'to be null'),
    toBeUndefined: () => check(actual === undefined, 'to be undefined'),
    toBeTruthy: () => check(!!actual, 'to be truthy'),
    toBeGreaterThan: (n) => check(num() > n, `to be greater than ${n}`),
    toBeGreaterThanOrEqual: (n) => check(num() >= n, `to be at least ${n}`),
    toBeLessThan: (n) => check(num() < n, `to be less than ${n}`),
    toBeLessThanOrEqual: (n) => check(num() <= n, `to be at most ${n}`),
    toBeCloseTo: (n, digits = 2) => check(Math.abs(num() - n) < 10 ** -digits / 2, `to be close to ${n} (${digits} digits)`),
    toMatch: (pattern) => check(
      typeof actual === 'string' && (typeof pattern === 'string' ? actual.includes(pattern) : pattern.test(actual)),
      `to match ${String(pattern)}`,
    ),
    toContain: (item) => check(
      (Array.isArray(actual) || typeof actual === 'string') && (actual as unknown[] | string).includes(item as never),
      `to contain ${show(item)}`,
    ),
    toThrow: (pattern) => {
      let thrown: unknown = null;
      let threw = false;
      try {
        (actual as () => unknown)();
      } catch (e) {
        threw = true;
        thrown = e;
      }
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      const fits = !pattern || (typeof pattern === 'string' ? message.includes(pattern) : pattern.test(message));
      asserts++;
      if ((threw && fits) === negate) {
        throw new Failure(`expected the call ${negate ? 'not ' : ''}to throw${pattern ? ` ${String(pattern)}` : ''}; ${threw ? `it threw "${message}"` : 'it returned'}`);
      }
    },
  };
}

export function expect(actual: unknown): Matchers & { not: Matchers } {
  return Object.assign(matchers(actual, false), { not: matchers(actual, true) });
}

process.on('beforeExit', () => {
  void chain.then(() => {
    if ((globalThis as { __specReported?: boolean }).__specReported) return;
    (globalThis as { __specReported?: boolean }).__specReported = true;
    for (const f of failures) {
      const why = f.error instanceof Error ? (f.error instanceof Failure ? f.error.message : f.error.stack ?? f.error.message) : String(f.error);
      console.log(`FAIL ${f.name}\n     ${why}`);
    }
    console.log(`${file}: ${passed} passed${failures.length ? `, ${failures.length} FAILED` : ''} (${asserts} assertions)`);
    console.log(`#checks ${file} pass=${passed} fail=${failures.length} asserts=${asserts}`);
    if (failures.length) process.exitCode = 1;
  });
});

/**
 * Where this generator's bundled assets live.
 *
 * On the web the answer is `import.meta.env.BASE_URL` and always was. Inside a desktop host
 * it is not: Opal serves this generator's assets from `/generators/clicker/` while the page
 * itself sits at `/generate/clicker`, and `BASE_URL` there is Opal's base, not this
 * generator's. Every switch body, block shell and keycap definition would 404.
 *
 * One settable base, defaulting to `BASE_URL`, keeps the web behaviour byte-identical and
 * gives `mount()` a single place to say otherwise. The host is the one that knows the answer
 * (`host.assetBase()`), so it is the one that sets it.
 */

let base: string = import.meta.env.BASE_URL;

/** Called once by `mount()`, before anything resolves an asset. */
export function setAssetBase(next?: string): void {
  if (!next) {
    base = import.meta.env.BASE_URL;
    return;
  }
  base = next.endsWith('/') ? next : `${next}/`;
}

/** The current base, for code that concatenates rather than calls. */
export function assetBase(): string {
  return base;
}

/** Resolves a bundled asset path. Absolute URLs and data: URIs pass through untouched. */
export function assetUrl(path: string): string {
  if (!path) return path;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return base + path;
}

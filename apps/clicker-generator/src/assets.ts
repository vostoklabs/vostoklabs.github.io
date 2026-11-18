/**
 * Where this generator's bundled assets live.
 *
 * On the web the answer is `import.meta.env.BASE_URL` and always was. Inside a desktop host
 * it is not: the asset base differs from the page URL, and `BASE_URL` there is the host's
 * base, not this generator's. Every switch body, block shell and keycap definition would 404.
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

/** A bundled picture's file (a sample, a pack design) as this build ships it. The MakerLab build
 *  carries each PNG as a lossless WebP of the same pixels (`picturesAsWebp` in vite.config.ts);
 *  every other build, and the tests, the PNG itself. */
export function shippedPicture(file: string): string {
  const webp = typeof __PICTURES_WEBP__ !== 'undefined' && __PICTURES_WEBP__;
  return webp ? file.replace(/\.png$/i, '.webp') : file;
}

/**
 * Where this generator's bundled assets live.
 *
 * On the web that is "next to the page": the app is served from its own root, `base: './'`
 * in vite.config.js keeps every URL relative, and `fetch('keycaps/index.json')` just works.
 * Inside a desktop host it does not. Opal serves the generator's assets from
 * `/generators/keycap/` while the page itself sits at `/generate/keycap`, so the same
 * relative fetch resolves to `/generate/keycaps/index.json` and 404s — silently, because
 * every one of these fetches has a `.catch()` that falls back to a default.
 *
 * One settable base, defaulting to the empty string, keeps the web behaviour byte-identical
 * and gives `mount()` a single place to say otherwise. The host is the one that knows the
 * answer (`host.assetBase()`), so it is the one that sets it.
 */

let base = '';

/** Called once by `mount()`, before anything fetches. A trailing slash is added if missing. */
export function setAssetBase(next) {
  if (!next) { base = ''; return; }
  base = next.endsWith('/') ? next : `${next}/`;
}

/** Resolves a bundled asset path. Absolute URLs and data: URIs pass through untouched. */
export function assetUrl(path) {
  if (!path) return path;
  if (/^(https?:|data:|blob:|\/)/i.test(path)) return path;
  return base + path;
}

/**
 * Where this generator is running: a browser tab, or inside a desktop app.
 *
 * The generators are sold two ways — free on the web, and bundled into Opal Suite — and
 * the difference is almost entirely chrome. On the web a generator needs its support
 * links, its GitHub button, its "download the offline version" call to action and its
 * commercial-licence nudge. Inside Opal every one of those is either wrong (it *is* the
 * offline version) or already handled by the app around it (the licence is the tier the
 * user bought).
 *
 * One flag, read by the chrome components themselves, is the difference between the host
 * app deleting forty call sites across four generators — and having them silently
 * reappear the next time anyone syncs — and it just working. `web` is the default, so
 * nothing about the browser builds changes.
 *
 * ## Why `globalThis` and not a module variable
 *
 * The host app vendors this package rather than importing it from node_modules, so the
 * host's copy of this module and the generator's copy are two different module instances.
 * A module-level `let` would be set on one and read from the other. The flag has to live
 * somewhere both can see, and for a single string that is the global object.
 */

export type HostEnv = 'web' | 'desktop';

const KEY = '__VOSTOK_HOST_ENV__';

interface HostGlobal {
  [KEY]?: HostEnv;
}

/** Call once, before any generator mounts. */
export function setHostEnv(env: HostEnv): void {
  (globalThis as HostGlobal)[KEY] = env;
}

export function getHostEnv(): HostEnv {
  return (globalThis as HostGlobal)[KEY] ?? 'web';
}

export function isDesktop(): boolean {
  return getHostEnv() === 'desktop';
}

/**
 * A node that renders nothing.
 *
 * Every chrome component returns `HTMLElement`, and loosening those signatures to
 * `HTMLElement | null` would push a null check into every call site — which is the forty
 * edits this flag exists to avoid. An empty, hidden, zero-size span appended to a panel
 * is invisible and costs nothing.
 */
export function renderNothing(): HTMLElement {
  const el = document.createElement('span');
  el.hidden = true;
  el.dataset.vlOmitted = 'desktop';
  el.style.display = 'none';
  return el;
}

/** The no-op form of the components that return a handle instead of an element. */
export function noopHandle(): { close(): void } {
  return { close() { /* nothing was opened */ } };
}

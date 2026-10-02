/**
 * Where this generator is running: a browser tab, or inside an embedding host.
 *
 * A generator runs in a browser tab or inside a host, and the difference is almost entirely
 * chrome. On the web a generator needs its support links, its GitHub button, its offline
 * build call to action and its commercial-licence nudge. Inside a host those are web-only
 * chrome, and the host decides what it shows around the generator.
 *
 * One flag, read by the chrome components themselves, means no call site has to be removed
 * by hand. `web` is the default, so nothing about the browser builds changes.
 *
 * ## Why `globalThis` and not a module variable
 *
 * A host may carry its own copy of this package, so the host's copy of this module and the
 * generator's copy can be two different module instances. A module-level `let` would be set
 * on one and read from the other. The flag has to live somewhere both can see, and for a
 * single string that is the global object.
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

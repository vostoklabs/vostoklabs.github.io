/*
  A stand-in document and window, enough for an app's real `mount()` to run under node.

  Part of the support every mount test shares (see mounted.mjs in this folder). An element
  remembers what was done to it (listeners, classes, attributes, children) so a test can fire an
  event on it or read it back, and `querySelector` always finds something: an app that looks up
  a node from its own template gets one element per selector, the same one each time. Methods a
  test has no use for do nothing. This is not a browser: layout, CSS and real rendering are out of
  reach, which is why an app's viewer and its heavier panels are replaced by stand-ins instead.
*/

export class FakeElement {
  tagName: string;
  children: unknown[] = [];
  parent: FakeElement | null = null;
  readonly listeners = new Map<string, ((ev: unknown) => void)[]>();
  readonly attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  value = '';
  checked = false;
  hidden = false;
  disabled = false;
  textContent = '';
  innerHTML = '';
  id = '';
  width = 0;
  height = 0;
  private classes = new Set<string>();
  private found = new Map<string, FakeElement>();

  readonly classList = {
    add: (...names: string[]) => names.forEach((n) => this.classes.add(n)),
    remove: (...names: string[]) => names.forEach((n) => this.classes.delete(n)),
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name);
      else this.classes.delete(name);
      return on;
    },
    contains: (name: string) => this.classes.has(name),
  };

  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
  }

  get className() {
    return [...this.classes].join(' ');
  }
  set className(v: string) {
    this.classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }

  append(...nodes: unknown[]) {
    for (const n of nodes) {
      this.children.push(n);
      if (n instanceof FakeElement) n.parent = this;
    }
  }
  appendChild<T>(node: T) {
    this.append(node);
    return node;
  }
  prepend(...nodes: unknown[]) {
    this.children.unshift(...nodes);
  }
  insertBefore<T>(node: T) {
    this.append(node);
    return node;
  }
  replaceChildren(...nodes: unknown[]) {
    this.children = [];
    this.append(...nodes);
  }
  replaceWith() {}
  remove() {}
  contains() {
    return false;
  }
  closest() {
    return null;
  }

  addEventListener(type: string, fn: (ev: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: (ev: unknown) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  dispatchEvent(ev: { type: string }) {
    for (const fn of this.listeners.get(ev.type) ?? []) fn.call(this, ev);
    return true;
  }
  /** Fire `type` at this element, as a user would. */
  fire(type: string, extra: Record<string, unknown> = {}) {
    return this.dispatchEvent({ type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...extra });
  }

  setAttribute(k: string, v: string) {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }
  removeAttribute(k: string) {
    delete this.attrs[k];
  }
  hasAttribute(k: string) {
    return k in this.attrs;
  }
  toggleAttribute(k: string, force?: boolean) {
    const on = force ?? !(k in this.attrs);
    if (on) this.attrs[k] = '';
    else delete this.attrs[k];
    return on;
  }

  /** Always an element, and the same one for the same selector. */
  querySelector(selector: string): FakeElement {
    let found = this.found.get(selector);
    if (!found) {
      found = new FakeElement(/^[a-z]/i.test(selector) ? selector.split(/[.#[\s:]/)[0] : 'div');
      found.parent = this;
      this.found.set(selector, found);
    }
    return found;
  }
  querySelectorAll(): FakeElement[] {
    return [];
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100 };
  }
  focus() {}
  blur() {}
  click() {
    this.fire('click');
  }

  // A canvas, as far as an app reads one back without drawing.
  getContext() {
    return { drawImage() {}, putImageData() {}, getImageData: () => ({ data: new Uint8ClampedArray(64) }) };
  }
  toDataURL() {
    return 'data:image/png;base64,';
  }
  toBlob(done: (blob: Blob | null) => void) {
    done(null);
  }
}

/** A picture that loads on the next tick of whatever clock is installed. */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  naturalWidth = 4;
  naturalHeight = 4;
  set src(_url: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}

/**
 * Put the stand-in document and window on `globalThis`, with the browser globals an app touches
 * while it mounts. Timers on `window` call whatever `setTimeout` is current, so a test clock
 * installed after this governs them too.
 */
export function installDom() {
  const g = globalThis as Record<string, unknown>;
  const doc = new FakeElement('#document') as FakeElement & Record<string, unknown>;
  const html = new FakeElement('html');
  html.setAttribute('data-theme', 'dark');
  Object.assign(doc, {
    documentElement: html,
    head: new FakeElement('head'),
    body: new FakeElement('body'),
    activeElement: null,
    createElement: (tag: string) => new FakeElement(tag),
    createTextNode: (text: string) => ({ text }),
    getElementById: () => null,
  });

  const store = new Map<string, string>();
  const win = new FakeElement('#window') as FakeElement & Record<string, unknown>;
  Object.assign(win, {
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
    setInterval: (fn: () => void, ms?: number) => setInterval(fn, ms),
    clearInterval: (id: unknown) => clearInterval(id as ReturnType<typeof setInterval>),
    requestAnimationFrame: (fn: (t: number) => void) => setTimeout(() => fn(0), 16),
    cancelAnimationFrame: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    confirm: () => true,
    location: { href: 'http://localhost/', pathname: '/', hash: '', search: '' },
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
  });

  Object.assign(g, {
    document: doc,
    window: win,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
    HTMLElement: FakeElement,
    HTMLInputElement: FakeElement,
    HTMLTextAreaElement: FakeElement,
    HTMLCanvasElement: FakeElement,
    Image: FakeImage,
    Event: class {
      constructor(readonly type: string) {}
    },
    KeyboardEvent: class {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  return { document: doc, window: win };
}

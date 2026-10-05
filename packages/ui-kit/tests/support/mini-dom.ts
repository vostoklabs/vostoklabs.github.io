/*
  A small document for the kit's DOM tests: elements with real children, attributes, classes,
  `hidden` and text, a few selectors, events that bubble, and a serializer to compare what two
  calls built.

  Not a browser. There is no layout (every box measures zero, so a component that measures
  itself stands down the way it does in a detached node), no CSS, and no HTML parser beyond what
  `svgEl()` asks of a <template>: the markup is kept as written and serialized back as it came.

  `installMiniDom()` puts `document`, `window`, `HTMLElement`, `localStorage` and
  `getComputedStyle` on the global object; `html(node)` is the serializer.
*/

type Listener = (ev: MiniEvent) => void;

export interface MiniEvent {
  type: string;
  target: MiniNode | null;
  currentTarget: MiniNode | null;
  defaultPrevented: boolean;
  key?: string;
  preventDefault(): void;
  stopPropagation(): void;
  [extra: string]: unknown;
}

export class MiniNode {
  parentNode: MiniElement | null = null;
  readonly listeners = new Map<string, Listener[]>();

  get parentElement(): MiniElement | null {
    return this.parentNode;
  }
  get isConnected(): boolean {
    let n: MiniNode | null = this;
    while (n) {
      if (n === miniDocument.documentElement) return true;
      n = n.parentNode;
    }
    return false;
  }
  get textContent(): string {
    return '';
  }
  set textContent(_v: string) {}

  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  /** Runs this node's listeners, then its ancestors', until one stops it. */
  dispatchEvent(ev: Partial<MiniEvent> & { type: string }): boolean {
    let stopped = false;
    const event = ev as MiniEvent;
    event.target ??= this;
    event.defaultPrevented ??= false;
    event.preventDefault ??= () => {
      event.defaultPrevented = true;
    };
    event.stopPropagation = () => {
      stopped = true;
    };
    for (let n: MiniNode | null = this; n && !stopped; n = n.parentNode) {
      event.currentTarget = n;
      for (const fn of n.listeners.get(event.type) ?? []) fn.call(n, event);
    }
    return !event.defaultPrevented;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
}

export class MiniText extends MiniNode {
  constructor(public data: string) {
    super();
  }
  override get textContent() {
    return this.data;
  }
  override set textContent(v: string) {
    this.data = String(v);
  }
}

/** Markup kept as written: what `<template>.innerHTML = …` holds, an SVG icon. */
export class MiniRaw extends MiniNode {
  constructor(public markup: string) {
    super();
  }
  readonly classList = tokenList(() => '', () => {});
  setAttribute() {}
}

class MiniStyle {
  private props = new Map<string, string>();
  private raw = '';
  setProperty(name: string, value: string) {
    this.props.set(name, String(value));
  }
  getPropertyValue(name: string) {
    return this.props.get(name) ?? '';
  }
  removeProperty(name: string) {
    this.props.delete(name);
  }
  get cssText(): string {
    const set = [...this.props].filter(([, v]) => v !== '').map(([k, v]) => `${k}: ${v};`);
    return [this.raw, ...set].filter(Boolean).join(' ');
  }
  set cssText(v: string) {
    this.raw = String(v);
    this.props.clear();
  }
}

/** A `style` object: `cssText`, `setProperty`, and any camelCase property written straight on. */
function styleObject(): MiniStyle & Record<string, string> {
  const target = new MiniStyle();
  return new Proxy(target, {
    get(t, key) {
      if (typeof key === 'symbol' || key in t) return Reflect.get(t, key, t);
      return t.getPropertyValue(kebab(key));
    },
    set(t, key, value) {
      if (typeof key === 'symbol' || key in t) return Reflect.set(t, key, value, t);
      t.setProperty(kebab(key), value);
      return true;
    },
  }) as MiniStyle & Record<string, string>;
}
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function tokenList(read: () => string, write: (v: string) => void) {
  const list = () => read().split(/\s+/).filter(Boolean);
  return {
    add: (...names: string[]) => write([...new Set([...list(), ...names])].join(' ')),
    remove: (...names: string[]) => write(list().filter((n) => !names.includes(n)).join(' ')),
    toggle(name: string, force?: boolean) {
      const on = force ?? !list().includes(name);
      if (on) this.add(name);
      else this.remove(name);
      return on;
    },
    contains: (name: string) => list().includes(name),
    get value() {
      return read();
    },
  };
}

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link']);

export class MiniElement extends MiniNode {
  readonly tagName: string;
  readonly localName: string;
  childNodes: MiniNode[] = [];
  private readonly attrs = new Map<string, string>();
  readonly style = styleObject();
  readonly classList = tokenList(
    () => this.getAttribute('class') ?? '',
    (v) => this.setAttribute('class', v),
  );
  readonly dataset: Record<string, string>;
  /** Form state: a property, as in the DOM, not an attribute. */
  value = '';
  checked = false;
  files: unknown = null;
  /** `<template>` only. */
  content: { firstElementChild: MiniNode | null } | undefined;

  constructor(tag: string, readonly namespaceURI: string | null = null) {
    super();
    this.localName = tag.toLowerCase();
    this.tagName = namespaceURI ? tag : tag.toUpperCase();
    if (this.localName === 'template') this.content = { firstElementChild: null };
    const self = this;
    this.dataset = new Proxy({} as Record<string, string>, {
      get: (_t, key) => (typeof key === 'string' ? self.getAttribute(`data-${kebab(key)}`) ?? undefined : undefined),
      set: (_t, key, value) => {
        if (typeof key === 'string') self.setAttribute(`data-${kebab(key)}`, String(value));
        return true;
      },
      deleteProperty: (_t, key) => {
        if (typeof key === 'string') self.removeAttribute(`data-${kebab(key)}`);
        return true;
      },
    });
  }

  // ------------------------------------------------------------------ attributes --
  setAttribute(k: string, v: string) {
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string): string | null {
    return this.attrs.has(k) ? this.attrs.get(k)! : null;
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  toggleAttribute(k: string, force?: boolean) {
    const on = force ?? !this.attrs.has(k);
    if (on) {
      if (!this.attrs.has(k)) this.attrs.set(k, '');
    } else this.attrs.delete(k);
    return on;
  }
  get attributeNames(): string[] {
    return [...this.attrs.keys()];
  }

  get className() {
    return this.getAttribute('class') ?? '';
  }
  set className(v: string) {
    this.setAttribute('class', v);
  }
  get id() {
    return this.getAttribute('id') ?? '';
  }
  set id(v: string) {
    this.setAttribute('id', v);
  }
  get hidden() {
    return this.hasAttribute('hidden');
  }
  set hidden(v: boolean) {
    this.toggleAttribute('hidden', !!v);
  }
  get disabled() {
    return this.hasAttribute('disabled');
  }
  set disabled(v: boolean) {
    this.toggleAttribute('disabled', !!v);
  }
  get title() {
    return this.getAttribute('title') ?? '';
  }
  set title(v: string) {
    this.setAttribute('title', v);
  }
  get type() {
    return this.getAttribute('type') ?? '';
  }
  set type(v: string) {
    this.setAttribute('type', v);
  }
  get tabIndex() {
    const t = this.getAttribute('tabindex');
    return t === null ? -1 : Number(t);
  }
  set tabIndex(v: number) {
    this.setAttribute('tabindex', String(v));
  }
  get src() {
    return this.getAttribute('src') ?? '';
  }
  set src(v: string) {
    this.setAttribute('src', v);
  }

  // ---------------------------------------------------------------------- tree --
  get children(): MiniElement[] {
    return this.childNodes.filter((n): n is MiniElement => n instanceof MiniElement);
  }
  get firstElementChild(): MiniElement | null {
    return this.children[0] ?? null;
  }
  get lastElementChild(): MiniElement | null {
    return this.children[this.children.length - 1] ?? null;
  }
  get nextElementSibling(): MiniElement | null {
    const sibs = this.parentNode?.children ?? [];
    return sibs[sibs.indexOf(this) + 1] ?? null;
  }
  get previousElementSibling(): MiniElement | null {
    const sibs = this.parentNode?.children ?? [];
    return sibs[sibs.indexOf(this) - 1] ?? null;
  }

  private adopt(n: MiniNode | string): MiniNode {
    const node = typeof n === 'string' ? new MiniText(n) : n;
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    return node;
  }
  append(...nodes: (MiniNode | string)[]) {
    for (const n of nodes) this.childNodes.push(this.adopt(n));
  }
  prepend(...nodes: (MiniNode | string)[]) {
    const adopted = nodes.map((n) => this.adopt(n));
    this.childNodes.unshift(...adopted);
  }
  appendChild<T extends MiniNode>(node: T): T {
    this.append(node);
    return node;
  }
  insertBefore<T extends MiniNode>(node: T, ref: MiniNode | null): T {
    if (!ref) return this.appendChild(node);
    const adopted = this.adopt(node);
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, adopted);
    return node;
  }
  removeChild<T extends MiniNode>(node: T): T {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  replaceChildren(...nodes: (MiniNode | string)[]) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  replaceWith(...nodes: (MiniNode | string)[]) {
    const parent = this.parentNode;
    if (!parent) return;
    const i = parent.childNodes.indexOf(this);
    parent.removeChild(this);
    const adopted = nodes.map((n) => (parent as MiniElement).adopt(n));
    parent.childNodes.splice(i, 0, ...adopted);
  }
  contains(node: MiniNode | null): boolean {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  override get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  override set textContent(v: string) {
    this.replaceChildren(...(v === '' || v == null ? [] : [new MiniText(String(v))]));
  }
  set innerHTML(v: string) {
    if (this.content) {
      this.content.firstElementChild = v.trim() ? new MiniRaw(v.trim()) : null;
      return;
    }
    this.replaceChildren(...(v ? [new MiniRaw(v)] : []));
  }
  get innerHTML(): string {
    return this.childNodes.map(html).join('');
  }
  get outerHTML(): string {
    return html(this);
  }

  // ----------------------------------------------------------------- selectors --
  matches(selector: string): boolean {
    return selector.split(',').some((s) => matchChain(this, parseChain(s.trim())));
  }
  closest(selector: string): MiniElement | null {
    for (let n: MiniElement | null = this; n; n = n.parentNode) if (n.matches(selector)) return n;
    return null;
  }
  querySelectorAll(selector: string): MiniElement[] {
    const out: MiniElement[] = [];
    const walk = (n: MiniElement) => {
      for (const c of n.children) {
        if (c.matches(selector)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): MiniElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  // ------------------------------------------------------------------- the rest --
  getBoundingClientRect() {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }
  get offsetWidth() {
    return 0;
  }
  get clientWidth() {
    return 0;
  }
  get clientHeight() {
    return 0;
  }
  focus() {
    miniDocument.activeElement = this;
  }
  blur() {
    if (miniDocument.activeElement === this) miniDocument.activeElement = null;
  }
  click() {
    if (!this.disabled) this.dispatchEvent({ type: 'click' });
  }
}

/* --------------------------------------------------------------------- selectors -- */

interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: { name: string; value?: string }[];
  not: string[];
}
type Chain = { compound: Compound; combinator: ' ' | '>' }[];

function parseCompound(src: string): Compound {
  const c: Compound = { classes: [], attrs: [], not: [] };
  const re = /^([a-zA-Z][\w-]*|\*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]|:not\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] && m[1] !== '*') c.tag = m[1].toLowerCase();
    else if (m[2]) c.classes.push(m[2]);
    else if (m[3]) c.id = m[3];
    else if (m[4]) c.attrs.push({ name: m[4], value: m[5] });
    else if (m[6]) c.not.push(m[6]);
  }
  return c;
}

function parseChain(selector: string): Chain {
  const tokens = selector.replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
  const chain: Chain = [];
  let combinator: ' ' | '>' = ' ';
  for (const t of tokens) {
    if (t === '>') {
      combinator = '>';
      continue;
    }
    chain.push({ compound: parseCompound(t), combinator });
    combinator = ' ';
  }
  return chain;
}

function matchCompound(el: MiniElement, c: Compound): boolean {
  if (c.tag && el.localName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const cls of c.classes) if (!el.classList.contains(cls)) return false;
  for (const a of c.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (a.value !== undefined && el.getAttribute(a.name) !== a.value) return false;
  }
  for (const n of c.not) if (el.matches(n)) return false;
  return true;
}

function matchChain(el: MiniElement, chain: Chain): boolean {
  const last = chain[chain.length - 1];
  if (!last || !matchCompound(el, last.compound)) return false;
  if (chain.length === 1) return true;
  const rest = chain.slice(0, -1);
  if (last.combinator === '>') return !!el.parentNode && matchChain(el.parentNode, rest);
  for (let p = el.parentNode; p; p = p.parentNode) if (matchChain(p, rest)) return true;
  return false;
}

/* --------------------------------------------------------------------- serializer -- */

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** The node as markup: attributes in the order they were set, the style as its cssText. */
export function html(node: MiniNode): string {
  if (node instanceof MiniText) return escText(node.data);
  if (node instanceof MiniRaw) return node.markup;
  if (!(node instanceof MiniElement)) return '';
  const attrs = node.attributeNames.map((k) => {
    const v = node.getAttribute(k)!;
    return v === '' ? ` ${k}` : ` ${k}="${escAttr(v)}"`;
  });
  const style = node.style.cssText;
  if (style) attrs.push(` style="${escAttr(style)}"`);
  const open = `<${node.localName}${attrs.join('')}>`;
  if (VOID.has(node.localName)) return open;
  return `${open}${node.childNodes.map(html).join('')}</${node.localName}>`;
}

/* ----------------------------------------------------------------------- document -- */

class MiniMediaQueryList {
  private fns: ((e: { matches: boolean }) => void)[] = [];
  constructor(public readonly media: string, public matches: boolean) {}
  addEventListener(_type: 'change', fn: (e: { matches: boolean }) => void) {
    this.fns.push(fn);
  }
  removeEventListener(_type: 'change', fn: (e: { matches: boolean }) => void) {
    this.fns = this.fns.filter((f) => f !== fn);
  }
  /** Test hook: the window crossed the query's edge. */
  set(matches: boolean) {
    this.matches = matches;
    for (const fn of this.fns) fn({ matches });
  }
}

export const miniDocument = {
  activeElement: null as MiniElement | null,
  documentElement: new MiniElement('html'),
  body: new MiniElement('body'),
  createElement: (tag: string) => new MiniElement(tag),
  createElementNS: (ns: string, tag: string) => new MiniElement(tag, ns),
  createTextNode: (text: string) => new MiniText(text),
  addEventListener(type: string, fn: Listener) {
    miniDocument.documentElement.addEventListener(type, fn);
  },
  removeEventListener(type: string, fn: Listener) {
    miniDocument.documentElement.removeEventListener(type, fn);
  },
  querySelector: (s: string) => miniDocument.documentElement.querySelector(s),
  querySelectorAll: (s: string) => miniDocument.documentElement.querySelectorAll(s),
};
miniDocument.documentElement.append(miniDocument.body);

/** Every media query the page asked about, by its text, so a test can flip one. */
export const mediaQueries = new Map<string, MiniMediaQueryList>();

const storage = new Map<string, string>();
export const miniStorage = {
  getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
  setItem: (k: string, v: string) => void storage.set(k, String(v)),
  removeItem: (k: string) => void storage.delete(k),
  clear: () => storage.clear(),
};

export function installMiniDom(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = miniDocument;
  g.HTMLElement = MiniElement;
  g.Node = MiniNode;
  g.localStorage = miniStorage;
  g.getComputedStyle = () => ({ borderLeftWidth: '0px', borderTopWidth: '0px', getPropertyValue: () => '' });
  g.window = {
    matchMedia(query: string) {
      let mq = mediaQueries.get(query);
      if (!mq) mediaQueries.set(query, (mq = new MiniMediaQueryList(query, false)));
      return mq;
    },
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1280,
    innerHeight: 800,
    getComputedStyle: g.getComputedStyle,
  };
}

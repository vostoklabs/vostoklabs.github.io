/*
  A page and a WebGL 2 context for running the real viewer in node.

  What the viewer touches is stood in for, just far enough for three.js to start, build its
  shaders and draw: a stage element, a canvas whose context records every WebGL call it is
  given, animation frames that run when the test says so, and the observers, storage and styles
  the viewer reads. Nothing is drawn. What a test reads is what the viewer did: its scene graph
  and camera, and the WebGL calls, in order, which is what reaches the screen.

  Install it before the viewer is imported: three.js and the viewer look for the page as they
  load.

    const page = installPage();
    const { createViewer } = await import('../src/index');
*/

type Listener = (event: any) => void;

class Target {
  private listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  /** Listeners currently attached, per type: what a test checks dispose() took away. */
  listenerCount(type?: string): number {
    if (type) return this.listeners.get(type)?.size ?? 0;
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
  dispatchEvent(event: { type: string; [k: string]: unknown }) {
    for (const fn of [...(this.listeners.get(event.type) ?? [])]) fn(event);
    return true;
  }
}

class Element extends Target {
  style: Record<string, string> = {};
  children: Element[] = [];
  parentNode: Element | null = null;
  parentElement: Element | null = null;
  ownerDocument: unknown = null;
  attributes = new Map<string, string>();
  constructor(public tagName: string, public width = 0, public height = 0) {
    super();
  }
  get clientWidth() {
    return this.width;
  }
  get clientHeight() {
    return this.height;
  }
  get offsetWidth() {
    return this.width;
  }
  appendChild<T extends Element>(child: T): T {
    child.remove();
    child.parentNode = this;
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  remove() {
    const p = this.parentNode;
    if (p) p.children = p.children.filter((c) => c !== this);
    this.parentNode = null;
    this.parentElement = null;
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.width, bottom: this.height, width: this.width, height: this.height, x: 0, y: 0 };
  }
  getRootNode() {
    return globalThis.document;
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }
  focus() {}
}

/** Every WebGL call, as one line: the method and its arguments, constants by name. */
export type GLLog = string[];

class Canvas extends Element {
  gl: ReturnType<typeof fakeGL> | null = null;
  contextAttributes: Record<string, unknown> | null = null;
  constructor(public log: GLLog) {
    super('canvas', 300, 150);
  }
  getContext(type: string, attrs: Record<string, unknown> = {}) {
    if (type === '2d') return fake2d();
    if (type !== 'webgl2') return null;
    if (!this.gl) {
      this.contextAttributes = { ...attrs };
      this.gl = fakeGL(this, attrs, this.log);
    }
    return this.gl.context;
  }
  toDataURL(type = 'image/png') {
    this.log.push(`toDataURL(${type}) ${this.width}x${this.height}`);
    return `data:${type};base64,UEFHRS1TVEFORC1JTg==`;
  }
  toBlob(cb: (b: Blob | null) => void, type = 'image/png') {
    this.log.push(`toBlob(${type}) ${this.width}x${this.height}`);
    cb(new Blob([`${this.width}x${this.height}`], { type }));
  }
}

function fake2d() {
  return {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
    fillRect() {},
    clearRect() {},
    drawImage() {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  };
}

/* ------------------------------------------------------------------ WebGL 2 */

/** A WebGL 2 context that answers like a real one and records what it is asked to do. */
function fakeGL(canvas: Canvas, attrs: Record<string, unknown>, log: GLLog) {
  const byName = new Map<string, number>();
  const names = new Map<number, string>();
  let nextConstant = 0x8000;
  const constant = (name: string) => {
    let v = byName.get(name);
    if (v === undefined) {
      v = nextConstant++;
      byName.set(name, v);
      names.set(v, name);
    }
    return v;
  };
  let handles = 0;
  const handle = (kind: string) => ({ kind, id: ++handles });
  const stored = new Map<string | symbol, unknown>();

  const extension = (name: string) => {
    switch (name) {
      case 'EXT_color_buffer_float':
      case 'OES_texture_float_linear':
      case 'EXT_color_buffer_half_float':
        return {};
      case 'WEBGL_lose_context':
        return { loseContext: () => log.push('WEBGL_lose_context.loseContext()'), restoreContext: () => {} };
      default:
        return null;
    }
  };
  const parameter = (p: number) => {
    const name = names.get(p) ?? String(p);
    if (name === 'VERSION') return 'WebGL 2.0 (stand-in)';
    if (name === 'SHADING_LANGUAGE_VERSION') return 'WebGL GLSL ES 3.00 (stand-in)';
    if (name === 'SCISSOR_BOX' || name === 'VIEWPORT') return new Int32Array([0, 0, canvas.width, canvas.height]);
    if (name.includes('SIZE')) return 4096;
    if (name.includes('VECTORS')) return 1024;
    if (name === 'MAX_SAMPLES') return 4;
    if (name.startsWith('MAX_')) return 16;
    if (name.startsWith('IMPLEMENTATION_COLOR_READ')) return constant(name === 'IMPLEMENTATION_COLOR_READ_FORMAT' ? 'RGBA' : 'UNSIGNED_BYTE');
    return 0;
  };

  const answers: Record<string, (...a: any[]) => unknown> = {
    getContextAttributes: () => ({ ...attrs }),
    getParameter: parameter,
    getExtension: extension,
    getSupportedExtensions: () => [],
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getShaderParameter: () => true,
    getProgramParameter: (_p: unknown, pname: number) => (names.get(pname) === 'LINK_STATUS' ? true : 0),
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getShaderSource: () => '',
    getUniformLocation: () => null,
    getAttribLocation: () => -1,
    getError: () => 0,
    isContextLost: () => false,
    checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'),
    createBuffer: () => handle('buffer'),
    createTexture: () => handle('texture'),
    createFramebuffer: () => handle('framebuffer'),
    createRenderbuffer: () => handle('renderbuffer'),
    createProgram: () => handle('program'),
    createShader: () => handle('shader'),
    createVertexArray: () => handle('vao'),
    createQuery: () => handle('query'),
    createSampler: () => handle('sampler'),
    fenceSync: () => handle('sync'),
  };

  const fmt = (v: unknown): string => {
    if (typeof v === 'number') return names.get(v) ?? String(v);
    if (typeof v === 'string') return v.length > 40 ? `"${v.slice(0, 12)}…${v.length}"` : JSON.stringify(v);
    if (v === null || v === undefined || typeof v === 'boolean') return String(v);
    if (ArrayBuffer.isView(v)) {
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      let h = 2166136261;
      for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 16777619) >>> 0;
      return `${v.constructor.name}[${(v as unknown as { length: number }).length}]#${h.toString(16)}`;
    }
    if (Array.isArray(v)) return `[${v.map(fmt).join(',')}]`;
    if (typeof v === 'object' && 'kind' in (v as object)) return `${(v as { kind: string }).kind}${(v as { id: number }).id}`;
    if (v instanceof Canvas) return `canvas ${v.width}x${v.height}`;
    return typeof v;
  };

  const context: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'canvas') return canvas;
        if (prop === 'drawingBufferWidth') return canvas.width;
        if (prop === 'drawingBufferHeight') return canvas.height;
        if (stored.has(prop)) return stored.get(prop);
        if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return constant(prop);
        return (...args: unknown[]) => {
          log.push(`${prop}(${args.map(fmt).join(', ')})`);
          return answers[prop]?.(...args);
        };
      },
      set(_t, prop, value) {
        stored.set(prop, value);
        log.push(`set ${String(prop)} = ${fmt(value)}`);
        return true;
      },
    },
  );
  return { context, constant };
}

/* ------------------------------------------------------------------ the page */

export interface Page {
  /** The element the viewer is given, 800 x 600. */
  stage: Element;
  /** Every WebGL call made so far, and every picture taken. */
  log: GLLog;
  /** The canvas the viewer's renderer draws into (the last, if there are several). */
  canvas(): Canvas;
  /** Run animation frames: the viewer draws once per frame. */
  frame(count?: number): void;
  /** Animation frames waiting to run. */
  pendingFrames(): number;
  /** Set `<html data-theme>`, and tell the observers, as the page does. */
  setTheme(theme: 'light' | 'dark'): void;
  /** A pointer event on the canvas, at stage coordinates. */
  pointer(type: string, x: number, y: number, extra?: Record<string, unknown>): void;
  /** The listeners on the window, for checking that dispose() takes its own away. */
  window: Target;
}

export function installPage(): Page {
  const log: GLLog = [];
  const g = globalThis as any;
  const canvases: Canvas[] = [];
  const html = new Element('html');
  const body = new Element('body');
  const win = new Target();
  const doc: any = new Target();
  doc.documentElement = html;
  doc.body = body;
  doc.createElement = (tag: string) => {
    if (tag === 'canvas') {
      const c = new Canvas(log);
      c.ownerDocument = doc;
      canvases.push(c);
      return c;
    }
    return new Element(tag);
  };
  doc.createElementNS = (_ns: string, tag: string) => doc.createElement(tag);
  html.ownerDocument = doc;
  body.ownerDocument = doc;

  let frames: Map<number, (t: number) => void> = new Map();
  let nextFrame = 0;
  let clock = 0;
  const observers: { cb: (records: unknown[]) => void }[] = [];
  const store = new Map<string, string>();

  Object.assign(g, {
    document: doc,
    window: Object.assign(win, { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800, document: doc }),
    self: g,
    requestAnimationFrame: (cb: (t: number) => void) => {
      frames.set(++nextFrame, cb);
      return nextFrame;
    },
    cancelAnimationFrame: (id: number) => void frames.delete(id),
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    MutationObserver: class {
      private entry: { cb: (records: unknown[]) => void };
      constructor(cb: (records: unknown[]) => void) {
        this.entry = { cb };
      }
      observe() {
        observers.push(this.entry);
      }
      disconnect() {
        const i = observers.indexOf(this.entry);
        if (i >= 0) observers.splice(i, 1);
      }
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
  });

  /** The canvas a WebGL context was asked of: the renderer's, not a texture's 2D canvas. */
  const glCanvas = () => [...canvases].reverse().find((c) => c.gl) ?? canvases[canvases.length - 1]!;

  const stage = new Element('div', 800, 600);
  stage.ownerDocument = doc;
  body.appendChild(stage);

  return {
    stage,
    log,
    canvas: () => glCanvas(),
    frame(count = 1) {
      for (let i = 0; i < count; i++) {
        const due = frames;
        frames = new Map();
        clock += 16;
        for (const cb of due.values()) cb(clock);
      }
    },
    pendingFrames: () => frames.size,
    setTheme(theme) {
      html.setAttribute('data-theme', theme);
      for (const o of [...observers]) o.cb([{ attributeName: 'data-theme' }]);
    },
    pointer(type, x, y, extra = {}) {
      glCanvas().dispatchEvent({ type, clientX: x, clientY: y, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', shiftKey: false, preventDefault() {}, stopPropagation() {}, ...extra });
    },
    window: win,
  };
}

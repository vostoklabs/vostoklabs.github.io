import { el, svgNode, uid } from '../dom';
import {
  canvasBounds,
  canvasToModel,
  cornerCursor,
  fitView,
  handlesOf,
  hitHandle,
  hitObject,
  modelToCanvas,
  moveBox,
  nudgeBox,
  outlinePath,
  pillPosition,
  resizeBox,
  resizeView,
  rotationTowards,
  snapToGuides,
  zoomView,
  type Corner,
  type DesignBounds,
  type DesignBox,
  type DesignChange,
  type DesignShape,
  type HandleSpec,
  type Pt,
  type View,
} from './design-canvas-math';

export type { DesignBox, DesignChange, DesignBounds, DesignShape } from './design-canvas-math';

/*
  A true-scale view from above where the parts of a design are objects: press one to pick it and
  drag it, pull a corner to resize it, turn it by the round grip on a stem above its top edge.
  Moving snaps its centre to guide lines; arrow keys nudge it; a small pill by its corner carries
  its value. Empty space pans, the wheel zooms at the pointer, two fingers pinch.

  The app draws its picture into `content` in millimetres with +y up, and owns every value: the
  canvas proposes a box, the app's `constrain` has the last word on it, and `onChange` reports it,
  'live' once a frame while a drag goes on and one 'end' on release, so a drag is one undo step.
  What is under a press is decided by the maths in `design-canvas-math.ts` (each object's `hit`
  and `z`), never by the element under the pointer, so nothing an app draws can steal a press.

  The selection, its handles, the guides and the pill are drawn in canvas pixels, the same size at
  any zoom. Nothing here writes a style attribute: SVG presentation attributes, classes and the
  CSSOM only, which a strict `style-src` allows.

  Keyboard: every object has an invisible focusable twin, in list order, named by its `label`, so
  Tab walks the objects and focusing one picks it. Arrows nudge 0.5 mm (Shift 5 mm), Delete or
  Backspace removes a `deletable` one, Esc lets go.
*/

export interface DesignObject {
  id: string;
  /** Its accessible name: "Picture", "Words: MILO". */
  label: string;
  box: DesignBox;
  /** Drag to move, arrow keys to nudge. Default true. */
  move?: boolean;
  /** Corner handles. 'uniform' keeps the proportions; 'free' keeps them only while Shift is held.
   *  Default false: no corners. */
  resize?: 'uniform' | 'free' | false;
  /** The rotate grip above the top edge; Shift turns in 15° steps. Default false. */
  rotate?: boolean;
  /** Delete or Backspace calls `onDelete`. Default false. */
  deletable?: boolean;
  /** 'border': only a press on or near its outline (or on a handle) takes it, and a press inside
   *  reaches whatever is under it. Default 'inside'. */
  grab?: 'inside' | 'border';
  /** The outline drawn round it when hovered or selected: its box, or the ellipse in it. A press
   *  takes it inside that outline. Default 'box'. */
  shape?: DesignShape;
  /** Whether a model point is on it, for a press: a picture's own silhouette rather than its box.
   *  Not read for a 'border' object. Default: inside the outline `shape` draws. */
  hit?: (x: number, y: number) => boolean;
  /** Which takes a press where objects overlap: higher wins, then the one later in the list.
   *  Default 0. */
  z?: number;
}

export interface DesignCanvasOptions {
  /** The canvas's accessible name. */
  label: string;
  /** A press or a focus picked an object, or a click on empty space let it go (null). */
  onSelect?(id: string | null): void;
  /**
   * A box changed. While a drag goes on, 'live' at most once a frame; on release exactly one
   * 'end', the one to commit as an undo step. A nudge sends 'end' alone. A press that never moved
   * sends nothing.
   */
  onChange?(id: string, box: DesignBox, phase: 'live' | 'end', kind: DesignChange): void;
  /** Delete or Backspace on a `deletable` object. */
  onDelete?(id: string): void;
  /** The app's last word on every box the canvas proposes, before it is drawn and reported: clamp
   *  it, snap it, or hand it back as it came. */
  constrain?(id: string, box: DesignBox, kind: DesignChange): DesignBox;
  /** The value pill's text for the selected object, or null for none. */
  pill?(id: string, box: DesignBox): string | null;
  /** Lines a moving centre snaps to, mm. Each axis defaults to [0], the centre lines; [] turns an
   *  axis off. */
  guides?: { x?: number[]; y?: number[] };
  /** How near a guide a moving centre snaps onto it, mm. Default 1.5. */
  snapMm?: number;
  /** The zoom changed (1 = the fitted view): for `zoomControl().set`. */
  onZoom?(zoom: number): void;
  /** A click on empty space (not a pan), in mm. It also lets the selection go. */
  onBackground?(x: number, y: number): void;
}

export interface DesignCanvasHandle {
  /** Fills its container, which must be positioned; the app places it. */
  root: HTMLElement;
  /**
   * Where the app draws, in millimetres with +y up. A stroke here scales with the zoom unless it
   * has `vector-effect="non-scaling-stroke"`, which keeps an outline one width at any zoom. The
   * group flips y, so text drawn here needs its own `scale(1 -1)`.
   */
  content: SVGGElement;
  /** Replace the objects. The selection is kept by id; an object being dragged keeps the canvas's
   *  own box until its 'end'. Fires nothing. */
  setObjects(objects: DesignObject[]): void;
  /** Pick an object, or none. Fires nothing. */
  select(id: string | null): void;
  selected(): string | null;
  /** Show these bounds whole, `paddingPx` clear of the edges (default 24): zoom 1 is this view.
   *  A canvas nobody has panned or zoomed since stays fitted when it changes size. */
  fit(bounds: DesignBounds, paddingPx?: number): void;
  /** Zoom by a factor about the middle of the canvas. */
  zoomBy(factor: number): void;
  /** Move the view so the drawing moves (dx, dy) mm on screen, +y up, drawn at once: for an app
   *  that moves the model under the view (a picture dragged where only what is round it can move)
   *  and keeps what the person dragged where they let it go. */
  panBy(dx: number, dy: number): void;
  zoom(): number;
  /** A point on the page (a pointer event's clientX/clientY) in the model, mm. */
  toModel(clientX: number, clientY: number): [number, number];
  destroy(): void;
}

/** A corner handle's side, the rotate grip's radius, and the stem from the top edge to it, px. */
const HANDLE_PX = 9;
const GRIP_PX = 5.5;
const STEM_PX = 22;
/** The smallest side a resize leaves, mm. */
const MIN_MM = 1;
/** The zoom range, against the fitted view. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 40;
/** Wheel to zoom: a mouse notch is about 100; a trackpad pinch arrives as small steps with ctrlKey. */
const WHEEL_K = 0.0015;
const PINCH_WHEEL_K = 0.01;

/** How far past a handle a press still takes it, px: a finger is less exact than a mouse, and gets
 *  a target of at least 44 px. */
const slopFor = (type: string) => (type === 'touch' ? 18 : type === 'pen' ? 8 : 4);
/** How near a 'border' object's outline a press must land, px. */
const bandFor = (type: string) => (type === 'touch' ? 14 : type === 'pen' ? 8 : 6);
/** How far a press travels before it is a drag, px. Short of it, it is a click. */
const travelFor = (type: string) => (type === 'touch' ? 6 : 3);

interface Drag {
  type: 'drag';
  pointer: number;
  id: string;
  kind: 'move' | 'resize' | 'rotate';
  corner: Corner;
  start: DesignBox;
  /** The box as the drag has it now, after `constrain`. */
  box: DesignBox;
  /** The press, in the model. */
  from: Pt;
  /** The press, and the pointer now, on the canvas. */
  downX: number;
  downY: number;
  lastX: number;
  lastY: number;
  travel: number;
  /** Past the travel threshold: the box has started to change. */
  started: boolean;
  shift: boolean;
  /** The guide lines the centre sits on, mm. */
  snapX: number | null;
  snapY: number | null;
}

type Gesture =
  | Drag
  /** On empty space: a click, or a pan once it travels. */
  | { type: 'press'; pointer: number; downX: number; downY: number; travel: number }
  | { type: 'pan'; pointer: number; lastX: number; lastY: number }
  /** On an object that does not move: it was picked, and nothing follows. */
  | { type: 'hold'; pointer: number }
  | { type: 'pinch'; a: number; b: number; dist: number; mx: number; my: number };

export function designCanvas(opts: DesignCanvasOptions): DesignCanvasHandle {
  const snapMm = opts.snapMm ?? 1.5;
  const guides = { x: opts.guides?.x ?? [0], y: opts.guides?.y ?? [0] };

  // ------------------------------------------------------------------------------ the DOM --
  const content = svgNode('g');
  const world = svgNode('g', { 'aria-hidden': 'true' }, [content]);
  const proxyLayer = svgNode('g', { class: 'vl-design-canvas__proxies' });
  // Each starts hidden; `draw()` shows what the selection and the gesture call for.
  const hoverLine = svgNode('path', { class: 'vl-design-canvas__hover', display: 'none' });
  const guideX = svgNode('line', { class: 'vl-design-canvas__guide', display: 'none' });
  const guideY = svgNode('line', { class: 'vl-design-canvas__guide', display: 'none' });
  const outline = svgNode('path', { class: 'vl-design-canvas__outline', display: 'none' });
  const stem = svgNode('line', { class: 'vl-design-canvas__stem', display: 'none' });
  const grip = svgNode('circle', { class: 'vl-design-canvas__grip', r: GRIP_PX, display: 'none' });
  const corners = [0, 1, 2, 3].map(() =>
    svgNode('rect', { class: 'vl-design-canvas__handle', width: HANDLE_PX, height: HANDLE_PX, rx: 1.5, display: 'none' }),
  );
  const overlay = svgNode('g', { class: 'vl-design-canvas__overlay', 'aria-hidden': 'true' }, [
    guideX, guideY, hoverLine, outline, stem, grip, ...corners,
  ]);
  const svg = svgNode('svg', { class: 'vl-design-canvas__svg', role: 'none' }, [world, proxyLayer, overlay]);
  const pill = el('div', { className: 'vl-design-canvas__pill', attrs: { 'aria-hidden': 'true' } });
  pill.hidden = true;
  // What a focused object can do, read after its name.
  const moveHint = el('span', { className: 'vl-design-canvas__hint', text: 'Arrow keys move it.', attrs: { id: uid('vl-design-hint') } });
  const deleteHint = el('span', { className: 'vl-design-canvas__hint', text: 'Delete removes it.', attrs: { id: uid('vl-design-hint') } });
  // A nudge's new value, said once; a drag's values are not, since they change many times a second.
  const said = el('span', { className: 'vl-design-canvas__said', attrs: { 'aria-live': 'polite' } });
  // An application to a screen reader, so the arrow keys reach the canvas rather than the reading
  // cursor. Focusable by a click, not a Tab stop: Tab goes to the objects.
  const root = el('div', {
    className: 'vl-design-canvas',
    attrs: { role: 'application', 'aria-label': opts.label, tabindex: '-1' },
  }, [svg, pill, moveHint, deleteHint, said]);

  // ------------------------------------------------------------------------------ state --
  let objects: DesignObject[] = [];
  let selected: string | null = null;
  let hover: string | null = null;
  let gesture: Gesture | null = null;
  let view: View = { s: 1, ox: 0, oy: 0 };
  /** The scale of the fitted view: zoom 1. */
  let fitScale = 1;
  let size = { w: 0, h: 0 };
  let framing: { bounds: DesignBounds; padding: number } = { bounds: { minX: -50, minY: -50, maxX: 50, maxY: 50 }, padding: 24 };
  /** The view has been panned or zoomed since it was fitted. */
  let moved = false;
  let spaceHeld = false;
  let over = false;
  /** Set while the canvas moves focus itself, so the focus does not read as a pick. */
  let quiet = false;
  /** Touch pointers that are down, on the canvas. */
  const touches = new Map<number, Pt>();
  const proxies = new Map<string, SVGPathElement>();

  const find = (id: string | null) => (id === null ? null : objects.find((o) => o.id === id) ?? null);
  const boxOf = (o: DesignObject) => (gesture?.type === 'drag' && gesture.id === o.id ? gesture.box : o.box);
  const constrain = (id: string, box: DesignBox, kind: DesignChange) => (opts.constrain ? opts.constrain(id, { ...box }, kind) : box);
  const zoom = () => (fitScale > 0 ? view.s / fitScale : 1);
  const local = (clientX: number, clientY: number): Pt => {
    const r = root.getBoundingClientRect();
    return [clientX - r.left, clientY - r.top];
  };

  // ------------------------------------------------------------------------------ the view --
  const refit = () => {
    if (!size.w || !size.h) return;
    view = fitView(framing.bounds, size.w, size.h, framing.padding);
    fitScale = view.s;
    moved = false;
  };
  /** Take in the canvas's size. The first one fits, and so does any for a view nobody has moved;
   *  a moved view keeps its centre and scale. A hidden canvas (no size) changes nothing. */
  const measure = () => {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (!w || !h || (w === size.w && h === size.h)) return;
    const from = size;
    size = { w, h };
    if (!moved || !from.w) refit();
    else view = resizeView(view, from, size);
  };
  const zoomAt = (px: number, py: number, factor: number) => {
    measure();
    if (!size.w) return;
    const next = zoomView(view, factor, px, py, fitScale * MIN_ZOOM, fitScale * MAX_ZOOM);
    if (next.s === view.s) return;
    view = next;
    moved = true;
    opts.onZoom?.(zoom());
  };
  const pan = (dx: number, dy: number) => {
    view = { s: view.s, ox: view.ox + dx, oy: view.oy + dy };
    moved = true;
    schedule();
  };

  // ------------------------------------------------------------------------------ drawing --
  const show = (node: SVGElement, on: boolean) => {
    if (on) node.removeAttribute('display');
    else node.setAttribute('display', 'none');
  };
  const put = (node: SVGElement, attrs: Record<string, number | string>) => {
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, typeof v === 'number' ? String(Math.round(v * 100) / 100) : v);
  };

  function draw(): void {
    measure();
    world.setAttribute('transform', `matrix(${view.s} 0 0 ${-view.s} ${view.ox} ${view.oy})`);

    const hovered = gesture ? null : find(hover);
    show(hoverLine, !!hovered && hovered.id !== selected);
    if (hovered && hovered.id !== selected) hoverLine.setAttribute('d', outlinePath(view, boxOf(hovered), hovered.shape));

    const sel = find(selected);
    const box = sel ? boxOf(sel) : null;
    show(outline, !!sel);
    show(stem, !!sel?.rotate);
    show(grip, !!sel?.rotate);
    for (const c of corners) show(c, !!sel?.resize);
    if (sel && box) {
      outline.setAttribute('d', outlinePath(view, box, sel.shape));
      const h = handlesOf(view, box, STEM_PX);
      if (sel.rotate) {
        put(stem, { x1: h.stem[0], y1: h.stem[1], x2: h.grip[0], y2: h.grip[1] });
        put(grip, { cx: h.grip[0], cy: h.grip[1] });
      }
      if (sel.resize) {
        corners.forEach((c, i) => {
          const [x, y] = h.corners[i as Corner];
          put(c, { x: x - HANDLE_PX / 2, y: y - HANDLE_PX / 2 });
          // Square to the box, which on the canvas turns the other way (its y points down).
          c.setAttribute('transform', `rotate(${Math.round(-box.rotation * 100) / 100} ${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100})`);
        });
      }
    }

    const g = gesture?.type === 'drag' && gesture.kind === 'move' ? gesture : null;
    const gx = g?.snapX ?? null;
    const gy = g?.snapY ?? null;
    show(guideX, gx !== null);
    show(guideY, gy !== null);
    if (gx !== null) {
      const x = modelToCanvas(view, gx, 0)[0];
      put(guideX, { x1: x, y1: 0, x2: x, y2: size.h });
    }
    if (gy !== null) {
      const y = modelToCanvas(view, 0, gy)[1];
      put(guideY, { x1: 0, y1: y, x2: size.w, y2: y });
    }

    const text = sel && box && opts.pill ? opts.pill(sel.id, box) : null;
    pill.hidden = !text;
    if (sel && box && text) {
      if (pill.textContent !== text) pill.textContent = text;
      const [x, y] = pillPosition(canvasBounds(view, box, sel.shape), { w: pill.offsetWidth, h: pill.offsetHeight }, size);
      pill.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    for (const o of objects) proxies.get(o.id)?.setAttribute('d', outlinePath(view, boxOf(o), o.shape));
  }

  /* Pointer work draws once a frame, and a drag's 'live' change goes out in the same frame as its
     drawing. Everything else draws at once: a canvas that only drew on animation frames would sit
     stale in a background tab, where frames stop. */
  let frame = 0;
  let livePending = false;
  const flush = () => {
    frame = 0;
    draw();
    const g = gesture;
    if (livePending && g?.type === 'drag') {
      livePending = false;
      opts.onChange?.(g.id, { ...g.box }, 'live', g.kind);
    }
  };
  const schedule = () => {
    if (typeof requestAnimationFrame !== 'function') flush();
    else if (!frame) frame = requestAnimationFrame(flush);
  };
  const cancelFrame = () => {
    if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    frame = 0;
  };

  // ------------------------------------------------------------------------------ objects --
  const syncProxies = () => {
    const keep = new Set(objects.map((o) => o.id));
    for (const [id, node] of proxies) {
      if (keep.has(id)) continue;
      node.remove();
      proxies.delete(id);
    }
    for (const o of objects) {
      let node = proxies.get(o.id);
      if (!node) {
        const id = o.id;
        node = svgNode('path', { class: 'vl-design-canvas__proxy', role: 'button', tabindex: 0 });
        node.addEventListener('focus', () => {
          if (quiet || gesture || selected === id) return;
          selected = id;
          opts.onSelect?.(id);
          draw();
        });
        proxies.set(id, node);
      }
      node.setAttribute('aria-label', o.label);
      const about = [o.move !== false ? moveHint.id : '', o.deletable ? deleteHint.id : ''].filter(Boolean).join(' ');
      if (about) node.setAttribute('aria-describedby', about);
      else node.removeAttribute('aria-describedby');
    }
    // Tab follows the list. Re-ordered only when the order changed: moving a focused node drops
    // its focus.
    const order = objects.map((o) => proxies.get(o.id)!);
    const now = Array.from(proxyLayer.children);
    if (order.length !== now.length || order.some((node, i) => node !== now[i])) proxyLayer.replaceChildren(...order);
  };

  /** Focus an object's twin, or the canvas, without that focus reading as a pick. */
  const focusOn = (id: string | null) => {
    const target: HTMLElement | SVGElement = (id !== null && proxies.get(id)) || root;
    if (document.activeElement === target) return;
    quiet = true;
    try {
      target.focus({ preventScroll: true });
    } finally {
      quiet = false;
    }
  };
  /** A press picked an object, or let go of one. */
  const choose = (id: string | null) => {
    if (selected !== id) {
      selected = id;
      opts.onSelect?.(id);
    }
    focusOn(id);
  };

  // ------------------------------------------------------------------------------ dragging --
  const handleSpec = (o: DesignObject, pointerType: string): HandleSpec => ({
    resize: !!o.resize,
    rotate: !!o.rotate,
    stemPx: STEM_PX,
    gripPx: GRIP_PX,
    handlePx: HANDLE_PX / 2,
    slopPx: slopFor(pointerType),
  });

  /** The drag's box for where the pointer is now, through the app's `constrain`. */
  const propose = (g: Drag) => {
    const o = find(g.id);
    if (!o) return;
    const [x, y] = canvasToModel(view, g.lastX, g.lastY);
    g.snapX = null;
    g.snapY = null;
    if (g.kind === 'move') {
      const snapped = snapToGuides(moveBox(g.start, x - g.from[0], y - g.from[1]), guides, snapMm);
      g.box = constrain(o.id, snapped.box, 'move');
      // A guide is drawn only while the box really sits on it, after the app's own clamp.
      if (snapped.x !== null && Math.abs(g.box.cx - snapped.x) < 1e-6) g.snapX = snapped.x;
      if (snapped.y !== null && Math.abs(g.box.cy - snapped.y) < 1e-6) g.snapY = snapped.y;
    } else if (g.kind === 'resize') {
      g.box = constrain(o.id, resizeBox(g.start, g.corner, x, y, o.resize === 'uniform' || g.shift, MIN_MM), 'resize');
    } else {
      g.box = constrain(o.id, { ...g.start, rotation: rotationTowards(g.start, x, y, g.shift) }, 'rotate');
    }
    livePending = true;
    schedule();
  };

  /** The drag is over: one 'end', and the box stays as it was left until the app sends its own. */
  const finishDrag = (g: Drag) => {
    cancelFrame();
    livePending = false;
    if (!g.started) return;
    const box = { ...g.box };
    objects = objects.map((o) => (o.id === g.id ? { ...o, box } : o));
    draw();
    opts.onChange?.(g.id, { ...box }, 'end', g.kind);
  };

  /** The pointer's look, written only when it changes: hovering asks on every move. */
  const setCursor = (c: string) => {
    if ((root.dataset.cursor ?? '') === c) return;
    if (c) root.dataset.cursor = c;
    else delete root.dataset.cursor;
  };
  const cursor = () => {
    const g = gesture;
    let c = '';
    if (g?.type === 'pan' || g?.type === 'pinch') c = 'grabbing';
    else if (g?.type === 'drag') c = g.kind === 'move' ? 'move' : g.kind === 'rotate' ? 'grabbing' : cornerCursor(g.box, g.corner);
    else if (spaceHeld) c = 'grab';
    setCursor(c);
  };

  /** A pointer over the canvas with nothing pressed: the faint outline and the cursor say what a
   *  press there would take. */
  const hoverAt = (px: number, py: number, pointerType: string) => {
    if (pointerType === 'touch') return;
    measure();
    let next: string | null = null;
    let c = '';
    const sel = find(selected);
    const handle = sel ? hitHandle(view, sel.box, handleSpec(sel, pointerType), px, py) : null;
    if (spaceHeld) c = 'grab';
    else if (sel && handle) c = handle.kind === 'rotate' ? 'grab' : cornerCursor(sel.box, handle.corner);
    else {
      const [x, y] = canvasToModel(view, px, py);
      const o = hitObject(objects, x, y, bandFor(pointerType) / view.s);
      next = o?.id ?? null;
      if (o) c = o.move === false ? 'pointer' : 'move';
    }
    setCursor(c);
    if (next !== hover) {
      hover = next;
      schedule();
    }
  };

  const startPinch = () => {
    const g = gesture;
    if (g?.type === 'drag') {
      gesture = null;
      finishDrag(g);
    }
    const [first, second] = [...touches.entries()];
    if (!first || !second) return;
    const [a, pa] = first;
    const [b, pb] = second;
    gesture = { type: 'pinch', a, b, dist: Math.hypot(pa[0] - pb[0], pa[1] - pb[1]), mx: (pa[0] + pb[0]) / 2, my: (pa[1] + pb[1]) / 2 };
    hover = null;
    cursor();
    schedule();
  };

  // ------------------------------------------------------------------------------ pointer --
  const capture = (e: PointerEvent) => {
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* A pointer the browser will not capture still drags while it is over the canvas. */
    }
  };

  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    measure();
    const [px, py] = local(e.clientX, e.clientY);
    if (e.pointerType === 'touch') touches.set(e.pointerId, [px, py]);
    // A second finger turns whatever the first was doing into a pinch.
    if (touches.size === 2 && e.pointerType === 'touch') {
      capture(e);
      startPinch();
      return;
    }
    if (gesture) return;
    capture(e);
    // No text selection, no focus change and no middle-button scroll of the page's own.
    e.preventDefault();
    if (e.button === 1 || spaceHeld) {
      gesture = { type: 'pan', pointer: e.pointerId, lastX: px, lastY: py };
      cursor();
      return;
    }
    const start = (o: DesignObject, kind: Drag['kind'], corner: Corner) => {
      gesture = {
        type: 'drag', pointer: e.pointerId, id: o.id, kind, corner, start: { ...o.box }, box: { ...o.box },
        from: canvasToModel(view, px, py), downX: px, downY: py, lastX: px, lastY: py,
        travel: travelFor(e.pointerType), started: false, shift: e.shiftKey, snapX: null, snapY: null,
      };
    };
    const sel = find(selected);
    const handle = sel ? hitHandle(view, sel.box, handleSpec(sel, e.pointerType), px, py) : null;
    if (sel && handle) {
      focusOn(sel.id);
      start(sel, handle.kind === 'rotate' ? 'rotate' : 'resize', handle.kind === 'corner' ? handle.corner : 0);
    } else {
      const [x, y] = canvasToModel(view, px, py);
      const o = hitObject(objects, x, y, bandFor(e.pointerType) / view.s);
      if (o) {
        choose(o.id);
        if (o.move !== false) start(o, 'move', 0);
        else gesture = { type: 'hold', pointer: e.pointerId };
      } else {
        focusOn(null);
        gesture = { type: 'press', pointer: e.pointerId, downX: px, downY: py, travel: travelFor(e.pointerType) };
      }
    }
    hover = null;
    cursor();
    draw();
  });

  root.addEventListener('pointermove', (e) => {
    const [px, py] = local(e.clientX, e.clientY);
    if (touches.has(e.pointerId)) touches.set(e.pointerId, [px, py]);
    const g = gesture;
    if (!g) {
      hoverAt(px, py, e.pointerType);
      return;
    }
    if (g.type === 'pinch') {
      const pa = touches.get(g.a);
      const pb = touches.get(g.b);
      if (!pa || !pb) return;
      const mx = (pa[0] + pb[0]) / 2;
      const my = (pa[1] + pb[1]) / 2;
      const dist = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
      pan(mx - g.mx, my - g.my);
      if (g.dist > 4) zoomAt(mx, my, dist / g.dist);
      Object.assign(g, { mx, my, dist });
      return;
    }
    if (g.pointer !== e.pointerId) return;
    if (g.type === 'pan') {
      pan(px - g.lastX, py - g.lastY);
      g.lastX = px;
      g.lastY = py;
    } else if (g.type === 'press') {
      if (Math.hypot(px - g.downX, py - g.downY) < g.travel) return;
      // Past the threshold, a press on empty space pans, from where it started.
      gesture = { type: 'pan', pointer: g.pointer, lastX: px, lastY: py };
      pan(px - g.downX, py - g.downY);
      cursor();
    } else if (g.type === 'drag') {
      g.lastX = px;
      g.lastY = py;
      g.shift = e.shiftKey;
      if (!g.started) {
        if (Math.hypot(px - g.downX, py - g.downY) < g.travel) return;
        g.started = true;
      }
      propose(g);
    }
  });

  const release = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    const g = gesture;
    if (!g) return;
    if (g.type === 'pinch') {
      if (e.pointerId !== g.a && e.pointerId !== g.b) return;
      // The finger left behind pans, from where it is.
      const rest = [...touches.entries()][0];
      gesture = rest ? { type: 'pan', pointer: rest[0], lastX: rest[1][0], lastY: rest[1][1] } : null;
      cursor();
      return;
    }
    if (g.pointer !== e.pointerId) return;
    gesture = null;
    if (g.type === 'press' && e.type === 'pointerup') {
      const [x, y] = canvasToModel(view, g.downX, g.downY);
      if (selected !== null) {
        selected = null;
        opts.onSelect?.(null);
      }
      opts.onBackground?.(x, y);
    }
    if (g.type === 'drag') finishDrag(g);
    cursor();
    draw();
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);
  root.addEventListener('lostpointercapture', release);
  root.addEventListener('pointerenter', () => {
    over = true;
  });
  root.addEventListener('pointerleave', () => {
    over = false;
    if (hover !== null && !gesture) {
      hover = null;
      schedule();
    }
  });

  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = local(e.clientX, e.clientY);
    // deltaMode 1 counts lines and 2 pages, rather than pixels.
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.h || 400 : 1);
    zoomAt(px, py, Math.exp(-dy * (e.ctrlKey ? PINCH_WHEEL_K : WHEEL_K)));
    schedule();
  }, { passive: false });

  // ------------------------------------------------------------------------------ keys --
  root.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || gesture) return;
    const o = find(selected);
    if (!o) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      selected = null;
      opts.onSelect?.(null);
      focusOn(null);
      draw();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!o.deletable) return;
      e.preventDefault();
      opts.onDelete?.(o.id);
      return;
    }
    if (o.move === false) return;
    const next = nudgeBox(o.box, e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    const box = constrain(o.id, next, 'nudge');
    objects = objects.map((x) => (x.id === o.id ? { ...x, box } : x));
    draw();
    opts.onChange?.(o.id, { ...box }, 'end', 'nudge');
    const value = opts.pill?.(o.id, box);
    if (value) said.textContent = value;
  });

  /* Space held over the canvas makes a drag pan; Shift during a drag changes what it does (keeps
     the proportions, snaps the turn) without waiting for the pointer to move. Space is taken only
     when the canvas has focus, or nothing has and the pointer is over it, so it never presses a
     focused button or types a space into a field elsewhere on the page. */
  const spaceIsOurs = (e: KeyboardEvent) => {
    const t = e.target as Node | null;
    if (t && root.contains(t)) return true;
    return over && (t === null || t === document.body || t === document.documentElement);
  };
  const shiftTo = (on: boolean) => {
    const g = gesture;
    if (g?.type !== 'drag' || !g.started || g.shift === on) return;
    g.shift = on;
    propose(g);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Shift') shiftTo(true);
    if (e.key !== ' ' || !spaceIsOurs(e)) return;
    e.preventDefault();
    if (!spaceHeld) {
      spaceHeld = true;
      cursor();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Shift') shiftTo(false);
    if (e.key === ' ' && spaceHeld) {
      spaceHeld = false;
      cursor();
    }
  };
  const onBlur = () => {
    spaceHeld = false;
    cursor();
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => draw()) : null;
  observer?.observe(root);
  draw();

  return {
    root,
    content,
    setObjects(next) {
      objects = next.slice();
      if (selected !== null && !find(selected)) selected = null;
      if (hover !== null && !find(hover)) hover = null;
      const g = gesture;
      if (g?.type === 'drag' && !find(g.id)) {
        cancelFrame();
        livePending = false;
        gesture = null;
        cursor();
      }
      syncProxies();
      draw();
    },
    select(id) {
      selected = find(id) ? id : null;
      // Focus follows the selection while the canvas has it, so a screen reader is on the object
      // the arrow keys now move. Never taken from elsewhere on the page.
      if (root.contains(document.activeElement)) focusOn(selected);
      draw();
    },
    selected: () => selected,
    fit(bounds, paddingPx = 24) {
      framing = { bounds: { ...bounds }, padding: paddingPx };
      measure();
      refit();
      draw();
      opts.onZoom?.(1);
    },
    zoomBy(factor) {
      measure();
      zoomAt(size.w / 2, size.h / 2, factor);
      draw();
    },
    panBy(dx, dy) {
      measure();
      // Not `pan()`, which waits a frame: the app redraws the model in the same task, and a frame
      // between the two would show it moved and the view not yet.
      view = { s: view.s, ox: view.ox + dx * view.s, oy: view.oy - dy * view.s };
      moved = true;
      draw();
    },
    zoom,
    toModel(clientX, clientY) {
      measure();
      const [px, py] = local(clientX, clientY);
      return canvasToModel(view, px, py);
    },
    destroy() {
      cancelFrame();
      gesture = null;
      observer?.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      root.remove();
    },
  };
}

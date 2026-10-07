// The camera for 2D Design and Export Preview: the wheel (or a pinch) zooms at the pointer,
// a drag pans, a double-click fits — the gestures the 3D view beside them already has, so all
// three views move the same way. It owns the SVG's viewBox and nothing else: the drawings are
// made in millimetres and never redrawn for a zoom.
//
// The viewBox always has the SVG's own aspect ratio, so a client pixel maps linearly to a
// millimetre and the point under the pointer stays under it while zooming.

export interface Box2 {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanZoom {
  /** The drawing's extent, SVG units (Y down). The view follows it — fitted — until the customer
   *  moves the view themselves; after that their view is kept until Fit (or `fit: true`). */
  setContent(box: Box2, opts?: { fit?: boolean }): void;
  fit(): void;
  /** Zoom by a factor, about a client point (the view's centre when omitted). */
  zoomBy(factor: number, at?: { x: number; y: number }): void;
  /** The zoom relative to the fitted view: 1 = everything in view. */
  zoom(): number;
  dispose(): void;
}

export interface PanZoomOptions {
  /** Room kept clear round the fitted drawing, CSS px: the status line sits on the bottom edge. */
  padding: { top: number; right: number; bottom: number; left: number };
  /** Fired after every change of view, with `zoom()`. */
  onChange?: (zoom: number) => void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 40;

export function panZoom(svg: SVGSVGElement, opts: PanZoomOptions): PanZoom {
  let content: Box2 = { x: 0, y: 0, w: 100, h: 100 };
  /** The view: its centre in SVG units, and SVG units per CSS pixel. */
  let cx = 50;
  let cy = 50;
  let scale = 1;
  let fitScale = 1;
  /** The customer has moved the view since it was last fitted. */
  let moved = false;

  const size = () => ({ w: svg.clientWidth || 1, h: svg.clientHeight || 1 });

  function apply() {
    const { w, h } = size();
    svg.setAttribute('viewBox', `${cx - (w * scale) / 2} ${cy - (h * scale) / 2} ${w * scale} ${h * scale}`);
    opts.onChange?.(fitScale / scale);
  }

  function fit() {
    const { w, h } = size();
    const p = opts.padding;
    const aw = Math.max(40, w - p.left - p.right);
    const ah = Math.max(40, h - p.top - p.bottom);
    fitScale = Math.max(content.w / aw, content.h / ah, 1e-6);
    scale = fitScale;
    // The drawing's centre goes to the centre of the padded area, not of the whole view.
    cx = content.x + content.w / 2 - ((p.left - p.right) / 2) * scale;
    cy = content.y + content.h / 2 - ((p.top - p.bottom) / 2) * scale;
    moved = false;
    apply();
  }

  /** Client point → SVG point, for the current view. */
  function toSvg(clientX: number, clientY: number) {
    const r = svg.getBoundingClientRect();
    const { w, h } = size();
    return { x: cx + (clientX - r.left - w / 2) * scale, y: cy + (clientY - r.top - h / 2) * scale };
  }

  function zoomBy(factor: number, at?: { x: number; y: number }) {
    const next = Math.min(fitScale / MIN_ZOOM, Math.max(fitScale / MAX_ZOOM, scale / factor));
    if (next === scale) return;
    if (at) {
      // Keep the point under the pointer where it is.
      const p = toSvg(at.x, at.y);
      cx = p.x + (cx - p.x) * (next / scale);
      cy = p.y + (cy - p.y) * (next / scale);
    }
    scale = next;
    moved = true;
    apply();
  }

  function panBy(dxPx: number, dyPx: number) {
    cx -= dxPx * scale;
    cy -= dyPx * scale;
    moved = true;
    apply();
  }

  // -- the gestures -----------------------------------------------------------------------------
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // A mouse wheel notch is ~100; a trackpad pinch arrives as small ctrl-wheel steps.
    const k = e.ctrlKey ? 0.01 : 0.0015;
    zoomBy(Math.exp(-e.deltaY * k), { x: e.clientX, y: e.clientY });
  };
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; mx: number; my: number } | null = null;
  const pinchOf = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), mx: (a!.x + b!.x) / 2, my: (a!.y + b!.y) / 2 };
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Captured so a drag that leaves the picture keeps panning; a pointer the browser will not
    // capture (a synthetic one, one already gone) still pans while it is over the picture.
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch = pointers.size === 2 ? pinchOf() : null;
    svg.classList.add('is-panning');
  };
  const onMove = (e: PointerEvent) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    if (pointers.size === 1) {
      panBy(e.clientX - last.x, e.clientY - last.y);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch) {
      const now = pinchOf();
      panBy(now.mx - pinch.mx, now.my - pinch.my);
      if (pinch.dist > 4) zoomBy(now.dist / pinch.dist, { x: now.mx, y: now.my });
      pinch = now;
    }
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = pointers.size === 2 ? pinchOf() : null;
    if (!pointers.size) svg.classList.remove('is-panning');
  };
  const onDouble = () => fit();
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);
  svg.addEventListener('dblclick', onDouble);

  // A resize keeps the centre and the scale; a view nobody has moved stays fitted.
  const observer = new ResizeObserver(() => (moved ? apply() : fit()));
  observer.observe(svg);

  return {
    setContent(box, o = {}) {
      content = box;
      if (o.fit || !moved) fit();
      else apply();
    },
    fit,
    zoomBy,
    zoom: () => fitScale / scale,
    dispose() {
      observer.disconnect();
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onUp);
      svg.removeEventListener('dblclick', onDouble);
    },
  };
}

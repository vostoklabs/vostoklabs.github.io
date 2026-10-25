/*
  The arithmetic under `designCanvas()`, with no DOM, so node can test all of it.

  Two spaces. The model is millimetres with +y up, the way a drawing is measured; the canvas is
  CSS pixels from its top-left corner with +y down, the way a screen is. A `View` maps one to the
  other: `s` pixels to the millimetre, and where the model's origin sits on the canvas.

  Everything on the canvas is a box: a centre, a size and a turn (degrees, anticlockwise), the
  shape a picture, a line of words or a part takes. Its corners and rotate grip, whether a press
  grabs it, and what a drag does to it (move and snap, resize from a corner with the opposite one
  held, turn about its centre, nudge) are decided here; the canvas only draws and listens.
*/

export interface DesignBox {
  /** The centre, mm. */
  cx: number;
  cy: number;
  /** The size along the box's own axes, mm. */
  w: number;
  h: number;
  /** The turn, degrees anticlockwise. */
  rotation: number;
}

/** What a change to a box was made by. */
export type DesignChange = 'move' | 'resize' | 'rotate' | 'nudge';

/** The outline a box draws: the box itself, or the ellipse that fills it. */
export type DesignShape = 'box' | 'circle';

/** A rectangle, in the model (mm) or on the canvas (px). */
export interface DesignBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** How the canvas shows the model. */
export interface View {
  /** Pixels to the millimetre. */
  s: number;
  /** Where the model's origin is on the canvas, px from its top-left corner. */
  ox: number;
  oy: number;
}

export type Pt = [number, number];

const RAD = Math.PI / 180;

/** The step a turn snaps to with Shift held. */
export const SNAP_DEG = 15;
/** An arrow key's nudge, and with Shift. */
export const NUDGE_MM = 0.5;
export const NUDGE_SHIFT_MM = 5;

// ------------------------------------------------------------------------------ the view --

/** A model point on the canvas. */
export function modelToCanvas(view: View, x: number, y: number): Pt {
  return [view.ox + x * view.s, view.oy - y * view.s];
}

/** A canvas point in the model. */
export function canvasToModel(view: View, px: number, py: number): Pt {
  return [(px - view.ox) / view.s, (view.oy - py) / view.s];
}

/** The view that shows `bounds` whole and centred on a `width` x `height` canvas, `padding` px
 *  clear of every edge. A canvas narrower than its padding still shows all of it. */
export function fitView(bounds: DesignBounds, width: number, height: number, padding = 0): View {
  const bw = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const bh = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const aw = width - 2 * padding > 0 ? width - 2 * padding : Math.max(width, 1);
  const ah = height - 2 * padding > 0 ? height - 2 * padding : Math.max(height, 1);
  const s = Math.min(aw / bw, ah / bh);
  return {
    s,
    ox: width / 2 - ((bounds.minX + bounds.maxX) / 2) * s,
    oy: height / 2 + ((bounds.minY + bounds.maxY) / 2) * s,
  };
}

/** The view zoomed by `factor` about a canvas point, which stays where it is. The scale is held
 *  within `minS`..`maxS`. */
export function zoomView(view: View, factor: number, px: number, py: number, minS = 0, maxS = Infinity): View {
  const s = Math.min(maxS, Math.max(minS, view.s * factor));
  const [x, y] = canvasToModel(view, px, py);
  return { s, ox: px - x * s, oy: py + y * s };
}

/** The view on a canvas that changed size: the point at its centre and its scale are kept. */
export function resizeView(view: View, from: { w: number; h: number }, to: { w: number; h: number }): View {
  return { s: view.s, ox: view.ox + (to.w - from.w) / 2, oy: view.oy + (to.h - from.h) / 2 };
}

// ------------------------------------------------------------------------------ a box --

/** A model point in a box's own frame: from its centre, along its own axes. */
export function toLocal(box: DesignBox, x: number, y: number): Pt {
  const r = box.rotation * RAD;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = x - box.cx;
  const dy = y - box.cy;
  return [dx * c + dy * s, dy * c - dx * s];
}

/** A point given in a box's own frame, back in the model. */
export function fromLocal(box: DesignBox, lx: number, ly: number): Pt {
  const r = box.rotation * RAD;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [box.cx + lx * c - ly * s, box.cy + lx * s + ly * c];
}

/** A corner, by its place in `CORNER_SIGNS`. */
export type Corner = 0 | 1 | 2 | 3;

/** Each corner's side of the centre along the box's own axes: bottom-left, bottom-right,
 *  top-right, top-left. The opposite of corner `i` is `(i + 2) % 4`. */
export const CORNER_SIGNS: readonly [Pt, Pt, Pt, Pt] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/** The four corners in the model, in `CORNER_SIGNS` order. */
export function boxCorners(box: DesignBox): [Pt, Pt, Pt, Pt] {
  const at = ([sx, sy]: Pt) => fromLocal(box, (sx * box.w) / 2, (sy * box.h) / 2);
  return [at(CORNER_SIGNS[0]), at(CORNER_SIGNS[1]), at(CORNER_SIGNS[2]), at(CORNER_SIGNS[3])];
}

export interface Handles {
  /** The corners on the canvas, in `CORNER_SIGNS` order. */
  corners: [Pt, Pt, Pt, Pt];
  /** The middle of the top edge, where the grip's stem starts. */
  stem: Pt;
  /** The rotate grip's centre: `stemPx` beyond the top edge, along the box's up. */
  grip: Pt;
}

/** Where a box's handles are on the canvas. The stem is a length in pixels, not millimetres, so
 *  the grip sits the same distance off the edge at any zoom. */
export function handlesOf(view: View, box: DesignBox, stemPx: number): Handles {
  const corners = boxCorners(box).map(([x, y]) => modelToCanvas(view, x, y)) as [Pt, Pt, Pt, Pt];
  const [tx, ty] = fromLocal(box, 0, box.h / 2);
  const stem = modelToCanvas(view, tx, ty);
  // The box's up, on a canvas whose y points down.
  const r = box.rotation * RAD;
  const grip: Pt = [stem[0] - Math.sin(r) * stemPx, stem[1] - Math.cos(r) * stemPx];
  return { corners, stem, grip };
}

// ------------------------------------------------------------------------------ hit tests --

/** Whether a model point is inside the outline `shape` draws round a box. */
export function insideShape(box: DesignBox, x: number, y: number, shape: DesignShape = 'box'): boolean {
  const [lx, ly] = toLocal(box, x, y);
  const a = Math.abs(box.w / 2);
  const b = Math.abs(box.h / 2);
  if (shape === 'circle') return a > 0 && b > 0 && (lx / a) ** 2 + (ly / b) ** 2 <= 1;
  return Math.abs(lx) <= a && Math.abs(ly) <= b;
}

/**
 * How far a model point is from the outline `shape` draws, from inside or out, mm. For an
 * ellipse it is measured along the line from its centre: exact for a circle, and near enough for
 * telling whether a press landed on the line.
 */
export function outlineDistance(box: DesignBox, x: number, y: number, shape: DesignShape = 'box'): number {
  const [lx, ly] = toLocal(box, x, y);
  const a = Math.abs(box.w / 2);
  const b = Math.abs(box.h / 2);
  if (shape === 'circle' && a > 0 && b > 0) {
    const k = Math.hypot(lx / a, ly / b);
    if (k === 0) return Math.min(a, b);
    const r = Math.hypot(lx, ly);
    // `r / k` is the ellipse's own radius in this direction.
    return Math.abs(r - r / k);
  }
  const qx = Math.abs(lx) - a;
  const qy = Math.abs(ly) - b;
  if (qx > 0 || qy > 0) return Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return Math.min(-qx, -qy);
}

/** What a hit test reads off an object. */
export interface Grabbable {
  box: DesignBox;
  grab?: 'inside' | 'border';
  shape?: DesignShape;
  hit?: (x: number, y: number) => boolean;
  z?: number;
}

/**
 * Whether a press at a model point grabs an object. A 'border' object takes only a press within
 * `band` mm of its outline, so a press inside it reaches whatever is under it; any other object
 * takes a press its `hit` accepts, or one inside its outline.
 */
export function grabs(o: Grabbable, x: number, y: number, band: number): boolean {
  const shape = o.shape ?? 'box';
  if (o.grab === 'border') return outlineDistance(o.box, x, y, shape) <= band;
  return o.hit ? o.hit(x, y) : insideShape(o.box, x, y, shape);
}

/** The object a press at a model point grabs: the highest `z`, and of equal `z` the one later in
 *  the list, which is drawn over the others. */
export function hitObject<T extends Grabbable>(objects: readonly T[], x: number, y: number, band: number): T | null {
  let best: T | null = null;
  for (const o of objects) {
    if (best && (o.z ?? 0) < (best.z ?? 0)) continue;
    if (grabs(o, x, y, band)) best = o;
  }
  return best;
}

export type HandleHit = { kind: 'rotate' } | { kind: 'corner'; corner: Corner };

export interface HandleSpec {
  resize: boolean;
  rotate: boolean;
  /** The stem's length, the grip's radius and half a corner handle's side, px. */
  stemPx: number;
  gripPx: number;
  handlePx: number;
  /** How far past each handle a press still takes it, px: more for a finger than a mouse. */
  slopPx: number;
}

/**
 * The handle a press at a canvas point takes, if any: the rotate grip first, then the nearest
 * corner. On a box drawn small a corner reaches at most a third of the box's short side inwards
 * (never less than the handle itself), so a press in its middle still moves it.
 */
export function hitHandle(view: View, box: DesignBox, spec: HandleSpec, px: number, py: number): HandleHit | null {
  const h = handlesOf(view, box, spec.stemPx);
  if (spec.rotate && Math.hypot(px - h.grip[0], py - h.grip[1]) <= spec.gripPx + spec.slopPx) return { kind: 'rotate' };
  if (!spec.resize) return null;
  const short = Math.min(Math.abs(box.w), Math.abs(box.h)) * view.s;
  let reach = Math.min(spec.handlePx + spec.slopPx, Math.max(spec.handlePx, short / 3));
  let hit: HandleHit | null = null;
  for (let i = 0; i < 4; i++) {
    const [x, y] = h.corners[i as Corner];
    const d = Math.hypot(px - x, py - y);
    if (d <= reach) {
      reach = d;
      hit = { kind: 'corner', corner: i as Corner };
    }
  }
  return hit;
}

// ------------------------------------------------------------------------------ what a drag does --

/** A box moved by (dx, dy) mm. */
export function moveBox(box: DesignBox, dx: number, dy: number): DesignBox {
  return { ...box, cx: box.cx + dx, cy: box.cy + dy };
}

/**
 * A box resized by dragging one corner to a model point, with the opposite corner held where it
 * was, in the box's own (turned) frame. `keepAspect` scales width and height together, by how far
 * the pointer has gone along the box's diagonal. No side goes under `min` mm, and a corner dragged
 * past the held one stops at the minimum rather than turning the box inside out.
 */
export function resizeBox(start: DesignBox, corner: Corner, x: number, y: number, keepAspect: boolean, min = 1): DesignBox {
  const [sx, sy] = CORNER_SIGNS[corner];
  const [ax, ay] = fromLocal(start, (-sx * start.w) / 2, (-sy * start.h) / 2);
  const r = start.rotation * RAD;
  const c = Math.cos(r);
  const s = Math.sin(r);
  // The pointer from the held corner, along the box's own axes.
  const lx = (x - ax) * c + (y - ay) * s;
  const ly = (y - ay) * c - (x - ax) * s;
  let w: number;
  let h: number;
  if (keepAspect) {
    const short = Math.min(start.w, start.h);
    if (!(short > 0)) return { ...start };
    const k = Math.max((sx * lx * start.w + sy * ly * start.h) / (start.w ** 2 + start.h ** 2), min / short);
    w = start.w * k;
    h = start.h * k;
  } else {
    w = Math.max(min, sx * lx);
    h = Math.max(min, sy * ly);
  }
  // The new centre: half the new size from the held corner, along the box's own axes.
  const hx = (sx * w) / 2;
  const hy = (sy * h) / 2;
  return { cx: ax + hx * c - hy * s, cy: ay + hx * s + hy * c, w, h, rotation: start.rotation };
}

/** An angle in degrees, brought into (-180, 180]. */
export function normalizeDegrees(deg: number): number {
  let r = deg % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return r === 0 ? 0 : r;
}

/** The turn that points a box's top at a model point: the angle from its centre to the point, less
 *  the quarter turn from the box's x axis up to its grip. `snap` rounds it to 15°. */
export function rotationTowards(box: DesignBox, x: number, y: number, snap: boolean): number {
  const deg = Math.atan2(y - box.cy, x - box.cx) / RAD - 90;
  return normalizeDegrees(snap ? Math.round(deg / SNAP_DEG) * SNAP_DEG : deg);
}

/** Lines a moving centre snaps to, mm. */
export interface DesignGuides {
  x?: number[];
  y?: number[];
}

/** A moving box with its centre pulled onto the nearest guide line within `snapMm`, each axis on
 *  its own, and the lines it took (null on an axis with none near). */
export function snapToGuides(box: DesignBox, guides: DesignGuides, snapMm: number): { box: DesignBox; x: number | null; y: number | null } {
  const nearest = (v: number, lines: readonly number[] = []) => {
    let best: number | null = null;
    for (const g of lines) {
      if (Math.abs(v - g) <= snapMm && (best === null || Math.abs(v - g) < Math.abs(v - best))) best = g;
    }
    return best;
  };
  const x = nearest(box.cx, guides.x);
  const y = nearest(box.cy, guides.y);
  return { box: { ...box, cx: x ?? box.cx, cy: y ?? box.cy }, x, y };
}

/** A box nudged by an arrow key: 0.5 mm, or 5 mm with Shift; up is +y. Null for any other key. */
export function nudgeBox(box: DesignBox, key: string, big: boolean): DesignBox | null {
  const d = big ? NUDGE_SHIFT_MM : NUDGE_MM;
  switch (key) {
    case 'ArrowLeft': return moveBox(box, -d, 0);
    case 'ArrowRight': return moveBox(box, d, 0);
    case 'ArrowUp': return moveBox(box, 0, d);
    case 'ArrowDown': return moveBox(box, 0, -d);
    default: return null;
  }
}

// ------------------------------------------------------------------------------ drawing --

const n = (v: number) => String(Math.round(v * 100) / 100);

/** The SVG path of the outline `shape` draws round a box, in canvas pixels. */
export function outlinePath(view: View, box: DesignBox, shape: DesignShape = 'box'): string {
  if (shape === 'circle') {
    const [cx, cy] = modelToCanvas(view, box.cx, box.cy);
    const rx = Math.abs(box.w / 2) * view.s;
    const ry = Math.abs(box.h / 2) * view.s;
    const r = box.rotation * RAD;
    // The ends of the ellipse's own x axis. On a canvas whose y points down, a turn anticlockwise
    // is a negative angle.
    const ex = Math.cos(r) * rx;
    const ey = -Math.sin(r) * rx;
    const arc = `A${n(rx)} ${n(ry)} ${n(-box.rotation)} 0 1 `;
    return `M${n(cx - ex)} ${n(cy - ey)}${arc}${n(cx + ex)} ${n(cy + ey)}${arc}${n(cx - ex)} ${n(cy - ey)}Z`;
  }
  const pts = boxCorners(box).map(([x, y]) => modelToCanvas(view, x, y));
  return `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`;
}

/** The canvas rectangle round the outline `shape` draws. */
export function canvasBounds(view: View, box: DesignBox, shape: DesignShape = 'box'): DesignBounds {
  if (shape === 'circle') {
    const [cx, cy] = modelToCanvas(view, box.cx, box.cy);
    const a = Math.abs(box.w / 2) * view.s;
    const b = Math.abs(box.h / 2) * view.s;
    const r = box.rotation * RAD;
    const ex = Math.hypot(a * Math.cos(r), b * Math.sin(r));
    const ey = Math.hypot(a * Math.sin(r), b * Math.cos(r));
    return { minX: cx - ex, minY: cy - ey, maxX: cx + ex, maxY: cy + ey };
  }
  const pts = boxCorners(box).map(([x, y]) => modelToCanvas(view, x, y));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * Where the value pill's top-left corner goes: `gap` px right of what it labels, centred on its
 * bottom edge; on the left when the right has no room; never off the canvas.
 */
export function pillPosition(
  around: DesignBounds,
  pill: { w: number; h: number },
  canvas: { w: number; h: number },
  gap = 8,
  margin = 4,
): Pt {
  let x = around.maxX + gap;
  if (x + pill.w > canvas.w - margin) x = around.minX - gap - pill.w;
  x = Math.min(Math.max(x, margin), Math.max(margin, canvas.w - margin - pill.w));
  const y = Math.min(Math.max(around.maxY - pill.h / 2, margin), Math.max(margin, canvas.h - margin - pill.h));
  return [x, y];
}

/** The diagonal resize cursor that fits a corner where it sits on the canvas. */
export function cornerCursor(box: DesignBox, corner: Corner): 'nwse' | 'nesw' {
  const [sx, sy] = CORNER_SIGNS[corner];
  const r = box.rotation * RAD;
  // The corner's direction from the centre, on a canvas whose y points down.
  const dx = sx * box.w * Math.cos(r) - sy * box.h * Math.sin(r);
  const dy = -(sx * box.w * Math.sin(r) + sy * box.h * Math.cos(r));
  return dx * dy > 0 ? 'nwse' : 'nesw';
}

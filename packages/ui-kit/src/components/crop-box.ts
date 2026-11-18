import { el } from '../dom';
import { CROP_GRIPS, FULL_CROP, clampCrop, dragCrop, nudgeCrop, sameCrop, type CropGrip, type CropRect } from './crop-box-math';

export { CROP_GRIPS, FULL_CROP, clampCrop, dragCrop, nudgeCrop, sameCrop, type CropGrip, type CropRect } from './crop-box-math';

/*
  A crop box laid over a picture: the box, the picture outside it dimmed, four corner grips and
  four edge grips to pull, and a press inside the box to move it. Free proportions.

  It fills the positioned box it is put in, which the app places exactly over the picture, so the
  crop is in fractions of the picture (`CropRect`, 0..1, top-left origin) and never in pixels.
  Only the box and its grips take a press; the dimmed part lets every press through, so the app's
  own pan and zoom keep working round it. With `passWhenFull`, a press inside a box that is still
  the whole picture goes through as well.

  `onChange(box, 'live')` while a drag goes on and one `onChange(box, 'end')` on release, so an
  app can redraw cheaply while dragging and do its slow work once. A press that never moved sends
  nothing. Arrow keys move the focused box 1 % of the picture (Shift 5 %); on a focused grip they
  pull that grip. Each key press is one 'end'.

  The grips keep their size when the app zooms the picture with a transform: it sets `--vl-zoom`
  on an ancestor and the grips divide by it. Everything is written through the CSSOM, never a
  style attribute, which a strict `style-src` refuses.
*/

export interface CropBoxOptions {
  /** Accessible name of the box, e.g. "Crop". */
  label: string;
  /** Where the box starts. Default: the whole picture. */
  value?: CropRect | null;
  /** The smallest side, a fraction of the picture. Default 0.08. */
  minFraction?: number;
  /** While the box is the whole picture, leave a press inside it to the app (its own pan), so a
   *  zoomed picture can still be dragged round before it is cropped; the grips still pull.
   *  Default false: the box always takes a press inside it, to move. */
  passWhenFull?: boolean;
  onChange?: (box: CropRect, phase: 'live' | 'end') => void;
}

export interface CropBoxHandle extends HTMLDivElement {
  /** Show this box, without calling onChange. `null` is the whole picture. */
  setValue(box: CropRect | null): void;
  getValue(): CropRect;
}

/** Each grip's accessible name. */
const GRIP_NAMES: Record<Exclude<CropGrip, 'move'>, string> = {
  nw: 'Top left corner',
  n: 'Top edge',
  ne: 'Top right corner',
  e: 'Right edge',
  se: 'Bottom right corner',
  s: 'Bottom edge',
  sw: 'Bottom left corner',
  w: 'Left edge',
};

const KEY_STEP = 0.01;
const KEY_STEP_SHIFT = 0.05;
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const pct = (v: number) => `${+(v * 100).toFixed(4)}%`;

export function cropBox(opts: CropBoxOptions): CropBoxHandle {
  const min = opts.minFraction ?? 0.08;
  let box = clampCrop(opts.value ?? FULL_CROP, 0);

  const shade = (side: 'top' | 'right' | 'bottom' | 'left') =>
    el('div', { className: `vl-crop-box__shade vl-crop-box__shade--${side}`, attrs: { 'aria-hidden': 'true' } });
  const top = shade('top');
  const right = shade('right');
  const bottom = shade('bottom');
  const left = shade('left');
  const frame = el('div', {
    className: 'vl-crop-box__frame',
    attrs: { role: 'group', tabindex: '0', 'aria-label': opts.label, 'data-grip': 'move' },
  });
  const grips = CROP_GRIPS.map((g) =>
    el('div', {
      className: 'vl-crop-box__grip',
      attrs: { role: 'button', tabindex: '0', 'aria-label': GRIP_NAMES[g], 'data-grip': g },
    }),
  );
  frame.append(...grips);
  const root = el('div', { className: 'vl-crop-box' }, [top, right, bottom, left, frame]) as CropBoxHandle;

  /** The box is the whole picture and a press inside it is the app's, not a move. */
  const passes = () => !!opts.passWhenFull && sameCrop(box, FULL_CROP);

  const paint = () => {
    frame.classList.toggle('vl-crop-box__frame--pass', passes());
    top.style.height = pct(box.y);
    bottom.style.top = pct(box.y + box.h);
    for (const side of [left, right]) {
      side.style.top = pct(box.y);
      side.style.height = pct(box.h);
    }
    left.style.width = pct(box.x);
    right.style.left = pct(box.x + box.w);
    frame.style.left = pct(box.x);
    frame.style.top = pct(box.y);
    frame.style.width = pct(box.w);
    frame.style.height = pct(box.h);
  };

  /** Set the box; tell the app when it changed (or always, for the one 'end' of a drag). */
  const commit = (next: CropRect, phase: 'live' | 'end', force = false) => {
    const changed = !sameCrop(next, box);
    box = next;
    if (changed) paint();
    if (changed || force) opts.onChange?.({ ...box }, phase);
  };

  // ---------------------------------------------------------------------- pointer --
  let drag: { pointer: number; grip: CropGrip; start: CropRect; x: number; y: number; moved: boolean } | null = null;

  const press = (grip: CropGrip) => (ev: Event) => {
    const e = ev as PointerEvent;
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // A grip's press reaches the frame too; only a press on the frame itself can pass.
    if (grip === 'move' && e.target === frame && passes()) return;
    e.stopPropagation();
    e.preventDefault();
    drag = { pointer: e.pointerId, grip, start: { ...box }, x: e.clientX, y: e.clientY, moved: false };
    try {
      root.setPointerCapture?.(e.pointerId);
    } catch {
      /* A pointer the browser will not capture still drags while it is over the box. */
    }
  };
  frame.addEventListener('pointerdown', press('move'));
  grips.forEach((g, i) => g.addEventListener('pointerdown', press(CROP_GRIPS[i]!)));

  root.addEventListener('pointermove', (ev) => {
    const e = ev as PointerEvent;
    if (!drag || e.pointerId !== drag.pointer) return;
    const r = root.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return;
    const next = dragCrop(drag.start, drag.grip, (e.clientX - drag.x) / r.width, (e.clientY - drag.y) / r.height, min);
    if (sameCrop(next, box)) return;
    drag.moved = true;
    commit(next, 'live');
  });
  const release = (ev: Event) => {
    const e = ev as PointerEvent;
    if (!drag || e.pointerId !== drag.pointer) return;
    const moved = drag.moved;
    drag = null;
    try {
      root.releasePointerCapture?.(e.pointerId);
    } catch {
      /* already released */
    }
    if (moved) commit(box, 'end', true);
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);

  // --------------------------------------------------------------------- keyboard --
  const keys = (grip: CropGrip) => (ev: Event) => {
    const e = ev as KeyboardEvent;
    const dir = ARROWS[e.key];
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? KEY_STEP_SHIFT : KEY_STEP;
    const next = grip === 'move' ? nudgeCrop(box, dir[0] * step, dir[1] * step) : dragCrop(box, grip, dir[0] * step, dir[1] * step, min);
    if (!sameCrop(next, box)) commit(next, 'end');
  };
  frame.addEventListener('keydown', keys('move'));
  grips.forEach((g, i) => g.addEventListener('keydown', keys(CROP_GRIPS[i]!)));

  root.setValue = (next) => {
    box = clampCrop(next ?? FULL_CROP, 0);
    paint();
  };
  root.getValue = () => ({ ...box });
  paint();
  return root;
}

import { el } from '../dom';
import { ICONS, svgEl } from '../icons';

/* Directional pad: nudge a placed element up/down/left/right, rotate it from
   the top corners, and reset from the dashed center. Ported from the clicker's
   "switch position" pad so every generator that places something reuses it. */

export interface DpadOptions {
  onMove?: (dir: 'up' | 'down' | 'left' | 'right') => void;
  /** Called with the signed delta in degrees (left is positive, like the app). */
  onRotate?: (deltaDeg: number) => void;
  onReset?: () => void;
  /** Degrees per rotate press. Default 3. */
  rotateStep?: number;
  /**
   * Render the two rotate corners. Default `true`.
   *
   * Set `false` for a pad that only translates. Without it those corners render as buttons
   * whose handler is optional-chained to nothing — two controls that look live and do
   * nothing, which is worse than not offering them. The grid uses named areas, so the top
   * corners simply stay empty and `up` remains centred.
   */
  rotate?: boolean;
  /** Initial readout text under the pad. Omit to hide the readout. */
  readout?: string;
  /**
   * Smaller cells, for a pad that shares a row with something else.
   *
   * An option rather than a class the caller adds afterwards: `root` is a wrapper around the
   * grid, so `root.classList.add('vl-dpad--compact')` lands one element too high and silently
   * does nothing — which is exactly what it did until this existed.
   */
  compact?: boolean;
  /**
   * Which glyphs the four directions use. `arrows` (default) is the standalone pad, where an
   * arrow reads as "go this way". `chevrons` is for a pad sitting beside its own readout,
   * where the arrows are a repeated small adjustment rather than a move — lighter ink, and it
   * stops a 30px cell looking like a filled tile. The centre follows: a target reticle for
   * arrows, a plain dot for chevrons.
   */
  glyphs?: 'arrows' | 'chevrons';
}

export interface DpadHandle {
  root: HTMLElement;
  /** Update the readout line (creates it if the pad started without one). */
  setReadout(text: string): void;
}

function padBtn(
  cls: string,
  icon: string,
  label: string,
  onClick: () => void,
  title?: string,
): HTMLButtonElement {
  /* `title` is separate from `label`, and often absent.
   *
   * The accessible name is not automatically worth a hover tooltip. On a pad of five buttons
   * whose arrows say which way they go, five native tooltips fading in over the panel is
   * noise — and one of them was reported as a stray tooltip. Screen readers still get the
   * `aria-label` either way. */
  const btn = el('button', {
    className: `vl-dpad-btn ${cls}`,
    attrs: { type: 'button', 'aria-label': label, ...(title ? { title } : {}) },
  });
  btn.append(svgEl(icon));

  // Hold-to-repeat: fire immediately on press, then repeat after a delay.
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let repeatTimer: ReturnType<typeof setInterval> | null = null;

  const stopRepeat = () => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
  };

  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;           // left button only
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);   // keep events even if pointer drifts
    onClick();
    holdTimer = setTimeout(() => {
      repeatTimer = setInterval(onClick, 50);
    }, 300);
  });
  btn.addEventListener('pointerup', stopRepeat);
  btn.addEventListener('pointercancel', stopRepeat);
  btn.addEventListener('pointerleave', stopRepeat);

  /* Keyboard activation.

     Hold-to-repeat needs `pointerdown`, but a button activated by Enter or Space fires only
     `click` — so a pad driven entirely from pointer events is invisible to the keyboard. The
     control it replaced used a delegated `click` handler and worked; this is what keeps that.

     `detail === 0` is the discriminator: a synthesised click from the keyboard reports zero
     clicks, a real mouse click reports one or more. Without the guard a mouse press would
     fire the action twice — once on pointerdown and again on the click that follows. */
  btn.addEventListener('click', (e) => {
    if (e.detail === 0) onClick();
  });
  // Prevent context menu on long-press (mobile)
  btn.addEventListener('contextmenu', (e) => e.preventDefault());

  return btn;
}

export function dpad(opts: DpadOptions = {}): DpadHandle {
  const step = opts.rotateStep ?? 3;
  const chevrons = opts.glyphs === 'chevrons';
  /* The arrows explain themselves; only the centre needs a word, and only where its glyph is a
   *  dot rather than a reticle. The standalone pad keeps its tooltips. */
  const tip = (label: string) => (chevrons ? undefined : label);
  const GLYPH = chevrons
    ? { up: ICONS.chevronUp, down: ICONS.chevronDown, left: ICONS.chevronLeft, right: ICONS.chevronRight, centre: ICONS.dot }
    : { up: ICONS.arrowUp, down: ICONS.arrowDown, left: ICONS.arrowLeft, right: ICONS.arrowRight, centre: ICONS.target };

  const showRotate = opts.rotate ?? true;

  const grid = el('div', { className: `vl-dpad${opts.compact ? ' vl-dpad--compact' : ''}` }, [
    ...(showRotate
      ? [
          padBtn('vl-dpad-rotl vl-dpad-btn--rot', ICONS.rotateLeft, 'Rotate left', () =>
            opts.onRotate?.(step),
          ),
        ]
      : []),
    padBtn('vl-dpad-up', GLYPH.up, 'Move up', () => opts.onMove?.('up'), tip('Move up')),
    ...(showRotate
      ? [
          padBtn('vl-dpad-rotr vl-dpad-btn--rot', ICONS.rotateRight, 'Rotate right', () =>
            opts.onRotate?.(-step),
          ),
        ]
      : []),
    padBtn('vl-dpad-left', GLYPH.left, 'Move left', () => opts.onMove?.('left'), tip('Move left')),
    padBtn(
      'vl-dpad-center vl-dpad-btn--center',
      GLYPH.centre,
      'Reset to center',
      () => opts.onReset?.(),
      'Back to the middle',
    ),
    padBtn('vl-dpad-right', GLYPH.right, 'Move right', () => opts.onMove?.('right'), tip('Move right')),
    padBtn('vl-dpad-down', GLYPH.down, 'Move down', () => opts.onMove?.('down'), tip('Move down')),
  ]);

  // A named wrapper, not a bare div: it is the flex item wherever a pad sits beside
  // something else, and an unclassed element cannot be told not to shrink.
  const root = el('div', { className: 'vl-dpad-wrap' });
  root.append(grid);

  let readout: HTMLElement | null = null;
  const ensureReadout = () => {
    if (!readout) {
      readout = el('div', { className: 'vl-dpad-readout', attrs: { 'aria-live': 'polite' } });
      root.append(readout);
    }
    return readout;
  };
  if (opts.readout !== undefined) ensureReadout().textContent = opts.readout;

  return {
    root,
    setReadout(text: string) {
      ensureReadout().textContent = text;
    },
  };
}

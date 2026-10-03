// The floating furniture on the 3D stage. Every generator grows the same three
// overlays, always in the same slots — this keeps them there.
//
// Stage slot map (all positioned against `.vl-stage`, which is `position:
// relative`), so new overlays don't collide with the ones already there:
//
//   top-left      `.vl-stage__label`     "Live 3D Preview" — or `stageTools()`, which
//                                        takes the slot over (hide the label then)
//   top-centre    `modeBar()`            what a click on the model does
//   on the model  `stageHandle()`        a grip placed by the viewer, off any slot
//   top-right     the build-plate picker (@vostok/plates)
//   bottom-left   `stageStatus()`        what the generator is doing
//   bottom-centre `.vl-stage__hint` / `stagePanel()` — the panel replaces the
//                 hint while a mode is active; don't show both at once
import { el } from '../dom';
import { svgEl } from '../icons';

// --------------------------------------------------------------- mode bar --

export interface ModeOption<T extends string = string> {
  value: T;
  label: string;
  /** Inline SVG markup. Optional. */
  icon?: string;
}

export interface ModeBarOptions<T extends string = string> {
  modes: ModeOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export interface ModeBar<T extends string = string> {
  root: HTMLElement;
  /** Reflect a mode set elsewhere. Does not fire `onChange`. */
  setValue(value: T): void;
}

/** Top-centre pill that switches what clicking the model does. */
export function modeBar<T extends string = string>(opts: ModeBarOptions<T>): ModeBar<T> {
  const buttons = new Map<T, HTMLButtonElement>();
  const root = el('div', { className: 'vl-mode-bar', attrs: { role: 'group' } });
  const indicator = el('span', { className: 'vl-mode-bar__indicator', attrs: { 'aria-hidden': 'true' } });
  root.append(indicator);

  for (const m of opts.modes) {
    const b = el('button', {
      className: 'vl-mode-btn',
      attrs: { type: 'button', 'data-mode': m.value, 'aria-pressed': 'false' },
      on: { click: () => { setValue(m.value); opts.onChange(m.value); } },
    }) as HTMLButtonElement;
    if (m.icon) b.append(svgEl(m.icon));
    b.append(el('span', { text: m.label }));
    buttons.set(m.value, b);
    root.append(b);
  }

  let current = opts.value;

  /* Move the pill onto the active mode. Measured, because the buttons are label-width.
     Not scheduled on requestAnimationFrame: rAF does not fire in a background tab, and a
     mode bar whose pill sits at the far left until the tab is focused is worse than one
     that simply appears in place. */
  const place = (animate: boolean) => {
    const btn = buttons.get(current);
    if (!btn) return;
    const box = btn.getBoundingClientRect();
    if (box.width === 0) {
      indicator.classList.remove('is-ready');
      return;
    }
    const frame = root.getBoundingClientRect();
    const cs = getComputedStyle(root);
    const x = box.left - frame.left - parseFloat(cs.borderLeftWidth);
    if (!animate) indicator.style.transition = 'none';
    indicator.style.width = `${box.width}px`;
    indicator.style.transform = `translateX(${x}px)`;
    indicator.classList.add('is-ready');
    if (!animate) {
      void indicator.offsetWidth;
      indicator.style.transition = '';
    }
  };

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => place(false)).observe(root);
  }

  function setValue(value: T) {
    current = value;
    for (const [v, b] of buttons) {
      const on = v === value;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    place(true);
  }
  setValue(opts.value);
  place(false);

  return { root, setValue };
}

// ------------------------------------------------------------ stage tools --

/**
 * Top-left: how the preview is shown, floating on the stage.
 *
 * For a mode that keeps its rail to one decision (the clicker's Cut out of 3D model), the
 * view's own switches — together or apart, the switch shown, cut open — are questions about
 * the stage, so they sit on it. Pass the kit's controls: `modeBar().root` for the one choice
 * and a `chip()` per toggle. This only places them; `.vl-stage__tools` gives the chips the mode
 * bar's floating face and an on/off dot. It takes the label's slot, so hide the label.
 */
export function stageTools(nodes: HTMLElement[]): HTMLElement {
  return el('div', { className: 'vl-stage__tools' }, nodes);
}

// ----------------------------------------------------------- stage handle --

export interface StageHandleOptions {
  /** The value it carries, e.g. "29 mm". */
  label: string;
  /** What dragging it does — the tooltip. */
  title: string;
  /** Arrow keys while it has focus: +1 for up or right, -1 for down or left. */
  onStep?: (delta: -1 | 1) => void;
}

export type StageHandle = HTMLButtonElement & {
  setLabel(text: string): void;
  /** Hang it off a point on the stage (px from its top-left corner): its left edge a little
   *  right of the point, centred on it vertically. Null hides it. */
  place(at: { x: number; y: number } | null): void;
};

const HANDLE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5"/></svg>';

/**
 * A vertical grip on the model itself, with its value on it: "29 mm" on a cut line.
 *
 * A sheet through the model with nothing on it does not look like something to grab, so the
 * only visible way to move a cut used to be a number field. This is the thing to grab. It is
 * placed by whoever owns the 3D maths (the viewer projects the point it hangs off, every
 * frame) and dragged by them too — they listen for `pointerdown` on it. Moved by transform
 * through the CSSOM, never a style attribute, which a strict CSP can forbid.
 */
export function stageHandle(opts: StageHandleOptions): StageHandle {
  const text = el('span', { text: opts.label });
  const node = el('button', {
    className: 'vl-stage-handle',
    attrs: { type: 'button', title: opts.title },
  }, [svgEl(HANDLE_ICON), text]) as StageHandle;
  node.hidden = true;
  node.setLabel = (t) => { text.textContent = t; };
  node.place = (at) => {
    node.hidden = !at;
    if (at) node.style.transform = `translate(${Math.round(at.x + 10)}px, ${Math.round(at.y)}px) translateY(-50%)`;
  };
  if (opts.onStep) {
    node.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      opts.onStep!(d);
    });
  }
  return node;
}

// ------------------------------------------------------------ stage panel --

export interface StagePanelOptions {
  title: string;
  /** Body rows — controls, readouts, whatever the mode edits. */
  body?: (Node | string)[];
  /** Small print at the bottom of the panel. */
  hint?: string;
  /** Panels start hidden unless their mode is already active. */
  open?: boolean;
}

export interface StagePanel {
  root: HTMLElement;
  /** The element to append extra rows to. */
  body: HTMLElement;
  setOpen(open: boolean): void;
}

/** Bottom-centre floating panel for whatever the current mode is editing. */
export function stagePanel(opts: StagePanelOptions): StagePanel {
  const body = el('div', { className: 'vl-stage-panel__body' }, opts.body ?? []);
  const root = el('div', { className: 'vl-stage-panel' }, [
    el('p', { className: 'vl-stage-panel__title', text: opts.title }),
    body,
  ]);
  if (opts.hint) root.append(el('p', { className: 'vl-stage-panel__hint', text: opts.hint }));
  root.toggleAttribute('hidden', !opts.open);
  return {
    root,
    body,
    setOpen: (open) => root.toggleAttribute('hidden', !open),
  };
}

export interface StepperOptions {
  /** Text between the two buttons, e.g. "2.4 mm". */
  readout?: string;
  onStep: (delta: -1 | 1) => void;
}

export interface Stepper {
  root: HTMLElement;
  setReadout(text: string): void;
  setEnabled(minus: boolean, plus: boolean): void;
}

/** The centred −/+ pair used inside stage panels. */
export function stepper(opts: StepperOptions): Stepper {
  const minus = el('button', {
    className: 'vl-btn vl-btn--icon', text: '−',
    attrs: { type: 'button', 'aria-label': 'Decrease' },
    on: { click: () => opts.onStep(-1) },
  }) as HTMLButtonElement;
  const plus = el('button', {
    className: 'vl-btn vl-btn--icon', text: '+',
    attrs: { type: 'button', 'aria-label': 'Increase' },
    on: { click: () => opts.onStep(1) },
  }) as HTMLButtonElement;
  const readout = el('span', { className: 'vl-stepper__readout', text: opts.readout ?? '' });
  const root = el('div', { className: 'vl-stepper' }, [minus, readout, plus]);
  return {
    root,
    setReadout: (text) => { readout.textContent = text; },
    setEnabled: (m, p) => { minus.disabled = !m; plus.disabled = !p; },
  };
}

// ----------------------------------------------------------------- status --

export type StatusKind = 'idle' | 'busy' | 'warn' | 'error';

export interface StageStatus {
  root: HTMLElement;
  set(text: string, kind?: StatusKind): void;
}

/** Bottom-left one-liner: what the generator is doing, or warning about. A live region, so a
 *  build error or a warning is read out when it appears, not only when someone goes looking. */
export function stageStatus(initial = ''): StageStatus {
  const root = el('p', {
    className: 'vl-stage-status',
    text: initial,
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  return {
    root,
    set(text, kind = 'idle') {
      root.textContent = text;
      root.className =
        'vl-stage-status' + (kind === 'idle' ? '' : ` vl-stage-status--${kind}`);
    },
  };
}

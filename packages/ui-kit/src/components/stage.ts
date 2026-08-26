// The floating furniture on the 3D stage. Every generator grows the same three
// overlays, always in the same slots — this keeps them there.
//
// Stage slot map (all positioned against `.vl-stage`, which is `position:
// relative`), so new overlays don't collide with the ones already there:
//
//   top-left      `.vl-stage__label`     "Live 3D Preview"
//   top-centre    `modeBar()`            what a click on the model does
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

/** Bottom-left one-liner: what the generator is doing, or warning about. */
export function stageStatus(initial = ''): StageStatus {
  const root = el('p', { className: 'vl-stage-status', text: initial });
  return {
    root,
    set(text, kind = 'idle') {
      root.textContent = text;
      root.className =
        'vl-stage-status' + (kind === 'idle' ? '' : ` vl-stage-status--${kind}`);
    },
  };
}

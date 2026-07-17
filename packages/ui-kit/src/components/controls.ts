import { el } from '../dom';

/* Small parameter controls shared by every generator sidebar: the toggle, the
   labelled slider, the segmented control, the select field, and the "?" help
   tip. Markup mirrors the shipped clicker/keycap apps so a generator can drop
   these in without restyling. */

/* ---------------- Toggle switch ---------------- */

export interface ToggleOptions {
  label: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}

/** A labelled iOS-style switch (green when on). Returns the whole row. */
export function toggleSwitch(opts: ToggleOptions): HTMLElement {
  const input = el('input', { attrs: { type: 'checkbox' } });
  input.checked = opts.checked ?? false;
  input.addEventListener('change', () => opts.onChange?.(input.checked));

  return el('div', { className: 'vl-switch-row' }, [
    el('span', { className: 'vl-switch-label', text: opts.label }),
    el('label', { className: 'vl-toggle' }, [input, el('span', { className: 'vl-knob' })]),
  ]);
}

/* ---------------- Slider row ---------------- */

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  value: number;
  step?: number;
  /** Optional "?" tooltip text next to the label. */
  help?: string;
  /** Fired on every drag/type with the clamped, stepped value. */
  onInput?: (value: number) => void;
  /** Render the value-box text. Default: the number plus an optional unit. */
  format?: (value: number) => string;
  /** Appended to the default value display, e.g. 'mm'. Ignored if format is set. */
  unit?: string;
}

/** Label + editable value box + range, kept in sync both directions. */
export function sliderRow(opts: SliderOptions): HTMLElement {
  const step = opts.step ?? 1;
  const fmt = opts.format ?? ((v: number) => (opts.unit ? `${v} ${opts.unit}` : String(v)));

  const clamp = (v: number) => Math.min(opts.max, Math.max(opts.min, v));
  const snap = (v: number) => {
    const snapped = Math.round((v - opts.min) / step) * step + opts.min;
    // Trim floating-point fuzz from the step maths.
    return Number(clamp(snapped).toFixed(6));
  };

  const range = el('input', {
    attrs: {
      type: 'range',
      min: String(opts.min),
      max: String(opts.max),
      step: String(step),
      value: String(opts.value),
    },
  });

  const valBox = el('input', {
    className: 'vl-val',
    attrs: { type: 'text', inputmode: 'decimal', 'aria-label': opts.label },
  });
  valBox.value = fmt(opts.value);

  let current = opts.value;
  const commit = (v: number, syncRange = true) => {
    current = snap(v);
    if (syncRange) range.value = String(current);
    valBox.value = fmt(current);
    opts.onInput?.(current);
  };

  range.addEventListener('input', () => commit(Number(range.value), false));
  valBox.addEventListener('change', () => {
    const parsed = parseFloat(valBox.value);
    commit(Number.isFinite(parsed) ? parsed : current);
  });

  const labelEl = el('label', { text: opts.label });
  if (opts.help) labelEl.append(helpTip(opts.help));

  return el('div', { className: 'vl-slider-row' }, [
    el('div', { className: 'vl-slider-head' }, [labelEl, valBox]),
    range,
  ]);
}

/* ---------------- Segmented control ---------------- */

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SegmentedOptions<T extends string = string> {
  options: SegmentedOption<T>[];
  value?: T;
  onChange?: (value: T) => void;
  /** Grid columns. Defaults to one per option. */
  columns?: number;
}

/** A segmented (tab-style) picker. Exactly one option is active. */
export function segmentedControl<T extends string = string>(
  opts: SegmentedOptions<T>,
): HTMLElement {
  const cols = opts.columns ?? opts.options.length;
  const root = el('div', {
    className: 'vl-tabs',
    attrs: { role: 'tablist', style: `grid-template-columns: repeat(${cols}, 1fr)` },
  });

  let active = opts.value ?? opts.options[0]?.value;
  const buttons = new Map<T, HTMLButtonElement>();

  for (const opt of opts.options) {
    const btn = el('button', {
      className: `vl-tab${opt.value === active ? ' active' : ''}`,
      text: opt.label,
      attrs: { type: 'button', role: 'tab', 'aria-selected': String(opt.value === active) },
      on: {
        click: () => {
          if (opt.value === active) return;
          active = opt.value;
          for (const [val, b] of buttons) {
            const on = val === active;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', String(on));
          }
          opts.onChange?.(active);
        },
      },
    });
    buttons.set(opt.value, btn);
    root.append(btn);
  }

  return root;
}

/* ---------------- Select field ---------------- */

export interface SelectFieldOptions {
  label: string;
  options: { value: string; label: string }[];
  value?: string;
  onChange?: (value: string) => void;
}

/** Labelled dropdown, styled to match the app's fields. */
export function selectField(opts: SelectFieldOptions): HTMLElement {
  const select = el('select');
  for (const o of opts.options) {
    const option = el('option', { text: o.label, attrs: { value: o.value } });
    if (o.value === opts.value) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => opts.onChange?.(select.value));

  return el('div', { className: 'vl-field' }, [el('label', { text: opts.label }), select]);
}

/* ---------------- Help tip ---------------- */

/** A "?" badge that reveals a bubble on hover/focus. Inline; drop it after a
 *  label. The bubble is fixed-positioned so it escapes narrow sidebars. */
export function helpTip(text: string): HTMLElement {
  const badge = el('button', {
    className: 'vl-help',
    text: '?',
    attrs: { type: 'button', 'aria-label': text },
  });

  let bubble: HTMLElement | null = null;
  const show = () => {
    if (bubble) return;
    bubble = el('div', { className: 'vl-help-bubble', text });
    document.body.append(bubble);
    const r = badge.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    let left = r.left + r.width / 2 - b.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - b.width - 8));
    const top = r.top - b.height - 8;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top < 8 ? r.bottom + 8 : top}px`;
  };
  const hide = () => {
    bubble?.remove();
    bubble = null;
  };

  badge.addEventListener('mouseenter', show);
  badge.addEventListener('mouseleave', hide);
  badge.addEventListener('focus', show);
  badge.addEventListener('blur', hide);
  return badge;
}

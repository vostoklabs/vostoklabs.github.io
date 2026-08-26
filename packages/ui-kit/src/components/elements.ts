import { el } from '../dom';
import { svgEl } from '../icons';
import { helpTip } from './controls';

/* The primitives the kit was missing, as components.

   Styling lives in `elements.css` and is adopted from the Opal suite so both products
   describe the same control the same way. These functions exist for the reason every other
   one in this kit does: a class ladder with no factory behind it is something every call
   site has to remember, and the catalogue has already proved it will not. */

/* ---------------- Chip ---------------- */

export interface ChipOptions {
  label: string;
  /** Renders pressed. A chip is a toggle, not a button. */
  pressed?: boolean;
  disabled?: boolean;
  /** Raw SVG string from `ICONS`, shown before the label. */
  icon?: string;
  className?: string;
  /** Fired with the NEW pressed state. Omit for a static tag. */
  onToggle?: (pressed: boolean) => void;
}

export type ChipHandle = HTMLButtonElement & { setPressed(pressed: boolean): void };

/** A small filter/tag toggle. Reports state through `aria-pressed`, which is also what the
 *  stylesheet keys the filled look off — so the two cannot disagree. */
export function chip(opts: ChipOptions): ChipHandle {
  const node = el('button', {
    className: `vl-chip${opts.className ? ` ${opts.className}` : ''}`,
    attrs: { type: 'button', 'aria-pressed': String(opts.pressed ?? false) },
  }) as ChipHandle;

  if (opts.icon) node.append(svgEl(opts.icon));
  node.append(document.createTextNode(opts.label));
  if (opts.disabled) node.disabled = true;

  node.setPressed = (pressed) => node.setAttribute('aria-pressed', String(pressed));
  if (opts.onToggle) {
    node.addEventListener('click', () => {
      const next = node.getAttribute('aria-pressed') !== 'true';
      node.setPressed(next);
      opts.onToggle!(next);
    });
  }
  return node;
}

/* ---------------- Empty state ---------------- */

export interface EmptyStateOptions {
  title: string;
  /** One sentence on what to do about it. */
  body?: string;
  /** Raw SVG string from `ICONS`. */
  icon?: string;
  /** A call to action — pass a `button()`. */
  action?: HTMLElement;
}

/** The "nothing here yet" panel. Always says what to do next, never just "no results". */
export function emptyState(opts: EmptyStateOptions): HTMLElement {
  const children: (Node | string)[] = [];
  if (opts.icon) {
    const icon = svgEl(opts.icon);
    icon.classList.add('vl-empty__icon');
    children.push(icon);
  }
  children.push(el('h3', { className: 'vl-empty__title', text: opts.title }));
  if (opts.body) children.push(el('p', { className: 'vl-empty__body', text: opts.body }));
  if (opts.action) children.push(opts.action);
  return el('div', { className: 'vl-empty' }, children);
}

/* ---------------- Progress ---------------- */

export interface ProgressOptions {
  /** 0–1. Omit for the indeterminate travelling sliver. */
  value?: number;
  /** Accessible name, e.g. 'Carving keycaps'. */
  label?: string;
}

export type ProgressHandle = HTMLElement & {
  /** 0–1, or `null` to go back to indeterminate. */
  setValue(value: number | null): void;
};

/**
 * A determinate or indeterminate progress bar.
 *
 * Indeterminate is the honest default for work whose length is unknown — a bar parked at a
 * guessed percentage is worse than one that admits it does not know.
 */
export function progressBar(opts: ProgressOptions = {}): ProgressHandle {
  const fill = el('div', { className: 'vl-progress__fill' });
  const root = el('div', {
    className: 'vl-progress',
    attrs: {
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '1',
      ...(opts.label ? { 'aria-label': opts.label } : {}),
    },
  }, [fill]) as unknown as ProgressHandle;

  root.setValue = (value) => {
    if (value === null) {
      root.classList.add('vl-progress--indeterminate');
      fill.style.width = '';
      root.removeAttribute('aria-valuenow');
      return;
    }
    const clamped = Math.max(0, Math.min(1, value));
    root.classList.remove('vl-progress--indeterminate');
    fill.style.width = `${clamped * 100}%`;
    root.setAttribute('aria-valuenow', String(clamped));
  };
  root.setValue(opts.value ?? null);
  return root;
}

/* ---------------- Skeleton ---------------- */

/** A loading placeholder. Give it the size of the thing it stands in for. */
export function skeleton(opts: { width?: string; height?: string; className?: string } = {}): HTMLElement {
  const node = el('div', { className: `vl-skeleton${opts.className ? ` ${opts.className}` : ''}` });
  if (opts.width) node.style.width = opts.width;
  node.style.height = opts.height ?? '1em';
  node.setAttribute('aria-hidden', 'true');
  return node;
}

/* ---------------- Checkbox ---------------- */

export interface CheckboxOptions {
  label: string;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}

export type CheckboxHandle = HTMLElement & {
  setValue(checked: boolean, notify?: boolean): void;
  readonly checked: boolean;
};

/**
 * A checkbox, which is not the same control as `toggleSwitch()`.
 *
 * A switch means "this setting is on now"; a checkbox means "include this when I commit".
 * Generators need both, and picking the wrong one is how a form ends up feeling like it
 * already applied something it has not.
 *
 * Wraps the native input rather than replacing it, so keyboard, form semantics and the
 * platform's own accessibility all still work; the visible box is a sibling span.
 */
export function checkbox(opts: CheckboxOptions): CheckboxHandle {
  const input = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  input.checked = opts.checked ?? false;
  input.disabled = opts.disabled ?? false;
  input.addEventListener('change', () => opts.onChange?.(input.checked));

  const tick = svgEl(
    '<svg class="vl-check__tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  );
  const box = el('span', { className: 'vl-check' }, [tick]);

  const row = el('label', { className: 'vl-check-row' }, [
    input,
    box,
    el('span', { className: 'vl-check-label', text: opts.label }),
  ]) as unknown as CheckboxHandle;

  Object.defineProperty(row, 'checked', { get: () => input.checked });
  row.setValue = (checked, notify = false) => {
    input.checked = checked;
    if (notify) opts.onChange?.(checked);
  };
  return row;
}

/* ---------------- Textarea field ---------------- */

export interface TextareaFieldOptions {
  label: string;
  value?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  onInput?: (value: string) => void;
}

export type TextareaHandle = HTMLElement & {
  setValue(value: string, notify?: boolean): void;
  readonly value: string;
  /** The element itself, for the callers that measure or focus it. */
  readonly field: HTMLTextAreaElement;
};

/** A labelled multi-line field, sharing `.vl-field` with `selectField()`. */
export function textareaField(opts: TextareaFieldOptions): TextareaHandle {
  const area = el('textarea', {
    attrs: {
      rows: String(opts.rows ?? 3),
      ...(opts.placeholder ? { placeholder: opts.placeholder } : {}),
    },
  }) as HTMLTextAreaElement;
  area.value = opts.value ?? '';
  area.disabled = opts.disabled ?? false;
  area.addEventListener('input', () => opts.onInput?.(area.value));

  const label = el('label', { text: opts.label });
  const id = `vl-ta-${Math.round(performance.now() * 1000)}`;
  area.id = id;
  label.setAttribute('for', id);

  const root = el('div', { className: 'vl-field' }, [label, area]) as unknown as TextareaHandle;
  Object.defineProperty(root, 'value', { get: () => area.value });
  Object.defineProperty(root, 'field', { get: () => area });
  root.setValue = (value, notify = false) => {
    area.value = value;
    if (notify) opts.onInput?.(value);
  };
  return root;
}

/* ---------------- List row ---------------- */

export interface ListRowOptions {
  /** The row's main text. Truncates with an ellipsis rather than wrapping. */
  label: string;
  /** Optional image URL for the leading thumbnail. */
  thumb?: string;
  /** Optional trailing detail — a date, a size, a count. */
  meta?: string;
  /** Renders as the current selection (`data-active`). */
  active?: boolean;
  disabled?: boolean;
  /** Layout-only extra classes. */
  className?: string;
  onClick?: () => void;
}

export type ListRowHandle = HTMLButtonElement & { setActive(active: boolean): void };

/**
 * A full-width list row: thumbnail, label, trailing meta.
 *
 * Deliberately not a `button()` variant. A row is left-aligned, square-cornered and lays out
 * flexed children; it is not a step on the emphasis ladder, which is why forcing one into a
 * button always looked wrong — and why four apps grew their own (`mg-project-row`,
 * `nk-project-row`, `mg-fb__row`, `nk-fb__row`) instead of reaching for one.
 *
 * Still a real `<button>`, so keyboard and focus come free. Append extra children to the
 * returned node if a row needs more than these three slots.
 */
export function listRow(opts: ListRowOptions): ListRowHandle {
  const node = el('button', {
    className: `vl-list-row${opts.className ? ` ${opts.className}` : ''}`,
    attrs: { type: 'button' },
  }) as ListRowHandle;

  if (opts.thumb) {
    const img = el('img', { className: 'vl-list-row__thumb', attrs: { src: opts.thumb, alt: '' } });
    node.append(img);
  }
  node.append(el('span', { className: 'vl-list-row__label', text: opts.label }));
  if (opts.meta) node.append(el('span', { className: 'vl-list-row__meta', text: opts.meta }));

  if (opts.active) node.setAttribute('data-active', '');
  if (opts.disabled) node.disabled = true;
  if (opts.onClick) node.addEventListener('click', () => opts.onClick!());

  node.setActive = (active) => {
    if (active) node.setAttribute('data-active', '');
    else node.removeAttribute('data-active');
  };
  return node;
}

/* ---------------- Bare icon button ---------------- */

export interface BareIconButtonOptions {
  /** Raw SVG string from `ICONS`. */
  icon: string;
  /** Required — the button has no text, so this is its whole accessible name. */
  label: string;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
}

/**
 * A quiet, borderless icon button — a close X, a clear-the-field cross, a stepper arrow.
 *
 * Distinct from `iconButton()`, which is a real bordered button on the emphasis ladder. This
 * one is invisible until the cursor reaches it, which is what stops a toolbar of them
 * reading as clutter.
 */
export function bareIconButton(opts: BareIconButtonOptions): HTMLButtonElement {
  const node = el('button', {
    className: `vl-icon-btn${opts.className ? ` ${opts.className}` : ''}`,
    attrs: { type: 'button', 'aria-label': opts.label, title: opts.label },
  });
  node.append(svgEl(opts.icon));
  if (opts.disabled) node.disabled = true;
  if (opts.onClick) node.addEventListener('click', () => opts.onClick!());
  return node;
}

/* ---------------- Text field ---------------- */

export interface TextFieldOptions {
  label: string;
  value?: string;
  placeholder?: string;
  /** `search` renders the platform's clear affordance. Default `text`. */
  type?: 'text' | 'search';
  disabled?: boolean;
  /** Native tooltip / longer explanation. */
  title?: string;
  onInput?: (value: string) => void;
  /** Fired on Enter and on blur, i.e. when the value is meant to be acted on. */
  onCommit?: (value: string) => void;
}

export type TextFieldHandle = HTMLElement & {
  setValue(value: string, notify?: boolean): void;
  readonly value: string;
  /** The input itself, for callers that focus, select or measure it. */
  readonly field: HTMLInputElement;
};

/**
 * A labelled single-line field, sharing `.vl-field` with `selectField()` and
 * `textareaField()`.
 *
 * `onCommit` exists because a text field has two moments: every keystroke, and the point the
 * user means it. Apps that only had `oninput` ended up rebuilding geometry on every letter.
 */
export function textField(opts: TextFieldOptions): TextFieldHandle {
  const input = el('input', {
    attrs: {
      type: opts.type ?? 'text',
      ...(opts.placeholder ? { placeholder: opts.placeholder } : {}),
      ...(opts.title ? { title: opts.title } : {}),
    },
  }) as HTMLInputElement;
  input.value = opts.value ?? '';
  input.disabled = opts.disabled ?? false;

  input.addEventListener('input', () => opts.onInput?.(input.value));
  input.addEventListener('change', () => opts.onCommit?.(input.value));
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      opts.onCommit?.(input.value);
      input.blur();
    }
  });

  const id = `vl-tf-${Math.round(performance.now() * 1000)}`;
  input.id = id;
  const label = el('label', { text: opts.label });
  label.setAttribute('for', id);

  const root = el('div', { className: 'vl-field' }, [label, input]) as unknown as TextFieldHandle;
  Object.defineProperty(root, 'value', { get: () => input.value });
  Object.defineProperty(root, 'field', { get: () => input });
  root.setValue = (value, notify = false) => {
    // Never fight a typist, the same guard sliderRow carries.
    if (document.activeElement === input) return;
    input.value = value;
    if (notify) opts.onInput?.(value);
  };
  return root;
}

/* ---------------- Number field ---------------- */

export interface NumberFieldOptions {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Shown after the input, e.g. 'mm'. Not part of the value. */
  unit?: string;
  disabled?: boolean;
  help?: string;
  /** Fired with the clamped value on every change. */
  onInput?: (value: number) => void;
}

export type NumberFieldHandle = HTMLElement & {
  setValue(value: number, notify?: boolean): void;
  readonly value: number;
  readonly field: HTMLInputElement;
};

/**
 * A labelled numeric field with an optional unit suffix.
 *
 * Distinct from `sliderRow()`: a slider is for a value you explore by feel within a known
 * range, a number field is for one you already know and want to type. The magnet generator
 * grew its own `numberField()` helper for exactly this, which is why it lives here now.
 *
 * Clamping happens on commit rather than on keystroke — clamping mid-type makes "12" briefly
 * become the minimum while you are still reaching for the "0".
 */
export function numberField(opts: NumberFieldOptions): NumberFieldHandle {
  const input = el('input', {
    attrs: {
      type: 'number',
      ...(opts.min !== undefined ? { min: String(opts.min) } : {}),
      ...(opts.max !== undefined ? { max: String(opts.max) } : {}),
      ...(opts.step !== undefined ? { step: String(opts.step) } : {}),
    },
  }) as HTMLInputElement;
  input.value = String(opts.value);
  input.disabled = opts.disabled ?? false;

  const clamp = (n: number) => {
    let v = n;
    if (opts.min !== undefined) v = Math.max(opts.min, v);
    if (opts.max !== undefined) v = Math.min(opts.max, v);
    return v;
  };

  let current = opts.value;
  const commit = () => {
    const parsed = parseFloat(input.value);
    if (!Number.isFinite(parsed)) {
      input.value = String(current); // reject rubbish rather than storing NaN
      return;
    }
    current = clamp(parsed);
    input.value = String(current);
    opts.onInput?.(current);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      commit();
      input.blur();
    }
  });

  const id = `vl-nf-${Math.round(performance.now() * 1000)}`;
  input.id = id;
  const label = el('label', { text: opts.label });
  label.setAttribute('for', id);
  if (opts.help) label.append(helpTip(opts.help));

  const row = el('div', { className: 'vl-number-row' }, [input]);
  if (opts.unit) row.append(el('span', { className: 'vl-number-unit', text: opts.unit }));

  const root = el('div', { className: 'vl-field' }, [label, row]) as unknown as NumberFieldHandle;
  Object.defineProperty(root, 'value', { get: () => current });
  Object.defineProperty(root, 'field', { get: () => input });
  root.setValue = (value, notify = false) => {
    if (document.activeElement === input) return;
    current = clamp(value);
    input.value = String(current);
    if (notify) opts.onInput?.(current);
  };
  return root;
}

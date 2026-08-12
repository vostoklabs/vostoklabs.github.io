/**
 * The two control shapes ui-kit does not ship, built from its own markup conventions.
 *
 * `sliderRow`, `toggleSwitch` and `segmentedControl` cover most of a generator; a sign
 * needs a text field and a long picker list too. These reuse `vl-slider-row` / `vl-val`
 * so they inherit the kit's spacing and focus ring rather than inventing a second look —
 * if these ever earn their place in three generators, they belong upstream in ui-kit.
 */
import { el } from '@vostok/ui-kit';

export interface ValueRow<T> extends HTMLElement {
  setValue(v: T, notify?: boolean): void;
}

/** A single-line text field with a caption. */
export function textRow(opts: {
  label: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  onInput?: (v: string) => void;
}): ValueRow<string> {
  const input = el('input', {
    className: 'vl-val hn-text',
    attrs: {
      type: 'text',
      value: opts.value,
      placeholder: opts.placeholder ?? '',
      maxlength: String(opts.maxLength ?? 64),
      'aria-label': opts.label,
    },
  }) as HTMLInputElement;

  const row = el('div', { className: 'vl-slider-row' }, [
    el('div', { className: 'vl-slider-head' }, [el('label', { text: opts.label }), input]),
  ]) as unknown as ValueRow<string>;

  input.addEventListener('input', () => opts.onInput?.(input.value));

  row.setValue = (v, notify = false) => {
    input.value = v;
    if (notify) opts.onInput?.(v);
  };
  return row;
}

/** A `<select>` with a caption — for lists too long to be a segmented control. */
export function selectRow<T extends string>(opts: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange?: (v: T) => void;
}): ValueRow<T> {
  // `vl-select` on top of `vl-val`: the base is a right-aligned 82px numeric box with the
  // native appearance stripped, which for a `<select>` meant text jammed against the right
  // edge and no chevron at all. The modifier puts both back.
  const select = el('select', {
    className: 'vl-val vl-select hn-select',
    attrs: { 'aria-label': opts.label },
  }) as HTMLSelectElement;

  for (const o of opts.options) {
    const option = el('option', { text: o.label, attrs: { value: o.value } });
    select.append(option);
  }
  select.value = opts.value;

  const row = el('div', { className: 'vl-slider-row' }, [
    el('div', { className: 'vl-slider-head' }, [el('label', { text: opts.label }), select]),
  ]) as unknown as ValueRow<T>;

  select.addEventListener('change', () => opts.onChange?.(select.value as T));

  row.setValue = (v, notify = false) => {
    select.value = v;
    if (notify) opts.onChange?.(v);
  };
  return row;
}

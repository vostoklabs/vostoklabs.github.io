/**
 * `textRow` / `selectRow`: house-number's caption + text-field-or-select rows.
 *
 * These used to hand-build the `<input>`/`<select>` and borrow the kit's `vl-slider-row` /
 * `vl-val` markup to fake a labelled field before the kit shipped one. `@vostok/ui-kit` now
 * has `textField()` and `selectField()` directly, so these are thin adapters onto them —
 * `textRow` adds the `maxLength` this app needs, `selectRow` adds the generic `<T>` value
 * the app's option unions want instead of a bare `string`.
 */
import { textField, selectField, type ValueRow } from '@vostok/ui-kit';

export type { ValueRow };

/** A single-line text field with a caption. */
export function textRow(opts: {
  label: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  onInput?: (v: string) => void;
}): ValueRow<string> {
  const field = textField({
    label: opts.label,
    value: opts.value,
    placeholder: opts.placeholder,
    onInput: opts.onInput,
  });
  field.field.maxLength = opts.maxLength ?? 64;
  return field;
}

/** A `<select>` with a caption — for lists too long to be a segmented control. */
export function selectRow<T extends string>(opts: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange?: (v: T) => void;
}): ValueRow<T> {
  const field = selectField({
    label: opts.label,
    value: opts.value,
    options: opts.options,
    onChange: opts.onChange as ((v: string) => void) | undefined,
  });
  return field as unknown as ValueRow<T>;
}

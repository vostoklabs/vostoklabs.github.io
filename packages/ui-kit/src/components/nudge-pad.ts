import { el } from '../dom';
import { dpad, type DpadHandle } from './dpad';
import { withAccess, type ValueRow } from './controls';

/**
 * A d-pad and the two numbers it drives, side by side.
 *
 * The pad and the fields are one control, not two that happen to sit together. Nudging is a
 * DIRECTION — "a bit to the left" — and the pad is the honest instrument for that; the exact
 * millimetres are what you read back, type into when you know the number, and what a saved
 * project stores. Splitting them across the panel meant pressing an arrow and watching a
 * number change somewhere else.
 *
 * The pad does not replace the fields, it DRIVES them: a press writes the clamped value into
 * the field and fires the field's own `input` event, so everything already listening to the
 * numbers hears a press exactly as it would hear a typed digit. That is the property that
 * lets a paid mode point the same pad at a different object without knowing the pad exists.
 *
 * Ported out of the keycap generator, where it was thirteen hand-written elements and a CSS
 * grid the kit already had a component for.
 */

export interface NudgeAxisOptions {
  /** DOM id for the number input. Apps with existing wiring keep their ids by passing them. */
  id?: string;
  /** Axis letter shown before the field. */
  label: string;
  value?: number;
  /** Symmetric limit: the field clamps to ±max. */
  max?: number;
  step?: number;
}

export interface NudgePadOptions {
  /** Millimetres (or whatever the unit is) per arrow press. Default 0.5. */
  step?: number;
  /** Unit shown after each field. Default 'mm'. */
  unit?: string;
  x: NudgeAxisOptions;
  y: NudgeAxisOptions;
  /** Fires whenever either number changes, from a press, a typed digit or `setValues`. */
  onChange?: (x: number, y: number) => void;
  /**
   * Take the arrow press yourself.
   *
   * Given, the pad does not touch the fields — it hands over the signed delta and the app
   * writes them. That is the shape an app wants when it clamps against limits the pad cannot
   * see (a legend may reach the edge of a 6.25u spacebar but not of a 1u cap), or when a
   * paid mode has the same pad pointed at a different object. Without it the pad and the app
   * both write, and the second write wins by accident.
   */
  onNudge?: (dx: number, dy: number) => void;
  /** The centre button. Defaults to setting both axes to zero. */
  onReset?: () => void;
}

export type NudgePadHandle = ValueRow<{ x: number; y: number }> & {
  /** Move the pad's limits when the thing being nudged changes size. */
  setRange(axis: 'x' | 'y', max: number): void;
  /**
   * Read the same numbers in another unit.
   *
   * The MODEL never changes — `setValue`, `getValue` and `onChange` stay in the unit the pad
   * was built in. Only the two boxes and the word after them do, so an app with a mm | in
   * switch can hand its whole panel over to the customer's unit without every stored number
   * becoming ambiguous. `scale` is display-per-model (1 / 25.4 for millimetres shown as
   * inches) and `decimals` how many places the boxes show; the default is the pad's own
   * unscaled behaviour, so a pad that never calls this is untouched by its existence.
   */
  setUnit(unit: string, scale?: number, decimals?: number): void;
  pad: DpadHandle;
};

const clamp = (v: number, max: number) => Math.min(max, Math.max(-max, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

function axisField(
  axis: NudgeAxisOptions,
  unit: string,
  onInput: () => void,
): { row: HTMLElement; input: HTMLInputElement; unitEl: HTMLElement } {
  const input = el('input', {
    className: 'vl-nudge__num',
    attrs: {
      type: 'number',
      step: String(axis.step ?? 0.1),
      ...(axis.id ? { id: axis.id } : {}),
      ...(axis.max != null ? { min: String(-axis.max), max: String(axis.max) } : {}),
      'aria-label': axis.label,
    },
  }) as HTMLInputElement;
  input.value = String(axis.value ?? 0);
  input.addEventListener('input', onInput);

  const label = el('label', { className: 'vl-nudge__axis', text: axis.label });
  if (axis.id) label.setAttribute('for', axis.id);

  const unitEl = el('span', { className: 'vl-nudge__unit', text: unit });
  return {
    row: el('div', { className: 'vl-nudge__val' }, [label, input, unitEl]),
    input,
    unitEl,
  };
}

export function nudgePad(opts: NudgePadOptions): NudgePadHandle {
  const step = opts.step ?? 0.5;
  const unit = opts.unit ?? 'mm';
  const limits = { x: opts.x.max ?? Infinity, y: opts.y.max ?? Infinity };

  /* Display-per-model, and the places the boxes show. Both are 1 / one-decimal until an app
     calls `setUnit`, which is why a pad that never does behaves exactly as it always has —
     including reading back whatever was typed, unrounded. */
  let scale = 1;
  let places = 1;
  const show = (v: number) => Number(v.toFixed(places));
  /** A scaled box cannot hold the model exactly, so the value read back is quantised to the
   *  0.1 the pad writes anyway; unscaled, the typed number is returned untouched. */
  const model = (display: number) => (scale === 1 ? display : round1(display / scale));

  const emit = () => opts.onChange?.(read().x, read().y);

  const x = axisField(opts.x, unit, emit);
  const y = axisField(opts.y, unit, emit);

  const read = () => ({
    x: model(parseFloat(x.input.value) || 0),
    y: model(parseFloat(y.input.value) || 0),
  });

  /** Write one axis and announce it the way a typed digit would. */
  const write = (axis: 'x' | 'y', value: number) => {
    const input = axis === 'x' ? x.input : y.input;
    input.value = String(show(round1(clamp(value, limits[axis])) * scale));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const pad = dpad({
    rotate: false,
    compact: true,
    glyphs: 'chevrons',
    onMove: (dir) => {
      const dx = dir === 'left' ? -step : dir === 'right' ? step : 0;
      const dy = dir === 'down' ? -step : dir === 'up' ? step : 0;
      if (opts.onNudge) { opts.onNudge(dx, dy); return; }
      if (dx) write('x', read().x + dx);
      if (dy) write('y', read().y + dy);
    },
    onReset: () => {
      if (opts.onReset) { opts.onReset(); return; }
      write('x', 0);
      write('y', 0);
    },
  });

  const root = el('div', { className: 'vl-nudge' }, [
    pad.root,
    el('div', { className: 'vl-nudge__vals' }, [x.row, y.row]),
  ]) as unknown as NudgePadHandle;

  root.setValue = (value, notify) => {
    x.input.value = String(show(round1(clamp(value.x, limits.x)) * scale));
    y.input.value = String(show(round1(clamp(value.y, limits.y)) * scale));
    if (notify) emit();
  };
  root.setRange = (axis, max) => {
    limits[axis] = max;
    const input = axis === 'x' ? x.input : y.input;
    input.min = String(show(-max * scale));
    input.max = String(show(max * scale));
  };
  root.setUnit = (nextUnit, nextScale = 1, decimals = 1) => {
    const current = read();
    scale = nextScale || 1;
    places = decimals;
    for (const f of [x, y]) f.unitEl.textContent = nextUnit;
    for (const axis of ['x', 'y'] as const) {
      const f = axis === 'x' ? x : y;
      const axisStep = (axis === 'x' ? opts.x.step : opts.y.step) ?? 0.1;
      f.input.step = String(+(axisStep * scale).toPrecision(2));
      if (limits[axis] !== Infinity) root.setRange(axis, limits[axis]);
    }
    // Re-render what the boxes already hold, in the new unit. No `emit`: nothing moved.
    root.setValue(current);
  };
  root.pad = pad;
  withAccess(root, read, [x.input, y.input]);
  return root;
}

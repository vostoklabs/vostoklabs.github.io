import { el } from '../dom';
import { ICONS, svgEl } from '../icons';

/* Small parameter controls shared by every generator sidebar: the toggle, the
   labelled slider, the segmented control, the select field, and the "?" help
   tip. Markup mirrors the shipped clicker/keycap apps so a generator can drop
   these in without restyling. */

/* ---------------- Toggle switch ---------------- */

export interface ToggleOptions {
  label: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  /** Optional "?" tooltip shown next to the label. */
  help?: string;
}

/** A control row that Load-project can push a value back into. Still an
 *  HTMLElement, so existing `[toggleSwitch(...)]` usage is unchanged. */
export type ValueRow<T> = HTMLElement & {
  /** Set the displayed value. Does not fire the change handler unless `notify`. */
  setValue(value: T, notify?: boolean): void;
  /** What the control currently shows.
   *
   *  Added because a pair of controls that edit two halves of one value — a width and a
   *  height that go to the store together — needs each to read the other, and reaching into
   *  the row's `<input>` from the app is exactly the class-ladder mistake one level down:
   *  it works until the markup changes and then fails silently. */
  getValue(): T;
  /** Grey the control out and stop it taking input.
   *
   *  A control that has been superseded by another (Size, once the base size is locked) has
   *  to LOOK superseded. Leaving it live is how a slider goes on appearing functional while
   *  changing nothing, which is the bug the lock exists to fix — repeating it in the UI
   *  would be quite the joke. */
  setDisabled(disabled: boolean): void;
};

/** Wire the two accessors above onto a row, given how to read and disable it. */
export function withAccess<T>(
  row: ValueRow<T>,
  read: () => T,
  inputs: (HTMLInputElement | HTMLButtonElement | HTMLSelectElement)[],
): void {
  row.getValue = read;
  row.setDisabled = (disabled: boolean) => {
    row.classList.toggle('vl-control--disabled', disabled);
    row.setAttribute('aria-disabled', String(disabled));
    for (const i of inputs) i.disabled = disabled;
  };
}

/** A labelled iOS-style switch (green when on). Returns the whole row. */
export function toggleSwitch(opts: ToggleOptions): ValueRow<boolean> {
  const input = el('input', { attrs: { type: 'checkbox' } });
  input.checked = opts.checked ?? false;
  input.addEventListener('change', () => opts.onChange?.(input.checked));

  const label = el('span', { className: 'vl-switch-label', text: opts.label });
  if (opts.help) label.append(helpTip(opts.help));

  const row = el('div', { className: 'vl-switch-row' }, [
    label,
    el('label', { className: 'vl-toggle' }, [input, el('span', { className: 'vl-knob' })]),
  ]) as unknown as ValueRow<boolean>;
  row.setValue = (value, notify = false) => {
    input.checked = value;
    if (notify) opts.onChange?.(value);
  };
  withAccess(row, () => input.checked, [input]);
  return row;
}

/* ---------------- Slider ---------------- */

export interface BareSliderOptions {
  min: number;
  max: number;
  value: number;
  step?: number;
  /** Screen-reader name. A bare slider has no visible label of its own. */
  ariaLabel: string;
  /** Extra classes for *placement only* — a flex basis, a grid area. Never a restyle. */
  className?: string;
  /** Fired on every drag with the raw element value. */
  onInput?: (value: number) => void;
}

/** What `slider` returns: the range itself, plus the setter that keeps the fill honest. */
export type SliderHandle = HTMLInputElement & {
  /** Set the position. Always repaints the fill; `notify` re-fires `onInput`. */
  setValue(value: number, notify?: boolean): void;
};

/*
  The range on its own, without the label row around it.

  `sliderRow` is the value-editing shape — caption, editable box, track — and it is the
  right answer nearly everywhere. It is the wrong answer for a *transport*: foldbox's fold
  scrubber sits beside a play button under the stage and has no number to type. That app
  hand-built its own `<input type="range">`, which is how a control ends up styled by
  `accent-color` while every other slider in the product has a track, a thumb and a fill.

  So the track styling now hangs off `.vl-slider` rather than off `.vl-slider-row`'s
  descendants, and both components put that class on the element. One definition, two
  shapes — rather than a second stylesheet ladder nobody will remember.
*/
export function slider(opts: BareSliderOptions): SliderHandle {
  const step = opts.step ?? 1;
  const node = el('input', {
    className: `vl-slider${opts.className ? ` ${opts.className}` : ''}`,
    attrs: {
      type: 'range',
      min: String(opts.min),
      max: String(opts.max),
      step: String(step),
      value: String(opts.value),
      'aria-label': opts.ariaLabel,
    },
  }) as SliderHandle;

  const paint = () => {
    const span = opts.max - opts.min;
    const pct = span > 0 ? ((Number(node.value) - opts.min) / span) * 100 : 0;
    node.style.setProperty('--pct', `${Math.max(0, Math.min(100, pct))}%`);
  };

  node.setValue = (value, notify = false) => {
    node.value = String(value);
    paint();
    if (notify) opts.onInput?.(Number(node.value));
  };

  node.addEventListener('input', () => {
    paint();
    opts.onInput?.(Number(node.value));
  });
  paint();
  return node;
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
  /**
   * Turn what the user typed into the stored value — the inverse of `format`.
   *
   * Needed whenever the two differ: the clicker's smoothing slider stores 0–1 but displays a
   * percentage, so typing "50%" must become 0.5, not 50 clamped to the top of the range.
   * Receives the first number found in the box, and the raw text behind it — because some
   * formats are not one number: foldbox prints an imperial length as `3 1/2"`, and only the
   * raw string still has the fraction in it.
   */
  parse?: (typed: number, raw: string) => number;
}

/** The FIRST number in the box, not every digit in it run together.
 *
 *  `text.replace(/[^0-9.-]/g, '')` was the old reading and it is wrong for any format that
 *  puts a second number on screen. Foldbox writes a sheet as `2 layers · 0.40 mm`, which it
 *  smashed into `20.40`, and an imperial length as `3 1/2"`, which became `312`; both then
 *  clamp to the top of the range, so the box looks like it ignored what was typed. Anything
 *  a format leaves after the number — a unit, a `%`, a parenthetical — is now simply not
 *  part of it. */
function firstNumber(text: string): number {
  const m = /-?\d*\.?\d+/.exec(text);
  return m ? Number(m[0]) : NaN;
}

/**
 * The editable readout that both row shapes hang off: the input, the wrapper that sizes it
 * to its own text, and the writer that keeps the two in step.
 *
 * `size: '1'` is not cosmetic. An <input>'s intrinsic width comes from `size`, and the
 * wrapper is a one-cell grid holding the input and a hidden copy of its text — at the
 * default size of 20 the INPUT would set the grid track and the copy would never matter.
 * See `.vl-val-fit` in components.css for why the width is done in CSS rather than by
 * measuring: a detached element has no computed font to measure from, so measuring is
 * wrong at exactly the moment it matters, the first paint.
 */
function valueField(ariaLabel: string): {
  input: HTMLInputElement;
  fit: HTMLElement;
  show(text: string): void;
} {
  const input = el('input', {
    className: 'vl-val',
    attrs: { type: 'text', inputmode: 'decimal', size: '1', 'aria-label': ariaLabel },
  }) as HTMLInputElement;
  const fit = el('span', { className: 'vl-val-fit' }, [input]);
  // While someone is typing, the box is showing THEIR text rather than ours, so the copy
  // has to follow the keystrokes or a long entry scrolls out of its own field.
  input.addEventListener('input', () => {
    fit.dataset.value = input.value;
  });
  return {
    input,
    fit,
    /** Every assignment to `input.value` goes through here — one that did not would leave
     *  the field the width of the previous reading. */
    show(text) {
      input.value = text;
      fit.dataset.value = text;
    },
  };
}

/** Label + editable value box + range, kept in sync both directions. */
/** A slider whose range and caption can be re-pointed after construction. */
export type SliderRowHandle = ValueRow<number> & {
  /**
   * Re-point the slider at a different range, and optionally rename it.
   *
   * For a control that serves several mutually-exclusive settings: one row whose caption and
   * range follow the current subject, rather than four rows of which three are always
   * meaningless, or a row rebuilt on every change that loses focus with it.
   *
   * **No caller today.** It was written for the clicker's shape directory, whose single
   * "detail" knob was Sides on a polygon and Points on a star; both of those are grips on the
   * shape itself now (`apps/clicker-generator/src/ui/shapeEditor.ts`) and the sliders are gone.
   * Kept because the capability is real and the next generator with mutually-exclusive knobs
   * will want it — but if nothing has claimed it by the time somebody reads this, delete it.
   */
  setBounds(min: number, max: number, label?: string): void;
};

export function sliderRow(opts: SliderOptions): SliderRowHandle {
  const step = opts.step ?? 1;
  const fmt = opts.format ?? ((v: number) => (opts.unit ? `${v} ${opts.unit}` : String(v)));

  // Mutable, because `setBounds` re-points the slider at a different range — see the handle.
  let lo = opts.min;
  let hiBound = opts.max;
  const clamp = (v: number) => Math.min(hiBound, Math.max(lo, v));
  const snap = (v: number) => {
    const snapped = Math.round((v - lo) / step) * step + lo;
    // Trim floating-point fuzz from the step maths.
    return Number(clamp(snapped).toFixed(6));
  };

  // `.vl-slider` is what the track, thumb and fill are styled from — see `slider` above.
  // It used to be `.vl-slider-row input[type='range']`, which meant the styling only
  // existed inside this one row shape.
  const range = el('input', {
    className: 'vl-slider',
    attrs: {
      type: 'range',
      min: String(opts.min),
      max: String(opts.max),
      step: String(step),
      value: String(opts.value),
    },
  });

  const { input: valBox, fit: valFit, show: showValue } = valueField(opts.label);
  showValue(fmt(opts.value));

  let current = opts.value;

  /* The filled portion of the track. The stylesheet paints it from `--pct`; without this
     the track is simply unfilled, which is a fine default rather than a broken one — so a
     hand-built range elsewhere degrades rather than breaking. */
  const paintFill = () => {
    const span = hiBound - lo;
    const pct = span > 0 ? ((current - lo) / span) * 100 : 0;
    range.style.setProperty('--pct', `${Math.max(0, Math.min(100, pct))}%`);
  };

  const commit = (v: number, syncRange = true, notify = true) => {
    current = snap(v);
    if (syncRange) range.value = String(current);
    showValue(fmt(current));
    paintFill();
    if (notify) opts.onInput?.(current);
  };

  range.addEventListener('input', () => commit(Number(range.value), false));
  valBox.addEventListener('change', () => {
    const raw = valBox.value;
    const parsed = firstNumber(raw);
    if (!Number.isFinite(parsed)) return commit(current);
    commit(opts.parse ? opts.parse(parsed, raw) : parsed);
  });

  const labelEl = el('label', { text: opts.label });
  if (opts.help) labelEl.append(helpTip(opts.help));

  const row = el('div', { className: 'vl-slider-row' }, [
    el('div', { className: 'vl-slider-head' }, [labelEl, valFit]),
    range,
  ]) as unknown as ValueRow<number>;
  /*
    A programmatic set must not clobber what someone is currently typing.

    Every app that hand-rolled this guarded it (`if (document.activeElement !== el)`) because
    the sliders are driven from app state on every rebuild: without the guard, a rebuild
    landing mid-keystroke replaces the half-typed number with the old value and the caret
    jumps. `commit()` deliberately keeps writing the box — that path is a drag or a committed
    edit, where the box SHOULD follow.
  */
  row.setValue = (value, notify = false) => {
    const typing = document.activeElement === valBox;
    current = snap(value);
    range.value = String(current);
    if (!typing) showValue(fmt(current));
    paintFill();
    if (notify) opts.onInput?.(current);
  };
  withAccess(row, () => current, [range, valBox]);
  const handle = row as SliderRowHandle;
  handle.setBounds = (min: number, max: number, label?: string) => {
    if (min === lo && max === hiBound && (label === undefined || label === labelEl.firstChild?.textContent)) return;
    lo = min;
    hiBound = max;
    range.min = String(min);
    range.max = String(max);
    if (label !== undefined && labelEl.firstChild) labelEl.firstChild.textContent = label;
    // Re-clamp: the current value may sit outside the new range, and a slider showing a number
    // its own track cannot reach is the "control that does nothing" bug in miniature.
    commit(current, true, false);
  };
  paintFill();
  return handle;
}

/* ---------------- Stepper row ---------------- */

export interface StepperRowOptions {
  label: string;
  min: number;
  max: number;
  value: number;
  /** How much one press moves it. Default 1. */
  step?: number;
  /** Optional "?" tooltip text next to the label. */
  help?: string;
  /** Fired on every press or committed edit, with the clamped, stepped value. */
  onInput?: (value: number) => void;
  /** Render the readout. Default: the number plus an optional unit. */
  format?: (value: number) => string;
  /** Appended to the default readout, e.g. 'mm'. Ignored if format is set. */
  unit?: string;
  /** Turn what the user typed into the stored value. See `SliderOptions.parse`. */
  parse?: (typed: number, raw: string) => number;
  /**
   * Render the pair as left/right arrows instead of −/+, for a value that IS a direction
   * rather than a count — the keychain's fine offset moves a point left or right along an
   * edge, and a −/+ pair asks the user to translate "which way is minus" every time. Same
   * control otherwise: same clamping, same disabled-at-the-ends behaviour, same contract.
   * Aria-labels become "Move left" / "Move right", matching `dpad()`'s own arrow buttons.
   */
  arrows?: 'horizontal';
}

/**
 * Label, then a minus/plus pair around an editable readout.
 *
 * `sliderRow`'s sibling, for a value that is COUNTED rather than swept. A printed sheet is
 * two layers or three; there is no 2.4, and dragging a thumb across a range of eight to
 * move by one is both harder to land and easy to land wrongly. The rule of thumb: if the
 * whole range is small enough to press through, press it.
 *
 * Deliberately the same contract as `sliderRow` — a `ValueRow<number>` with the same
 * `format`, `parse` and `onInput` — so swapping one for the other is a one-word change at
 * the call site, and nothing downstream (a sync pass, Load-project) can tell the
 * difference.
 */
export function stepperRow(opts: StepperRowOptions): ValueRow<number> {
  const step = opts.step ?? 1;
  const fmt = opts.format ?? ((v: number) => (opts.unit ? `${v} ${opts.unit}` : String(v)));

  const clamp = (v: number) => Math.min(opts.max, Math.max(opts.min, v));
  const snap = (v: number) => {
    const snapped = Math.round((v - opts.min) / step) * step + opts.min;
    return Number(clamp(snapped).toFixed(6));
  };

  const { input: valBox, fit: valFit, show: showValue } = valueField(opts.label);
  let current = snap(opts.value);

  const minus = el('button', {
    className: 'vl-btn vl-btn--icon',
    attrs: { type: 'button', 'aria-label': opts.arrows ? 'Move left' : `Decrease ${opts.label}` },
  }) as HTMLButtonElement;
  const plus = el('button', {
    className: 'vl-btn vl-btn--icon',
    attrs: { type: 'button', 'aria-label': opts.arrows ? 'Move right' : `Increase ${opts.label}` },
  }) as HTMLButtonElement;
  if (opts.arrows) {
    minus.append(svgEl(ICONS.arrowLeft));
    plus.append(svgEl(ICONS.arrowRight));
  } else {
    minus.textContent = '−';
    plus.textContent = '+';
  }

  const commit = (v: number, notify = true) => {
    current = snap(v);
    showValue(fmt(current));
    // The ends are shown, not just enforced: a button that still looks pressable and does
    // nothing reads as the control being broken.
    minus.disabled = current <= opts.min + 1e-9;
    plus.disabled = current >= opts.max - 1e-9;
    if (notify) opts.onInput?.(current);
  };

  minus.addEventListener('click', () => commit(current - step));
  plus.addEventListener('click', () => commit(current + step));
  valBox.addEventListener('change', () => {
    const raw = valBox.value;
    const parsed = firstNumber(raw);
    if (!Number.isFinite(parsed)) return commit(current, false);
    commit(opts.parse ? opts.parse(parsed, raw) : parsed);
  });

  const labelEl = el('label', { text: opts.label });
  if (opts.help) labelEl.append(helpTip(opts.help));

  // `.vl-slider-row` for the outer column, because the caption/control rhythm is the same
  // one and a second name for it would drift.
  const row = el('div', { className: 'vl-slider-row' }, [
    el('div', { className: 'vl-slider-head' }, [labelEl]),
    el('div', { className: 'vl-stepper-bar' }, [minus, valFit, plus]),
  ]) as unknown as ValueRow<number>;

  /* The +/- buttons already carry a bounds-driven disabled state, so an outer disable cannot
     simply write `.disabled` as well — the next `setValue` would undo it. It sets a flag both
     paths read instead. */
  let rowDisabled = false;
  const paintBounds = () => {
    minus.disabled = rowDisabled || current <= opts.min + 1e-9;
    plus.disabled = rowDisabled || current >= opts.max - 1e-9;
  };

  row.setValue = (value, notify = false) => {
    // Same guard as `sliderRow`: a rebuild landing mid-keystroke must not replace what is
    // being typed, or the caret jumps and the half-typed number is gone.
    const typing = document.activeElement === valBox;
    current = snap(value);
    if (!typing) showValue(fmt(current));
    paintBounds();
    if (notify) opts.onInput?.(current);
  };
  row.getValue = () => current;
  row.setDisabled = (disabled: boolean) => {
    rowDisabled = disabled;
    row.classList.toggle('vl-control--disabled', disabled);
    row.setAttribute('aria-disabled', String(disabled));
    valBox.disabled = disabled;
    paintBounds();
  };

  commit(current, false);
  return row;
}

/* ---------------- Segmented control ---------------- */

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
  /** Inline SVG markup, shown before the label. Only meaningful with `variant: 'cards'` —
   *  a plain tab row has no room for one (see `min-width: 0` + ellipsis on `.vl-tab`). */
  icon?: string;
}

export interface SegmentedOptions<T extends string = string> {
  options: SegmentedOption<T>[];
  value?: T;
  onChange?: (value: T) => void;
  /** Grid columns. Defaults to one per option. */
  columns?: number;
  /** Optional caption above the tabs. */
  label?: string;
  /** Optional "?" tooltip next to the caption (implies a label row). */
  help?: string;
  /**
   * `'tabs'` (default): a pill row, one option always fills the width evenly. `'cards'`: each
   * option is a left-aligned row with room for an icon, wraps onto a grid (set `columns`) —
   * for a picker like "Image / SVG / Icon / Text / Blocks" where a plain tab would either
   * truncate the labels or hide the icon. When the option count is odd, the last card spans
   * the full row rather than sitting alone under a half-empty one.
   */
  variant?: 'tabs' | 'cards';
}

/** What `segmentedControl` returns: a `ValueRow` plus per-option visibility. */
export type SegmentedRow<T extends string = string> = ValueRow<T> & {
  /**
   * Show or hide one option.
   *
   * Exists because a picker's options are not always all valid: the clicker hides "Outline"
   * in icon mode, because icon line-art makes a broken body. Hiding it in app CSS is not an
   * option — the grid's column count is set from the option count, so a `display: none`
   * child leaves a dead column and the sliding indicator lands on empty space.
   */
  setOptionVisible(value: T, visible: boolean): void;
};

/** A segmented (tab-style) picker. Exactly one option is active.
 *
 *  Returns a `ValueRow` like every other control here, so Load-project can push
 *  a saved value back into it. Widening the return type is backwards compatible:
 *  a `ValueRow` is still an HTMLElement, so existing `[segmentedControl(...)]`
 *  usage is unchanged. */
export function segmentedControl<T extends string = string>(
  opts: SegmentedOptions<T>,
): SegmentedRow<T> {
  const cols = opts.columns ?? opts.options.length;
  // `minmax(0, 1fr)`, not `1fr`. A bare `1fr` is `minmax(auto, 1fr)`, and that `auto` floors
  // every column at its own min-content width — so a four-option control in a 333 px sidebar
  // could not shrink and simply ran off the panel with the last option clipped in half.
  const root = el('div', {
    className: `vl-tabs vl-tabs--indicator${opts.variant === 'cards' ? ' vl-tabs--cards' : ''}`,
    attrs: { role: 'tablist', style: `grid-template-columns: repeat(${cols}, minmax(0, 1fr))` },
  });

  /* One object the eye can track, instead of two things blinking.

     The selected tab used to swap `background` with no transition at all while only the
     label colour moved, so a change read as the old tab going out and a new one coming in.
     A single sliding pill means the selection is one object that moved — which is the
     whole difference between "assembled" and "designed" on a control this visible. */
  const indicator = el('span', { className: 'vl-tabs__indicator', attrs: { 'aria-hidden': 'true' } });
  root.append(indicator);

  let active = opts.value ?? opts.options[0]?.value;
  const buttons = new Map<T, HTMLButtonElement>();

  /**
   * Move the pill onto the active tab.
   *
   * Measured rather than derived, because the grid's column widths depend on the panel
   * width and the label text. Deliberately NOT scheduled on requestAnimationFrame: rAF does
   * not fire while the tab is in the background, which would leave a generator opened in a
   * background tab showing its pill parked at the far left until the tab was focused.
   *
   * `animate: false` is the mount and resize case — the pill must appear where it belongs
   * rather than sliding there from nowhere. Suppressing the transition inline and flushing
   * with a forced reflow is what makes that deterministic in the same task.
   */
  const place = (animate: boolean) => {
    const btn = buttons.get(active as T);
    if (!btn) return;
    const box = btn.getBoundingClientRect();
    /* Zero width means the active tab is not being rendered — the control is still detached,
       sits in a `display: none` panel, or the active option has been hidden by
       `setOptionVisible`. In every case the pill has nothing to point at, so it stands down
       and the active tab paints its own background again (see the `.is-ready ~` rule in
       components.css). Leaving it parked on its last position would point at a gap. */
    if (box.width === 0) {
      indicator.classList.remove('is-ready');
      return;
    }

    const frame = root.getBoundingClientRect();
    const cs = getComputedStyle(root);
    const x = box.left - frame.left - parseFloat(cs.borderLeftWidth);
    const y = box.top - frame.top - parseFloat(cs.borderTopWidth);

    if (!animate) indicator.style.transition = 'none';
    indicator.style.width = `${box.width}px`;
    indicator.style.height = `${box.height}px`;
    indicator.style.transform = `translate(${x}px, ${y}px)`;
    indicator.classList.add('is-ready');
    if (!animate) {
      void indicator.offsetWidth; // flush, so the *next* change still animates
      indicator.style.transition = '';
    }
  };

  /* Fires on first layout as well as on every resize, which is what makes the mount case
     work without a frame callback.

     It is not a guarantee, though: ResizeObserver is delivered as part of the rendering
     steps, so it does not fire at all while the document is not being rendered. That is
     why `.vl-tab.active` keeps painting its own background until the pill reports itself
     `is-ready` — the selection stays visible whether or not this ever runs. */
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => place(false)).observe(root);
  }

  /** Repaint the active tab. Shared by clicks and setValue so the two cannot
   *  drift — a programmatic change has to look identical to a click. */
  const paint = () => {
    for (const [val, b] of buttons) {
      const on = val === active;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
    place(true);
  };

  for (const opt of opts.options) {
    const btn = el('button', {
      className: `vl-tab${opt.value === active ? ' active' : ''}`,
      attrs: { type: 'button', role: 'tab', 'aria-selected': String(opt.value === active) },
      on: {
        click: () => {
          if (opt.value === active) return;
          active = opt.value;
          paint();
          opts.onChange?.(active);
        },
      },
    });
    // Two render paths rather than always building children: `text` (the default `el()` path)
    // trims/collapses nothing extra, so a plain tab with no icon stays byte-identical to before
    // this option existed.
    if (opt.icon) btn.append(svgEl(opt.icon), el('span', { text: opt.label }));
    else btn.textContent = opt.label;
    buttons.set(opt.value, btn);
    root.append(btn);
  }

  // Cheap attempt for the common case of building into a panel that is already laid out.
  // Bails harmlessly when it is not, and the observer picks it up later.
  place(false);

  let outer = root;
  if (opts.label || opts.help) {
    const lab = el('span', { className: 'vl-control-label', text: opts.label ?? '' });
    if (opts.help) lab.append(helpTip(opts.help));
    outer = el('div', { className: 'vl-control' }, [lab, root]);
  }

  const row = outer as unknown as SegmentedRow<T>;
  // An unknown value is ignored rather than clearing the selection: a loaded
  // project can carry an option this build no longer has, and a picker with
  // nothing active is worse than one showing a stale-but-valid choice.
  row.setValue = (value: T, notify = false) => {
    if (!buttons.has(value) || value === active) return;
    active = value;
    paint();
    if (notify) opts.onChange?.(value);
  };
  withAccess(row, () => active, [...buttons.values()]);

  const hidden = new Set<T>();
  row.setOptionVisible = (value: T, visible: boolean) => {
    const btn = buttons.get(value);
    if (!btn) return;
    if (visible) hidden.delete(value);
    else hidden.add(value);
    btn.style.display = visible ? '' : 'none';
    // Re-track the grid to the options that are actually showing, or the row keeps a dead
    // column and the indicator travels to a gap.
    const shown = opts.options.length - hidden.size;
    root.style.gridTemplateColumns = `repeat(${Math.max(1, shown)}, minmax(0, 1fr))`;
    place(false);
  };

  return row;
}

/* ---------------- Select field ---------------- */

export interface SelectFieldOptions {
  label: string;
  options: { value: string; label: string }[];
  value?: string;
  onChange?: (value: string) => void;
  /** Optional "?" tooltip shown next to the label. */
  help?: string;
}

/** Labelled dropdown, styled to match the app's fields. */
export function selectField(opts: SelectFieldOptions): ValueRow<string> {
  const select = el('select');
  for (const o of opts.options) {
    const option = el('option', { text: o.label, attrs: { value: o.value } });
    if (o.value === opts.value) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => opts.onChange?.(select.value));

  const label = el('label', { text: opts.label });
  if (opts.help) label.append(helpTip(opts.help));

  const row = el('div', { className: 'vl-field' }, [label, select]) as unknown as ValueRow<string>;
  // The other three controls in this file have had `setValue` since Load-project
  // needed it; the dropdown was the one that did not, so every generator that has to
  // move a dropdown from code reaches through the DOM for its `<select>` instead —
  // and one that reaches for `.setValue` gets `undefined` and silently does nothing.
  //
  // An unknown value is ignored rather than clearing the selection, matching
  // `segmentedControl`: a loaded project can carry an option this build dropped.
  row.setValue = (value: string, notify = false) => {
    if (!Array.from(select.options).some((o) => o.value === value)) return;
    if (select.value === value) return;
    select.value = value;
    if (notify) opts.onChange?.(value);
  };
  withAccess(row, () => select.value, [select]);
  return row;
}

/** Swap a select field's options after it has been built.
 *
 *  A generator whose styles share one control but not one vocabulary needs this: the
 *  same "hang tab" dropdown offers a slot in the back wall on a carton and a slot in
 *  the lid on a mailer, and an option list that does not follow the style is a menu
 *  entry that describes a panel the box does not have. Rebuilding the field instead
 *  would drop it out of whatever layout is holding it and lose its listeners.
 *
 *  Keeps the current value when it survives the swap, otherwise falls back to `value`
 *  and then to the first option — and fires `onChange` only when the value it lands on
 *  is not the one it had, so a plain relabel is silent. */
export function setFieldOptions(
  field: HTMLElement,
  options: { value: string; label: string }[],
  value?: string,
): void {
  const select = field.querySelector('select');
  if (!select || !options.length) return;
  const want = value ?? select.value;
  const had = select.value;
  select.replaceChildren(
    ...options.map((o) => el('option', { text: o.label, attrs: { value: o.value } })),
  );
  select.value = options.some((o) => o.value === want) ? want : (options[0] as { value: string }).value;
  if (select.value !== had) select.dispatchEvent(new Event('change'));
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
    /* Fade in, once placed. The reflow read is what gives the transition a start value —
       without it the element is created and marked open in the same task and the browser
       computes only the final state, so it would appear at full opacity. Deliberately a
       forced reflow rather than a frame callback, which never fires in a background tab. */
    void bubble.offsetHeight;
    bubble.setAttribute('data-open', '');
  };
  const hide = () => {
    const leaving = bubble;
    bubble = null;
    if (!leaving) return;
    leaving.removeAttribute('data-open');
    /* Let the fade finish before removing it. Timed rather than gated on `transitionend`:
       under reduced motion the duration collapses to ~1ms and a missed event would leave
       the bubble on screen forever. */
    setTimeout(() => leaving.remove(), 200);
  };

  badge.addEventListener('mouseenter', show);
  badge.addEventListener('mouseleave', hide);
  badge.addEventListener('focus', show);
  badge.addEventListener('blur', hide);
  return badge;
}

/* ---------------- Colour swatch & checkbox ---------------- */

export interface ColorSwatchOptions {
  /** `#rrggbb`. */
  value: string;
  /** Accessible name — there is no visible label, so this is the only one. */
  label: string;
  onChange?: (hex: string) => void;
}

/**
 * A bare colour well.
 *
 * `filamentRow()` has one embedded in it, but a caller that wants a single swatch in a dense
 * list had no component and reached for `<input type="color">` — which is what the drift
 * check's budget note means by "the colour wells the kit has no component for yet". Splitting
 * it out means the well is defined once and every list of parts, layers or slots gets the
 * same one.
 */
export function colorSwatch(opts: ColorSwatchOptions): ValueRow<string> {
  const input = el('input', {
    className: 'vl-swatch-well',
    attrs: { type: 'color', value: opts.value, 'aria-label': opts.label, title: opts.label },
  }) as HTMLInputElement;
  input.addEventListener('input', () => opts.onChange?.(input.value));
  const row = input as unknown as ValueRow<string>;
  row.setValue = (v, notify = false) => {
    input.value = v;
    if (notify) opts.onChange?.(v);
  };
  withAccess(row, () => input.value, [input]);
  return row;
}

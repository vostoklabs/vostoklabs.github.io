/**
 * Filament colours, and the swatch row for picking one.
 *
 * A `<input type="color">` is the wrong instrument for this catalogue. These models are
 * printed, not rendered: the user is choosing a spool they own, from a shelf of maybe a
 * dozen, and a 16.7-million-colour wheel asks them to invent a colour that no filament
 * matches. Swatches also survive the round trip — the hex ends up in the 3MF's filament
 * list, and a palette entry is a colour a slicer can actually map to a slot.
 *
 * The list itself already existed three times over — `apps/clicker-generator/src/types.ts`,
 * `apps/magnet-generator/src/types.ts` (commented "same list as the clicker") and
 * bubble-pop's — with no shared copy. This is that list, in the one place the generators
 * agree on. Those three should import it from here and drop their own; until they do, keep
 * the values identical.
 */
import { el } from '../dom';
import { withAccess, type ValueRow } from './controls';
import { colorPopover, type ColorPopoverOption } from './color-popover';

/** Common PLA/PETG shelf colours. Name first, hex second, ordered light-to-dark by family. */
export const FILAMENTS: ReadonlyArray<readonly [string, string]> = [
  ['Black', '#161616'],
  ['White', '#f7f7f5'],
  ['Gray', '#8c8c90'],
  ['Silver', '#cfd0d2'],
  ['Red', '#c8102e'],
  ['Orange', '#ff6a13'],
  ['Yellow', '#f5c518'],
  ['Green', '#00ae42'],
  ['Cyan', '#0086d6'],
  ['Blue', '#0a5cd5'],
  ['Purple', '#8e44ad'],
  ['Pink', '#e6398b'],
  ['Brown', '#7a5230'],
  ['Beige', '#d9c8a9'],
];

const norm = (hex: string) => hex.trim().toLowerCase();

export interface FilamentRowOptions {
  label: string;
  value: string;
  /** Fires on every change, including drags of the custom picker. */
  onChange?: (hex: string) => void;
  /** Extra swatches to offer first, e.g. colours a loaded project brought with it. */
  extra?: ReadonlyArray<readonly [string, string]>;
  /**
   * DOM id for the label element.
   *
   * For an app that renames this row's label at runtime ("Legend" becomes "Legend 1" while a
   * second one exists). Asked for here rather than found afterwards with a `querySelector` on
   * `.vl-swatches__label`: that is a dependency on a kit-internal class name, and nothing —
   * not typecheck, not the drift check — would report it the day the class is renamed.
   */
  labelId?: string;
  help?: string;
}

/**
 * A labelled row of filament swatches, plus a custom-colour escape hatch.
 *
 * The escape hatch is not optional in practice: a saved project or a shared link can carry
 * any hex, and a picker that cannot represent it would open showing nothing selected and
 * silently rewrite the user's colour the moment they touched it. An off-palette value gets
 * its own swatch at the end of the row and stays selected.
 */
export function filamentRow(opts: FilamentRowOptions): ValueRow<string> {
  let value = norm(opts.value);
  /** Set by `setDisabled`, and read by `paint()` — which rebuilds every swatch button, so a
   *  one-shot disable would be undone by the next colour change. */
  let rowDisabled = false;

  const swatches = el('div', { className: 'vl-swatches' });

  /* The custom picker.
   *
   * A LABEL wearing the colour wheel, with the native `<input type="color">` stretched over it
   * at zero opacity — not the input itself. Chromium paints the input's current value into its
   * own `::-webkit-color-swatch` shadow part, which covers any background the element is given,
   * so a bare input can only ever look like one more chip in the shelf's own colour. Wrapped,
   * the wheel shows, the input still opens the OS picker on click, and it stays one control. */
  const customInput = el('input', {
    attrs: { type: 'color', value, 'aria-label': `${opts.label}: custom colour` },
  }) as HTMLInputElement;
  const custom = el('label', {
    className: 'vl-swatch vl-swatch--custom',
    attrs: { title: 'Custom colour' },
  }, [customInput]);

  const label = el('span', {
    className: 'vl-swatches__label',
    text: opts.label,
    ...(opts.labelId ? { attrs: { id: opts.labelId } } : {}),
  });

  /* The picker rides on the label line, not in the shelf grid.
   *
   * In the grid it was a fifteenth item in a row of seven, so it sat alone on a third line
   * under the palette — which is why it used to be hidden unless it held an off-palette value,
   * and that in turn meant an app whose default is a shelf colour offered no way to reach a
   * colour the shelf has not got. Beside the label it costs no row, and next to the name of
   * the thing being coloured it reads as "or pick your own". */
  const head = el('div', { className: 'vl-swatches__head' }, [label, custom]);
  const row = el('div', { className: 'vl-swatch-row' }, [head, swatches]) as unknown as ValueRow<string>;

  function paint() {
    swatches.replaceChildren();
    const list = [...(opts.extra ?? []), ...FILAMENTS];
    const known = new Set(list.map(([, hex]) => norm(hex)));

    for (const [name, hex] of list) {
      const on = norm(hex) === value;
      swatches.append(el('button', {
        className: `vl-swatch${on ? ' is-on' : ''}`,
        attrs: { type: 'button', title: name, 'aria-label': name, 'aria-pressed': String(on), style: `--swatch: ${hex}` },
        on: { click: () => set(hex) },
      }));
    }

    /*
     * The picker is always there, on the label line.
     *
     * It was conditional once — shown only while it held an off-palette value — because a
     * fifteenth chip painted in the already-selected colour read as a duplicate of the
     * selection. That solved the wrong half: it also meant an app whose default is a shelf
     * colour offered no way to reach a colour the shelf does not carry, which is the entire
     * reason the escape hatch exists. It paints a colour wheel rather than the current value,
     * so it reads as "pick your own" instead of a copy of the chip beside it; holding an
     * off-palette value it shows that colour and takes the selection ring.
     */
    customInput.value = value;
    const offPalette = !known.has(value);
    custom.classList.toggle('is-on', offPalette);
    custom.style.setProperty('--swatch', offPalette ? value : 'transparent');

    customInput.disabled = rowDisabled;
    if (rowDisabled) {
      for (const b of swatches.querySelectorAll('button')) (b as HTMLButtonElement).disabled = true;
    }
  }

  function set(hex: string, notify = true) {
    value = norm(hex);
    paint();
    if (notify) opts.onChange?.(value);
  }

  customInput.addEventListener('input', () => set(customInput.value));
  paint();

  row.setValue = (v, notify = false) => set(v, notify);
  /* `ValueRow` gained `getValue` and `setDisabled` as REQUIRED members, and this row reaches
     its type through `as unknown as ValueRow<string>` — a cast, which means the compiler could
     not tell anyone they were missing. Calling either would have thrown "not a function" at
     runtime, in a component ten apps use.

     The swatch buttons are rebuilt by `paint()` on every change, so `setDisabled` cannot just
     flip them once: it records the state and `paint()` re-applies it. */
  withAccess(row, () => value, [customInput]);
  row.setDisabled = (disabled: boolean) => {
    rowDisabled = disabled;
    row.classList.toggle('vl-control--disabled', disabled);
    row.setAttribute('aria-disabled', String(disabled));
    paint();
  };
  return row;
}

export interface ColorChipOptions {
  /** `#rrggbb` — the colour currently shown. */
  hex: string;
  /** Accessible name; the chip carries no visible text, so this is the only label a screen
   *  reader gets. */
  label: string;
  onClick: (e: MouseEvent) => void;
}

export interface ColorChipHandle extends HTMLButtonElement {
  /** Repaint without waiting for the caller to rebuild the row around it. */
  setValue(hex: string): void;
}

/**
 * One colour swatch that opens the CALLER's own picker on click, rather than a shelf of its
 * own the way `filamentRow()`'s `.vl-swatch` grid does.
 *
 * Built for the clicker's palette rows: a full `filamentRow()` per colour repeated all
 * fourteen shelf swatches on every row, which is what made the sidebar read as "cut off" and
 * let a wide custom-colour chip disappear off the edge. A row that shows only the ONE colour
 * currently assigned needs a single swatch, not a shelf — and this chip is deliberately dumb
 * about what clicking it does, so the same picker (a floating popover, a menu, whatever the
 * app already has) can back it everywhere instead of every list re-deriving its own strip.
 */
export function colorChip(opts: ColorChipOptions): ColorChipHandle {
  const btn = el('button', {
    className: 'vl-color-chip',
    attrs: { type: 'button', 'aria-label': opts.label, style: `--swatch: ${opts.hex}` },
    on: { click: (e) => opts.onClick(e as MouseEvent) },
  }) as ColorChipHandle;
  btn.setValue = (hex: string) => {
    btn.style.setProperty('--swatch', hex);
  };
  return btn;
}

/** Relative luminance, for the one question that matters: will these two read apart? */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio between two hexes, 1 (identical) to 21 (black on white).
 *
 * Used to warn rather than to forbid. Two parts in near-identical filament is a legal model
 * and someone may want it, but it is almost always a mistake — and it arrives in the slicer
 * as one visual object even though the export honestly reports two.
 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface PaletteRowOptions {
  label: string;
  /** `#rrggbb` currently assigned. */
  value: string;
  /** Fires on a chip pick and on every step of a custom-wheel drag, so a preview can track. */
  onChange?: (hex: string) => void;
  /** What the picker offers. Defaults to the shared filament shelf. */
  options?: ReadonlyArray<ColorPopoverOption>;
  /** Fires once with a colour the wheel produced, so an app can remember it. */
  onCustom?: (hex: string) => void;
  /** DOM id for the label element, for an app that renames it at runtime. */
  labelId?: string;
}

/**
 * One colour, one line: a name and the chip holding it, which opens the shared picker.
 *
 * The compact counterpart to `filamentRow`'s shelf-of-fourteen, and the shape a settings
 * column actually wants. The shelf costs two rows per colour before the custom chip wraps
 * onto a third, and at a 264px panel its far end is cut off — which is what "the palette
 * feels cut off" and "this big palette item that sometimes just disappears" were about in the
 * clicker. This is one 30px line whatever the shelf holds, and the colours live in a popover
 * that has room for them.
 *
 * Use `filamentRow` where a panel is wide and the whole shelf is worth showing at once; use
 * this in a sidebar, and for any app with more than one or two colours.
 */
export function paletteRow(opts: PaletteRowOptions): ValueRow<string> {
  let value = norm(opts.value);

  const label = el('span', {
    className: 'vl-palette-row__label',
    text: opts.label,
    ...(opts.labelId ? { attrs: { id: opts.labelId } } : {}),
  });

  const chip = colorChip({
    hex: value,
    label: `${opts.label} colour`,
    onClick: (e) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      colorPopover({
        x: r.left,
        y: r.bottom + 6,
        value,
        options: opts.options,
        onSelect: (hex) => set(hex),
        onCustom: opts.onCustom,
      });
    },
  });

  const row = el('div', { className: 'vl-palette-row' }, [label, chip]) as unknown as ValueRow<string>;

  function set(hex: string, notify = true) {
    value = norm(hex);
    chip.setValue(value);
    if (notify) opts.onChange?.(value);
  }

  row.setValue = (v, notify = false) => set(v, notify);
  withAccess(row, () => value, [chip]);
  return row;
}

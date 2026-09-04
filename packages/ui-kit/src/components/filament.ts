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
  const custom = el('input', {
    className: 'vl-swatch vl-swatch--custom',
    attrs: { type: 'color', value, 'aria-label': `${opts.label}: custom colour` },
  }) as HTMLInputElement;

  const label = el('span', { className: 'vl-swatches__label', text: opts.label });
  const row = el('div', { className: 'vl-swatch-row' }, [label, swatches]) as unknown as ValueRow<string>;

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
     * The custom chip appears only when there is an off-palette colour for it to hold.
     *
     * It used to sit at the end of every row unconditionally, and at fifteen chips in a
     * fourteen-column grid that put a lone block on a second row underneath the palette,
     * painted in the colour that was already ringed above it. It reads as a duplicate of the
     * selection, and it was reported as one. The escape hatch still cannot be dropped — a
     * saved project or a shared link can carry any hex, and a picker that could not represent
     * it would open showing nothing selected — so it appears exactly when it is doing that
     * job, holding a value the palette has no chip for.
     */
    custom.value = value;
    const offPalette = !known.has(value);
    custom.classList.toggle('is-on', offPalette);
    if (offPalette) swatches.append(custom);

    custom.disabled = rowDisabled;
    if (rowDisabled) {
      for (const b of swatches.querySelectorAll('button')) (b as HTMLButtonElement).disabled = true;
    }
  }

  function set(hex: string, notify = true) {
    value = norm(hex);
    paint();
    if (notify) opts.onChange?.(value);
  }

  custom.addEventListener('input', () => set(custom.value));
  paint();

  row.setValue = (v, notify = false) => set(v, notify);
  /* `ValueRow` gained `getValue` and `setDisabled` as REQUIRED members, and this row reaches
     its type through `as unknown as ValueRow<string>` — a cast, which means the compiler could
     not tell anyone they were missing. Calling either would have thrown "not a function" at
     runtime, in a component ten apps use.

     The swatch buttons are rebuilt by `paint()` on every change, so `setDisabled` cannot just
     flip them once: it records the state and `paint()` re-applies it. */
  withAccess(row, () => value, [custom]);
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

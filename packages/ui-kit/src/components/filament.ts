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
import type { ValueRow } from './controls';

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

    // The custom chip sits last and shows the current colour, so an off-palette value is
    // visible as a selection rather than as nothing at all.
    custom.value = value;
    custom.classList.toggle('is-on', !known.has(value));
    swatches.append(custom);
  }

  function set(hex: string, notify = true) {
    value = norm(hex);
    paint();
    if (notify) opts.onChange?.(value);
  }

  custom.addEventListener('input', () => set(custom.value));
  paint();

  row.setValue = (v, notify = false) => set(v, notify);
  return row;
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

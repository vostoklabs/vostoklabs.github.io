import {
  SYMBOL_CATEGORIES,
  SYMBOL_SETS,
  listSymbols,
  outlinePath,
  searchSymbols,
  symbolById,
  symbolPath,
  symbolShapes,
  type Shapes,
  type SymbolEntry,
  type SymbolFilter,
  type SymbolSetId,
} from '@vostok/symbols';
import { svgNode } from '../dom';
import { withMyIcons } from './my-icons';
import { openSymbolLibrary, type SymbolLibraryEntry, type SymbolLibraryHandle, type SymbolLibraryOptions } from './symbol-library';

/** For an app that brings an icon in through a flow of its own (an SVG field, not the window's
 *  upload): keep it, or read them, under the same key and by the same rules as `myIcons`. */
export { keepMyIcon, readMyIcons, type MyIcon } from './my-icons';

/*
  THE symbol picker: the symbol library window over every set the shelf has (Material Symbols,
  Tabler Icons, Fluent Emoji), with its categories and its one search, handing back the symbol
  as closed shapes ready to cut, engrave or extrude.

  An app needs nothing else: no list of its own, no tracer, no font. The tile a customer clicks
  is drawn from the same shapes `onPick` receives, so what they pick is what they export. Shapes
  come centred, longest side 1, Y up; scale them to the size the design wants. Keep the `id` in a
  project to name the symbol again later; keep the shapes too if the design must open exactly
  as it was.
*/

export interface SymbolChoice {
  /** `set:name`, e.g. `fluent:cat-face`: what `symbolById` / `symbolShapes` take. A pick from My
   *  icons carries the icon's own id, which only its shapes stand for: keep them. */
  id: string;
  label: string;
  /** `mine` for a pick from My icons. */
  set: SymbolSetId | 'mine';
  /** Islands (an outer ring, then its holes), centred, longest side 1, Y up. */
  shapes: Shapes;
  /** Material only: the icon font's character, for an app that types the symbol into text. */
  char?: string;
}

export interface SymbolChooserOptions extends SymbolFilter {
  /** The library has closed by the time this runs. A rejection is reported as a toast. */
  onPick(choice: SymbolChoice): void | Promise<void>;
  /** The button that opened it: on a wide screen the window opens as a dropdown under it. */
  anchor?: HTMLElement;
  /** Default 'Symbols & icons'. */
  title?: string;
  /** Default 'popular'. */
  initialCategory?: string;
  /** An "Import your own SVG" button beside the search; the app traces the file and does with it
   *  what it does. With `myIcons`, the icon `onFile` resolves to (the traced file: its `label` and
   *  `shapes`, and an `id` if the app names it) is kept under My icons. */
  upload?: {
    label?: string;
    accept?: string;
    onFile(file: File, close: () => void): Promise<{ id?: string; label: string; shapes: Shapes } | null | void>;
  };
  /**
   * "My icons": the icons the customer imported, kept in this browser under `key`
   * (localStorage), newest first, 40 at most. They are a category after Popular and are searched
   * with the rest; a pick from them comes back with `set: 'mine'`. Off by default.
   */
  myIcons?: { key: string };
}

const SOURCE = new Map(SYMBOL_SETS.map((s) => [s.id, s.label]));
const entryOf = (e: SymbolEntry): SymbolLibraryEntry => ({ id: e.id, label: e.label, source: SOURCE.get(e.set) });

/** Path data in the symbol frame, about tile size, in the text colour. */
const drawn = (d: string): SVGSVGElement =>
  svgNode('svg', { viewBox: '-0.55 -0.55 1.1 1.1', 'aria-hidden': 'true', focusable: 'false' }, [svgNode('path', { d, fill: 'currentColor' })]);

/** A symbol's drawing, about tile size, in the text colour: by its id, or from its shapes (a pick
 *  from My icons, which no id in the library names). */
export async function symbolDrawing(symbol: string | Shapes): Promise<SVGSVGElement> {
  return drawn(typeof symbol === 'string' ? await symbolPath(symbol) : outlinePath(symbol));
}

/** Open the symbol picker. */
export function openSymbolChooser(opts: SymbolChooserOptions): SymbolLibraryHandle {
  const filter: SymbolFilter = { sets: opts.sets, solidOnly: opts.solidOnly };
  const library: SymbolLibraryOptions = {
    title: opts.title ?? 'Symbols & icons',
    categories: [...SYMBOL_CATEGORIES],
    initialCategory: opts.initialCategory ?? 'popular',
    list: (category) => listSymbols(category, filter).map(entryOf),
    search: (query) => searchSymbols(query, filter).map(entryOf),
    renderTile: (entry) => symbolDrawing(entry.id),
    onPick: async (entry) => {
      const e = symbolById(entry.id)!;
      await opts.onPick({ id: e.id, label: e.label, set: e.set, shapes: await symbolShapes(e.id), ...(e.char ? { char: e.char } : {}) });
    },
    anchor: opts.anchor,
    upload: opts.upload,
  };
  if (!opts.myIcons) return openSymbolLibrary(library);
  return openSymbolLibrary(
    withMyIcons(library, {
      key: opts.myIcons.key,
      draw: (shapes) => drawn(outlinePath(shapes)),
      onPick: (icon) => opts.onPick({ id: icon.id, label: icon.label, set: 'mine', shapes: icon.shapes }),
    }),
  );
}

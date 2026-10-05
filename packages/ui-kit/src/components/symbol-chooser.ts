import {
  SYMBOL_CATEGORIES,
  SYMBOL_SETS,
  listSymbols,
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
import { openSymbolLibrary, type SymbolLibraryEntry, type SymbolLibraryHandle, type SymbolLibraryOptions } from './symbol-library';

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
  /** `set:name`, e.g. `fluent:cat-face`: what `symbolById` / `symbolShapes` take. */
  id: string;
  label: string;
  set: SymbolSetId;
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
  /** An "Import your own SVG" button beside the search; the app traces the file. */
  upload?: SymbolLibraryOptions['upload'];
}

const SOURCE = new Map(SYMBOL_SETS.map((s) => [s.id, s.label]));
const entryOf = (e: SymbolEntry): SymbolLibraryEntry => ({ id: e.id, label: e.label, source: SOURCE.get(e.set) });

/** A symbol's drawing, about tile size, in the text colour. */
export async function symbolDrawing(id: string): Promise<SVGSVGElement> {
  return svgNode('svg', { viewBox: '-0.55 -0.55 1.1 1.1', 'aria-hidden': 'true', focusable: 'false' }, [
    svgNode('path', { d: await symbolPath(id), fill: 'currentColor' }),
  ]);
}

/** Open the symbol picker. */
export function openSymbolChooser(opts: SymbolChooserOptions): SymbolLibraryHandle {
  const filter: SymbolFilter = { sets: opts.sets, solidOnly: opts.solidOnly };
  return openSymbolLibrary({
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
  });
}

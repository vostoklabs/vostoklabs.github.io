import type { Shapes } from '@vostok/symbols';
import type { SymbolLibraryEntry, SymbolLibraryOptions } from './symbol-library';
import { toast } from './toast';

/*
  "My icons": the icons a customer brought into an app, kept in this browser and offered in the
  symbol window beside the library's own, the way Laser Studio and the clicker each kept theirs.

  The app gives the storage key, so an app that already kept a list under its own key goes on
  reading it. Newest first, at most MY_ICONS_MAX. An entry under the key that is not an icon of
  this shape (another version's, another format's) is not listed, and keeps its place in the list
  until it falls off the end like any other.

  No symbol data and no font here: the symbol chooser weaves this into its window, and a node test
  can hold the rules without loading the library.
*/

/** One icon of the customer's own: islands in the symbol frame, centred, longest side 1, Y up. */
export interface MyIcon {
  id: string;
  label: string;
  shapes: Shapes;
}

export const MY_ICONS_MAX = 40;
/** The category the window lists them under. */
export const MY_ICONS_CATEGORY = { id: 'mine', label: 'My icons' } as const;

/** What an upload hands back to be kept: a name and the shapes, an id if the app names it. */
type Traced = { id?: string; label: string; shapes: Shapes };
const isTraced = (x: unknown): x is Traced =>
  !!x && typeof (x as Traced).label === 'string' && Array.isArray((x as Traced).shapes);
const isIcon = (x: unknown): x is MyIcon => isTraced(x) && typeof x.id === 'string';

/** Everything stored under `key`, as it is. Storage that cannot be read is an empty list. */
function stored(key: string): unknown[] {
  try {
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** The icons under `key`, newest first. */
export function readMyIcons(key: string): MyIcon[] {
  return stored(key).filter(isIcon);
}

/**
 * Keep an icon under `key`, first, as the one it replaces if it has that one's id, and named
 * `mine:…` if it has no id of its own. The list stops at MY_ICONS_MAX. A browser whose storage is
 * full says so; the icon still comes back, so the import it came from still stands.
 */
export function keepMyIcon(key: string, icon: Traced): MyIcon {
  const kept: MyIcon = {
    id: icon.id ?? `mine:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    label: icon.label,
    shapes: icon.shapes,
  };
  const list = [kept, ...stored(key).filter((x) => !isIcon(x) || x.id !== kept.id)].slice(0, MY_ICONS_MAX);
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    toast('Icon added. Browser storage is full, so My icons cannot keep it.', { kind: 'warn' });
  }
  return kept;
}

export interface MyIconsWeave {
  /** The localStorage key the icons live under. */
  key: string;
  /** One icon's tile, from its shapes. */
  draw(shapes: Shapes): Element;
  /** An icon was picked. The window has closed by the time this runs. */
  onPick(icon: MyIcon): void | Promise<void>;
}

/**
 * The symbol window's options with My icons woven in: their category after the first, their
 * names searched ahead of the library's, their tiles and picks answered from the store. An icon
 * an upload resolves to (`{ label, shapes }`, and an `id` if the app names it) is kept; the upload
 * itself runs as it did.
 */
export function withMyIcons(lib: SymbolLibraryOptions, mine: MyIconsWeave): SymbolLibraryOptions {
  /** The icon each listed entry stands for: the window hands the same entry back to draw and pick. */
  const iconOf = new WeakMap<SymbolLibraryEntry, MyIcon>();
  const entries = (): SymbolLibraryEntry[] =>
    readMyIcons(mine.key).map((icon) => {
      const entry = { id: icon.id, label: icon.label, source: MY_ICONS_CATEGORY.label };
      iconOf.set(entry, icon);
      return entry;
    });
  const [first, ...rest] = lib.categories;
  const upload = lib.upload;
  return {
    ...lib,
    categories: first ? [first, MY_ICONS_CATEGORY, ...rest] : [MY_ICONS_CATEGORY],
    list: (category) => (category === MY_ICONS_CATEGORY.id ? entries() : lib.list(category)),
    search: (query) => {
      const q = query.toLowerCase();
      return [...entries().filter((e) => e.label.toLowerCase().includes(q)), ...lib.search(query)];
    },
    renderTile: (entry) => {
      const icon = iconOf.get(entry);
      return icon ? mine.draw(icon.shapes) : lib.renderTile(entry);
    },
    onPick: (entry) => {
      const icon = iconOf.get(entry);
      return icon ? mine.onPick(icon) : lib.onPick(entry);
    },
    upload: upload && {
      ...upload,
      onFile: async (file, close) => {
        const got = await upload.onFile(file, close);
        if (isTraced(got)) keepMyIcon(mine.key, got);
        return got;
      },
    },
  };
}

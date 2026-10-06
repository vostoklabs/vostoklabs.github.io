import type { Shapes } from '@vostok/symbols';
import type { SymbolLibraryEntry, SymbolLibraryOptions } from './symbol-library';
import { toast } from './toast';

/*
  "My icons": the icons a customer brought into an app, kept in this browser and offered in the
  symbol window beside the library's own, the way Laser Studio and the clicker each kept theirs.

  The app gives the storage key, so an app that already kept a list under its own key goes on
  reading it. Newest first, at most MY_ICONS_MAX icons and MY_ICONS_MAX_CHARS characters between
  them: browser storage is small, and every app on the site shares it. An entry under the key that
  is not an icon of this shape (another version's, another format's) is not listed, does not
  count against either limit, and is never dropped: it is kept after the icons.

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
/** The most the icons of one list take as stored, in characters; one icon may take a fifth. */
export const MY_ICONS_MAX_CHARS = 1_000_000;
/** The category the window lists them under. */
export const MY_ICONS_CATEGORY = { id: 'mine', label: 'My icons' } as const;

/** What an upload hands back to be kept: a name and the shapes, an id if the app names it. */
type Traced = { id?: string; label: string; shapes: Shapes };
const isTraced = (x: unknown): x is Traced =>
  !!x && typeof (x as Traced).label === 'string' && Array.isArray((x as Traced).shapes);
const isIcon = (x: unknown): x is MyIcon => isTraced(x) && typeof x.id === 'string' && x.id !== '';

/** What is stored under `key`: null when nothing is, or storage cannot be read. */
function rawOf(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Every entry of a stored list, as it is. A list that cannot be read is an empty one. */
function entriesOf(raw: string | null): unknown[] {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** The icons under `key`, newest first. */
export function readMyIcons(key: string): MyIcon[] {
  return entriesOf(rawOf(key)).filter(isIcon);
}

/** A write refused for want of room, rather than because storage is off. */
const isQuota = (e: unknown) => /quota/i.test(`${(e as Error | null)?.name} ${(e as Error | null)?.message}`);
const BLOCKED = 'This browser does not let the page save anything, so My icons cannot keep it.';

/** Store the list under `key` with `kept` first. Says why not, or null when it is kept. */
function store(key: string, kept: MyIcon): string | null {
  let first: string;
  try {
    first = JSON.stringify(kept);
  } catch {
    return 'My icons cannot keep it.';
  }
  if (first.length > MY_ICONS_MAX_CHARS / 5) return 'It is too detailed for My icons to keep.';
  let storage: Storage;
  let raw: string | null;
  try {
    storage = localStorage;
    raw = storage.getItem(key);
  } catch {
    return BLOCKED; // and nothing is written over a list that could not be read
  }
  const rest = entriesOf(raw);
  const icons = [first, ...rest.filter((x) => isIcon(x) && x.id !== kept.id).map((x) => JSON.stringify(x))].slice(0, MY_ICONS_MAX);
  const foreign = rest.filter((x) => !isIcon(x)).map((x) => JSON.stringify(x));
  // The oldest go first: past the limit in characters, then for as long as the browser has no
  // room. What the kit cannot read is not its to drop.
  let n = icons.length;
  let chars = icons.reduce((sum, s) => sum + s.length, 0);
  while (n > 1 && chars > MY_ICONS_MAX_CHARS) chars -= icons[--n]!.length;
  for (; n > 0; n--) {
    try {
      storage.setItem(key, `[${[...icons.slice(0, n), ...foreign].join(',')}]`);
      return null;
    } catch (e) {
      if (!isQuota(e)) return BLOCKED;
    }
  }
  return 'Browser storage is full, so My icons cannot keep it.';
}

/**
 * Keep an icon under `key`, first, as the one it replaces if it has that one's id, and named
 * `mine:…` if it has no id of its own (an id must be a string with something in it). Its shapes
 * are in the symbol frame, as `MyIcon`'s are. The oldest icons go when the list passes
 * MY_ICONS_MAX or MY_ICONS_MAX_CHARS, or the browser has no room left. An icon that cannot be
 * kept still comes back, so the import it came from still stands, and a toast says why.
 */
export function keepMyIcon(key: string, icon: Traced): MyIcon {
  const kept: MyIcon = {
    id: typeof icon.id === 'string' && icon.id !== '' ? icon.id : `mine:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    label: icon.label,
    shapes: icon.shapes,
  };
  const refused = store(key, kept);
  if (refused) toast(`Icon added. ${refused}`, { kind: 'warn' });
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
  /** The entries, made again only when what is stored has changed: a search asks on every key. */
  let made: { raw: string | null; entries: SymbolLibraryEntry[] } | null = null;
  const entries = (): SymbolLibraryEntry[] => {
    const raw = rawOf(mine.key);
    if (!made || made.raw !== raw) {
      made = {
        raw,
        entries: entriesOf(raw)
          .filter(isIcon)
          .map((icon) => {
            const entry = { id: icon.id, label: icon.label, source: MY_ICONS_CATEGORY.label };
            iconOf.set(entry, icon);
            return entry;
          }),
      };
    }
    return made.entries;
  };
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

/** A pick from My icons, as the symbol chooser hands it to the app: a symbol of the set `mine`. */
export interface MyIconChoice {
  id: string;
  label: string;
  set: 'mine';
  shapes: Shapes;
}

/**
 * The symbol chooser's window: with My icons in it when the app asked for them (`myIcons`), and
 * as given when it did not. A pick from them reaches `onPick` as a symbol of the set `mine`: the
 * icon's id, name and shapes, and nothing else it was kept with. The tiles are `draw`'s.
 */
export function chooserWithMyIcons(
  lib: SymbolLibraryOptions,
  myIcons: { key: string } | undefined,
  draw: (shapes: Shapes) => Element,
  onPick: (choice: MyIconChoice) => void | Promise<void>,
): SymbolLibraryOptions {
  if (!myIcons) return lib;
  return withMyIcons(lib, {
    key: myIcons.key,
    draw,
    onPick: (icon) => onPick({ id: icon.id, label: icon.label, set: 'mine', shapes: icon.shapes }),
  });
}

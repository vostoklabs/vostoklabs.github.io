// The symbols a clicker can carry, and the Symbols & icons library that offers them.
//
// The same library Laser Studio has (the kit's `openSymbolLibrary`, its catalog of filled
// emoji and icons, the shared Material Symbols set, and "My icons" for SVGs you bring), traced
// with this app's own tracer into rings — centred, longest side 1, Y-up, the frame `parseSvg`
// hands back — which is what a keycap legend or a line of text is built from.
import {
  POPULAR_SYMBOL_IDS,
  SYMBOL_CATALOG,
  flattenSvgStyles,
  openSymbolLibrary,
  toast,
  type SymbolLibraryEntry,
} from '@vostok/ui-kit';
import { FALLBACK_FONT_ID, ICONS, POPULAR, SYMBOL_GROUPS, getFont, pathCommandsToPolygons, searchGroup } from '@vostok/fonts';
import { parseSvg } from '@vostok/trace';
import { buildSvg, LUCIDE_ICONS } from '../image/lucideIcons';
import { normaliseRings } from '../image/symbolRings';
import type { Ring } from '../types';

/** A symbol ready to place: what it is called, where it came from, and its outline. */
export interface TracedSymbol {
  id: string;
  label: string;
  source: string;
  rings: Ring[];
}

const MINE_KEY = 'clicker-my-symbols';
const MINE_MAX = 40;

function mine(): TracedSymbol[] {
  try {
    const list = JSON.parse(localStorage.getItem(MINE_KEY) || '[]');
    return Array.isArray(list) ? list.filter((s) => s && typeof s.id === 'string' && Array.isArray(s.rings)) : [];
  } catch {
    return [];
  }
}

function remember(sym: TracedSymbol): void {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify([sym, ...mine().filter((s) => s.id !== sym.id)].slice(0, MINE_MAX)));
  } catch {
    toast('Symbol added. Browser storage is full, so My icons cannot keep it.', { kind: 'warn' });
  }
}

/** An SVG's filled outline, as one symbol. Throws a plain sentence when there is nothing in it. */
export function traceSvgSymbol(svgText: string): Ring[] {
  const flat = flattenSvgStyles(svgText.replace(/currentColor/gi, '#000000'));
  const rings = normaliseRings(parseSvg(flat, { removeBg: false, asPainted: true }).outline);
  if (!rings.length) throw new Error('There is nothing to print in that SVG.');
  return rings;
}

const traced = new Map<string, Promise<TracedSymbol>>();

/** The outline of a Material Symbols glyph, from the shared symbol font. */
async function materialRings(char: string): Promise<Ring[]> {
  const font = await getFont(FALLBACK_FONT_ID);
  const glyph = font.charToGlyph(char);
  return normaliseRings((pathCommandsToPolygons(glyph.getPath(0, 0, 100).commands) as Ring[]).filter((r) => r.length >= 3));
}

/** One library entry, traced once and remembered. */
export function traceEntry(entry: SymbolLibraryEntry): Promise<TracedSymbol> {
  const hit = traced.get(entry.id);
  if (hit) return hit;
  const work = (async (): Promise<TracedSymbol> => {
    const own = mine().find((s) => s.id === entry.id);
    if (own) return own;
    const item = SYMBOL_CATALOG.find((c) => c.id === entry.id);
    if (item) return { id: item.id, label: item.label, source: item.source, rings: traceSvgSymbol(item.svg) };
    const icon = ICONS.find((i) => i.id === entry.id);
    if (icon) return { id: icon.id, label: icon.label, source: 'Material Symbols', rings: await materialRings(icon.char) };
    throw new Error(`Unknown symbol ${entry.id}`);
  })();
  traced.set(entry.id, work);
  work.catch(() => traced.delete(entry.id));
  return work;
}

/** A symbol's outline as a small SVG drawing in the current text colour: a library tile, a
 *  token in a text field, a key on the key map. A new element every call. */
export function ringsSvg(rings: Ring[], size = 24): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-0.55 -0.55 1.1 1.1');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  // Rings are Y-up; SVG is Y-down.
  path.setAttribute('d', rings.map((r) => 'M' + r.map(([x, y]) => `${x.toFixed(4)} ${(-y).toFixed(4)}`).join('L') + 'Z').join(''));
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'nonzero');
  svg.append(path);
  return svg;
}

/** A Lucide icon (the Arrows preset's, and blocks saved before the library) as an image. */
export function lucideImg(name: string): HTMLImageElement | null {
  const info = LUCIDE_ICONS.find((ic) => ic.name === name);
  if (!info) return null;
  const img = document.createElement('img');
  img.src = `data:image/svg+xml;utf8,${encodeURIComponent(buildSvg(info.node))}`;
  img.alt = '';
  img.width = 22;
  img.height = 22;
  return img;
}

const CATEGORIES = [
  { id: 'popular', label: 'Popular' },
  { id: 'smileys', label: 'Smileys' },
  { id: 'pictorial', label: 'Animals & things' },
  { id: 'solid', label: 'Solid icons' },
  { id: 'mine', label: 'My icons' },
  { id: 'all', label: 'All symbols' },
  ...SYMBOL_GROUPS.filter((g) => !['popular', 'smileys', 'all'].includes(g.id)).map((g) => ({ id: g.id, label: g.label })),
];

const entryOf = (x: { id: string; label: string }, source: string): SymbolLibraryEntry => ({ id: x.id, label: x.label, source });

function listFor(category: string): SymbolLibraryEntry[] {
  const catalog = (pred: (c: (typeof SYMBOL_CATALOG)[number]) => boolean) =>
    SYMBOL_CATALOG.filter(pred).map((c) => entryOf(c, c.source));
  switch (category) {
    case 'popular':
      return [
        ...POPULAR_SYMBOL_IDS.map((id) => SYMBOL_CATALOG.find((c) => c.id === id)).filter((c): c is (typeof SYMBOL_CATALOG)[number] => !!c).map((c) => entryOf(c, c.source)),
        ...POPULAR.slice(0, 24).map((i) => entryOf(i, 'Material Symbols')),
      ];
    case 'smileys':
      return catalog((c) => c.category === 'Smileys');
    case 'pictorial':
      return catalog((c) => c.category === 'Pictorial');
    case 'solid':
      return catalog((c) => c.source === 'Tabler Filled');
    case 'mine':
      return mine().map((s) => entryOf(s, s.source));
    case 'all':
      return [...catalog(() => true), ...ICONS.map((i) => entryOf(i, 'Material Symbols'))];
    default:
      return searchGroup('', category).map((i) => entryOf(i, 'Material Symbols'));
  }
}

function search(query: string): SymbolLibraryEntry[] {
  const q = query.toLowerCase();
  const own = [...SYMBOL_CATALOG.map((c) => entryOf(c, c.source)), ...mine().map((s) => entryOf(s, s.source))]
    .filter((e) => `${e.label} ${e.id} ${e.source}`.toLowerCase().includes(q));
  return [...own, ...searchGroup(query, 'all').map((i) => entryOf(i, 'Material Symbols'))];
}

/**
 * Open the Symbols & icons library under `anchor` and hand back the traced pick. An SVG of your
 * own is traced, kept under My icons, and picked.
 */
export function pickSymbol(anchor: HTMLElement, onPick: (sym: TracedSymbol) => void): void {
  openSymbolLibrary({
    title: 'Symbols & icons',
    categories: CATEGORIES,
    initialCategory: 'popular',
    list: listFor,
    search,
    anchor,
    renderTile: async (entry) => ringsSvg((await traceEntry(entry)).rings, 32),
    onPick: async (entry) => onPick(await traceEntry(entry)),
    upload: {
      label: 'Import your own SVG',
      accept: '.svg,image/svg+xml',
      onFile: async (file) => {
        if (file.size > 2_000_000) throw new Error('Choose an SVG smaller than 2 MB.');
        const rings = traceSvgSymbol(await file.text());
        const sym: TracedSymbol = { id: `mine-${Date.now().toString(36)}`, label: file.name.replace(/\.svg$/i, ''), source: 'My icons', rings };
        remember(sym);
        onPick(sym);
      },
    },
  });
}

import { symbolById, type SymbolSetId } from './library';
import { decodeOutline, outlinePath, scaleShapes, type Shapes } from './outline';

/*
  A symbol as shapes: one call for every set, the same shapes for the tile a customer picks from
  and for the file they export.

  Every set is stored as outlines that keep the islands contract (contract.ts), loaded the first
  time one of its symbols is asked for: they are most of the library's weight, and most pages
  never draw one. Material's are made from the icon font @vostok/fonts serves for text, each
  glyph filled the way the font fills it; read from the font as it stands, a glyph handed out
  overlapping contours and contours doubled against each other.
*/

const OUTLINES: Record<SymbolSetId, () => Promise<Record<string, string>>> = {
  material: () => import('../data/material-symbols-rounded.outlines.json').then((m) => m.default.outlines as Record<string, string>),
  tabler: () => import('../data/tabler-icons-filled.outlines.json').then((m) => m.default.outlines as Record<string, string>),
  fluent: () => import('../data/fluent-emoji-high-contrast.outlines.json').then((m) => m.default.outlines as Record<string, string>),
};

const loaded = new Map<string, Promise<Record<string, string>>>();
const cache = new Map<string, Promise<Shapes>>();

/** The symbol in its own frame: centred, longest side 1, Y up. Rejects for an unknown id. */
function unitShapes(id: string): Promise<Shapes> {
  const entry = symbolById(id);
  if (!entry) return Promise.reject(new Error(`Unknown symbol ${id}`));
  let work = cache.get(entry.id);
  if (!work) {
    const set = entry.set;
    let data = loaded.get(set);
    if (!data) {
      const load = OUTLINES[set]();
      loaded.set(set, (data = load));
      // A chunk that failed to load (a dropped connection) is fetched again by the next symbol
      // asked for; kept, it would fail every symbol of its set until the page reloads.
      load.catch(() => {
        if (loaded.get(set) === load) loaded.delete(set);
      });
    }
    work = data.then((all) => decodeOutline(all[entry.name] ?? ''));
    cache.set(entry.id, work);
    work.catch(() => cache.delete(entry.id));
  }
  return work;
}

/**
 * A symbol as closed shapes, centred on the origin, Y up, its longest side `size` (millimetres,
 * or 1 by default). Islands: an outer ring, anticlockwise, then its holes, clockwise; no ring
 * crosses itself or another, and no island lies on another (contract.ts). Older ids resolve too
 * (`resolveSymbolId`). A new list every call, so a caller may change it.
 */
export async function symbolShapes(id: string, size = 1): Promise<Shapes> {
  return scaleShapes(await unitShapes(id), size);
}

/** A symbol's drawing as SVG path data for `viewBox="-0.5 -0.5 1 1"`: what a tile or a token
 *  shows, made from the same shapes `symbolShapes` hands an export. */
export async function symbolPath(id: string): Promise<string> {
  return outlinePath(await unitShapes(id));
}

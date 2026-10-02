import { ICONS, pathCommandsToPolygons, type IconChoice } from '@vostok/fonts';

/*
  Which of the glyphs make a symbol.

  The symbol set is drawn to read at 16 px: a bicycle is two hoops and a frame, a
  face is a disc with three holes, a signal is four bars. As a filled silhouette on a hook —
  one colour, a few millimetres across, bevelled — almost none of that survives. Ian's verdict
  after scrolling: "useless for 99% of the symbols".

  So a glyph is offered only if it is ONE solid blob:

    - one outline, with nothing else of any size inside or beside it (no holes, no islands);
    - it fills at least 40 % of its own bounding box (a bare outline or a thin bar does not);
    - it fills at least 62 % of its convex hull (spiky or spidery shapes do not);
    - it is not a sliver (aspect under 3:1).

  Measured from the real glyph outlines, once, when the font is in. The shape library's own
  silhouettes are offered ahead of these and are not subject to any of this.
*/

export interface UsableSymbols {
  list: IconChoice[];
  has(id: string): boolean;
}

function polyArea(poly: number[][]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j]![0]! * poly[i]![1]! - poly[i]![0]! * poly[j]![1]!;
  return Math.abs(a) / 2;
}

/** Area of the convex hull (monotone chain). */
function hullArea(poly: number[][]): number {
  const pts = [...poly].sort((p, q) => p[0]! - q[0]! || p[1]! - q[1]!);
  if (pts.length < 3) return 0;
  const cross = (o: number[], a: number[], b: number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: number[][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: number[][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return polyArea([...lower, ...upper]);
}

export function isBlob(polys: number[][][]): boolean {
  if (!polys.length) return false;
  const areas = polys.map(polyArea);
  const outerIdx = areas.indexOf(Math.max(...areas));
  const outer = polys[outerIdx]!;
  const outerArea = areas[outerIdx]!;
  if (outerArea < 200) return false; // at 100 units per em, a glyph smaller than this is a dot
  // Anything else of consequence — a hole or a second piece — and it is not one blob.
  for (let i = 0; i < polys.length; i++) if (i !== outerIdx && areas[i]! > outerArea * 0.06) return false;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of outer) {
    if (x! < minX) minX = x!;
    if (x! > maxX) maxX = x!;
    if (y! < minY) minY = y!;
    if (y! > maxY) maxY = y!;
  }
  const w = maxX - minX, h = maxY - minY;
  if (w < 1e-6 || h < 1e-6) return false;
  if (Math.max(w / h, h / w) > 3) return false;
  if (outerArea / (w * h) < 0.4) return false;
  const hull = hullArea(outer);
  if (hull > 0 && outerArea / hull < 0.62) return false;
  return true;
}

/** Every glyph that makes a symbol, in the registry's order. */
export function usableSymbols(font: any): UsableSymbols {
  const list: IconChoice[] = [];
  const ids = new Set<string>();
  for (const icon of ICONS) {
    const glyph = font.charToGlyph(icon.char);
    if (!glyph) continue;
    let polys: number[][][];
    try {
      polys = pathCommandsToPolygons(glyph.getPath(0, 0, 100).commands);
    } catch {
      continue;
    }
    if (!isBlob(polys)) continue;
    list.push(icon);
    ids.add(icon.id);
  }
  return { list, has: (id) => ids.has(id) };
}

/** The glyphs worth putting in front of someone first, if the font has them as blobs.
 *
 *  Material Symbols names since 2026-09-18, when the symbol font stopped being Font
 *  Awesome — see `packages/fonts/scripts/fetch-icons.mjs` for why. Some of the old
 *  list has no equivalent at all in a UI icon set (`frog`, `dragon`, `clover`,
 *  `feather`, `carrot`), so this is shorter than it was rather than padded out with
 *  near-misses. `usableSymbols` still has the final say: a glyph that does not trace
 *  as one solid blob never reaches the charm. */
export const PREFERRED_IDS = [
  'favorite', 'star', 'cloud', 'bolt', 'bedtime', 'water_drop', 'eco', 'notifications',
  'local_fire_department', 'crown', 'shield', 'diamond', 'chat_bubble', 'bookmark',
  'location_on', 'pets', 'pet_supplies', 'chess_knight', 'music_note', 'nutrition', 'egg',
  'local_cafe', 'icecream', 'potted_plant', 'waving_hand', 'emergency', 'workspace_premium',
  'park', 'sailing', 'anchor', 'rocket', 'skull', 'auto_awesome', 'casino', 'key', 'lock',
];

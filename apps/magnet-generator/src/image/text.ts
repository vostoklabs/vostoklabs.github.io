// Text → RegionSet, the third import source alongside images and SVG.
//
// The glyph outlines come from @vostok/fonts (opentype + the same layout the
// name keychain uses). All this adds is the normalization every source shares:
// centre the art, scale so the longest side is 1, and hand back one region plus
// the union silhouette. Downstream nothing knows it was text — base shape, size,
// magnet pockets, per-shape colours and slider mode all work unchanged.
import { getHorizontalContours } from '@vostok/fonts';
import type { RegionSet, Ring, RGB } from '../types';

/** Em size the glyphs are laid out at. Arbitrary — everything is normalized to
 *  the unit box afterwards and the body's Size slider sets the real millimetres. */
const LAYOUT_EM = 100;

export interface TextSourceOptions {
  text: string;
  /** Parsed opentype font (from `getFont`). */
  font: any;
  /** Parsed fallback font for glyphs the main face is missing, or null. */
  fallbackFont?: any;
  /** Tracking between glyphs as a fraction of the em; negative squashes. */
  letterSpacing?: number;
  /** Ink colour for the single traced region. */
  inkRgb?: RGB;
}

function ringArea(ring: Ring): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(area / 2);
}

export function buildTextRegionSet(opts: TextSourceOptions): RegionSet {
  const text = opts.text.trim();
  if (!text) throw new Error('Type something to put on the magnet.');

  const layout = getHorizontalContours(
    opts.font,
    opts.fallbackFont ?? null,
    text,
    '', // single line — the keychain's second line is not exposed here
    LAYOUT_EM,
    LAYOUT_EM,
    0, // no keyring tab to clear
    'left',
    1,
    opts.letterSpacing ?? 0,
  );

  const rings = (layout.contours as Ring[]).filter((r) => r.length >= 3 && ringArea(r) > 1e-6);
  if (rings.length === 0) {
    throw new Error('That font has no outlines for those characters. Try another font.');
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const dx = maxX - minX;
  const dy = maxY - minY;
  const maxSide = Math.max(dx, dy) || 1;

  // No Y flip here: pathCommandsToPolygons already negates the font's Y-down
  // coordinates, so these contours are Y-up like the image tracer's output.
  // (parseSvg flips because raw SVG is Y-down — do not copy that line.)
  const normalize = (r: Ring): Ring =>
    r.map(([x, y]) => [(x - cx) / maxSide, (y - cy) / maxSide] as [number, number]);

  const normRings = rings.map(normalize);

  return {
    regions: [
      {
        quantRgb: opts.inkRgb ?? [22, 22, 22],
        components: [{ rings: normRings, coverage: 1 }],
        coverage: 1,
      },
    ],
    outline: normRings,
    aspect: dy !== 0 ? dx / dy : 1,
  };
}

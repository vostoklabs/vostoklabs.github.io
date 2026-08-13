// Thumbnails for the sample grid, drawn from the baked outlines rather than
// shipped as images.
//
// The grid wants an <img src>, and the obvious answer is four small PNGs. But
// the outline is the thing the generator actually cuts, so drawing the
// thumbnail from it means the picture can never disagree with the model — and
// it costs a few hundred bytes of data URI instead of a raster round-trip.

import type { Ring } from './types';

/** An SVG data URI of the silhouette, sized to fill a square tile.
 *
 *  Rings arrive normalised (longest side = 1, centred, Y-up) so the viewBox is
 *  fixed; only the Y flip is needed to land in SVG's top-left origin. */
/** Dark ink, not a theme token: the kit backs every `.vl-sample img` with solid
 *  white in both themes, so a light fill would render as a blank tile. */
export function sampleThumb(rings: Ring[], fill = '#1f2937'): string {
  const pad = 0.06;
  const span = 1 + pad * 2;
  const d = rings
    .map((ring) => {
      if (ring.length < 3) return '';
      const pt = ([x, y]: [number, number]) => `${x.toFixed(3)} ${(-y).toFixed(3)}`;
      return `M ${pt(ring[0])} ` + ring.slice(1).map((p) => `L ${pt(p)}`).join(' ') + ' Z';
    })
    .filter(Boolean)
    .join(' ');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-span / 2} ${-span / 2} ${span} ${span}">` +
    // evenodd so interior rings read as holes, matching how the solver fills them
    `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>` +
    `</svg>`;

  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

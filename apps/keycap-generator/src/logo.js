import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { describeSvg, parseSvgLegend } from '@vostok/trace';
import { flattenSvgStyles } from '@vostok/ui-kit';

/*
 * The keycap's SVG legends, read by the shelf's SVG reader (@vostok/trace, "SVG reader"):
 * `parseSvgLegend` is the one-colour reading a legend is carved from, and `describeSvg` is what
 * the import window lists. What is left here is only what the keycap's callers expect of them:
 * three.js shapes, a part list with no colours, and the window's choices written into the file.
 */

/**
 * The root attribute `applySvgChoices` stamps on a file the user has been through the import
 * preview with. It means "every part's fate is written in as fill/stroke; do not second-guess
 * it" — so the white-shape and artboard-rect guesses stand down and a user who set a white
 * shape or the artboard to Fill actually gets it. The shelf's reader reads the same attribute.
 */
const CHOSEN_ATTR = 'data-vl-chosen';

/** Every parse goes through the flattener: paint in a `<style>` block or a `style` attribute is
 *  CSS that a strict style-src policy never lets SVGLoader read (`flattenSvgStyles` in
 *  @vostok/ui-kit says more). Exported from here too, for the import preview and its test. */
export { flattenSvgStyles };

/**
 * What is in an SVG, before committing to it: the shelf's `describeSvg`, as the keycap's import
 * window shows it.
 *
 * One entry per drawable element, biggest first (`index` is the position in
 * `SVGLoader.parse().paths`, which is what `applySvgChoices` keys on). `kind` is how the file
 * paints it; `why`, when set, is the reason `parseLogo` would have silently dropped it, reported
 * so the window can show that as an "Off" the user can flip.
 *
 * The legend is one colour, so a part carries no `hex` (and its row no swatch), and what the
 * reader says about a file's many colours is not said here: the only issues are a file that
 * cannot be read and a file with nothing to draw.
 *
 * @param {string} svgText
 * @returns {{ parts: Array<{index:number, kind:'fill'|'stroke'|'none', area:number, strokeWidth?:number, why?:'white'|'artboard'}>, issues: string[] }}
 */
export function describeLogo(svgText) {
  const { parts, issues } = describeSvg(flattenSvgStyles(svgText));
  return {
    parts: parts.map(({ hex, ...part }) => part),
    issues: parts.length ? [] : issues,
  };
}

/**
 * Write the import preview's decisions INTO the file, and return the new markup.
 *
 * `choices` is `{ [index]: 'fill' | 'outline' | 'off' }` keyed like `describeLogo`'s parts. Each
 * chosen element gets its paint as presentation attributes, and the root is stamped with
 * `data-vl-chosen` so `parseLogo` takes the file at its word. An `off` part is left in place
 * but unpainted and hidden: removing the node would renumber every index behind it.
 *
 * Attributes only, no inline `style`. This used to write both, the style being what beat a
 * `<style>` block or a class in a browser — but the file has been through `flattenSvgStyles`
 * by now, so there is no block and no class rule left for anything to beat, and a `style`
 * attribute in the stored markup is one more thing a strict style-src policy refuses on every re-parse.
 *
 * The legend is one colour, so `#000` is only "ink"; the carve does not read the value. A part
 * turned on is painted at full opacity too: the reader leaves out a paint at zero opacity, so
 * without it Fill on a part the file hid that way ("Invisible in the file") would do nothing.
 *
 * @param {string} svgText
 * @param {Record<number, 'fill'|'outline'|'off'>} choices
 * @returns {string}
 */
export function applySvgChoices(svgText, choices) {
  const data = new SVGLoader().parse(flattenSvgStyles(svgText));
  if (!data.xml) return svgText;
  data.paths.forEach((path, index) => {
    const mode = choices[index];
    const node = path.userData.node;
    if (!mode || !node) return;
    const style = path.userData.style || {};
    const width = Number(style.strokeWidth) || 1;
    const set = mode === 'fill'
      ? { fill: '#000', 'fill-opacity': '1', stroke: 'none', opacity: '1', visibility: 'visible' }
      : mode === 'outline'
        ? { fill: 'none', stroke: '#000', 'stroke-width': String(width), 'stroke-opacity': '1', opacity: '1', visibility: 'visible' }
        : { fill: 'none', stroke: 'none', visibility: 'hidden' };
    for (const [k, v] of Object.entries(set)) node.setAttribute(k, v);
  });
  data.xml.setAttribute(CHOSEN_ATTR, '1');
  return new XMLSerializer().serializeToString(data.xml);
}

/**
 * An SVG as the legend the carve cuts: the shelf's `parseSvgLegend`, in the three.js shapes the
 * carve, the previews and the set builder take.
 *
 *   contours    – the filled shapes, outlines one way round and holes the other, in the file's
 *                 own units (Y down)
 *   strokeGeoms – each stroke-only line as three's stroke mesh: a position-only
 *                 THREE.BufferGeometry, three corners to a triangle (the caller disposes them)
 *   box         – the THREE.Box2 of every contour point and stroke corner
 *   view        – the view box's size, an icon's em, or null when the file gives none
 *
 * Throws "No drawable paths found in this SVG." when nothing is left to carve.
 *
 * @param {string} svgText
 */
export function parseLogo(svgText) {
  const { contours, strokes, box, view } = parseSvgLegend(flattenSvgStyles(svgText));
  return {
    contours,
    strokeGeoms: strokes.map((corners) => new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(corners, 3))),
    box: new THREE.Box2(new THREE.Vector2(box.minX, box.minY), new THREE.Vector2(box.maxX, box.maxY)),
    // The viewBox is the icon's em. A curated icon family (lucide) draws every symbol optically
    // sized on one grid, so a chevron is DELIBERATELY smaller than an arrow — normalising each
    // one by its own ink box throws that away and makes them all the same height. Kept here so
    // the keyboard set can scale by the grid; single-cap placement still uses the ink box, which
    // is what direct manipulation of an arbitrary uploaded SVG should do.
    view,
  };
}

// Footprint (mm) the logo will occupy, for default sizing / overflow warnings.
export function logoFootprint(box, widthMM) {
  const dx = box.max.x - box.min.x;
  const dy = box.max.y - box.min.y;
  const span = Math.max(dx, dy) || 1;
  const s = widthMM / span;
  return { w: dx * s, h: dy * s };
}

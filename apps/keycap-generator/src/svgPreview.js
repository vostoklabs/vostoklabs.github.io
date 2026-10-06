/**
 * The keycap's half of the SVG import wizard.
 *
 * The window itself is `openSvgImport` in `@vostok/ui-kit` — it was here and in the clicker,
 * the two drifted, and it is one component now. What is left here is only what needs to know
 * what a keycap legend is: how this app describes an SVG, how it traces one, and what the
 * caller gets back.
 *
 * What comes out is a NEW SVG with the choices written into it as fill/stroke styles (see
 * `applySvgChoices`). That is deliberate: the single cap, the paid dual legend and the paid
 * keyboard set all read an uploaded tile's markup and call `parseLogo` on it themselves, and the
 * set stores the markup by content id. Baking the choice into the file means all three inherit
 * it with no new plumbing, the tile's thumbnail shows what will print, and a saved board
 * carries the decision inside the artwork it already keeps.
 */
import { openSvgImport } from '@vostok/ui-kit';
import { applySvgChoices, describeLogo, flattenSvgStyles, parseLogo } from './logo.js';

// The file's own colours do not matter to a one-colour legend, so the trace is drawn in the
// same ink as a black-on-transparent icon: what most uploads are, and what the checkerboard
// under it was chosen for.
const INK = '#111';

/**
 * A `parseLogo` result as paths the wizard can paint: the contours the carve will extrude and
 * the ribbon triangles a stroke becomes.
 *
 * All contours go into ONE path so a hole is a hole — see `SvgImportPath.d`.
 *
 * @param {ReturnType<typeof parseLogo>} legend
 * @returns {import('@vostok/ui-kit').SvgImportTrace}
 */
function traceToPaths(legend) {
  const { min, max } = legend.box;
  const w = max.x - min.x || 1;
  const h = max.y - min.y || 1;
  const pad = Math.max(w, h) * 0.08;
  // Square, centred on the art, so it sits in the panel the way the source <img> does.
  const side = Math.max(w, h) + 2 * pad;
  const viewBox = `${(min.x + max.x) / 2 - side / 2} ${(min.y + max.y) / 2 - side / 2} ${side} ${side}`;

  const paths = [];
  const d = (legend.contours ?? [])
    .filter((c) => c.length >= 3)
    .map((c) => `M${c.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join('L')}Z`)
    .join('');
  if (d) paths.push({ d, fill: INK });

  for (const g of legend.strokeGeoms ?? []) {
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    const count = idx ? idx.count : pos.count;
    let tri = '';
    for (let i = 0; i < count; i += 3) {
      const a = idx ? idx.getX(i) : i;
      const b = idx ? idx.getX(i + 1) : i + 1;
      const c = idx ? idx.getX(i + 2) : i + 2;
      tri += `M${pos.getX(a).toFixed(3)},${pos.getY(a).toFixed(3)}`
        + `L${pos.getX(b).toFixed(3)},${pos.getY(b).toFixed(3)}`
        + `L${pos.getX(c).toFixed(3)},${pos.getY(c).toFixed(3)}Z`;
    }
    // Ribbon triangles share edges; a hairline stroke hides the seams between them.
    if (tri) paths.push({ d: tri, fill: INK, stroke: INK, strokeWidth: side / 400 });
  }
  return { viewBox, paths };
}

/**
 * Show the file, show what the tracer made of it, and let the user fix the difference.
 *
 * Resolves with the SVG markup to use — the file with the choices written in — or null if the
 * user cancelled.
 *
 * @param {string} svgText
 * @param {string} name
 * @returns {Promise<string|null>}
 */
export async function openSvgPreview(svgText, name) {
  // Once, up front. Every parse below flattens on its own, but each parse of the ORIGINAL is
  // a parse of its <style> block and style attributes — which a strict style-src policy
  // reports as a violation per element. The wizard repaints on every toggle, so it works from the
  // flattened copy; the file itself is still what the "Your file" pane shows.
  const flat = flattenSvgStyles(svgText);
  const { parts, issues } = describeLogo(flat);
  // The legend is one colour, so no part carries a `hex` and no row gets a swatch.
  const choices = await openSvgImport({
    svgText,
    name,
    parts,
    issues,
    thinAt: 'keycap size',
    trace: (chosen) => {
      try {
        return traceToPaths(parseLogo(applySvgChoices(flat, modesOf(chosen))));
      } catch (err) {
        // "No drawable paths" is the expected result of switching every part off.
        if (!/No drawable/.test(err?.message ?? '')) console.error('[svg] preview trace failed', err);
        return null;
      }
    },
  });
  return choices ? applySvgChoices(flat, modesOf(choices)) : null;
}

/** `applySvgChoices` keys on the mode alone — the wizard's colour half is not a keycap thing.
 *  @param {Record<number, import('@vostok/ui-kit').SvgImportChoice>} choices */
function modesOf(choices) {
  const modes = {};
  for (const [index, choice] of Object.entries(choices)) modes[Number(index)] = choice.mode;
  return modes;
}

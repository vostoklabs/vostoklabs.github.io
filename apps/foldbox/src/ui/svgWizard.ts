/**
 * The fold-up box's half of the SVG import window.
 *
 * The window itself is `openSvgImport` in `@vostok/ui-kit` — the clicker and the keycap
 * generator both use it, and this is the third. What is left here is only what needs to
 * know what a BOX is:
 *
 *  · the box is one colour. A logo is engraved, drawn or inlaid in a single ink, so no part
 *    gets a colour swatch: a swatch here would be a control that changes nothing, which is
 *    the one thing this panel does not need more of. The file's colours still decide which
 *    parts a tracer would have dropped (a white backdrop, a full-bleed rectangle).
 *  · the preview draws the ARTWORK, not the file. Same rings `placeMarks` is about to put
 *    on the face, so what the window shows is what the box gets — the rule the dieline
 *    already follows against the exporter.
 *  · a STROKE is a drawn line, not the outline of a stroke. Every machine here follows a
 *    path: a laser line and a pen both do. So "outline" means one line down the middle of
 *    the stroke, and that is also why an outline has nothing to print as a second colour.
 */
import { openSvgImport, themeColor, type SvgImportChoice, type SvgImportTrace } from '@vostok/ui-kit';
import { describeSvg, svgArtwork, type SvgModes } from './svgLogo';
import type { Artwork, Poly } from '../types';

/** The preview box. The artwork spans roughly ±0.5, so this is the art with air round it. */
const SIZE = 220;
const VIEWBOX = `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`;

/** Normalised rings as path data in the preview box, Y flipped back to SVG's own sense.
 *
 *  ALL the rings go into ONE `d`: outers are wound one way and holes the other, so a hole
 *  is only a hole when it is painted with its outer. One path per ring fills every counter
 *  solid — the kit's own note on `SvgImportPath.d` is about exactly this. */
function ringsToPath(rings: Poly[]): string {
  const k = SIZE * 0.44;
  return rings
    .filter((r) => r.length >= 3)
    .map((r) => `M${r.map(([x, y]) => `${(x * k).toFixed(2)},${(-y * k).toFixed(2)}`).join('L')}Z`)
    .join('');
}

function linesToPath(lines: Poly[]): string {
  const k = SIZE * 0.44;
  return lines
    .filter((l) => l.length >= 2)
    .map((l) => `M${l.map(([x, y]) => `${(x * k).toFixed(2)},${(-y * k).toFixed(2)}`).join('L')}`)
    .join('');
}

function toTrace(art: Artwork): SvgImportTrace {
  // The ink, from the theme rather than a literal, so the preview is legible in both
  // themes — the same reason the dieline draws its marks in `--text`. `themeColor`, not
  // `themeColorHex`: this is an SVG attribute, and the hex variant returns a 24-bit NUMBER
  // for three.js, which an attribute would accept and then silently not paint.
  const ink = themeColor('--text', '#e6ebf2');
  const paths: SvgImportTrace['paths'] = [];
  const filled = ringsToPath(art.rings);
  if (filled) paths.push({ d: filled, fill: ink, stroke: ink, strokeWidth: 0.6 });
  const drawn = linesToPath(art.lines);
  if (drawn) paths.push({ d: drawn, fill: 'none', stroke: ink, strokeWidth: 1.6 });
  const shapes = art.rings.length;
  const strokes = art.lines.length;
  return {
    viewBox: VIEWBOX,
    paths,
    // Said out loud because the two behave differently downstream: shapes can be printed
    // as a second colour, lines can only be drawn.
    summary:
      `${shapes} ${shapes === 1 ? 'shape' : 'shapes'}` +
      (strokes ? `, ${strokes} drawn ${strokes === 1 ? 'line' : 'lines'} (lines cannot print in colour).` : '.'),
  };
}

/** Show the file, show what the box will get, and let the user fix the difference.
 *  Resolves with the modes to trace with, or null if they cancel. */
export async function openSvgWizard(svgText: string, name: string): Promise<SvgModes | null> {
  const { parts, issues } = describeSvg(svgText);
  const modesOf = (choices: Record<number, SvgImportChoice>): SvgModes => {
    const modes: SvgModes = {};
    for (const [index, choice] of Object.entries(choices)) modes[index] = choice.mode;
    return modes;
  };

  const choices = await openSvgImport({
    svgText,
    name,
    parts,
    issues,
    thinAt: 'box size',
    trace: (chosen) => {
      try {
        return toTrace(svgArtwork(svgText, modesOf(chosen)));
      } catch {
        // Everything switched off is the expected result of switching everything off, not
        // a fault: the window shows its own empty state for a null trace.
        return null;
      }
    },
  });

  return choices ? modesOf(choices) : null;
}

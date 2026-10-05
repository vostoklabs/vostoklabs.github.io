/**
 * The clicker's half of the SVG import wizard.
 *
 * The window itself is `openSvgImport` in `@vostok/ui-kit` — it was here and in the keycap
 * generator, the two drifted, and it is one component now. The clicker had the older shape: one
 * stacked column, so a dialog that scrolled past its own previews, and no reason given for a
 * part the tracer was about to drop. Both are fixed by using the kit's.
 *
 * What is left here is only what needs to know what a clicker is: the colour swatches (a
 * clicker is multi-filament, a keycap legend is one colour), the `RegionSet` trace, and the
 * `SvgOptions` the geometry actually consumes.
 *
 * The colour half matters more here than anywhere: the region colours are what get matched to
 * filaments, so a colour arriving wrong is a model printed in the wrong material. (That bug is
 * fixed in the SVG reader, `@vostok/trace` — three's ColorManagement was turning every imported
 * colour linear-light, so #c8102e arrived as #930107 — and it was a large part of what "SVG
 * import doesn't work" meant on the listing.)
 */
import { openSvgImport, type SvgImportChoice, type SvgImportTrace } from '@vostok/ui-kit';
import { describeSvg, parseSvg, type SvgOptions, type SvgPartChoice } from '@vostok/trace';
import type { RegionSet, Ring } from '../types';

const hex = (rgb: [number, number, number]): string =>
  `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** The box the normalised rings are drawn into. They span roughly ±0.5, so ±`SIZE`/2 with a
 *  margin is the whole art with a little air round it. */
const SIZE = 220;

/** The same box, as a viewBox string. Exported for the maker's-mark import (an optional
 *  feature), which draws its own single-colour trace into an identically sized panel. */
export const SVG_PREVIEW_VIEWBOX = `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`;

/**
 * Normalised rings (longest side 1, centred, Y-up) as SVG path data in the preview box.
 *
 * ONE `d` for the whole ring set, which is what makes a nested ring read as a hole under the
 * nonzero fill the kit paints. Exported rather than copied: the Y flip and the 0.44 scale are
 * exactly the two constants that rot when duplicated, and this file's own header is a note
 * about this component having drifted once already.
 */
export function ringsToPathData(rings: Ring[]): string {
  const k = SIZE * 0.44;
  return rings
    .filter((ring) => ring.length >= 3)
    // Y is flipped: rings are Y-up, SVG is Y-down.
    .map((ring) => `M${ring.map(([x, y]) => `${(x * k).toFixed(2)},${(-y * k).toFixed(2)}`).join('L')}Z`)
    .join('');
}

/**
 * A traced `RegionSet` as paths the wizard can paint.
 *
 * This is the half that matters: it draws the RINGS the geometry will actually extrude, not
 * the source file. When the two panels disagree, that difference IS the bug the user is
 * reporting, and now they can see it instead of describing it.
 *
 * All of a component's rings go into ONE path — see `SvgImportPath.d` in the kit for what
 * happens otherwise (every hole fills solid).
 */
function traceToPaths(set: RegionSet): SvgImportTrace {
  const paths: SvgImportTrace['paths'] = [];
  // Biggest first, so small details paint on top rather than under.
  const ordered = [...set.regions].sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0));
  for (const region of ordered) {
    for (const comp of region.components) {
      const d = ringsToPathData(comp.rings);
      if (d) paths.push({ d, fill: hex(region.quantRgb) });
    }
  }
  const colors = new Set(set.regions.map((r) => hex(r.quantRgb)));
  return {
    viewBox: SVG_PREVIEW_VIEWBOX,
    paths,
    // Colours are filaments here, so the count is worth saying out loud.
    summary: `${set.regions.length} ${set.regions.length === 1 ? 'part' : 'parts'}, `
      + `${colors.size} ${colors.size === 1 ? 'color' : 'colors'}.`,
  };
}

export interface SvgPreviewResult {
  /** The options to trace with. Handed straight to `parseSvg`. */
  options: SvgOptions;
}

/**
 * Show the file, show what the tracer made of it, and let the user fix the difference.
 *
 * Resolves with the chosen options when the user accepts, or null if they cancel — the same
 * shape as the image wizard, so `mount` treats both imports the same way.
 */
export async function openSvgPreview(
  svgText: string,
  name: string,
  removeBg: boolean,
): Promise<SvgPreviewResult | null> {
  const { parts, issues } = describeSvg(svgText);

  // `asPainted`: the geometry fills the rings non-zero, so each part is read as a browser paints
  // it, and a part drawn inside another adds to it rather than cutting a hole.
  const optionsFor = (choices: Record<number, SvgImportChoice>): SvgOptions => {
    const overrides: Record<number, SvgPartChoice> = {};
    for (const [index, c] of Object.entries(choices)) overrides[Number(index)] = { ...c };
    return { removeBg, overrides, asPainted: true };
  };

  const choices = await openSvgImport({
    svgText,
    name,
    // Every part carries a `hex`, so every row gets a colour swatch.
    parts,
    issues,
    thinAt: 'clicker size',
    trace: (chosen) => {
      try {
        const traced = parseSvg(svgText, optionsFor(chosen));
        return traced.regions.length ? traceToPaths(traced) : null;
      } catch (err) {
        // "No drawable paths" is the expected result of switching every part off, not a fault.
        if (!(err instanceof Error && err.message.startsWith('No drawable'))) {
          console.error('[svg] preview trace failed', err);
        }
        return null;
      }
    },
  });

  return choices ? { options: optionsFor(choices) } : null;
}

// An SVG logo in, `Artwork` out: the parts the import window lists, and the artwork for the
// modes chosen in it. Apart from the text (`artwork.ts`), because reading an SVG needs no font,
// and the fonts module carries every face the app offers.
//
// The file is read by the shelf's SVG reader, the one the clicker and the keycap generator's
// import windows read with. Two calls over the same file, and they MUST agree about what is in
// it: one describes the parts for the import window, the other traces the parts the user kept.
// Both key every part on its position in the file, which is what the window hands a choice
// back against.
//
// What comes out is normalised as the text is: centred on the origin, longest side exactly 1,
// Y-up, outer rings CCW and holes CW. `placeMarks` scales it onto a face from there.

import { describeSvg, parseSvg, type SvgPartChoice } from '@vostok/trace/svg';
import { flattenSvgStyles, type SvgImportPart } from '@vostok/ui-kit';
import { normalizeArtwork } from '../geometry/marks';
import type { Artwork } from '../types';

/** How a part may be drawn. The same three the kit's import window offers. */
export type SvgMode = 'fill' | 'outline' | 'off';
/** Choices by path index, as a saved project carries them. */
export type SvgModes = Record<string, SvgMode>;

const NOTHING_ON = 'Nothing is switched on, so there is no logo to put on the box.';

/**
 * The parts, biggest first, with the reason a tracer would drop each one, and what is wrong
 * with the file as a whole.
 *
 * Flattened first: a `<style>` block or a `style=""` attribute is read through the CSSOM, and
 * under a host whose policy is `style-src 'self'` that read comes back empty, so an Illustrator
 * outline drawing would trace as a solid blob. Attributes are the one thing no policy blocks.
 * Every build, one code path: on the public site the result is the same paint either way.
 *
 * One ink: a logo is engraved, drawn or inlaid in a single colour, so no part carries one, and
 * the window gives none of them a swatch. For the same reason the reader's warning about more
 * colours than a printer has filaments is left out.
 */
export function logoParts(svgText: string): { parts: SvgImportPart[]; issues: string[] } {
  const read = describeSvg(flattenSvgStyles(svgText));
  const parts: SvgImportPart[] = read.parts.map(({ index, kind, strokeWidth, why }) => ({
    index,
    kind,
    ...(strokeWidth !== undefined ? { strokeWidth } : {}),
    ...(why ? { why } : {}),
  }));
  const issues = parts.length ? [] : read.issues;
  if (parts.length && parts.every((p) => p.kind === 'none')) {
    issues.push('No path in this file has a fill or a stroke, so nothing would be drawn.');
  }
  return { parts, issues };
}

/** How a part starts out when nobody has chosen: as the file paints it, minus the two a
 *  tracer always dropped on its own — and a file with no fills anywhere is an outline
 *  drawing, whose useful reading is the outline. */
export function defaultSvgModes(parts: SvgImportPart[]): SvgModes {
  const modes: SvgModes = {};
  for (const p of parts) {
    modes[String(p.index)] = p.kind === 'none' || p.why ? 'off' : p.kind === 'fill' ? 'fill' : 'outline';
  }
  return modes;
}

/**
 * The artwork, as the chosen modes describe it. A part with no choice is off.
 *
 * `fill` takes the path's closed shapes, each path filled on its own as a browser paints it; on
 * a stroke-only path it closes the subpaths, which is what makes an outline drawing usable as a
 * solid. `outline` takes the subpaths as open polylines — the right answer for every machine
 * here, because a laser line and a pen both follow a path, so a 1 pt stroke should be one drawn
 * line and not a sausage traced round it. It is also why an outline has nothing to print as a
 * second colour, which the diagnostics say out loud.
 */
export function svgArtwork(svgText: string, modes?: SvgModes): Artwork {
  const flat = flattenSvgStyles(svgText);
  const { parts, issues } = describeSvg(flat);
  // A file that cannot be read, or has nothing in it, says so in the reader's words.
  if (!parts.length) throw new Error(issues[0] ?? NOTHING_ON);
  const chosen = modes ?? defaultSvgModes(parts);
  const overrides: Record<number, SvgPartChoice> = {};
  for (const p of parts) overrides[p.index] = { mode: chosen[String(p.index)] ?? 'off' };
  if (!parts.some((p) => overrides[p.index]?.mode !== 'off')) throw new Error(NOTHING_ON);

  let read: ReturnType<typeof parseSvg>;
  try {
    read = parseSvg(flat, { overrides, outlinesAsLines: true, asPainted: true });
  } catch {
    // The parts that are on draw nothing: an empty path, or a line with one point.
    throw new Error(NOTHING_ON);
  }
  const lines = read.regions.flatMap((r) => r.lines ?? []);
  if (!read.outline.length && !lines.length) throw new Error(NOTHING_ON);
  return normalizeArtwork(read.outline, lines);
}

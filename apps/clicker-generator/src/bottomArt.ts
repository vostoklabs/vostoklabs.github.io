/**
 * The bottom picture: a second picture, printed in colour on the underside of the base.
 *
 * The rules the rail, the build and a saved project share, as pure functions so the three cannot
 * disagree and node can test them. The picture itself (its pixels) is held by mount.ts beside the
 * top picture's; the carve is geometry/bottomPicture.ts.
 */
import { cleanCropBox, cleanPictureEdits } from '@vostok/trace';
import type { BottomArt, BottomPicture, BottomPlace, BuildRegion, RegionSet, RGB } from './types';
import { cleanBottomPlace, isDefaultPlace } from './geometry/bottomPlace';

/** The size the bottom picture is traced at, mm. The build chooses the printed size (as large as
 *  the underside allows), so this only sets the tracer's smallest feature; the build's own line
 *  check leaves out what would still be too thin. A constant, so changing Size never retraces. */
export const BOTTOM_TRACE_MM = 28;

/** How many colours a bottom picture with no mapping is split into. */
export const BOTTOM_DEFAULT_COLOURS = 4;

/** A flat clicker has an underside to print on; a block set and a cut model do not. */
export function bottomPictureShown(importMode: string): boolean {
  return importMode === 'image' || importMode === 'svg' || importMode === 'icon' || importMode === 'text';
}

/** The rail's Bottom category, as `update()` sets it on every render: nothing where there is no
 *  flat underside (so the rail drops the category), its drop zone until there is a picture, then
 *  the picture's buttons and the rows that place it. */
export function showBottomPictureRows(
  rows: { zone: { hidden: boolean }; buttons: { hidden: boolean }; replace: { hidden: boolean }; place: { hidden: boolean }[] },
  importMode: string,
  hasPicture: boolean,
): void {
  const shown = bottomPictureShown(importMode);
  rows.zone.hidden = !shown || hasPicture;
  rows.buttons.hidden = !shown || !hasPicture;
  rows.replace.hidden = !shown || !hasPicture;
  for (const r of rows.place) r.hidden = !shown || !hasPicture;
}

/** What the trace of a bottom picture depends on: everything but its place, so moving, turning or
 *  sizing it never traces it again. */
export function bottomTraceKey(bp: BottomPicture): string {
  const { place: _place, ...trace } = bp;
  return JSON.stringify(trace);
}

/** The trace as the build takes it, with the customer's place on it; the engine's own place adds
 *  nothing, so the build is the one it was before places existed. */
export function placedBottomArt(art: BottomArt, place: BottomPlace | undefined): BottomArt {
  return isDefaultPlace(place) ? art : { ...art, place };
}

const sameRgb = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** The group a picture's colour prints in, found by colour (a traced region's colour is one of
 *  the picture's), or undefined when the colour is not in the mapping. */
export function groupOfColour(colours: { rgb: RGB; group: number }[], rgb: RGB): number | undefined {
  return colours.find((c) => sameRgb(c.rgb, rgb))?.group;
}

/** The bottom picture's trace as the build takes it: each colour in its group's filament, each
 *  shape a part of its own (`bottom-color-<colour>-<shape>`), with the picture's outline. */
export function bottomArtOf(set: RegionSet, picture: BottomPicture): BottomArt {
  const regions: BuildRegion[] = [];
  set.regions.forEach((r, i) => {
    const g = groupOfColour(picture.mappedColors, r.quantRgb);
    const filamentRgb = (g === undefined ? undefined : picture.mappedFilaments[g]) ?? r.quantRgb;
    r.components.forEach((comp, j) => {
      regions.push({ filamentRgb, coverage: r.coverage, rings: comp.rings, partName: `bottom-color-${i}-${j}` });
    });
  });
  return { regions, outline: set.outline };
}

const isRgb = (v: unknown): v is RGB =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** A saved picture's colour mapping (the top picture's or the bottom's): the filaments that are
 *  colours, and each picture colour whose group is one of them. */
export function cleanMapping(rawColors: unknown, rawFilaments: unknown): { mappedColors: { rgb: RGB; group: number }[]; mappedFilaments: RGB[] } {
  const mappedFilaments = Array.isArray(rawFilaments) ? rawFilaments.filter(isRgb) : [];
  const mappedColors = Array.isArray(rawColors)
    ? rawColors
      .filter((c): c is { rgb: RGB; group: number } =>
        !!c && typeof c === 'object' && isRgb((c as { rgb?: unknown }).rgb)
        && Number.isInteger((c as { group?: unknown }).group) && (c as { group: number }).group >= 0
        && (c as { group: number }).group < mappedFilaments.length)
      .map((c) => ({ rgb: c.rgb, group: c.group }))
    : [];
  return { mappedColors, mappedFilaments };
}

/** A saved project's bottom picture settings, or null when it has none (or they are not an
 *  object). What is missing or broken takes the window's default. */
export function cleanBottomPicture(raw: unknown): BottomPicture | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const smoothing = typeof r.smoothing === 'number' && Number.isFinite(r.smoothing) ? Math.max(0, Math.min(1, r.smoothing)) : 0.1;
  const { mappedColors, mappedFilaments } = cleanMapping(r.mappedColors, r.mappedFilaments);
  return {
    smoothing,
    removeBg: r.removeBg !== false,
    mappedColors,
    mappedFilaments,
    pictureEdits: cleanPictureEdits(r.pictureEdits),
    pictureCrop: cleanCropBox(r.pictureCrop),
    // A project from before places existed has none: the engine's own, in the middle.
    place: cleanBottomPlace(r.place),
  };
}

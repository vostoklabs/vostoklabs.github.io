// How a picture is split into a number of filaments: the colours it is drawn in
// (`findColours`), finer when more are asked for than it opens with, then the closest merged
// until the count fits (`closestPairMapping`). One function for the picture window and the
// rail's Colors count, so the two roads give a picture the same colours. Pure: no DOM.
import {
  closestPairMapping, DETAIL_MAX, findColours, LIST_MAX, type ColourCandidate, type PictureChanges, type RgbaImage,
} from '@vostok/trace';
import type { RGB } from '../types';

/** A colour found in the picture, and the filament group it prints in (groups numbered biggest
 *  first, the way `processImage`'s `mergeInto` takes them). */
export interface MappedColour {
  rgb: RGB;
  group: number;
}

/** The colours a picture was found to have, and how finely it was asked (`findColours`' detail). */
export interface FoundColours {
  candidates: ColourCandidate[];
  detail: number;
}

/**
 * Ask for a finer split until there are `want` colours or more: one detail up at a time, keeping
 * each list that grew. `exhausted` when the finest detail still has fewer: the picture has no
 * more colours to give. Every finer list holds the colours of the one below it, exactly.
 */
export function finerColours(
  img: RgbaImage,
  removeBg: boolean,
  picture: PictureChanges,
  from: FoundColours,
  want: number,
): FoundColours & { exhausted: boolean } {
  return finerWith((d) => findColours(img, removeBg, picture, d), from, want);
}

/** `finerColours` with the finder given: `find(detail)` lists the picture's colours at a detail. */
export function finerWith(
  find: (detail: number) => ColourCandidate[],
  from: FoundColours,
  want: number,
): FoundColours & { exhausted: boolean } {
  let found = from;
  for (let d = from.detail + 1; d <= DETAIL_MAX && found.candidates.length < want; d++) {
    const next = find(d);
    if (next.length > found.candidates.length) found = { candidates: next, detail: d };
  }
  return { ...found, exhausted: found.candidates.length < want };
}

/** The candidates merged into `n` groups, closest first: each colour's group, and each group's
 *  filament, which is its biggest colour until someone picks another. */
export function splitMapping(candidates: ColourCandidate[], n: number): { colors: MappedColour[]; filaments: RGB[] } {
  const groups = closestPairMapping(candidates, n);
  const filaments: RGB[] = [];
  // Candidates come biggest first, so a group's first member is its biggest.
  candidates.forEach((c, k) => {
    if (!filaments[groups[k]]) filaments[groups[k]] = c.rgb;
  });
  return { colors: candidates.map((c, k) => ({ rgb: c.rgb, group: groups[k] })), filaments };
}

/** The Colours stepper's top: the longest list, until the finest split has nothing more to
 *  give, then the colours there are. */
export function stepperTop(found: number, exhausted: boolean): number {
  return Math.max(1, exhausted ? found : LIST_MAX);
}

/** The line beside the colour list: how many filaments, and when the picture has no more to
 *  give and every colour is its own filament, that it is every colour it has. */
export function filamentCountText(filaments: number, found: number, exhausted: boolean): string {
  if (!found) return 'no colours found';
  const every = exhausted && filaments >= found;
  return `${filaments} ${filaments === 1 ? 'filament' : 'filaments'}${every ? ', every colour it has' : ''}`;
}

/** A picture split into `n` filaments, or into every colour it has when it has fewer. Empty when
 *  no colour was found. */
export function splitPicture(
  img: RgbaImage,
  removeBg: boolean,
  n: number,
  picture: PictureChanges = {},
): { colors: MappedColour[]; filaments: RGB[] } {
  let found: FoundColours = { candidates: findColours(img, removeBg, picture, 0), detail: 0 };
  if (found.candidates.length && found.candidates.length < n) found = finerColours(img, removeBg, picture, found, n);
  return splitMapping(found.candidates, Math.min(Math.max(1, n), found.candidates.length));
}

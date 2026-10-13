// "Help me choose": the walkthrough's two answers, which designs they keep, the stand and photo
// size they set, and the order the best matches come in. Pure, so the node test checks it.
import type { StandKind } from './geometry/layout';
import { DESIGNS, settingsOf, type Design } from './designs';
import { fitSettings, outlineOf, productOf, standsOffered } from './rules';
import type { FrameSettings } from './settings';
import { SIZES_FOR, type PhotoId } from './sizes';

export type Place = 'desk' | 'fridge' | 'keys';

/** A photo answer: a size, or 'other' (the editor opens on Size to pick one). */
export type PhotoAnswer = PhotoId | 'other';

export interface Answers {
  place: Place | null;
  photo: PhotoAnswer | null;
}

export const NO_ANSWERS: Answers = { place: null, photo: null };

export const hasAnswers = (a: Answers): boolean => a.place !== null || a.photo !== null;

export const PLACES: readonly { id: Place; label: string }[] = [
  { id: 'desk', label: 'On a desk or shelf' },
  { id: 'fridge', label: 'On the fridge' },
  { id: 'keys', label: 'On keys or a bag' },
];

export const PHOTO_ANSWERS: readonly { id: PhotoAnswer; label: string }[] = [
  { id: 'mini', label: 'Instant mini' },
  { id: 'isq', label: 'Instant square' },
  { id: 'iwide', label: 'Instant wide' },
  { id: '4x6', label: 'Photo print 10 × 15 cm' },
  { id: 'other', label: 'Another size' },
];

const STANDING: readonly StandKind[] = ['block', 'base', 'foot', 'kickstand', 'none'];

/** The design made for this place: its own stand already is the answer. */
export function madeFor(d: Design, place: Place): boolean {
  const own = settingsOf(d);
  if (place === 'desk') return d.kind === 'holder' || STANDING.includes(own.stand);
  if (place === 'fridge') return own.stand === 'magnets';
  return own.stand === 'keychain';
}

/** The stand a place asks for on this design: magnets on the fridge, the loop on keys, and on a
 *  desk the design's own when it stands, else a foot (a kickstand under a shaped edge). */
export function standFor(s: FrameSettings, place: Place | null): StandKind {
  if (place === 'fridge') return 'magnets';
  if (place === 'keys') return 'keychain';
  if (place === 'desk' && !STANDING.includes(s.stand)) return outlineOf(s) === 'rect' || outlineOf(s) === 'arch' ? 'foot' : 'kickstand';
  return s.stand;
}

/** A design opened with the answers applied: the photo size, and the stand the place asks for. */
export function withAnswers(s: FrameSettings, a: Answers): FrameSettings {
  const out: FrameSettings = { ...s, words: { ...s.words } };
  if (a.photo && a.photo !== 'other') out.photo = a.photo;
  out.stand = standFor(out, a.place);
  return fitSettings(out).settings;
}

/** Whether a design can be what the answers ask for. */
export function takes(d: Design, a: Answers): boolean {
  if (a.photo && a.photo !== 'other' && !SIZES_FOR[productOf(d.kind)].includes(a.photo)) return false;
  if (!a.place || a.place === 'desk') return true;
  if (d.kind === 'holder' || settingsOf(d).profile === 'deep') return false;
  // The stand the place needs, on the print the answer names (or the design's own).
  const s = { ...settingsOf(d) };
  if (a.photo && a.photo !== 'other') s.photo = a.photo;
  return standsOffered(s).includes(a.place === 'fridge' ? 'magnets' : 'keychain');
}

/** The designs the answers keep, the ones made for the place first, each in gallery order. */
export function matches(a: Answers): Design[] {
  const kept = DESIGNS.filter((d) => takes(d, a));
  if (!a.place) return kept;
  const place = a.place;
  return [...kept.filter((d) => madeFor(d, place)), ...kept.filter((d) => !madeFor(d, place))];
}

/** The photo answers a place leaves: the sizes some design can take there. */
export function photoAnswersFor(place: Place | null): PhotoAnswer[] {
  return PHOTO_ANSWERS.map((p) => p.id).filter((id) => id === 'other' || DESIGNS.some((d) => takes(d, { place, photo: id })));
}

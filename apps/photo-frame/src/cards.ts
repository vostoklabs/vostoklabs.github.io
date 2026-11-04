// The gallery's pictures, made before the page opens: one portrait and one landscape a design.
// scripts/render-photo-frame-cards.mjs takes each with pictureOf (pictures.ts), the same camera a
// card would otherwise wait for, and files it in public/cards/. cardFiles.ts lists them with the
// settings each was taken from, so the designs test fails when a design moves on without its
// picture.
import { CARD_FILES } from './cardFiles';
import { kickstandsFor, settingsOf, type Design } from './designs';
import { fitSettings } from './rules';
import type { FrameSettings } from './settings';
import type { Orientation } from './sizes';

/** A card's picture: portrait, 4 by 5, drawn at about twice the size it shows. */
export const CARD_SHOT = { width: 360, height: 450 };

export const ORIENTATIONS: readonly Orientation[] = ['portrait', 'landscape'];

/** A design turned one way, as it opens from the gallery: its own values, that way up, inside
 *  the rules. */
export function cardSettings(d: Design, o: Orientation): FrameSettings {
  const s = settingsOf(d);
  s.orientation = o;
  s.kickstands = kickstandsFor(s);
  return fitSettings(s).settings;
}

/** What a picture is filed under: a short hash of the settings it shows. */
export function cardKey(s: FrameSettings): string {
  const text = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The made picture of a design turned one way, as a URL beside the page; null when there is none
 *  (the card then makes its own). */
export function cardPicture(id: string, o: Orientation): string | null {
  const entry = CARD_FILES[id]?.[o];
  return entry ? `${import.meta.env.BASE_URL}cards/${entry.file}` : null;
}

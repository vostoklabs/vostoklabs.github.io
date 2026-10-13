// Everything printed in the second colour, as rings for the worker: the words fitted into the room
// the layout leaves for them, the player or the post's icons, and the pattern. Pure once the faces
// are loaded, so the node test composes exactly what the screen sends.
import { FONTS } from '@vostok/fonts/registry';
import { FIT, frameLayout, holderLayout, type Box } from './geometry/layout';
import { musicArt, socialArt } from './geometry/glyphs';
import type { Ring } from './geometry/outline';
import { kindOf } from './designs';
import type { PatternInk } from './pattern';
import { clock, secondsOf, specOf, typed } from './rules';
import type { FrameSettings, WordRole } from './settings';
import { printOf } from './sizes';
import { fitText, splitLike, type Face, type FittedText } from './text';

export interface Faces {
  /** The chosen face. */
  main: Face;
  /** The smaller lines' face: the chosen one, or a plain one under a script. */
  second: Face;
  /** The Material symbols. */
  symbols: Face;
}

/** A second line under a script face is set in this plain one. */
export const SECOND_FACE = 'nunito';

export const isScript = (fontId: string): boolean => FONTS.some((f) => f.id === fontId && f.category === 'Script');

/** The face the smaller lines use with this one. */
export const secondFaceOf = (fontId: string): string => (isScript(fontId) ? SECOND_FACE : fontId);

/** How much smaller a second line is than the first. */
export const SECOND = 0.6;

export interface SetLine {
  role: WordRole;
  /** The size it was asked for and the size it got, mm. */
  asked: number;
  text: FittedText;
}

export interface Ink {
  /** The words and the art. */
  rings: Ring[];
  lines: SetLine[];
  /** The pattern, clipped to its face by the worker; null when there is none. */
  pattern: PatternInk | null;
}

const tallest = (box: Box) => (box.y1 - box.y0) / 0.78;

export function composeInk(s: FrameSettings, faces: Faces, pattern: PatternInk | null = null): Ink {
  const rings: Ring[] = [];
  const lines: SetLine[] = [];
  const set = (role: WordRole, text: string, box: Box | null | undefined, em: number, align: 'center' | 'left' | 'right' = 'center', face = faces.main) => {
    if (!box || !typed(text)) return;
    const fitted = fitText(face, faces.symbols, text, box, em, align);
    if (!fitted) return;
    rings.push(...fitted.rings);
    lines.push({ role, asked: em, text: fitted });
  };
  const w = s.words;
  const kind = kindOf(s);
  const print = printOf(s);

  if (kind === 'holder') {
    const H = holderLayout(s.holder, print, typed(w.front));
    set('front', w.front, H.textBox, s.textSize);
    return { rings, lines, pattern: null };
  }

  const L = frameLayout(specOf(s), print);
  // The chin: one line at the chosen size, or two with the second smaller under it.
  const chin = (['caption', 'second'] as const).filter((r) => typed(w[r]));
  chin.forEach((role, i) => {
    const second = i === 1;
    set(role, w[role], L.captions[i], second ? s.textSize * SECOND : s.textSize, 'center', second ? faces.second : faces.main);
  });
  if (L.crest) set('initials', w.initials, L.crest.text, tallest(L.crest.text));

  if (L.music) {
    const m = L.music;
    const { title, like } = splitLike(w.song);
    set('song', title, m.title, s.textSize, 'left');
    let likeRings: Ring[] | null = null;
    if (like) likeRings = fitText(faces.symbols, null, like, m.like, tallest(m.like))?.rings ?? null;
    rings.push(...musicArt(m, likeRings));
    set('artist', w.artist, m.artist, s.textSize * SECOND, 'left', faces.second);
    const length = secondsOf(w.length);
    if (m.times && length !== null) {
      set('length', clock(length * 0.38), m.times.left, tallest(m.times.left), 'left', faces.second);
      set('length', clock(length), m.times.right, tallest(m.times.right), 'right', faces.second);
    }
  }

  if (L.social) {
    const p = L.social;
    rings.push(...socialArt(p));
    set('handle', w.handle, p.name, tallest(p.name));
    set('likes', w.likes, p.likes, tallest(p.likes), 'left');
    set('postCaption', w.postCaption, p.caption, tallest(p.caption), 'left', faces.second);
  }
  return { rings, lines, pattern };
}

/** The lines set smaller than the floor a 0.4 mm nozzle prints cleanly. */
export const linesUnderFloor = (ink: Ink): SetLine[] => ink.lines.filter((l) => l.text.em < FIT.minEm - 1e-6);

/** The first line, when it came out smaller than asked. */
export const shrunkFirst = (ink: Ink): SetLine | undefined =>
  ink.lines.find((l) => (l.role === 'caption' || l.role === 'song' || l.role === 'front') && l.text.shrunk && l.asked > l.text.em + 0.05);

// Every setting a frame has, in one plain object, and its defaults. A design (designs.ts) is a set
// of these values; Save and Load write exactly this. Pure: the worker, the rules and the node test
// read it without a font or a page.
import type { Border, Corners, HolderKind, Outline, Profile, StandKind } from './geometry/layout';
import type { MagnetId, Orientation, PhotoId } from './sizes';

/** Where along the top edge a keychain's loop sits. */
export type LoopAt = 'left' | 'middle' | 'right';

/** A wide border for words: none, over the photo, or under it. */
export type WordsAt = 'none' | 'top' | 'bottom';

/** What a line of words is for. Words are kept by role, so a name typed on one design is the
 *  caption of the next. */
export type WordRole = 'caption' | 'second' | 'initials' | 'song' | 'artist' | 'length' | 'handle' | 'likes' | 'postCaption' | 'front';

export const WORD_ROLES: readonly WordRole[] = ['caption', 'second', 'initials', 'song', 'artist', 'length', 'handle', 'likes', 'postCaption', 'front'];

export type Words = Record<WordRole, string>;

export const NO_WORDS: Words = { caption: '', second: '', initials: '', song: '', artist: '', length: '', handle: '', likes: '', postCaption: '', front: '' };

export interface FrameSettings {
  /** The design it was opened as: what kind of thing it is, and what Reset goes back to. */
  design: string;
  photo: PhotoId;
  /** Paper sizes only: film has one way up, and a Custom size is typed as it stands. */
  orientation: Orientation;
  /** Custom size, mm, as it stands: width across, height up. */
  customWidth: number;
  customHeight: number;
  outline: Outline;
  corners: Corners;
  /** A crest above the top edge, for initials. */
  crest: boolean;
  border: Border;
  /** A wide border with room for words, and where: over the photo or under it. */
  wordsAt: WordsAt;
  profile: Profile;
  /** A holder's shape: the Ledge, the Pebble or the Heart. */
  holder: HolderKind;
  patternOn: boolean;
  /** A pattern of @vostok/patterns, by id (a `pm-` id is a library tile). */
  pattern: string;
  /** The pattern's size, % of its own. */
  patternSize: number;
  /** The pattern moved across and up, mm. */
  patternDx: number;
  patternDy: number;
  /** A face of @vostok/fonts, by id. */
  font: string;
  /** The first line's letter size, mm (the font's em). The other lines follow it. */
  textSize: number;
  /** The size follows the room the design has for words, until the customer sets one. */
  textAuto: boolean;
  stand: StandKind;
  /** On magnets: their size, and how many. */
  magnet: MagnetId;
  magnetCount: '2' | '4';
  /** On a kickstand: one in the middle, or two near the sides (steadier lying wide). */
  kickstands: '1' | '2';
  /** On a keychain: the hole and the wall round it, mm, and where the loop sits. */
  holeDia: number;
  holeRing: number;
  loopAt: LoopAt;
  /** Filament colours, as hex. */
  bodyColor: string;
  /** Everything printed on the face: words, a pattern, a player, a band. */
  inkColor: string;
  /** The mat inside a deep frame. */
  matColor: string;
  baseColor: string;
  /** What is typed, by role. Symbols are characters in the field's symbol range (text.ts). */
  words: Words;
}

export const DEFAULT_SETTINGS: FrameSettings = {
  design: 'snapshot',
  photo: 'mini',
  orientation: 'portrait',
  customWidth: 70,
  customHeight: 100,
  outline: 'rect',
  corners: 'rounded',
  crest: false,
  border: 'regular',
  wordsAt: 'bottom',
  profile: 'flat',
  holder: 'bar',
  patternOn: false,
  pattern: 'dots',
  patternSize: 100,
  patternDx: 0,
  patternDy: 0,
  font: 'fredoka',
  textSize: 12,
  textAuto: true,
  stand: 'foot',
  magnet: '10x3',
  magnetCount: '2',
  kickstands: '1',
  holeDia: 5,
  holeRing: 2.5,
  loopAt: 'middle',
  bodyColor: '#f7f7f5',
  inkColor: '#161616',
  matColor: '#f7f7f5',
  baseColor: '#f7f7f5',
  words: { ...NO_WORDS },
};

export function cloneSettings(s: FrameSettings): FrameSettings {
  return { ...s, words: { ...s.words } };
}

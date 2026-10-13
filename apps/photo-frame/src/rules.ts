// The rules: what each design and print can take, what shows, and how a set of settings is kept
// inside them. Pure, with no font and no page, so the node test checks them and the screen only
// shows their result.
import { captionMax, frameLayout, holderLayout, FIT, type FrameSpec, type Outline, type Profile, type StandKind } from './geometry/layout';
import type { BuildSettings } from './geometry/build';
import { designOf, kindOf, type Kind } from './designs';
import type { FrameSettings, LoopAt, WordRole } from './settings';
import { fromTokens } from './text';
import { CUSTOM_CAP, CUSTOM_MIN, KEYCHAIN_LONG_SIDE, MAGNETS, MAGNET_CAP, SIZES_FOR, magnetById, photoById, printOf, withinCap, type MagnetSize, type PhotoId, type Product } from './sizes';

/** Which size list and caps a kind of design uses. */
export const productOf = (kind: Kind): Product => (kind === 'holder' ? 'holder' : kind === 'frame' ? 'frame' : 'music');

const SHAPED: readonly Outline[] = ['scallop', 'ricrac', 'squiggle'];

/** The outline the build uses: a song plaque and a post are rectangles. */
export const outlineOf = (s: FrameSettings): Outline => (kindOf(s) === 'frame' ? s.outline : 'rect');

/** The profile the build uses: only a rectangular frame takes a bevel or a deep box. */
export const profileOf = (s: FrameSettings): Profile => (kindOf(s) === 'frame' && s.outline === 'rect' ? s.profile : 'flat');

/** A wide bottom with room for words: frames with a flat face. */
export const chinOf = (s: FrameSettings): boolean => kindOf(s) === 'frame' && s.outline !== 'squiggle' && s.wordsAt !== 'none';

/** A crest for initials: rectangular frames. */
export const crestOf = (s: FrameSettings): boolean => kindOf(s) === 'frame' && s.outline === 'rect' && s.crest;

/** A pattern needs a flat border wide enough to fill: Regular or Thick, on a flat rectangle, arch
 *  or scallop. */
export const takesPattern = (s: FrameSettings): boolean =>
  kindOf(s) === 'frame' && profileOf(s) === 'flat' && s.border !== 'thin' && (s.outline === 'rect' || s.outline === 'arch' || s.outline === 'scallop');

export const patternOf = (s: FrameSettings): boolean => takesPattern(s) && s.patternOn;

/** The stands this design and print can take, in the tiles' order. A holder is its own stand. */
export function standsOffered(s: FrameSettings): StandKind[] {
  const kind = kindOf(s);
  if (kind === 'holder') return [];
  const { pw, ph } = printOf(s);
  const shaped = SHAPED.includes(outlineOf(s));
  const deep = profileOf(s) === 'deep';
  const out: StandKind[] = [];
  if (!shaped && !deep) out.push('block', 'base', 'foot');
  out.push('kickstand');
  if (!deep && withinCap(pw, ph, MAGNET_CAP)) out.push('magnets');
  if (!deep && kind === 'frame' && Math.max(pw, ph) <= KEYCHAIN_LONG_SIDE + 1e-6) out.push('keychain');
  out.push('none');
  return out;
}

/**
 * Whether `count` magnets of this size fit on the back plate of this print: two sit one above the
 * other on the middle line, four in the corners, each in a round puck with a 2 mm wall, clear of
 * the plate's edges and of each other.
 */
export function magnetFits(m: MagnetSize, count: number, s: FrameSettings): boolean {
  const { pw, ph } = printOf(s);
  const Pw = pw + 2 * FIT.pocketClear;
  const Ph = ph + 2 * FIT.pocketClear;
  const puck = m.d + FIT.magnetFit + 2 * FIT.magnetWall;
  if (Ph < 2 * puck + 2) return false;
  return count === 4 ? Pw >= 2 * puck + 5.2 : Pw >= puck + 4.2;
}

/** The magnet sizes that fit, for this many. */
export const magnetsOffered = (s: FrameSettings, count: number): MagnetSize[] => MAGNETS.filter((m) => magnetFits(m, count, s));

/** How many magnets the back plate takes: two always, four when even the smallest four fit. */
export const magnetCountsOffered = (s: FrameSettings): ('2' | '4')[] => (['2', '4'] as const).filter((c) => magnetsOffered(s, Number(c)).length > 0);

/** Where a stand goes when this design or print cannot take it. */
const fallbackStand = (offered: StandKind[]): StandKind => (offered.includes('block') ? 'block' : 'kickstand');

export const STAND_NAME: Record<StandKind, string> = {
  block: 'Base',
  base: 'Low base',
  foot: 'Foot',
  kickstand: 'Kickstand',
  magnets: 'Magnets',
  keychain: 'Keychain',
  none: 'None',
};

/** Something `fitSettings` changed that the customer should hear about. */
export interface Notice {
  kind: 'warn';
  text: string;
}

/** Where the photo size goes when a design does not take the one asked for. */
const BIGGEST: Record<Product, PhotoId> = { frame: 'a5', holder: '3.5x5', music: '4x6' };

/**
 * Keep the settings inside what the design and print can take: the size list, the Custom caps and
 * the stands. Fitting twice changes nothing.
 */
export function fitSettings(input: FrameSettings): { settings: FrameSettings; notices: Notice[] } {
  const s: FrameSettings = { ...input, words: { ...input.words } };
  const notices: Notice[] = [];
  const kind = kindOf(s);
  const product = productOf(kind);

  // The photo size: one the design offers, else the biggest it takes.
  if (!SIZES_FOR[product].includes(s.photo)) {
    const to = BIGGEST[product];
    notices.push({
      kind: 'warn',
      text:
        product === 'holder'
          ? `Holders take prints up to 3.5 × 5 in. Photo size changed to ${photoById(to).name}.`
          : `This design takes prints up to 4 × 6 in or A6. Photo size changed to ${photoById(to).name}.`,
    });
    s.photo = to;
  }

  // Custom: inside the design's caps, short side and long side.
  const [short, long] = CUSTOM_CAP[product];
  let w = Math.max(CUSTOM_MIN, s.customWidth);
  let h = Math.max(CUSTOM_MIN, s.customHeight);
  if (w <= h) {
    w = Math.min(w, short);
    h = Math.min(h, long);
  } else {
    w = Math.min(w, long);
    h = Math.min(h, short);
  }
  if (s.photo === 'custom' && (Math.abs(w - s.customWidth) > 1e-6 || Math.abs(h - s.customHeight) > 1e-6)) {
    notices.push({ kind: 'warn', text: `Custom size changed to ${round1(w)} × ${round1(h)} mm, the most this design takes.` });
  }
  s.customWidth = w;
  s.customHeight = h;

  // Magnets: as many and as big as the back plate takes, the nearest smaller ones when not.
  const onMagnets = kind !== 'holder' && s.stand === 'magnets';
  const counts = magnetCountsOffered(s);
  if (!counts.includes(s.magnetCount)) {
    if (onMagnets) notices.push({ kind: 'warn', text: `Four magnets do not fit on this print's back. Magnets changed to 2.` });
    s.magnetCount = counts[0] ?? '2';
  }
  const sizes = magnetsOffered(s, Number(s.magnetCount));
  if (sizes.length && !sizes.some((m) => m.id === s.magnet)) {
    const was = magnetById(s.magnet);
    const to = [...sizes].reverse().find((m) => m.d * m.h <= was.d * was.h) ?? sizes[0]!;
    if (onMagnets) notices.push({ kind: 'warn', text: `${was.label} magnets do not fit on this print's back. Magnet size changed to ${to.label}.` });
    s.magnet = to.id;
  }

  // The stand: one this design and print take.
  if (kind !== 'holder') {
    const offered = standsOffered(s);
    if (!offered.includes(s.stand)) {
      const was = s.stand;
      const to = fallbackStand(offered);
      s.stand = to;
      notices.push({ kind: 'warn', text: `${standWhy(s, was)} Stand changed to ${STAND_NAME[to]}.` });
    }
  }

  // Until the customer sets a size, the letters fill the room the design gives them now.
  if (s.textAuto) s.textSize = autoTextSize(s);
  return { settings: s, notices };
}

function standWhy(s: FrameSettings, was: StandKind): string {
  if (profileOf(s) === 'deep') return 'A deep frame stands on its own or on a kickstand.';
  if ((was === 'block' || was === 'base' || was === 'foot') && SHAPED.includes(outlineOf(s))) return 'A shaped edge has no flat bottom to stand on.';
  if (was === 'magnets') return 'Magnets hold prints up to 4 × 6 in or A6.';
  if (was === 'keychain') return kindOf(s) === 'frame' ? 'A keychain holds prints up to 90 mm long.' : 'This design does not hang from keys.';
  return 'This frame cannot take that stand.';
}

const round1 = (v: number) => String(Math.round(v * 10) / 10);

/* ---------------- words ---------------- */

/** The words fields this design shows now, in the right panel's order. */
export function wordRoles(s: FrameSettings): WordRole[] {
  const kind = kindOf(s);
  if (kind === 'song') return ['song', 'artist', 'length'];
  if (kind === 'post') return ['handle', 'likes', 'postCaption'];
  if (kind === 'holder') return s.holder === 'bar' ? ['front'] : [];
  const out: WordRole[] = [];
  if (crestOf(s)) out.push('initials');
  if (chinOf(s)) out.push('caption', 'second');
  return out;
}

/** "Add words" in place of the words: a frame with a flat face and no wide bottom. */
export const offersAddWords = (s: FrameSettings): boolean => kindOf(s) === 'frame' && s.outline !== 'squiggle' && s.wordsAt === 'none';

/** The longest a field may be, in characters. */
export function maxLength(role: WordRole, s: FrameSettings): number {
  const wide = printOf(s).pw > 72;
  switch (role) {
    case 'caption': return wide ? 40 : 24;
    case 'front': return wide ? 32 : 20;
    case 'initials':
    case 'length': return 5;
    case 'song':
    case 'artist':
    case 'postCaption': return 32;
    default: return 24;
  }
}

/** Whether a field has anything in it but spaces. */
export const typed = (text: string | undefined): boolean => !!text && fromTokens(text).trim() !== '';

/** "3:45" as seconds, or null when it is not a time. */
export function secondsOf(length: string): number | null {
  const m = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(length);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Seconds as "1:25". */
export const clock = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/* ---------------- the build ---------------- */

/** The frame as the geometry knows it. */
export function specOf(s: FrameSettings): FrameSpec {
  const kind = kindOf(s);
  const chin = chinOf(s);
  const lines = chin ? (typed(s.words.caption) ? 1 : 0) + (typed(s.words.second) ? 1 : 0) : 0;
  return {
    outline: outlineOf(s),
    corners: s.corners,
    border: s.border,
    profile: profileOf(s),
    layout: kind === 'song' ? 'music' : kind === 'post' ? 'social' : chin ? 'chin' : 'plain',
    crest: crestOf(s),
    lines,
    chinAt: s.wordsAt === 'top' ? 'top' : 'bottom',
    ...(kind !== 'holder' && s.stand === 'kickstand' ? { kickstands: s.kickstands === '2' ? (2 as const) : (1 as const) } : {}),
    stand: kind === 'holder' ? 'none' : s.stand,
    artist: kind === 'song' && typed(s.words.artist),
    times: kind === 'song' && secondsOf(s.words.length) !== null,
    ...(kind !== 'holder' && s.stand === 'magnets' ? { magnets: { d: magnetById(s.magnet).d, h: magnetById(s.magnet).h, count: s.magnetCount === '4' ? (4 as const) : (2 as const) } } : {}),
    ...(kind !== 'holder' && s.stand === 'keychain' ? { keyring: { dia: s.holeDia, ring: s.holeRing, along: LOOP_ALONG[s.loopAt] } } : {}),
  };
}

/** Where each loop position sits along the top edge: clear of the corners, in from the ends. */
const LOOP_ALONG: Record<LoopAt, number> = { left: 0.16, middle: 0.5, right: 0.84 };

/** The keychain hole's range, mm: a 3 mm jump ring up to an 8 mm clip. The border round it. */
export const HOLE_DIA: [number, number] = [3, 8];
export const HOLE_RING: [number, number] = [1.5, 4];

export function buildSettingsOf(s: FrameSettings): BuildSettings {
  return {
    kind: kindOf(s) === 'holder' ? 'holder' : 'frame',
    photo: s.photo,
    orientation: s.orientation,
    customWidth: s.customWidth,
    customHeight: s.customHeight,
    frame: specOf(s),
    holder: s.holder,
    bodyColor: s.bodyColor,
    inkColor: s.inkColor,
    baseColor: s.baseColor,
    matColor: s.matColor,
  };
}

/** The most letters can ever ask for, mm: past it a short word is all chin. */
const TEXT_MOST = 16;
/** How much of the room's tallest the letters take by themselves. */
const TEXT_SHARE = 0.85;

/**
 * The biggest the first line's letters can be in the room this design leaves for them, mm. A frame
 * with no room for words yet is measured as it would be with them under the photo, so the range
 * never shrinks to nothing (and drags a set size down with it) before any words are added.
 */
export function textSizeMax(s: FrameSettings): number {
  if (kindOf(s) === 'holder') {
    const H = holderLayout(s.holder, printOf(s), true);
    return H.textBox ? captionMax(H.textBox) : TEXT_MOST;
  }
  // Measured with one line, so the range does not move as lines are typed or cleared: a second
  // line makes the first smaller to fit, and says so.
  const spec = specOf(s);
  const L = frameLayout({ ...spec, layout: spec.layout === 'plain' ? 'chin' : spec.layout, lines: 1 }, printOf(s));
  if (L.music) return captionMax(L.music.title);
  if (L.captions[0]) return captionMax(L.captions[0]);
  return TEXT_MOST;
}

/** The letter size the engine picks until the customer sets one: big, most of the room's height,
 *  and long words made smaller to fit the width. */
export function autoTextSize(s: FrameSettings): number {
  return Math.max(FIT.minEm, Math.min(TEXT_MOST, Math.floor(TEXT_SHARE * textSizeMax(s) * 2) / 2));
}



/** The design's name, for the editor's heading and the file. */
export const nameOf = (s: FrameSettings): string => designOf(s).name;

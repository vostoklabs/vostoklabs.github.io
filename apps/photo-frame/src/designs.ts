// The designs the gallery offers: each a finished product someone would download untouched, and
// a starting point whose every setting stays changeable in the editor. One record per design, in
// gallery order. Opening one applies its values through the editor's one state path.
//
// Pure data: the gallery, the editor, the walkthrough and the node test all read it.
import { tokenOf } from './text';
import { printOf, type PrintSettings } from './sizes';
import { DEFAULT_SETTINGS, NO_WORDS, cloneSettings, type FrameSettings, type WordRole, type Words } from './settings';

/** What a design is: a frame round the print, a song plaque, a social post, or a holder the bare
 *  print stands in. Fixed by the design; the editor never turns one into another. */
export type Kind = 'frame' | 'song' | 'post' | 'holder';

export type Category = 'simple' | 'fun' | 'love' | 'music-social' | 'holders' | 'keychains';

export const CATEGORIES: readonly { id: Category; label: string }[] = [
  { id: 'simple', label: 'Simple' },
  { id: 'fun', label: 'Fun' },
  { id: 'love', label: 'Love' },
  { id: 'music-social', label: 'Music & social' },
  { id: 'holders', label: 'Holders' },
  { id: 'keychains', label: 'Keychains' },
];

/** The sample pictures (samples.ts): shown in the preview only, never in a file. */
export type SampleId = 'lake' | 'beach' | 'hills' | 'city';

export interface Design {
  id: string;
  name: string;
  category: Category;
  /** The card's one line. */
  line: string;
  kind: Kind;
  sample: SampleId;
  /** A field this design names in its own words (the Wedding's Names and Date). */
  labels?: Partial<Record<WordRole, { label: string; placeholder: string }>>;
  /** Everything that differs from the defaults, words included. */
  values: Partial<Omit<FrameSettings, 'words' | 'design'>> & { words?: Partial<Words> };
}

/** The Material heart, as the words fields hold it. */
export const HEART = tokenOf('\u{e87d}');

/** The kit's filament colours this file uses, and the pastels this app adds. */
export const C = {
  white: '#f7f7f5',
  black: '#161616',
  red: '#c8102e',
  orange: '#ff6a13',
  yellow: '#f5c518',
  green: '#00ae42',
  cyan: '#0086d6',
  blue: '#0a5cd5',
  purple: '#8e44ad',
  pink: '#e6398b',
  beige: '#d9c8a9',
  blush: '#f2c4c9',
  sky: '#a8d0ec',
  lilac: '#c6b5e3',
  mint: '#a9e0cb',
  peach: '#f8c7a4',
  sage: '#a7bc9c',
  wood: '#c39a6b',
} as const;

/** The pastels, as the colour rows offer them after the kit's own. */
export const PASTELS: readonly (readonly [string, string])[] = [
  ['Blush', C.blush],
  ['Sky', C.sky],
  ['Lilac', C.lilac],
  ['Mint', C.mint],
  ['Peach', C.peach],
  ['Sage', C.sage],
  ['Wood', C.wood],
];

/** A frame with no words: an even border all round. */
const bare = { wordsAt: 'none' } as const;
/** Room for words under the photo. */
const chin = { wordsAt: 'bottom' } as const;

export const DESIGNS: readonly Design[] = [
  // ---- Simple
  {
    id: 'snapshot', name: 'Snapshot', category: 'simple', line: 'Room for words, on a foot', kind: 'frame', sample: 'beach',
    values: { ...chin, corners: 'rounded', stand: 'foot', bodyColor: C.white, inkColor: C.black, baseColor: C.white, words: { caption: 'Summer 2026' } },
  },
  {
    id: 'arch', name: 'Arch', category: 'simple', line: 'Round top in a matching base', kind: 'frame', sample: 'lake',
    values: { ...bare, outline: 'arch', corners: 'rounded', stand: 'block', bodyColor: C.blush, baseColor: C.blush, inkColor: C.black },
  },
  {
    id: 'block', name: 'Block', category: 'simple', line: 'Soft corners in a matching base', kind: 'frame', sample: 'hills',
    values: { ...bare, corners: 'rounded', stand: 'block', bodyColor: C.sky, baseColor: C.sky, inkColor: C.black },
  },
  {
    id: 'soft', name: 'Soft', category: 'simple', line: 'Chunky, with soft corners', kind: 'frame', sample: 'city',
    values: { ...bare, border: 'thick', corners: 'rounded', stand: 'magnets', bodyColor: C.peach, baseColor: C.peach, inkColor: C.black },
  },
  {
    id: 'plain', name: 'Plain', category: 'simple', line: 'White frame, black stand', kind: 'frame', sample: 'beach',
    values: { ...bare, corners: 'square', stand: 'base', bodyColor: C.white, baseColor: C.black, inkColor: C.black },
  },
  {
    id: 'classic', name: 'Classic', category: 'simple', line: 'The everyday picture frame', kind: 'frame', sample: 'lake',
    values: { ...bare, corners: 'square', profile: 'bevel', stand: 'kickstand', photo: '4x6', orientation: 'landscape', bodyColor: C.wood, baseColor: C.wood, inkColor: C.black },
  },
  {
    id: 'studio', name: 'Studio', category: 'simple', line: 'Deep bevel, clean black chin', kind: 'frame', sample: 'city',
    values: { ...chin, corners: 'square', profile: 'bevel', stand: 'kickstand', font: 'montserrat', bodyColor: C.black, baseColor: C.black, inkColor: C.white },
  },
  {
    id: 'shadow-box', name: 'Shadow box', category: 'simple', line: 'A deep box with a mat', kind: 'frame', sample: 'hills',
    values: { ...bare, border: 'thick', corners: 'square', profile: 'deep', stand: 'none', bodyColor: C.sage, baseColor: C.sage, matColor: C.white, inkColor: C.black },
  },
  // ---- Fun
  {
    id: 'scallop', name: 'Scallop', category: 'fun', line: 'Little scallops all round', kind: 'frame', sample: 'beach',
    values: { ...bare, outline: 'scallop', stand: 'magnets', bodyColor: C.purple, baseColor: C.purple, inkColor: C.white },
  },
  {
    id: 'squiggle', name: 'Squiggle', category: 'fun', line: 'Puffy and wavy, for the fridge', kind: 'frame', sample: 'lake',
    values: { ...bare, outline: 'squiggle', border: 'thick', stand: 'magnets', bodyColor: C.mint, baseColor: C.mint, inkColor: C.white },
  },
  {
    id: 'ric-rac', name: 'Ric-rac', category: 'fun', line: 'A wavy trim round white', kind: 'frame', sample: 'hills',
    values: { ...bare, outline: 'ricrac', border: 'thin', stand: 'magnets', bodyColor: C.white, baseColor: C.white, inkColor: C.pink },
  },
  {
    id: 'checks', name: 'Checks', category: 'fun', line: 'Bold two-colour checks', kind: 'frame', sample: 'city',
    values: { ...bare, border: 'thick', corners: 'square', patternOn: true, pattern: 'checkerboard', stand: 'magnets', bodyColor: C.blue, baseColor: C.blue, inkColor: C.white },
  },
  {
    id: 'swirl', name: 'Swirl', category: 'fun', line: 'Big bold swirls', kind: 'frame', sample: 'beach',
    values: { ...bare, border: 'thick', corners: 'round', patternOn: true, pattern: 'truchet', stand: 'magnets', bodyColor: C.cyan, baseColor: C.cyan, inkColor: C.white },
  },
  {
    id: 'blobs', name: 'Blobs', category: 'fun', line: 'Two-colour blobs', kind: 'frame', sample: 'hills',
    values: { ...bare, border: 'thick', corners: 'round', patternOn: true, pattern: 'pm-blobs', patternSize: 80, stand: 'magnets', bodyColor: C.green, baseColor: C.green, inkColor: C.purple },
  },
  {
    id: 'stripes', name: 'Stripes', category: 'fun', line: 'Wavy stripes in two colours', kind: 'frame', sample: 'lake',
    values: { ...bare, border: 'thick', corners: 'square', patternOn: true, pattern: 'pm-waves-3', patternSize: 140, stand: 'magnets', bodyColor: C.yellow, baseColor: C.yellow, inkColor: C.black },
  },
  {
    id: 'deco', name: 'Deco', category: 'fun', line: 'Art deco waves, on a kickstand', kind: 'frame', sample: 'beach',
    values: { ...bare, border: 'thick', corners: 'square', patternOn: true, pattern: 'seigaiha', stand: 'kickstand', bodyColor: C.beige, baseColor: C.beige, inkColor: C.black },
  },
  {
    id: 'starry', name: 'Starry', category: 'fun', line: 'Stars on a night-black frame', kind: 'frame', sample: 'city',
    values: { ...bare, corners: 'rounded', patternOn: true, pattern: 'stars', patternSize: 50, stand: 'base', bodyColor: C.black, baseColor: C.black, inkColor: C.yellow },
  },
  // ---- Love
  {
    id: 'wedding', name: 'Wedding', category: 'love', line: 'Initials on top, names below', kind: 'frame', sample: 'lake',
    labels: { caption: { label: 'Names', placeholder: 'Your names' }, second: { label: 'Date', placeholder: '12.09.2026' } },
    values: { ...chin, crest: true, corners: 'square', stand: 'magnets', font: 'dancing-script', bodyColor: C.wood, baseColor: C.wood, inkColor: C.black, words: { initials: 'M & L', caption: 'Mia & Leo', second: '12.09.2026' } },
  },
  {
    id: 'i-love-you', name: 'I love you', category: 'love', line: 'Your words with a heart', kind: 'frame', sample: 'beach',
    values: { ...chin, corners: 'rounded', stand: 'block', font: 'baloo-2', bodyColor: C.black, baseColor: C.black, inkColor: C.white, words: { caption: `I ${HEART} YOU` } },
  },
  {
    id: 'sweetheart', name: 'Sweetheart', category: 'love', line: 'One heart, nothing else', kind: 'frame', sample: 'hills',
    values: { ...chin, corners: 'rounded', stand: 'foot', bodyColor: C.red, baseColor: C.red, inkColor: C.white, words: { caption: HEART } },
  },
  // ---- Music & social
  {
    id: 'song', name: 'Song', category: 'music-social', line: 'Your song, with a player', kind: 'song', sample: 'city',
    values: { corners: 'rounded', stand: 'base', font: 'poppins', bodyColor: C.black, baseColor: C.black, inkColor: C.white, words: { song: `Our Song ${HEART}`, length: '3:45' } },
  },
  {
    id: 'post', name: 'Post', category: 'music-social', line: 'Your photo as a post', kind: 'post', sample: 'beach',
    values: { corners: 'rounded', stand: 'kickstand', font: 'nunito', photo: 'isq', bodyColor: C.white, baseColor: C.white, inkColor: C.black, words: { handle: 'mia.and.leo', likes: '249 likes' } },
  },
  // ---- Holders
  {
    id: 'ledge', name: 'Ledge', category: 'holders', line: 'A ledge with a date in front', kind: 'holder', sample: 'hills',
    values: { holder: 'bar', font: 'bebas-neue', bodyColor: C.black, baseColor: C.black, inkColor: C.white, words: { front: '26 · 10 · 2026' } },
  },
  {
    id: 'pebble', name: 'Pebble', category: 'holders', line: 'A soft little stand', kind: 'holder', sample: 'lake',
    values: { holder: 'pill', bodyColor: C.orange, baseColor: C.orange, inkColor: C.white },
  },
  {
    id: 'heart', name: 'Heart', category: 'holders', line: 'Your photo in a heart', kind: 'holder', sample: 'beach',
    values: { holder: 'heart', bodyColor: C.pink, baseColor: C.pink, inkColor: C.white },
  },
  // ---- Keychains
  {
    id: 'charm', name: 'Charm', category: 'keychains', line: 'A mini frame for your keys', kind: 'frame', sample: 'hills',
    values: { ...chin, corners: 'rounded', stand: 'keychain', bodyColor: C.lilac, baseColor: C.lilac, inkColor: C.purple, words: { caption: 'Mia' } },
  },
  {
    id: 'slim', name: 'Slim', category: 'keychains', line: 'A thin frame with a loop', kind: 'frame', sample: 'lake',
    values: { ...bare, border: 'thin', corners: 'square', stand: 'keychain', bodyColor: C.green, baseColor: C.green, inkColor: C.white },
  },
];

export const designById = (id: string): Design | undefined => DESIGNS.find((d) => d.id === id);

/** The design a settings object was opened as; the first one if its id is unknown. */
export const designOf = (s: Pick<FrameSettings, 'design'>): Design => designById(s.design) ?? DESIGNS[0]!;

export const kindOf = (s: Pick<FrameSettings, 'design'>): Kind => designOf(s).kind;

/** Two kickstands steady a frame lying wide; one does an upright one. */
export const kickstandsFor = (s: PrintSettings): '1' | '2' => {
  const { pw, ph } = printOf(s);
  return pw > ph ? '2' : '1';
};

/** A design exactly as it opens: the defaults, then its own values and its sample words. */
export function settingsOf(design: Design): FrameSettings {
  const { words, ...rest } = design.values;
  const s = cloneSettings({ ...DEFAULT_SETTINGS, ...rest, design: design.id });
  s.words = { ...NO_WORDS, ...words };
  if (!rest.kickstands) s.kickstands = kickstandsFor(s);
  return s;
}

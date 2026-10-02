import { ICONS, iconById, searchIcons, type IconChoice } from '@vostok/fonts';

/*
  The symbol library, arranged for a person rather than for Font Awesome.

  The registry ships 1392 glyphs in 67 categories, and handing that to someone who
  wants a cat on a pencil is not a feature, it is a filing cabinet. Opening on
  category #1 alphabetically means the first thing anyone saw was "0 1 2 3 4" — a
  library of digits. So:

    - a hand-picked POPULAR set opens the picker, and a dozen of them sit right in
      the sidebar so the common case never needs the picker at all;
    - the 67 categories are folded into a dozen groups with names people use.

  Nothing is hidden: "Everything" is still there, and search still covers all 1392.
*/

export interface SymbolGroup {
  id: string;
  label: string;
  /** Font Awesome category ids this group gathers. Empty = the curated list. */
  cats: string[];
}

/**
 * The first screen. Chosen for what people actually put on a pen: a name needs a
 * heart or a star next to it, a teacher wants an apple, a kid wants a dinosaur.
 * Ordered, not sorted — the good ones go first.
 */
export const POPULAR_IDS = [
  'heart', 'star', 'face-smile', 'face-laugh', 'cat', 'dog', 'paw', 'dragon',
  'fish', 'frog', 'horse', 'crow', 'hippo', 'football', 'futbol', 'basketball',
  'rocket', 'star-of-life', 'crown', 'gem', 'music', 'guitar', 'palette', 'brush',
  'ice-cream', 'pizza-slice', 'apple-whole', 'cake-candles', 'gamepad', 'dice', 'ghost', 'skull',
  'bolt', 'fire', 'sun', 'moon', 'cloud', 'snowflake', 'tree', 'leaf',
  'seedling', 'bug', 'car', 'plane', 'anchor', 'trophy', 'graduation-cap', 'book',
  'pencil', 'lightbulb', 'magnifying-glass', 'wand-magic-sparkles', 'peace', 'yin-yang', 'infinity', 'check',
];

/** The popular set, minus anything the bundled font turned out not to carry. */
export const POPULAR: IconChoice[] = POPULAR_IDS.map((id) => iconById(id)).filter(
  (i): i is IconChoice => !!i,
);

/** The dozen shown inline in the sidebar. */
export const QUICK_PICKS = POPULAR.slice(0, 12);

export const SYMBOL_GROUPS: SymbolGroup[] = [
  { id: 'popular', label: '★ Popular', cats: [] },
  { id: 'smileys', label: 'Smileys', cats: ['emoji'] },
  { id: 'animals', label: 'Animals', cats: ['animals'] },
  { id: 'nature', label: 'Nature & weather', cats: ['nature', 'weather', 'astronomy', 'camping'] },
  { id: 'food', label: 'Food & drink', cats: ['food-beverage', 'fruits-vegetables'] },
  { id: 'sport', label: 'Sport & games', cats: ['sports-fitness', 'gaming'] },
  { id: 'music', label: 'Music & art', cats: ['music-audio', 'design', 'photos-images', 'film-video'] },
  { id: 'school', label: 'School & work', cats: ['education', 'writing', 'business', 'files', 'charts-diagrams', 'science'] },
  { id: 'travel', label: 'Travel & vehicles', cats: ['transportation', 'automotive', 'travel-hotel', 'maritime', 'maps'] },
  { id: 'holidays', label: 'Holidays', cats: ['holidays', 'halloween', 'religion', 'childhood'] },
  { id: 'shapes', label: 'Hearts & shapes', cats: ['shapes', 'punctuation-symbols', 'mathematics', 'alphabet', 'arrows'] },
  { id: 'people', label: 'People & hands', cats: ['users-people', 'hands', 'gender', 'accessibility'] },
  { id: 'tech', label: 'Tech', cats: ['devices-hardware', 'coding', 'connectivity', 'energy', 'media-playback'] },
  { id: 'all', label: `Everything (${ICONS.length})`, cats: ['*'] },
];

/**
 * Search within a group. Falls back to the registry's ranked search for the free-text
 * case, so "cat" still leads with Cat and not with an icon that merely lists it as a
 * synonym.
 */
export function searchGroup(query: string, group?: string): IconChoice[] {
  const g = SYMBOL_GROUPS.find((x) => x.id === group);
  const q = query.trim();

  // Typing searches the whole library. Staying inside a group while someone types a
  // word that is obviously not in it is the kind of "helpful" filtering that reads
  // as the search being broken.
  if (q) return searchIcons(q);

  if (!g || g.id === 'all') return ICONS;
  if (g.id === 'popular') return POPULAR;
  const wanted = new Set(g.cats);
  return ICONS.filter((i) => i.cats.some((c) => wanted.has(c)));
}

import { ICONS, iconById, searchIcons, type IconChoice } from './icons';

/*
  The symbol library, arranged for a person rather than for the icon set.

  The registry ships ~1500 glyphs, and handing that to someone who wants a paw print
  on a pencil is not a feature, it is a filing cabinet. Opening on category #1
  alphabetically means the first thing anyone sees is "Actions" — a library of
  toolbars. So:

    - a hand-picked POPULAR set opens the picker, and a dozen of them sit right in
      the sidebar so the common case never needs the picker at all;
    - the raw categories are folded into a dozen groups with names people use.

  Nothing is hidden: "Everything" is still there, and search still covers all of it.

  ── why the groups carry hand lists ──────────────────────────────────────────────
  Material Symbols is a UI icon set. Its categories are things like "Actions",
  "Text & files" and "Toggles" — there is no Animals category, no Food category and
  no Shapes category, because Google never needed one. Those groups are therefore
  spelled out by id here. The ones the category tree DOES answer well (travel,
  social, devices) still come from `cats`, so they keep up with the registry on
  their own. `pnpm --filter @vostok/fonts typecheck` will not catch a typo in an id,
  but `POPULAR`/`groupIcons` drop anything unknown, so a bad id is a missing tile
  rather than a crash — and `tests/symbols` asserts the lists resolve.
*/

export interface SymbolGroup {
  id: string;
  label: string;
  /** Category ids this group gathers. `['*']` is everything; `[]` uses the fields below. */
  cats: string[];
  /** Explicit members, for the groups the category tree has no answer for. */
  ids?: string[];
  /** Name prefixes to sweep in, e.g. `sports_`, so the group keeps up on its own. */
  prefixes?: string[];
}

/**
 * The first screen. Chosen for what people actually put on a box or a keyring: a
 * name needs a heart or a star next to it, a teacher wants a book, a kid wants a
 * rocket. Ordered, not sorted — the good ones go first.
 */
export const POPULAR_IDS = [
  'favorite', 'star', 'mood', 'sentiment_very_satisfied', 'pets', 'cruelty_free', 'chess_knight', 'rocket',
  'sports_soccer', 'sports_football', 'sports_basketball', 'sports_esports', 'casino', 'emoji_events', 'crown', 'diamond',
  'music_note', 'piano', 'palette', 'brush', 'icecream', 'local_pizza', 'cake', 'nutrition',
  'skull', 'bolt', 'local_fire_department', 'sunny', 'bedtime', 'cloud', 'ac_unit', 'water_drop',
  'park', 'eco', 'potted_plant', 'local_florist', 'bug_report', 'directions_car', 'flight', 'anchor',
  'sailing', 'school', 'menu_book', 'auto_stories', 'edit', 'lightbulb', 'science', 'search',
  'auto_awesome', 'celebration', 'redeem', 'card_giftcard', 'all_inclusive', 'handshake', 'check', 'home',
];

/** The popular set, minus anything the bundled font turned out not to carry. */
export const POPULAR: IconChoice[] = POPULAR_IDS.map((id) => iconById(id)).filter(
  (i): i is IconChoice => !!i,
);

/** The dozen shown inline in the sidebar. */
export const QUICK_PICKS = POPULAR.slice(0, 12);

export const SYMBOL_GROUPS: SymbolGroup[] = [
  { id: 'popular', label: '★ Popular', cats: [] },
  {
    id: 'smileys', label: 'Smileys', cats: [],
    prefixes: ['sentiment_', 'mood', 'face_', 'emoji_'],
    ids: ['add_reaction', 'thumb_up', 'thumb_down', 'favorite', 'sick', 'psychology', 'self_improvement'],
  },
  {
    id: 'animals', label: 'Animals & bugs', cats: [],
    // Honestly short. A UI icon set has a paw, a rabbit and a horse's head, and
    // that is the whole zoo — there is no cat, dog, frog or butterfly to offer.
    ids: ['pets', 'pet_supplies', 'cruelty_free', 'chess_knight', 'bug_report', 'egg', 'flutter_dash', 'savings'],
  },
  {
    id: 'nature', label: 'Nature & weather', cats: [],
    ids: [
      'park', 'forest', 'nature', 'eco', 'energy_savings_leaf', 'potted_plant', 'local_florist', 'yard',
      'grass', 'compost', 'water_drop', 'waves', 'terrain', 'volcano', 'tsunami', 'panorama',
      'sunny', 'clear_day', 'cloud', 'rainy', 'snowing', 'ac_unit', 'thunderstorm',
      'foggy', 'bedtime', 'nightlight', 'mode_night', 'star', 'routine',
    ],
  },
  {
    id: 'food', label: 'Food & drink', cats: [],
    ids: [
      'local_pizza', 'icecream', 'cake', 'bakery_dining', 'lunch_dining', 'dinner_dining', 'brunch_dining',
      'breakfast_dining', 'ramen_dining', 'rice_bowl', 'set_meal', 'kebab_dining', 'tapas', 'soup_kitchen',
      'egg', 'nutrition', 'local_cafe', 'local_bar', 'liquor', 'wine_bar', 'local_drink', 'local_dining',
      'restaurant', 'fastfood', 'local_grocery_store',
    ],
  },
  { id: 'sport', label: 'Sport & games', cats: [], prefixes: ['sports_', 'chess'], ids: ['casino', 'toys', 'toys_and_games', 'smart_toy', 'games', 'videogame_asset', 'emoji_events'] },
  {
    id: 'music', label: 'Music & art', cats: ['av', 'images'],
    ids: ['music_note', 'piano', 'mic', 'headphones', 'queue_music', 'library_music', 'album', 'radio', 'speaker', 'graphic_eq', 'palette', 'brush', 'draw', 'colorize', 'photo_camera', 'movie', 'theaters'],
  },
  {
    id: 'school', label: 'School & work', cats: ['business', 'text'],
    ids: ['school', 'menu_book', 'auto_stories', 'science', 'biotech', 'calculate', 'functions', 'psychology', 'history_edu', 'backpack', 'edit', 'design_services', 'architecture', 'engineering', 'construction', 'build', 'handyman', 'agriculture'],
  },
  { id: 'travel', label: 'Travel & places', cats: ['travel', 'maps'] },
  {
    id: 'holidays', label: 'Holidays & gifts', cats: [],
    ids: ['celebration', 'redeem', 'card_giftcard', 'festival', 'cake', 'attractions', 'nightlife', 'local_activity', 'local_play', 'local_see', 'local_offer', 'ac_unit', 'skull'],
  },
  {
    id: 'shapes', label: 'Hearts & shapes', cats: [],
    ids: ['favorite', 'star', 'circle', 'square', 'hexagon', 'pentagon', 'rectangle', 'change_history', 'diamond', 'token', 'crown', 'skull', 'bolt', 'whatshot', 'all_inclusive', 'auto_awesome', 'flare', 'shapes'],
  },
  { id: 'people', label: 'People & hands', cats: ['social'], prefixes: ['person', 'family_', 'diversity_'], ids: ['group', 'groups', 'waving_hand', 'handshake', 'folded_hands', 'volunteer_activism', 'accessible', 'elderly', 'child_care', 'pregnant_woman'] },
  { id: 'tech', label: 'Tech', cats: ['hardware'] },
  { id: 'all', label: `Everything (${ICONS.length})`, cats: ['*'] },
];

/** Everything a group holds, de-duplicated, in registry order. */
function groupIcons(g: SymbolGroup): IconChoice[] {
  if (g.cats.includes('*')) return ICONS;
  if (g.id === 'popular') return POPULAR;
  const wanted = new Set(g.ids ?? []);
  const cats = new Set(g.cats);
  const prefixes = g.prefixes ?? [];
  return ICONS.filter(
    (i) =>
      wanted.has(i.id) ||
      i.cats.some((c) => cats.has(c)) ||
      prefixes.some((p) => i.id.startsWith(p)),
  );
}

/**
 * Search within a group. Falls back to the registry's ranked search for the free-text
 * case, so "star" still leads with Star and not with an icon that merely lists it as a
 * synonym.
 */
export function searchGroup(query: string, group?: string): IconChoice[] {
  const g = SYMBOL_GROUPS.find((x) => x.id === group);
  const q = query.trim();

  // Typing searches the whole library. Staying inside a group while someone types a
  // word that is obviously not in it is the kind of "helpful" filtering that reads
  // as the search being broken.
  if (q) return searchIcons(q);

  if (!g) return ICONS;
  return groupIcons(g);
}

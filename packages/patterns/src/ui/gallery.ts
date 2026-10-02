// The pattern gallery: Pattern Monster's own picker, in the house chrome — shared by every app
// that fills shapes with patterns (`@vostok/patterns/ui`), so every app that fills shapes with
// patterns opens the same dialog.
//
// The site it is modelled on shows every tile as a big card that IS the pattern, with the name
// on a pill at the foot of it, and a row of subjects across the top. That is the whole of why
// its 330 tiles are browsable and a 330-row dropdown is not — you pick a pattern by looking at
// it. So the cards here are drawn by the library's own renderer (`tileSvg`, an exact clone of
// the site's `svgPattern()`), the procedural patterns join them as cards of the same size, and
// the subjects are derived from the tags the index carries.
//
// The geometry (~900 KB) is loaded on the first open and never again; the INDEX — every tile's
// name, mode, tags and ranges — is small and ships with the app, so the search, the subjects
// and the titles all work before a byte of path data arrives.
import {
  FAMILY_LABELS,
  PATTERNS,
  thumbPath,
  type PatternDef,
} from '../index';
import libraryIndex from '../../data/pattern-monster-index.json';
import { isHiddenTile } from '../library/tuning';
import './gallery.css';
import {
  ICONS,
  chip,
  dialog,
  el,
  emptyState,
  svgPathEl,
  textField,
  themeColorHex,
  thumbGrid,
  thumbTile,
} from '@vostok/ui-kit';

/* ------------------------------------------------------------------ the index -- */

export interface TileMeta {
  id: string;
  title: string;
  mode: 'stroke' | 'stroke-join' | 'fill';
  maxStroke: number;
  maxSpacing: [number, number];
  tags: string[];
  /** Left out of the picker (`TILE_TUNING`); a design that names it still builds. */
  hidden: boolean;
}

/* The JSON's own shape. `maxSpacing` is a plain array there and a pair here; nothing else in
   the file is read, so the rest of each row stays untyped rather than restated. */
interface RawTile {
  id: string;
  title: string;
  mode: string;
  maxStroke: number;
  maxSpacing: number[];
  tags: string[];
}

/** Every library tile, named and tagged, without its geometry. Ids carry the `pm-` prefix the
 *  template stores, so nothing downstream has to remember which half of the name it holds. */
export const TILE_INDEX: TileMeta[] = (libraryIndex as unknown as { tiles: RawTile[] }).tiles.map((t) => ({
  id: `pm-${t.id}`,
  title: t.title,
  mode: t.mode === 'fill' || t.mode === 'stroke-join' ? t.mode : 'stroke',
  maxStroke: t.maxStroke,
  maxSpacing: [t.maxSpacing[0] ?? 0, t.maxSpacing[1] ?? 0],
  tags: t.tags,
  hidden: isHiddenTile(t.id),
}));

const metaById = new Map(TILE_INDEX.map((t) => [t.id, t] as const));

/** The metadata of a library tile, by `pm-` id. `undefined` for a procedural pattern. */
export const tileMeta = (id: string): TileMeta | undefined => metaById.get(id);

/** The procedural patterns — everything the engine draws from maths. */
const builtIns = (): PatternDef[] => PATTERNS.filter((p) => p.family !== 'library');

/** The name to show for any pattern id, without loading the library. */
export function patternTitle(id: string): string {
  return metaById.get(id)?.title ?? PATTERNS.find((p) => p.id === id)?.name ?? 'Pattern';
}

type LibraryModule = typeof import('../library/index');
let libraryLoad: Promise<LibraryModule> | null = null;

/** The tile geometry, fetched once. The dynamic import is its own cache; this is only so two
 *  callers in one frame do not both ask. */
export function loadPatternLibrary(): Promise<LibraryModule> {
  libraryLoad ??= import('../library/index');
  return libraryLoad;
}

/* ----------------------------------------------------------------- the colours -- */

/* A card is the theme's own surface with the accent drawn on it — the same arrangement
   Pattern Monster uses (one ground, one saturated hue), read live so the gallery is part of
   the studio in both themes rather than a sheet of stamps pasted onto it. The tan-plate and
   burn-brown of the 2D preview were the alternative and lose: brown hairlines on tan at the
   gallery's stroke of 1 all but vanish (hexagons, waves, diamonds), and the same tan reads as
   foreign on a dark dialog. Never a copied hex — `themeColorHex` is the only way in. */
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const cardBg = (): string => hex(themeColorHex('--panel-2', 0x1e2735));
const cardFg = (): string => hex(themeColorHex('--accent', 0x5b9dff));

/* ------------------------------------------------------------------- the cards -- */

const thumbCache = new Map<string, string>();

/** A procedural pattern as the card's art: its 40 × 40 picker tile, blown up to cover. */
function proceduralArt(def: PatternDef): SVGSVGElement {
  let d = thumbCache.get(def.id);
  if (d === undefined) {
    d = thumbPath(def).d;
    thumbCache.set(def.id, d);
  }
  const svg = svgPathEl(d, 40);
  // `slice`, so the tile fills the 3:2 card the way a repeat does, instead of sitting in the
  // middle of it with air either side.
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  return svg;
}

/* Which paint each host is waiting for. A library tile arrives a microtask later than the call
   that asked for it, so two quick changes of pattern can land out of order — the form's preview
   card would then be showing the one before last, under the right name. */
const paintToken = new WeakMap<HTMLElement, number>();
let paintSeq = 0;

/** Put this drawing in, replacing the last one and leaving the host's other children alone —
 *  the gallery card's title pill is a sibling of the art, not part of it. */
function place(host: HTMLElement, svg: Node | null): void {
  const old = host.querySelector('svg');
  if (old && svg) old.replaceWith(svg);
  else if (old) old.remove();
  else if (svg) host.prepend(svg);
}

/**
 * Draw a pattern into an element you own — the gallery's cards and the form's preview card.
 *
 * A library tile needs its path data, so the call returns before it and the drawing lands when
 * the import does. The markup comes from `tileSvg`, which paints with presentation attributes
 * only: no `style=""` anywhere, because a CSP that forbids inline styles drops those
 * silently and the card would come back blank.
 */
export function paintPattern(host: HTMLElement, id: string): void {
  const token = ++paintSeq;
  paintToken.set(host, token);
  const def = PATTERNS.find((p) => p.id === id);
  if (def && def.family !== 'library') {
    place(host, proceduralArt(def));
    return;
  }
  // Clear first: a stale pattern under a new name is worse than a blank card for a frame.
  place(host, null);
  void loadPatternLibrary().then((lib) => {
    if (paintToken.get(host) !== token) return;
    const tile = lib.tileById(id);
    if (!tile) return;
    const markup = lib.tileSvg(tile, { colours: [cardBg(), cardFg()], scale: 1, stroke: 1 }, '100%', '100%');
    // DOMParser rather than innerHTML, so the host's other children survive the paint.
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
    if (parsed.nodeName === 'svg') place(host, document.importNode(parsed, true));
  });
}

/* ---------------------------------------------------------------- the subjects -- */

/* Twelve subjects over 101 raw tags, chosen to cover the catalogue rather than to mirror it:
   a tab list as long as the tag list is a second gallery to browse. Geometric takes the
   untagged tiles too — Pattern Monster's own "New Pattern - n" are all geometric, and a tile
   reachable only from All is a tile nobody finds. */
interface Subject {
  label: string;
  tags: string[];
  /** Also claim the tiles that carry no tags at all. */
  untagged?: boolean;
}

const SUBJECTS: Subject[] = [
  { label: 'Hexagons', tags: ['hexagon', 'hexagons', 'overlapping hexagons', 'interlocked'] },
  { label: 'Triangles', tags: ['triangles', 'inverted triangles', 'squares & triangles', 'chevron'] },
  { label: 'Diamonds & squares', tags: ['diamonds', 'diamond', 'rhombus', 'squares', 'squares & squares', 'squares & diamonds', 'squares & circles', 'squares & plus', 'squares & stars', 'rectangles & squares', 'checkerboard', 'brick wall', 'cubes', 'adjointed diamonds', 'tiles', 'octagons'] },
  { label: 'Circles & dots', tags: ['circles', 'concentric circles', 'double bubbles', 'adjointed circles', 'semicircles', 'eyes', 'blobs'] },
  { label: 'Lines & stripes', tags: ['lines', 'straight lines', 'stripes', 'herringbone', 'railroad', 'pipes', 'zebra', 'squiggle', 'greek key', 'cross', 'plus', 'bamboo', 'rope', 'cane'] },
  { label: 'Waves & scales', tags: ['waves', 'curves', 'scales', 'clouds', 'fish'] },
  { label: 'Japanese & Chinese', tags: ['japanese pattern', 'chinese pattern', 'sashiko', 'lanterns'] },
  { label: 'Geometric', tags: ['geometric', 'memphis pattern', 'terrazzo', 'mosaic', 'jigsaw', 'puzzle', 'cross section', 'patches', 'stars', 'stars & lines'], untagged: true },
  { label: 'Leaves & flowers', tags: ['leaves', 'flower', 'floral', 'tree'] },
  { label: 'Plaid & textile', tags: ['plaid pattern', 'tartan', 'buffalo', 'batik pattern', 'songket pattern', 'malaysia', 'doodle pattern'] },
  { label: 'Ethnic & tribal', tags: ['tribal', 'ethnic', 'tribal pattern', 'ethnic pattern', 'african pattern', 'egyptian pattern', 'mexican pattern', 'moroccan'] },
  { label: 'Holidays', tags: ['christmas', 'holidays', 'santaclaus', 'jingle', 'bells', 'gift', 'halloween', 'pumpkin', 'bats', 'skull', 'trick', 'treat', 'candy', 'winter', 'snowflakes', 'sprinkles'] },
];

/* -------------------------------------------------------------------- the list -- */

interface Entry {
  id: string;
  title: string;
  /** What the laser does with it, under the card. */
  foot: string;
  /** Lower-cased title + tags, for the search. */
  haystack: string;
  library: boolean;
  tags: string[];
}

// The picker's wall: every tile but the hidden.
const LIBRARY_ENTRIES: Entry[] = TILE_INDEX.filter((t) => !t.hidden).map((t) => ({
  id: t.id,
  title: t.title,
  foot: t.mode === 'fill' ? 'fill · engrave / cut' : 'lines · score / engrave',
  haystack: `${t.title} ${t.tags.join(' ')}`.toLowerCase(),
  library: true,
  tags: t.tags,
}));

const builtInEntries = (): Entry[] =>
  builtIns().map((d) => ({
    id: d.id,
    title: d.name,
    foot: FAMILY_LABELS[d.family],
    haystack: `${d.name} ${(d.tags ?? []).join(' ')} ${FAMILY_LABELS[d.family]}`.toLowerCase(),
    library: false,
    tags: d.tags ?? [],
  }));

/* ------------------------------------------------------------------ the dialog -- */

/** How many cards go in before the next idle slice. 330 tiny SVGs is not a lot, but the first
 *  paint should not wait for the last of them. */
const CHUNK = 60;
const idle: (fn: () => void) => void =
  typeof requestIdleCallback === 'function' ? (fn) => void requestIdleCallback(fn) : (fn) => void setTimeout(fn, 0);

/**
 * The picker. `current` is marked; `onPick` gets the chosen id and the dialog closes.
 * Escape and the backdrop close it too — that is the kit dialog's own behaviour.
 */
export function openPatternGallery(current: string, onPick: (id: string) => void): void {
  let query = '';
  let subject: Subject | 'all' | 'built-in' = 'all';
  let loaded = false;
  let generation = 0;

  const host = el('div', { className: 'vp-pattern-grid' });
  const status = el('p', { className: 'vl-hint', text: `Loading ${LIBRARY_ENTRIES.length} Pattern Monster tiles…` });

  const search = textField({
    label: '',
    type: 'search',
    placeholder: `Search ${LIBRARY_ENTRIES.length + builtIns().length} patterns`,
    title: 'Search by name or subject',
    onInput: (v) => { query = v.trim().toLowerCase(); render(); },
  });

  const tabs = el('div', { className: 'vp-pattern-tabs' });
  const chips: { node: HTMLElement & { setPressed(p: boolean): void }; value: Subject | 'all' | 'built-in' }[] = [];
  const addTab = (label: string, value: Subject | 'all' | 'built-in') => {
    const node = chip({
      label,
      pressed: value === subject,
      onToggle: () => {
        subject = value;
        for (const c of chips) c.node.setPressed(c.value === value);
        render();
      },
    });
    chips.push({ node, value });
    tabs.append(node);
  };
  addTab('All', 'all');
  addTab('Built-in', 'built-in');
  for (const s of SUBJECTS) addTab(s.label, s);

  function matches(e: Entry): boolean {
    const s = subject;
    if (s === 'built-in' && e.library) return false;
    if (s !== 'all' && s !== 'built-in') {
      // A subject is a shelf of the tile library; the procedural patterns have their own tab.
      if (!e.library) return false;
      if (!e.tags.some((t) => s.tags.includes(t)) && !(s.untagged === true && e.tags.length === 0)) return false;
    }
    return !query || e.haystack.includes(query);
  }

  function card(e: Entry): HTMLElement {
    const art = el('div', { className: 'vp-pattern-card__art' });
    paintPattern(art, e.id);
    art.append(el('span', { className: 'vp-pattern-card__pill', text: e.title }));
    const tile = thumbTile({
      label: e.title,
      selected: e.id === current,
      className: 'vp-pattern-card',
      onClick: () => { handle.close(); onPick(e.id); },
    });
    tile.append(art, el('span', { className: 'vp-pattern-card__foot', text: e.foot }));
    return tile;
  }

  function render() {
    const mine = ++generation;
    const list = [...builtInEntries(), ...(loaded ? LIBRARY_ENTRIES : [])].filter(matches);
    status.hidden = loaded;
    if (!list.length) {
      host.replaceChildren(emptyState({
        title: loaded ? 'No pattern by that name' : 'Fetching the tiles…',
        body: loaded ? 'Try a shape — "hexagon", "waves", "plaid" — or pick a subject above.' : 'The 330 Pattern Monster tiles are on their way.',
        icon: ICONS.search,
      }));
      return;
    }
    // The wide dialog fits three cards across; `minPx` is what decides that, not a media query.
    const grid = thumbGrid({ tiles: list.slice(0, CHUNK).map(card), minPx: 200, aspect: 'auto' });
    host.replaceChildren(grid);
    const inner = grid.querySelector('.vl-thumb-grid');
    let next = CHUNK;
    const more = () => {
      if (mine !== generation || !inner) return;
      inner.append(...list.slice(next, next + CHUNK).map(card));
      next += CHUNK;
      if (next < list.length) idle(more);
    };
    if (next < list.length) idle(more);
  }

  render();
  if (!loaded) {
    void loadPatternLibrary()
      .then(() => { loaded = true; render(); })
      // A chunk that never arrives must not leave "Loading…" sitting there for ever: the
      // procedural half is already on screen and still works.
      .catch(() => { status.textContent = 'The tile library could not be loaded — the built-in patterns are still here.'; });
  }

  const content = el('div', { className: 'vp-pattern-picker' }, [search, tabs, status, host]);
  const handle = dialog({ title: 'Choose a pattern', content, size: 'wide', actions: [{ label: 'Cancel' }] });
  // The dialog focuses its first button, which here is the "All" chip. The search is what a
  // customer who already knows what they want reaches for, so it takes the focus back.
  search.field.focus();
}

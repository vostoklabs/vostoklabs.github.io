// Song keychain: a portrait plate engraved as a music player's "now playing" screen — the song
// and the artist, a heart, a progress bar with the elapsed and remaining times, the five
// controls — and a code underneath that plays the song.
//
// NO BRAND. The look is every music app's and belongs to none of them: the glyphs are drawn in
// `../engine/player-glyphs.ts` from strokes and triangles, and the copy says "song", "music" and
// "your music app". We never generate an app's own scan code (for copyright reasons), so the
// Code control offers exactly four things:
//
//   QR     a QR code of the song's link, encoded offline, as wide as the plate allows.
//   Your code  the customer's OWN code image, dropped as an SVG, fitted into a wide area (those
//          codes are about 4 : 1) — or its own proportion, up to square.
//   Empty  that wide area kept bare, for a sticker or a code added later.
//   None   no area; the plate stops under the controls.
//
// THE PLATE (the numbers). 40 mm wide, because that is the photo's plate beside a 25 mm split
// ring and the narrowest one on which the default QR keeps a 1 mm module with its full quiet zone
// (29 + 8 modules across 37 mm). Its HEIGHT is whatever the content needs, top to bottom: the
// ring's keep-off, the player, the code — 75.6 mm at the defaults, against the photo's 1 : 1.84
// (73.6 at 40 wide) with the photo's screw eye traded for a hole through the plate. Every size
// on the plate is a share of the width, floored: 3 mm of capital for the song and the artist,
// 2.5 mm for the two times (the business card's detail floor), a 0.4 mm stroke for a glyph.
//
// THE CODE. The quiet zone is four modules of BARE wood on every side, and the block it bounds
// stops QR_EDGE short of the plate's edge so the burn at the outline never eats into it
// (laser-cutting-knowledge §14.3); a hole dragged onto the block or the code band warns, since
// the engine's lettering net cannot see bare wood. The house decides everything else about the
// code — the module styles, toughness, the burn floors per style — through `qr-shared.ts`;
// nothing here re-derives them.
import { bboxOf, placeShapes, roundedRectRing, signedArea, type Box, type Pt, type Shapes } from '@vostok/laser';
import { finalHoleCentre } from '../engine/editorGeometry';
import { QR_MIN_CELL, qrMinSize } from '../engine/qr';
import { glyphLayers, symbolLayer } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import {
  heartGlyph, nextGlyph, playGlyph, previousGlyph, timelineBar, repeatGlyph, shuffleGlyph,
} from '../engine/player-glyphs';
import type { DesignLayer } from '../engine/types';
import { readSymbols, type SymbolMap } from '../symbols/model';
import { keyringFields, keyringFrom } from './keyring';
import { QUIET, clamp, qrCodeFields, qrLayers, readQr, round1 } from './qr-shared';
import { SAMPLE_SITE, stem } from './shared';
import { bool, num, str, type Field, type TemplateDef, type Values } from './types';

type CodeMode = 'qr' | 'svg' | 'space' | 'none';
const codeOf = (v: Values): CodeMode => (['qr', 'svg', 'space', 'none'].includes(str(v, 'codeMode')) ? str(v, 'codeMode') as CodeMode : 'qr');
const isMode = (m: CodeMode) => (v: Values) => codeOf(v) === m;

/** Width the design is drawn at; every size below scales from here. */
const BASE_W = 40;
/** Capitals of the song and the artist never go under this unasked — the house's engraved floor. */
const TEXT_FLOOR = 3;
/** The two times are detail, like a card's phone number: the business card's 2.5 mm floor. */
const TIME_FLOOR = 2.5;
/** Air between the quiet zone and the plate's edge, mm. The quiet zone is the scanner's; this
 *  is the burn's, so a charred edge never reaches the four blank modules. */
const QR_EDGE = 1.5;
/** Air between the ring's keep-off disc and the song's capitals, mm. */
const RING_AIR = 0.6;
/** How far a descender reaches below its baseline, as a share of the cap height — the room a
 *  line keeps under it before the next thing starts. Figtree's "g" is 0.30; the deepest on the
 *  list, Manrope's, is 0.35, and the millimetre of air under every row absorbs the difference. */
const DESC = 0.3;
/** Baseline to baseline when a long title or artist takes two lines, as a share of the cap. */
const LINE_PITCH = 1.5;
/** The song's weight: its outline grown by this share of its cap height — bold against the
 *  artist's regular, in ONE face (the house's two-typeface limit is not spent on a weight). */
const TITLE_BOLD = 0.03;
/** A code image's finest line under this does not engrave cleanly, mm. */
const CODE_FINEST = 0.45;
/** The artist is set this share of the song's cap, floored — never larger than the song. */
const ARTIST_OF_TITLE = 0.85;
/** One island of a code image covering more than this share of the code's box is a background
 *  card, not a bar: the file was saved light-on-dark and the importer kept the card. */
const CODE_SOLID = 0.4;
/** Lines a song or an artist may take before it shrinks under the floor. */
const MAX_LINES = 3;

/** The player's proportions at `w` mm wide. The glyph sizes are the photo's, lifted to the floors. */
function metricsFor(w: number) {
  const k = w / BASE_W;
  return {
    edge: Math.max(3.5, 0.1 * w),
    title: Math.max(TEXT_FLOOR, 3.6 * k),
    artist: Math.max(TEXT_FLOOR, 3 * k),
    time: Math.max(TIME_FLOOR, 2.5 * k),
    heart: 3.4 * k,
    knob: 2.4 * k,
    thick: 0.9 * k,
    thin: 0.5 * k,
    play: 6.5 * k,
    glyph: Math.max(2.6, 3 * k),
  };
}

// ------------------------------------------------------------------ time --

/** "3:25" or "1:02:05" → seconds; null when it is not a time. */
export function parseTime(s: string): number | null {
  const m = /^\s*(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)\s*$/.exec(s);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Seconds → "m:ss", or "h:mm:ss" past the hour. */
export function formatTime(t: number): string {
  const s = Math.max(0, Math.round(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// ------------------------------------------------------------------ lines of type --

interface Line {
  shapes: Shapes;
  /** Ink box, in the frame the shapes came back in (centred on the ink). */
  minX: number;
  maxX: number;
  /** The baseline's y in that same frame. */
  base: number;
}

/** One line of type at a cap height, with its baseline — found as the resting height of a
 *  trailing space, which has no ink and so sits exactly on the line (`glyphLayers`).
 *
 *  `bold` is the grow the line will be engraved with, as a share of its cap. Every gap between
 *  two letters is opened by exactly the width the grow takes out of it, so a bold line keeps
 *  the face's own spacing and no two letters the type designer kept apart are welded shut. */
async function setLine(text: string, font: string, cap: number, symbols: SymbolMap, bold = 0): Promise<Line | null> {
  const size = await sizeForCapHeight(font, cap);
  const run = await glyphLayers({ text: `${text} `, font, size, symbols, letterSpacing: (2 * bold * cap) / size });
  const shapes = run.flatMap((g) => g.shapes);
  if (!shapes.length) return null;
  const b = bboxOf(shapes);
  return { shapes, minX: b.minX, maxX: b.maxX, base: run[run.length - 1]!.box.minY };
}

const widthOf = (l: Line) => l.maxX - l.minX;

interface Fitted { lines: Line[]; cap: number }

/** Every way to break `n` words into `lines` runs, each run at least one word: the break points. */
function* breaks(n: number, lines: number, from = 1): Generator<number[]> {
  if (lines === 1) { yield []; return; }
  for (let i = from; i <= n - lines + 1; i++) for (const rest of breaks(n, lines - 1, i + 1)) yield [i, ...rest];
}

/**
 * A line of type in `avail` mm: whole at `cap` when it fits, shrunk while it stays at or above
 * `floor`, and past that broken at the spaces that best balance it onto two lines — then three —
 * a song title is often five or six words, and "I Wanna Dance with Somebody" at 3 mm is 48 mm
 * long. Every line after the first may run `avail2` wide (the song's first line shares its row
 * with the heart; the others do not). Only when three lines do not reach the floor either does
 * it shrink under it, and the caller says so.
 */
async function fitLines(text: string, font: string, cap: number, avail: number, avail2: number, floor: number, symbols: SymbolMap, bold = 0): Promise<Fitted> {
  const t = text.trim();
  if (!t) return { lines: [], cap };
  // Each run of words is set once, however many splits it turns up in.
  const cache = new Map<string, Promise<Line | null>>();
  const set = (s: string) => {
    let p = cache.get(s);
    if (!p) cache.set(s, (p = setLine(s, font, cap, symbols, bold)));
    return p;
  };
  const one = await set(t);
  if (!one) return { lines: [], cap };
  if (widthOf(one) <= avail) return { lines: [one], cap };

  // The split that needs the least shrinking, each line measured against its own width; among
  // splits that need none, the most even ("Florence and / the Machine"). One more line only
  // when the fewer did not reach the floor, and only when it sets the type bigger.
  const words = t.split(/\s+/);
  let best = { texts: [t], k: avail / widthOf(one), wide: widthOf(one) };
  for (let n = 2; n <= Math.min(MAX_LINES, words.length) && cap * best.k < floor - 1e-6; n++) {
    let pick: typeof best | null = null;
    for (const split of breaks(words.length, n)) {
      const cuts = [0, ...split, words.length];
      const texts = cuts.slice(1).map((e, i) => words.slice(cuts[i], e).join(' '));
      const lines = await Promise.all(texts.map(set));
      if (lines.some((l) => !l)) continue;
      const k = Math.min(1, ...lines.map((l, i) => (i ? avail2 : avail) / widthOf(l!)));
      const wide = Math.max(...lines.map((l) => widthOf(l!)));
      if (!pick || k > pick.k + 1e-9 || (Math.abs(k - pick.k) <= 1e-9 && wide < pick.wide)) pick = { texts, k, wide };
    }
    if (pick && pick.k > best.k + 1e-9) best = pick;
  }
  if (best.k >= 1 - 1e-9) return { lines: (await Promise.all(best.texts.map(set))) as Line[], cap };
  const c = cap * best.k;
  return { lines: (await Promise.all(best.texts.map((s) => setLine(s, font, c, symbols, bold)))) as Line[], cap: c };
}

/** A line moved so its ink starts (or, `right`, ends) at `x` and its baseline is at `y`. */
const placeLine = (l: Line, x: number, y: number, align: 'left' | 'right' = 'left'): Shapes =>
  placeShapes(l.shapes, x - (align === 'left' ? l.minX : l.maxX), y - l.base, 0);

/** Glyph islands moved to (x, y). */
const at = (shapes: Shapes, x: number, y: number): Shapes => placeShapes(shapes, x, y, 0);

/** The short side of every island, mm — what the finest line of a code image measures. */
const finestOf = (shapes: Shapes) =>
  Math.min(...shapes.map((isl) => { const b = bboxOf([isl]); return Math.min(b.maxX - b.minX, b.maxY - b.minY); }));

/** An island's own area: its outer ring (the biggest, whichever order they came in) less its holes. */
const areaOf = (isl: Shapes[number]) => {
  const a = isl.map((r) => Math.abs(signedArea(r)));
  const outer = Math.max(...a);
  return 2 * outer - a.reduce((s, x) => s + x, 0);
};

/** How near a point comes to a box: 0 inside it. */
const reachTo = (b: Box, [x, y]: Pt) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minY - y, 0, y - b.maxY));

/** The QR block's inset from the plate's edge: QR_EDGE, or more where a big corner radius would
 *  otherwise round off the block's corner — the corner keeps half a millimetre of wood. */
const qrEdgeFor = (r: number) => Math.max(QR_EDGE, r - (r - 0.5) / Math.SQRT2);

// ------------------------------------------------------------------ the form --

/**
 * Clean sans faces that hold a 3 mm engraved capital, each built at the default and at real
 * four- and five-word titles and looked at before it went on the list (tests/node/
 * song-keychain.test.mjs, the fonts section). Figtree leads: a rounded
 * geometric sans. Montserrat and Poppins were tried and dropped — they set "Here Comes the Sun"
 * 13 % wider than Figtree, which on a 40 mm plate is the difference between two 3.3 mm lines
 * and a title under the floor.
 */
const FACES = ['figtree', 'manrope', 'outfit', 'inter', 'rubik', 'lexend'];
const DEFAULT_FONT = FACES[0]!;

/** The house QR controls — style, toughness, invert — without the size (the plate sets it) or
 *  the symbol in the middle (a keychain's code is too small to spend modules on one). */
const qrFields = (): Field[] => qrCodeFields({ key: 'qrSize', value: 30, min: 10, max: 60 })
  .filter((f) => f.key !== 'qrSize' && f.key !== 'symbolSize')
  .map((f) => ({ ...f, visibleWhen: (v: Values) => isMode('qr')(v) && (f.visibleWhen ? f.visibleWhen(v) : true) }) as Field);

const FIELDS: Field[] = [
  // ------------------------------------------------------------------ RIGHT: what you type --
  { kind: 'text', key: 'title', label: 'Song', panel: 'right', section: 'Song', value: 'Any Song', placeholder: 'The song’s title', maxLength: 48 },
  { kind: 'text', key: 'artist', label: 'Artist', panel: 'right', section: 'Song', value: 'Any Artist', placeholder: 'Who it’s by', maxLength: 48 },
  {
    kind: 'text', key: 'length', label: 'Length', panel: 'right', section: 'Song', value: '3:25', placeholder: 'm:ss',
    maxLength: 8, symbols: false, help: 'Minutes and seconds; the two times follow Progress.',
  },
  // A sample that encodes, so the card shows a code that scans: on the shared placeholder site
  // (`SAMPLE_SITE`), plainly not a real song and nobody's page.
  {
    kind: 'text', key: 'link', label: 'Song link', panel: 'right', section: 'Song', value: `${SAMPLE_SITE}/song`,
    placeholder: 'Paste the song’s share link', symbols: false, visibleWhen: isMode('qr'),
  },
  {
    kind: 'svg', key: 'codeArt', label: 'Your code', panel: 'right', section: 'Song', value: '',
    // Which way round is the one thing the customer can get wrong: the importer takes white for
    // paper, so light bars on a coloured card come in as the card alone.
    help: 'Save your music app’s code as SVG: black bars on white.', visibleWhen: isMode('svg'),
  },

  // ------------------------------------------------------------------ LEFT: "Code" (opens first) --
  {
    // Four labels of nine characters or fewer, 20 in all, so the kit keeps it a segmented
    // control rather than a dropdown (form-rules `useSegmented`).
    kind: 'select', key: 'codeMode', label: 'Code', section: 'Code', value: 'qr',
    options: [{ value: 'qr', label: 'QR' }, { value: 'svg', label: 'Your code' }, { value: 'space', label: 'Empty' }, { value: 'none', label: 'None' }],
    help: 'Your code engraves the SVG your music app gives you.',
  },
  ...qrFields(),

  // ------------------------------------------------------------------ LEFT: "Player" --
  {
    kind: 'number', key: 'progress', label: 'Progress', section: 'Player', value: 35, min: 0, max: 100, step: 1, unit: '%',
    help: 'Where the knob sits; the two times follow it.',
  },
  { kind: 'toggle', key: 'heart', label: 'Heart', section: 'Player', value: true },

  { kind: 'font', key: 'font', label: 'Font', section: 'Font', value: DEFAULT_FONT, recommended: FACES, previewFrom: 'title' },

  // ------------------------------------------------------------------ LEFT: "Shape & size" --
  {
    kind: 'number', key: 'width', label: 'Width', section: 'Shape & size', value: BASE_W, min: 32, max: 50, step: 1, unit: 'mm',
    help: 'The height follows the song and the code.',
  },
  { kind: 'number', key: 'corner', label: 'Corner radius', section: 'Shape & size', value: 3, min: 0, max: 8, step: 0.5, unit: 'mm' },

  // ------------------------------------------------------------------ LEFT: "Keyring" --
  // The matching keychains' ring (couple-keychains.ts): the shared control, Loop tab | None, its
  // tab RESTING inside the plate at top-centre — where the Hole this design defaulted to until
  // 2026-09-28 sat, because a hole at top-centre is how the photo hangs. 4 mm through 3 mm of
  // wall (§5.1–5.2: a split ring, and a web that carries keys), so it rests 5 mm below the top
  // edge; the song starts under its keep-off disc. The nudge is half the plate.
  ...keyringFields('outside', { rest: 'inside', dia: 4, ring: 3, side: 'top', along: 50, nudge: 40, maxDia: 6, maxRing: 5 }),
];

// ------------------------------------------------------------------ the build --

/**
 * Top to bottom, in DEPTH below the plate's top edge (y = −depth; the top edge is y = 0):
 * the ring's keep-off · the song (+ heart) · the artist · the bar · the times · the controls ·
 * the code. Each row's air is a share of the width, so the plate reads the same at 32 and at
 * 50 mm; a row whose text is empty keeps its height, so typing never makes the plate jump.
 */
async function build(v: Values) {
  const warnings: string[] = [];
  let status: string | undefined;
  const symbols = readSymbols(v);
  const font = str(v, 'font') || DEFAULT_FONT;
  const w = clamp(num(v, 'width'), 20, 120);
  const k = w / BASE_W;
  const m = metricsFor(w);
  const L = w - 2 * m.edge;
  const mode = codeOf(v);
  const keyring = keyringFrom(v);
  const layers: DesignLayer[] = [];
  const push = (id: string, label: string, kind: DesignLayer['kind'], shapes: Shapes, extra: Partial<DesignLayer> = {}) => {
    if (shapes.length) layers.push({ id, label, kind, shapes, op: 'engrave', ...extra });
  };

  // A ring resting inside the plate takes its keep-off disc (`dia/2 + ring` round its centre,
  // which rests `ring + dia/2` down) out of the plate's top — the punched hole until 2026-09-28,
  // the loop tab resting where it was since; a tab standing outside the edge costs nothing.
  const inside = keyring.enabled && keyring.restInside === true;
  let d = inside ? Math.max(0, keyring.dia) + 2 * Math.max(0, keyring.ring) + RING_AIR : m.edge;

  // ------------------------------------------------------------- the song, and the heart --
  const heartOn = bool(v, 'heart');
  // The measured widths already carry the grow's tracking; the grow's own overhang at the two
  // ends of a line is what the width has to leave room for.
  const most = TITLE_BOLD * m.title;
  const titleAvail = L - (heartOn ? m.heart + 0.55 * m.title : 0) - 2 * most;
  // The song wraps rather than shrink under the artist's own size (never under 3 mm): on a wide
  // plate a long title on three big lines outranks one squeezed to the artist's height.
  const title = await fitLines(str(v, 'title'), font, m.title, titleAvail, L - 2 * most, Math.max(TEXT_FLOOR, m.artist), symbols, TITLE_BOLD);
  const tCap = title.lines.length ? title.cap : m.title;
  // The weight follows the cap it is set at: a title shrunk to fit keeps its proportion of bold.
  const bold = TITLE_BOLD * tCap;
  const firstBase = d + (title.lines.length > 1 ? tCap : m.title);
  const titleShapes = title.lines.flatMap((l, i) => placeLine(l, -L / 2 + bold, -(firstBase + i * LINE_PITCH * tCap)));
  push('title', 'Song', 'text', titleShapes, { grow: bold });
  if (heartOn) push('heart', 'Heart', 'symbol', at(heartGlyph(m.heart), L / 2 - m.heart / 2, -(firstBase - tCap / 2)));
  if (title.lines.length && title.cap < TEXT_FLOOR - 0.05) warnings.push('The song title is under 3 mm — shorten it or widen the plate.');
  d = firstBase + Math.max(0, title.lines.length - 1) * LINE_PITCH * tCap + DESC * tCap;

  // ------------------------------------------------------------- the artist --
  // Sized off the song's cap: a title that shrank takes the artist down with it, to the floor,
  // so the song is never the smaller of the two (short of a title under 3 mm, which warns).
  const aCap0 = Math.max(TEXT_FLOOR, Math.min(m.artist, ARTIST_OF_TITLE * tCap));
  const artist = await fitLines(str(v, 'artist'), font, aCap0, L, L, TEXT_FLOOR, symbols);
  const aCap = artist.lines.length ? artist.cap : aCap0;
  const artistBase = d + 1.0 * k + (artist.lines.length > 1 ? aCap : aCap0);
  push('artist', 'Artist', 'text', artist.lines.flatMap((l, i) => placeLine(l, -L / 2, -(artistBase + i * LINE_PITCH * aCap))));
  if (artist.lines.length && artist.cap < TEXT_FLOOR - 0.05) warnings.push('The artist is under 3 mm — shorten it or widen the plate.');
  d = artistBase + Math.max(0, artist.lines.length - 1) * LINE_PITCH * aCap + DESC * aCap;

  // ------------------------------------------------------------- the bar and the times --
  const barY = d + 1.6 * k + m.knob / 2;
  const progress = clamp(num(v, 'progress'), 0, 100) / 100;
  push('bar', 'Progress bar', 'symbol', at(timelineBar(L, progress, { knob: m.knob, thick: m.thick, thin: m.thin }).shapes, 0, -barY));
  const timeBase = barY + m.knob / 2 + 0.9 * k + m.time;
  const lengthText = str(v, 'length').trim();
  const length = lengthText ? parseTime(lengthText) : null;
  if (lengthText && length === null) warnings.push('Type the length as minutes and seconds, like 3:25.');
  if (length !== null) {
    const played = Math.round(length * progress);
    const [elapsed, left] = await Promise.all([
      setLine(formatTime(played), font, m.time, {}), setLine(`-${formatTime(length - played)}`, font, m.time, {}),
    ]);
    push('times', 'Times', 'text', [
      ...(elapsed ? placeLine(elapsed, -L / 2, -timeBase) : []),
      ...(left ? placeLine(left, L / 2, -timeBase, 'right') : []),
    ]);
  }

  // ------------------------------------------------------------- the five controls --
  // Shuffle and repeat stand on the margins, play in the middle, previous and next halfway
  // between — the photo's spacing, whatever the width.
  const ctlY = timeBase + 2.0 * k + m.play / 2;
  const sideX = L / 2 - (1.3 * m.glyph) / 2;
  push('controls', 'Controls', 'symbol', [
    ...at(shuffleGlyph(m.glyph), -sideX, -ctlY),
    ...at(previousGlyph(0.9 * m.glyph), -sideX / 2, -ctlY),
    ...at(playGlyph(m.play), 0, -ctlY),
    ...at(nextGlyph(0.9 * m.glyph), sideX / 2, -ctlY),
    ...at(repeatGlyph(m.glyph), sideX, -ctlY),
  ]);
  d = ctlY + m.play / 2;

  // ------------------------------------------------------------- the code --
  const corner = clamp(num(v, 'corner'), 0, 20);
  let height: number;
  /** Where the code lives — the QR with its quiet zone, or the band — for the hole's check. */
  let codeBox: Box | null = null;
  if (mode === 'qr') {
    const edge = qrEdgeFor(corner);
    const block = w - 2 * edge;
    const top = d + 1.0 * k;
    const cy = -(top + block / 2);
    codeBox = { minX: -block / 2, maxX: block / 2, minY: cy - block / 2, maxY: cy + block / 2 };
    const q = readQr(v);
    let modules = 0;
    try { modules = q.typed ? qrMinSize(q.content, q.level, 1) : 0; } catch { modules = -1; }
    if (!q.typed) warnings.push('Paste the song’s link and the code appears.');
    else if (modules < 0) warnings.push('Too long for one QR code — shorten the link.');
    else {
      const built = await qrLayers(q, (block * modules) / (modules + 2 * QUIET), bool(v, 'invert'), symbols);
      for (const l of built.layers) {
        layers.push({ ...l, shapes: at(l.shapes, 0, cy), ...(l.minus ? { minus: at(l.minus, 0, cy) } : {}) });
      }
      const cell = built.geometry.cell;
      if (cell < QR_MIN_CELL[q.style]) warnings.push(`Code modules are ${cell.toFixed(2)} mm, too fine — widen the plate or lower Toughness.`);
    }
    height = top + block + edge;
  } else if (mode === 'svg' || mode === 'space') {
    const top = d + 3.0 * k;
    let areaH = L / 4;
    const art = mode === 'svg' ? str(v, 'codeArt') : '';
    const drawn = art ? (await symbolLayer(art, 1, 'engrave', { symbols }, 'code')).flatMap((l) => l.shapes) : [];
    if (drawn.length) {
      // Fitted into the width, at its own proportion: a 4 : 1 code gets a 4 : 1 band, anything
      // squarer a taller one, up to a square — never a square code squeezed into a strip.
      const b = bboxOf(drawn);
      const aw = Math.max(1e-6, b.maxX - b.minX);
      const ah = Math.max(1e-6, b.maxY - b.minY);
      areaH = clamp((L * ah) / aw, L / 6, L);
      const s = Math.min(L / aw, areaH / ah);
      const cx = (b.minX + b.maxX) / 2;
      const cyArt = (b.minY + b.maxY) / 2;
      const fitted = drawn.map((isl) => isl.map((r) => r.map(([x, y]): Pt => [(x - cx) * s, (y - cyArt) * s - (top + areaH / 2)])));
      // No `kind`: the code is not lettering, and the hole's own check below covers its band —
      // tagged, a hole on the code would be told off twice.
      push('code', 'Your code', undefined, fitted);
      const finest = finestOf(fitted);
      if (finest < CODE_FINEST) warnings.push(`The code’s finest lines are ${finest.toFixed(2)} mm — widen the plate.`);
      // A code saved light-on-dark comes in as its card with the bars dropped (the importer takes
      // white for paper): one island, or one covering half the box, that would engrave a slab. A
      // real code is a disc and twenty-odd bars, the biggest under a fifth of its box.
      if (drawn.length === 1 || Math.max(...drawn.map(areaOf)) > CODE_SOLID * aw * ah) {
        warnings.push('Your code came in as one solid block — save it black on white.');
      }
    } else if (mode === 'svg') {
      status = 'Drop the SVG your music app gives you under “Your code”';
    } else {
      status = `Space for a code: ${round1(L)} × ${round1(areaH)} mm`;
    }
    codeBox = { minX: -L / 2, maxX: L / 2, minY: -(top + areaH), maxY: -top };
    height = top + areaH + m.edge;
  } else {
    height = d + m.edge;
  }

  const r = Math.min(corner, w / 2 - 0.1, height / 2 - 0.1);
  const plate: Shapes = [[roundedRectRing(w, height, r, 12).map(([x, y]): Pt => [x, y - height / 2])]];

  // A hole through the modules — or through the quiet zone round them — and the code stops
  // scanning: the one part the customer is paying for. The engine's "sits on the lettering" net
  // tests words, not a code's bare margin, so the design tests its own area, with the hole where
  // the engine will cut it and the engine's keep-off for a loop tab: the hole and 0.5 mm. The
  // tab's border is plain wood wherever it lands, which is all a quiet zone asks; only the hole
  // cuts into a code. (A punched hole kept its whole border off it; none is made since 2026-09-28.)
  if (codeBox && keyring.enabled) {
    const { centre } = finalHoleCentre(plate, keyring);
    const keepOff = keyring.dia / 2 + 0.5;
    if (reachTo(codeBox, centre) < keepOff - 0.05) warnings.push('The hole cuts into the code — drag it clear.');
  }
  return {
    blank: { kind: 'shape' as const, shapes: plate, oneIsland: true },
    keyring,
    layers,
    ...(warnings.length ? { warnings } : {}),
    ...(status ? { status } : {}),
  };
}

export const songKeychain: TemplateDef = {
  id: 'song-keychain',
  name: 'Song keychain',
  blurb: 'A now-playing screen — the song, the controls and a code that plays it.',
  tags: ['keychain', 'engrave + cut'],
  fields: FIELDS,
  build,
  exportNote: (v) => {
    const mode = codeOf(v);
    if (mode === 'qr') return 'Scan the code off the screen with your phone before you cut.';
    if (mode === 'svg') return 'Scan your code off the screen in your music app before you cut.';
    if (mode === 'space') {
      const L = clamp(num(v, 'width'), 20, 120) - 2 * metricsFor(clamp(num(v, 'width'), 20, 120)).edge;
      return `The bare space takes a code sticker up to ${round1(L)} × ${round1(L / 4)} mm.`;
    }
    return 'Run the engrave before the outline.';
  },
  fileName: (v) => stem(str(v, 'title').toLowerCase() || 'song', 'keychain'),
};

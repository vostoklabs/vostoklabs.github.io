import * as THREE from 'three';
import { FontLoader, Font } from 'three/examples/jsm/loaders/FontLoader.js';
// Roboto, converted to three's typeface format from its own font files by
// scripts/typefaces.mjs. See typefaces/README.md.
import robotoRegular from '../typefaces/roboto_regular.typeface.json';
import robotoBold from '../typefaces/roboto_bold.typeface.json';
import { FONTS, fontSupportsText, getFont, getRequiredSubsets, importFontFiles, pathCommandsToPolygons } from '@vostok/fonts';
import { LUCIDE_ICONS, buildSvg } from './lucideIcons';
import { parseSvg } from './logo';
import type { BlockSlot, LegendLook, RegionSet, Ring, RGB } from '../types';
import { lookRings, normaliseRings, type SymbolLook } from './symbolRings';

/*
  Where the letters' outlines come from.

  Every face in the shared set (`@vostok/fonts`, the one all the generators that put type on a
  model use) is read with opentype the first time it is picked. The two "Standard" faces are
  three.js typefaces — the clicker's default text and the fit test's labels — and are loaded from
  the start. Both kinds answer the same three questions through `GlyphFont`, so the layout below
  never needs to know which it has.
*/

const fontLoader = new FontLoader();

/** One loaded face: whether it has a character, the character's outline at `size` (Y-up, pen
 *  at 0, outer rings and holes together — the build fills them NonZero), and its advance. */
interface GlyphFont {
  has(ch: string): boolean;
  rings(ch: string, size: number): Ring[];
  advance(ch: string, size: number): number;
}

function typefaceGlyphs(font: Font): GlyphFont {
  const data = font.data as { resolution: number; glyphs: Record<string, { ha: number }> };
  return {
    has: (ch) => !!data.glyphs[ch],
    rings: (ch, size) => {
      const out: Ring[] = [];
      for (const shape of font.generateShapes(ch, size)) {
        const extracted = shape.extractPoints(16);
        for (const pts of [extracted.shape, ...extracted.holes]) {
          if (pts.length >= 3) out.push(pts.map((p) => [p.x, p.y] as [number, number]));
        }
      }
      return out;
    },
    advance: (ch, size) => ((data.glyphs[ch] ?? data.glyphs['?'])?.ha ?? 0) * (size / data.resolution),
  };
}

function opentypeGlyphs(font: any): GlyphFont {
  // A character the face does not have draws as its "?", the way the typefaces always did, so
  // a missing letter shows on the model instead of leaving a silent gap.
  const glyphOf = (ch: string) => {
    const g = font.charToGlyph(ch);
    return g && g.index !== 0 ? g : font.charToGlyph('?');
  };
  const scale = (size: number) => size / (font.unitsPerEm || 1000);
  return {
    has: (ch) => font.charToGlyphIndex(ch) > 0,
    rings: (ch, size) => {
      const g = glyphOf(ch);
      if (!g || g.index === 0) return [];
      return (pathCommandsToPolygons(g.getPath(0, 0, size).commands) as Ring[]).filter((r) => r.length >= 3);
    },
    advance: (ch, size) => (glyphOf(ch)?.advanceWidth ?? 0) * scale(size),
  };
}

/** A face as the font picker lists it. */
export interface FontOption {
  id: string;
  name: string;
  category?: string;
}

/** The Standard faces: always loaded, never fetched. They are Roboto, under the ids of the faces
 *  Standard used to be (Helvetiker), so a saved project still finds them. */
export const STANDARD_FONTS: FontOption[] = [
  { id: 'helvetiker-regular', name: 'Standard', category: 'Clean' },
  { id: 'helvetiker-bold', name: 'Standard Bold', category: 'Clean' },
];

/** Every face on offer: the Standard pair, then the shared set — which an import adds to, so this
 *  is read fresh rather than copied. */
export function fontOptions(): FontOption[] {
  return [...STANDARD_FONTS, ...FONTS.map((f) => ({ id: f.id, name: f.label, category: f.category }))];
}

const loaded = new Map<string, GlyphFont>([
  ['helvetiker-regular', typefaceGlyphs(fontLoader.parse(robotoRegular))],
  ['helvetiker-bold', typefaceGlyphs(fontLoader.parse(robotoBold))],
]);

/**
 * The id a saved font is known by now. The clicker shipped its own copies of 28 of the shared
 * faces as `bundled-<slug>`; the shared set has every one of them as `<slug>`.
 */
export function currentFontIdOf(id: string): string {
  return id.startsWith('bundled-') ? id.slice('bundled-'.length) : id;
}

/** Load a face so `parseLetter` can draw with it. False when it cannot be had (a font that was
 *  imported in another session and not brought back, say). */
export async function ensureFont(id: string): Promise<boolean> {
  if (loaded.has(id)) return true;
  try {
    loaded.set(id, opentypeGlyphs(await getFont(id)));
    return true;
  } catch (err) {
    console.warn(`Could not load font "${id}":`, (err as Error).message);
    return false;
  }
}

export function isFontLoaded(id: string): boolean {
  return loaded.has(id);
}

/** The face to draw with: the one asked for once it has loaded, Standard until then. */
function glyphFont(id: string): GlyphFont {
  return loaded.get(id) ?? loaded.get('helvetiker-regular')!;
}

/** Does the loaded face have every letter and digit of `text`? Unloaded faces are not judged. */
export function fontHasText(id: string, text: string): boolean {
  const f = loaded.get(id);
  if (!f) return true;
  for (const ch of text) if (/[\p{L}\p{N}]/u.test(ch) && !f.has(ch)) return false;
  return true;
}

/** The letters of a text, without its symbols (private-use characters no face has). */
const lettersOf = (text: string) => Array.from(text).filter((ch) => (ch.codePointAt(0) ?? 0) < 0xf0000).join('');

/** Can this face draw every letter and digit of `text`? The Standard pair (and an imported
 *  typeface) answers from its glyphs, every shared face from the coverage its file was measured
 *  to have, so a face that is not loaded yet is judged too. */
export function fontWritesText(id: string, text: string): boolean {
  const letters = lettersOf(text);
  return STANDARD_FONTS.some((f) => f.id === id) ? fontHasText(id, letters) : fontSupportsText(id, letters);
}

const ALPHABETS: Record<string, string> = {
  cyrillic: 'Cyrillic', greek: 'Greek', korean: 'Korean', kana: 'Japanese', japanese: 'Japanese',
  'chinese-simplified': 'Chinese', 'latin-ext': 'accented',
};

/** What `text` needs beyond plain Latin, as the shared library names it ('cyrillic', 'kana'…). */
const needsOf = (text: string) => new Set(getRequiredSubsets(lettersOf(text)).flatMap((need) => need.split('|')));

/** The first alphabet `text` needs beyond plain Latin, by name ("Cyrillic"), for a message. An
 *  accented Latin letter needs no subset but can still be missing from a face: "accented". */
export function alphabetOf(text: string): string | null {
  for (const name of needsOf(text)) if (ALPHABETS[name]) return ALPHABETS[name];
  return /[^\x00-\x7f]/.test(Array.from(lettersOf(text)).filter((ch) => /\p{L}/u.test(ch)).join('')) ? 'accented' : null;
}

/** The plain face for each alphabet, most telling first: a text with kana in it is Japanese
 *  whatever else it holds, Hangul is Korean, a Han character with neither is Chinese. Gothic A1
 *  also writes Cyrillic and Greek, so a Korean name mixed with Russian still lands on one face. */
const PLAIN_FACES: [need: string, face: string][] = [
  ['kana', 'm-plus-1p'],
  ['korean', 'gothic-a1'],
  ['chinese-simplified', 'noto-sans-sc'],
  ['greek', 'gothic-a1'],
  ['cyrillic', 'montserrat'],
  ['latin-ext', 'montserrat'],
];
/** The plain faces, for a text that needs none of them by alphabet (accented Latin, say). */
const PLAIN_ORDER = ['montserrat', 'gothic-a1', 'm-plus-1p', 'noto-sans-sc'];

/** Every face that writes `text`: Standard when it can, then the plain face for the alphabet it
 *  needs (and the other plain faces), then the rest in library order. Text in an alphabet
 *  Standard lacks therefore starts on a face that suits it, rather than on whichever display
 *  face comes first alphabetically. */
export function facesThatWrite(text: string): string[] {
  const needs = needsOf(text);
  const plain = [...PLAIN_FACES.filter(([need]) => needs.has(need)).map(([, face]) => face), ...PLAIN_ORDER];
  const lead = [...new Set([...STANDARD_FONTS.map((f) => f.id), ...plain])].filter((id) => fontWritesText(id, text));
  return [...lead, ...fontOptions().map((f) => f.id).filter((id) => !lead.includes(id) && fontWritesText(id, text))];
}

/**
 * A font the user brings: a .ttf, .otf, .woff or a .zip of them, through the shared importer
 * (stable ids, so a saved project finds it again), or a three.js typeface .json, which only this
 * engine reads.
 */
export async function importFontFile(file: File): Promise<{ fonts: FontOption[]; failed: string[] }> {
  if (/\.json$/i.test(file.name)) {
    const data = JSON.parse(await file.text());
    const name = data.familyName || data.original_font_information?.fullName?.en || file.name.replace(/\.[^.]+$/, '');
    const id = `typeface-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    loaded.set(id, typefaceGlyphs(fontLoader.parse(data)));
    const option = { id, name, category: 'Custom' };
    if (!STANDARD_FONTS.some((f) => f.id === id)) STANDARD_FONTS.push(option);
    return { fonts: [option], failed: [] };
  }
  const result = await importFontFiles(file);
  const fonts: FontOption[] = [];
  for (const f of result.fonts) {
    if (await ensureFont(f.id)) fonts.push({ id: f.id, name: f.label, category: f.category });
    else result.failed.push(f.label);
  }
  return { fonts, failed: result.failed };
}

/** How tall a symbol stands in a line of text by default, as a fraction of the font size: about
 *  a capital letter's height, so a heart next to a name reads as one more letter. */
const SYMBOL_HEIGHT = 0.7;

/** Text-mode typography. Every field defaults to the value that reproduces the old layout. */
export interface TextTypography {
  /** Multiplier on the default line gap (1 = the shipped spacing). */
  lineSpacing?: number;
  /** Tracking added between glyphs, as a fraction of the em (0 = the font's own advance). */
  letterSpacing?: number;
}

/**
 * Build a RegionSet from text.
 * @param separate  When false (default) every letter is merged into one element so the
 *   whole word selects/recolors/extrudes together. When true each glyph becomes its own
 *   region (part `top-color-{k}-0`), so letters can be picked and colored individually.
 */
export function parseLetter(
  text: string,
  fontId: string,
  maxLen = 30,
  separate = false,
  typo: TextTypography = {},
  /** Symbols in the text, by their private-use character: their rings (any frame) and look. */
  symbols: Readonly<Record<string, { rings: Ring[]; look: SymbolLook }>> = {},
): RegionSet {
  if (!text.trim()) throw new Error('Type a letter first.');

  const font = glyphFont(fontId);

  const layout = (t: TextTypography) => {
    const SIZE = 100;
    const lineSpacing = t.lineSpacing ?? 1;
    const tracking = (t.letterSpacing ?? 0) * SIZE;
    // Each glyph is a group of rings (its outline + any holes), kept grouped so we can
    // either merge them all into one element or expose each letter on its own.
    const glyphs: Ring[][] = [];
    const box = new THREE.Box2(
      new THREE.Vector2(Infinity, Infinity),
      new THREE.Vector2(-Infinity, -Infinity)
    );

    const lines = text.split('\n');
    let currentY = 0;

    for (const rawLine of lines) {
      const value = Array.from((rawLine || '').trim()).slice(0, maxLen);
      if (!value.length) continue;

      const lineBox = new THREE.Box2(
        new THREE.Vector2(Infinity, Infinity),
        new THREE.Vector2(-Infinity, -Infinity)
      );
      const lineGlyphs: Ring[][] = [];

      // Laid out one character at a time (what three's generateShapes does internally) so the
      // tracking can go between glyphs, and so a two-piece glyph like "i" stays ONE glyph
      // instead of a stem and a dot that select separately.
      let penX = 0;
      for (const ch of value) {
        const glyphRings: Ring[] = [];
        const sym = symbols[ch];
        if (sym) {
          // A symbol stands in the line like a capital letter: as tall as one by default,
          // centred on the capitals' middle, as wide as its own drawing. Its inspector's size
          // and offset are fractions of that height.
          const S = SIZE * SYMBOL_HEIGHT * sym.look.scale;
          const rings = lookRings(normaliseRings(sym.rings), sym.look).map((r) => r.map(([x, y]) => [x * S, y * S] as [number, number]));
          let minX = Infinity, maxX = -Infinity;
          for (const r of rings) for (const [x] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
          if (rings.length && Number.isFinite(minX)) {
            const ox = penX - minX + sym.look.dx * S;
            const oy = SIZE * SYMBOL_HEIGHT * 0.5 + sym.look.dy * S;
            for (const r of rings) {
              const ring: Ring = r.map(([x, y]) => [x + ox, y + oy] as [number, number]);
              for (const [x, y] of ring) lineBox.expandByPoint(new THREE.Vector2(x, y));
              glyphRings.push(ring);
            }
            lineGlyphs.push(glyphRings);
            penX += maxX - minX + SIZE * 0.08 + tracking;
          }
          continue;
        }
        for (const pts of font.rings(ch, SIZE)) {
          const ring: Ring = [];
          for (const [px, py] of pts) {
            const x = px + penX;
            lineBox.expandByPoint(new THREE.Vector2(x, py));
            ring.push([x, py]);
          }
          glyphRings.push(ring);
        }
        if (glyphRings.length) lineGlyphs.push(glyphRings);
        penX += font.advance(ch, SIZE) + tracking;
      }

      if (lineGlyphs.length === 0) continue;

      const lineWidth = lineBox.max.x - lineBox.min.x;
      const offsetX = -(lineBox.min.x + lineWidth / 2);

      for (const glyphRings of lineGlyphs) {
        for (const ring of glyphRings) {
          for (const pt of ring) {
            pt[0] += offsetX;
            pt[1] += currentY;
            box.expandByPoint(new THREE.Vector2(pt[0], pt[1]));
          }
        }
        glyphs.push(glyphRings);
      }

      currentY -= 130 * lineSpacing; // Move down for the next line
    }

    return { glyphs, box };
  };

  const { glyphs, box } = layout(typo);
  // Spacing must not shrink the letters: the caller scales the whole part by this instead.
  const longest = (b: THREE.Box2) => Math.max(b.max.x - b.min.x, b.max.y - b.min.y) || 1;
  const tuned = (typo.lineSpacing ?? 1) !== 1 || (typo.letterSpacing ?? 0) !== 0;
  const sizeMul = tuned && glyphs.length ? longest(box) / longest(layout({}).box) : 1;

  if (!glyphs.length) throw new Error('No drawable outlines found in this font.');

  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const dx = box.max.x - box.min.x;
  const dy = box.max.y - box.min.y;
  const maxSide = Math.max(dx, dy) || 1;
  const aspect = dy !== 0 ? dx / dy : 1;

  const normalizeRing = (r: Ring): Ring =>
    r.map(([x, y]) => [
      (x - cx) / maxSide,
      (y - cy) / maxSide // keep Y-up
    ]);

  // Default text color is off-white (#f7f7f5)
  const OFFWHITE: RGB = [247, 247, 245];
  const outline = glyphs.flat().map(normalizeRing);

  const regions = separate
    ? glyphs.map((glyphRings) => ({
        quantRgb: OFFWHITE,
        components: [{ rings: glyphRings.map(normalizeRing), coverage: 1.0 }],
        coverage: 1.0,
      }))
    : [{
        quantRgb: OFFWHITE,
        components: [{ rings: outline, coverage: 1.0 }],
        coverage: 1.0,
      }];

  return { regions, outline, aspect, sizeMul };
}

// ---------------------------------------------------------------------------
// Letter blocks
// ---------------------------------------------------------------------------

function bboxOf(rings: Ring[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Build the region list for a letter-block chain: one region per block, in chain order.
 *
 * Unlike `parseLetter` (which normalises a whole WORD to a longest side of 1, because it
 * lands on a single cap), every block gets its own cap, so each slot is normalised on its
 * own — but all the letters share ONE scale factor, taken from the biggest glyph in the
 * chain. That is what keeps an "i" small next to a "W" instead of blowing both up to the
 * same height. Icons are square line-art and are normalised to their own box, trimmed a
 * little so a symbol doesn't crowd the cap more than a capital letter does.
 */
export function parseBlockChain(
  slots: BlockSlot[],
  fontId: string,
  /** Rings of the traced symbols, by the private-use character a `symbol` slot names, with
   *  the size and offset their inspector set. */
  symbols: Readonly<Record<string, { rings: Ring[]; legend?: LegendLook }>> = {},
): RegionSet {
  const font = glyphFont(fontId);
  const ICON_FILL = 0.9; // icons read bigger than letters at equal height

  // Every slot produces a region, INCLUDING empties and glyphs the font can't draw: the
  // builder positions cells by index, so a hole has to keep its place in the grid.
  const raw: { rings: Ring[]; icon: boolean; legend?: LegendLook }[] = [];
  for (const slot of slots) {
    if (slot.kind === 'empty' || slot.kind === 'blank') {
      // A blank key still has a cap; it just has nothing printed on it. Which cells are keys
      // travels separately (`BuildParams.blockKeys`), because both of these have no rings.
      raw.push({ rings: [], icon: false });
    } else if (slot.kind === 'symbol') {
      // Traced already, centred, longest side 1 — the same frame `parseSvg` hands back.
      const sym = symbols[slot.char];
      raw.push({
        rings: sym?.rings.map((r) => r.map(([x, y]) => [x, y] as [number, number])) ?? [],
        icon: true,
        ...(sym?.legend ? { legend: sym.legend } : {}),
      });
    } else if (slot.kind === 'icon') {
      const info = LUCIDE_ICONS.find((ic) => ic.name === slot.name);
      let rings: Ring[] = [];
      try {
        // parseSvg already centres the art and normalises its longest side to 1.
        if (info) rings = parseSvg(buildSvg(info.node)).outline;
      } catch {
        rings = [];
      }
      const look = slot.look;
      raw.push({
        rings: look ? lookRings(rings, look) : rings,
        icon: true,
        ...(look ? { legend: { scale: look.scale, dx: look.dx, dy: look.dy } } : {}),
      });
    } else {
      raw.push({ rings: font.rings(slot.ch, 100), icon: false });
    }
  }
  if (!slots.some((s) => s.kind !== 'empty')) throw new Error('Add a key first.');

  // One scale for every letter: the tallest/widest glyph in the chain sets it.
  let charMax = 0;
  for (const r of raw) {
    if (r.icon) continue;
    const b = bboxOf(r.rings);
    charMax = Math.max(charMax, b.w, b.h);
  }
  if (!charMax) charMax = 1;

  // Legends default to black: the caps default to a light filament, and black on white is
  // the contrast every keycap set starts from.
  const BLACK: RGB = [22, 22, 22];
  const regions = raw.map((r) => {
    const k = r.icon ? ICON_FILL : 1 / charMax;
    const rings = r.rings.map((ring) => ring.map(([x, y]) => [x * k, y * k] as [number, number]));
    return { quantRgb: BLACK, components: [{ rings, coverage: 1.0 }], coverage: 1.0, ...(r.legend ? { legend: r.legend } : {}) };
  });

  return { regions, outline: regions.flatMap((r) => r.components[0].rings), aspect: 1 };
}

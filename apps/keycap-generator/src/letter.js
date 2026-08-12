import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TTFLoader } from 'three/examples/jsm/loaders/TTFLoader.js';
// Vendored rather than imported from `three/examples/fonts/`: three stopped shipping that
// folder after 0.171, so the old imports break on any newer version. See typefaces/README.md.
import helvetikerRegular from './typefaces/helvetiker_regular.typeface.json';
import helvetikerBold from './typefaces/helvetiker_bold.typeface.json';
import optimerBold from './typefaces/optimer_bold.typeface.json';
import optimerRegular from './typefaces/optimer_regular.typeface.json';
import gentilisRegular from './typefaces/gentilis_regular.typeface.json';
import gentilisBold from './typefaces/gentilis_bold.typeface.json';
import droidSansRegular from './typefaces/droid/droid_sans_regular.typeface.json';
import droidSansBold from './typefaces/droid/droid_sans_bold.typeface.json';
import droidSansMonoRegular from './typefaces/droid/droid_sans_mono_regular.typeface.json';
import droidSerifRegular from './typefaces/droid/droid_serif_regular.typeface.json';
import droidSerifBold from './typefaces/droid/droid_serif_bold.typeface.json';
import { assetUrl } from './assets.js';

const fontLoader = new FontLoader();
const ttfLoader = new TTFLoader();

export const FONT_OPTIONS = [];

const BUILT_IN_FONTS = [
  ['helvetiker-regular', 'Helvetiker', helvetikerRegular],
  ['helvetiker-bold', 'Helvetiker Bold', helvetikerBold],
  ['optimer-regular', 'Optimer', optimerRegular],
  ['optimer-bold', 'Optimer Bold', optimerBold],
  ['gentilis-regular', 'Gentilis', gentilisRegular],
  ['gentilis-bold', 'Gentilis Bold', gentilisBold],
  ['droid-sans-regular', 'Droid Sans', droidSansRegular],
  ['droid-sans-bold', 'Droid Sans Bold', droidSansBold],
  ['droid-sans-mono-regular', 'Droid Sans Mono', droidSansMonoRegular],
  ['droid-serif-regular', 'Droid Serif', droidSerifRegular],
  ['droid-serif-bold', 'Droid Serif Bold', droidSerifBold],
];

// The three.js built-ins are typeface JSON outlines — there is no web font to
// load for them, so the dropdown falls back to the nearest generic family. It
// still tells you serif from mono at a glance, which is the point.
const BUILT_IN_CSS = {
  'helvetiker-regular': 'sans-serif',
  'helvetiker-bold': 'sans-serif',
  'optimer-regular': 'sans-serif',
  'optimer-bold': 'sans-serif',
  'gentilis-regular': 'serif',
  'gentilis-bold': 'serif',
  'droid-sans-regular': 'sans-serif',
  'droid-sans-bold': 'sans-serif',
  'droid-sans-mono-regular': 'monospace',
  'droid-serif-regular': 'serif',
  'droid-serif-bold': 'serif',
};

for (const [id, name, data] of BUILT_IN_FONTS) {
  FONT_OPTIONS.push({
    id,
    name,
    font: fontLoader.parse(data),
    cssFamily: BUILT_IN_CSS[id] ?? 'sans-serif',
    cssWeight: id.endsWith('-bold') ? '700' : '400',
  });
}

/** Register a font with the CSS engine under `family` so the dropdown can render
 *  its name in its own typeface. Failure is silent — a name in the UI font is a
 *  cosmetic loss, and the 3D glyphs come from the parsed outlines either way. */
function registerCssFace(family, source) {
  try {
    const face = new FontFace(family, source);
    face.load().then((f) => document.fonts.add(f)).catch(() => {});
  } catch {
    /* no FontFace support — names stay in the UI font */
  }
}

// Open-source TTFs bundled in public/fonts/ (SIL OFL 1.1 — see public/fonts/CREDITS.md).
// Loaded lazily at startup via loadBundledFonts() so the dropdown grows as each parses;
// a font that fails is skipped rather than blocking the rest. Ordered keycap-friendly first.
const BUNDLED_TTF = [
  ['bebas-neue', 'Bebas Neue'],
  ['anton', 'Anton'],
  ['oswald', 'Oswald'],
  ['titillium-web', 'Titillium Web'],
  ['rajdhani', 'Rajdhani'],
  ['chakra-petch', 'Chakra Petch'],
  ['orbitron', 'Orbitron'],
  ['audiowide', 'Audiowide'],
  ['michroma', 'Michroma'],
  ['russo-one', 'Russo One'],
  ['righteous', 'Righteous'],
  ['bungee', 'Bungee'],
  ['share-tech-mono', 'Share Tech Mono'],
  ['vt323', 'VT323'],
  ['press-start-2p', 'Press Start 2P'],
  ['arvo', 'Arvo'],
  ['lobster', 'Lobster'],
  ['pacifico', 'Pacifico'],
];

let bundledLoaded = false;
export async function loadBundledFonts(onLoaded) {
  if (bundledLoaded) return;
  bundledLoaded = true;
  for (const [slug, name] of BUNDLED_TTF) {
    try {
      const buf = await fetch(assetUrl(`fonts/${slug}.ttf`)).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      });
      const family = `KC-${slug}`;
      // The same bytes drive both the 3D outlines and the dropdown preview, so
      // what you see in the list is exactly what gets extruded.
      registerCssFace(family, buf.slice(0));
      const option = {
        id: `bundled-${slug}`,
        name,
        font: fontLoader.parse(ttfLoader.parse(buf)),
        cssFamily: `'${family}', sans-serif`,
      };
      FONT_OPTIONS.push(option);
      onLoaded?.(option);
    } catch (e) {
      console.warn(`Could not load font "${name}":`, e.message);
    }
  }
}

function uniqueFontId(base) {
  const slug = base
    .replace(/\.[^.]+$/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'imported-font';
  let id = `imported-${slug}`;
  let suffix = 2;
  while (FONT_OPTIONS.some((font) => font.id === id)) {
    id = `imported-${slug}-${suffix}`;
    suffix++;
  }
  return id;
}

function fontNameFromData(data, fallback) {
  return data.familyName || data.original_font_information?.fullName?.en || fallback;
}

/**
 * The nominal size every legend is generated at. Nothing about it is magic — it is just the
 * unit all the metrics below share, so ratios between them are exact whatever convention the
 * font was built with.
 */
export const LEGEND_EM = 100;

const metricsCache = new Map();

/**
 * Height of the tallest of `candidates` above the baseline, in LEGEND_EM units.
 *
 * Measured rather than read, because there is nothing to read: a typeface JSON's glyphs carry
 * only `{ ha, x_min, x_max, o }` — no vertical bounds at all — and `data.boundingBox` is
 * unusable for the bundled TTFs (TTFLoader hardcodes `resolution: 1000` and scales
 * ascender/descender, but copies boundingBox straight from the font's `head` table, so it
 * comes out in raw units and is off by 1.4–2.8×).
 *
 * three's `createPath` puts the baseline at exactly y = 0, so the top of an 'H' IS the cap
 * height. It also SILENTLY substitutes `glyphs['?']` for a missing character — hence the
 * explicit existence check, or a font without an 'H' would report the question mark's height.
 */
function probeTop(font, candidates) {
  for (const ch of candidates) {
    if (!font.data?.glyphs?.[ch]) continue;
    let top = -Infinity;
    try {
      for (const shape of font.generateShapes(ch, LEGEND_EM)) {
        for (const p of shape.extractPoints(8).shape) top = Math.max(top, p.y);
      }
    } catch {
      continue; // '?' missing too — generateShapes throws inside toShapes()
    }
    if (Number.isFinite(top) && top > 0) return top;
  }
  return null;
}

function metricsForOption(option) {
  const hit = metricsCache.get(option.id);
  if (hit) return hit;

  const data = option.font.data || {};
  const res = data.resolution || 1000;
  // ascender/descender ARE in resolution units in both the typeface JSON and TTFLoader's
  // output. Their sum runs about 1.2 em in practice, which is enough to sanity-check a
  // measurement — never enough to BE the measurement.
  const stack = (Math.abs(data.ascender ?? 0) + Math.abs(data.descender ?? 0)) * LEGEND_EM / res;
  const em = stack > 0 ? stack / 1.2 : LEGEND_EM;

  const cap = probeTop(option.font, ['H', 'E', 'X', 'T', 'I', 'M', '0']);
  const sane = cap && cap > 0.35 * em && cap < 1.1 * em;

  const m = { em, capHeight: sane ? cap : 0.7 * em };
  metricsCache.set(option.id, m);
  return m;
}

/** Vertical metrics for a font, in the units parseLetter's contours come back in. */
export function fontMetrics(fontId) {
  return metricsForOption(FONT_OPTIONS.find((f) => f.id === fontId) || FONT_OPTIONS[0]);
}

function pointsToContour(points, box) {
  const contour = [];
  for (const point of points) {
    const x = point.x;
    const y = -point.y;
    box.expandByPoint(new THREE.Vector2(x, y));
    contour.push([x, y]);
  }
  return contour;
}

export async function importFontFile(file) {
  const isJson = /\.json$/i.test(file.name);
  const raw = isJson ? null : await file.arrayBuffer();
  const data = isJson ? JSON.parse(await file.text()) : ttfLoader.parse(raw);
  const id = uniqueFontId(file.name);
  // A typeface JSON has no bytes a browser can render, so only real font files
  // get a preview family.
  let cssFamily = 'sans-serif';
  if (raw) {
    cssFamily = `'KC-${id}', sans-serif`;
    registerCssFace(`KC-${id}`, raw.slice(0));
  }
  const option = {
    id,
    name: fontNameFromData(data, file.name.replace(/\.[^.]+$/g, '')),
    font: fontLoader.parse(data),
    imported: true,
    cssFamily,
  };
  FONT_OPTIONS.push(option);
  await document.fonts.ready.catch(() => {});
  return option;
}

export function parseLetter(text, fontId, maxLen = 4) {
  // Newlines are stripped rather than honoured: three breaks lines using a line height derived
  // from data.boundingBox, which is wrong for every bundled TTF (see probeTop). Stacked
  // legends are worth doing deliberately, not by accident.
  const value = Array.from((text || '').replace(/[\r\n]+/g, ' ').trim()).slice(0, maxLen).join('');
  if (!value) throw new Error('Type a letter first.');

  const option = FONT_OPTIONS.find((font) => font.id === fontId) || FONT_OPTIONS[0];
  const shapes = option.font.generateShapes(value, LEGEND_EM);
  const contours = [];
  const box = new THREE.Box2(
    new THREE.Vector2(Infinity, Infinity),
    new THREE.Vector2(-Infinity, -Infinity)
  );

  for (const shape of shapes) {
    const extracted = shape.extractPoints(16);
    if (extracted.shape.length >= 3) contours.push(pointsToContour(extracted.shape, box));
    for (const hole of extracted.holes) {
      if (hole.length >= 3) contours.push(pointsToContour(hole, box));
    }
  }

  if (!contours.length) throw new Error('No drawable outlines found in this font.');
  return {
    contours,
    strokeGeoms: [], // letters are always fill-based
    box,
    name: `${value}-${option.name}`,
    label: value,
    fontName: option.name,
    // Carried so a caller that needs several legends to look like ONE typeface (the keyboard
    // set) can scale them all by the font's cap height instead of each glyph's own box.
    // pointsToContour negates y, so in `box` coordinates the baseline is 0 and the cap line
    // is at -capHeight.
    metrics: metricsForOption(option),
  };
}

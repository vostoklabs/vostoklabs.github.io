/**
 * What a product photograph is made of, as data: the filaments a seller has, the finishes they
 * come in, the angles, the backdrops, the light rigs, the output sizes, and the plan that turns
 * a set of angles and colourways into a list of files.
 *
 * Nothing here draws. The scene that turns these into pixels is `scene.ts`; this module has no
 * three.js in it, so a panel can show and validate every choice without loading a renderer.
 */

import { AS_PRINTED, type Colourway } from './regions';

/* ------------------------------------------------------------------ palette */

export interface Filament {
  name: string;
  hex: string;
  /** The finish this colour usually ships in. Overridable per render; see `FINISHES`. */
  finish: Finish;
}

export type Finish =
  | 'matte' | 'satin' | 'glossy' | 'silk' | 'metal' | 'translucent' | 'resin';

/**
 * Colours a seller actually has on the shelf, not a colour wheel.
 *
 * A picker of 16.7 million colours answers a question nobody asked: the render is a photograph
 * of a print, so the useful set is the filaments that exist. A custom hex is still allowed; it is
 * just not the thing you land on.
 *
 * Each entry carries the finish that colour usually ships in, which is what `AUTO_FINISH` reads
 * (see `resolveFinish`): a colour found here by hex takes its finish, any other colour is satin.
 * This is a different list from the UI kit's `FILAMENTS` behind its swatch row, which has no
 * finishes and different hexes.
 */
export const STUDIO_FILAMENTS: readonly Filament[] = [
  { name: 'Black', hex: '#1c1c1e', finish: 'matte' },
  { name: 'White', hex: '#f2f2ef', finish: 'matte' },
  { name: 'Grey', hex: '#8a8d93', finish: 'matte' },
  { name: 'Red', hex: '#c0392b', finish: 'satin' },
  { name: 'Orange', hex: '#e8722c', finish: 'satin' },
  { name: 'Yellow', hex: '#f2c53d', finish: 'satin' },
  { name: 'Green', hex: '#3f9b52', finish: 'satin' },
  { name: 'Teal', hex: '#2fa4a0', finish: 'satin' },
  { name: 'Blue', hex: '#2f6fd0', finish: 'satin' },
  { name: 'Purple', hex: '#7b52c9', finish: 'satin' },
  { name: 'Pink', hex: '#e0619a', finish: 'satin' },
  { name: 'Beige', hex: '#d8c7a8', finish: 'matte' },
  { name: 'Brown', hex: '#6b4a32', finish: 'matte' },
  { name: 'Gold', hex: '#c9a227', finish: 'silk' },
  { name: 'Silver', hex: '#b9bdc4', finish: 'silk' },
  { name: 'Copper', hex: '#b06b3f', finish: 'silk' },
];

/* ----------------------------------------------------------------- finishes */

export interface FinishSpec {
  id: Finish;
  name: string;
  blurb: string;
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  /** Above zero puts the surface into the transmission pass, which is not cheap. */
  transmission: number;
}

/**
 * Seven surfaces, each of which is a real spool you can buy.
 *
 * The filament entries above carry a sensible default (Gold really is a silk), and `AUTO_FINISH`
 * keeps it as the landing state; any finish can still be chosen for any colour, so black PETG or
 * a resin print can be photographed too.
 *
 * Clearcoat and transmission are the only reason these are `MeshPhysicalMaterial`. That is the
 * entire cost of the list: there are no textures and no layer lines, because those are image
 * files or noise shaders.
 */
export const FINISHES: readonly FinishSpec[] = [
  {
    id: 'matte', name: 'Matte', blurb: 'Standard PLA, straight off the plate.',
    roughness: 0.78, metalness: 0, clearcoat: 0, clearcoatRoughness: 0, transmission: 0,
  },
  {
    id: 'satin', name: 'Satin', blurb: 'Most PLA in daylight. The safe middle.',
    roughness: 0.5, metalness: 0, clearcoat: 0, clearcoatRoughness: 0, transmission: 0,
  },
  {
    id: 'glossy', name: 'Glossy', blurb: 'PETG, or PLA that has been polished.',
    roughness: 0.24, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.12, transmission: 0,
  },
  {
    id: 'silk', name: 'Silk', blurb: 'Silk PLA. Sheen without being a mirror.',
    roughness: 0.28, metalness: 0.45, clearcoat: 0.25, clearcoatRoughness: 0.2, transmission: 0,
  },
  {
    id: 'metal', name: 'Metal fill', blurb: 'Metal-filled and burnished. Strongest with grey, gold, copper.',
    roughness: 0.38, metalness: 0.88, clearcoat: 0, clearcoatRoughness: 0, transmission: 0,
  },
  {
    id: 'translucent', name: 'Translucent', blurb: 'Natural PLA or clear PETG. Slower to render.',
    roughness: 0.32, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.15, transmission: 0.72,
  },
  {
    id: 'resin', name: 'Resin', blurb: 'SLA. No layer lines to hide, so it reads wet.',
    roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, transmission: 0,
  },
];

/** The finish id that means "whatever suits the colour", which is where a panel starts. */
export const AUTO_FINISH = 'auto';

export function finishById(id: string): FinishSpec {
  return FINISHES.find((f) => f.id === id) ?? FINISHES[0]!;
}

/** Resolves a finish choice against one filament's own default. */
export function effectiveFinish(filament: Filament, finishId: string): Finish {
  return finishId === AUTO_FINISH ? filament.finish : finishById(finishId).id;
}

/**
 * A finish for a colour that may not be a filament at all.
 *
 * A region's colour can come out of the file or a hex field rather than the shelf list, so auto
 * matches the shelf by hex where it can and falls back to satin, which is what most PLA looks
 * like in daylight.
 */
export function resolveFinish(hex: string, finishId: string): Finish {
  if (finishId !== AUTO_FINISH) return finishById(finishId).id;
  const shelf = STUDIO_FILAMENTS.find((f) => f.hex.toLowerCase() === hex.toLowerCase());
  return shelf ? shelf.finish : 'satin';
}

/* ------------------------------------------------------------------ angles */

/**
 * One camera position that becomes one image.
 *
 * A preset and a saved view are one kind of thing: a preset is simply a shot that ships in the
 * default list.
 */
export interface Shot {
  id: string;
  name: string;
  /** Direction from the model to the camera, in y-up space, before normalising. */
  dir: readonly [number, number, number];
  /** Multiplies the fitted distance. Below 1 crops in and reads as a closer lens. */
  zoom: number;
  /**
   * Where the camera looks, moved off the model's centre by a pan: an offset in model radii, in
   * the scene's own axes (y-up). Missing, the centre, so a shot written before panning frames as
   * it always did.
   */
  offset?: readonly [number, number, number];
  /**
   * In the batch.
   *
   * On the shot itself rather than in a separate list of picked ids: two sources of truth about
   * which views were picked let a dropped shot leave its id behind, and then a count lies.
   */
  on: boolean;
  /** Seeded from `PRESET_SHOTS`, so a menu can offer Reset where it would offer Delete. */
  preset?: boolean;
}

/**
 * Five shots, because a listing wants a hero and then proof it is a real object.
 *
 * `hero` is a three-quarter view, roughly the angle slicers use for their own previews, so even a
 * flat part reads as an object.
 *
 * These are directions in *the file's own axes*, which is why they are a starting point rather
 * than an answer: "Front" is whichever way the designer happened to point the model on export. A
 * shot made from wherever the preview was dragged (`readView`) adds to them, and `Orientation`
 * fixes a file that loaded on its side.
 */
export const PRESET_SHOTS: readonly Shot[] = [
  { id: 'hero', name: 'Hero', dir: [1, 0.8, 1.25], zoom: 1, on: true, preset: true },
  { id: 'low', name: 'Low angle', dir: [1, 0.32, 1.15], zoom: 0.94, on: false, preset: true },
  { id: 'front', name: 'Front', dir: [0, 0.14, 1], zoom: 1, on: false, preset: true },
  { id: 'side', name: 'Side', dir: [1, 0.14, 0.02], zoom: 1, on: false, preset: true },
  { id: 'top', name: 'Top down', dir: [0.02, 1, 0.02], zoom: 1, on: false, preset: true },
];

/** The shot every fallback lands on. */
const HERO: Shot = PRESET_SHOTS[0]!;

/** A fresh list for a model the studio has not seen. Copied, so nothing is shared. */
export function defaultShots(): Shot[] {
  return PRESET_SHOTS.map((s) => ({ ...s }));
}

export function shotById(shots: readonly Shot[], id: string): Shot {
  return shots.find((s) => s.id === id) ?? shots[0] ?? { ...HERO };
}

/** Numbers a new shot so it never collides with a preset or with another shot. */
export function nextShotId(existing: readonly Shot[]): string {
  let n = existing.length + 1;
  while (existing.some((s) => s.id === `shot-${n}`)) n++;
  return `shot-${n}`;
}

/** Numbers a new colourway the same way, against whatever the model already has. */
export function nextColourwayId(existing: readonly { id: string }[]): string {
  let n = existing.length + 1;
  while (existing.some((c) => c.id === `way-${n}`)) n++;
  return `way-${n}`;
}

/* --------------------------------------------------------------- backdrops */

export interface Backdrop {
  id: string;
  name: string;
  /** Top and bottom of the background wash. Null means no background at all. */
  sky: readonly [string, string] | null;
  /** The surface the model sits on. Null means a shadow with nothing under it. */
  floor: string | null;
  /** Draws the wash as a centre-out vignette instead of a top-to-bottom sweep. */
  radial?: boolean;
  blurb: string;
}

/** The id whose colours come from the panel rather than from this list. */
export const CUSTOM_BACKDROP = 'custom';

export const BACKDROPS: readonly Backdrop[] = [
  {
    id: 'white', name: 'Pure white',
    sky: ['#ffffff', '#ffffff'], floor: '#fbfbfb',
    blurb: 'Flat white, no gradient. What most marketplaces ask for.',
  },
  {
    id: 'studio-light', name: 'Light studio',
    sky: ['#ffffff', '#dcdce1'], floor: '#e9e9ee',
    blurb: 'White sweep. The default most shops expect.',
  },
  {
    id: 'soft-grey', name: 'Soft grey',
    sky: ['#e4e6ea', '#c6cad2'], floor: '#dcdee4',
    blurb: 'For a white or pale print, which vanishes on white.',
  },
  {
    id: 'warm', name: 'Warm grey',
    sky: ['#e8e0d4', '#cdc2b2'], floor: '#ded4c5',
    blurb: 'Softer than white. Flatters beige, brown and wood-fill.',
  },
  {
    id: 'sand', name: 'Sand',
    sky: ['#efe3cf', '#d9c4a2'], floor: '#e7d9c0',
    blurb: 'Warmer again. Good under terracotta, gold and green.',
  },
  {
    id: 'sage', name: 'Sage',
    sky: ['#dfe6dc', '#b3c2b0'], floor: '#d3ddd0',
    blurb: 'Muted green. Quiets a loud print without going grey.',
  },
  {
    id: 'blush', name: 'Blush',
    sky: ['#f4e2e2', '#dcbcbe'], floor: '#eed7d7',
    blurb: 'Pink-neutral. Reads as a lifestyle shot rather than a spec shot.',
  },
  {
    id: 'cool-blue', name: 'Cool blue',
    sky: ['#dfe8f2', '#adc0d6'], floor: '#d3dfec',
    blurb: 'Cold light. Makes greys and silvers look like metal.',
  },
  {
    id: 'charcoal', name: 'Charcoal',
    sky: ['#3a3d44', '#23262b'], floor: '#2e3138',
    blurb: 'Dark, but not black. Holds a white print instead of letting it glow.',
  },
  {
    id: 'studio-dark', name: 'Dark studio',
    sky: ['#2a2d34', '#15171c'], floor: '#1d2026',
    blurb: 'Reads well against a dark listing page, and colours pop.',
  },
  {
    id: 'spotlight', name: 'Spotlight',
    sky: ['#4a4a52', '#0b0c0e'], floor: '#17181c', radial: true,
    blurb: 'A vignette that falls off from behind the model. The reveal shot.',
  },
  {
    id: 'gradient', name: 'Accent wash',
    sky: ['#3b3160', '#171a21'], floor: '#20222b',
    blurb: 'A deep violet wash, for store banners.',
  },
  {
    id: 'transparent', name: 'Transparent',
    sky: null, floor: null,
    blurb: 'PNG with alpha, shadow kept. Drop it onto your own background.',
  },
  {
    id: CUSTOM_BACKDROP, name: 'Custom',
    sky: ['#ffffff', '#dcdce1'], floor: '#e9e9ee',
    blurb: 'Your own two colours and a floor, for a shop with a look.',
  },
];

export function backdropById(id: string): Backdrop {
  return BACKDROPS.find((b) => b.id === id) ?? BACKDROPS[0]!;
}

export interface CustomBackdrop { top: string; bottom: string; floor: string }

export const DEFAULT_CUSTOM: CustomBackdrop = {
  top: '#f4f2ff', bottom: '#c9c2e8', floor: '#e2ddf4',
};

/** The backdrop to actually render, with the panel's colours folded into the custom one. */
export function resolveBackdrop(id: string, custom: CustomBackdrop): Backdrop {
  const base = backdropById(id);
  if (base.id !== CUSTOM_BACKDROP) return base;
  return { ...base, sky: [custom.top, custom.bottom], floor: custom.floor };
}

/* ---------------------------------------------------------------- lighting */

export interface Lighting {
  /** Which preset the sliders last came from. Informational; the numbers are the truth. */
  presetId: string;
  /** Degrees around the camera. Zero is on the lens axis, positive is camera-right. */
  azimuth: number;
  /** Degrees above the camera's horizon. */
  elevation: number;
  key: number;
  fill: number;
  rim: number;
  /** Radius of the key's area, as a fraction of the model. Bigger is a softer shadow. */
  softness: number;
  /** How much of the room environment reaches the surface. */
  ambience: number;
  exposure: number;
  /** Zero to one. Scales both the cast shadow and the contact shadow on a bare floor. */
  shadowStrength: number;
  /**
   * Pins the lights to the model instead of to the camera.
   *
   * Off, the default, is a lightbox: you walk round the table and the softbox stays put relative
   * to you, so every angle in a batch is lit the same way. On is a turntable: the light stays
   * where it is and sweeps across the model as the camera moves, so a side or top shot can come
   * out backlit.
   */
  lockToModel: boolean;
}

export interface LightPreset {
  id: string;
  name: string;
  blurb: string;
  values: Omit<Lighting, 'presetId' | 'lockToModel'>;
}

export const LIGHT_PRESETS: readonly LightPreset[] = [
  {
    id: 'softbox', name: 'Softbox', blurb: 'One big soft key, up and to the right.',
    values: {
      azimuth: 36, elevation: 42, key: 2.1, fill: 0.35, rim: 0, softness: 0.55,
      ambience: 1, exposure: 1.05, shadowStrength: 1,
    },
  },
  {
    id: 'three-point', name: 'Three point', blurb: 'Key, fill and a rim to lift it off the background.',
    values: {
      azimuth: 42, elevation: 38, key: 2.2, fill: 0.75, rim: 1.1, softness: 0.4,
      ambience: 0.9, exposure: 1.05, shadowStrength: 0.8,
    },
  },
  {
    id: 'flat', name: 'Flat', blurb: 'Even and shadowless, for marketplaces that reject moody shots.',
    values: {
      azimuth: 18, elevation: 30, key: 1.35, fill: 1.35, rim: 0.45, softness: 0.8,
      ambience: 1.5, exposure: 1.1, shadowStrength: 0.35,
    },
  },
  {
    id: 'dramatic', name: 'Dramatic', blurb: 'One hard key from low and to the side. Deep shadows.',
    values: {
      azimuth: 68, elevation: 18, key: 3.1, fill: 0.08, rim: 0.9, softness: 0.14,
      ambience: 0.45, exposure: 1, shadowStrength: 1,
    },
  },
  {
    id: 'top', name: 'Top light', blurb: 'Straight down, like a shelf under a strip light.',
    values: {
      azimuth: 6, elevation: 76, key: 2.4, fill: 0.4, rim: 0.25, softness: 0.6,
      ambience: 1.05, exposure: 1.05, shadowStrength: 0.9,
    },
  },
];

const SOFTBOX: LightPreset = LIGHT_PRESETS[0]!;

export function lightPresetById(id: string): LightPreset {
  return LIGHT_PRESETS.find((p) => p.id === id) ?? SOFTBOX;
}

export const DEFAULT_LIGHTING: Lighting = {
  presetId: SOFTBOX.id,
  ...SOFTBOX.values,
  lockToModel: false,
};

/** A preset writes every slider, so picking one and then nudging is the normal path. */
export function applyLightPreset(current: Lighting, id: string): Lighting {
  const preset = lightPresetById(id);
  return { ...current, presetId: preset.id, ...preset.values };
}

/* ------------------------------------------------------------- orientation */

/**
 * How the model is stood up before anything looks at it.
 *
 * Three axes, not two. Quarter turns about X and Y do reach all 24 axis-aligned orientations on
 * their own, but getting a model off its side then takes a sequence nobody works out at a panel.
 * Reachable is not the same as discoverable, and Roll is one press.
 *
 * The fine offsets are for posing a hero shot rather than for righting a file, which is why they
 * are small.
 */
export interface Orientation {
  /** Quarter turns, 0-3. Tip nods it forward, Turn spins it on the spot, Roll leans it. */
  tip: number;
  turn: number;
  roll: number;
  /** Degrees, -45 to 45, added after the quarter turns. */
  tipFine: number;
  turnFine: number;
  rollFine: number;
}

export const FLAT: Orientation = {
  tip: 0, turn: 0, roll: 0, tipFine: 0, turnFine: 0, rollFine: 0,
};

/** Has the model been stood up at all? Drives whether Reset is offered. */
export function isStood(o: Orientation): boolean {
  return o.tip !== 0 || o.turn !== 0 || o.roll !== 0
    || o.tipFine !== 0 || o.turnFine !== 0 || o.rollFine !== 0;
}

/* ----------------------------------------------------------------- options */

/** Everything a photograph of a model looks like: what the live preview and a still share. */
export interface SceneOptions {
  shot: Shot;
  backdrop: Backdrop;
  /** What every region of the model is coloured with. */
  colourway: Colourway;
  orientation: Orientation;
  lighting: Lighting;
  shadow: boolean;
}

/** A still: the scene, and the size and quality of the image made from it. */
export interface RenderOptions extends SceneOptions {
  width: number;
  height: number;
  /** Averaged passes. More is smoother shadows and cleaner edges, and slower. */
  samples: number;
  /** Renders this many times larger, then downsamples. */
  supersample: number;
}

export const DEFAULT_SAMPLES = 24;

/* ------------------------------------------------------------------- sizes */

export interface StillSize { id: string; name: string; width: number; height: number }

export const STILL_SIZES: readonly StillSize[] = [
  { id: 'square-1000', name: '1000 x 1000', width: 1000, height: 1000 },
  { id: 'square-2000', name: '2000 x 2000', width: 2000, height: 2000 },
  { id: 'wide-1600', name: '1600 x 1200', width: 1600, height: 1200 },
  { id: 'story', name: '1080 x 1350', width: 1080, height: 1350 },
];

export function stillSizeById(id: string): StillSize {
  return STILL_SIZES.find((s) => s.id === id) ?? STILL_SIZES[0]!;
}

/* ------------------------------------------------------------- render plan */

export interface RenderJob {
  shot: Shot;
  colourway: Colourway;
  fileName: string;
}

/**
 * Turns "these shots, these colourways" into the list of images to produce.
 *
 * Pure, and tested, because this is where a batch quietly becomes 48 renders. The caller can
 * show `plan.length` before it starts, which is the whole reason it is a separate step.
 *
 * Takes resolved shots and colourways rather than ids: both belong to one model and no lookup
 * table knows about them.
 *
 * The colourway name is left out of the file name when it is the only one, because
 * `dragon-keychain-hero.png` is what a single-colour batch should still produce.
 */
export function planRenders(
  stem: string,
  shots: readonly Shot[],
  colourways: readonly Colourway[],
): RenderJob[] {
  const list = shots.length ? shots : [{ ...HERO }];
  const ways = colourways.length ? colourways : [AS_PRINTED];
  const jobs: RenderJob[] = [];
  const seen = new Set<string>();
  for (const shot of list) {
    for (const colourway of ways) {
      const base = renderFileName(stem, shot.id, ways.length > 1 ? colourway.name : null);
      let name = base;
      // Two colourways named the same, or a stem that collides after sanitising, must not
      // silently overwrite each other on disk.
      for (let n = 2; seen.has(name); n++) name = `${base.slice(0, -4)}-${n}.png`;
      seen.add(name);
      jobs.push({ shot, colourway, fileName: name });
    }
  }
  return jobs;
}

/** `Dragon Keychain.3mf` + hero + Gold on black becomes `dragon-keychain-hero-gold-on-black.png`. */
export function renderFileName(
  stem: string,
  shotId: string,
  colourwayName: string | null,
): string {
  const bits = [safeSlug(stem) || 'render', safeSlug(shotId)];
  if (colourwayName) bits.push(safeSlug(colourwayName));
  return `${bits.filter(Boolean).join('-')}.png`;
}

/** Lowercase, ASCII-ish, no path separators, no runs of dashes, never empty-dangerous. */
export function safeSlug(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** A file name without its folder or extension: what the files made from it are named after. */
export function fileStem(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** `value` held in `[min, max]`; NaN becomes `min`. */
export function clamp(value: number, min: number, max: number): number {
  // Only NaN needs the special case. `Math.min`/`Math.max` already send the infinities to the
  // right end, and sending `Infinity` to the *floor* would silently turn a mistyped sample count
  // into the fastest, ugliest render rather than the slowest, best one.
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// What a shoot is, and the decisions about it that need no screen: the photo sizes, the angles,
// which way up, the backdrop built from one colour, the default set of photos, what the batch
// makes and what each file is called. No DOM and no WebGL, so the tests run it in node.

import {
  AUTO_FINISH, CUSTOM_BACKDROP, DEFAULT_LIGHTING, FLAT, PRESET_SHOTS, STUDIO_FILAMENTS,
  applyLightPreset, resolveBackdrop, safeSlug,
  type Backdrop, type Colourway, type Finish, type Lighting, type Orientation, type PaintRegion,
  type RegionOverride, type Shot,
} from '@vostok/render';

/* ------------------------------------------------------------------ sizes */

export type SizeId = 'square' | 'portrait' | 'landscape' | 'wide' | 'story' | 'custom';

/** The ratios offered, each 2000 px on its long side: marketplaces scale down, never up. */
export const PHOTO_SHAPES: readonly { id: Exclude<SizeId, 'custom'>; name: string; ratio: string; width: number; height: number }[] = [
  { id: 'square', name: 'Square', ratio: '1:1', width: 2000, height: 2000 },
  { id: 'portrait', name: 'Portrait', ratio: '4:5', width: 1600, height: 2000 },
  { id: 'landscape', name: 'Landscape', ratio: '4:3', width: 2000, height: 1500 },
  { id: 'wide', name: 'Wide', ratio: '16:9', width: 2000, height: 1125 },
  { id: 'story', name: 'Story', ratio: '9:16', width: 1125, height: 2000 },
];

/** A side of a custom size, in px: under 200 is a thumbnail, and the renderer stops at 6000. */
export const SIDE_MIN = 200;
export const SIDE_MAX = 6000;
export const clampSide = (v: number) => (Number.isFinite(v) ? Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, v))) : 2000);

export interface PhotoSize { width: number; height: number }

/** The size every render of this look comes out at: a ratio's, or the custom one typed in. */
export function photoSize(look: Pick<Look, 'sizeId' | 'customWidth' | 'customHeight'>): PhotoSize {
  if (look.sizeId === 'custom') return { width: clampSide(look.customWidth), height: clampSide(look.customHeight) };
  const s = PHOTO_SHAPES.find((p) => p.id === look.sizeId) ?? PHOTO_SHAPES[0]!;
  return { width: s.width, height: s.height };
}

/** Width over height, which is the shape the preview frame takes. */
export function aspectOf(look: Pick<Look, 'sizeId' | 'customWidth' | 'customHeight'>): number {
  const s = photoSize(look);
  return s.width / s.height;
}

/* ----------------------------------------------------------------- angles */

export type AngleId = 'angled' | 'front' | 'side' | 'top' | 'low';

/** The angle switch, in the engine's own directions. "Angled" is the engine's hero. */
export const ANGLES: readonly { id: AngleId; name: string; shot: string }[] = [
  { id: 'angled', name: 'Angled', shot: 'hero' },
  { id: 'front', name: 'Front', shot: 'front' },
  { id: 'side', name: 'Side', shot: 'side' },
  { id: 'top', name: 'Top', shot: 'top' },
  { id: 'low', name: 'Low', shot: 'low' },
];

/** One photo you will get: where the camera is. `angle` is 'view' once the picture was dragged. */
export interface Photo {
  id: string;
  angle: AngleId | 'view';
  dir: [number, number, number];
  zoom: number;
  /** The pan: where the camera looks, from the model's centre, in model radii. */
  offset: [number, number, number];
}

export function photoAt(id: string, angle: AngleId): Photo {
  const preset = PRESET_SHOTS.find((s) => s.id === ANGLES.find((a) => a.id === angle)!.shot)!;
  return { id, angle, dir: [preset.dir[0], preset.dir[1], preset.dir[2]], zoom: preset.zoom, offset: [0, 0, 0] };
}

export function shotOf(photo: Photo): Shot {
  return { id: photo.id, name: photo.angle, dir: photo.dir, zoom: photo.zoom, offset: photo.offset, on: true };
}

/** A fresh id that no photo in the list has. */
export function nextPhotoId(photos: readonly Photo[]): string {
  let n = photos.length + 1;
  while (photos.some((p) => p.id === `photo-${n}`)) n++;
  return `photo-${n}`;
}

/** The angles of the default set, by shape. */
const FLAT_SET: AngleId[] = ['angled', 'top', 'low'];
const TALL_SET: AngleId[] = ['angled', 'front', 'side', 'low'];

/**
 * The photos a model starts with, chosen from its shape as it stands. A flat model (its height
 * under a third of its longest side, a keychain or a coaster) gets Angled, Top and Low: seen
 * from the front or the side it is a sliver. Anything taller gets Angled, Front, Side and Low.
 */
export function defaultPhotos(size: readonly [number, number, number]): Photo[] {
  const [w, h, d] = size;
  const flat = h < Math.max(w, d) / 3;
  return (flat ? FLAT_SET : TALL_SET).map((a, i) => photoAt(`photo-${i + 1}`, a));
}

/** Is this one of the default sets, untouched? Then a new model may pick its own. */
export function isDefaultSet(photos: readonly Photo[]): boolean {
  return [FLAT_SET, TALL_SET].some((set) => photos.length === set.length
    && photos.every((p, i) => p.angle === set[i] && same(p, photoAt(p.id, set[i]!))));
}
const same = (a: Photo, b: Photo) => a.zoom === b.zoom && a.dir.every((v, i) => v === b.dir[i])
  && a.offset.every((v, i) => v === b.offset[i]);

/* ------------------------------------------------------------- which way up */

export type RestId = 'as-loaded' | 'flipped' | 'front' | 'back' | 'left' | 'right';

export const RESTS: readonly { id: RestId; name: string; tip: number; roll: number }[] = [
  { id: 'as-loaded', name: 'As loaded', tip: 0, roll: 0 },
  { id: 'flipped', name: 'Flipped', tip: 2, roll: 0 },
  { id: 'front', name: 'On front', tip: 1, roll: 0 },
  { id: 'back', name: 'On back', tip: 3, roll: 0 },
  { id: 'left', name: 'On left', tip: 0, roll: 1 },
  { id: 'right', name: 'On right', tip: 0, roll: 3 },
];

/** The engine's quarter turns for a resting side and a turn (0-3). */
export function orientationOf(rest: string, turn: number): Orientation {
  const r = RESTS.find((x) => x.id === rest) ?? RESTS[0]!;
  return { ...FLAT, tip: r.tip, roll: r.roll, turn: ((Math.round(turn) % 4) + 4) % 4 };
}

/* ---------------------------------------------------------------- the look */

/** What belongs to the shop rather than to one model, and is remembered in the browser. */
export interface Look {
  backdropId: string;
  /** The custom background's one colour. */
  custom: string;
  lightId: string;
  /** Percent of the light's own exposure. */
  brightness: number;
  sizeId: SizeId;
  /** The custom size, px: used while `sizeId` is 'custom', kept while it is not. */
  customWidth: number;
  customHeight: number;
}

export const DEFAULT_LOOK: Look = {
  backdropId: 'studio-light',
  custom: '#c9d3df',
  lightId: 'softbox',
  brightness: 100,
  sizeId: 'square',
  customWidth: 2000,
  customHeight: 2000,
};

/** The backgrounds offered, in order, with their names on this screen. Accent wash is left out:
 *  its colours are another product's, nothing to do with a seller's listing. */
export const BACKGROUNDS: readonly { id: string; name: string }[] = [
  { id: 'white', name: 'White' },
  { id: 'studio-light', name: 'Studio' },
  { id: 'soft-grey', name: 'Gray' },
  { id: 'warm', name: 'Warm gray' },
  { id: 'sand', name: 'Sand' },
  { id: 'sage', name: 'Sage' },
  { id: 'blush', name: 'Blush' },
  { id: 'cool-blue', name: 'Cool blue' },
  { id: 'charcoal', name: 'Charcoal' },
  { id: 'studio-dark', name: 'Dark' },
  { id: 'spotlight', name: 'Spotlight' },
  { id: 'transparent', name: 'None' },
  { id: CUSTOM_BACKDROP, name: 'Custom' },
];

/** The light rigs offered, by the names a customer would use. */
export const LIGHTS: readonly { id: string; name: string }[] = [
  { id: 'softbox', name: 'Soft' },
  { id: 'three-point', name: 'Crisp' },
  { id: 'flat', name: 'Even' },
  { id: 'dramatic', name: 'Dramatic' },
  { id: 'top', name: 'Overhead' },
];

/** The finishes offered. Resin is left out: the printers we name print filament. */
export const FINISH_CHOICES: readonly { id: Finish; name: string }[] = [
  { id: 'matte', name: 'Matte' },
  { id: 'satin', name: 'Satin' },
  { id: 'glossy', name: 'Glossy' },
  { id: 'silk', name: 'Silk' },
  { id: 'metal', name: 'Metal' },
  { id: 'translucent', name: 'Clear' },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** HSL lightness moved by `points` (0-100), clamped. */
export function lighten(hex: string, points: number): string {
  if (!HEX.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  let r = ((n >> 16) & 255) / 255;
  let g = ((n >> 8) & 255) / 255;
  let b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = Math.min(1, Math.max(0, l + points / 100));
  const hue = (p: number, q: number, t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  if (s === 0) r = g = b = l;
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** The engine's backdrop for a look: the custom one built from one colour the way the built-in
 *  ones are, a wash falling to the colour with the floor between. */
export function backdropOf(look: Look): Backdrop {
  return resolveBackdrop(look.backdropId, {
    top: lighten(look.custom, 12),
    bottom: look.custom,
    floor: lighten(look.custom, 6),
  });
}

/** The engine's lighting for a look: the rig, its exposure times the brightness, following the
 *  camera so every photo is lit the same way. */
export function lightingOf(look: Look): Lighting {
  const rig = applyLightPreset({ ...DEFAULT_LIGHTING, lockToModel: false }, look.lightId);
  return { ...rig, exposure: rig.exposure * (look.brightness / 100) };
}

/** Bring a stored or loaded look back into range, keeping what is valid. */
export function coerceLook(raw: unknown): Look {
  const out = { ...DEFAULT_LOOK };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.backdropId === 'string' && BACKGROUNDS.some((b) => b.id === r.backdropId)) out.backdropId = r.backdropId;
  if (typeof r.custom === 'string' && HEX.test(r.custom)) out.custom = r.custom.toLowerCase();
  if (typeof r.lightId === 'string' && LIGHTS.some((l) => l.id === r.lightId)) out.lightId = r.lightId;
  if (typeof r.brightness === 'number' && Number.isFinite(r.brightness)) out.brightness = Math.min(150, Math.max(50, Math.round(r.brightness / 5) * 5));
  if (typeof r.sizeId === 'string' && (r.sizeId === 'custom' || PHOTO_SHAPES.some((s) => s.id === r.sizeId))) out.sizeId = r.sizeId as SizeId;
  if (typeof r.customWidth === 'number') out.customWidth = clampSide(r.customWidth);
  if (typeof r.customHeight === 'number') out.customHeight = clampSide(r.customHeight);
  return out;
}

/* ---------------------------------------------------------------- colours */

/** What a region the file gave no colour starts as. */
export const UNCOLOURED = '#8a8d93';

/** The first colorway of a model: the file's colours, and Gray where it gave none. */
export function firstColourway(regions: readonly PaintRegion[]): Colourway {
  const colours: Record<string, RegionOverride> = {};
  for (const r of regions) if (!r.fileHex) colours[r.key] = { hex: UNCOLOURED, finishId: AUTO_FINISH };
  return { id: 'way-1', name: 'Colorway 1', colours };
}

/** Does this colorway show the file's own colours? (Gray standing in for none counts as them.) */
export function showsFileColours(way: Colourway, regions: readonly PaintRegion[]): boolean {
  const first = firstColourway(regions);
  return regions.every((r) => {
    const a = way.colours[r.key];
    const b = first.colours[r.key];
    return a?.hex === b?.hex && (a?.finishId ?? AUTO_FINISH) === (b?.finishId ?? AUTO_FINISH);
  });
}

/** The finish a region shows: its own pick, or the filament's when it has none (Gold is Silk). */
export function finishShown(hex: string, finishId: string): Finish {
  if (finishId !== AUTO_FINISH && FINISH_CHOICES.some((f) => f.id === finishId)) return finishId as Finish;
  return STUDIO_FILAMENTS.find((f) => f.hex.toLowerCase() === hex.toLowerCase())?.finish ?? 'satin';
}

/** Regions biggest first, so the body of the model leads the list. */
export function regionsBySize(regions: readonly PaintRegion[]): PaintRegion[] {
  return [...regions].sort((a, b) => b.triangles - a.triangles);
}

/* ------------------------------------------------------------------ batch */

export interface Job {
  photo: Photo;
  /** Its place in the strip, from 1. */
  n: number;
  way: Colourway;
  /** Its place among the colorways, from 1. */
  m: number;
  fileName: string;
}

/**
 * Every photo in every colorway, in strip order, each with its file name:
 * `{stem}-{n}-{angle}[-colorway-{m}].png`, the colorway only when there is more than one. A
 * single photo is `{stem}-{angle}.png`.
 */
export function planShoot(stem: string, photos: readonly Photo[], ways: readonly Colourway[]): Job[] {
  const base = safeSlug(stem) || 'render';
  const single = photos.length === 1 && ways.length === 1;
  const jobs: Job[] = [];
  photos.forEach((photo, i) => {
    ways.forEach((way, j) => {
      const bits = single ? [base, photo.angle] : [base, String(i + 1), photo.angle];
      if (ways.length > 1) bits.push(`colorway-${j + 1}`);
      jobs.push({ photo, n: i + 1, way, m: j + 1, fileName: `${bits.join('-')}.png` });
    });
  });
  return jobs;
}

/** What "Download all" is called: the one PNG, or the ZIP holding them. */
export function downloadName(stem: string, jobs: readonly { fileName: string }[]): string {
  if (jobs.length === 1) return jobs[0]!.fileName;
  return `${safeSlug(stem) || 'render'}-renders.zip`;
}

/** The Generate button and the note under it. */
export function generateWords(photos: number, ways: number, size: PhotoSize): { label: string; note: string } {
  const total = photos * ways;
  const px = `${size.width} × ${size.height} px`;
  if (total === 1) return { label: 'Generate render', note: px };
  if (ways > 1) return { label: `Generate ${total} renders`, note: `${photos} ${photos === 1 ? 'angle' : 'angles'} × ${ways} colorways · ${px}` };
  return { label: `Generate ${total} renders`, note: `${px} each` };
}

/** What a finished render is called on screen: its photo, its angle, and its colorway when
 *  there is more than one. */
export function renderLabel(job: Job, ways: number): string {
  const angle = job.photo.angle === 'view' ? 'Your angle' : ANGLES.find((a) => a.id === job.photo.angle)!.name;
  return `Photo ${job.n} · ${angle}${ways > 1 ? ` · Colorway ${job.m}` : ''}`;
}

/** "72 × 18 × 9 mm": whole millimetres, and one decimal under ten. */
export function sizeText(size: readonly [number, number, number]): string {
  const f = (v: number) => (v < 10 ? (Math.round(v * 10) / 10).toString() : Math.round(v).toString());
  return `${f(size[0])} × ${f(size[2])} × ${f(size[1])} mm`;
}


/* ------------------------------------------------------------ a saved shoot */

/** At most this many photos: the strip's add tile hides here. */
export const MAX_PHOTOS = 8;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The photos of a saved shoot, checked: each with an angle, a direction and a zoom, ids unique,
 *  at most `MAX_PHOTOS`. Null when nothing in it is usable. */
export function coercePhotos(raw: unknown): Photo[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Photo[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const dir = Array.isArray(r.dir) && r.dir.length === 3 && r.dir.every(finite) ? (r.dir as [number, number, number]) : null;
    const angle = r.angle === 'view' || ANGLES.some((a) => a.id === r.angle) ? (r.angle as Photo['angle']) : null;
    if (!dir || !angle || !finite(r.zoom) || r.zoom <= 0 || dir.every((v) => v === 0)) continue;
    // A shoot saved before panning has no offset: the centre. A pan further than ten model radii
    // has lost the model, so it is put back.
    const given = Array.isArray(r.offset) && r.offset.length === 3 && r.offset.every(finite) ? (r.offset as [number, number, number]) : null;
    const offset: [number, number, number] = given && given.every((v) => Math.abs(v) <= 10) ? given : [0, 0, 0];
    out.push({ id: nextPhotoId(out), angle, dir, zoom: Math.min(20, Math.max(0.05, r.zoom)), offset });
    if (out.length === MAX_PHOTOS) break;
  }
  return out.length ? out : null;
}

/** The colorways of a saved shoot, checked: colours `#rrggbb`, finishes ones offered or auto. */
export function coerceColourways(raw: unknown): Colourway[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Colourway[] = [];
  for (const w of raw) {
    if (!w || typeof w !== 'object') continue;
    const colours: Record<string, RegionOverride> = {};
    const given = (w as Record<string, unknown>).colours;
    if (given && typeof given === 'object') {
      for (const [key, c] of Object.entries(given as Record<string, unknown>)) {
        const o = c as Record<string, unknown> | null;
        if (!o || typeof o.hex !== 'string' || !HEX.test(o.hex)) continue;
        const finishId = typeof o.finishId === 'string' && (o.finishId === AUTO_FINISH || FINISH_CHOICES.some((f) => f.id === o.finishId)) ? o.finishId : AUTO_FINISH;
        colours[key] = { hex: o.hex.toLowerCase(), finishId };
      }
    }
    out.push({ id: `way-${out.length + 1}`, name: `Colorway ${out.length + 1}`, colours });
  }
  return out.length ? out : null;
}

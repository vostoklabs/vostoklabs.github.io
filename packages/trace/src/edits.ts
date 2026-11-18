// Picture edits: the parts of a picture the customer took out or put back, and the crop.
//
// An edit is kept as a place in the picture (a fraction of its width and height), never as a
// traced shape: smoothing, the colour count and the size all redraw the shapes, so "shape 7" means
// nothing a moment later, while a pixel of the picture stays where it is. Each edit is applied
// again on every trace, after the background removal, then the crop masks what is outside its box,
// then the usual clean-up. With no edits and no crop the tracer runs exactly as it always did.
//
// Pure: no DOM, nothing but the pixels.
import type { RgbaImage } from './decode';
import { removeBackground, compositeOverMatte, cleanMask } from './matte';
import { srgbToOklab } from './colorspace';
import type { CropBox, PictureEdit, RGB } from './types';

/*
  Two pixels are one colour when they are this close in Oklab. Measured on flat art: within 0.10
  of a colour the picture's colour list names is 99 % of what the list says that colour covers;
  at 0.14 a dark green swallowed the lighter green beside it.
*/
export const SAME_COLOUR = 0.1;
/** A bring-back that would cover more than this share of the picture (or of the crop) is the
 *  background leaking in, and brings nothing back. */
export const RESTORE_CAP = 0.3;
/** The narrowest join a bring-back cuts through, as a share of the picture's short side. */
export const NECK_FRAC = 0.012;
/** The most edits a picture keeps. Each is applied on every trace. */
export const MAX_PICTURE_EDITS = 200;
/** How far an area grows past its own colour to take its anti-aliased rim with it, in pixels.
 *  One pixel left a thin ring of rim behind on a soft edge; two left nothing. */
export const growPx = (w: number, h: number): number => Math.max(2, Math.round((2 * Math.max(w, h)) / 1100));
/* A soft edge against the background (a blurred or resampled picture) is wider than that: past
   the two pixels the area also takes, for up to twice as far again, the pixels that are a blend
   of its colour and the background's, and nothing else. Measured on a grey disc blurred over
   5 px and noised: two pixels left a broken rim of 25 px that traced as specks; this leaves none. */
const SOFT_EDGE_STEPS = 2;

const OPAQUE = 128;

/** What each pixel was before any edit: the file's own alpha, and whether the background remover
 *  took it. A bring-back only ever returns what the file had, and only what one remover took (an
 *  edit or the background remover), so bringing back a part never brings back the background
 *  round it. */
export interface PictureBase {
  alpha: Uint8Array;
  /** 1 where the background remover took a pixel the file had opaque. */
  taken: Uint8Array;
  /** The background colour the remover found (see `PreparedArtwork.matte`). */
  matte: RGB | null;
}

export interface PrepareOptions {
  /** Strip a flat background first (default on). */
  removeBg?: boolean;
  edits?: readonly PictureEdit[];
  crop?: CropBox | null;
  /** Stop after the edits, before the crop and the clean-up, and always keep the `base`: the
   *  picture as the edits see it, which is what `pictureAreaAt` reads. */
  forPicking?: boolean;
}

export interface PreparedArtwork {
  /** The background colour the remover found, for the quantiser. */
  matte: RGB | null;
  /** Only when there were edits or `forPicking`. */
  base: PictureBase | null;
}

/** An area a tap would act on: what Remove would take, or what Bring back would return. */
export interface PictureArea {
  op: 'remove' | 'restore';
  /** 1 per pixel in the area, the picture's size. */
  mask: Uint8Array;
  count: number;
}

/**
 * The picture made ready to quantise, in place: the background removed, the edits applied in
 * order, the crop, then the soft edges and specks cleaned. With no edits and no crop these are
 * the three calls the tracer always made, in the same order.
 */
export function prepareArtwork(img: RgbaImage, opts: PrepareOptions = {}): PreparedArtwork {
  const edits = opts.edits ?? [];
  const keepBase = edits.length > 0 || opts.forPicking === true;
  const fileAlpha = keepBase ? alphaOf(img) : null;
  const matte = opts.removeBg !== false ? removeBackground(img) : null;
  let base: PictureBase | null = null;
  if (fileAlpha) {
    const { data } = img;
    const taken = new Uint8Array(fileAlpha.length);
    for (let p = 0; p < taken.length; p++) if (fileAlpha[p] >= OPAQUE && data[p * 4 + 3] < OPAQUE) taken[p] = 1;
    base = { alpha: fileAlpha, taken, matte };
    applyPictureEdits(img, edits, base, opts.crop);
  }
  if (opts.forPicking) return { matte, base };
  if (opts.crop) applyCrop(img, opts.crop);
  compositeOverMatte(img);
  cleanMask(img);
  return { matte, base };
}

/** Applies the edits in order, in place. `img` is the picture after the background removal;
 *  `base` what it was before (see `prepareArtwork`). An edit whose place is outside the crop does
 *  nothing until the crop is widened again; one that finds nothing to act on does nothing. */
export function applyPictureEdits(img: RgbaImage, edits: readonly PictureEdit[], base: PictureBase, crop?: CropBox | null): RgbaImage {
  const { data, width: W, height: H } = img;
  for (const e of edits) {
    if (e.op === 'dropColour') {
      const mask = withoutHairlines(colourMask(img, e.rgb), W, H);
      grow(mask, W, H, growPx(W, H), (q) => data[q * 4 + 3] >= OPAQUE);
      for (let p = 0; p < mask.length; p++) if (mask[p]) data[p * 4 + 3] = 0;
      continue;
    }
    const px = Math.min(W - 1, Math.max(0, Math.floor(e.x * W)));
    const py = Math.min(H - 1, Math.max(0, Math.floor(e.y * H)));
    const area = pictureAreaAt(img, base, px, py, crop);
    if (!area || area.op !== e.op) continue;
    const { mask } = area;
    if (e.op === 'remove') {
      for (let p = 0; p < mask.length; p++) if (mask[p]) data[p * 4 + 3] = 0;
    } else {
      for (let p = 0; p < mask.length; p++) if (mask[p]) data[p * 4 + 3] = base.alpha[p];
    }
  }
  return img;
}

/**
 * The area a tap at pixel (px, py) acts on, or null.
 *
 * On something still there: Remove takes the area of the same colour connected to it, grown over
 * its anti-aliased rim. On a place where something was taken (by an edit or by the background
 * remover): Bring back returns the area of that colour that the same remover took. When that
 * area runs out through a narrow gap into the background (the inside of a ring with a break in
 * it), the narrowest joins are cut and only the side that was tapped comes back; when it is
 * still most of the picture, it is the background and nothing comes back. A place the file
 * itself left transparent, or outside the crop, gives null.
 *
 * `img` is the picture as the edits see it: `prepareArtwork(copy, { forPicking: true })`.
 */
export function pictureAreaAt(img: RgbaImage, base: PictureBase, px: number, py: number, crop?: CropBox | null): PictureArea | null {
  const { data, width: W, height: H } = img;
  const box = cropPixels(crop, W, H);
  if (px < box.x0 || px >= box.x1 || py < box.y0 || py >= box.y1) return null;
  const inBox = (q: number) => {
    const x = q % W, y = (q / W) | 0;
    return x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1;
  };
  const seed = py * W + px;
  const g = growPx(W, H);

  if (data[seed * 4 + 3] >= OPAQUE) {
    const allowed = (q: number) => data[q * 4 + 3] >= OPAQUE && inBox(q);
    const { mask, rgb } = flood(img, seed, allowed);
    grow(mask, W, H, g, allowed);
    softEdge(img, mask, rgb, base.matte, g * SOFT_EDGE_STEPS, allowed);
    return { op: 'remove', mask, count: countOf(mask) };
  }

  if (base.alpha[seed] < OPAQUE) return null;
  const source = base.taken[seed];
  const allowed = (q: number) => data[q * 4 + 3] < OPAQUE && base.alpha[q] >= OPAQUE && base.taken[q] === source && inBox(q);
  const flooded = flood(img, seed, allowed);
  let mask: Uint8Array | null = flooded.mask;
  if (source) {
    // What the background remover took: the background itself, or a part of the art joined to it.
    const cap = RESTORE_CAP * (box.x1 - box.x0) * (box.y1 - box.y0);
    if (countOf(mask) > cap) {
      mask = null;
      const r0 = NECK_FRAC * Math.min(W, H);
      for (const r of [r0, r0 / 2, r0 / 4, 1]) {
        if (r < 1) continue;
        const cut = cutNecks(flooded.mask, W, H, seed, r);
        if (cut && countOf(cut) <= cap) { mask = cut; break; }
      }
      if (!mask) return null;
    }
  }
  grow(mask, W, H, g, allowed);
  // What an edit took comes back exactly as Remove took it, soft edge and all.
  if (!source) softEdge(img, mask, flooded.rgb, base.matte, g * SOFT_EDGE_STEPS, allowed);
  return { op: 'restore', mask, count: countOf(mask) };
}

/** Alpha 0 outside the crop, in place. A box that covers the whole picture changes nothing. */
export function applyCrop(img: RgbaImage, crop: CropBox): RgbaImage {
  const { data, width: W, height: H } = img;
  const box = cropPixels(crop, W, H);
  for (let y = 0; y < H; y++) {
    const inRow = y >= box.y0 && y < box.y1;
    for (let x = 0; x < W; x++) {
      if (inRow && x >= box.x0 && x < box.x1) continue;
      data[(y * W + x) * 4 + 3] = 0;
    }
  }
  return img;
}

/** Edits as read from a saved project: only well-formed ones, colours clamped to whole 0..255,
 *  at most `MAX_PICTURE_EDITS`. A place outside the picture (not 0..1) is dropped, never moved to
 *  its edge, where it would act on a part nobody tapped. Anything else gives `[]`. */
export function cleanPictureEdits(raw: unknown): PictureEdit[] {
  if (!Array.isArray(raw)) return [];
  const out: PictureEdit[] = [];
  const unit = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? round5(v) : null);
  for (const e of raw) {
    if (out.length >= MAX_PICTURE_EDITS) break;
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (o.op === 'remove' || o.op === 'restore') {
      const x = unit(o.x), y = unit(o.y);
      if (x !== null && y !== null) out.push({ op: o.op, x, y });
    } else if (o.op === 'dropColour' && Array.isArray(o.rgb) && o.rgb.length === 3
      && o.rgb.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      const [r, g, b] = (o.rgb as number[]).map((v) => Math.min(255, Math.max(0, Math.round(v))));
      out.push({ op: 'dropColour', rgb: [r, g, b] });
    }
  }
  return out;
}

/** A crop as read from a saved project or a drag: clamped to the picture and rounded, or null
 *  for junk, for a side under 2 % of the picture, and for a box within 0.5 % of the whole
 *  picture (so "no crop" is one value). */
export function cleanCropBox(raw: unknown): CropBox | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const n = [o.x, o.y, o.w, o.h];
  if (!n.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  let [x, y, w, h] = n as number[];
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  x = Math.min(1, x);
  y = Math.min(1, y);
  w = Math.min(w, 1 - x);
  h = Math.min(h, 1 - y);
  if (w < 0.02 || h < 0.02) return null;
  const FULL = 0.005;
  if (x <= FULL && y <= FULL && x + w >= 1 - FULL && y + h >= 1 - FULL) return null;
  return { x: round5(x), y: round5(y), w: round5(w), h: round5(h) };
}

// ---------------------------------------------------------------- the pixel work

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

function alphaOf(img: RgbaImage): Uint8Array {
  const n = img.width * img.height;
  const a = new Uint8Array(n);
  for (let p = 0; p < n; p++) a[p] = img.data[p * 4 + 3];
  return a;
}

function countOf(mask: Uint8Array): number {
  let c = 0;
  for (let p = 0; p < mask.length; p++) c += mask[p];
  return c;
}

/** The crop in whole pixels, [x0, x1) by [y0, y1); the whole picture without one. */
function cropPixels(crop: CropBox | null | undefined, W: number, H: number) {
  if (!crop) return { x0: 0, y0: 0, x1: W, y1: H };
  const x0 = Math.min(W, Math.max(0, Math.round(crop.x * W)));
  const y0 = Math.min(H, Math.max(0, Math.round(crop.y * H)));
  const x1 = Math.min(W, Math.max(x0, Math.round((crop.x + crop.w) * W)));
  const y1 = Math.min(H, Math.max(y0, Math.round((crop.y + crop.h) * H)));
  return { x0, y0, x1, y1 };
}

/** "Is this pixel's colour within SAME_COLOUR of `lab`", remembered per colour: flat art has a
 *  handful of colours, and a pixel's colour is converted once. */
function sameColourAs(data: Uint8ClampedArray, lab: [number, number, number]): (p: number) => boolean {
  const seen = new Map<number, boolean>();
  return (p) => {
    const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    let hit = seen.get(key);
    if (hit === undefined) {
      const c = srgbToOklab([r, g, b]);
      hit = Math.hypot(c[0] - lab[0], c[1] - lab[1], c[2] - lab[2]) <= SAME_COLOUR;
      seen.set(key, hit);
    }
    return hit;
  };
}

/** The area of `seed`'s colour connected to it (4-connected) over `allowed` pixels. The colour is
 *  the mean of the pixels round the seed (5 × 5) that match it, so one noisy pixel does not
 *  decide it. */
function flood(img: RgbaImage, seed: number, allowed: (q: number) => boolean): { mask: Uint8Array; rgb: RGB } {
  const { data, width: W, height: H } = img;
  const sx = seed % W, sy = (seed / W) | 0;
  const own = sameColourAs(data, srgbToOklab([data[seed * 4], data[seed * 4 + 1], data[seed * 4 + 2]]));
  let r = 0, g = 0, b = 0, k = 0;
  for (let y = Math.max(0, sy - 2); y <= Math.min(H - 1, sy + 2); y++) {
    for (let x = Math.max(0, sx - 2); x <= Math.min(W - 1, sx + 2); x++) {
      const q = y * W + x;
      if (!allowed(q) || !own(q)) continue;
      r += data[q * 4]; g += data[q * 4 + 1]; b += data[q * 4 + 2]; k++;
    }
  }
  const rgb: RGB = [Math.round(r / k), Math.round(g / k), Math.round(b / k)];
  const same = sameColourAs(data, srgbToOklab(rgb));
  const mask = new Uint8Array(W * H);
  const take = (q: number) => allowed(q) && same(q);
  mask[seed] = 1;
  const stack = [seed];
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % W;
    if (x > 0 && !mask[p - 1] && take(p - 1)) { mask[p - 1] = 1; stack.push(p - 1); }
    if (x < W - 1 && !mask[p + 1] && take(p + 1)) { mask[p + 1] = 1; stack.push(p + 1); }
    if (p >= W && !mask[p - W] && take(p - W)) { mask[p - W] = 1; stack.push(p - W); }
    if (p < W * (H - 1) && !mask[p + W] && take(p + W)) { mask[p + W] = 1; stack.push(p + W); }
  }
  return { mask, rgb };
}

/** Grows `mask` in place, up to `steps` pixels, over the `allowed` pixels whose colour is a blend
 *  of `rgb` and the background colour `matte`: the soft edge of an area against the background. */
function softEdge(img: RgbaImage, mask: Uint8Array, rgb: RGB, matte: RGB | null, steps: number, allowed: (q: number) => boolean): void {
  if (!matte) return;
  const { data, width: W, height: H } = img;
  const v = [matte[0] - rgb[0], matte[1] - rgb[1], matte[2] - rgb[2]];
  const len2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  if (len2 < 1) return;
  const seen = new Map<number, boolean>();
  const blend = (q: number) => {
    const r = data[q * 4], g = data[q * 4 + 1], b = data[q * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    let hit = seen.get(key);
    if (hit === undefined) {
      const t = Math.min(1, Math.max(0, ((r - rgb[0]) * v[0] + (g - rgb[1]) * v[1] + (b - rgb[2]) * v[2]) / len2));
      const c = srgbToOklab([r, g, b]);
      const m = srgbToOklab([rgb[0] + t * v[0], rgb[1] + t * v[1], rgb[2] + t * v[2]]);
      hit = Math.hypot(c[0] - m[0], c[1] - m[1], c[2] - m[2]) <= SAME_COLOUR;
      seen.set(key, hit);
    }
    return hit;
  };
  grow(mask, W, H, steps, (q) => allowed(q) && blend(q));
}

/** Every opaque pixel of this colour, anywhere in the picture. */
function colourMask(img: RgbaImage, rgb: RGB): Uint8Array {
  const { data, width: W, height: H } = img;
  const same = sameColourAs(data, srgbToOklab(rgb));
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < mask.length; p++) if (data[p * 4 + 3] >= OPAQUE && same(p)) mask[p] = 1;
  return mask;
}

/** Drops the pieces of `mask` with no pixel whose eight neighbours are all in it: hairlines, such
 *  as the anti-aliased edge between two other colours that happens to pass through this one. */
function withoutHairlines(mask: Uint8Array, W: number, H: number): Uint8Array {
  const n = W * H;
  const out = new Uint8Array(n);
  const solid = (p: number) => {
    const x = p % W, y = (p / W) | 0;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!mask[p + dy * W + dx]) return false;
    return true;
  };
  const seen = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    const piece = [start];
    let keep = false;
    for (let i = 0; i < piece.length; i++) {
      const p = piece[i];
      if (!keep && solid(p)) keep = true;
      const x = p % W;
      const visit = (q: number) => { if (mask[q] && !seen[q]) { seen[q] = 1; piece.push(q); } };
      if (x > 0) visit(p - 1);
      if (x < W - 1) visit(p + 1);
      if (p >= W) visit(p - W);
      if (p < n - W) visit(p + W);
    }
    if (keep) for (const p of piece) out[p] = 1;
  }
  return out;
}

/** Grows `mask` in place by `steps` pixels (4-connected) over `allowed` pixels. */
function grow(mask: Uint8Array, W: number, H: number, steps: number, allowed: (q: number) => boolean): void {
  let edge: number[] = [];
  for (let p = 0; p < mask.length; p++) if (mask[p]) edge.push(p);
  for (let s = 0; s < steps && edge.length; s++) {
    const next: number[] = [];
    const visit = (q: number) => { if (!mask[q] && allowed(q)) { mask[q] = 1; next.push(q); } };
    for (const p of edge) {
      const x = p % W;
      if (x > 0) visit(p - 1);
      if (x < W - 1) visit(p + 1);
      if (p >= W) visit(p - W);
      if (p < W * (H - 1)) visit(p + W);
    }
    edge = next;
  }
}

/**
 * The part of `area` on the seed's side of every join narrower than 2r: keep the pixels at least
 * r from the area's edge (the edge of the picture counts), keep the piece of those the seed is
 * in, and grow it back by r inside the area. Null when the seed is itself within r of the edge.
 */
function cutNecks(area: Uint8Array, W: number, H: number, seed: number, r: number): Uint8Array | null {
  // Chamfer distance to the nearest pixel outside the area, in thirds of a pixel (3 straight, 4
  // diagonal): two passes.
  const n = W * H;
  const d = new Int32Array(n);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[y * W + x]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (!area[p]) { d[p] = 0; continue; }
      d[p] = Math.min(at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const p = y * W + x;
      if (!area[p]) continue;
      d[p] = Math.min(d[p], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  const core = 3 * r;
  if (d[seed] < core) return null;
  // The seed's piece of the core.
  const out = new Uint8Array(n);
  out[seed] = 1;
  const piece = [seed];
  for (let i = 0; i < piece.length; i++) {
    const p = piece[i];
    const x = p % W;
    const visit = (q: number) => { if (!out[q] && d[q] >= core) { out[q] = 1; piece.push(q); } };
    if (x > 0) visit(p - 1);
    if (x < W - 1) visit(p + 1);
    if (p >= W) visit(p - W);
    if (p < n - W) visit(p + W);
  }
  // Grown back by r inside the area: each pixel reached remembers the core pixel it came from and
  // is kept while it is within r of it.
  const from = new Int32Array(n).fill(-1);
  for (const p of piece) from[p] = p;
  const queue = piece.slice();
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    const s = from[p], sx = s % W, sy = (s / W) | 0;
    const x = p % W, y = (p / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (!area[q] || out[q] || Math.hypot(nx - sx, ny - sy) > r) continue;
        out[q] = 1;
        from[q] = s;
        queue.push(q);
      }
    }
  }
  return out;
}

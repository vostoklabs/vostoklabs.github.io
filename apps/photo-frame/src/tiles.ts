// The flat pictures on the editor's tiles and in the walkthrough: an outline drawn in the frame's
// own colour with the sample photo in its window, a border's cross-section, and the prints side by
// side at their true sizes. Drawn on a canvas from the same rings the worker builds from.
import { frameLayout, type Outline, type Profile } from './geometry/layout';
import { outlineRecipe, roundedBoxR, type Ring } from './geometry/outline';
import { designOf } from './designs';
import { specOf } from './rules';
import { samplePhotoImage } from './samples';
import type { FrameSettings } from './settings';
import { photoById, printOf, type PhotoId } from './sizes';

/** The tiles show a picture 6 wide by 5 high. */
const TW = 240;
const TH = 200;

function trace(ctx: CanvasRenderingContext2D, ring: Ring, map: (p: [number, number]) => [number, number]) {
  ring.forEach((p, i) => {
    const [x, y] = map(p as [number, number]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/** Draw `image` to cover the box, cut to its middle, as a print shows it. */
function cover(ctx: CanvasRenderingContext2D, image: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const k = Math.max(w / image.width, h / image.height);
  const sw = w / k;
  const sh = h / k;
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
}

const edgeOf = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 200 ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0)';
};

/** The frame's face from the front with this outline: its colour, its window, the sample photo. */
export async function outlineTile(s: FrameSettings, outline: Outline): Promise<string> {
  const t: FrameSettings = { ...s, outline };
  const L = frameLayout({ ...specOf(t), stand: 'none' }, printOf(t));
  const recipe = outlineRecipe(L);
  const pad = 0.1 * Math.max(L.outline.x1 - L.outline.x0, L.outline.y1 - L.outline.y0);
  const k = Math.min(TW / (L.outline.x1 - L.outline.x0 + 2 * pad), TH / (L.outline.y1 - L.outline.y0 + 2 * pad));
  const cx = (L.outline.x0 + L.outline.x1) / 2;
  const cy = (L.outline.y0 + L.outline.y1) / 2;
  const map = ([x, y]: [number, number]): [number, number] => [TW / 2 + (x - cx) * k, TH / 2 - (y - cy) * k];

  const canvas = document.createElement('canvas');
  canvas.width = TW;
  canvas.height = TH;
  const ctx = canvas.getContext('2d')!;
  const image = await samplePhotoImage(designOf(s).sample).catch(() => null);
  const w = L.window;
  const win = roundedBoxR({ x0: w.cx - w.w / 2, x1: w.cx + w.w / 2, y0: w.cy - w.h / 2, y1: w.cy + w.h / 2 }, w.radii);
  const photo = () => {
    ctx.save();
    ctx.beginPath();
    trace(ctx, win, map);
    ctx.clip();
    const [x0, y0] = map([w.cx - w.w / 2, w.cy + w.h / 2]);
    if (image) cover(ctx, image, x0, y0, w.w * k, w.h * k);
    else {
      ctx.fillStyle = '#9fb7c9';
      ctx.fillRect(x0, y0, w.w * k, w.h * k);
    }
    ctx.restore();
  };

  ctx.fillStyle = s.bodyColor;
  ctx.strokeStyle = edgeOf(s.bodyColor);
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  if (recipe.band?.only) {
    // A ring and nothing else: the photo behind it, the band over it.
    photo();
    ctx.beginPath();
    trace(ctx, recipe.band.centre, map);
    ctx.lineWidth = 2 * recipe.band.half * k;
    ctx.strokeStyle = s.bodyColor;
    ctx.stroke();
    return canvas.toDataURL('image/png');
  }
  ctx.beginPath();
  for (const r of recipe.rings) trace(ctx, r, map);
  ctx.fill('nonzero');
  ctx.stroke();
  if (recipe.band) {
    // The ric-rac band is the second colour.
    ctx.beginPath();
    trace(ctx, recipe.band.centre, map);
    ctx.lineWidth = 2 * recipe.band.half * k;
    ctx.strokeStyle = s.inkColor;
    ctx.stroke();
  }
  photo();
  return canvas.toDataURL('image/png');
}

/** A border's cross-section: the face at the top, the window to the right. */
export function profileTile(profile: Profile): string {
  const shapes: Record<Profile, string> = {
    flat: 'M14 40 H106 V56 H14 Z',
    bevel: 'M14 34 H84 L106 56 H14 Z',
    deep: 'M14 18 H64 V48 L82 66 H14 Z M64 18 H72 V48 H64 Z',
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 84"><path d="${shapes[profile]}" fill="#8b93a1"/><path d="M8 72 H112" stroke="#8b93a1" stroke-width="2" stroke-dasharray="4 4" opacity="0.5"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The prints the walkthrough offers, each at its true size beside the others, with a photo in
 *  it; a dashed card for another size. */
export async function printTile(id: PhotoId | 'other', sample: string): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = TW;
  canvas.height = TH;
  const ctx = canvas.getContext('2d')!;
  // 1.15 px a millimetre fits the tallest, a 10 x 15 print, in the tile.
  const k = 1.15;
  if (id === 'other') {
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = '#8b93a1';
    ctx.lineWidth = 2;
    ctx.strokeRect(TW / 2 - 35, TH / 2 - 50, 70, 100);
    return canvas.toDataURL('image/png');
  }
  const p = photoById(id);
  const print = printOf({ photo: id, orientation: 'portrait', customWidth: 70, customHeight: 100 });
  const w = print.pw * k;
  const h = print.ph * k;
  const x = (TW - w) / 2;
  const y = (TH - h) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 6;
  ctx.fillRect(x, y, w, h);
  ctx.shadowColor = 'transparent';
  const image = await samplePhotoImage(sample).catch(() => null);
  const f = p.film;
  const pic = f ? { x: x + f.side * k, y: y + f.top * k, w: f.iw * k, h: f.ih * k } : { x, y, w, h };
  if (image) cover(ctx, image, pic.x, pic.y, pic.w, pic.h);
  return canvas.toDataURL('image/png');
}

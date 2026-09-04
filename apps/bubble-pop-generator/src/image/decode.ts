// Decode an uploaded file into high-quality resampled ImageData (main-thread canvas).
// Uses pica (Lanczos / mks2013) so thin strokes and text survive the resize, and
// requests EXIF orientation baking so phone photos import upright.
import { Pica } from 'pica';

export interface RgbaImage {
  data: Uint8ClampedArray; // RGBA
  width: number;
  height: number;
}

/*
  Downscale ceiling. There is deliberately no upscale floor.

  Small logos used to be Lanczos-upscaled to a 900px "working resolution" so the tracer
  would have enough samples to make smooth curves. It does not add information, and it
  costs a great deal: Lanczos turns a one-pixel anti-aliased edge into a ~4px ramp with
  overshoot lobes that reach PAST both of the colours either side of it. Those invented
  pixels are then quantised. Measured on the 323px bat, same artwork, only the working
  resolution changed:

      323px (native)  ->  3 colours,   6 components,   0 specks
      900px           ->  4 colours,  98 components,  81 specks
     1100px           ->  4 colours, 188 components, 159 specks

  It grows a fourth colour the drawing does not contain, and 159 specks along the outline
  where the overshoot flips labels back and forth. Every file tested got worse: samurai
  54->65 components, bird 51->88, potion 9->14. Nothing got better.

  Smoothness is the tracer's job, and its smoothing is a fraction of the artwork's size
  (see `sigmaPx` in trace.ts), so tracing at native resolution gives the same curve with
  none of the invented pixels.
*/
const TARGET = 1100;

let picaInstance: Pica | null = null;
function getPica(): Pica {
  if (!picaInstance) picaInstance = new Pica();
  return picaInstance;
}

// Bake EXIF orientation and avoid premultiply surprises. Very old engines throw on
// the options bag — fall back to a plain decode there.
async function decodeBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'default',
    });
  } catch {
    return await createImageBitmap(blob);
  }
}

export async function loadFileToImage(file: File, maxSize = TARGET): Promise<RgbaImage> {
  const bitmap = await decodeBitmap(file);
  try {
    return await drawToImageData(bitmap, bitmap.width, bitmap.height, maxSize);
  } finally {
    bitmap.close();
  }
}

// Decode an image URL (e.g. a bundled sample asset) into resampled ImageData.
export async function loadUrlToImage(url: string, maxSize = TARGET): Promise<RgbaImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load image: ${url} (${res.status})`);
  const blob = await res.blob();
  const bitmap = await decodeBitmap(blob);
  try {
    return await drawToImageData(bitmap, bitmap.width, bitmap.height, maxSize);
  } finally {
    bitmap.close();
  }
}

export async function drawToImageData(
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxSize: number,
): Promise<RgbaImage> {
  const maxSide = Math.max(srcW, srcH);
  // Resample policy: downscale big images (mks2013 = resize + light sharpen, better
  // than plain Lanczos for downscale). Anything at or under the ceiling is kept 1:1 —
  // see the note on TARGET for why upscaling is never the right move here.
  let w = srcW;
  let h = srcH;
  let filter: 'mks2013' | null = null;
  if (maxSide > maxSize) {
    const s = maxSize / maxSide;
    w = Math.max(1, Math.round(srcW * s));
    h = Math.max(1, Math.round(srcH * s));
    filter = 'mks2013';
  }

  // Draw the source to a canvas at native size (pica works canvas → canvas).
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
  sctx.clearRect(0, 0, srcW, srcH);
  sctx.drawImage(src, 0, 0);

  if (!filter || (w === srcW && h === srcH)) {
    const img = sctx.getImageData(0, 0, srcW, srcH);
    return { data: img.data, width: srcW, height: srcH };
  }

  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = w;
  dstCanvas.height = h;
  try {
    await getPica().resize(srcCanvas, dstCanvas, { filter });
    const dctx = dstCanvas.getContext('2d', { willReadFrequently: true })!;
    const img = dctx.getImageData(0, 0, w, h);
    return { data: img.data, width: w, height: h };
  } catch {
    // Fallback to the browser's built-in scaler if pica fails (workers blocked, etc.).
    const dctx = dstCanvas.getContext('2d', { willReadFrequently: true })!;
    dctx.imageSmoothingEnabled = true;
    dctx.imageSmoothingQuality = 'high';
    dctx.clearRect(0, 0, w, h);
    dctx.drawImage(srcCanvas, 0, 0, w, h);
    const img = dctx.getImageData(0, 0, w, h);
    return { data: img.data, width: w, height: h };
  }
}

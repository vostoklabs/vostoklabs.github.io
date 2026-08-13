// Decode an uploaded file into high-quality resampled ImageData (main-thread canvas).
// Uses pica (Lanczos / mks2013) so thin strokes and text survive the resize, and
// requests EXIF orientation baking so phone photos import upright.
import { Pica } from 'pica';

export interface RgbaImage {
  data: Uint8ClampedArray; // RGBA
  width: number;
  height: number;
}

// Downscale ceiling and the minimum working resolution: small logos are upscaled to
// MIN_WORKING so the tracer has enough resolution to make smooth curves.
const TARGET = 1100;
const MIN_WORKING = 900;

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
  // than plain Lanczos for downscale), upscale small ones (lanczos3), else keep 1:1.
  let w = srcW;
  let h = srcH;
  let filter: 'mks2013' | 'lanczos3' | null = null;
  if (maxSide > maxSize) {
    const s = maxSize / maxSide;
    w = Math.max(1, Math.round(srcW * s));
    h = Math.max(1, Math.round(srcH * s));
    filter = 'mks2013';
  } else if (maxSide < MIN_WORKING) {
    const s = MIN_WORKING / maxSide;
    w = Math.max(1, Math.round(srcW * s));
    h = Math.max(1, Math.round(srcH * s));
    filter = 'lanczos3';
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

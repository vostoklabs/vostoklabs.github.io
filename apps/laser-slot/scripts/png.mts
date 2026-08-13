// Minimal PNG reader, so the sample silhouettes can be traced by a node script
// instead of only inside a browser.
//
// The app decodes images with pica + createImageBitmap, both of which need a
// DOM. Everything downstream of that (matte, quantize, trace) is pure maths and
// runs anywhere — this fills the one gap, and only for the cases our own sample
// art actually uses: 8-bit, non-interlaced.

import { inflateSync } from 'node:zlib';

export interface RgbaImage {
  data: Uint8ClampedArray; // RGBA
  width: number;
  height: number;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Bytes per pixel for each PNG colour type at 8-bit depth. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodePng(buf: Buffer): RgbaImage {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('Not a PNG');
  }

  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];

  let pos = 8;
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') palette = Buffer.from(body);
    else if (type === 'tRNS') transparency = Buffer.from(body);
    else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    pos += 12 + length; // length + type + body + CRC
  }

  if (depth !== 8) throw new Error(`Unsupported bit depth ${depth} (only 8 handled)`);
  if (interlace !== 0) throw new Error('Interlaced PNGs are not handled');
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`Unsupported colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);

  // Undo the per-scanline filters. Each line is prefixed with its filter byte
  // and refers back to the pixel to its left (a) and the line above (b, c).
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const line = raw.subarray(src, src + stride);
    src += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      const v = line[x];
      switch (filter) {
        case 0: out[x] = v; break;
        case 1: out[x] = v + a; break;
        case 2: out[x] = v + b; break;
        case 3: out[x] = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          out[x] = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`Unknown filter ${filter} on row ${y}`);
      }
    }
  }

  // Expand whatever colour type it was into straight RGBA.
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, o = 0; i < width * height; i++, o += 4) {
    const s = i * channels;
    switch (colorType) {
      case 0: // greyscale
        data[o] = data[o + 1] = data[o + 2] = pixels[s];
        data[o + 3] = 255;
        break;
      case 2: // truecolour
        data[o] = pixels[s];
        data[o + 1] = pixels[s + 1];
        data[o + 2] = pixels[s + 2];
        data[o + 3] = 255;
        break;
      case 3: { // indexed
        const idx = pixels[s];
        data[o] = palette![idx * 3];
        data[o + 1] = palette![idx * 3 + 1];
        data[o + 2] = palette![idx * 3 + 2];
        data[o + 3] = transparency && idx < transparency.length ? transparency[idx] : 255;
        break;
      }
      case 4: // greyscale + alpha
        data[o] = data[o + 1] = data[o + 2] = pixels[s];
        data[o + 3] = pixels[s + 1];
        break;
      case 6: // truecolour + alpha
        data[o] = pixels[s];
        data[o + 1] = pixels[s + 1];
        data[o + 2] = pixels[s + 2];
        data[o + 3] = pixels[s + 3];
        break;
    }
  }

  return { data, width, height };
}

/** Area-average downscale. A box filter rather than nearest-neighbour because
 *  the anti-aliased edge it produces is what lets the tracer find a smooth
 *  contour instead of a staircase. */
export function downscale(img: RgbaImage, maxSide: number): RgbaImage {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (scale >= 1) return img;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * img.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * img.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / width));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const s = (sy * img.width + sx) * 4;
          r += img.data[s];
          g += img.data[s + 1];
          b += img.data[s + 2];
          a += img.data[s + 3];
          n++;
        }
      }
      const o = (y * width + x) * 4;
      data[o] = r / n;
      data[o + 1] = g / n;
      data[o + 2] = b / n;
      data[o + 3] = a / n;
    }
  }
  return { data, width, height };
}

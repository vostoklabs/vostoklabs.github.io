/*
  Image-pipeline bench: runs the clicker's real pipeline (matte -> quantize -> trace) over a
  folder of PNGs and writes one contact sheet per image — [ source | label map | traced regions ]
  — plus a metrics line: per colour, the connected-component count in the label map and in the
  traced result. A colour whose count explodes is a band or a spray of specks; a colour whose
  traced count collapses below its label count is detail being deleted.

  This is how the quantiser and tracer changes were measured (hatched strokes, thin text,
  sub-pixel outlines). Keep a folder of real uploads for it; the halloween pack designs under
  public/assets/packs/halloween/designs are a good start.

  From the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/image-bench.ts --bundle --platform=node \n      --format=esm --define:import.meta.env='{"BASE_URL":"/"}' \n      --outfile=apps/clicker-generator/.image-bench.mjs \n    && node apps/clicker-generator/.image-bench.mjs <imgdir> <outdir> [colorCount=4] [smoothing=0.1] [designMm=35]

  Env: ONLY=a,b            only files whose name contains one of these
       CROP=x,y,w,h,scale  also write <name>-zoom.png: the same crop from each panel, the third
                           rendered from the polygons at that scale (sub-pixel truth).
*/
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';

const { removeBackground, compositeOverMatte, cleanMask } = await import('../src/image/matte.ts');
const { quantize } = await import('../src/image/quantize.ts');
const { traceRegions } = await import('../src/image/trace.ts');
type RgbaImage = { data: Uint8ClampedArray; width: number; height: number };
type Ring = [number, number][];

// ---------------------------------------------------------------- PNG io (8-bit, ct 2/3/6)
function paeth(a: number, b: number, c: number) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(buf: Buffer): RgbaImage {
  let p = 8, w = 0, h = 0, bd = 0, ct = 0;
  const idat: Buffer[] = [];
  let plte: Buffer | null = null, trns: Buffer | null = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; }
    else if (type === 'PLTE') plte = Buffer.from(d);
    else if (type === 'tRNS') trns = Buffer.from(d);
    else if (type === 'IDAT') idat.push(Buffer.from(d));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8) throw new Error(`unsupported PNG depth ${bd}`);
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const cur = Buffer.alloc(h * stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++];
    const line = raw.subarray(q, q + stride); q += stride;
    const off = y * stride, prev = off - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[off + i - ch] : 0, b = y > 0 ? cur[prev + i] : 0, c = (y > 0 && i >= ch) ? cur[prev + i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) v += paeth(a, b, c);
      cur[off + i] = v & 255;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (ch === 4) { out[i * 4] = cur[i * 4]; out[i * 4 + 1] = cur[i * 4 + 1]; out[i * 4 + 2] = cur[i * 4 + 2]; out[i * 4 + 3] = cur[i * 4 + 3]; }
    else if (ch === 3) { out[i * 4] = cur[i * 3]; out[i * 4 + 1] = cur[i * 3 + 1]; out[i * 4 + 2] = cur[i * 3 + 2]; out[i * 4 + 3] = 255; }
    else if (ch === 2) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = cur[i * 2]; out[i * 4 + 3] = cur[i * 2 + 1]; }
    else if (ct === 3) { const k = cur[i]; out[i * 4] = plte![k * 3]; out[i * 4 + 1] = plte![k * 3 + 1]; out[i * 4 + 2] = plte![k * 3 + 2]; out[i * 4 + 3] = trns && k < trns.length ? trns[k] : 255; }
    else { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = cur[i]; out[i * 4 + 3] = 255; }
  }
  return { data: out, width: w, height: h };
}
function crc32(b: Buffer) { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; }
function chunk(t: string, d: Buffer) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
export function writePng(path: string, w: number, h: number, rgba: Uint8ClampedArray | Uint8Array) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// ---------------------------------------------------------------- helpers
const clone = (img: RgbaImage): RgbaImage => ({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height });

/** 4-connected components of a label field (label < 0 = none). Returns per-label size lists. */
export function components(labels: Int16Array | Int32Array, w: number, h: number): Map<number, number[]> {
  const seen = new Uint8Array(w * h);
  const per = new Map<number, number[]>();
  const st: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (seen[p] || labels[p] < 0) continue;
    const L = labels[p];
    let n = 0; st.length = 0; st.push(p); seen[p] = 1;
    while (st.length) {
      const q = st.pop()!; n++;
      const x = q % w, y = (q / w) | 0;
      const go = (r: number) => { if (!seen[r] && labels[r] === L) { seen[r] = 1; st.push(r); } };
      if (x > 0) go(q - 1); if (x < w - 1) go(q + 1); if (y > 0) go(q - w); if (y < h - 1) go(q + w);
    }
    if (!per.has(L)) per.set(L, []);
    per.get(L)!.push(n);
  }
  return per;
}

/** Scanline even-odd rasterise a set of rings (already in pixel space) into `labels` with value L. */
function fillRings(rings: Ring[], w: number, h: number, labels: Int16Array, L: number) {
  const xs: number[] = [];
  for (let y = 0; y < h; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [x0, y0] = r[j], [x1, y1] = r[i];
        if ((y0 <= sy) !== (y1 <= sy)) xs.push(x0 + (sy - y0) * (x1 - x0) / (y1 - y0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = a; x <= b; x++) labels[y * w + x] = L;
    }
  }
}

// ---------------------------------------------------------------- main
const [imgDir, outDir, ccArg, smArg, mmArg] = process.argv.slice(2);
const colorCount = +(ccArg ?? 4);
const smoothing = +(smArg ?? 0.1);
const designMm = +(mmArg ?? 35);
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;

for (const f of (imgDir ? readdirSync(imgDir) : []).filter((n) => n.endsWith('.png')).sort()) {
  if (only && !only.some((o) => f.includes(o))) continue;
  let src: RgbaImage;
  try { src = decodePng(readFileSync(join(imgDir, f))); } catch (e: any) { console.log(`${f}: skip (${e.message})`); continue; }
  const { width: W, height: H } = src;
  const t0 = Date.now();
  const img = clone(src);
  const matte = removeBackground(img); compositeOverMatte(img); cleanMask(img);
  const q = quantize(img, colorCount, undefined, matte);
  const t1 = Date.now();
  const set = traceRegions(q, smoothing, true, designMm);
  const t2 = Date.now();

  // Label map render.
  const lab = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const k = q.indices[i];
    if (k < 0) { lab[i * 4] = lab[i * 4 + 1] = lab[i * 4 + 2] = 200; lab[i * 4 + 3] = 255; continue; }
    const c = q.palette[k].rgb; lab[i * 4] = c[0]; lab[i * 4 + 1] = c[1]; lab[i * 4 + 2] = c[2]; lab[i * 4 + 3] = 255;
  }

  // Traced render: regions rasterised back into pixel space, smallest coverage first wins
  // (same carve order as buildClicker), over the outline in grey.
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (q.indices[y * W + x] >= 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const maxSide = Math.max(maxX - minX + 1, maxY - minY + 1);
  const cx = (minX + maxX + 1) / 2, cy = (minY + maxY + 1) / 2;
  const toPx = (r: Ring): Ring => r.map(([x, y]) => [x * maxSide + cx, -y * maxSide + cy]);
  const traced = new Int16Array(W * H).fill(-1);
  fillRings(set.outline.map(toPx), W, H, traced, 99);
  const order = set.regions.map((r, i) => ({ r, i })).sort((a, b) => b.r.coverage - a.r.coverage);
  for (const { r, i } of order) for (const c of r.components) fillRings(c.rings.map(toPx), W, H, traced, i);
  const tr = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const k = traced[p];
    let c: number[] = [200, 200, 200];
    if (k === 99) c = [255, 0, 255]; // outline showing through = a gap between regions
    else if (k >= 0) c = set.regions[k].quantRgb;
    tr[p * 4] = c[0]; tr[p * 4 + 1] = c[1]; tr[p * 4 + 2] = c[2]; tr[p * 4 + 3] = 255;
  }

  // Sheet.
  const SW = W * 3 + 20;
  const sheet = new Uint8ClampedArray(SW * H * 4).fill(255);
  const blit = (buf: Uint8ClampedArray, ox: number, alphaOverWhite: boolean) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4, d = (y * SW + ox + x) * 4;
      const a = alphaOverWhite ? buf[s + 3] / 255 : 1;
      sheet[d] = buf[s] * a + 255 * (1 - a); sheet[d + 1] = buf[s + 1] * a + 255 * (1 - a); sheet[d + 2] = buf[s + 2] * a + 255 * (1 - a); sheet[d + 3] = 255;
    }
  };
  blit(src.data, 0, true); blit(lab, W + 10, false); blit(tr, 2 * W + 20, false);
  const tag = `${basename(f, '.png')}-cc${colorCount}-sm${smoothing}-mm${designMm}`;
  writePng(join(outDir, `${tag}.png`), SW, H, sheet);
  if (process.env.CROP) {
    // CROP=x,y,w,h,scale : nearest-neighbour zoom of the same crop from each panel.
    const [cx0, cy0, cw, chh, sc] = process.env.CROP.split(',').map(Number);
    const ZW = (cw * 3 + 20) * sc, ZH = chh * sc;
    const zoom = new Uint8ClampedArray(ZW * ZH * 4).fill(255);
    for (let panel = 0; panel < 3; panel++) for (let y = 0; y < chh * sc; y++) for (let x = 0; x < cw * sc; x++) {
      const sx = cx0 + Math.floor(x / sc) + panel * (W + 10), sy = cy0 + Math.floor(y / sc);
      if (sy < 0 || sy >= H || sx < 0 || sx >= SW) continue;
      const s = (sy * SW + sx) * 4, d = (y * ZW + panel * (cw + 10) * sc + x) * 4;
      zoom[d] = sheet[s]; zoom[d + 1] = sheet[s + 1]; zoom[d + 2] = sheet[s + 2]; zoom[d + 3] = 255;
    }
    // Third panel: the polygons themselves rasterised AT the zoom scale, so sub-pixel
    // smoothness (or staircase) is visible rather than hidden by the native re-raster.
    const zw = cw * sc, zh = chh * sc;
    const trz = new Int16Array(zw * zh).fill(-1);
    const toZ = (r: Ring): Ring => toPx(r).map(([x, y]) => [(x - cx0) * sc, (y - cy0) * sc]);
    fillRings(set.outline.map(toZ), zw, zh, trz, 99);
    for (const { r, i } of order) for (const c of r.components) fillRings(c.rings.map(toZ), zw, zh, trz, i);
    for (let y = 0; y < zh; y++) for (let x = 0; x < zw; x++) {
      const k = trz[y * zw + x];
      const c = k === 99 ? [255, 0, 255] : k >= 0 ? set.regions[k].quantRgb : [200, 200, 200];
      const d = (y * ZW + 2 * (cw + 10) * sc + x) * 4;
      zoom[d] = c[0]; zoom[d + 1] = c[1]; zoom[d + 2] = c[2];
    }
    writePng(join(outDir, `${tag}-zoom.png`), ZW, ZH, zoom);
  }

  // Metrics.
  const labComps = components(q.indices, W, H);
  const trComps = components(traced, W, H);
  // Pixel agreement between quantised label map and the traced raster, over the foreground.
  let agree = 0, fg = 0, gap = 0;
  const palToRegion = new Map<number, number>();
  set.regions.forEach((r, i) => { const k = q.palette.findIndex((p) => p.rgb.join() === r.quantRgb.join()); palToRegion.set(k, i); });
  for (let p = 0; p < W * H; p++) {
    if (q.indices[p] < 0) continue; fg++;
    const want = palToRegion.get(q.indices[p]);
    if (traced[p] === want) agree++;
    else if (traced[p] === 99) gap++;
  }
  const verts = set.regions.reduce((s, r) => s + r.components.reduce((t, c) => t + c.rings.reduce((u, rg) => u + rg.length, 0), 0), 0);
  console.log(`\n${f}  ${W}x${H}  quant ${t1 - t0}ms  trace ${t2 - t1}ms  verts ${verts}`);
  console.log(`  agreement ${(100 * agree / fg).toFixed(2)}%  gaps ${(100 * gap / fg).toFixed(2)}%`);
  for (const [k, p] of q.palette.entries()) {
    const lc = labComps.get(k) ?? [];
    const ri = palToRegion.get(k);
    const tc = ri === undefined ? [] : (trComps.get(ri) ?? []);
    const hex = '#' + p.rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
    console.log(`  ${hex}  cov ${(p.coverage * 100).toFixed(1).padStart(5)}%  label comps ${String(lc.length).padStart(4)} (>=9px ${lc.filter((s) => s >= 9).length})  traced comps ${String(tc.length).padStart(4)}`);
  }
}

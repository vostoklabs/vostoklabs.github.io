/*
  Picture edits and the crop: parts of a picture taken out or brought back, a whole colour taken
  out, and a crop, all kept as places in the picture and applied on every trace.

  Pinned here:
   - with no edits and no crop (absent, empty, or a crop of the whole picture) the trace is what
     the tracer always made, to the bit, and so is the colour list;
   - a removed splat and a removed white counter are gone from every trace, whatever the colour
     count, smoothing and size, while the rest stays; the frame `onFrame` reports is the one the
     rings are normalised by;
   - a removal takes the same colour connected to the tap, not everything touching it, and takes
     the soft rim of a blurred, noisy shape with it;
   - bring back returns the inside of a ring the background remover took through a gap, never the
     open background, never what the file had transparent; remove then bring back is no edit;
   - a dropped colour leaves the picture and the colour list;
   - the crop is a mask after the background removal, so a crop through the art still loses the
     background and keeps the art; nothing is traced outside it; an edit outside it waits;
   - the cleaners keep only well-formed edits and boxes.

  The pictures are drawn here, the way a browser draws flat art: every pixel the mean of 4 × 4
  samples, so every edge is anti-aliased.

    pnpm --filter @vostok/trace test
*/
import { createHash } from 'node:crypto';
import type { RgbaImage } from '../src/decode';
import type { CropBox, PictureEdit, RegionSet, Ring } from '../src/types';
const trace = await import('../src/index');
const {
  processImage, discoverColours, quantize, traceRegions, stripBackground, compositeOverMatte, cleanMask, srgbToOklab,
  prepareArtwork, pictureAreaAt, cleanPictureEdits, cleanCropBox, MAX_PICTURE_EDITS,
} = trace;

type RGB = [number, number, number];
type Frame = { cx: number; cy: number; side: number; w: number; h: number };

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- drawing

interface Shape { rgb: RGB; box: [number, number, number, number]; inside: (x: number, y: number) => boolean }
const disc = (rgb: RGB, cx: number, cy: number, r: number): Shape =>
  ({ rgb, box: [cx - r, cy - r, cx + r, cy + r], inside: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r });
const ring = (rgb: RGB, cx: number, cy: number, r0: number, r1: number): Shape =>
  ({ rgb, box: [cx - r1, cy - r1, cx + r1, cy + r1], inside: (x, y) => { const d = (x - cx) ** 2 + (y - cy) ** 2; return d <= r1 * r1 && d >= r0 * r0; } });
const rect = (rgb: RGB, x0: number, y0: number, x1: number, y1: number): Shape =>
  ({ rgb, box: [x0, y0, x1, y1], inside: () => true });

function draw(width: number, height: number, bg: RGB | null, shapes: Shape[]): RgbaImage {
  const S = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
          let c = bg;
          for (let k = shapes.length - 1; k >= 0; k--) {
            const s = shapes[k];
            if (px < s.box[0] || px > s.box[2] || py < s.box[1] || py > s.box[3] || !s.inside(px, py)) continue;
            c = s.rgb;
            break;
          }
          if (c) { r += c[0]; g += c[1]; b += c[2]; hits++; }
        }
      }
      const i = (y * width + x) * 4;
      if (hits) { data[i] = Math.round(r / hits); data[i + 1] = Math.round(g / hits); data[i + 2] = Math.round(b / hits); }
      data[i + 3] = Math.round((hits / (S * S)) * 255);
    }
  }
  return { data, width, height };
}

const clone = (img: RgbaImage): RgbaImage => ({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height });
const digest = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');

const WHITE: RGB = [255, 255, 255];
const YELLOW: RGB = [250, 200, 30];
const GREY: RGB = [128, 128, 128];
const BLACK: RGB = [20, 20, 20];
const RED: RGB = [210, 30, 40];
const PINK: RGB = [246, 165, 185];

/* The picture, 600 × 420 on white: a yellow ring with a grey disc filling it, a grey splat on its
   own, a black block with a white counter inside (the background remover leaves it: nothing joins
   it to the outside), and a black ring with a 4 px gap (the remover takes the white inside it). */
const W = 600, H = 420;
const RING = { cx: 150, cy: 150, r0: 60, r1: 80 };
const SPLAT = { cx: 320, cy: 340, r: 28 };
const COUNTER = [440, 100, 490, 150] as const;
const GAPPED = { cx: 480, cy: 320, r0: 45, r1: 60 };
const scene = () => draw(W, H, WHITE, [
  ring(YELLOW, RING.cx, RING.cy, RING.r0, RING.r1),
  disc(GREY, RING.cx, RING.cy, RING.r0 + 0.5),
  disc(GREY, SPLAT.cx, SPLAT.cy, SPLAT.r),
  rect(BLACK, 400, 60, 540, 190),
  rect(WHITE, ...COUNTER),
  ring(BLACK, GAPPED.cx, GAPPED.cy, GAPPED.r0, GAPPED.r1),
  rect(WHITE, GAPPED.cx + GAPPED.r0 - 2, GAPPED.cy - 2, GAPPED.cx + GAPPED.r1 + 2, GAPPED.cy + 2),
]);
const SCENE = scene();
/** The place of a pixel, as an edit stores it. */
const at = (px: number, py: number) => ({ x: (px + 0.5) / W, y: (py + 0.5) / H });

// ---------------------------------------------------------------- reading a trace

const inRing = (r: Ring, x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
/** How many traced shapes cover pixel (px, py). */
const shapesAt = (set: RegionSet, f: Frame, px: number, py: number): number => {
  const x = (px - f.cx) / f.side, y = -(py - f.cy) / f.side;
  let n = 0;
  for (const reg of set.regions) {
    for (const c of reg.components) {
      let inside = false;
      for (const r of c.rings) if (inRing(r, x, y)) inside = !inside;
      if (inside) n++;
    }
  }
  return n;
};
const traceWith = (img: RgbaImage, colours: number, opts: Parameters<typeof processImage>[2] = {}) => {
  let frame: Frame | null = null;
  const set = processImage(clone(img), colours, { ...opts, onFrame: (f) => { frame = f; } });
  return { set, frame: frame as Frame | null };
};

// ---------------------------------------------------------------- nothing asked: nothing moves

{
  /* The tracer as it stood: the three calls, then the quantiser and the tracer, by hand. */
  const old = (img: RgbaImage, n: number, smoothing: number, designMm: number) => {
    const matte = stripBackground(img);
    compositeOverMatte(img);
    cleanMask(img);
    return traceRegions(quantize(img, n, undefined, matte), smoothing, true, designMm);
  };
  const want = digest(old(clone(SCENE), 4, 0.5, 35));
  const got = [
    digest(processImage(clone(SCENE), 4)),
    digest(processImage(clone(SCENE), 4, { edits: [] })),
    digest(processImage(clone(SCENE), 4, { edits: undefined, crop: undefined })),
    digest(processImage(clone(SCENE), 4, { crop: null })),
    digest(processImage(clone(SCENE), 4, { crop: { x: 0, y: 0, w: 1, h: 1 } })),
    digest(processImage(clone(SCENE), 4, { onFrame: () => {} })),
  ];
  check('no edits and no crop: the trace the tracer always made, to the bit',
    got.every((g) => g === want), `${want.slice(0, 16)}; absent, [], undefined, null, whole box, onFrame: ${got.map((g) => (g === want ? 'same' : g.slice(0, 8))).join(' ')}`);
  const list = digest(discoverColours(clone(SCENE)));
  const listed = [digest(discoverColours(clone(SCENE), true, { edits: [] })), digest(discoverColours(clone(SCENE), true, {}))];
  check('no edits: the colour list is what it was', listed.every((l) => l === list), list.slice(0, 16));
}

// ---------------------------------------------------------------- the frame

{
  const { set, frame } = traceWith(SCENE, 4);
  let maxX = 0, maxY = 0;
  for (const p of set.outline.flat()) { maxX = Math.max(maxX, Math.abs(p[0])); maxY = Math.max(maxY, Math.abs(p[1])); }
  check('onFrame reports the frame the rings are normalised by',
    !!frame && Math.abs(frame.w / frame.h - set.aspect) < 1e-12 && Math.max(maxX, maxY) <= 0.5 + 0.01 && Math.max(maxX, maxY) > 0.48,
    frame ? `centre ${frame.cx}, ${frame.cy}, side ${frame.side}, aspect ${(frame.w / frame.h).toFixed(4)} = ${set.aspect.toFixed(4)}; outline reaches ${Math.max(maxX, maxY).toFixed(3)}` : 'never called');
  let called = false;
  processImage(draw(40, 40, WHITE, []), 2, { onFrame: () => { called = true; } });
  check('onFrame: not called for an empty picture', !called, called ? 'called' : 'not called');
}

// ---------------------------------------------------------------- remove

const SETTINGS: [number, number, number][] = [[4, 0.1, 35], [2, 0.5, 35], [6, 0.9, 35], [3, 0.1, 80], [4, 0, 20], [8, 0.3, 50]];
{
  const edits: PictureEdit[] = [
    { op: 'remove', ...at(SPLAT.cx, SPLAT.cy) },
    { op: 'remove', ...at(465, 125) },
  ];
  const rows: string[] = [];
  let ok = true;
  for (const [n, smoothing, designMm] of SETTINGS) {
    const before = traceWith(SCENE, n, { smoothing, designMm });
    const { set, frame } = traceWith(SCENE, n, { smoothing, designMm, edits });
    if (!frame || !before.frame) { ok = false; rows.push('no frame'); continue; }
    const was = [shapesAt(before.set, before.frame, SPLAT.cx, SPLAT.cy), shapesAt(before.set, before.frame, 465, 125)];
    const splat = shapesAt(set, frame, SPLAT.cx, SPLAT.cy);
    const counter = shapesAt(set, frame, 465, 125);
    const disc = shapesAt(set, frame, RING.cx, RING.cy);
    const yellow = shapesAt(set, frame, RING.cx + 70, RING.cy);
    const block = shapesAt(set, frame, 410, 70);
    const good = was[0] > 0 && was[1] > 0 && splat === 0 && counter === 0 && disc > 0 && yellow > 0 && block > 0;
    if (!good) ok = false;
    rows.push(`${n}/${smoothing}/${designMm}: ${good ? 'ok' : `before ${was}, splat ${splat} counter ${counter} disc ${disc} ring ${yellow} block ${block}`}`);
  }
  check('a removed splat and counter are traced nowhere, across six settings; the rest stays', ok, rows.join(' | '));
}
{
  /* Same colour, connected: the grey disc goes, the yellow ring it touches stays, and so does the
     grey splat elsewhere, which is the disc's colour but not joined to it. */
  const img = clone(SCENE);
  const { base } = prepareArtwork(img, { forPicking: true });
  const area = pictureAreaAt(img, base!, RING.cx, RING.cy);
  const g = 2;
  let discMissed = 0, ringTaken = 0, splatTaken = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - RING.cx, y + 0.5 - RING.cy);
      const p = y * W + x;
      if (d < RING.r0 - 1 && !area?.mask[p]) discMissed++;
      if (d > RING.r0 + g + 1.5 && d < RING.r1 + 3 && area?.mask[p]) ringTaken++;
      if (Math.hypot(x + 0.5 - SPLAT.cx, y + 0.5 - SPLAT.cy) < SPLAT.r + 3 && area?.mask[p]) splatTaken++;
    }
  }
  check('remove takes the same colour, connected: the disc, not the ring round it or the splat',
    area?.op === 'remove' && discMissed === 0 && ringTaken === 0 && splatTaken === 0,
    `${area?.op} ${area?.count} px (disc ${Math.round(Math.PI * RING.r0 ** 2)}); disc left ${discMissed}, ring beyond the rim taken ${ringTaken}, splat taken ${splatTaken}`);
}
{
  /* A blurred, noisy splat: flooding its colour alone leaves the soft rim, which traces as a thin
     ring of its own. The removal grows over it. */
  const img = draw(W, H, WHITE, [disc(GREY, 300, 210, 60)]);
  const { data } = img;
  const blurred = new Uint8ClampedArray(data);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += data[((y + dy) * W + x + dx) * 4 + c];
        blurred[(y * W + x) * 4 + c] = s / 25;
      }
    }
  }
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let p = 0; p < W * H; p++) {
    const k = Math.round((rand() - 0.5) * 16);
    for (let c = 0; c < 3; c++) blurred[p * 4 + c] = blurred[p * 4 + c] + k;
  }
  data.set(blurred);
  const after = clone(img);
  prepareArtwork(after, { edits: [{ op: 'remove', ...at(300, 210) }] });
  let left = 0;
  for (let y = 130; y < 290; y++) for (let x = 220; x < 380; x++) if (after.data[(y * W + x) * 4 + 3] >= 128) left++;
  const kept = clone(img);
  prepareArtwork(kept, {});
  let was = 0;
  for (let y = 130; y < 290; y++) for (let x = 220; x < 380; x++) if (kept.data[(y * W + x) * 4 + 3] >= 128) was++;
  check('a blurred, noisy splat goes with its rim: nothing opaque is left round it', was > 10000 && left === 0, `${was} px before, ${left} after`);
}

// ---------------------------------------------------------------- bring back

{
  const img = clone(SCENE);
  const { base } = prepareArtwork(img, { forPicking: true });
  const inside = pictureAreaAt(img, base!, GAPPED.cx, GAPPED.cy);
  const want = Math.PI * GAPPED.r0 ** 2;
  let outside = 0;
  if (inside) for (let p = 0; p < inside.mask.length; p++) {
    if (inside.mask[p] && Math.hypot((p % W) + 0.5 - GAPPED.cx, ((p / W) | 0) + 0.5 - GAPPED.cy) > GAPPED.r1 + 3) outside++;
  }
  check('bring back: the inside of a ring with a gap, not the background it joins through',
    inside?.op === 'restore' && Math.abs(inside.count - want) <= 0.05 * want && outside === 0,
    `${inside?.op} ${inside?.count} px, the inside is ${Math.round(want)}; ${outside} px beyond the ring`);
  const open = pictureAreaAt(img, base!, 20, 400);
  const corner = pictureAreaAt(img, base!, 1, 1);
  check('bring back on the open background: nothing', open === null && corner === null, `${open?.count ?? 'null'}, corner ${corner?.count ?? 'null'}`);

  // Traced: the gapped ring's inside comes back as a white shape.
  const edits: PictureEdit[] = [{ op: 'restore', ...at(GAPPED.cx, GAPPED.cy) }];
  const before = traceWith(SCENE, 4);
  const after = traceWith(SCENE, 4, { edits });
  check('bring back: the inside of the gapped ring is traced again',
    shapesAt(before.set, before.frame!, GAPPED.cx, GAPPED.cy) === 0 && shapesAt(after.set, after.frame!, GAPPED.cx, GAPPED.cy) > 0
    && shapesAt(after.set, after.frame!, 20, 400) === 0,
    `shapes at its centre: ${shapesAt(before.set, before.frame!, GAPPED.cx, GAPPED.cy)} -> ${shapesAt(after.set, after.frame!, GAPPED.cx, GAPPED.cy)}`);
}
{
  /* A cut-out: what the file had transparent never comes back. */
  const cut = draw(300, 300, null, [ring(RED, 150, 150, 40, 90), disc(PINK, 150, 150, 25)]);
  const img = clone(cut);
  const { base } = prepareArtwork(img, { edits: [{ op: 'remove', x: 150.5 / 300, y: 85.5 / 300 }], forPicking: true });
  const hole = pictureAreaAt(img, base!, 150, 120);
  const back = pictureAreaAt(img, base!, 150, 85);
  let transparentBack = 0;
  if (back) for (let p = 0; p < back.mask.length; p++) if (back.mask[p] && base!.alpha[p] < 128) transparentBack++;
  check('bring back never returns what the file had transparent',
    hole === null && back?.op === 'restore' && back.count > 0 && transparentBack === 0,
    `tap on the file's own hole: ${hole?.count ?? 'null'}; the removed ring: ${back?.op} ${back?.count} px, ${transparentBack} of them transparent in the file`);
}
{
  const plain = digest(processImage(clone(SCENE), 4));
  const pairs: [string, number, number][] = [['splat', SPLAT.cx, SPLAT.cy], ['disc', RING.cx, RING.cy], ['counter', 465, 125]];
  const rows = pairs.map(([name, x, y]) => {
    const got = digest(processImage(clone(SCENE), 4, { edits: [{ op: 'remove', ...at(x, y) }, { op: 'restore', ...at(x, y) }] }));
    return [name, got === plain] as const;
  });
  check('remove then bring back the same place is no edit at all', rows.every((r) => r[1]), rows.map(([n, s]) => `${n} ${s ? 'same' : 'differs'}`).join(', '));
  const a = digest(processImage(clone(SCENE), 4, { edits: [{ op: 'remove', ...at(SPLAT.cx, SPLAT.cy) }, { op: 'restore', ...at(SPLAT.cx, SPLAT.cy) }] }));
  const b = digest(processImage(clone(SCENE), 4, { edits: [{ op: 'restore', ...at(SPLAT.cx, SPLAT.cy) }, { op: 'remove', ...at(SPLAT.cx, SPLAT.cy) }] }));
  const twice = digest(processImage(clone(SCENE), 4, { edits: [{ op: 'restore', ...at(SPLAT.cx, SPLAT.cy) }, { op: 'remove', ...at(SPLAT.cx, SPLAT.cy) }] }));
  check('edits apply in order, and the same edits give the same bytes', a !== b && b === twice, `remove+restore ${a.slice(0, 8)}, restore+remove ${b.slice(0, 8)}, again ${twice.slice(0, 8)}`);
}

// ---------------------------------------------------------------- a whole colour

{
  /* A heart's kind of art: a black edge, red, and two small pink cheeks. */
  const heart = draw(300, 300, WHITE, [disc(BLACK, 150, 150, 110), disc(RED, 150, 150, 100), disc(PINK, 110, 170, 11), disc(PINK, 190, 170, 11)]);
  const found = discoverColours(clone(heart));
  const lab = (c: RGB) => srgbToOklab(c);
  const apart = (a: RGB, b: RGB) => { const x = lab(a), y = lab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
  const pink = found.reduce((best, c) => (apart(c.rgb, PINK) < apart(best.rgb, PINK) ? c : best));
  const edits: PictureEdit[] = [{ op: 'dropColour', rgb: pink.rgb }];
  const after = discoverColours(clone(heart), true, { edits });
  const img = clone(heart);
  prepareArtwork(img, { edits });
  const ref = clone(heart);
  prepareArtwork(ref, {});
  let fg = 0, gone = 0, outside = 0;
  for (let p = 0; p < 300 * 300; p++) {
    if (ref.data[p * 4 + 3] < 128) continue;
    fg++;
    if (img.data[p * 4 + 3] >= 128) continue;
    gone++;
    const x = (p % 300) + 0.5, y = ((p / 300) | 0) + 0.5;
    if (Math.min(Math.hypot(x - 110, y - 170), Math.hypot(x - 190, y - 170)) > 11 + 2 + 1.5) outside++;
  }
  const share = gone / fg;
  const drawn = (2 * Math.PI * 11 * 11) / fg;
  check('a dropped colour leaves the picture and the colour list',
    after.length === found.length - 1 && after.every((c) => apart(c.rgb, PINK) > 0.1) && share >= drawn && share <= drawn * 1.5 && outside === 0,
    `listed ${found.length} -> ${after.length}; ${(share * 100).toFixed(2)} % of the picture taken (pink drawn ${(drawn * 100).toFixed(2)} %), ${outside} px past its rim`);
}

// ---------------------------------------------------------------- the crop

{
  /* Through the yellow ring: the old way (cut the pixels, then remove the background) found no
     background, or took the art for one. As a mask after the remover: the white goes, the yellow
     inside the box stays. */
  const crop: CropBox = { x: 0, y: 0, w: 0.2, h: 0.6 };
  const img = clone(SCENE);
  prepareArtwork(img, { crop });
  let white = 0, yellowKept = 0, yellowAll = 0, outside = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const opaque = img.data[p * 4 + 3] >= 128;
      const inBox = x < 0.2 * W && y < 0.6 * H;
      if (opaque && !inBox) outside++;
      const s = SCENE.data;
      const isWhite = s[p * 4] > 240 && s[p * 4 + 1] > 240 && s[p * 4 + 2] > 240;
      const d = Math.hypot(x + 0.5 - RING.cx, y + 0.5 - RING.cy);
      if (opaque && isWhite) white++;
      if (inBox && d > RING.r0 + 3 && d < RING.r1 - 3) { yellowAll++; if (opaque) yellowKept++; }
    }
  }
  check('a crop through the art: the background still goes, the art inside stays, nothing outside',
    white === 0 && yellowKept === yellowAll && yellowAll > 1000 && outside === 0,
    `${white} white px opaque, yellow ${yellowKept} of ${yellowAll}, ${outside} opaque outside the box`);
}
{
  const crop: CropBox = { x: 0.1, y: 0.15, w: 0.5, h: 0.8 };
  const x1 = (crop.x + crop.w) * W, y1 = (crop.y + crop.h) * H;
  const rows: string[] = [];
  let ok = true;
  for (const [n, smoothing, designMm] of SETTINGS) {
    const { set, frame } = traceWith(SCENE, n, { smoothing, designMm, crop });
    if (!frame) { ok = false; continue; }
    let worst = 0;
    for (const reg of set.regions) for (const c of reg.components) for (const r of c.rings) for (const [x, y] of r) {
      const px = x * frame.side + frame.cx, py = -y * frame.side + frame.cy;
      worst = Math.max(worst, crop.x * W - px, px - x1, crop.y * H - py, py - y1);
    }
    const splat = shapesAt(set, frame, SPLAT.cx, SPLAT.cy);
    const block = shapesAt(set, frame, 520, 70);
    if (worst > 1.5 || splat === 0 || block !== 0) ok = false;
    rows.push(`${n}/${smoothing}/${designMm}: ${worst.toFixed(2)} px past the box`);
  }
  check('nothing is traced outside the crop, across six settings; inside it the art stays', ok, rows.join(' | '));
}
{
  /* Bring back inside a crop stays inside it; an edit outside the crop waits, and acts again when
     the crop is widened. */
  const crop: CropBox = { x: 0, y: 0, w: 150 / W, h: 1 };
  const removeDisc: PictureEdit = { op: 'remove', ...at(RING.cx, RING.cy) };
  const img = clone(SCENE);
  const { base } = prepareArtwork(img, { edits: [removeDisc], forPicking: true });
  const back = pictureAreaAt(img, base!, 120, 150, crop);
  let past = 0;
  if (back) for (let p = 0; p < back.mask.length; p++) if (back.mask[p] && p % W >= 150) past++;
  const outsideTap = pictureAreaAt(img, base!, 200, 150, crop);
  check('bring back inside a crop returns nothing outside it; a tap outside it does nothing',
    back?.op === 'restore' && back.count > 1000 && past === 0 && outsideTap === null, `${back?.op} ${back?.count} px, ${past} past the box; outside: ${outsideTap?.count ?? 'null'}`);

  const splatGone: PictureEdit = { op: 'remove', ...at(SPLAT.cx, SPLAT.cy) };
  const narrow: CropBox = { x: 0, y: 0, w: 0.5, h: 1 };
  const waiting = clone(SCENE);
  prepareArtwork(waiting, { edits: [splatGone], crop: narrow, forPicking: true });
  const widened = clone(SCENE);
  prepareArtwork(widened, { edits: [splatGone], forPicking: true });
  const a = (img: RgbaImage) => img.data[(SPLAT.cy * W + SPLAT.cx) * 4 + 3];
  check('an edit outside the crop waits, and acts when the crop is widened', a(waiting) === 255 && a(widened) === 0,
    `the splat's alpha with the crop ${a(waiting)}, widened ${a(widened)}`);
}

// ---------------------------------------------------------------- the cleaners

{
  const got = cleanPictureEdits([
    null, 3, 'x', {}, { op: 'bogus', x: 0.5, y: 0.5 },
    { op: 'remove', x: Number.NaN, y: 0.5 },
    { op: 'remove', x: 2, y: -1 },
    { op: 'remove', x: 1.5, y: 0.5 },
    { op: 'remove', x: 1, y: 0 },
    { op: 'restore', x: 0.1234567, y: 0.5 },
    { op: 'dropColour', rgb: [300, -5, 12.6] },
    { op: 'dropColour', rgb: [1, 2] },
    { op: 'dropColour', rgb: [1, 2, Infinity] },
  ]);
  const want = [{ op: 'remove', x: 1, y: 0 }, { op: 'restore', x: 0.12346, y: 0.5 }, { op: 'dropColour', rgb: [255, 0, 13] }];
  const many = cleanPictureEdits(Array.from({ length: 250 }, (_, i) => ({ op: 'remove', x: i / 250, y: 0.5 })));
  check('cleanPictureEdits keeps well-formed edits, a place outside the picture dropped, at most ' + MAX_PICTURE_EDITS,
    JSON.stringify(got) === JSON.stringify(want) && many.length === MAX_PICTURE_EDITS && cleanPictureEdits('junk').length === 0 && cleanPictureEdits(undefined).length === 0,
    `${JSON.stringify(got)}; 250 -> ${many.length}`);
}
{
  const cases: [unknown, CropBox | null][] = [
    [null, null], ['box', null], [{ x: 0.1, y: 0.1, w: 0.5 }, null], [{ x: 0.1, y: Number.NaN, w: 0.5, h: 0.5 }, null],
    [{ x: 0, y: 0, w: 1, h: 1 }, null], [{ x: 0.002, y: 0, w: 0.997, h: 1 }, null],
    [{ x: 0.5, y: 0.5, w: 0.01, h: 0.3 }, null],
    [{ x: -0.1, y: 0.2, w: 0.5, h: 2 }, { x: 0, y: 0.2, w: 0.4, h: 0.8 }],
    [{ x: 0.123456, y: 0.25, w: 0.5, h: 0.5 }, { x: 0.12346, y: 0.25, w: 0.5, h: 0.5 }],
  ];
  const bad = cases.filter(([raw, want]) => JSON.stringify(cleanCropBox(raw)) !== JSON.stringify(want));
  check('cleanCropBox: junk, a sliver and the whole picture are no crop; the rest is clamped', bad.length === 0,
    bad.length ? bad.map(([raw]) => `${JSON.stringify(raw)} -> ${JSON.stringify(cleanCropBox(raw))}`).join('; ') : `${cases.length} cases`);
}

console.log(failures ? `\n${failures} FAILED` : '\nedits and the crop act where they should, and nothing else moved');
process.exit(failures ? 1 : 0);

/*
  The colour finder: `findColours` lists every colour a picture is drawn in, and
  `defaultFilaments` says how many filaments it opens with.

  Pinned here:
   - flat art lists each of its colours, also when two are close (pastels 0.067 apart) and when
     one is small (a cat's green eyes, 2.9 % of it, which `discoverColours` never lists);
   - the soft edges and noise of a JPEG add no colour; black and white are two colours; two
     blacks no eye can tell apart are one; a photograph-like gradient lists at most twelve,
     biggest first, with shares that add up;
   - the picture's edits and crop are applied first, so a colour taken out or cropped away is
     not listed, and the picture passed in is not changed;
   - detail: 0 is the list a picture opens with (its readings are pinned below); art with a
     shaded edge lists more colours at a higher detail, each at least 0.5 % of it; truly flat art
     lists none more at any detail; every list holds the lists of the details below it; past the
     last detail nothing changes;
   - flat art up to five colours opens with each its own filament, more opens at four;
   - `closestPairMapping` nests: each group at n + 1 colours sits inside one group at n.

  The pictures are drawn here, the way a browser draws flat art: every pixel the mean of 4 × 4
  samples, so every edge is anti-aliased.

    pnpm --filter @vostok/trace test
*/
import { createHash } from 'node:crypto';
import type { RgbaImage } from '../src/decode';
const trace = await import('../src/index');
const { findColours, discoverColours, defaultFilaments, closestPairMapping, srgbToOklab, DETAIL_MAX, LIST_MAX } = trace;

type RGB = [number, number, number];
type Cand = { rgb: RGB; coverage: number };

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- drawing

/** The colour at a point of the drawing, or null outside it. */
type Paint = (x: number, y: number) => RGB | null;

/** The drawing, 4 × 4 samples a pixel. On `bg` (flattened) or on transparency (bg null). */
function draw(W: number, H: number, bg: RGB | null, paint: Paint): RgbaImage {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const c = paint(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4);
          if (c) { r += c[0]; g += c[1]; b += c[2]; hits++; }
          else if (bg) { r += bg[0]; g += bg[1]; b += bg[2]; }
        }
      }
      const p = (y * W + x) * 4;
      if (bg) { data[p] = r / 16; data[p + 1] = g / 16; data[p + 2] = b / 16; data[p + 3] = 255; }
      else if (hits) { data[p] = r / hits; data[p + 1] = g / hits; data[p + 2] = b / hits; data[p + 3] = Math.round((hits / 16) * 255); }
    }
  }
  return { data, width: W, height: H };
}

const inCircle = (cx: number, cy: number, r: number, x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
/** A disc of four quarters, one colour each. */
const quarters = (cols: RGB[]): Paint => (x, y) =>
  inCircle(120, 120, 100, x, y) ? cols[x < 120 ? (y < 120 ? 0 : 1) : (y < 120 ? 2 : 3)] : null;
const PASTEL: RGB[] = [[255, 205, 210], [255, 236, 190], [190, 225, 250], [250, 250, 245]];
/** An orange cat's face: brown chin, pink nose, two small green eyes (2.9 % of it). */
const CAT: RGB[] = [[240, 140, 40], [140, 80, 40], [245, 150, 160], [40, 160, 60]];
const cat: Paint = (x, y) => {
  if (!inCircle(120, 120, 100, x, y)) return null;
  if (inCircle(90, 100, 12, x, y) || inCircle(150, 100, 12, x, y)) return CAT[3];
  if (inCircle(120, 150, 14, x, y)) return CAT[2];
  return y > 170 ? CAT[1] : CAT[0];
};
/** Flat colours with a shaded edge: each disc darkens smoothly to four fifths over its outer
 *  30 %, the way a sticker with a soft drop of shading is drawn. */
const SHADED: { c: RGB; cx: number; cy: number; r: number }[] = [
  { c: [220, 40, 40], cx: 80, cy: 80, r: 65 },
  { c: [40, 120, 220], cx: 200, cy: 80, r: 65 },
  { c: [250, 200, 30], cx: 140, cy: 190, r: 65 },
];
const shaded: Paint = (x, y) => {
  for (const s of SHADED) {
    const d = Math.hypot(x - s.cx, y - s.cy) / s.r;
    if (d > 1) continue;
    const t = d < 0.7 ? 0 : (d - 0.7) / 0.3; // 0 in the flat middle, 1 at the rim
    const k = 1 - 0.2 * t;
    return [s.c[0] * k, s.c[1] * k, s.c[2] * k];
  }
  return null;
};

/** A seeded noise of ±`level` on every channel, then a one-pixel blur: what a JPEG does. */
function jpegLike(img: RgbaImage, level: number): RgbaImage {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const { width: W, height: H } = img;
  const noisy = new Uint8ClampedArray(img.data);
  for (let p = 0; p < W * H; p++) for (let k = 0; k < 3; k++) noisy[p * 4 + k] += Math.round((rnd() * 2 - 1) * level);
  const out = new Uint8ClampedArray(noisy);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      for (let k = 0; k < 4; k++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += noisy[((y + dy) * W + x + dx) * 4 + k];
        out[(y * W + x) * 4 + k] = s / 9;
      }
    }
  }
  return { data: out, width: W, height: H };
}

// ---------------------------------------------------------------- reading

const lab = (c: RGB) => srgbToOklab(c);
const dist = (a: RGB, b: RGB) => { const x = lab(a), y = lab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
/** For each true colour, how far the nearest listed colour is. */
const misses = (found: Cand[], truth: RGB[]) => truth.map((t) => Math.min(...found.map((f) => dist(f.rgb, t))));
const show = (c: Cand[]) => c.map((x) => `${x.rgb.join(',')} ${(x.coverage * 100).toFixed(1)}%`).join(' | ');
const digest = (c: Cand[]) => createHash('sha256').update(JSON.stringify(c.map((x) => [x.rgb, Math.round(x.coverage * 1e6)]))).digest('hex').slice(0, 16);
const holds = (big: Cand[], small: Cand[]) => small.every((s) => big.some((b) => b.rgb.join() === s.rgb.join()));
const copy = (img: RgbaImage): RgbaImage => ({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height });

// ---------------------------------------------------------------- flat art

{
  for (const [where, bg] of [['on transparency', null], ['on white', [255, 255, 255]]] as const) {
    const pastel = findColours(draw(240, 240, bg as RGB | null, quarters(PASTEL)), true);
    const m = misses(pastel, bg ? PASTEL.slice(0, 3) : PASTEL);
    // On white, the white quarter is background: the remover takes it, by design.
    const want = bg ? 3 : 4;
    check(`pastels 0.067 apart, ${where}: each found`, pastel.length === want && Math.max(...m) < 0.03,
      `${pastel.length} found (want ${want}), worst ${Math.max(...m).toFixed(3)}: ${show(pastel)}`);
  }

  const catImg = draw(240, 240, null, cat);
  const found = findColours(copy(catImg));
  const m = misses(found, CAT);
  check('a cat with small green eyes: all four colours, eyes included', found.length === 4 && Math.max(...m) < 0.03,
    `${show(found)}; worst ${Math.max(...m).toFixed(3)}`);
  const old = discoverColours(copy(catImg));
  const oldEyes = Math.min(...old.map((c) => dist(c.rgb, CAT[3])));
  check('…which discoverColours misses (why this finder exists)', oldEyes > 0.12,
    `discoverColours: ${show(old)}; nearest to green ${oldEyes.toFixed(3)}`);

  const noisy = findColours(jpegLike(catImg, 6));
  const nm = misses(noisy, CAT);
  const blend = noisy.filter((c) => Math.min(...CAT.map((t) => dist(c.rgb, t))) > 0.06);
  check('the same cat through noise and a blur: same colours, no blend listed', noisy.length === 4 && blend.length === 0 && Math.max(...nm) < 0.05,
    `${show(noisy)}`);

  const bw = findColours(draw(240, 240, [255, 255, 255], (x, y) =>
    inCircle(120, 120, 100, x, y) ? (inCircle(120, 120, 80, x, y) ? [255, 255, 255] : [0, 0, 0]) : null), false);
  check('black and white: exactly two', bw.length === 2, show(bw));
  const blacks = findColours(draw(240, 240, null, (x, y) =>
    inCircle(120, 120, 100, x, y) ? (x < 120 ? [0, 0, 0] : [10, 8, 2]) : null));
  check('two blacks no eye tells apart: one', blacks.length === 1, show(blacks));

  const grad = findColours(draw(300, 200, null, (x, y) => [x * 0.85, y * 1.2, 255 - x * 0.6]));
  const sum = grad.reduce((s, c) => s + c.coverage, 0);
  const sorted = grad.every((c, i) => i === 0 || grad[i - 1].coverage >= c.coverage);
  check('a gradient: at most twelve, biggest first, shares add up', grad.length <= LIST_MAX && grad.length >= 6 && sorted && sum > 0.95 && sum <= 1.0001,
    `${grad.length} colours, shares add to ${sum.toFixed(3)}`);
}

// ---------------------------------------------------------------- the picture's edits and crop

{
  const catImg = draw(240, 240, null, cat);
  const before = createHash('sha256').update(catImg.data).digest('hex');
  findColours(catImg, true, {}, 2);
  check('the picture passed in is not changed', createHash('sha256').update(catImg.data).digest('hex') === before, before.slice(0, 16));

  const dropped = findColours(catImg, true, { edits: [{ op: 'dropColour', rgb: CAT[2] }] });
  check('a dropped colour is not listed', dropped.length === 3 && Math.min(...dropped.map((c) => dist(c.rgb, CAT[2]))) > 0.12, show(dropped));
  // The chin (y > 170 of 240) is cropped away.
  const cropped = findColours(catImg, true, { crop: { x: 0, y: 0, w: 1, h: 0.66 } });
  check('a colour cropped away is not listed', cropped.length === 3 && Math.min(...cropped.map((c) => dist(c.rgb, CAT[1]))) > 0.12, show(cropped));
}

// ---------------------------------------------------------------- detail

{
  const catImg = draw(240, 240, null, cat);
  const pastelImg = draw(240, 240, null, quarters(PASTEL));
  const shadedImg = draw(280, 260, null, shaded);
  const shadedJpeg = jpegLike(draw(280, 260, [255, 255, 255], shaded), 6);
  const gradImg = draw(300, 200, null, (x, y) => [x * 0.85, y * 1.2, 255 - x * 0.6]);

  // Detail 0 is the list a picture opens with. Pinned: a change to the finer steps must never
  // move these.
  const PINS: [string, RgbaImage, string][] = [
    ['cat', catImg, '7176bc35bb9aba7b'],
    ['pastels', pastelImg, 'a11809783a5e44c8'],
    ['shaded', shadedImg, '95ec2f835935daa1'],
    ['gradient', gradImg, '5c7ab1fa377a1f25'],
  ];
  for (const [name, img, pin] of PINS) {
    const d0 = findColours(img, true, {}, 0);
    const same = digest(findColours(img)) === digest(d0) && digest(findColours(img, true, {}, -1)) === digest(d0)
      && digest(findColours(img, true, {}, Number.NaN)) === digest(d0);
    check(`detail 0 is the default, ${name}`, same && digest(d0) === pin, `${digest(d0)} (pin ${pin}): ${d0.length} colours`);
  }

  const counts = (img: RgbaImage) => Array.from({ length: DETAIL_MAX + 2 }, (_, d) => findColours(img, true, {}, d));
  for (const [name, img] of [['shaded edges', shadedImg], ['shaded edges, JPEG-like on white', shadedJpeg]] as const) {
    const lists = counts(img);
    const n = lists.map((l) => l.length);
    const added = lists[DETAIL_MAX].filter((c) => !lists[0].some((b) => b.rgb.join() === c.rgb.join()));
    check(`${name}: more colours at a higher detail, each at least 0.5 %`,
      n[DETAIL_MAX] > n[0] && added.every((c) => c.coverage >= 0.005),
      `colours at detail 0..${DETAIL_MAX + 1}: ${n.join(', ')}; added: ${show(added)}`);
  }

  for (const [name, img] of [['the cat', catImg], ['the pastels', pastelImg], ['the cat through noise', jpegLike(catImg, 6)]] as const) {
    const n = counts(img).map((l) => l.length);
    check(`truly flat art, ${name}: no colour more at any detail`, n.every((x) => x === n[0]), `colours at detail 0..${DETAIL_MAX + 1}: ${n.join(', ')}`);
  }

  for (const [name, img] of [['shaded', shadedImg], ['shaded JPEG', shadedJpeg], ['gradient', gradImg], ['cat', catImg]] as const) {
    const lists = counts(img);
    let nested = true;
    for (let d = 1; d < lists.length; d++) if (!holds(lists[d], lists[d - 1])) nested = false;
    const last = digest(lists[DETAIL_MAX]) === digest(lists[DETAIL_MAX + 1]);
    const sums = lists.every((l) => Math.abs(l.reduce((s, c) => s + c.coverage, 0) - 1) < 0.05 && l.length <= LIST_MAX);
    check(`${name}: every detail holds the one below; past the last nothing changes`, nested && last && sums,
      `colours ${lists.map((l) => l.length).join(', ')}`);
  }
}

// ---------------------------------------------------------------- filaments

{
  const list = (k: number): Cand[] => Array.from({ length: k }, (_, i) => ({ rgb: [i * 20, 0, 0] as RGB, coverage: 1 / (k || 1) }));
  const got = [0, 1, 2, 3, 4, 5, 6, 12].map((k) => defaultFilaments(list(k)));
  check('defaultFilaments: flat art up to five each its own, more opens at four', got.join() === '1,1,2,3,4,5,4,4', got.join(','));

  const grad = findColours(draw(300, 200, null, (x, y) => [x * 0.85, y * 1.2, 255 - x * 0.6]));
  let nests = true;
  for (let n = 1; n < grad.length; n++) {
    const coarse = closestPairMapping(grad, n), fine = closestPairMapping(grad, n + 1);
    // Every fine group's members share one coarse group.
    const byFine = new Map<number, Set<number>>();
    fine.forEach((g, i) => { if (!byFine.has(g)) byFine.set(g, new Set()); byFine.get(g)!.add(coarse[i]); });
    if ([...byFine.values()].some((s) => s.size !== 1)) nests = false;
  }
  check('closestPairMapping nests: one more filament splits one group in two', nests, `${grad.length} colours, 1..${grad.length}`);
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall colour-finder checks pass');

/*
  Flat artwork has to quantise into the colours it is actually made of.

  The bug this pins down, in Ian's words: "the images are very simple, but they are not clear
  enough… do you think you can do it so all black lines are black lines and all white are
  white". What he was looking at was a white ghost speckled edge to edge with blue, a red fringe
  running the length of every black outline, and green and pink hairlines round the eye holes.

  None of those colours are in the drawings. They came from the quantiser modelling every
  foreground pixel as a COLOUR, when an anti-aliased pixel is not a colour — it is a mixture of
  the two either side of an edge, and there is a band of them along every contour. Ask a
  black-on-white line drawing for four colours and two of the four get fitted to the grey ramp;
  each then becomes a filament, and a one-pixel band that tracks every contour traces into
  thousands of slivers.

  The two things asserted here are the two things that were wrong:

   1. **A cluster count is a colour count.** A drawing with two colours must come back with two
      regions however many were asked for. k-means will always return K clusters if it is
      allowed to, and the ghost's white was being split across two filaments that differ by one
      step out of 255 — which prints as a flat area speckled with the other colour.

   2. **A region is a shape, not a spray.** Component counts are the measurement that separates
      a colour from a band: a real region has a handful of components, a band has hundreds of
      slivers. This is the number that moved from 16,013 to 509 on the ghost.

  And one thing that must NOT change: a photograph has no flat interior to model, so the
  interior fit has to stand down and leave it exactly as it was.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/quantize.test.ts \
      --bundle --platform=node --format=esm --define:import.meta.env='{"BASE_URL":"/"}' \
      --outfile=apps/clicker-generator/.quantize-test.mjs \
      && node apps/clicker-generator/.quantize-test.mjs
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const { quantize } = await import('../src/image/quantize.ts');
const { processImage } = await import('../src/image/pipeline.ts');
const { srgbToOklab } = await import('../src/image/colorspace.ts');
const { FILAMENTS } = await import('../src/types.ts');
type RgbaImage = import('../src/image/decode.ts').RgbaImage;

/* The browser decodes PNGs with `createImageBitmap`, which node does not have. These files are
   8-bit RGBA (the artwork) or 8-bit indexed (the bundled samples), both of which are a zlib
   inflate and an unfilter away — far less trouble than a dependency. */
function decodePng(buf: Buffer): RgbaImage {
  let p = 8;
  let w = 0, h = 0, bd = 0, ct = 0;
  const idat: Buffer[] = [];
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8 || (ct !== 6 && ct !== 3)) throw new Error(`unsupported PNG: depth ${bd}, type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : 1;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[o++];
    const line = raw.subarray(o, o + stride);
    o += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  if (ct === 6) return { data: new Uint8ClampedArray(out), width: w, height: h };
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const idx = out[i];
    rgba[i * 4] = plte ? plte[idx * 3] : 0;
    rgba[i * 4 + 1] = plte ? plte[idx * 3 + 1] : 0;
    rgba[i * 4 + 2] = plte ? plte[idx * 3 + 2] : 0;
    rgba[i * 4 + 3] = trns && idx < trns.length ? trns[idx] : 255;
  }
  return { data: rgba, width: w, height: h };
}

const appDir = join(process.cwd(), 'apps/clicker-generator');
const design = (f: string) => decodePng(readFileSync(join(appDir, 'public/assets/packs/halloween/designs', f)));
const sample = (f: string) => decodePng(readFileSync(join(appDir, 'public/assets/media/images', f)));
const clone = (img: RgbaImage): RgbaImage =>
  ({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height });

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

/** The worst component count over a traced region set. A band shows up here and nowhere else. */
function worstComponents(set: { regions: { components: unknown[] }[] }): number {
  return Math.max(0, ...set.regions.map((r) => r.components.length));
}

// ---------------------------------------------------------------- the artwork

/* Every one of these is flat cartoon art with a heavy outline. Four colours asked for; what
   comes back has to be the colours that are in the drawing, in one piece each.

   The bound is 30 components. It is loose on purpose — the cobweb genuinely has 24 separate
   white cells and the pumpkins have several eye and mouth holes — but it is two orders of
   magnitude under what a blend band produces, so nothing in between is ambiguous. */
const ARTWORK = [
  'ghost.png', 'ghost-boo.png', 'skull.png', 'web.png', 'bat.png',
  'potion.png', 'coffin.png', 'cauldron.png', 'witch-hat.png', 'candy-corn.png',
  'pumpkin-classic.png', 'pumpkin-angry.png', 'pumpkin-happy.png',
  'pumpkin-surprised.png', 'pumpkin-wicked.png',
];

for (const f of ARTWORK) {
  const set = processImage(clone(design(f)), 4, { removeBg: true });
  const worst = worstComponents(set);
  check(
    `${f}: no region is a spray of slivers`,
    worst <= 30,
    `${set.regions.length} region(s), worst has ${worst} components`,
  );
}

/* The ghost is the case that named the bug: a white body, a black outline, and nothing else.
   Asked for four colours it used to return four, two of them whites one step apart — which is
   what put blue speckle across the body. Two colours is the only right answer here. */
{
  const set = processImage(clone(design('ghost.png')), 4, { removeBg: true });
  check(
    'ghost: a two-colour drawing comes back as two colours, not four',
    set.regions.length === 2,
    `${set.regions.length} region(s): ${set.regions.map((r) => r.quantRgb.join(',')).join(' | ')}`,
  );
}

/* The invariant behind that: no two entries in a returned palette may be colours a person
   could not tell apart. Two filaments of the same colour is never a useful answer, and it is
   exactly what produces speckle rather than a region. */
for (const f of ARTWORK) {
  const q = quantize(clone(design(f)), 4);
  const lab = q.palette.map((p) => srgbToOklab(p.rgb));
  let closest = Infinity;
  let pair = '';
  for (let i = 0; i < lab.length; i++) {
    for (let j = 0; j < i; j++) {
      const d = Math.hypot(lab[i][0] - lab[j][0], lab[i][1] - lab[j][1], lab[i][2] - lab[j][2]);
      if (d < closest) {
        closest = d;
        pair = `${q.palette[i].rgb.join(',')} vs ${q.palette[j].rgb.join(',')}`;
      }
    }
  }
  check(
    `${f}: no two filaments are the same colour`,
    q.palette.length < 2 || closest > 0.04,
    q.palette.length < 2 ? 'single colour' : `closest pair ${closest.toFixed(3)} apart (${pair})`,
  );
}

// ---------------------------------------------------------------- the bundled samples

/* The app's own samples, as a regression guard. Fitting the palette to flat interiors changes
   the answer for every image, not just the ones that reported the bug, so these have to keep
   producing sensible artwork rather than collapsing to one colour. */
for (const f of ['dog.png', 'cheese.png', 'heart.png', 'paw.png', 'radiation.png', 'Vostok Labs logo.png']) {
  const set = processImage(clone(sample(f)), 6, { removeBg: true });
  const worst = worstComponents(set);
  check(
    `${f}: still separates into usable regions`,
    set.regions.length >= 2 && worst <= 30,
    `${set.regions.length} region(s), worst has ${worst} components`,
  );
}

// ---------------------------------------------------------------- the chosen palette

/*
  The limited-colour mode, which is where an invented hue comes from.

  Automatic mode cannot produce a colour the drawing does not contain — a cluster centre is a
  mean of pixels that exist. A FIXED list can: it maps every pixel to its nearest entry, and
  Oklab is unkind to the extremes. Black sits at L=0 and white at L=1, so a mid-grey edge pixel
  is 0.4 to 0.6 from both of the colours it is made of, while any mid-lightness filament is
  within about 0.2 on lightness alone. Measured against this app's own filament table for a 50%
  grey: Green 0.17, Pink 0.18, Orange 0.20, Red 0.22 — against White 0.40 and Black 0.60.

  So the assertion is that the drawing's edges do not put meaningful area onto a filament that
  is nowhere near a colour the drawing actually has.
*/
{
  const filaments = (FILAMENTS as [string, string][]).map(([, hex]) => [
    parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
  ] as [number, number, number]);

  for (const f of ['ghost.png', 'skull.png', 'web.png', 'pumpkin-classic.png']) {
    const img = design(f);
    // Colours the drawing genuinely contains: any exact value holding 0.5% of it or more.
    const counts = new Map<number, number>();
    let opaque = 0;
    for (let i = 0; i < img.width * img.height; i++) {
      if (img.data[i * 4 + 3] < 128) continue;
      opaque++;
      const key = (img.data[i * 4] << 16) | (img.data[i * 4 + 1] << 8) | img.data[i * 4 + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const real = [...counts.entries()]
      .filter(([, c]) => c / opaque >= 0.005)
      .map(([k]) => srgbToOklab([(k >> 16) & 255, (k >> 8) & 255, k & 255]));

    const q = quantize(clone(img), 4, filaments);
    let invented = 0;
    const names: string[] = [];
    for (const entry of q.palette) {
      const lab = srgbToOklab(entry.rgb);
      let best = Infinity;
      for (const r of real) {
        best = Math.min(best, Math.hypot(lab[0] - r[0], lab[1] - r[1], lab[2] - r[2]));
      }
      // 0.15 is far past "indistinguishable" (0.04) and past any plausible substitution.
      if (best > 0.15) { invented += entry.coverage; names.push(entry.rgb.join(',')); }
    }
    /* 2% and not 0%, because the yardstick is imperfect in a known direction: "a colour the
       drawing has" is measured from EXACT pixel values holding 0.5% or more, so a small
       gradient-shaded feature has no single value that qualifies and reads as invented when it
       is not. The pumpkin's green stalk is exactly that, and it is the 1.5% below. The bound
       sits above that and far below the 5.5% the same drawing scored before the fix. */
    check(
      `${f}: a chosen palette does not invent a colour the drawing has not got`,
      invented < 0.02,
      `${(invented * 100).toFixed(2)}% on ${names.length ? names.join(' | ') : 'nothing'}`,
    );
  }
}

// ---------------------------------------------------------------- photographs

/*
  The guard that keeps this from being a worse bug than the one it fixes.

  Fitting to flat interiors is right for a drawing and wrong for a photograph, which has no
  flat interior — the palette would come from whatever happened to be smooth, a patch of sky or
  a blurred background. So below a quarter flat, the quantiser has to fall back to modelling
  everything, exactly as it did before.

  Synthetic on purpose: a checked-in photograph would be a megabyte of asset to assert one
  boolean, and noise is the property that matters, not the subject.
*/
{
  const W = 160;
  const noisy: RgbaImage = { data: new Uint8ClampedArray(W * W * 4), width: W, height: W };
  // A deterministic pseudo-random field: every pixel differs sharply from its neighbours, so
  // essentially all of it reads as edge.
  let seed = 12345;
  for (let i = 0; i < W * W; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    noisy.data[i * 4] = seed % 256;
    noisy.data[i * 4 + 1] = (seed >> 8) % 256;
    noisy.data[i * 4 + 2] = (seed >> 16) % 256;
    noisy.data[i * 4 + 3] = 255;
  }
  const q = quantize(clone(noisy), 6);
  check(
    'a noisy image still gets the full palette it asked for',
    q.palette.length === 6,
    `${q.palette.length} of 6 colours`,
  );
}

{
  // A smooth gradient is the opposite case and must also survive: its local steps are tiny, so
  // almost none of it reads as an edge and the fit sees the whole image, as before.
  const W = 160;
  const ramp: RgbaImage = { data: new Uint8ClampedArray(W * W * 4), width: W, height: W };
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      ramp.data[i * 4] = Math.round((x / (W - 1)) * 255);
      ramp.data[i * 4 + 1] = Math.round((y / (W - 1)) * 255);
      ramp.data[i * 4 + 2] = 128;
      ramp.data[i * 4 + 3] = 255;
    }
  }
  const q = quantize(clone(ramp), 6);
  check(
    'a smooth gradient still gets the full palette it asked for',
    q.palette.length === 6,
    `${q.palette.length} of 6 colours`,
  );
}

// ---------------------------------------------------------------- thin strokes

/*
  A stroke thinner than three pixels has no flat interior, so every pixel of it is an edge
  pixel. The rule that an edge pixel may only take a colour its settled neighbours already have
  therefore painted every such stroke with the colour of the field it sat in: a hatched samurai
  logo lost its entire hatching, and a logo's thin tagline vanished from the label map. Pure
  black next to white has to stay black, however thin.

  Synthetic: two-pixel black lines with a one-pixel grey anti-aliased edge each side, on an
  opaque white matte that background removal strips.
*/
{
  const W = 240;
  const art: RgbaImage = { data: new Uint8ClampedArray(W * W * 4).fill(255), width: W, height: W };
  const put = (x: number, y: number, v: number) => { const i = (y * W + x) * 4; art.data[i] = art.data[i + 1] = art.data[i + 2] = v; };
  // A solid frame so the strokes are inside artwork rather than floating in the matte.
  for (let y = 40; y < 200; y++) for (let x = 40; x < 200; x++) if (x < 46 || x >= 194 || y < 46 || y >= 194) put(x, y, 0);
  let inkPixels = 0;
  let lines = 0;
  for (let x = 60; x < 180; x += 7) {
    lines++;
    for (let y = 60; y < 180; y++) { put(x, y, 150); put(x + 1, y, 0); put(x + 2, y, 0); put(x + 3, y, 150); inkPixels += 2; }
  }
  const q = quantize(clone(art), 4);
  // Black is whichever palette entry is darkest.
  const black = q.palette.reduce((b, p, k) => (p.rgb[0] + p.rgb[1] + p.rgb[2] < q.palette[b].rgb[0] + q.palette[b].rgb[1] + q.palette[b].rgb[2] ? k : b), 0);
  let kept = 0;
  for (let x = 60; x < 180; x += 7) for (let y = 60; y < 180; y++) { if (q.indices[y * W + x + 1] === black) kept++; if (q.indices[y * W + x + 2] === black) kept++; }
  check(
    'two-pixel strokes keep their colour',
    kept >= inkPixels * 0.98,
    `${kept} of ${inkPixels} stroke pixels labelled black across ${lines} lines`,
  );
  const set = processImage(clone(art), 4, { removeBg: true });
  const blackRegion = set.regions.find((r) => r.quantRgb[0] + r.quantRgb[1] + r.quantRgb[2] < 100);
  check(
    'two-pixel strokes trace as one shape each',
    !!blackRegion && blackRegion.components.length >= lines && blackRegion.components.length <= lines + 2,
    blackRegion ? `${blackRegion.components.length} black components for ${lines} lines + frame` : 'no black region',
  );
}

// ---------------------------------------------------------------- sub-pixel outlines

/*
  A contour traced from a hard 0/1 mask sits on a one-pixel staircase, because marching squares
  can only cut a cell at its midpoint. The tracer now contours a SOFT field — the quantiser's
  per-pixel membership, and the cut-out's own alpha on the rim — so the boundary interpolates
  to where the edge really is. On a pumpkin-shaped cut-out that was the difference between a
  bumpy stem and a clean one.

  Synthetic: an anti-aliased disc (alpha = pixel coverage, 4×4 supersampled) on transparency.
  The traced outline's radius has to be right to a quarter pixel with almost no wobble; a
  staircase wobbles by half a pixel.
*/
{
  const W = 200;
  const R = 60;
  const C = 100; // centre, in continuous pixel coordinates (pixel x spans [x, x+1))
  const disc: RgbaImage = { data: new Uint8ClampedArray(W * W * 4), width: W, height: W };
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    let inside = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const dx = x + (sx + 0.5) / 4 - C, dy = y + (sy + 0.5) / 4 - C;
      if (dx * dx + dy * dy <= R * R) inside++;
    }
    const i = (y * W + x) * 4;
    disc.data[i] = disc.data[i + 1] = disc.data[i + 2] = 0;
    disc.data[i + 3] = Math.round((inside / 16) * 255);
  }
  const set = processImage(clone(disc), 2, { removeBg: true, smoothing: 0 });
  const ring = set.outline[0] ?? [];
  // Back to pixels: the tracer normalises by the label bbox (longest side = 1, centred).
  let minX = W, maxX = -1;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (disc.data[(y * W + x) * 4 + 3] >= 128) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  const side = maxX - minX + 1;
  const radii = ring.map(([nx, ny]) => Math.hypot(nx * side, ny * side));
  const mean = radii.reduce((a, b) => a + b, 0) / (radii.length || 1);
  const wobble = Math.sqrt(radii.reduce((a, r) => a + (r - mean) ** 2, 0) / (radii.length || 1));
  check(
    'an anti-aliased disc traces to its true radius without a staircase',
    ring.length > 0 && Math.abs(mean - R) < 0.25 && wobble < 0.2,
    `mean radius ${mean.toFixed(2)}px for a ${R}px disc, wobble ${wobble.toFixed(3)}px over ${ring.length} vertices`,
  );
}

// ---------------------------------------------------------------- the colours a picture has

/*
  What the wizard lists for a person to choose from. The heart sample is black outline, red
  fill and two pink cheeks — three colours, and the cheeks are 1.7% of it. The automatic split
  at two colours loses the cheeks, and Ian's complaint was that there was then nothing to pull.
  So the list has to contain exactly those three: not the near-duplicate reds the quantiser
  produces at twelve, not the anti-aliasing debris under 0.1%, and not one fewer.
*/
{
  const { discoverColours } = await import('../src/image/pipeline.ts');
  const found = discoverColours(clone(sample('heart.png')), true);
  const names = found.map((c) => {
    const [r, g, b] = c.rgb;
    if (r + g + b < 60) return 'black';
    if (r > 200 && g < 80) return 'red';
    if (r > 200 && g > 120 && b > 140) return 'pink';
    return `?${c.rgb.join(',')}`;
  });
  check(
    'heart: the colour list is black, red, pink and nothing else',
    names.join(' ') === 'red black pink',
    `${names.join(' ')} (${found.map((c) => (c.coverage * 100).toFixed(1) + '%').join(', ')})`,
  );
  // And keeping all three traces the cheeks as their own shapes.
  const set = processImage(clone(sample('heart.png')), 3, { removeBg: true, customColors: found.map((c) => c.rgb) });
  const pink = set.regions.find((r) => r.quantRgb[1] > 120);
  check(
    'heart: keeping pink brings the cheeks back as two shapes',
    !!pink && pink.components.length === 2,
    pink ? `${pink.components.length} pink components` : 'no pink region',
  );
}

console.log(failures ? `\n${failures} FAILED` : '\nflat art quantises to the colours it is made of');
process.exit(failures ? 1 : 0);
